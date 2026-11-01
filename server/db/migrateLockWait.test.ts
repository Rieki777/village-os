/**
 * A MIGRATION THAT CANNOT GET ITS LOCK MUST GIVE UP, FAST (2026-11-01).
 *
 * Found while investigating batch 74, whose outage Railway's deploy logs later
 * traced to a different failure: 0298's SHA1(), rejected by production's
 * database. The hazard here was real either way. A migration ALTERs a table
 * with the server's default `lock_wait_timeout` (one year on MySQL 8, one day
 * on MariaDB), for example 0304's `ALTER TABLE users ADD COLUMN`. Any DDL, INSTANT included, needs an exclusive metadata
 * lock for a moment. One open transaction that had touched `users` makes the
 * ALTER wait, and every later query on `users`, from either server, queues
 * behind the ALTER's pending exclusive request. Eight pool connections stuck
 * there is the whole old server.
 *
 * Every case here builds that exact shape on a real database: a second
 * connection holds a transaction open on a table, and a migration ALTERs it.
 * The lock timeout is injected (2 seconds) so the suite stays fast; production
 * uses MIGRATION_LOCK_WAIT_SECONDS.
 *
 * NOTHING HERE MAY HANG THE RUN. Every wait is raced against its own bound, so
 * a runner with no cap (the code before this fix, or the control that removes
 * the SET) fails with "was still waiting" instead of hanging for a day, and the
 * cleanup ends the blocker first so the stuck ALTER can finish and drain.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  applyPending,
  MIGRATION_LOCK_WAIT_ATTEMPTS,
  MIGRATION_LOCK_WAIT_SECONDS,
  worstCaseLockWaitSeconds,
  type ApplyResult,
  type LockWaitOptions,
} from "./migrate";
import { testDbConfigured } from "./testDb";

/** The injected lock timeout for these tests, in seconds. */
const N = 2;
/** How long past N a give-up may take before it counts as slow (boot preamble, a loaded box). */
const MARGIN_MS = 4_000;
/** Past this, the runner is treated as hung. Well past N + MARGIN, well short of any real timeout. */
const HANG_BOUND_MS = 15_000;

describe("the lock-wait cap stays well inside Railway's healthcheck window", () => {
  /**
   * The coordinator's rule: a DDL that fails in 50 seconds helps, one that fails
   * in 14 minutes does not. The new container sits unhealthy until migrations
   * finish, so the whole lock-wait budget, retries and backoff included, has to
   * be spent and reported long before Railway stops waiting on the healthcheck.
   * The window is read from railway.toml so a change to either side is seen.
   */
  it("bounds every timed-out wait plus backoff to under a quarter of healthcheckTimeout", () => {
    const toml = fs.readFileSync(path.resolve(process.cwd(), "railway.toml"), "utf-8");
    const m = toml.match(/^\s*healthcheckTimeout\s*=\s*(\d+)\s*$/m);
    expect(m, "railway.toml declares healthcheckTimeout").not.toBeNull();
    const healthcheckSeconds = Number(m![1]);
    expect(healthcheckSeconds).toBeGreaterThan(0);

    const worst = worstCaseLockWaitSeconds();
    expect(Number.isFinite(worst)).toBe(true);
    expect(worst).toBeGreaterThanOrEqual(MIGRATION_LOCK_WAIT_SECONDS);
    expect(worst).toBeLessThan(healthcheckSeconds / 4);
    // One wait is what the old server's queries sit behind before the ALTER lets
    // go, so it has its own ceiling, far below the window.
    expect(MIGRATION_LOCK_WAIT_SECONDS).toBeLessThanOrEqual(30);
    expect(MIGRATION_LOCK_WAIT_ATTEMPTS).toBeGreaterThanOrEqual(1);
  });

  it("computes the bound from the options it is given", () => {
    // No retries: one wait.
    expect(worstCaseLockWaitSeconds({ timeoutSeconds: 10, attempts: 1 })).toBe(10);
    // Two retries in the run, the longest backoff 15s: three waits and two sleeps.
    expect(
      worstCaseLockWaitSeconds({ timeoutSeconds: 10, attempts: 3, backoffMs: [5_000, 15_000], retryBudget: 2 }),
    ).toBe(3 * 10 + 2 * 15);
  });
});

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[migrateLockWait.test] TEST_DATABASE_URL not set, the lock-wait proofs SKIPPED. A skip is not a pass.");
}

type Settled<T> = { done: true; value: T; at: number } | { done: false };

/** Race a promise against a bound. Never rejects: a rejection is reported as a value. */
async function settle<T>(p: Promise<T>, ms: number): Promise<Settled<T>> {
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), ms);
  });
  try {
    return await Promise.race([p.then((value) => ({ done: true as const, value, at: Date.now() })), bound]);
  } finally {
    clearTimeout(timer);
  }
}

describe.skipIf(!configured)("a migration that cannot get its lock (the metadata-lock pile-up)", () => {
  const base = process.env.TEST_DATABASE_URL as string;
  let admin: mysql.Connection;
  /** Everything a case opened, so afterEach can unwind it in a safe order even after a failure. */
  let blockers: mysql.Connection[] = [];
  let others: mysql.Connection[] = [];
  let pending: Promise<unknown>[] = [];
  let schemas: string[] = [];
  let dirs: string[] = [];

  beforeAll(async () => {
    const u = new URL(base);
    admin = await mysql.createConnection({
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      timezone: "Z",
    });
    // The admin connection drops schemas in cleanup, and a DROP waits on the
    // same metadata locks the cases build. It must never wait a day either.
    await admin.query("SET SESSION lock_wait_timeout = 20");
  }, 60_000);

  afterEach(async () => {
    // 1. End every blocker, so a stuck ALTER (the uncapped runner) can proceed.
    for (const b of blockers) {
      await b.query("ROLLBACK").catch(() => {});
      await b.end().catch(() => {});
    }
    // 2. Let whatever was stuck drain, then kill what still did not.
    for (const p of pending) {
      const r = await settle(p.catch(() => {}), 10_000);
      if (!r.done) {
        // eslint-disable-next-line no-console
        console.warn("[migrateLockWait.test] a migration was still running after its blocker ended");
      }
    }
    for (const c of others) {
      const r = await settle(c.end(), 5_000);
      if (!r.done) {
        await admin.query(`KILL CONNECTION ${Number(c.threadId)}`).catch(() => {});
        c.destroy();
      }
    }
    for (const s of schemas) await admin.query(`DROP DATABASE IF EXISTS \`${s}\``).catch(() => {});
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    blockers = [];
    others = [];
    pending = [];
    schemas = [];
    dirs = [];
  }, 90_000);

  afterAll(async () => {
    await admin?.end();
  });

  async function freshSchema(tag: string): Promise<string> {
    const schema = `lockwait_${tag}_${Date.now()}_${process.pid}`.slice(0, 64);
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    schemas.push(schema);
    // A table that stands in for `users`: a few rows, one the backfill case updates.
    await admin.query(
      `CREATE TABLE \`${schema}\`.\`users_probe\` (id int NOT NULL PRIMARY KEY, email varchar(40) NULL)`,
    );
    await admin.query(`INSERT INTO \`${schema}\`.\`users_probe\` (id, email) VALUES (1, 'a@x'), (2, 'b@x')`);
    return schema;
  }

  async function open(schema: string, list: mysql.Connection[] = others): Promise<mysql.Connection> {
    const u = new URL(base);
    u.pathname = `/${schema}`;
    const conn = await mysql.createConnection({ uri: u.toString(), timezone: "Z" });
    await conn.query("SET time_zone = '+00:00'");
    list.push(conn);
    return conn;
  }

  function migrationDir(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "village-lockwait-"));
    dirs.push(dir);
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    return dir;
  }

  /** A transaction that has read the table: it holds a shared metadata lock on it until it ends. */
  async function holdTable(schema: string): Promise<mysql.Connection> {
    const b = await open(schema, blockers);
    await b.query("START TRANSACTION");
    await b.query("SELECT COUNT(*) FROM `users_probe`");
    return b;
  }

  /** Resolves once the connection's thread shows the given wait state. A fact, never a sleep. */
  async function untilThreadWaits(threadId: number | null, state: RegExp, ms = 10_000): Promise<void> {
    const deadline = Date.now() + ms;
    for (;;) {
      const [rows] = await admin.query<any[]>("SELECT STATE AS s FROM information_schema.PROCESSLIST WHERE ID = ?", [
        threadId,
      ]);
      const s = String(rows[0]?.s ?? "");
      if (state.test(s)) return;
      if (Date.now() > deadline) throw new Error(`thread ${threadId} never showed ${state} within ${ms} ms (last state "${s}")`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  function run(conn: mysql.Connection, dir: string, lines: string[], lockWait: LockWaitOptions) {
    const p = applyPending(conn, dir, (l) => lines.push(l), undefined, lockWait);
    pending.push(p);
    return p;
  }

  function hung(what: string): never {
    throw new Error(
      `${what} was still waiting after ${HANG_BOUND_MS / 1000}s with a ${N}s lock timeout requested: ` +
        `the statement is queued behind the open transaction with no lock timeout of its own: the metadata-lock pile-up this file guards against.`,
    );
  }

  const MDL_WAIT = /metadata lock/i;

  it("test 1: an ALTER behind an open transaction gives up within the timeout and says why", async () => {
    const schema = await freshSchema("t1");
    const dir = migrationDir({
      "0001_users_probe_verified.sql": "ALTER TABLE `users_probe`\n  ADD COLUMN `email_verified_at` timestamp NULL;\n",
    });
    await holdTable(schema);
    const mig = await open(schema);
    const lines: string[] = [];
    const t0 = Date.now();
    const p = run(mig, dir, lines, { timeoutSeconds: N, attempts: 1 });
    // The ALTER really is the thing waiting, on the metadata lock, which is H1.
    await untilThreadWaits(mig.threadId, MDL_WAIT);
    const r = await settle(p, HANG_BOUND_MS);
    if (!r.done) hung("applyPending");
    const result = r.value as ApplyResult;
    const elapsed = r.at - t0;

    expect(elapsed).toBeGreaterThanOrEqual(N * 1000 - 250);
    expect(elapsed).toBeLessThan(N * 1000 + MARGIN_MS);
    expect(result.applied).toEqual([]);
    expect(result.failed).toBeTruthy();
    expect(result.failedDetail?.kind).toBe("migration-failed");
    if (result.failedDetail?.kind !== "migration-failed") throw new Error("wrong kind");
    expect(result.failedDetail.file).toBe("0001_users_probe_verified.sql");
    expect(result.failedDetail.statementIndex).toBe(1);
    expect(result.failedDetail.lockWait).toMatchObject({ kind: "lock-wait-timeout", ddl: true, timeoutSeconds: N, attempts: 1 });
    // The operator's sentence: which file, which statement, and that it was a
    // metadata-lock wait, so they retry the deploy and leave the SQL alone.
    const msg = result.failedDetail.message;
    expect(msg).toContain("0001_users_probe_verified.sql");
    expect(msg).toContain("statement 1 of 1");
    expect(msg).toContain("metadata lock");
    expect(msg).toContain("ALTER TABLE `users_probe` ADD COLUMN `email_verified_at`");
    expect(msg).toMatch(/redeploy/i);
    expect(result.failed).toContain("0001_users_probe_verified.sql");
    expect(lines.some((l) => l.startsWith("  FAIL:") && l.includes("metadata lock"))).toBe(true);

    // Nothing recorded the file as applied.
    const [applied] = await admin.query<any[]>(`SELECT filename FROM \`${schema}\`.\`_migrations_applied\``);
    expect(applied).toEqual([]);
  }, 60_000);

  it("test 2: a plain SELECT queued behind the waiting ALTER runs as soon as the ALTER gives up", async () => {
    const schema = await freshSchema("t2");
    const dir = migrationDir({
      "0001_users_probe_verified.sql": "ALTER TABLE `users_probe` ADD COLUMN `email_verified_at` timestamp NULL;\n",
    });
    await holdTable(schema);
    const mig = await open(schema);
    const p = run(mig, dir, [], { timeoutSeconds: N, attempts: 1 });
    await untilThreadWaits(mig.threadId, MDL_WAIT);

    // The old server's request: an ordinary read, in autocommit, on the same table.
    const reader = await open(schema);
    const read = reader.query("SELECT COUNT(*) AS n FROM `users_probe`");
    pending.push(read);
    // The pile-up is real here: the read queues behind the ALTER's pending
    // exclusive request, though the open transaction only holds a shared lock
    // that a read would otherwise share.
    await untilThreadWaits(reader.threadId, MDL_WAIT);

    const r = await settle(p, HANG_BOUND_MS);
    if (!r.done) hung("applyPending");
    expect((r.value as ApplyResult).failedDetail?.kind).toBe("migration-failed");
    const rr = await settle(read, 5_000);
    if (!rr.done) throw new Error("the queued SELECT was still blocked 5s after the ALTER gave up");
    // Freed within moments of the ALTER letting go, while the long transaction
    // is STILL open: the old server recovers without anybody finding it.
    expect(rr.at - r.at).toBeLessThan(1_500);
    expect(Number((rr.value as any)[0][0].n)).toBe(2);
  }, 60_000);

  it("test 3: a file that times out mid-file records the offset after statement 1, and resumes at statement 2", async () => {
    const schema = await freshSchema("t3");
    const file = "0001_three_statements.sql";
    const dir = migrationDir({
      [file]:
        "-- statement 1 has no IF NOT EXISTS on purpose: a replay of it fails loudly.\n" +
        "CREATE TABLE `side_probe` (id int NOT NULL PRIMARY KEY);\n" +
        "ALTER TABLE `users_probe` ADD COLUMN `email_verified_at` timestamp NULL;\n" +
        "ALTER TABLE `side_probe` ADD COLUMN `note` varchar(20) NULL;\n",
    });
    const blocker = await holdTable(schema);
    const mig = await open(schema);
    const [[before]] = await mig.query<any[]>("SELECT @@SESSION.lock_wait_timeout AS lwt, @@SESSION.innodb_lock_wait_timeout AS ilwt");

    const first: string[] = [];
    const r1 = await settle(run(mig, dir, first, { timeoutSeconds: N, attempts: 1 }), HANG_BOUND_MS);
    if (!r1.done) hung("the first run");
    const res1 = r1.value as ApplyResult;
    expect(res1.failedDetail?.kind).toBe("migration-failed");
    if (res1.failedDetail?.kind !== "migration-failed") throw new Error("wrong kind");
    expect(res1.failedDetail.statementIndex).toBe(2);
    expect(res1.failedDetail.statementsTotal).toBe(3);
    expect(res1.failedDetail.message).toContain("statement 2 of 3");
    expect(res1.failedDetail.message).toContain("resumes at statement 2");

    // Exactly the offset after statement 1, and the file is NOT applied.
    const [partial1] = await admin.query<any[]>(`SELECT filename, statements_done FROM \`${schema}\`.\`_migrations_partial\``);
    expect(partial1.map((r) => [r.filename, Number(r.statements_done)])).toEqual([[file, 1]]);
    const [applied1] = await admin.query<any[]>(`SELECT filename FROM \`${schema}\`.\`_migrations_applied\``);
    expect(applied1).toEqual([]);
    // The connection is handed back with its own timeouts, as it came.
    const [[after]] = await mig.query<any[]>("SELECT @@SESSION.lock_wait_timeout AS lwt, @@SESSION.innodb_lock_wait_timeout AS ilwt");
    expect([Number(after.lwt), Number(after.ilwt)]).toEqual([Number(before.lwt), Number(before.ilwt)]);

    // The long transaction ends. The next boot resumes at statement 2: statement
    // 1 is NOT replayed (its CREATE TABLE would fail on an existing table).
    await blocker.query("ROLLBACK");
    const second: string[] = [];
    const r2 = await settle(run(mig, dir, second, { timeoutSeconds: N, attempts: 1 }), HANG_BOUND_MS);
    if (!r2.done) hung("the second run");
    const res2 = r2.value as ApplyResult;
    expect(res2.failed).toBeNull();
    expect(res2.applied).toEqual([file]);
    expect(second.some((l) => l.includes(`${file} (resuming at statement 2 of 3)`))).toBe(true);

    const [partial2] = await admin.query<any[]>(`SELECT filename FROM \`${schema}\`.\`_migrations_partial\``);
    expect(partial2).toEqual([]);
    const [applied2] = await admin.query<any[]>(`SELECT filename FROM \`${schema}\`.\`_migrations_applied\``);
    expect(applied2.map((r) => r.filename)).toEqual([file]);
    const [cols] = await admin.query<any[]>(
      "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? " +
        "AND COLUMN_NAME IN ('email_verified_at', 'note') ORDER BY TABLE_NAME",
      [schema],
    );
    expect(cols.map((r) => `${r.t}.${r.c}`)).toEqual(["side_probe.note", "users_probe.email_verified_at"]);
  }, 60_000);

  it("a retry inside one boot rides out a transaction that ends between attempts", async () => {
    const schema = await freshSchema("retry");
    const file = "0001_users_probe_verified.sql";
    const dir = migrationDir({ [file]: "ALTER TABLE `users_probe` ADD COLUMN `email_verified_at` timestamp NULL;\n" });
    const blocker = await holdTable(schema);
    const mig = await open(schema);
    const lines: string[] = [];
    // The blocker ends the moment the runner reports its first timed-out wait,
    // so the retry is what finishes the file, with no sleep guessing the timing.
    const p = applyPending(
      mig,
      dir,
      (l) => {
        lines.push(l);
        if (l.startsWith("  WAIT:")) void blocker.query("ROLLBACK").catch(() => {});
      },
      undefined,
      { timeoutSeconds: 1, attempts: 3, backoffMs: [300], retryBudget: 2 },
    );
    pending.push(p);
    const r = await settle(p, HANG_BOUND_MS);
    if (!r.done) hung("applyPending");
    const result = r.value as ApplyResult;
    expect(result.failed).toBeNull();
    expect(result.applied).toEqual([file]);
    const waits = lines.filter((l) => l.startsWith("  WAIT:"));
    expect(waits.length).toBe(1);
    expect(waits[0]).toContain(`${file} statement 1 of 1`);
    expect(waits[0]).toContain("attempt 1 of 3");
  }, 60_000);

  it("a backfill UPDATE behind a held row lock gives up within the timeout too", async () => {
    const schema = await freshSchema("row");
    const file = "0001_backfill.sql";
    const dir = migrationDir({ [file]: "UPDATE `users_probe` SET `email` = 'y@x' WHERE `id` = 1;\n" });
    // A row lock, held: InnoDB's own default wait is 50 seconds.
    const blocker = await open(schema, blockers);
    await blocker.query("START TRANSACTION");
    await blocker.query("UPDATE `users_probe` SET `email` = 'held@x' WHERE `id` = 1");
    const mig = await open(schema);
    const t0 = Date.now();
    const r = await settle(run(mig, dir, [], { timeoutSeconds: N, attempts: 1 }), HANG_BOUND_MS);
    if (!r.done) hung("applyPending");
    const result = r.value as ApplyResult;
    expect(r.at - t0).toBeLessThan(N * 1000 + MARGIN_MS);
    expect(result.failedDetail?.kind).toBe("migration-failed");
    if (result.failedDetail?.kind !== "migration-failed") throw new Error("wrong kind");
    expect(result.failedDetail.lockWait).toMatchObject({ kind: "lock-wait-timeout", ddl: false });
    expect(result.failedDetail.message).toContain("row lock");
    // The timed-out UPDATE changed nothing: the held row still reads as the blocker left it.
    await blocker.query("ROLLBACK");
    const [[row]] = await admin.query<any[]>(`SELECT email FROM \`${schema}\`.\`users_probe\` WHERE id = 1`);
    expect(row.email).toBe("a@x");
  }, 60_000);
});
