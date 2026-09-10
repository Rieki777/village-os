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

const COLUMNS =
  "`user_id`, `started_at`, `finished_at`, `attempts`, `last_attempt_at`, " +
  "`steps_done`, `failed_step`, `last_error`";

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
 */
export async function beginErasure(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    "INSERT INTO `member_erasures` (`user_id`, `attempts`, `last_attempt_at`, `steps_done`) " +
      "VALUES (?, 1, CURRENT_TIMESTAMP, JSON_ARRAY()) " +
      "ON DUPLICATE KEY UPDATE `attempts` = `attempts` + 1, `last_attempt_at` = CURRENT_TIMESTAMP, " +
      "`finished_at` = NULL, `steps_done` = JSON_ARRAY(), `failed_step` = NULL, `last_error` = NULL",
    [userId],
  );
}

/**
 * Open the record for a RESUME: `steps_done` survives, so finished steps are
 * skipped.
 *
 * The INSERT half is not dead code. A member whose erasure predates this table
 * has no row, and a resume asked about them should run the whole sweep rather
 * than refuse, which is exactly what an empty `steps_done` produces.
 */
export async function noteResumeAttempt(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    "INSERT INTO `member_erasures` (`user_id`, `attempts`, `last_attempt_at`, `steps_done`) " +
      "VALUES (?, 1, CURRENT_TIMESTAMP, JSON_ARRAY()) " +
      "ON DUPLICATE KEY UPDATE `attempts` = `attempts` + 1, `last_attempt_at` = CURRENT_TIMESTAMP, " +
      "`failed_step` = NULL, `last_error` = NULL",
    [userId],
  );
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

/** The local sweep completed. The failure fields go with it. */
export async function noteErasureFinished(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    "UPDATE `member_erasures` SET `finished_at` = CURRENT_TIMESTAMP, `failed_step` = NULL, `last_error` = NULL " +
      "WHERE `user_id` = ?",
    [userId],
  );
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
