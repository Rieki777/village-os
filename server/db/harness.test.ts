/**
 * S5: proof that the test-database harness works — provision a scratch
 * schema, run EVERY migration through the production engine, and assert the
 * schema that comes out is the one the code believes in.
 *
 * Skips loudly without TEST_DATABASE_URL (a contributor with no database
 * still runs the JSON-era suite); CI always provides one, so main is always
 * gated on this passing.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPending } from "./migrate";
import { provisionTestDb, testDbConfigured, type TestDb } from "./testDb";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn(
    "[harness.test] TEST_DATABASE_URL not set — DB-backed tests SKIPPED. " +
      "CI runs them; locally, point TEST_DATABASE_URL at a scratch-capable MySQL.",
  );
}

describe.skipIf(!configured)("the test-database harness", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await provisionTestDb();
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("applies every migration from a cold start", async () => {
    const [rows] = await db.conn.query<any[]>("SELECT filename FROM `_migrations_applied` ORDER BY filename");
    const names = rows.map((r) => r.filename);
    expect(names.length).toBeGreaterThanOrEqual(7);
    expect(names[0]).toContain("0001");
    // The registry correction and its seed are present on any fresh fork.
    expect(names.some((n: string) => n.includes("0006_token_registry"))).toBe(true);
    expect(names.some((n: string) => n.includes("0007_village_credits"))).toBe(true);
  });

  it("seeds the token registry the ledger code mirrors", async () => {
    const [rows] = await db.conn.query<any[]>("SELECT slug, kind, governance FROM tokens ORDER BY sort_order");
    const slugs = rows.map((r) => r.slug);
    // 0266 seeds earned-equity, the platform twin that accrues here and is
    // claimed onto the Hypha mirror, the way Village Voice is to Voice.
    expect(slugs).toEqual(["gratitude", "earned-equity", "equity", "voice", "credits"]);
    const byslug: Record<string, any> = Object.fromEntries(rows.map((r) => [r.slug, r]));
    expect(byslug.gratitude.governance).toBe("platform");
    expect(byslug.equity.governance).toBe("hypha");
    expect(byslug["earned-equity"].governance).toBe("platform");
    expect(byslug.credits.kind).toBe("credit");
  });

  /**
   * NO FRESH VILLAGE BOOTS WITH ANOTHER VILLAGE'S NAME ON ITS EQUITY TOKEN.
   *
   * 0006 seeded the equity mirror with the founding village's own word in both
   * the slug and the display name, so all thirteen founder instances inherited
   * it. 0124 moved both. This is the assertion that keeps it moved: a seed is
   * data, and data is exactly the kind of thing that comes back when somebody
   * adds a row to make their own instance read right.
   */
  it("names the seeded equity tokens after no village at all", async () => {
    // Two equity tokens since 0266: the Hypha mirror, and the platform twin a
    // village earns and claims onto it. Neither may carry a village's name.
    const [both] = await db.conn.query<any[]>(
      "SELECT slug, name, governance FROM tokens WHERE kind = 'equity' ORDER BY slug",
    );
    expect(both.map((r: any) => [r.slug, r.name, r.governance])).toEqual([
      ["earned-equity", "Earned Equity", "platform"],
      ["equity", "Village Equity", "hypha"],
    ]);
    const [rows] = await db.conn.query<any[]>(
      "SELECT slug, name, kind, governance, decimals, transferable FROM tokens WHERE kind = 'equity' AND governance = 'hypha'",
    );
    expect(rows.length, "exactly one seeded equity mirror").toBe(1);
    expect(rows[0].slug).toBe("equity");
    expect(rows[0].name).toBe("Village Equity");
    // Unchanged by 0124, and named here so a future edit to the seed has to
    // face them: the mirror is read-only and moves nothing on this side.
    expect(rows[0].governance).toBe("hypha");
    expect(Number(rows[0].transferable)).toBe(0);
  });

  /**
   * THE PROOF 0124 RESTED ON, KEPT AS A STANDING GATE.
   *
   * Before the rename was written, every string column in a freshly migrated
   * schema was scanned for the retired slug: of 969 columns, exactly two held
   * it, and both were in `tokens` itself. That is what made a re-key safe, and
   * it is the same question worth asking of any future seed. A brand name that
   * reaches a DATA row is not caught by scripts/check-brand-refs.mjs, which
   * reads source files.
   *
   * Discovered from information_schema rather than a hand-written list of
   * tables, because a hand-written list is what misses the table somebody
   * added last week.
   */
  it("seeds no village's name into any row of a fresh schema", async () => {
    const [[{ s: schema }]] = await db.conn.query<any[]>("SELECT DATABASE() AS s");
    const [cols] = await db.conn.query<any[]>(
      "SELECT table_name AS t, column_name AS c, data_type AS dt FROM information_schema.columns " +
        "WHERE table_schema = ? AND data_type IN " +
        "('varchar','char','text','mediumtext','longtext','tinytext','json','enum') " +
        "ORDER BY table_name, column_name",
      [schema],
    );
    expect(cols.length, "the scan found columns to scan").toBeGreaterThan(500);
    // The same list scripts/check-brand-refs.mjs bans in source. Kept here as
    // a literal so this file states what it is looking for.
    const banned = ["amora", "dominicalito", "regencivics", "amoracita"]; // brand-ok: the needle this test hunts for
    const hits: string[] = [];
    for (const { t, c, dt } of cols as Array<{ t: string; c: string; dt: string }>) {
      const col = dt === "json" ? `CAST(\`${c}\` AS CHAR)` : `\`${c}\``;
      const where = banned.map(() => `${col} LIKE ?`).join(" OR ");
      const [[row]] = await db.conn.query<any[]>(
        `SELECT COUNT(*) AS n FROM \`${t}\` WHERE ${where}`,
        banned.map((b) => `%${b}%`),
      );
      if (Number(row.n) > 0) hits.push(`${t}.${c}: ${row.n} row(s)`);
    }
    expect(hits, `a village's name is seeded into: ${hits.join(", ")}`).toEqual([]);
  }, 120_000);

  it("shipped the registry column shape, not the enum", async () => {
    const [cols] = await db.conn.query<any[]>("SHOW COLUMNS FROM token_ledger LIKE 'token_type'");
    expect(String(cols[0].Type)).toContain("varchar");
    expect(String(cols[0].Type)).not.toContain("enum");
  });

  it("pins the MySQL SESSION zone, not only the driver", async () => {
    // The string round-trip below cannot catch this: it only proves mysql2
    // renders and parses consistently. NOW() is evaluated by MySQL in the
    // session zone, and every rate-limit window and job cadence compares a
    // DB-generated timestamp against a JS Date. If the session drifts, those
    // comparisons silently mean different things.
    const [[row]] = await db.conn.query<any[]>("SELECT @@session.time_zone AS tz");
    expect(String(row.tz)).toBe("+00:00");
    // Belt and braces: MySQL's own clock agrees with this process's, within
    // a minute. A whole-hour offset is exactly the failure being excluded.
    const [[now]] = await db.conn.query<any[]>("SELECT UNIX_TIMESTAMP(NOW()) AS s");
    expect(Math.abs(Number(now.s) * 1000 - Date.now())).toBeLessThan(60_000);
  });

  /**
   * The proof the template mechanism owes the suite.
   *
   * Provisioning stopped running 87 migrations per suite and started cloning a
   * template that ran them once. Every other DB-backed test now trusts that a
   * clone IS the migrated schema, so something has to check it against the
   * thing it replaced instead of against itself. This provisions the slow way
   * on purpose, by pointing the migration runner at a schema of its own, and
   * compares the two column for column and index for index.
   *
   * It runs against whichever engine the run is on, which is the point: the
   * DDL is the server's own `SHOW CREATE TABLE`, so MariaDB 12 locally and
   * MySQL 8 in CI each get checked in their own dialect.
   */
  it("hands out a clone that is the same schema the migrations build", async () => {
    // Named so the two-hour orphan sweep in testDb.ts can find it: it reads the
    // epoch from the THIRD underscore-separated field, so the word has to come
    // last. A hard crash between CREATE and the finally below would otherwise
    // leave this schema on the server forever.
    const control = `village_test_${Math.floor(Date.now() / 1000)}_${process.pid}_control`;
    const base = String(process.env.TEST_DATABASE_URL);
    const u = new URL(base);
    const admin = await mysql.createConnection({
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      timezone: "Z",
    });
    try {
      await admin.query(`DROP DATABASE IF EXISTS \`${control}\``);
      await admin.query(`CREATE DATABASE \`${control}\` CHARACTER SET utf8mb4`);
      u.pathname = `/${control}`;
      const conn = await mysql.createConnection({ uri: u.toString(), timezone: "Z" });
      try {
        await conn.query("SET time_zone = '+00:00'");
        const applied = await applyPending(conn);
        expect(applied.failed, "the control schema must migrate cleanly").toBeNull();

        const shape = async (c: mysql.Connection, schema: string) => {
          const [tables] = await c.query<any[]>(
            "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, TABLE_TYPE FROM information_schema.TABLES " +
              "WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
            [schema],
          );
          const [cols] = await c.query<any[]>(
            "SELECT TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLLATION_NAME " +
              "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION",
            [schema],
          );
          const [idx] = await c.query<any[]>(
            "SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE " +
              "FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
            [schema],
          );
          return { tables, cols, idx };
        };

        const mine = new URL(db.url).pathname.replace("/", "");
        const fromClone = await shape(db.conn, mine);
        const fromMigrations = await shape(conn, control);

        expect(fromClone.tables.length, "the clone must carry every table").toBeGreaterThan(50);
        expect(fromClone.tables).toEqual(fromMigrations.tables);
        expect(fromClone.cols).toEqual(fromMigrations.cols);
        expect(fromClone.idx).toEqual(fromMigrations.idx);

        // Schema is half of it. Several migrations INSERT, and a clone that
        // dropped their rows would leave every suite testing an empty registry.
        const [seeded] = await conn.query<any[]>(
          "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
          [control],
        );
        let compared = 0;
        for (const row of seeded as Array<{ t: string }>) {
          const [[a]] = await conn.query<any[]>(`SELECT COUNT(*) AS c FROM \`${control}\`.\`${row.t}\``);
          if (Number(a.c) === 0) continue;
          const [[b]] = await db.conn.query<any[]>(`SELECT COUNT(*) AS c FROM \`${row.t}\``);
          expect(Number(b.c), `${row.t} row count`).toBe(Number(a.c));
          compared += 1;
        }
        expect(compared, "some migration seeds rows; the clone must carry them").toBeGreaterThan(0);
      } finally {
        await conn.end();
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS \`${control}\``);
      await admin.end();
    }
  }, 180_000);

  it("round-trips a timestamp without timezone drift", async () => {
    // The rule 2.3 assertion: a Z-disciplined write reads back identical.
    // On a UTC-6 machine with mysql2's default 'local' timezone this fails
    // by six hours, which is exactly the lunar-boundary bug the rule kills.
    const stamp = "2026-07-26 12:34:56";
    await db.conn.query("CREATE TABLE tz_probe (id int PRIMARY KEY, at timestamp)");
    await db.conn.query("INSERT INTO tz_probe VALUES (1, ?)", [stamp]);
    const [rows] = await db.conn.query<any[]>("SELECT at FROM tz_probe WHERE id = 1");
    const read = rows[0].at instanceof Date ? rows[0].at.toISOString() : String(rows[0].at);
    expect(read).toContain("2026-07-26T12:34:56");
  });
});
