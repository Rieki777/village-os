/**
 * 0211 RUN, NOT REVIEWED: redemption stays on where a member already used it.
 *
 * The file is read off disk and executed through the runner's own
 * `splitStatements`, so this exercises the bytes that run at boot. The
 * provisioned schema has already applied 0211 against an empty `redemptions`
 * table, which is itself the first case: no row, no settings row.
 *
 * WHAT IT HAS TO PROVE:
 *   1. A village with no redemption rows is left at the platform default (no
 *      `module_settings` row, so OFF).
 *   2. A village with a row, open or ended, is recorded at `members`, with one
 *      lifecycle event and no actor.
 *   3. A second run changes nothing: no second event, no changed row.
 *   4. A founder who switched it off afterwards is never switched back on by a
 *      replay.
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { splitStatements } from "./db/migrate";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[redemptionModuleSeed.migration] TEST_DATABASE_URL not set. This suite SKIPPED.");
}

const MIGRATION = path.join(process.cwd(), "drizzle", "0211_redemption_stays_on_where_it_was_used.sql");

describe.skipIf(!configured)("0211, redemption stays on where it was used", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  const runMigration = async () => {
    for (const sql of splitStatements(fs.readFileSync(MIGRATION, "utf-8"))) {
      await pool.query(sql); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
  };

  const settings = async () => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `lifecycle`, `updated_by`, `updated_at` FROM `module_settings` WHERE `module_id` = 'redemption'",
    );
    return rows;
  };

  const events = async () => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `id`, `kind`, `from_value`, `to_value`, `by_user_id` FROM `module_events` WHERE `module_id` = 'redemption'",
    );
    return rows;
  };

  const seedRow = async (id: string, state: string) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `redemptions` (`id`, `village_id`, `user_id`, `token_slug`, `amount`, `asked_for`, `state`, " +
        "`confirmed_by_mode`, `burn_key`) VALUES (?, 'village', 'wren', 'credits', 500, 'a bicycle', ?, 'steward', ?)",
      [id, state, `redemption:village:${id}:burn`],
    );
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, connectionLimit: 2, timezone: "Z" }); // module-review-ok: fixture pool on the S5 scratch schema
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM `redemptions`"); // module-review-ok: scratch-schema reset between cases
    await pool.query("DELETE FROM `module_settings` WHERE `module_id` = 'redemption'"); // module-review-ok: scratch-schema reset between cases
    await pool.query("DELETE FROM `module_events` WHERE `module_id` = 'redemption'"); // module-review-ok: scratch-schema reset between cases
  });

  it("carries the file the runner discovers, as two statements", () => {
    expect(/^\d{4}.*\.sql$/.test(path.basename(MIGRATION))).toBe(true);
    expect(splitStatements(fs.readFileSync(MIGRATION, "utf-8"))).toHaveLength(2);
  });

  it("leaves a village that never redeemed at the default, off, twice over", async () => {
    await runMigration();
    await runMigration();
    expect(await settings()).toEqual([]);
    expect(await events()).toEqual([]);
  });

  it("keeps it on for a village holding only an ENDED request, and a second run is a no-op", async () => {
    await seedRow("rdm-ended", "confirmed");
    await runMigration();
    const first = await settings();
    expect(first).toHaveLength(1);
    expect(first[0].lifecycle).toBe("members");
    expect(first[0].updated_by).toBeNull();
    const firstEvents = await events();
    expect(firstEvents).toEqual([
      { id: "mev-0211-redemption-carried", kind: "lifecycle", from_value: "off", to_value: "members", by_user_id: null },
    ]);

    await runMigration();
    expect(await settings()).toEqual(first);
    expect(await events()).toEqual(firstEvents);
  });

  it("keeps it on for a village with a request open", async () => {
    await seedRow("rdm-open", "requested");
    await runMigration();
    expect((await settings()).map((r) => r.lifecycle)).toEqual(["members"]);
    expect(await events()).toHaveLength(1);
  });

  it("never switches a founder's later OFF back on", async () => {
    await seedRow("rdm-old", "withdrawn");
    await runMigration();
    await pool.query("UPDATE `module_settings` SET `lifecycle` = 'off' WHERE `module_id` = 'redemption'"); // module-review-ok: fixture standing in for the founder's switch
    await runMigration();
    expect((await settings()).map((r) => r.lifecycle)).toEqual(["off"]);
    expect(await events()).toHaveLength(1);
  });
});
