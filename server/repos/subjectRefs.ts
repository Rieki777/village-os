/**
 * `subject_refs`: every statement that touches the opaque-reference mapping.
 *
 * ── WHY THE TABLE EXISTS IS NOT ARGUED HERE ──────────────────────────────
 *
 * It is argued in `server/lib/subjectRefs.ts` and in migration 0153, at
 * length, and repeating it here would give the repository two versions of one
 * argument that drift apart. What this file is for is narrower and is the
 * half the burn-down rule cares about: a table's readers and writers stay
 * ENUMERABLE, which for this table is not bookkeeping.
 *
 * `subject_refs` is the mapping an erasure has to clear completely. Two
 * references for one member means an erasure clears one, reports success, and
 * leaves the other resolving, which is the failure 0153's own comment calls
 * the worst this table can have. A reader nobody remembered is the same
 * failure wearing different clothes. Opening one file and reading every
 * statement is what makes "did we get all of it" a question somebody can
 * actually answer.
 *
 * ── ONE READER IS NOT HERE, AND IS NAMED SO IT STAYS FINDABLE ────────────
 *
 * `server/lib/externalProposals.ts` JOINs `subject_refs` against
 * `external_proposal_subjects` to attach a member to a vendor's proposal. It
 * is a two-table statement in a file this change did not own, so it did not
 * move. It is written down here because the value of an enumerable home is
 * lost the moment the list is silently incomplete: a reader who finds this
 * file and believes it exhaustive is worse off than one who greps.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT DECIDE ──────────────────────────
 *
 * Every function below is one statement against one table, and none of them
 * holds a policy. The policies stayed where they can be read beside the rules
 * they keep:
 *
 *   - WHEN a reference is issued. `subjectRefFor` decides that, on first read
 *     and never at signup, by calling `refForUser`, then `insertRefIfAbsent`
 *     with a reference it minted itself, then `refForUser` again. The mint
 *     stays in the lib because the SHAPE of a reference (`sub_` and 128 bits)
 *     is what `looksLikeSubjectRef` checks, and one file should own both.
 *   - WHEN one is retired. `forgetMemberEverywhere`
 *     (`server/lib/memberDrivers.ts`) asks every driver first and drops the
 *     mapping LAST. Folding that order behind a repo function would hide the
 *     single property the erasure path depends on.
 *   - WHAT `erasure_unconfirmed` means. The caller hands over a JSON string it
 *     has already clipped and gets the driver's own value back to parse. A
 *     repo that parsed it would own a second opinion about a column whose type
 *     depends on the connection (`json` in MySQL, string or object out of the
 *     driver), and the caller already has a tolerant parser for exactly that.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ───────────────────────────────────────
 *
 * Worth saying rather than leaving to be inferred, because the other half of
 * the burn-down rule is about caches staying correct and there is nothing
 * here to invalidate. Every read below goes to the database at the moment it
 * is asked, on purpose: a retired reference has to stop resolving at once, and
 * a cached "yes" is the one answer an erasure cannot afford.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * The mapping itself. `issued_at` is on the table (0153) and no read below
 * asks for it: nothing in the product shows it, and selecting a column no
 * caller wants is how a column acquires a reader it does not have.
 */
const COLUMNS = "`ref`, `user_id`";

/** The two columns 0156 added, read together because the steward's sentence needs both. */
const ERASURE_COLUMNS = "`erasure_pending_since`, `erasure_unconfirmed`";

/**
 * One row of the half-erased queue, kept as the driver returned it.
 *
 * Both fields are `unknown` on purpose and it is not laziness.
 * `erasure_pending_since` is a timestamp the caller turns into an ISO instant
 * with `new Date(String(v))`, which behaves identically whether the driver
 * handed back a `Date` or a string; converting here would pick one of those
 * and quietly change what a broken value does. `erasure_unconfirmed` is a
 * `json` column that arrives parsed on some connections and as text on
 * others, and the caller's parser already accepts both.
 */
export interface PendingErasureRow {
  pendingSince: unknown;
  unconfirmed: unknown;
}

/** One member and the reference that names them, which is the whole table. */
export interface SubjectRefRow {
  userId: string;
  ref: string;
}

/**
 * The reference this member already holds, or null if nobody has asked yet.
 *
 * Scoped by `user_id`, which carries the unique key, so `LIMIT 1` is a
 * statement of what the index already guarantees and not a way of picking one
 * of several. A row whose `ref` is somehow not a string reads as absent: the
 * caller's next move is to issue one, and issuing beats handing back a value
 * nothing can resolve.
 */
export async function refForUser(pool: Pool, userId: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `ref` FROM `subject_refs` WHERE `user_id` = ? LIMIT 1",
    [userId],
  );
  const ref = rows[0]?.ref;
  return typeof ref === "string" ? ref : null;
}

/**
 * Issue a reference for a member who may already have one, and lose quietly if
 * they do.
 *
 * INSERT IGNORE, so the unique key on `user_id` makes the loser of a race a
 * silent no-op instead of a second reference for the same person. The caller
 * re-reads afterwards and both racers converge on whichever row landed. This
 * function therefore reports nothing about what it did: `affectedRows` would
 * tempt a caller into treating "I inserted it" as "this is the reference", and
 * that is the belief the re-read exists to prevent.
 *
 * `issued_at` is left to its `DEFAULT CURRENT_TIMESTAMP`, which is why this is
 * a named-column INSERT and not a `dbCollection` write: that helper names every
 * spec'd column, so an unset key arrives as an explicit NULL and a column
 * DEFAULT never applies. On a NOT NULL column with a good default that is a
 * guaranteed violation, and `issued_at` is exactly that column.
 */
export async function insertRefIfAbsent(pool: Pool, ref: string, userId: string): Promise<void> {
  await pool.query(
    "INSERT IGNORE INTO `subject_refs` (`ref`, `user_id`) VALUES (?, ?)",
    [ref, userId],
  );
}

/**
 * The references several members already hold, in one round trip.
 *
 * Members with no row are simply absent from the answer, which is what lets
 * the caller tell "has one" from "needs one" without a query per member. An
 * empty list returns nothing without going to the database: `IN ()` is a
 * syntax error, so the guard is the difference between a no-op and a throw.
 *
 * Rows and not a map, so the caller decides what a duplicate would mean and
 * this file keeps no opinion the unique key already holds. The placeholders
 * are generated from the list's own length and every value travels as a
 * parameter, so a member id is never concatenated into SQL.
 */
export async function refsForUsers(
  pool: Pool,
  userIds: readonly string[],
): Promise<SubjectRefRow[]> {
  if (userIds.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`subject_refs\` WHERE \`user_id\` IN (${userIds.map(() => "?").join(",")})`,
    userIds as string[],
  );
  return rows.map((r) => ({ userId: String(r.user_id), ref: String(r.ref) }));
}

/**
 * The reverse lookup, which is the whole reason the mapping is stored.
 *
 * Takes the reference as given and does not check its shape first: that check
 * is the caller's, because refusing a malformed value at the door without a
 * round trip is the point of having it. Null here means the reference names
 * nobody, and the caller must not report which of "never existed" and "existed
 * and was erased" it was.
 */
export async function userIdForRef(pool: Pool, ref: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `user_id` FROM `subject_refs` WHERE `ref` = ? LIMIT 1",
    [ref],
  );
  const id = rows[0]?.user_id;
  return typeof id === "string" ? id : null;
}

/**
 * Retire a member's reference.
 *
 * By `user_id` and not by `ref`, so it cannot leave a second row behind for
 * the same person. Deleting rather than blanking, because a kept row with an
 * emptied column is still a record that this member was referenced.
 *
 * THE LAST STEP OF AN ERASURE. The ordering lives with the caller and the
 * reason it is load-bearing is written out there; nothing in this file can
 * enforce it, and a comment here claiming otherwise would be the kind of
 * promise nobody checks.
 */
export async function deleteRefForUser(pool: Pool, userId: string): Promise<void> {
  await pool.query("DELETE FROM `subject_refs` WHERE `user_id` = ?", [userId]);
}

/**
 * Record that a member's erasure is unfinished, and who it is waiting on.
 *
 * COALESCE, so a retry that also fails does NOT move the date forward. The age
 * is the age of the OBLIGATION and not of the last attempt, because a number
 * that resets whenever somebody tries never grows old enough for anyone to act
 * on it.
 *
 * `unconfirmedJson` arrives serialized and already clipped. Doing that here
 * would put the clipping length in one file and the reason for it in another,
 * and the reason is the interesting half: an unbounded vendor string is how a
 * strict MySQL turns a long detail into a LOST record rather than a truncated
 * one.
 *
 * An UPDATE matching no row is not an error. A member nobody ever referenced
 * has no mapping to mark, and the erasure that called this still ran.
 */
export async function setErasurePending(
  pool: Pool,
  userId: string,
  unconfirmedJson: string,
): Promise<void> {
  await pool.query(
    "UPDATE `subject_refs` SET `erasure_pending_since` = COALESCE(`erasure_pending_since`, NOW()), " +
      "`erasure_unconfirmed` = ? WHERE `user_id` = ?",
    [unconfirmedJson, userId],
  );
}

/**
 * Every outstanding obligation, oldest first.
 *
 * Oldest first because the caller reads the first row as THE oldest and counts
 * the rest; changing this ORDER BY changes the date a steward is shown without
 * changing anything that looks like it computes a date.
 *
 * Uncapped, deliberately, where `userIdsPendingErasure` below is capped. This
 * one is a COUNT and a summary: a cap would make the number quietly wrong on
 * the day it mattered most, and "1 of at most 200" is not a sentence anybody
 * can act on. The retry that iterates members is the one that needs a bound.
 */
export async function pendingErasures(pool: Pool): Promise<PendingErasureRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${ERASURE_COLUMNS} FROM \`subject_refs\` ` +
      "WHERE `erasure_pending_since` IS NOT NULL ORDER BY `erasure_pending_since` ASC",
  );
  return rows.map((r) => ({
    pendingSince: r.erasure_pending_since,
    unconfirmed: r.erasure_unconfirmed,
  }));
}

/**
 * The members a retry would re-ask about, oldest obligation first.
 *
 * The bound is clamped here, with the statement it bounds, so no caller can
 * pass a limit the query would not survive: 1 at the least, because LIMIT 0
 * returns nothing while looking like a query that ran, and 1000 at the most.
 */
export async function userIdsPendingErasure(pool: Pool, limit: number): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `user_id` FROM `subject_refs` WHERE `erasure_pending_since` IS NOT NULL " +
      "ORDER BY `erasure_pending_since` ASC LIMIT ?",
    [Math.max(1, Math.min(1000, limit))],
  );
  return rows.map((r) => String(r.user_id));
}
