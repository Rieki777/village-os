/**
 * The migration engine, extracted from scripts/run-migration.ts (S5) so the
 * CLI, the test harness, and CI all run EXACTLY the same code path. Numbered
 * .sql files in drizzle/, a `_migrations_applied` table as the ledger,
 * discovery from disk.
 *
 * Every connection here sets `timezone: 'Z'` (plan rule 2.3): this machine is
 * UTC-6, mysql2's default is 'local', and a timestamp written through a local
 * connection then read through a Z one shifts every lunar boundary six hours.
 * It also pins the MySQL SESSION zone, because `timezone: 'Z'` governs only
 * how the driver renders Dates — NOW() answers to the session.
 *
 * A SHIPPED MIGRATION FILE IS NEVER EDITED. That was always convention; it is
 * now structural. A file that fails half-way records how many statements
 * succeeded and RESUMES there on the next boot instead of replaying DDL that
 * already ran. Reordering, inserting or removing statements in a file that
 * has been partially applied anywhere therefore resumes at the wrong offset
 * and skips the wrong statements. Fix a shipped migration with a NEW numbered
 * file, always.
 *
 * TWO GUARDS ADDED ON TOP OF THAT (0121), both because the convention above
 * turned out to be an honor system with nothing checking it:
 *
 *  - A CHECKSUM. Every row `applyPending` writes now carries a sha256 of the
 *    exact bytes it ran. On every boot, before running anything pending, it
 *    reads each already-applied file back off disk and refuses if the hash
 *    has moved. Nullable, and a NULL is never read as a mismatch: every row
 *    written before 0121 has nothing true to compare against, so it is
 *    backfilled with the current on-disk bytes instead (see
 *    `verifyAndBackfillChecksums`), which protects going forward without
 *    pretending it protected the past.
 *  - A NAMED LOCK. `applyPending` reads the ledger, then writes to it, with
 *    no transaction wrapping the whole run (DDL is not transactional in
 *    MySQL regardless). Two containers booting at the same moment would
 *    otherwise both see the same file as pending and both start running its
 *    statements, and `_migrations_partial`'s offset only has room for one
 *    truth: connection A records "3 of 12 done" while connection B is mid
 *    statement 4, and the next boot resumes at 3 on a table that is actually
 *    further along, replaying DDL that already ran. `GET_LOCK`/`RELEASE_LOCK`
 *    around the whole function serializes that instead of leaving it to luck.
 *
 * A THIRD (batch 74, 2026-11-01): EVERY STATEMENT'S LOCK WAIT IS CAPPED. A
 * migration runs while the previous deployment is still serving the same
 * database, and any DDL, INSTANT included, needs an exclusive metadata lock on
 * its table for a moment. The server default for that wait is one year on
 * MySQL 8. One open transaction that has touched the table makes the ALTER
 * wait, and every later query on that table, from BOTH servers, queues behind
 * the ALTER's pending exclusive request. That froze Amora for fifteen minutes.
 * `applyPending` now sets `lock_wait_timeout` and `innodb_lock_wait_timeout`
 * on its own connection (see MIGRATION_LOCK_WAIT_SECONDS), retries a timed-out
 * statement a bounded number of times, and otherwise fails the boot naming the
 * file, the statement and the lock, with the resume offset still correct.
 */
import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import mysql from "mysql2/promise";

export const MIGRATIONS_DIR = path.resolve(process.cwd(), "drizzle");

/**
 * How long `applyPending` waits to take the migration lock before giving up.
 * Matches the template-build lock's own timeout in server/db/testDb.ts
 * (600s): both are real DDL against a database that may already be busy, not
 * a quick operation that should time out fast.
 */
export const MIGRATION_LOCK_TIMEOUT_SECONDS = 600;

/**
 * HOW LONG ONE MIGRATION STATEMENT MAY WAIT FOR A LOCK: 10 SECONDS.
 *
 * Unrelated to MIGRATION_LOCK_TIMEOUT_SECONDS above, which is the runner's own
 * GET_LOCK against another booting container. This one is the TABLE's lock,
 * and it is set as both `lock_wait_timeout` (metadata locks, which every DDL
 * statement takes) and `innodb_lock_wait_timeout` (row locks, which a backfill
 * UPDATE takes), on the migration connection only, for the length of the run.
 *
 * The number is a trade between two costs, and both sides are measured here:
 *
 *  - TOO SHORT and a normal deploy fails on a brief, harmless lock. What holds
 *    a lock on a table in this app is an autocommit query (milliseconds) or a
 *    short app transaction such as a ledger posting (well under a second). Ten
 *    seconds is more than ten times the longest of those.
 *  - TOO LONG and the old server stalls for all of it. While the ALTER waits,
 *    every new query on that table queues behind it, and the app's pool has
 *    eight connections (server/db/pool.ts), so a handful of signed-in requests
 *    on `users` is every connection, and the whole old server waits the full
 *    timeout. Ten seconds reads as a slow page to a member; thirty starts to
 *    read as the site being down.
 *
 * A wait that ends in a timeout is retried (MIGRATION_LOCK_WAIT_ATTEMPTS), with
 * a pause between attempts in which the old server's queued requests run and
 * the long transaction gets the chance to finish. A statement that only needed
 * the lock is safe to retry: every migration statement runs in autocommit (no
 * file opens a transaction), so one that timed out changed nothing. Worst case
 * for a whole boot is `worstCaseLockWaitSeconds()`, held under a quarter of
 * railway.toml's healthcheckTimeout by server/db/migrateLockWait.test.ts.
 */
export const MIGRATION_LOCK_WAIT_SECONDS = 10;
/** Attempts per statement when the wait times out, the first included. */
export const MIGRATION_LOCK_WAIT_ATTEMPTS = 3;
/** Pause before each retry, in ms; the last entry repeats. */
export const MIGRATION_LOCK_WAIT_BACKOFF_MS: readonly number[] = [5_000, 15_000];
/**
 * Retries across ONE whole run, every file and statement together. Without it
 * the bound would grow with the number of statements: twenty statements that
 * each time out once would cost twenty waits and twenty pauses.
 */
export const MIGRATION_LOCK_WAIT_RETRY_BUDGET = 4;

/** Overrides for the lock-wait cap. Tests pass short values; production passes nothing. */
export interface LockWaitOptions {
  timeoutSeconds?: number;
  attempts?: number;
  backoffMs?: readonly number[];
  retryBudget?: number;
}

interface ResolvedLockWait {
  timeoutSeconds: number;
  attempts: number;
  backoffMs: readonly number[];
  retryBudget: number;
}

function resolveLockWait(o: LockWaitOptions = {}): ResolvedLockWait {
  const r: ResolvedLockWait = {
    timeoutSeconds: o.timeoutSeconds ?? MIGRATION_LOCK_WAIT_SECONDS,
    attempts: o.attempts ?? MIGRATION_LOCK_WAIT_ATTEMPTS,
    backoffMs: o.backoffMs ?? MIGRATION_LOCK_WAIT_BACKOFF_MS,
    retryBudget: o.retryBudget ?? MIGRATION_LOCK_WAIT_RETRY_BUDGET,
  };
  // Both server variables take whole seconds, minimum 1. The value is also
  // interpolated into a SET, so it must be exactly an integer.
  if (!Number.isInteger(r.timeoutSeconds) || r.timeoutSeconds < 1) {
    throw new Error(`lock wait timeout must be a whole number of seconds, at least 1 (got ${r.timeoutSeconds})`);
  }
  if (!Number.isInteger(r.attempts) || r.attempts < 1) throw new Error(`lock wait attempts must be at least 1 (got ${r.attempts})`);
  if (!Number.isInteger(r.retryBudget) || r.retryBudget < 0) throw new Error(`lock wait retry budget must be 0 or more (got ${r.retryBudget})`);
  return r;
}

/**
 * The longest one run can spend on lock waits that END IN A TIMEOUT, pauses
 * included: every retry the budget allows, each after a full wait and the
 * longest pause, plus the final wait that fails the boot. A statement that
 * waits and then GETS its lock is outside this figure, since that wait ended
 * because the lock came free.
 */
export function worstCaseLockWaitSeconds(o: LockWaitOptions = {}): number {
  const r = resolveLockWait(o);
  const retries = r.attempts > 1 ? r.retryBudget : 0;
  const longestPause = Math.max(0, ...r.backoffMs) / 1000;
  return (retries + 1) * r.timeoutSeconds + retries * longestPause;
}

/** MySQL and MariaDB both report a lock wait that ran out as 1205, and a deadlock victim as 1213. */
function lockConflictOf(err: any): "lock-wait-timeout" | "deadlock" | null {
  const errno = Number(err?.errno);
  if (errno === 1205 || err?.code === "ER_LOCK_WAIT_TIMEOUT") return "lock-wait-timeout";
  if (errno === 1213 || err?.code === "ER_LOCK_DEADLOCK") return "deadlock";
  return null;
}

/** A schema change waits on the table's metadata lock; a data change, on row locks. */
function isDdl(statement: string): boolean {
  return /^\s*(ALTER|CREATE|DROP|RENAME|TRUNCATE|OPTIMIZE)\b/i.test(statement);
}

/** One line of the statement for a log or an error: the SQL is public, and 160 characters names it. */
function statementHead(statement: string): string {
  const flat = statement.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 160)}...` : flat;
}

/**
 * Cap this connection's lock waits for the run, and return how to put back
 * what it had. Restoring matters for the test harness, which hands its own
 * connection in and keeps using it; the boot and the CLI close theirs anyway.
 */
async function capLockWaits(conn: mysql.Connection, seconds: number): Promise<() => Promise<void>> {
  const [[prev]] = await conn.query<any[]>(
    "SELECT @@SESSION.lock_wait_timeout AS lwt, @@SESSION.innodb_lock_wait_timeout AS ilwt",
  );
  await conn.query(`SET SESSION lock_wait_timeout = ${seconds}`);
  await conn.query(`SET SESSION innodb_lock_wait_timeout = ${seconds}`);
  return async () => {
    try {
      const lwt = Number(prev?.lwt);
      const ilwt = Number(prev?.ilwt);
      if (Number.isInteger(lwt) && lwt > 0) await conn.query(`SET SESSION lock_wait_timeout = ${lwt}`);
      if (Number.isInteger(ilwt) && ilwt > 0) await conn.query(`SET SESSION innodb_lock_wait_timeout = ${ilwt}`);
    } catch {
      // Cleanup, like releaseMigrationLock below: never the error to fail a boot over.
    }
  };
}

export function discoverMigrations(dir: string = MIGRATIONS_DIR): string[] {
  /*
   * An empty list is not a safe answer here, it is a vacuous one. Two things
   * downstream treat this list as a positive statement: `migrationsFingerprint`
   * hashes it, so two different empty sets hash identically and a template
   * built from nothing is indistinguishable from one built from the real set;
   * and `templateIsReady` ends in `files.every(...)`, and `[].every(...)` is
   * true, so an empty schema reports as ready and gets cloned into every
   * database-backed suite. MIGRATIONS_DIR is resolved from process.cwd(), so
   * "the directory is missing" means "you started this process somewhere
   * unexpected", which is worth a sentence rather than a silent [].
   */
  if (!fs.existsSync(dir)) {
    throw new Error(
      `no migrations directory at ${dir} (resolved from cwd ${process.cwd()}). ` +
        `An empty migration set is not a valid state: it fingerprints the same as ` +
        `every other empty set and reports an empty schema as ready.`,
    );
  }
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}.*\.sql$/.test(f))
    .sort();
}

/**
 * Split on semicolons at end of line, stripping leading comment lines from
 * each chunk (NOT discarding chunks that start with a comment — the bug the
 * first version of the runner had, which silently skipped statements).
 */
export function splitStatements(sql: string): string[] {
  // Strip comment lines BEFORE splitting on statement-final semicolons: a
  // comment that happens to end in ';' must never cut a statement in half
  // (0015 learned this the hard way — "…live in game_variables;\n").
  const withoutComments = sql
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  return withoutComments
    .split(/;\s*$/m)
    .map((chunk) => chunk.trim())
    .filter((s) => s.length > 0);
}

export async function connect(url: string): Promise<mysql.Connection> {
  const conn = await mysql.createConnection({ uri: url, multipleStatements: false, timezone: "Z" });
  // The driver's `timezone: 'Z'` only governs how Dates are rendered and
  // parsed; NOW()/CURRENT_TIMESTAMP evaluate in the MySQL SESSION zone. Pin
  // it here too, or a migration's DEFAULT CURRENT_TIMESTAMP writes in one
  // frame and the app reads in another. Numeric offset, never 'UTC' — that
  // name throws on servers without the timezone tables loaded.
  await conn.query("SET time_zone = '+00:00'");
  return conn;
}

/** sha256 of a file's exact on-disk bytes, hex encoded (64 chars: the width of the `checksum` column 0121 adds). */
export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * Whether THIS database has run 0121 (the migration that adds `checksum`)
 * yet. Checked fresh every time it is asked, never cached: a village that is
 * many migrations behind can apply 0121 itself partway through one boot, and
 * every file after it in that same run needs the answer to flip from false
 * to true without waiting for a second boot.
 */
async function hasChecksumColumn(conn: mysql.Connection): Promise<boolean> {
  const [rows] = await conn.query<any[]>(
    "SELECT 1 AS x FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() " +
      "AND TABLE_NAME = '_migrations_applied' AND COLUMN_NAME = 'checksum'",
  );
  return (rows as any[]).length > 0;
}

async function currentDatabaseName(conn: mysql.Connection): Promise<string> {
  const [[row]] = await conn.query<any[]>("SELECT DATABASE() AS db");
  return row?.db ? String(row.db) : "unknown";
}

/**
 * MySQL's `GET_LOCK`/`RELEASE_LOCK` namespace is server wide, not per
 * database, so the lock name is built from the current database and given a
 * prefix distinct from server/db/testDb.ts's own use of the same primitive.
 * That file's `buildTemplate` holds `GET_LOCK(schema, 600)` on an admin
 * connection and then calls `applyPending` on a SECOND connection to that
 * same schema; a bare-schema-name lock here would make this function wait on
 * a lock its own caller already holds, from a different connection, on
 * purpose, which is a self deadlock rather than the contention this exists
 * to serialize.
 */
async function acquireMigrationLock(conn: mysql.Connection, name: string, timeoutSeconds: number): Promise<boolean> {
  const [[row]] = await conn.query<any[]>("SELECT GET_LOCK(?, ?) AS ok", [name, timeoutSeconds]);
  return Number(row?.ok) === 1;
}

async function releaseMigrationLock(conn: mysql.Connection, name: string): Promise<void> {
  try {
    await conn.query("SELECT RELEASE_LOCK(?)", [name]);
  } catch {
    // Cleanup, not a result. A connection that is about to be closed anyway
    // (the normal case: callers `conn.end()` right after) drops its locks on
    // disconnect regardless, and a failed release is never the interesting
    // error to fail a boot over.
  }
}

export type ApplyFailureDetail =
  | {
      kind: "migration-failed";
      file: string;
      statementIndex: number;
      statementsTotal: number;
      message: string;
      /**
       * Set when the statement gave up waiting for a lock (or lost a deadlock)
       * on every attempt. The SQL is fine and the fix is a redeploy once the
       * other transaction is gone; `message` says so in words.
       */
      lockWait?: {
        kind: "lock-wait-timeout" | "deadlock";
        /** A schema change, so the wait was on the table's metadata lock; otherwise a row lock. */
        ddl: boolean;
        timeoutSeconds: number;
        attempts: number;
        statement: string;
      };
    }
  | {
      kind: "tamper-detected";
      file: string;
      message: string;
    }
  | {
      kind: "lock-timeout";
      lockName: string;
      timeoutSeconds: number;
      message: string;
    };

export interface ApplyResult {
  applied: string[];
  skipped: string[];
  failed: string | null;
  /**
   * Structured detail behind `failed`, for a caller that wants to show a
   * human something better than a concatenated string (server/db's
   * maintenance-mode page is the first one; see maintenanceMode.ts). `failed`
   * stays the field every existing caller already checks; this is always set
   * alongside it, never instead of it.
   */
  failedDetail?: ApplyFailureDetail;
}

/**
 * Read every already-applied file back off disk and compare its hash to what
 * was recorded at apply time. A NULL recorded checksum (every row written
 * before 0121, on every already-running instance, the moment this code first
 * reaches it) is never treated as a mismatch, since there is nothing true to
 * compare it to; it is backfilled with the CURRENT on-disk bytes instead.
 * That establishes a baseline as of the upgrade. It cannot catch an edit that
 * happened before this column existed, only one after.
 *
 * A file the ledger says ran but that is no longer present in `dir` is
 * skipped, not flagged: this function only has a directory listing and
 * cannot tell "removed on purpose by a fork" from "moved somewhere else",
 * so it says nothing rather than guessing. `scripts/check-migration-compat.mjs`
 * is where a deleted shipped file is caught, with git history to say so.
 */
async function verifyAndBackfillChecksums(
  conn: mysql.Connection,
  dir: string,
  rows: Array<{ filename: string; checksum: string | null }>,
  log: (line: string) => void,
): Promise<Extract<ApplyFailureDetail, { kind: "tamper-detected" }> | null> {
  let backfilled = 0;
  for (const row of rows) {
    const filename = String(row.filename);
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) continue;
    const bytes = fs.readFileSync(filePath);
    const actual = sha256Hex(bytes);
    const recorded = row.checksum ? String(row.checksum) : null;
    if (!recorded) {
      await conn.query("UPDATE `_migrations_applied` SET checksum = ? WHERE filename = ?", [actual, filename]);
      backfilled += 1;
      continue;
    }
    if (recorded !== actual) {
      return {
        kind: "tamper-detected",
        file: filename,
        message:
          `${filename} was applied here with checksum ${recorded.slice(0, 12)}... but the file on disk now ` +
          `hashes to ${actual.slice(0, 12)}.... A shipped migration must never be edited after it has run: this ` +
          `instance already ran the OLD body, the new body will never run here, and every migration after this ` +
          `one may now assume a schema this database does not actually have. Restore this file to the bytes that ` +
          `actually ran here, and make the intended change in a new numbered migration instead.`,
      };
    }
  }
  if (backfilled > 0) log(`  [db] backfilled checksum for ${backfilled} previously-applied migration(s)`);
  return null;
}

/**
 * Apply every pending migration, in filename order, recording each.
 *
 * `lockTimeoutSeconds` defaults to the production value and exists as a
 * parameter (rather than only the module constant) so a test can prove the
 * give-up path without waiting ten minutes for it: pass a small number and
 * hold the same lock name from a second connection first.
 *
 * `lockWait` overrides the per-statement lock-wait cap the same way, for the
 * same reason (see MIGRATION_LOCK_WAIT_SECONDS). Every statement runs on `conn`
 * itself, one connection and never a pool, so the cap set on it is the cap
 * every statement meets.
 */
export async function applyPending(
  conn: mysql.Connection,
  dir: string = MIGRATIONS_DIR,
  log: (line: string) => void = () => {},
  lockTimeoutSeconds: number = MIGRATION_LOCK_TIMEOUT_SECONDS,
  lockWait: LockWaitOptions = {},
): Promise<ApplyResult> {
  const lw = resolveLockWait(lockWait);
  const dbName = await currentDatabaseName(conn);
  const lockName = `village-migrate:${dbName}`.slice(0, 64);
  const gotLock = await acquireMigrationLock(conn, lockName, lockTimeoutSeconds);
  if (!gotLock) {
    const message =
      `could not take the migration lock (waited ${lockTimeoutSeconds}s for "${lockName}"). ` +
      `Another process is very likely applying migrations against this same database right now (two ` +
      `containers booting at the same moment is the usual cause), or a previous run's connection died ` +
      `without releasing it. Refusing to run migrations concurrently, so two connections cannot ` +
      `interleave statements from the same file.`;
    log(`  LOCK: ${message}`);
    return {
      applied: [],
      skipped: [],
      failed: message,
      failedDetail: { kind: "lock-timeout", lockName, timeoutSeconds: lockTimeoutSeconds, message },
    };
  }
  let restoreLockWaits: (() => Promise<void>) | null = null;
  try {
    // FIRST, before any statement can touch a table: cap how long one may wait
    // for a lock. Taken after GET_LOCK, so the runner's own lock keeps its own
    // timeout and is never shortened by this.
    restoreLockWaits = await capLockWaits(conn, lw.timeoutSeconds);
    log(
      `  lock waits: ${lw.timeoutSeconds}s per statement, ${lw.attempts} attempt(s), ` +
        `${lw.retryBudget} retries for this run`,
    );

    let retriesLeft = lw.attempts > 1 ? lw.retryBudget : 0;
    let lastAttempts = 1;
    /**
     * Run one query, and run it again if it only lost a lock: a wait that ran
     * out or a deadlock. Wraps each query on its own, so retrying a progress
     * write can never run the migration statement before it a second time.
     */
    const withLockRetry = async <T>(what: string, query: () => Promise<T>): Promise<T> => {
      for (let attempt = 1; ; attempt += 1) {
        lastAttempts = attempt;
        try {
          return await query();
        } catch (err) {
          const conflict = lockConflictOf(err);
          if (!conflict || attempt >= lw.attempts || retriesLeft <= 0) throw err;
          retriesLeft -= 1;
          const pauseMs = lw.backoffMs[Math.min(attempt - 1, lw.backoffMs.length - 1)] ?? 0;
          log(
            `  WAIT: ${what} ${
              conflict === "deadlock" ? "lost a deadlock" : `waited ${lw.timeoutSeconds}s for a lock and gave up`
            } (attempt ${attempt} of ${lw.attempts}); trying again in ${pauseMs / 1000}s`,
          );
          await new Promise((r) => setTimeout(r, pauseMs));
        }
      }
    };

    await conn.query(
      "CREATE TABLE IF NOT EXISTS `_migrations_applied` (" +
        "`filename` varchar(255) NOT NULL, " +
        "`applied_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, " +
        "PRIMARY KEY (`filename`))",
    );
    await ensurePartialLedger(conn);

    const checksumColumn = await hasChecksumColumn(conn);
    const [rows] = await conn.query<any[]>(
      checksumColumn
        ? "SELECT filename, checksum FROM `_migrations_applied`"
        : "SELECT filename FROM `_migrations_applied`",
    );
    const done = new Set(rows.map((r) => r.filename));

    if (checksumColumn) {
      const tamper = await verifyAndBackfillChecksums(conn, dir, rows as any, log);
      if (tamper) {
        log(`  TAMPER: ${tamper.message}`);
        return { applied: [], skipped: [], failed: tamper.message, failedDetail: tamper };
      }
    }

    const [partials] = await conn.query<any[]>("SELECT filename, statements_done FROM `_migrations_partial`");
    const progress = new Map<string, number>(partials.map((r) => [String(r.filename), Number(r.statements_done ?? 0)]));
    const all = discoverMigrations(dir);
    const result: ApplyResult = { applied: [], skipped: [], failed: null };
    for (const file of all) {
      if (done.has(file)) {
        result.skipped.push(file);
        continue;
      }
      const bytes = fs.readFileSync(path.join(dir, file));
      const sql = bytes.toString("utf-8");
      const parts = splitStatements(sql);
      const startAt = Math.min(progress.get(file) ?? 0, parts.length);
      log(
        startAt > 0
          ? `  RUN:  ${file} (resuming at statement ${startAt + 1} of ${parts.length})`
          : `  RUN:  ${file} (${parts.length} statements)`,
      );
      let i = startAt;
      // Which query was in flight when something threw: the statement itself,
      // or the bookkeeping after it. They leave the ledger in different states.
      let phase: "statement" | "progress" | "completion" = "statement";
      try {
        for (; i < parts.length; i += 1) {
          phase = "statement";
          await withLockRetry(`${file} statement ${i + 1} of ${parts.length}`, () => conn.query(parts[i]));
          // Record progress after EACH statement, so a failure half-way through
          // is resumable. Without this, a file that failed on statement 7 of 12
          // replayed statements 1-6 on every subsequent boot — and since those
          // are usually non-idempotent DDL, the deployment bricked permanently
          // on an error about a column that already exists. A statement that
          // THREW never reaches this line, so a timed-out statement is never
          // recorded as done: the offset stays at the last one that ran.
          phase = "progress";
          await withLockRetry(`recording ${file} statement ${i + 1} as done`, () => recordProgress(conn, file, i + 1));
        }
        phase = "completion";
        if (await hasChecksumColumn(conn)) {
          await withLockRetry(`recording ${file} as applied`, () =>
            conn.query("INSERT INTO `_migrations_applied` (filename, checksum) VALUES (?, ?)", [file, sha256Hex(bytes)]),
          );
        } else {
          await withLockRetry(`recording ${file} as applied`, () =>
            conn.query("INSERT INTO `_migrations_applied` (filename) VALUES (?)", [file]),
          );
        }
        // Completion is recorded in the ledger; the partial row has done its
        // job and would otherwise mislead a later reader.
        await withLockRetry(`clearing ${file}'s progress row`, () =>
          conn.query("DELETE FROM `_migrations_partial` WHERE filename = ?", [file]),
        );
        result.applied.push(file);
        log(`  DONE: ${file}`);
      } catch (err: any) {
        // Stop on first failure: later migrations were written against a schema
        // this one was supposed to produce.
        const statementIndex = Math.min(i + 1, parts.length);
        const conflict = lockConflictOf(err);
        let message: string = err.message;
        // Every rewritten message names the file itself; the driver's own does not.
        let namesFile = true;
        let lockWaitDetail: Extract<ApplyFailureDetail, { kind: "migration-failed" }>["lockWait"];
        if (phase === "statement" && conflict) {
          const ddl = isDdl(parts[i]);
          const head = statementHead(parts[i]);
          lockWaitDetail = { kind: conflict, ddl, timeoutSeconds: lw.timeoutSeconds, attempts: lastAttempts, statement: head };
          const what =
            conflict === "deadlock"
              ? `lost a deadlock against another connection on each of ${lastAttempts} attempt(s)`
              : `gave up waiting for ${ddl ? "the table's metadata lock" : "a row lock"} after ` +
                `${lastAttempts} attempt(s) of ${lw.timeoutSeconds}s each`;
          const spent = lastAttempts < lw.attempts ? " This boot's retry budget was already spent." : "";
          const resume =
            i === 0
              ? `No statement of this file has run, and the next boot starts it at statement 1.`
              : `${i === 1 ? "Statement 1" : `Statements 1 to ${i}`} of this file ran and ${i === 1 ? "is" : "are"} ` +
                `recorded, and the next boot resumes at statement ${i + 1}.`;
          message =
            `${file}, statement ${statementIndex} of ${parts.length}, ${what} (${err.code ?? "lock"}: ${err.message}).${spent} ` +
            `The SQL is fine. Another connection, usually a transaction left open on the same table, held ` +
            (ddl
              ? `a lock on it for the whole wait, and a schema change needs the table to itself for a moment. `
              : `the rows this statement updates for the whole wait. `) +
            `This statement changed nothing. ${resume} Redeploy to retry. If it stops here again, find the long ` +
            `transaction first (SHOW PROCESSLIST, information_schema.INNODB_TRX). Statement: ${head}`;
        } else if (phase === "progress") {
          message =
            `${file}: statement ${statementIndex} of ${parts.length} ran, and recording it as done then failed ` +
            `(${err.message}). The next boot runs statement ${statementIndex} again.`;
        } else if (phase === "completion") {
          message =
            `${file}: all ${parts.length} statements ran, and the bookkeeping after them then failed ` +
            `(${err.message}). No statement runs again: the next boot finds the file complete, or finishes recording it.`;
        } else {
          namesFile = false;
        }
        result.failed = namesFile ? message : `${file}: ${message}`;
        result.failedDetail = {
          kind: "migration-failed",
          file,
          statementIndex,
          statementsTotal: parts.length,
          message,
          ...(lockWaitDetail ? { lockWait: lockWaitDetail } : {}),
        };
        log(`  FAIL: ${file} -> ${message} (statement ${statementIndex} of ${parts.length})`);
        break;
      }
    }
    return result;
  } finally {
    if (restoreLockWaits) await restoreLockWaits();
    await releaseMigrationLock(conn, lockName);
  }
}

/**
 * The partial-progress ledger — a SEPARATE table, deliberately.
 *
 * The obvious design is a `statements_done` column on `_migrations_applied`,
 * but that table's rows already mean "this file completed", and adding a
 * column to it gives every historical row the default 0. A resume rule of
 * "complete only at parts.length" would then read every already-applied
 * migration as zero-of-N done and replay the entire schema history against a
 * populated database on the next boot. Backfilling to dodge that is one
 * more thing to get wrong at exactly the moment (a failed migration) when
 * nothing else is working.
 *
 * A separate table leaves the completion ledger's meaning untouched: a row
 * in `_migrations_applied` still means complete, full stop, and this table
 * only carries files that are mid-flight.
 */
async function ensurePartialLedger(conn: mysql.Connection): Promise<void> {
  await conn.query(
    "CREATE TABLE IF NOT EXISTS `_migrations_partial` (" +
      "`filename` varchar(255) NOT NULL, " +
      "`statements_done` int NOT NULL DEFAULT 0, " +
      "`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, " +
      "PRIMARY KEY (`filename`))",
  );
}

/** How far into a still-unfinished file the last attempt got. */
async function recordProgress(conn: mysql.Connection, file: string, n: number): Promise<void> {
  await conn.query(
    "INSERT INTO `_migrations_partial` (filename, statements_done) VALUES (?, ?) " +
      "ON DUPLICATE KEY UPDATE statements_done = VALUES(statements_done)",
    [file, n],
  );
}

export async function migrationStatus(
  conn: mysql.Connection,
  dir: string = MIGRATIONS_DIR,
): Promise<{ applied: string[]; pending: string[] }> {
  await conn.query(
    "CREATE TABLE IF NOT EXISTS `_migrations_applied` (" +
      "`filename` varchar(255) NOT NULL, " +
      "`applied_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, " +
      "PRIMARY KEY (`filename`))",
  );
  const [rows] = await conn.query<any[]>("SELECT filename FROM `_migrations_applied`");
  const done = new Set(rows.map((r) => r.filename));
  const all = discoverMigrations(dir);
  return { applied: all.filter((f) => done.has(f)), pending: all.filter((f) => !done.has(f)) };
}
