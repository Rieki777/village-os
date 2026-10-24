/**
 * `member_erasures`: every statement that touches the record of how far a
 * member's erasure got.
 *
 * ── WHY THE TABLE EXISTS IS NOT ARGUED HERE ──────────────────────────────
 *
 * It is argued in `server/lib/erasure.ts` and in migration 0195, at length.
 * Repeating it would give the repository two versions of one argument that
 * drift apart. What this file owns is narrower: the table's readers and
 * writers stay ENUMERABLE, which for this table is not bookkeeping. A reader
 * nobody remembered is how a half-erased member becomes invisible again.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ───────────────────────────────────────
 *
 * Every read below goes to the database at the moment it is asked. The whole
 * value of the row is that it survives the process that wrote it, so an
 * in-memory copy would answer for a run that is already over.
 *
 * ── THE ONE ORDERING RULE ────────────────────────────────────────────────
 *
 * `noteStepDone` is called AFTER its step's writes have landed, never before.
 * A death between the write and the note leaves a finished step unrecorded,
 * and a resume re-runs it, which is safe because every step is idempotent. Noting
 * first would let a resume SKIP work that never happened, which is the one
 * direction this table must never fail in.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * The longest error sentence this table stores.
 *
 * `last_error` is varchar(500) and MySQL in strict mode refuses an over-long
 * value rather than truncating it, which would turn "the erasure failed" into
 * "the erasure failed and we also lost the record of that". Clipped here, in
 * the one place that writes the column.
 */
const MAX_ERROR = 500;

export interface ErasureRecord {
  userId: string;
  startedAt: string | null;
  finishedAt: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  stepsDone: string[];
  failedStep: string | null;
  lastError: string | null;
}

const toIso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

/**
 * A JSON column, tolerantly.
 *
 * mysql2 hands a `json` column back parsed on MySQL and as a string on
 * MariaDB, where the type is LONGTEXT underneath. Both shapes are read here so
 * a resume behaves the same on the engine CI pins and the engine a contributor
 * runs locally, which is the split `server/db/collation.ts` records the cost of.
 */
function readSteps(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((s) => String(s));
  if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map((s) => String(s)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function rowToRecord(r: RowDataPacket): ErasureRecord {
  return {
    userId: String(r.user_id),
    startedAt: toIso(r.started_at),
    finishedAt: toIso(r.finished_at),
    attempts: Number(r.attempts ?? 0),
    lastAttemptAt: toIso(r.last_attempt_at),
    stepsDone: readSteps(r.steps_done),
    failedStep: r.failed_step == null ? null : String(r.failed_step),
    lastError: r.last_error == null ? null : String(r.last_error),
  };
}

/**
 * What this record answers to anybody who reads it: a step, a count, a date.
 *
 * `erased_identity` (0282) is deliberately NOT here. It is who the erasure is
 * for, held only while the sweep is open, and the steward's queue, the
 * failed-actions job and its report all read through this list. The one reader
 * of that column is `erasedIdentity` below, and its one caller is the sweep.
 */
const COLUMNS =
  "`user_id`, `started_at`, `finished_at`, `attempts`, `last_attempt_at`, " +
  "`steps_done`, `failed_step`, `last_error`";

/**
 * Who the member was before the tombstone: what every step that matches them
 * by name or address needs, and what the tombstone takes off the user row.
 */
export interface ErasedIdentity {
  name: string;
  email: string;
  handle: string | null;
}

/** The identity as the column stores it, or SQL NULL for "keep what is held". */
function identityParam(identity: ErasedIdentity | null | undefined): string | null {
  if (!identity) return null;
  return JSON.stringify({ name: String(identity.name ?? ""), email: String(identity.email ?? ""), handle: identity.handle ?? null });
}

/**
 * Open the record for a FRESH sweep: every step will run.
 *
 * `steps_done` is emptied and `finished_at` cleared, so an erasure asked for a
 * second time genuinely runs a second time. The alternative, treating a
 * finished record as "nothing to do", would make a re-erasure a silent no-op
 * over any trace that appeared since, and "we already did that" is the one
 * answer a deletion request must never be given by accident.
 *
 * `started_at` is NOT reset, and neither is it on a resume. The age of the
 * obligation is the age of the FIRST attempt, for the reason
 * `subject_refs.erasure_pending_since` is never moved forward: a number that
 * resets whenever somebody tries never grows old enough to escalate.
 *
 * `identity` is who the member is as this attempt starts, or null when the row
 * it read is already a tombstone. Null never overwrites: an erasure asked
 * again of a tombstone whose first sweep stopped keeps the name and address
 * that first attempt held, which is the only place they still exist.
 */
export async function beginErasure(pool: Pool, userId: string, identity: ErasedIdentity | null = null): Promise<void> {
  const held = identityParam(identity);
  await pool.query(
    "INSERT INTO `member_erasures` (`user_id`, `attempts`, `last_attempt_at`, `steps_done`, `erased_identity`) " +
      "VALUES (?, 1, CURRENT_TIMESTAMP, JSON_ARRAY(), ?) " +
      "ON DUPLICATE KEY UPDATE `attempts` = `attempts` + 1, `last_attempt_at` = CURRENT_TIMESTAMP, " +
      "`finished_at` = NULL, `steps_done` = JSON_ARRAY(), `failed_step` = NULL, `last_error` = NULL, " +
      "`erased_identity` = COALESCE(?, `erased_identity`)",
    [userId, held, held],
  );
}

/**
 * Open the record for a RESUME: `steps_done` survives, so finished steps are
 * skipped.
 *
 * The INSERT half is not dead code. A member whose erasure predates this table
 * has no row, and a resume asked about them should run the whole sweep rather
 * than refuse, which is exactly what an empty `steps_done` produces.
 *
 * `restart` empties `steps_done` instead, for a sweep that never reached the
 * tombstone: until then the member could still write, so nothing recorded
 * proves a step's work is still done, and the resume runs them all again
 * (`resumeErasure`). Emptied here so the record says what THIS attempt did.
 *
 * `identity` follows the rule `beginErasure` states: written from a row that is
 * not a tombstone, and null keeps what is held.
 */
export async function noteResumeAttempt(
  pool: Pool,
  userId: string,
  opts: { restart?: boolean; identity?: ErasedIdentity | null } = {},
): Promise<void> {
  const held = identityParam(opts.identity);
  await pool.query(
    "INSERT INTO `member_erasures` (`user_id`, `attempts`, `last_attempt_at`, `steps_done`, `erased_identity`) " +
      "VALUES (?, 1, CURRENT_TIMESTAMP, JSON_ARRAY(), ?) " +
      "ON DUPLICATE KEY UPDATE `attempts` = `attempts` + 1, `last_attempt_at` = CURRENT_TIMESTAMP, " +
      "`failed_step` = NULL, `last_error` = NULL, `erased_identity` = COALESCE(?, `erased_identity`)" +
      (opts.restart ? ", `steps_done` = JSON_ARRAY()" : ""),
    [userId, held, held],
  );
}

/**
 * Who this open erasure is for, or null when nothing is held.
 *
 * The only reader of `erased_identity`, and the sweep its only caller. Read
 * tolerantly for the reason `readSteps` gives: MySQL hands a json column back
 * parsed and MariaDB as a string.
 */
export async function erasedIdentity(pool: Pool, userId: string): Promise<ErasedIdentity | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `erased_identity` FROM `member_erasures` WHERE `user_id` = ? AND `finished_at` IS NULL LIMIT 1",
    [userId],
  );
  let v: unknown = rows[0]?.erased_identity ?? null;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const email = String(o.email ?? "");
  if (!email) return null;
  return { name: String(o.name ?? ""), email, handle: o.handle == null ? null : String(o.handle) };
}

/**
 * Record that one step landed.
 *
 * `JSON_ARRAY_APPEND` rather than read-modify-write, so two runs racing over
 * one member cannot lose each other's progress. Losing a note is safe (the
 * step re-runs) but losing it silently and repeatedly would make the record
 * useless as a report, which is the other half of what it is for.
 */
export async function noteStepDone(pool: Pool, userId: string, step: string): Promise<void> {
  await pool.query(
    "UPDATE `member_erasures` SET `steps_done` = JSON_ARRAY_APPEND(COALESCE(`steps_done`, JSON_ARRAY()), '$', ?) " +
      "WHERE `user_id` = ?",
    [step, userId],
  );
}

/**
 * The local sweep completed. The failure fields go with it, and so does who it
 * was for: in the same statement, so no finished record ever holds a name.
 *
 * The second statement clears any OTHER finished record still holding one.
 * Nothing in this release leaves one, but an image from before 0282 put back
 * over a migrated database finishes sweeps without knowing the column exists,
 * and this is where the first finish after it comes forward takes them.
 */
export async function noteErasureFinished(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    "UPDATE `member_erasures` SET `finished_at` = CURRENT_TIMESTAMP, `failed_step` = NULL, `last_error` = NULL, " +
      "`erased_identity` = NULL WHERE `user_id` = ?",
    [userId],
  );
  await pool.query(
    "UPDATE `member_erasures` SET `erased_identity` = NULL WHERE `finished_at` IS NOT NULL AND `erased_identity` IS NOT NULL",
  );
}

/**
 * Every member a FINISHED erasure was for, for the backfill that gives a
 * finished record the steps it predates (`backfillFinishedErasure`,
 * server/lib/erasure.ts).
 *
 * Two kinds: a record whose sweep finished, and a tombstone with no record at
 * all, which is an erasure from before this table (0195). An open record is
 * left out on purpose: the queue and the hourly job finish those, and a resume
 * already runs every step a record lacks. Example rows are left out too. Ids
 * only, finished records first and oldest first; the sweep reads each member
 * itself.
 *
 * Three reads joined here, never one statement across the two tables: their
 * id columns are not promised one collation on every village's database
 * (server/db/collation.ts), and comparing them in SQL is how a fork's boot
 * would learn that.
 */
export async function finishedErasureSubjects(pool: Pool): Promise<string[]> {
  const [finished] = await pool.query<RowDataPacket[]>(
    "SELECT `user_id` FROM `member_erasures` WHERE `finished_at` IS NOT NULL ORDER BY `finished_at`, `user_id`",
  );
  const [recorded] = await pool.query<RowDataPacket[]>("SELECT `user_id` FROM `member_erasures`");
  const [tombstones] = await pool.query<RowDataPacket[]>(
    "SELECT `id` FROM `users` WHERE LOWER(`email`) LIKE '%@anonymized.invalid' AND COALESCE(`is_example`, 0) = 0 ORDER BY `id`",
  );
  const hasRecord = new Set(recorded.map((r) => String(r.user_id)));
  return [
    ...finished.map((r) => String(r.user_id)),
    ...tombstones.map((r) => String(r.id)).filter((id) => !hasRecord.has(id)),
  ];
}

/**
 * Give a tombstone that has no record a FINISHED one, so the backfill can
 * write down what it ran the way every other erasure does, and a second run
 * reads it as done.
 *
 * No attempts and no attempt time: no sweep of this table's ever ran for the
 * member, and the record says so. `started_at` takes the moment it was
 * written, because the column cannot be empty and the first attempt's date is
 * not known. `INSERT IGNORE`, so a record that exists already is never touched.
 */
export async function openBackfillRecord(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    "INSERT IGNORE INTO `member_erasures` (`user_id`, `attempts`, `last_attempt_at`, `steps_done`, `finished_at`) " +
      "VALUES (?, 0, NULL, JSON_ARRAY(), CURRENT_TIMESTAMP)",
    [userId],
  );
}

/**
 * Record one step the backfill ran, on a record that is STILL finished.
 *
 * `finished_at` is not touched: the sweep finished when it did, and a step
 * given afterwards does not move that. A record a new erasure opened in the
 * meantime takes no note, because the fresh sweep runs every step itself and
 * a note here would let a resume of it skip a step on the strength of a run
 * that was not that sweep's.
 */
export async function noteBackfilledStep(pool: Pool, userId: string, step: string): Promise<boolean> {
  const [res] = await pool.query(
    "UPDATE `member_erasures` SET `steps_done` = JSON_ARRAY_APPEND(COALESCE(`steps_done`, JSON_ARRAY()), '$', ?) " +
      "WHERE `user_id` = ? AND `finished_at` IS NOT NULL",
    [step, userId],
  );
  return Number((res as { affectedRows?: number }).affectedRows ?? 0) === 1;
}

/** Which step stopped, and what it said. Clipped, never truncated by the engine. */
export async function noteErasureFailed(
  pool: Pool,
  userId: string,
  step: string,
  detail: string,
): Promise<void> {
  await pool.query(
    "UPDATE `member_erasures` SET `failed_step` = ?, `last_error` = ? WHERE `user_id` = ?",
    [step.slice(0, 64), detail.slice(0, MAX_ERROR), userId],
  );
}

/** One member's record, or null when nothing has ever erased them. */
export async function erasureRecord(pool: Pool, userId: string): Promise<ErasureRecord | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`member_erasures\` WHERE \`user_id\` = ? LIMIT 1`,
    [userId],
  );
  return rows[0] ? rowToRecord(rows[0]) : null;
}

/**
 * HOW MANY sweeps are outstanding, counted in the database.
 *
 * Separate from the read below, and not `rows.length` off it, because that
 * read is capped. A village with more stalled sweeps than one page would have
 * been told the page size, and a number that silently stops rising at 200 is
 * the shape of metric this repository keeps having to apologise for.
 */
export async function countUnfinishedErasures(pool: Pool): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `member_erasures` WHERE `finished_at` IS NULL",
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Every sweep that started and did not finish, oldest obligation first.
 *
 * The whole row, because the queue's job is to hand a steward a name to press
 * and a sentence to read. A count alone is a dashboard.
 *
 * CAPPED, so one press does bounded work. `countUnfinishedErasures` above is
 * the honest total.
 */
export async function unfinishedErasures(pool: Pool, limit = 200): Promise<ErasureRecord[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`member_erasures\` WHERE \`finished_at\` IS NULL ` +
      "ORDER BY `started_at`, `user_id` LIMIT ?",
    [Math.max(1, Math.min(1000, Math.trunc(limit)))],
  );
  return rows.map(rowToRecord);
}

/**
 * The unfinished sweeps with how long it has been since each last attempt, for
 * the failed-actions job.
 *
 * The age is computed HERE, in SQL, and not from `lastAttemptAt` in JavaScript:
 * `last_attempt_at` is written with CURRENT_TIMESTAMP, and although the app's
 * pool pins UTC (server/db/pool.ts), a test suite's pool does not, and there a
 * TIMESTAMP read into a Date shifts by the host's offset, so a backoff built on
 * it would fire hours early or late. Which of these the job may resume without a
 * person is the job's decision, and it is made on `stepsDone`, not here.
 */
export async function unfinishedErasuresWithAge(
  pool: Pool,
  limit = 500,
): Promise<Array<ErasureRecord & { sinceLastAttemptSeconds: number | null; sinceStartSeconds: number | null }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS}, TIMESTAMPDIFF(SECOND, \`last_attempt_at\`, CURRENT_TIMESTAMP) AS since_s, ` +
      "TIMESTAMPDIFF(SECOND, `started_at`, CURRENT_TIMESTAMP) AS started_s " +
      "FROM `member_erasures` WHERE `finished_at` IS NULL ORDER BY `started_at`, `user_id` LIMIT ?",
    [Math.max(1, Math.min(1000, Math.trunc(limit)))],
  );
  return rows.map((r) => ({
    ...rowToRecord(r),
    sinceLastAttemptSeconds: r.since_s == null ? null : Math.max(0, Number(r.since_s)),
    sinceStartSeconds: r.started_s == null ? null : Math.max(0, Number(r.started_s)),
  }));
}

/**
 * Claim one unfinished sweep for an unattended resume, or learn that it is not
 * this caller's to run.
 *
 * The failed-actions job decides from a snapshot taken when its run starts, and
 * a steward can press Finish them on /review in between. The conditional UPDATE
 * is the lock: it moves `last_attempt_at` only while the sweep is unfinished and
 * its last attempt is at least `backoffSeconds` old, so a sweep somebody just
 * attempted changes no row here, and the job walks away from it.
 */
export async function claimResume(pool: Pool, userId: string, backoffSeconds: number): Promise<boolean> {
  const [result] = await pool.query(
    "UPDATE `member_erasures` SET `last_attempt_at` = CURRENT_TIMESTAMP WHERE `user_id` = ? AND `finished_at` IS NULL " +
      "AND (`last_attempt_at` IS NULL OR `last_attempt_at` <= CURRENT_TIMESTAMP - INTERVAL ? SECOND)",
    [userId, Math.max(0, Math.trunc(backoffSeconds))],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) === 1;
}
