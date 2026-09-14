/**
 * `ballot_vetoes`: every statement against the table that holds a steward's
 * act, and the only place one is written.
 *
 * ── WHY THIS TABLE IS THE ONE WORTH MAKING ENUMERABLE ───────────────────────
 *
 * The rule the burn-down register states is that a table's readers and writers
 * stay listable. For most tables that is hygiene. For this one it is the
 * promise the table exists to keep.
 *
 * 0170 put the reason in the schema itself: a veto's `reason` is free text one
 * member writes about another member's work, on a page the whole village reads
 * and keeps, and it has to be erasable WITHOUT erasing the act. Redaction
 * therefore has to reach every copy of those words, and the first build of it
 * reached one of three. `VETO_TEXT_COLUMNS` in `server/lib/stewardship.ts`
 * names all three columns; this file is the enumerable home of the first of
 * them, and `server/repos/stewardshipBallots.ts` and
 * `server/repos/proposalVetoReasons.ts` are the other two. "Did the redaction
 * get all of it" is a question somebody has to be able to answer by opening
 * files, not by grepping and hoping.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ──────────────────────────────────────────
 *
 * Worth saying rather than leaving to be inferred, because the other half of
 * the burn-down rule is about caches staying correct and there is nothing here
 * to invalidate. Every read below goes to the database at the moment it is
 * asked, which is what a redaction needs: a blanked reason has to stop
 * rendering at once, and a cached copy of somebody's words is the one answer
 * this table cannot afford.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DECIDE ───────────────────────────
 *
 * Every function here is one statement against one table and none of them
 * holds a policy. The policies stayed in `server/lib/stewardship.ts`, beside
 * the founder's words that settled them:
 *
 *   - WHETHER a reason is acceptable. `vetoReasonProblem` refuses a blank one
 *     and caps the length, and it refuses BEFORE anything is written. A repo
 *     that validated would own a second opinion about a rule whose sentences
 *     are rendered to the member who typed it.
 *   - WHAT A VETO IS WORTH. `stewardVetoStands` counts the acts against the
 *     seated stewards and the council setting. This file counts nothing.
 *   - WHICH ROWS COUNT. The filter to `act === "veto"` and to authors who have
 *     held a steward-capable seat is applied by the caller, in JS, because it
 *     needs the seat rows too. Pushing it into SQL here would put half of a
 *     two-table rule in a file that can only see one of them.
 *   - THE SHAPE OF AN ID. `bv-<millis>-<random>` is minted by the caller and
 *     passed in, the same way `server/repos/subjectRefs.ts` leaves the mint
 *     with the lib that owns what a reference looks like.
 *
 * ── READ, THEN WRITE, AND WHY `affectedRows` IS NOT THE ANSWER HERE ─────────
 *
 * `insertVetoActIfAbsent` returns nothing on purpose. `ON DUPLICATE KEY UPDATE
 * id = id` is a no-op update and the two engines this platform runs on
 * disagree about whether that counts as zero rows affected or one, so a caller
 * that read `affectedRows` as "was this new" would be told, on one engine,
 * that they had just vetoed something when the standing act was somebody
 * else's. The caller reads the row back instead and compares. The unique key
 * `(ballot_id, decided_by, act)` from 0170 is what makes that safe without a
 * lock: two simultaneous taps still leave exactly one row and the loser reads
 * the winner's.
 *
 * The two blanking UPDATEs DO return `affectedRows`, and that is not a
 * contradiction: they are real updates whose row count is the number the
 * erasure report prints, and "nothing to blank" and "the sweep did not run"
 * have to stay different answers there.
 *
 * ── INDEXES ─────────────────────────────────────────────────────────────────
 *
 * All three from 0170. `ballot_vetoes_ballot_idx (ballot_id, act)` covers the
 * per-ballot read and the per-act lookup, `ballot_vetoes_by_idx (decided_by)`
 * covers the erasure sweep, and the unique key covers the insert.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { StewardAct, VetoRow } from "../lib/stewardship";

/**
 * Every column on the table, and every read below takes all of them.
 *
 * One list rather than a narrower one per read, because `VetoRow` is one shape
 * and a read that filled half of it would hand a caller a row whose absent
 * fields are indistinguishable from null ones. `redacted_at` in particular is
 * the field that says whether a redaction has already happened, and a read
 * that omitted it would make redacting twice look like redacting once.
 */
const COLUMNS = "id, ballot_id, act, decided_by, reason, redacted_at, redacted_by, decided_at";

/**
 * A timestamp as an ISO instant, or null.
 *
 * mysql2 runs with `timezone: "Z"` and no `dateStrings`, so a `timestamp`
 * column normally arrives as a Date already read as UTC. `String(v)` is the
 * fallback for a connection configured otherwise, and it hands the value on
 * unchanged rather than guessing at a zone.
 */
const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

/**
 * One act, mapped to the shape the routes and the dispatcher already read.
 *
 * `reason` is coerced to a string and never to null. The column is NOT NULL by
 * 0170 and a redaction writes `''`, so blank means redacted and there is no
 * third state; a null leaking out of a driver here would render as the word
 * "null" under somebody's name.
 */
function toVetoRow(r: RowDataPacket): VetoRow {
  return {
    id: String(r.id),
    ballotId: String(r.ballot_id),
    act: r.act as StewardAct,
    decidedBy: String(r.decided_by),
    reason: String(r.reason ?? ""),
    redactedAt: iso(r.redacted_at),
    redactedBy: r.redacted_by === null || r.redacted_by === undefined ? null : String(r.redacted_by),
    decidedAt: iso(r.decided_at) ?? "",
  };
}

/**
 * Every act on one ballot, oldest first.
 *
 * The ordering is the record's ordering and is stated in the statement rather
 * than left to the table's physical order, which is not a promise MySQL makes.
 * A surface renders these in the order a village lived them, and `id` breaks a
 * tie so two acts written in the same second cannot swap places between reads.
 *
 * Both kinds of act come back. A steward who recorded an early "no objection"
 * and then vetoed inside the window has two rows and the village should read
 * both; the caller filters to the kind it is counting.
 */
export async function vetoRowsForBallot(pool: Pool, ballotId: string): Promise<VetoRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM ballot_vetoes WHERE ballot_id = ? ORDER BY decided_at, id`,
    [ballotId],
  );
  return rows.map(toVetoRow);
}

/**
 * One steward's act of one kind on one ballot, or null.
 *
 * Addressed by the whole of the unique key from 0170, so at most one row can
 * match and there is nothing to order or limit. Null means this steward has
 * not recorded an act of this kind, which is a different fact from having
 * recorded one and had its words redacted.
 */
export async function vetoActFor(
  pool: Pool,
  ballotId: string,
  decidedBy: string,
  act: StewardAct,
): Promise<VetoRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM ballot_vetoes WHERE ballot_id = ? AND decided_by = ? AND act = ?`,
    [ballotId, decidedBy, act],
  );
  return rows[0] ? toVetoRow(rows[0]) : null;
}

/**
 * Write one act, and lose quietly to whoever got there first.
 *
 * Reports nothing about what it did. The header says why: the no-op update is
 * not portably countable, and the caller's read-back is the answer that is
 * true on both engines.
 *
 * `decided_at` is left to its `DEFAULT CURRENT_TIMESTAMP`, which is why this
 * is a named-column INSERT: the instant on the record is the database's, so
 * two acts written a second apart cannot be reordered by a clock skew between
 * app machines.
 */
export async function insertVetoActIfAbsent(
  pool: Pool,
  input: { id: string; ballotId: string; act: StewardAct; decidedBy: string; reason: string },
): Promise<void> {
  await pool.query(
    "INSERT INTO ballot_vetoes (id, ballot_id, act, decided_by, reason) VALUES (?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE id = id",
    [input.id, input.ballotId, input.act, input.decidedBy, input.reason],
  );
}

/** One act by its own id, or null when there is no such act. */
export async function vetoActById(pool: Pool, vetoId: string): Promise<VetoRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM ballot_vetoes WHERE id = ?`,
    [vetoId],
  );
  return rows[0] ? toVetoRow(rows[0]) : null;
}

/**
 * Blank the words on one act, keep the act.
 *
 * `redacted_at IS NULL` in the WHERE is the guard, not a filter: it is what
 * makes redacting twice a no-op rather than a second write that moves the
 * timestamp, so the record keeps saying when the words were taken away rather
 * than when somebody last pressed the button.
 *
 * The row is not read back here. The caller re-reads through `vetoActById`
 * because it also has to reach the mirrored copies on two other tables in
 * between, and a repo that returned the row would invite a caller to trust an
 * answer taken before the rest of the sweep ran.
 */
export async function blankVetoActReason(pool: Pool, vetoId: string, redactedBy: string): Promise<void> {
  await pool.query(
    "UPDATE ballot_vetoes SET reason = '', redacted_at = CURRENT_TIMESTAMP, redacted_by = ? WHERE id = ? AND redacted_at IS NULL",
    [redactedBy, vetoId],
  );
}

/**
 * Blank every act this member WROTE, and report how many moved.
 *
 * The right-to-be-forgotten path. The acts keep their shape and lose their
 * words, because the village's record of what was stopped is the village's and
 * the words are the member's.
 *
 * `redacted_by` is the departing member themselves, which is the honest
 * attribution: nobody else asked for this. Already-redacted acts are skipped
 * by the same `redacted_at IS NULL` guard, so a repeated erasure does not
 * restamp an older redaction with a newer date.
 *
 * The count is the caller's to report and never to interpret as success: zero
 * means this member wrote no unredacted act, and the caller keeps that apart
 * from a sweep that never ran.
 */
export async function blankVetoActReasonsBy(pool: Pool, userId: string): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE ballot_vetoes SET reason = '', redacted_at = CURRENT_TIMESTAMP, redacted_by = ? " +
      "WHERE decided_by = ? AND redacted_at IS NULL",
    [userId, userId],
  );
  return Number(res?.affectedRows ?? 0);
}
