/**
 * 0267 RUN, NOT REVIEWED: expand only, and the previous release still works.
 *
 * The file is read off disk and split by the runner's own `splitStatements`,
 * so this exercises the bytes that run at boot. The provisioned schema has
 * already applied 0267, which is the state the previous release would meet
 * if its image were put back.
 *
 * WHAT IT HAS TO PROVE:
 *   1. The file is the two statements it says it is.
 *   2. Every column 0267 adds to `season_plans` is a nullable json with no
 *      default, so the previous release's INSERT, which names none of them,
 *      writes a row; and its SELECT of the 0258 columns reads it back.
 *   3. `player_moon_load` has its primary key on (user_id, cycle_id), so one
 *      member has one read per moon (a second plain INSERT is refused).
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { splitStatements } from "./db/migrate";

const configured = testDbConfigured();
if (!configured) console.warn("[playerCardWords.migration] TEST_DATABASE_URL not set. This suite SKIPPED.");

const MIGRATION = path.join(process.cwd(), "drizzle", "0267_a_player_card_carries_its_own_words.sql");

describe("0267 as the runner reads it", () => {
  it("is the file the runner discovers, as two statements, and touches no existing column", () => {
    expect(/^\d{4}_[a-z0-9_]+\.sql$/.test(path.basename(MIGRATION))).toBe(true);
    const statements = splitStatements(fs.readFileSync(MIGRATION, "utf-8"));
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/^ALTER TABLE `season_plans`/);
    expect(statements[0]).not.toMatch(/\b(DROP|MODIFY|CHANGE|RENAME)\b/i);
    expect(statements[1]).toMatch(/^CREATE TABLE IF NOT EXISTS `player_moon_load`/);
  });
});

describe.skipIf(!configured)("0267 on a migrated schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("adds three nullable json columns with no default", async () => {
    const [cols] = await pool.query<any[]>( // module-review-ok: a read of information_schema for the scratch schema
      "SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable, DATA_TYPE AS type, COLUMN_DEFAULT AS dflt FROM information_schema.COLUMNS " +
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'season_plans' AND COLUMN_NAME IN ('serves_goals_json','seasonal_goals_json','card_words_json') ORDER BY COLUMN_NAME",
    );
    expect(cols.map((c) => String(c.name))).toEqual(["card_words_json", "seasonal_goals_json", "serves_goals_json"]);
    for (const c of cols) {
      expect(String(c.nullable)).toBe("YES");
      // MariaDB reports json as longtext.
      expect(["json", "longtext"]).toContain(String(c.type).toLowerCase());
      expect(c.dflt === null || String(c.dflt).toUpperCase() === "NULL").toBe(true);
    }
  });

  it("the previous release writes and reads a plan, and the new columns stay NULL", async () => {
    // The previous release's statements, verbatim (server/repos/seasonPlans.ts at 0266).
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO season_plans (id, user_id, season_id, version, aim, serves_goal, commitments_json, handing_back) VALUES (?,?,?,?,?,?,?,?)",
      ["sp-prev000000000001", "u-prev", "s-1", 1, "An aim", "A goal", "{}", "[]"],
    );
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT id, user_id, season_id, version, aim, serves_goal, commitments_json, handing_back, filed_at, superseded_at, created_at FROM season_plans WHERE id = ?",
      ["sp-prev000000000001"],
    );
    expect(rows[0].serves_goal).toBe("A goal");
    const [fresh] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT serves_goals_json, seasonal_goals_json, card_words_json FROM season_plans WHERE id = ?",
      ["sp-prev000000000001"],
    );
    expect([fresh[0].serves_goals_json, fresh[0].seasonal_goals_json, fresh[0].card_words_json]).toEqual([null, null, null]);
    // The previous release's erasure step still runs.
    await pool.query("UPDATE season_plans SET aim = NULL, serves_goal = NULL, commitments_json = NULL WHERE user_id = ?", ["u-prev"]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  it("keeps one moon read per member per moon", async () => {
    await pool.query("INSERT INTO player_moon_load (user_id, cycle_id, level) VALUES ('u-prev', 'moon-1', 3)"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await expect(
      pool.query("INSERT INTO player_moon_load (user_id, cycle_id, level) VALUES ('u-prev', 'moon-1', 4)"), // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    // CONTROL: another moon is its own row.
    await pool.query("INSERT INTO player_moon_load (user_id, cycle_id, level) VALUES ('u-prev', 'moon-2', 4)"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const [n] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM player_moon_load WHERE user_id = 'u-prev'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(Number(n[0].n)).toBe(2);
  });
});
