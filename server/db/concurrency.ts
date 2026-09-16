/**
 * Did this transaction lose a concurrency race, so that running the WHOLE
 * transaction again is the honest response?
 *
 * ONE ANSWER, BECAUSE THERE WERE FIVE. `postTransfer`, `postTransferPair`,
 * `writeGratitudeRow` (twice: the retry and the member's sentence) and the
 * quest repository's `withDeadlockRetry` each spelled the same two codes out
 * by hand. When the database engine grew a third way to say "you lost a race",
 * all five were blind to it at once, and the next engine difference would have
 * cost five edits again. It costs one now: the list below.
 *
 * ── WHAT IS ON THE LIST, AND WHY EACH ONE IS SAFE TO RETRY ──────────────────
 *
 *   ER_LOCK_DEADLOCK      (1213) InnoDB chose this transaction as a deadlock
 *                         victim and rolled all of it back.
 *
 *   ER_LOCK_WAIT_TIMEOUT  (1205) a lock was not granted in time. With
 *                         `innodb_rollback_on_timeout` OFF, which is the
 *                         default on both MySQL 8 and MariaDB and was measured
 *                         0 on the local MariaDB 12.3.2, the engine rolls back
 *                         only the STATEMENT, and the transaction stays open.
 *                         So this predicate is a promise only to a caller that
 *                         rolls back the transaction itself before it tries
 *                         again. Every caller today does.
 *
 *   ER_CHECKREAD          (1020) "Record has changed since last read ... try
 *                         restarting transaction". MariaDB's snapshot
 *                         isolation: a locking read or a write reached a row
 *                         that another transaction committed after this one's
 *                         read view was taken. `innodb_snapshot_isolation` is
 *                         ON by default since MariaDB 11.8. MySQL 8, which CI
 *                         runs, never raises it, so CI stayed green while 21
 *                         of 24 concurrent gives failed on MariaDB 12.3.2
 *                         (measured 2026-09-14). The engine rolls the whole
 *                         transaction back: measured the same day, a row
 *                         inserted before the conflict was gone afterwards and
 *                         `@@in_transaction` read 0.
 *
 * A retry reruns every read, so it decides again against the world as it is
 * now. It is never a replay of a stale decision.
 *
 * ── WHAT IS NOT ON IT ──────────────────────────────────────────────────────
 *
 * `ER_DUP_ENTRY` is a unique index answering a question about the data, and
 * each caller decides what that answer means (a replay, a collision, a second
 * tap). A dropped connection is not here either: whether the commit reached
 * the server before the socket died is unknown, so a blind retry could
 * double-post anything not keyed.
 *
 * Matched on mysql2's `code`, the same field every caller already read, and
 * the only field a test that injects a failure has to set.
 */
export const LOST_RACE_CODES: readonly string[] = Object.freeze([
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
  "ER_CHECKREAD",
]);

/** True when `err` says this transaction lost a race, and may be run again. */
export function lostConcurrencyRace(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && LOST_RACE_CODES.includes(code);
}
