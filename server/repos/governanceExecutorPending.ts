/**
 * `governance_executor_pending`: the durable trace of every attempt to land a
 * decision, including the ones that died halfway.
 *
 * ── THIS MODULE IS THE WHOLE TABLE ─────────────────────────────────────────
 *
 * Unusually for this wave, that claim is exact rather than aspirational.
 * `server/lib/applyDue.ts` was the only production file in the tree that named
 * this table, so every statement against it is in this file and the question
 * "who writes this table" has one answer with nothing left over. Keep it that
 * way: a second writer somewhere else turns a small, checkable table into the
 * kind nobody can reason about, and the one thing this table is for is being
 * readable by a human at three in the morning.
 *
 * ── ONE ROW PER ATTEMPT, AND THE UPSERT THAT USED TO BE HERE ───────────────
 *
 * The table keys on its own id for a recorded reason. It used to key on the
 * ballot and upsert, so a second attempt OVERWROTE the failure the table exists
 * to record: the row that said "this threw, here is what it said" became a row
 * that said "this is running", and the only trace of why the first run died was
 * a counter. `attempts` still counts, and it is counted off the rows that came
 * before rather than incremented in place, which is why `attemptCount` exists
 * as its own read.
 *
 * That read and the insert under it are NOT one transaction and are not meant
 * to be. Two executors arriving at one ballot in the same second is already
 * impossible — the claim UPDATE in `server/repos/ballotLandings.ts` elects
 * exactly one of them before either gets here — and wrapping these two in a
 * transaction would buy nothing and cost the property that makes this table
 * useful, which is that a row appears the moment an attempt starts rather than
 * when it finishes.
 *
 * ── `ORDER BY id DESC LIMIT 1` IS THE NEWEST ATTEMPT, NOT ANY ATTEMPT ──────
 *
 * Both writes below close or annotate the NEWEST still-open row on a ballot.
 * Without the order they would reach whichever row the database handed back,
 * which on a ballot that has failed twice is as likely to be the older failure
 * as the running attempt, and clearing the older one would report a landing
 * that never happened while leaving the live attempt open forever.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ─────────────────────────────────────────
 *
 * Nothing to invalidate. Every read goes to the database when it is asked,
 * which is the only honest behaviour for a table whose whole job is to say
 * what is happening RIGHT NOW.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { sqlInstant } from "./ballotLandings";

/**
 * How many attempts this ballot has already had.
 *
 * Every row, cleared or not: the number the next attempt records is how many
 * came before it, and a run that succeeded is still a run that happened.
 */
export async function attemptCount(pool: Pool, ballotId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM governance_executor_pending WHERE ballot_id = ?",
    [ballotId],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Open an attempt.
 *
 * `claimedAt` is a UTC instant from Node and NEVER `NOW()`. `sqlInstant` in
 * `server/repos/ballotLandings.ts` carries that warning and the reason for it:
 * `NOW()` is the DATABASE server's local time, and mixing the two put
 * `claimed_at` seven hours below the bound on a developer box at UTC-7, so the
 * claim query always matched and the defect was invisible there while failing
 * on a UTC runner.
 */
export async function insertAttempt(
  pool: Pool,
  input: { ballotId: string; claimedAt: Date; attempts: number },
): Promise<void> {
  await pool.query("INSERT INTO governance_executor_pending (ballot_id, claimed_at, attempts) VALUES (?, ?, ?)", [
    input.ballotId,
    sqlInstant(input.claimedAt),
    input.attempts,
  ]);
}

/**
 * Write what went wrong onto the newest open attempt, and leave it OPEN.
 *
 * An annotated attempt is not a closed one. The row staying open is what puts
 * the ballot in `unclearedBallotIds` afterwards, which is the list a human
 * actually looks at; closing it here would file the failure somewhere nobody
 * reads.
 */
export async function annotateNewestOpenAttempt(pool: Pool, ballotId: string, error: string): Promise<void> {
  await pool.query(
    "UPDATE governance_executor_pending SET last_error = ? WHERE ballot_id = ? AND cleared_at IS NULL " +
      "ORDER BY id DESC LIMIT 1",
    [error, ballotId],
  );
}

/**
 * Close the newest open attempt, and clear the error with it.
 *
 * `last_error = NULL` on the same statement: a row that reached the end carries
 * no error, and leaving the previous attempt's message on a successful row
 * would make the table read as a permanent failure that had already been fixed.
 */
export async function closeNewestOpenAttempt(pool: Pool, ballotId: string, clearedAt: Date): Promise<void> {
  await pool.query(
    "UPDATE governance_executor_pending SET cleared_at = ?, last_error = NULL WHERE ballot_id = ? " +
      "AND cleared_at IS NULL ORDER BY id DESC LIMIT 1",
    [sqlInstant(clearedAt), ballotId],
  );
}

/**
 * Decisions that started landing and never finished.
 *
 * `<=` AND NOT `<`. `claimed_at` is a TIMESTAMP, so it holds whole seconds.
 * With a bound of "now" the bound IS the claim instant, and a strict comparison
 * asks `x < x` and answers empty: the row that was just claimed is the one row
 * this query could not see, which is the opposite of what it is for.
 */
export async function unclearedBallotIds(pool: Pool, claimedAtOrBefore: Date): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT ballot_id FROM governance_executor_pending WHERE cleared_at IS NULL AND claimed_at <= ? " +
      "ORDER BY ballot_id",
    [sqlInstant(claimedAtOrBefore)],
  );
  return rows.map((r) => String(r.ballot_id));
}
