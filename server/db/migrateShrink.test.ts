/**
 * SHRINKING A MIGRATION THAT IS HALF APPLIED ON PRODUCTION (0298, 2026-11-01).
 *
 * 0298 shipped eight statements: six ALTERs, then two UPDATEs computing a
 * derived id with SHA1() in SQL. The deploy carrying it failed after 15.5
 * minutes and the Railway log says why:
 *
 *     FAIL: 0298_a_season_goal_keeps_its_name.sql
 *       -> FUNCTION railway.SHA1 does not exist (statement 7 of 8)
 *
 * Production is therefore left in a specific and unusual state: the filename is
 * in `_migrations_partial` with `statements_done` = 6, NOT in
 * `_migrations_applied`, and the six columns exist.
 *
 * THE FIX SHRINKS THE FILE TO ITS FIRST SIX STATEMENTS rather than adding a
 * 0305 to finish the job, because `applyPending` resumes at
 * `Math.min(progress, parts.length)`: min(6, 6) = 6, the loop body never runs,
 * nothing is replayed, and the file is recorded applied. That is a claim about
 * the runner, and a claim about the runner is worth nothing unless a real
 * database agrees, so these cases build that exact state and then shrink.
 *
 * WHY STATEMENTS 1 TO 6 HAD TO STAY BYTE IDENTICAL, and what proves it: the
 * resume is an OFFSET, not a diff. Edit any of the first six and the runner
 * resumes past a statement whose new body never ran anywhere. Case 4 holds
 * that, by shrinking to five and showing statement 6's column goes missing
 * with nothing reporting it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applyPending, splitStatements, type ApplyResult } from "./migrate";
import { testDbConfigured } from "./testDb";

/** The real file, read for the one assertion that is about it and not about a fixture. */
const REAL_0298 = path.resolve(process.cwd(), "drizzle/0298_a_season_goal_keeps_its_name.sql");

/** 0298's six ALTERs, as they shipped and as production ran them. */
const SIX = [
  "ALTER TABLE `live_session_priorities` ADD COLUMN `serves_goal_id` varchar(40) NULL;",
  "ALTER TABLE `live_session_shares` ADD COLUMN `serves_goal_id` varchar(40) NULL;",
  "ALTER TABLE `live_session_shares` ADD COLUMN `same_as_id` int NULL;",
  "ALTER TABLE `live_session_shares` ADD COLUMN `stands_alone` tinyint NOT NULL DEFAULT 0;",
  "ALTER TABLE `live_session_entries` ADD COLUMN `serves_goal_id` varchar(40) NULL;",
  "ALTER TABLE `live_session_entries` ADD COLUMN `serves_goal` varchar(200) NULL;",
];

/**
 * Statements 7 and 8, with the failure production actually gave. SHA1 exists on
 * the mysql:8 CI runs against, which is the whole reason this shipped, so the
 * fixture names a function that exists on NEITHER engine. The runner's
 * behaviour under "statement 7 failed" is what is being tested, not which
 * function was missing.
 */
const SEVEN_AND_EIGHT = [
  "UPDATE `live_session_priorities` SET `serves_goal_id` = village_missing_fn(`serves_goal`) WHERE `serves_goal_id` IS NULL;",
  "UPDATE `live_session_shares` SET `serves_goal_id` = village_missing_fn(`serves_goal`) WHERE `serves_goal_id` IS NULL;",
];

const FILE = "0298_a_season_goal_keeps_its_name.sql";
const body = (statements: readonly string[]) =>
  "-- a header, stripped before splitting, exactly as the real file has one.\n--\n" + statements.join("\n\n") + "\n";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[migrateShrink.test] TEST_DATABASE_URL not set, the 0298 resume proofs SKIPPED. A skip is not a pass.");
}

describe("the real 0298, as it now stands in drizzle/", () => {
  it("holds exactly six statements, and none of them calls SHA1", () => {
    const parts = splitStatements(fs.readFileSync(REAL_0298, "utf-8"));
    expect(parts.length).toBe(6);
    expect(parts.some((p) => /SHA1/i.test(p))).toBe(false);
  });

  it("carries the same six statements production already ran, in the same order", () => {
    const parts = splitStatements(fs.readFileSync(REAL_0298, "utf-8"));
    // splitStatements drops the trailing semicolon, so compare on that basis.
    expect(parts).toEqual(SIX.map((s) => s.replace(/;$/, "")));
  });
});

describe.skipIf(!configured)("a half-applied 0298 finishes when the file shrinks to six", () => {
  const base = process.env.TEST_DATABASE_URL as string;
  let admin: mysql.Connection;
  let conns: mysql.Connection[] = [];
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
  }, 60_000);

  afterEach(async () => {
    for (const c of conns) await c.end().catch(() => {});
    for (const s of schemas) await admin.query(`DROP DATABASE IF EXISTS \`${s}\``).catch(() => {});
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    conns = [];
    schemas = [];
    dirs = [];
  }, 60_000);

  afterAll(async () => {
    await admin?.end();
  });

  /** A schema holding the three tables 0298 alters, with a row in each that names a goal by words. */
  async function freshSchema(tag: string): Promise<string> {
    const schema = `shrink_${tag}_${Date.now()}_${process.pid}`.slice(0, 64);
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    schemas.push(schema);
    for (const t of ["live_session_priorities", "live_session_shares", "live_session_entries"]) {
      await admin.query(
        `CREATE TABLE \`${schema}\`.\`${t}\` (id int NOT NULL AUTO_INCREMENT PRIMARY KEY, serves_goal varchar(200) NULL)`,
      );
    }
    // live_session_entries.serves_goal is ADDED by statement 6, so it must not pre-exist.
    await admin.query(`ALTER TABLE \`${schema}\`.\`live_session_entries\` DROP COLUMN \`serves_goal\``);
    await admin.query(`INSERT INTO \`${schema}\`.\`live_session_priorities\` (serves_goal) VALUES ('Grow the garden')`);
    await admin.query(`INSERT INTO \`${schema}\`.\`live_session_shares\` (serves_goal) VALUES ('Grow the garden')`);
    return schema;
  }

  async function open(schema: string): Promise<mysql.Connection> {
    const u = new URL(base);
    u.pathname = `/${schema}`;
    const conn = await mysql.createConnection({ uri: u.toString(), timezone: "Z" });
    conns.push(conn);
    return conn;
  }

  function migrationDir(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "village-shrink-"));
    dirs.push(dir);
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return dir;
  }

  const write = (dir: string, statements: readonly string[]) =>
    fs.writeFileSync(path.join(dir, FILE), body(statements));

  async function run(conn: mysql.Connection, dir: string): Promise<{ r: ApplyResult; lines: string[] }> {
    const lines: string[] = [];
    const r = await applyPending(conn, dir, (l) => lines.push(l));
    return { r, lines };
  }

  const ledger = async (schema: string) => {
    const [applied] = await admin.query<any[]>(`SELECT filename FROM \`${schema}\`.\`_migrations_applied\``);
    const [partial] = await admin.query<any[]>(
      `SELECT filename, statements_done FROM \`${schema}\`.\`_migrations_partial\``,
    );
    return {
      applied: applied.map((r) => r.filename),
      partial: partial.map((r) => [r.filename, Number(r.statements_done)]),
    };
  };

  const columns = async (schema: string) => {
    const [rows] = await admin.query<any[]>(
      "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? " +
        "AND COLUMN_NAME IN ('serves_goal_id', 'same_as_id', 'stands_alone', 'serves_goal') ORDER BY t, c",
      [schema],
    );
    return rows.map((r) => `${r.t}.${r.c}`);
  };

  it("case 1: the eight-statement file fails at statement 7 and records six done -- production's state", async () => {
    const schema = await freshSchema("c1");
    const dir = migrationDir({});
    write(dir, [...SIX, ...SEVEN_AND_EIGHT]);
    const conn = await open(schema);

    const { r, lines } = await run(conn, dir);
    expect(r.failed).not.toBeNull();
    expect(r.failedDetail?.kind).toBe("migration-failed");
    if (r.failedDetail?.kind !== "migration-failed") throw new Error("wrong kind");
    expect(r.failedDetail.statementIndex).toBe(7);
    expect(r.failedDetail.statementsTotal).toBe(8);
    expect(lines.some((l) => l.includes(`${FILE} (8 statements)`))).toBe(true);

    // Exactly production's shape: six done, not applied, six columns there.
    expect(await ledger(schema)).toEqual({ applied: [], partial: [[FILE, 6]] });
    expect(await columns(schema)).toEqual([
      "live_session_entries.serves_goal",
      "live_session_entries.serves_goal_id",
      "live_session_priorities.serves_goal",
      "live_session_priorities.serves_goal_id",
      "live_session_shares.same_as_id",
      "live_session_shares.serves_goal",
      "live_session_shares.serves_goal_id",
      "live_session_shares.stands_alone",
    ]);
  }, 90_000);

  it("case 2: THE CONTROL -- leaving the file at eight keeps failing, boot after boot", async () => {
    const schema = await freshSchema("c2");
    const dir = migrationDir({});
    write(dir, [...SIX, ...SEVEN_AND_EIGHT]);
    const conn = await open(schema);

    await run(conn, dir);
    // The second boot resumes at 7 and dies at 7 again. This is the state the
    // fleet was in, and it is what makes the shrink the fix rather than a tidy-up.
    const { r: r2, lines } = await run(conn, dir);
    expect(r2.failed).not.toBeNull();
    expect(lines.some((l) => l.includes("resuming at statement 7 of 8"))).toBe(true);
    expect(await ledger(schema)).toEqual({ applied: [], partial: [[FILE, 6]] });
  }, 90_000);

  it("case 3: shrinking to six completes the file, replays nothing, and clears the partial row", async () => {
    const schema = await freshSchema("c3");
    const dir = migrationDir({});
    write(dir, [...SIX, ...SEVEN_AND_EIGHT]);
    const conn = await open(schema);
    await run(conn, dir);
    expect((await ledger(schema)).partial).toEqual([[FILE, 6]]);
    const before = await columns(schema);

    // The fix lands: the same filename, its first six statements byte for byte.
    write(dir, SIX);
    const { r, lines } = await run(conn, dir);

    expect(r.failed).toBeNull();
    expect(r.applied).toEqual([FILE]);
    // min(6, 6) = 6, so the loop body never runs. A replay of statement 1 would
    // have thrown on a duplicate column, which is itself proof that it did not.
    //
    // THE LOG LINE READS ODDLY AND IS PINNED HERE ON PURPOSE: `startAt` is 6, so
    // the runner takes its "resuming" branch and prints "statement 7 of 6",
    // naming a statement past the end of the file. Nothing is wrong -- the loop
    // it then enters has no iterations -- but whoever reads this line in a
    // deploy log deserves to find it written down somewhere rather than conclude
    // the runner lost count. Changing the wording is a one-line change in
    // server/db/migrate.ts and this assertion is what would tell you.
    expect(lines.some((l) => l.includes(`${FILE} (resuming at statement 7 of 6)`))).toBe(true);
    expect(await ledger(schema)).toEqual({ applied: [FILE], partial: [] });
    expect(await columns(schema)).toEqual(before);

    // And a third boot skips it entirely, as any applied file is skipped.
    const { r: r3 } = await run(conn, dir);
    expect(r3.failed).toBeNull();
    expect(r3.applied).toEqual([]);
    expect(r3.skipped).toContain(FILE);
  }, 90_000);

  it("case 4: WHY 1 TO 6 ARE BYTE IDENTICAL -- shrinking past a statement silently skips it", async () => {
    const schema = await freshSchema("c4");
    const dir = migrationDir({});
    write(dir, [...SIX, ...SEVEN_AND_EIGHT]);
    const conn = await open(schema);
    await run(conn, dir);

    // A fresh instance, same five-statement file: statement 6's column is missing.
    const fresh = await freshSchema("c4b");
    const freshConn = await open(fresh);
    write(dir, SIX.slice(0, 5));
    const { r } = await run(freshConn, dir);
    expect(r.failed).toBeNull();
    expect(r.applied).toEqual([FILE]);
    // The column statement 6 adds is simply absent, and the ledger says applied.
    expect(await columns(fresh)).not.toContain("live_session_entries.serves_goal");
    expect((await ledger(fresh)).applied).toEqual([FILE]);
    // Nothing anywhere reported it. That is the hazard, and it is why the fix
    // only ever removes statements AFTER the offset production stopped at.
  }, 120_000);

  it("case 5: an instance that never ran 0298 applies the six-statement file from scratch", async () => {
    const schema = await freshSchema("c5");
    const dir = migrationDir({});
    write(dir, SIX);
    const conn = await open(schema);

    const { r, lines } = await run(conn, dir);
    expect(r.failed).toBeNull();
    expect(r.applied).toEqual([FILE]);
    expect(lines.some((l) => l.includes(`${FILE} (6 statements)`))).toBe(true);
    expect(await ledger(schema)).toEqual({ applied: [FILE], partial: [] });
    expect(await columns(schema)).toEqual([
      "live_session_entries.serves_goal",
      "live_session_entries.serves_goal_id",
      "live_session_priorities.serves_goal",
      "live_session_priorities.serves_goal_id",
      "live_session_shares.same_as_id",
      "live_session_shares.serves_goal",
      "live_session_shares.serves_goal_id",
      "live_session_shares.stands_alone",
    ]);
  }, 90_000);
});
