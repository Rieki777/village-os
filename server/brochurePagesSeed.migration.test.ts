/**
 * 0225 RUN, NOT REVIEWED: a village keeps the brochure pages it already served.
 *
 * The file is read off disk and executed through the runner's own
 * `splitStatements`, so this exercises the bytes that run at boot. The
 * provisioned schema has already applied 0225 against an empty `users` table,
 * which is itself the first case: a new village gets no row, so it is OFF.
 *
 * WHAT IT HAS TO PROVE:
 *   1. A database with no members gets no `brochure-pages` row, so the switch
 *      reads OFF through the same reader the server boots with.
 *   2. A database with a member gets `{ enabled: true }`, which the reader
 *      turns into ON. That is the line that keeps the live village's pages.
 *   3. A second run changes nothing.
 *   4. A village that turned its pages off afterwards is never turned back on.
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { splitStatements } from "./db/migrate";
import { brochurePagesOn, loadBrochurePages } from "./lib/brochurePages";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[brochurePagesSeed.migration] TEST_DATABASE_URL not set. This suite SKIPPED.");
}

const MIGRATION = path.join(process.cwd(), "drizzle", "0225_a_village_keeps_the_pages_it_already_served.sql");

describe.skipIf(!configured)("0225, a village keeps the brochure pages it already served", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  const runMigration = async () => {
    for (const sql of splitStatements(fs.readFileSync(MIGRATION, "utf-8"))) {
      await pool.query(sql); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
  };

  const row = async () => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `value` FROM `app_config` WHERE `config_key` = 'brochure-pages'",
    );
    if (!rows.length) return null;
    const v = rows[0].value;
    return typeof v === "string" ? JSON.parse(v) : v;
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM `app_config` WHERE `config_key` = 'brochure-pages'"); // module-review-ok: scratch-schema reset between cases
    await pool.query("DELETE FROM `users` WHERE `id` = 'u-0225'"); // module-review-ok: scratch-schema reset between cases
  });

  it("carries the file the runner discovers, as one statement", () => {
    expect(/^\d{4}.*\.sql$/.test(path.basename(MIGRATION))).toBe(true);
    expect(splitStatements(fs.readFileSync(MIGRATION, "utf-8"))).toHaveLength(1);
  });

  it("leaves a village with no members OFF, twice over", async () => {
    await runMigration();
    await runMigration();
    expect(await row()).toBeNull();
    expect(await loadBrochurePages(pool as any)).toBe(false);
    expect(brochurePagesOn()).toBe(false);
  });

  it("keeps the pages ON where members already exist, and a second run is a no-op", async () => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES ('u-0225', 'Wren', 'wren@example.org', 'x')",
    );
    await runMigration();
    const first = await row();
    expect(first?.enabled).toBe(true);
    expect(typeof first?.note).toBe("string");
    expect(await loadBrochurePages(pool as any)).toBe(true);

    await runMigration();
    expect(await row()).toEqual(first);
  });

  it("never turns a village's later OFF back on", async () => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES ('u-0225', 'Wren', 'wren@example.org', 'x')",
    );
    await runMigration();
    await pool.query( // module-review-ok: fixture standing in for the village's own switch
      "UPDATE `app_config` SET `value` = '{\"enabled\": false}' WHERE `config_key` = 'brochure-pages'",
    );
    await runMigration();
    expect((await row())?.enabled).toBe(false);
    expect(await loadBrochurePages(pool as any)).toBe(false);
  });
});
