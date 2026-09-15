/**
 * The members repository: the only place that reads or writes member records.
 *
 * S6: the backing store is MySQL (`users` table), reached through the shared
 * pool (server/db/pool.ts, timezone 'Z'). The JSON file era ended here — the
 * repository interface is the same one the routes already talked to, minus
 * the two file-era leaks:
 *
 *  - `readDoc()` is now `all()` — a SELECT, not a file read.
 *  - `saveDoc()` is gone. It existed because JSON handlers loaded every
 *    member, edited one, and wrote the lot back — the exact
 *    read-modify-write race `update()` exists to prevent. With rows there is
 *    no "whole document" to save, so every former saveDoc site now calls
 *    `add()` or `update()` and the race is structurally unwritable.
 *
 * `update()` runs SELECT ... FOR UPDATE inside a transaction: the mutator
 * sees a row no concurrent request can touch until commit. That is the
 * locking the JSON version's doc-comment promised "when this moves to
 * MySQL". This is that move.
 *
 * Records keep their historical camelCase shape (tokenVersion, joinedAt as
 * ISO string, trainingComplete as boolean) so route code and API responses
 * are unchanged; the mapping to snake_case columns lives here and only here.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "../db/pool";

/** Loose on purpose: the record's shape is still owned by server/index.ts. */
export type MemberRecord = Record<string, any> & { id: string; email: string };

export interface UsersRepo {
  all(): Promise<MemberRecord[]>;
  byId(id: string): Promise<MemberRecord | null>;
  byEmail(email: string): Promise<MemberRecord | null>;
  existsByEmail(email: string): Promise<boolean>;
  count(): Promise<number>;
  add(member: MemberRecord): Promise<MemberRecord>;
  /**
   * Read, mutate, write, as one transaction with the row locked. Returns the
   * updated record, or null if the member is gone. The mutator receives the
   * record and may change it in place; returning a value is unnecessary.
   */
  update(id: string, mutate: (member: MemberRecord) => void): Promise<MemberRecord | null>;
  remove(id: string): Promise<MemberRecord | null>;
}

/** Columns the repository owns, in one place so INSERT and UPDATE cannot drift. */
const COLUMNS = [
  "id",
  "name",
  "email",
  "password_hash",
  "paths",
  "recognition_balance",
  "contributions",
  "quests",
  "journeys",
  "prefs",
  "contactable",
  "bio",
  "avatar",
  "stage_granted",
  "training_complete",
  "role",
  "handle",
  "token_version",
  "wallet_address",
  "wallet_verified_at",
  "joined_at",
  "is_example",
  // 0058. Read as a gate by `hasMembership` and written by a boot migration
  // since long before it existed as a column, so every write landed on the
  // in-memory record and the UPDATE below dropped it.
  "membership_granted",
] as const;

function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** mysql2 may hand JSON columns back parsed or as strings depending on how they were written. */
function fromJsonCol(v: unknown, fallback: any) {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  }
  return v;
}

function rowToMember(row: RowDataPacket): MemberRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash ?? "",
    paths: fromJsonCol(row.paths, []),
    recognitionBalance: Number(row.recognition_balance ?? 0),
    contributions: fromJsonCol(row.contributions, []),
    quests: fromJsonCol(row.quests, []),
    journeys: fromJsonCol(row.journeys, {}),
    prefs: fromJsonCol(row.prefs, {}),
    contactable: row.contactable == null ? true : !!row.contactable,
    bio: row.bio ?? "",
    avatar: row.avatar ?? null,
    stageGranted: row.stage_granted ?? null,
    trainingComplete: !!row.training_complete,
    role: row.role ?? "member",
    handle: row.handle ?? null,
    tokenVersion: Number(row.token_version ?? 0),
    walletAddress: row.wallet_address ?? null,
    walletVerifiedAt: toIso(row.wallet_verified_at),
    joinedAt: toIso(row.joined_at),
    // A standing-example identity: content that authors example threads, never
    // a person. Excluded from the roster, member counts and every metric that
    // counts humans; it has no password_hash, so it can never sign in.
    isExample: Number(row.is_example ?? 0) === 1,
    /** An explicit steward grant, as opposed to an attributed signing. */
    membershipGranted: Number(row.membership_granted ?? 0) === 1,
  };
}

function toDb(v: unknown): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function memberToParams(m: MemberRecord): any[] {
  return [
    m.id,
    m.name ?? "",
    m.email,
    m.passwordHash ?? "",
    JSON.stringify(m.paths ?? []),
    Number(m.recognitionBalance ?? 0),
    JSON.stringify(m.contributions ?? []),
    JSON.stringify(m.quests ?? []),
    JSON.stringify(m.journeys ?? {}),
    JSON.stringify(m.prefs ?? {}),
    m.contactable === false ? 0 : 1,
    m.bio ?? null,
    m.avatar ?? null,
    m.stageGranted ?? null,
    m.trainingComplete ? 1 : 0,
    m.role ?? "member",
    m.handle ?? null,
    Number(m.tokenVersion ?? 0),
    m.walletAddress ?? null,
    toDb(m.walletVerifiedAt),
    toDb(m.joinedAt) ?? new Date(),
    m.isExample ? 1 : 0,
    m.membershipGranted ? 1 : 0,
  ];
}

export function usersRepo(pool: Pool = getPool()): UsersRepo {
  const select = `SELECT ${COLUMNS.join(", ")} FROM users`;

  async function rows(sql: string, params: any[] = []): Promise<RowDataPacket[]> {
    const [r] = await pool.query<RowDataPacket[]>(sql, params);
    return r;
  }

  return {
    /**
     * THE ORDER BY IS LOAD-BEARING. Leave it.
     *
     * `id` is the primary key, so `joined_at, id` is a TOTAL order: two reads
     * of the same rows answer identically, and `joined_at` is
     * `timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP` with no `ON UPDATE`
     * clause, so writing a member cannot move them. Every admin table built on
     * this read depends on that. Without it MySQL is free to answer in any
     * order it likes, and a row that shifts between two reads puts the next
     * click on a different person than the one the admin was looking at.
     *
     * This is the STABILITY floor, and it is deliberately not the display
     * order. Join order cannot be searched, so surfaces that show members to a
     * person sort through `shared/memberOrder.ts` on top of this.
     */
    async all() {
      return (await rows(`${select} ORDER BY joined_at, id`)).map(rowToMember);
    },

    async byId(id) {
      const r = await rows(`${select} WHERE id = ?`, [id]);
      return r[0] ? rowToMember(r[0]) : null;
    },

    async byEmail(email) {
      // Collation is case-insensitive, matching the JSON repo's sameEmail().
      const r = await rows(`${select} WHERE email = ?`, [String(email ?? "")]);
      return r[0] ? rowToMember(r[0]) : null;
    },

    async existsByEmail(email) {
      const r = await rows("SELECT 1 FROM users WHERE email = ? LIMIT 1", [String(email ?? "")]);
      return r.length > 0;
    },

    async count() {
      const r = await rows("SELECT COUNT(*) AS n FROM users");
      return Number(r[0]?.n ?? 0);
    },

    async add(member) {
      await pool.query(
        `INSERT INTO users (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(",")})`,
        memberToParams(member),
      );
      return member;
    },

    async update(id, mutate) {
      const conn: PoolConnection = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [r] = await conn.query<RowDataPacket[]>(`${select} WHERE id = ? FOR UPDATE`, [id]);
        if (!r[0]) {
          await conn.rollback();
          return null;
        }
        const member = rowToMember(r[0]);
        mutate(member);
        const params = memberToParams(member);
        await conn.query(
          `UPDATE users SET ${COLUMNS.slice(1)
            .map((c) => `${c} = ?`)
            .join(", ")} WHERE id = ?`,
          [...params.slice(1), id],
        );
        await conn.commit();
        return member;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },

    async remove(id) {
      const existing = await this.byId(id);
      if (!existing) return null;
      await pool.query("DELETE FROM users WHERE id = ?", [id]);
      return existing;
    },
  };
}

/**
 * Every catalyst's member id, in id order.
 *
 * ── WHY THIS IS NOT `all()` WITH A FILTER OVER IT ──────────────────────────
 *
 * Because `all()` reads twenty-three columns of every member in the village to
 * answer a question about one column of a handful of them, and because the
 * answer is wanted at the one moment nothing else should be slow: the launch
 * closer, running with no transaction around it, seating the catalysts as
 * stewards once the Birthing carries.
 *
 * It lives on this file because `users` has one repository and this is it. A
 * steward-shaped read of the members table sitting in
 * `server/lib/stewardship.ts` would be a reader of this table that nobody
 * listing this table's readers would ever find, which is the whole failure the
 * repo rule exists to prevent.
 *
 * ── `founder` IS THE STORED VALUE AND `Catalyst` IS THE WORD ───────────────
 *
 * The `role` column holds `founder`, which is the value every existing village
 * already has on disk; the word a player reads is Catalyst, and the mapping
 * between the two belongs to the surfaces that render it. This is not one of
 * those surfaces, so it asks for what the column holds. Changing the value
 * would be a migration and a rename of history.
 *
 * ── EXAMPLE MEMBERS ARE NOT EXCLUDED ───────────────────────────────────────
 *
 * Deliberately, and it matches the statement this replaced. `is_example` marks
 * a village's standing demonstration rows, and a village that carries an
 * example catalyst has a row that can hold a real seat. Filtering it out here
 * would leave a member the capability gate can see and this read cannot, which
 * is the shape of a permission bug and not of a display one.
 *
 * ── THE ORDER BY IS LOAD-BEARING ───────────────────────────────────────────
 *
 * `id` is the primary key, so this is a TOTAL order: two reads of the same
 * rows answer identically, the seating loop writes its holdings in a stable
 * sequence, and its report lists them the same way twice. Without it MySQL is
 * free to answer in any order it likes.
 */
export async function catalystUserIds(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM users WHERE role = 'founder' ORDER BY id",
  );
  return rows.map((r) => String(r.id));
}
