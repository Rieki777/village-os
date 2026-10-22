/**
 * `season_plans` (0258) and the one quest read the plan page makes beside it.
 *
 * Every statement season plans run lives here, so the table's readers and
 * writers stay enumerable: the route (server/routes/seasonPlans.ts), the notice
 * job, the profile export and the erasure step call these and hold no SQL.
 *
 * WHAT IS WRITTEN AFTER INSERT. A save inserts version n+1 and stamps
 * `superseded_at` on the versions before it, in one transaction. Filing stamps
 * `filed_at` on the newest version. `eraseSeasonPlanWords` nulls the member's
 * own words. Nothing else touches a stored row.
 *
 * `player_moon_load` (0267) is the one exception to insert-only here: a member's
 * read of this moon, one row per member per moon, and a second read the same
 * moon replaces the first. The card shows this moon's read and nothing else.
 *
 * Raw SQL only, never `dbCollection`: its `replaceAll` resets every column a
 * caller leaves out.
 */
import crypto from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { PlanCommitments, PlanInput } from "../../shared/seasonPlans";
import { servedGoalsOf, type CardWords, type SeasonalGoal, type ServedGoal } from "../../shared/seasonPlanWords";

type Db = Pool | PoolConnection;

export interface StoredPlan {
  id: string;
  userId: string;
  seasonId: string;
  version: number;
  aim: string | null;
  servesGoal: string | null;
  commitments: PlanCommitments;
  handingBack: string[];
  /** Every goal served, with how it helps. A row the previous release wrote reads as its one `serves_goal`. */
  servesGoals: ServedGoal[];
  seasonalGoals: SeasonalGoal[];
  cardWords: CardWords | null;
  filedAt: Date | null;
  supersededAt: Date | null;
  createdAt: Date;
}

const COLUMNS =
  "id, user_id, season_id, version, aim, serves_goal, commitments_json, handing_back, serves_goals_json, seasonal_goals_json, card_words_json, filed_at, superseded_at, created_at";

/** MySQL hands JSON back parsed on some drivers and as text on others. */
function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

const instant = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(`${String(v).replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

function listOf<T>(v: unknown): T[] {
  const g = json<T[] | null>(v, null);
  return Array.isArray(g) ? g : [];
}

function wordsOf(v: unknown): CardWords | null {
  const w = json<CardWords | null>(v, null);
  return w && typeof w === "object" && !Array.isArray(w) ? w : null;
}

function rowToPlan(r: any): StoredPlan {
  const back = json<unknown>(r.handing_back, []);
  return {
    id: String(r.id),
    userId: String(r.user_id),
    seasonId: String(r.season_id),
    version: Number(r.version),
    aim: r.aim ?? null,
    servesGoal: r.serves_goal ?? null,
    commitments: json<PlanCommitments>(r.commitments_json, {}) ?? {},
    handingBack: Array.isArray(back) ? back.map(String) : [],
    servesGoals: servedGoalsOf(json<ServedGoal[] | null>(r.serves_goals_json, null), r.serves_goal ?? null),
    seasonalGoals: listOf<SeasonalGoal>(r.seasonal_goals_json),
    cardWords: wordsOf(r.card_words_json),
    filedAt: instant(r.filed_at),
    supersededAt: instant(r.superseded_at),
    createdAt: instant(r.created_at) as Date,
  };
}

/** A plan as saved: every group set. The route fills a group left out from the newest version. */
export type PlanToStore = PlanInput & { seasonalGoals: SeasonalGoal[] | null; cardWords: CardWords | null };

/**
 * WHAT A SAVE STORES. PURE.
 *
 * A group the body left out (`undefined`) keeps what the newest version holds,
 * so Your season and the card's own editor can each save their part without
 * clearing the other's. Card words describe the player, whatever the season,
 * so with no version in this season yet they carry over from `carriedWords`.
 */
export function planToStore(plan: PlanInput, newest: StoredPlan | null, carriedWords: CardWords | null = null): PlanToStore {
  return {
    ...plan,
    seasonalGoals: plan.seasonalGoals !== undefined ? plan.seasonalGoals : newest?.seasonalGoals.length ? newest.seasonalGoals : null,
    cardWords: plan.cardWords !== undefined ? plan.cardWords : newest ? newest.cardWords : carriedWords,
  };
}

/**
 * Save a plan as the member's next version, and stand the earlier ones down.
 *
 * The version is read under a lock inside the transaction, and the unique key
 * on (user, season, version) refuses a second writer that raced past it, so two
 * saves at once can never both become version n+1.
 */
export async function insertPlanVersion(pool: Pool, userId: string, seasonId: string, plan: PlanToStore): Promise<StoredPlan> {
  /*
   * RETRIED ON A LOST RACE (red team D6). The first save reads MAX(version)
   * over an empty range FOR UPDATE, which takes a gap lock; two first saves at
   * once both hold one and both insert into it, and InnoDB kills one as a
   * deadlock (1213), MariaDB with snapshot isolation as 1020, and a save that
   * raced past the read meets the unique key (1062). Each is a clean
   * rollback, so the save runs again and reads the version the winner wrote.
   */
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await insertPlanVersionOnce(pool, userId, seasonId, plan);
    } catch (err: any) {
      const raced = err?.errno === 1213 || err?.errno === 1020 || err?.errno === 1062 || err?.code === "ER_LOCK_DEADLOCK" || err?.code === "ER_DUP_ENTRY";
      if (!raced || attempt >= 8) throw err;
      await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 20) * attempt));
    }
  }
}

async function insertPlanVersionOnce(pool: Pool, userId: string, seasonId: string, plan: PlanToStore): Promise<StoredPlan> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT COALESCE(MAX(version), 0) AS v FROM season_plans WHERE user_id = ? AND season_id = ? FOR UPDATE",
      [userId, seasonId],
    );
    const version = Number(rows[0]?.v ?? 0) + 1;
    const id = `sp-${crypto.randomBytes(8).toString("hex")}`;
    await conn.query(
      "INSERT INTO season_plans (id, user_id, season_id, version, aim, serves_goal, commitments_json, handing_back, serves_goals_json, seasonal_goals_json, card_words_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        userId,
        seasonId,
        version,
        plan.aim,
        // The first goal served, so the previous release still reads a plan.
        plan.servesGoals?.[0]?.goal ?? plan.servesGoal,
        JSON.stringify(plan.commitments ?? {}),
        JSON.stringify(plan.handingBack ?? []),
        plan.servesGoals?.length ? JSON.stringify(plan.servesGoals) : null,
        plan.seasonalGoals?.length ? JSON.stringify(plan.seasonalGoals) : null,
        plan.cardWords && Object.keys(plan.cardWords).length ? JSON.stringify(plan.cardWords) : null,
      ],
    );
    await conn.query(
      "UPDATE season_plans SET superseded_at = UTC_TIMESTAMP() WHERE user_id = ? AND season_id = ? AND version < ? AND superseded_at IS NULL",
      [userId, seasonId, version],
    );
    await conn.commit();
    const [back] = await pool.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM season_plans WHERE id = ?`, [id]);
    return rowToPlan(back[0]);
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

/** Every version of one member's plan for one season, oldest first. */
export async function planVersions(db: Db, userId: string, seasonId: string): Promise<StoredPlan[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM season_plans WHERE user_id = ? AND season_id = ? ORDER BY version`,
    [userId, seasonId],
  );
  return rows.map(rowToPlan);
}

/**
 * File the newest version. False when there is nothing to file: no plan yet,
 * or the newest version is filed already.
 */
export async function fileNewestVersion(db: Db, userId: string, seasonId: string): Promise<boolean> {
  const [r]: any = await db.query(
    "UPDATE season_plans SET filed_at = UTC_TIMESTAMP() WHERE user_id = ? AND season_id = ? AND superseded_at IS NULL AND filed_at IS NULL",
    [userId, seasonId],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

/** Every version in a season, for the village page. A village holds tens of members, never thousands. */
export async function plansInSeason(db: Db, seasonId: string): Promise<StoredPlan[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM season_plans WHERE season_id = ? ORDER BY user_id, version`,
    [seasonId],
  );
  return rows.map(rowToPlan);
}

/** The members who have filed a plan for this season, for the reminder sweep. */
export async function filedMembers(db: Db, seasonId: string): Promise<Set<string>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT DISTINCT user_id FROM season_plans WHERE season_id = ? AND filed_at IS NOT NULL",
    [seasonId],
  );
  return new Set(rows.map((r) => String(r.user_id)));
}

/** Everything a member's plans hold, for `GET /api/profile/export`. */
export async function plansOfMember(db: Db, userId: string): Promise<StoredPlan[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM season_plans WHERE user_id = ? ORDER BY season_id, version`,
    [userId],
  );
  return rows.map(rowToPlan);
}

/**
 * A member's own words go when they ask to be forgotten: aim, the goals they
 * served and how each helps, their seasonal goals, their card words and their
 * commitments, on every version, and every moon load they set. The seats they
 * handed back stay, as the village's record.
 */
export async function eraseSeasonPlanWords(db: Db, userId: string): Promise<number> {
  const [r]: any = await db.query(
    "UPDATE season_plans SET aim = NULL, serves_goal = NULL, commitments_json = NULL, serves_goals_json = NULL, seasonal_goals_json = NULL, card_words_json = NULL WHERE user_id = ?",
    [userId],
  );
  await db.query("DELETE FROM player_moon_load WHERE user_id = ?", [userId]);
  return Number(r?.affectedRows ?? 0);
}

/** The JSON groups of a plan another member's name may appear in. */
export interface PlanWordGroups {
  commitments: unknown;
  servesGoals: unknown;
  seasonalGoals: unknown;
  cardWords: unknown;
}

/** Other members' plans whose words mention a phrase (a wide, case-blind net), for the erasure step. */
export async function plansMentioning(db: Db, phrase: string): Promise<Array<{ id: string; userId: string; aim: string | null } & PlanWordGroups>> {
  const like = `%${phrase.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, user_id, aim, commitments_json, serves_goals_json, seasonal_goals_json, card_words_json FROM season_plans " +
      "WHERE aim LIKE ? OR CAST(commitments_json AS CHAR) LIKE ? OR CAST(serves_goals_json AS CHAR) LIKE ? " +
      "OR CAST(seasonal_goals_json AS CHAR) LIKE ? OR CAST(card_words_json AS CHAR) LIKE ?",
    [like, like, like, like, like],
  );
  return rows.map((r: any) => ({
    id: String(r.id),
    userId: String(r.user_id),
    aim: r.aim ?? null,
    commitments: json<unknown>(r.commitments_json, null),
    servesGoals: json<unknown>(r.serves_goals_json, null),
    seasonalGoals: json<unknown>(r.seasonal_goals_json, null),
    cardWords: json<unknown>(r.card_words_json, null),
  }));
}

const jsonOrNull = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

/** Erasure only: another member's plan words with a departed member's name taken out. */
export async function rewritePlanWords(db: Db, id: string, aim: string | null, groups: PlanWordGroups): Promise<void> {
  await db.query(
    "UPDATE season_plans SET aim = ?, commitments_json = ?, serves_goals_json = ?, seasonal_goals_json = ?, card_words_json = ? WHERE id = ?",
    [aim, jsonOrNull(groups.commitments), jsonOrNull(groups.servesGoals), jsonOrNull(groups.seasonalGoals), jsonOrNull(groups.cardWords), id],
  );
}

/**
 * The newest card words a member wrote, in any season, or null. For the
 * player card, which shows them whether or not a plan is filed: they say how
 * the player holds their roles, whatever the season.
 */
export async function latestCardWords(db: Db, userId: string): Promise<CardWords | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT card_words_json FROM season_plans WHERE user_id = ? AND card_words_json IS NOT NULL ORDER BY created_at DESC, version DESC LIMIT 1",
    [userId],
  );
  return rows.length ? wordsOf(rows[0].card_words_json) : null;
}

/**
 * `latestCardWords` for several members in one read, for the player card's
 * batched builder. Every version with words is read, newest first, and the
 * first per member wins, so the answer is the one `latestCardWords` gives.
 * A member with none is absent.
 */
export async function latestCardWordsFor(db: Db, userIds: readonly string[]): Promise<Map<string, CardWords>> {
  const out = new Map<string, CardWords>();
  if (!userIds.length) return out;
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT user_id, card_words_json FROM season_plans WHERE user_id IN (?) AND card_words_json IS NOT NULL ORDER BY created_at DESC, version DESC",
    [[...userIds]],
  );
  for (const r of rows) {
    const id = String(r.user_id);
    if (out.has(id)) continue;
    const w = wordsOf(r.card_words_json);
    if (w) out.set(id, w);
  }
  return out;
}

// ── This moon's load (0267) ─────────────────────────────────────────────────

export interface MoonLoad {
  cycleId: string;
  /** 1 is Healthy, 5 is Heavy. */
  level: number;
  setAt: Date;
}

const toLoad = (r: any): MoonLoad => ({ cycleId: String(r.cycle_id), level: Number(r.level), setAt: instant(r.set_at) as Date });

/** Set a member's read of a moon. A second read the same moon replaces the first. */
export async function setMoonLoad(db: Db, userId: string, cycleId: string, level: number): Promise<MoonLoad> {
  await db.query(
    "INSERT INTO player_moon_load (user_id, cycle_id, level, set_at) VALUES (?,?,?,UTC_TIMESTAMP()) " +
      "ON DUPLICATE KEY UPDATE level = VALUES(level), set_at = VALUES(set_at)",
    [userId, cycleId, level],
  );
  return (await moonLoadOf(db, userId, cycleId)) as MoonLoad;
}

/** A member's read of one moon, or null when they have not set one. */
export async function moonLoadOf(db: Db, userId: string, cycleId: string): Promise<MoonLoad | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT cycle_id, level, set_at FROM player_moon_load WHERE user_id = ? AND cycle_id = ?", [userId, cycleId]);
  return rows.length ? toLoad(rows[0]) : null;
}

/** `moonLoadOf` for several members and one moon, in one read. A member with no read is absent. */
export async function moonLoadsFor(db: Db, userIds: readonly string[], cycleId: string): Promise<Map<string, MoonLoad>> {
  if (!userIds.length) return new Map();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT user_id, cycle_id, level, set_at FROM player_moon_load WHERE user_id IN (?) AND cycle_id = ?",
    [[...userIds], cycleId],
  );
  return new Map(rows.map((r) => [String(r.user_id), toLoad(r)]));
}

/** Every moon read a member set, oldest first. */
export async function moonLoadsOfMember(db: Db, userId: string): Promise<MoonLoad[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT cycle_id, level, set_at FROM player_moon_load WHERE user_id = ? ORDER BY set_at", [userId]);
  return rows.map(toLoad);
}

/**
 * QUESTS CONSENTED INSIDE ONE MOON, per member, in one grouped read.
 *
 * The plan's pips count only claims consented inside `[from, to)`: a quest
 * claimed this moon and consented last moon, or still waiting, is not this
 * moon's work done.
 */
export async function consentedBetween(db: Db, from: Date, to: Date): Promise<Map<string, number>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT user_id, COUNT(*) AS n FROM quest_claims WHERE status = 'consented' AND consented_at >= ? AND consented_at < ? GROUP BY user_id",
    [from, to],
  );
  return new Map(rows.map((r) => [String(r.user_id), Number(r.n)]));
}
