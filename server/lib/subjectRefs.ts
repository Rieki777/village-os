/**
 * Opaque subject references: how an outside service names a member without
 * ever learning who that member is.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 *
 * The module library contract promises a vendor "an opaque subject reference,
 * a seat and a term. Never an email and never our internal member id." Until
 * this file nothing issued one. `external_proposals.subject_ref` is a varchar
 * whose own comment describes an opaque reference to a person, and no code
 * anywhere ever made one, so a vendor had nothing to put in it and the promise
 * had nothing behind it.
 *
 * Meanwhile `MemberDriver` passes `userId`, which is our internal member id, to
 * every registered driver. The first driver ever registered will be an outside
 * company's, and whatever shape it takes on that day is the shape every later
 * vendor copies. Fixing that after a vendor has stored our member ids is not a
 * refactor, it is a data recall.
 *
 * ── WHY A STORED RANDOM TOKEN AND NOT A DERIVED ONE ──────────────────────
 *
 * Deriving the reference, say an HMAC of the member id under an instance
 * secret, needs no table and looks tidier. It is worse here for two reasons
 * that only appear later, which is the worst time for them to appear:
 *
 *   1. Rotating the secret invalidates every reference every vendor has ever
 *      stored, all at once, and there is no way to hand them the new ones.
 *      A secret you can never rotate is not a secret, it is a liability with
 *      a key ceremony attached.
 *   2. A derived reference cannot be retired for ONE member. Revoking a single
 *      person's reference means changing the secret, which revokes everybody's.
 *
 * A stored mapping costs one table and buys per-member revocation, the reverse
 * lookup the erasure path needs, and no secret to rotate.
 *
 * ── THE ORDER OF OPERATIONS DURING ERASURE IS LOAD-BEARING ───────────────
 *
 * Once the mapping row is gone the reference stops resolving, and the village
 * can no longer ask a vendor about that person even to check they did what
 * they said. So an erasure asks every driver first, records what each one
 * confirmed, and calls `dropSubjectRef` LAST.
 *
 * Dropping it first would leave the village unable to tell a vendor that
 * deleted the data from one that never answered, which is precisely the
 * confusion `forgetMemberEverywhere` was written to prevent. Its rule is that
 * silence is not confirmation; this file's job is to make sure the village can
 * still hear the answer when it comes.
 *
 * ── WHEN A REFERENCE COMES INTO BEING ────────────────────────────────────
 *
 * On first read, never at signup. A village that connects no module issues no
 * references at all, and this table stays empty for the life of the instance.
 */
import { randomBytes } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";

/** Prefixed so a reference is recognisable on sight in a log line or a payload. */
const PREFIX = "sub_";
const SHAPE = /^sub_[0-9a-f]{32}$/;

/** 128 bits of randomness. Unguessable, and carrying nothing about its subject. */
export function newSubjectRef(): string {
  return `${PREFIX}${randomBytes(16).toString("hex")}`;
}

/**
 * Shape check only, and deliberately not an existence check. A caller that
 * needs to know whether a reference resolves asks `userIdForSubjectRef`, which
 * answers from the table. This is here so a malformed value can be refused at
 * the door without a database round trip.
 */
export function looksLikeSubjectRef(v: unknown): v is string {
  return typeof v === "string" && SHAPE.test(v);
}

/**
 * The reference for one member, issuing one if this is the first time anybody
 * has asked.
 *
 * INSERT IGNORE and then re-read, so two concurrent callers converge on a
 * single reference instead of racing. The unique key on `user_id` is what makes
 * the loser's insert a silent no-op rather than a second reference for the same
 * person, which would be the worst possible outcome here: two references for
 * one member means an erasure that clears one of them and reports success.
 */
export async function subjectRefFor(pool: Pool, userId: string): Promise<string> {
  const read = async (): Promise<string | null> => {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT `ref` FROM `subject_refs` WHERE `user_id` = ? LIMIT 1",
      [userId],
    );
    const ref = rows[0]?.ref;
    return typeof ref === "string" ? ref : null;
  };

  const existing = await read();
  if (existing) return existing;

  await pool.query( // module-review-ok: subject_refs has no repo cache above it and this file is the table's one enumerable home (the externalProposals.ts pattern). A dbCollection write would additionally send an explicit NULL for issued_at and violate its NOT NULL, which is the documented DEFAULT trap.
    "INSERT IGNORE INTO `subject_refs` (`ref`, `user_id`) VALUES (?, ?)",
    [newSubjectRef(), userId],
  );

  const issued = await read();
  if (!issued) throw new Error("could not issue a subject reference");
  return issued;
}

/**
 * References for many members in one round trip, issuing for anybody who has
 * never had one.
 *
 * The holders route reads every live seating at once, so the per-member form
 * would be one query per seat. The second loop is bounded by the number of
 * members who have never been referenced before, which is every member the
 * first time a vendor reads and none of them afterwards.
 */
export async function subjectRefsFor(pool: Pool, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = Array.from(new Set(userIds.filter((id) => typeof id === "string" && id !== "")));
  if (wanted.length === 0) return out;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT \`ref\`, \`user_id\` FROM \`subject_refs\` WHERE \`user_id\` IN (${wanted.map(() => "?").join(",")})`,
    wanted,
  );
  for (const r of rows) out.set(String(r.user_id), String(r.ref));

  for (const id of wanted) {
    if (!out.has(id)) out.set(id, await subjectRefFor(pool, id));
  }
  return out;
}

/**
 * The reverse lookup, which is the whole reason the mapping is stored.
 *
 * Returns null for a malformed reference and for one that does not resolve, and
 * the caller must treat those the same way: an unknown reference is not an
 * error to report back to a vendor in detail, because the difference between
 * "never existed" and "existed and was erased" is itself information about a
 * person.
 */
export async function userIdForSubjectRef(pool: Pool, ref: string): Promise<string | null> {
  if (!looksLikeSubjectRef(ref)) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `user_id` FROM `subject_refs` WHERE `ref` = ? LIMIT 1",
    [ref],
  );
  const id = rows[0]?.user_id;
  return typeof id === "string" ? id : null;
}

/**
 * Retire a member's reference. THE LAST STEP OF AN ERASURE, never an earlier
 * one: see the ordering note at the top of this file. After this the reference
 * resolves to nothing, and any vendor still holding it holds a string that
 * names nobody.
 */
export async function dropSubjectRef(pool: Pool, userId: string): Promise<void> {
  await pool.query("DELETE FROM `subject_refs` WHERE `user_id` = ?", [userId]); // module-review-ok: subject_refs has no repo cache above it and this file is the table's one enumerable home (the externalProposals.ts pattern)
}

/* ── HALF-ERASED MEMBERS (0156) ──────────────────────────────────────────
 *
 * When an erasure cannot confirm every store, the mapping is kept so the
 * village can ask again. Kept state with nobody watching it is how "we still
 * owe you a confirmation" becomes "kept forever" the first time a vendor goes
 * dark, so the keeping is recorded rather than merely allowed.
 *
 * The record carries WHICH STORE and not only WHEN. A date alone gives a
 * steward the scale and nobody to press.
 */

/** One store that has not confirmed, as the outcome already described it. */
export interface UnconfirmedStore {
  module: string;
  detail: string;
}

export interface HalfErased {
  count: number;
  /** ISO instant of the OLDEST outstanding obligation, or null when there are none. */
  oldestSince: string | null;
  /** Module id to how many members are still waiting on it. */
  waitingOn: Record<string, number>;
}

function parseUnconfirmed(v: unknown): UnconfirmedStore[] {
  if (!v) return [];
  const raw = typeof v === "string" ? safeParse(v) : v;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === "object")
    .map((r: any) => ({ module: String(r.module ?? ""), detail: String(r.detail ?? "") }))
    .filter((r) => r.module !== "");
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Record that this member's erasure is unfinished, and who it is waiting on.
 *
 * `erasure_pending_since` uses COALESCE so a retry that also fails does NOT
 * move the date forward. The age is the age of the OBLIGATION and not of the
 * last attempt, because a number that resets every time somebody tries is a
 * number that never grows old enough for anyone to act on.
 */
export async function markErasurePending(
  pool: Pool,
  userId: string,
  unconfirmed: readonly UnconfirmedStore[],
): Promise<void> {
  await pool.query( // module-review-ok: subject_refs has no repo cache above it and this file is the table's one enumerable home (the externalProposals.ts pattern)
    "UPDATE `subject_refs` SET `erasure_pending_since` = COALESCE(`erasure_pending_since`, NOW()), " +
      "`erasure_unconfirmed` = ? WHERE `user_id` = ?",
    [JSON.stringify(unconfirmed.map((u) => ({ module: u.module, detail: u.detail.slice(0, 300) }))), userId],
  );
}

/** The sentence a steward reads: how many, waiting on whom, and how long. */
export async function halfErasedMembers(pool: Pool): Promise<HalfErased> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `erasure_pending_since`, `erasure_unconfirmed` FROM `subject_refs` " +
      "WHERE `erasure_pending_since` IS NOT NULL ORDER BY `erasure_pending_since` ASC",
  );
  const waitingOn: Record<string, number> = {};
  for (const r of rows) {
    for (const u of parseUnconfirmed(r.erasure_unconfirmed)) {
      waitingOn[u.module] = (waitingOn[u.module] ?? 0) + 1;
    }
  }
  const oldest = rows[0]?.erasure_pending_since;
  return {
    count: rows.length,
    oldestSince: oldest ? new Date(String(oldest)).toISOString() : null,
    waitingOn,
  };
}

/**
 * The members a retry would re-ask about, oldest obligation first.
 *
 * A count with no way to act on it is a dashboard rather than a fix: nothing
 * will erase these members a second time, because they are already gone. This
 * is what the retry iterates.
 */
export async function pendingErasureUserIds(pool: Pool, limit = 200): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `user_id` FROM `subject_refs` WHERE `erasure_pending_since` IS NOT NULL " +
      "ORDER BY `erasure_pending_since` ASC LIMIT ?",
    [Math.max(1, Math.min(1000, limit))],
  );
  return rows.map((r) => String(r.user_id));
}
