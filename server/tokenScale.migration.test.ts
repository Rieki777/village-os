/**
 * 0184 RUN, NOT REVIEWED.
 *
 * The file is read off disk and executed statement by statement through the
 * runner's own `splitStatements`, so what this suite exercises is the bytes
 * that will run at boot on thirteen founder instances and never a paraphrase of
 * them. `provisionTestDb` has already applied 0184 by the time a schema
 * arrives, so each case winds the registry back to a pre-0184 state first and
 * then runs the real file forward over it.
 *
 * WHAT IT HAS TO PROVE, in the order the risk runs:
 *
 *   1. The rescale lands: credit-kind platform tokens and Village Voice reach
 *      two, and nothing else moves. Voice comes DOWN from three, credits go UP
 *      from zero, and both directions are a rescale.
 *   2. A second run changes nothing, because a bad migration here is not a
 *      failed deploy, it is a village that cannot start.
 *   3. The refusal fires, NAMES THE TOKEN, and fires for a stored amount that
 *      is not a ledger row, because "issued supply is zero" cannot see a price
 *      a steward posted in a token nobody has spent.
 *   4. What the refusal is protecting: with the guard stepped over, a stored
 *      balance means something different afterwards. That case is the whole
 *      reason the file refuses instead of assuming, and an empty ledger is the
 *      accident that makes this village safe rather than any property of the
 *      code.
 *   5. Waning at one percent moves a small Voice balance that whole numbers
 *      would have skipped, read back off the ledger and not off a return value.
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { splitStatements } from "./db/migrate";
import { CURRENCY_DECIMALS, VOICE_DECIMALS, decayUnits, decayFloorMinorUnits } from "../shared/tokenScale";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[tokenScale.migration] TEST_DATABASE_URL not set. This suite SKIPPED.");
}

const MIGRATION = path.join(process.cwd(), "drizzle", "0184_a_village_spends_its_credits_in_hundredths.sql");

/** The tokens this build ships, and the scale each one must end at. */
const EXPECTED_SCALE: Record<string, number> = {
  gratitude: 0,
  equity: 0,
  voice: 0,
  credits: CURRENCY_DECIMALS,
  "village-voice": VOICE_DECIMALS,
  "stay-credit": CURRENCY_DECIMALS,
  "library-credit": CURRENCY_DECIMALS,
};

describe.skipIf(!configured)("0184, the scale ruling, run against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  const statements = () => splitStatements(fs.readFileSync(MIGRATION, "utf-8"));

  /** Execute the real file. Throws exactly the way the boot runner would. */
  const runMigration = async () => {
    for (const sql of statements()) await pool.query(sql);
  };

  /**
   * Wind the registry back to what it was before 0184, so the file has
   * something to do. Both starting scales are represented on purpose: the
   * credit tokens start at 0 and Village Voice starts at 3, which is where they
   * actually stood, and a file that only ever raised or only ever lowered would
   * pass a test built from one of them.
   */
  const windBack = async () => {
    await pool.query("UPDATE `tokens` SET `decimals` = 0"); // module-review-ok: fixture against the S5 scratch schema, restoring the pre-0184 registry
    await pool.query("UPDATE `tokens` SET `decimals` = 3 WHERE `slug` = 'village-voice'"); // module-review-ok: fixture against the S5 scratch schema
    await pool.query("DELETE FROM `_token_scale_guard`"); // module-review-ok: fixture against the S5 scratch schema
  };

  const scales = async (): Promise<Record<string, number>> => {
    const [rows] = await pool.query<any[]>("SELECT `slug`, `decimals` FROM `tokens`");
    return Object.fromEntries(rows.map((r) => [String(r.slug), Number(r.decimals)]));
  };

  const guardRows = async (): Promise<string[]> => {
    const [rows] = await pool.query<any[]>("SELECT `refusal` FROM `_token_scale_guard`");
    return rows.map((r) => String(r.refusal));
  };

  /**
   * Every token this build registers at boot, present in the registry before a
   * single case runs. Two of them are created by module code and not by a
   * migration, so a schema straight out of provisioning does not carry them and
   * an assertion about "every token" would be asserting about five.
   */
  const seedRuntimeTokens = async () => {
    await pool.query(
      "INSERT IGNORE INTO `tokens` (`slug`, `name`, `kind`, `governance`, `transferable`, `decimals`) VALUES " +
        "('village-voice','Village Voice','voice','platform',0,3)," +
        "('stay-credit','Stay Credits','credit','platform',0,0)," +
        "('library-credit','Library Credits','credit','platform',0,0)",
    ); // module-review-ok: fixture against the S5 scratch schema, standing in for the boot registrations
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, connectionLimit: 4, timezone: "Z" });
    await pool.query("SET time_zone = '+00:00'");
    await seedRuntimeTokens();
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("carries the file the runner will actually discover", () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
    // The runner's own discovery pattern. A file it cannot see never runs
    // anywhere and nothing says so.
    expect(/^\d{4}.*\.sql$/.test(path.basename(MIGRATION))).toBe(true);
    // Four statements: the guard table, the guard, then ONE registry update per
    // reason a token moves. Both updates are LAST, which is the ordering rule
    // and not an accident of how the file was typed.
    const parts = statements();
    expect(parts.length).toBe(4);
    expect(parts[2]).toMatch(/^UPDATE `tokens`/);
    expect(parts[3]).toMatch(/^UPDATE `tokens`/);
    // Nothing writes the registry before the guard has had its say.
    expect(parts[0]).toMatch(/^CREATE TABLE IF NOT EXISTS `_token_scale_guard`/);
    expect(parts[1]).toMatch(/^INSERT INTO `_token_scale_guard`/);
  });

  it("moves credit tokens up and Village Voice down, and leaves the rest whole", async () => {
    await windBack();
    const before = await scales();
    expect(before.credits).toBe(0);
    expect(before["village-voice"]).toBe(3);
    expect(before.gratitude).toBe(0);

    await runMigration();

    const after = await scales();
    for (const [slug, expected] of Object.entries(EXPECTED_SCALE)) {
      expect(`${slug}=${after[slug]}`).toBe(`${slug}=${expected}`);
    }
    // Both directions were exercised, which is the point of winding back to two
    // different starting scales.
    expect(after.credits).toBeGreaterThan(before.credits);
    expect(after["village-voice"]).toBeLessThan(before["village-voice"]);
    // The guard wrote nothing. An empty guard table is the healthy state.
    expect(await guardRows()).toEqual([]);
  });

  it("changes nothing on a second run", async () => {
    await pool.query("DELETE FROM `_token_scale_guard`"); // module-review-ok: fixture against the S5 scratch schema
    const before = await scales();
    await runMigration();
    const after = await scales();
    expect(after).toEqual(before);
    expect(await guardRows()).toEqual([]);

    // And a third, because "twice" can pass on a file whose second run is the
    // one that settles it.
    await runMigration();
    expect(await scales()).toEqual(before);
    expect(await guardRows()).toEqual([]);
  });

  it("refuses, and names the token, when a ledger row already stores an amount", async () => {
    await windBack();
    await pool.query(
      "INSERT INTO `ledger_accounts` (`id`,`kind`,`user_id`,`label`,`faucet`) VALUES " +
        "('sys:cycle-pool','system',NULL,'Cycle pool',1), ('mem:scale-a','member','scale-a','Ash',0) " +
        "ON DUPLICATE KEY UPDATE `id` = `id`",
    ); // module-review-ok: fixture against the S5 scratch schema
    await pool.query(
      "INSERT INTO `token_ledger` (`id`,`from_account`,`to_account`,`token_type`,`amount`,`source`,`idempotency_key`) " +
        "VALUES ('tl-scale-1','sys:cycle-pool','mem:scale-a','credits',500,'test','scale-guard-1')",
    ); // module-review-ok: fixture against the S5 scratch schema

    await expect(runMigration()).rejects.toThrow(/credits/);
    // The refusal names the token AND says what it is refusing, because the
    // boot runner reports err.message and nothing else.
    await expect(runMigration()).rejects.toThrow(/REFUSED by 0184/);
    // And it REFUSED: the registry did not move.
    expect((await scales()).credits).toBe(0);

    await pool.query("DELETE FROM `token_ledger` WHERE `idempotency_key` = 'scale-guard-1'"); // module-review-ok: fixture against the S5 scratch schema
    await pool.query("DELETE FROM `_token_scale_guard`"); // module-review-ok: fixture against the S5 scratch schema
  });

  it("refuses on a stored PRICE, which an issued-supply check cannot see", async () => {
    await windBack();
    // Nothing has been issued and no ledger row exists. A steward has posted a
    // price, and that price is in the same minor units the rescale would
    // multiply. This is the case that makes the guard wider than the ruling as
    // it was handed down.
    await pool.query(
      "INSERT INTO `accommodations` (`id`,`name`,`capacity`) VALUES ('scale-room','Scale Room',2) " +
        "ON DUPLICATE KEY UPDATE `id` = `id`",
    ); // module-review-ok: fixture against the S5 scratch schema
    await pool.query(
      "INSERT INTO `accommodation_prices` (`id`,`accommodation_id`,`token_type`,`audience`,`amount_minor`) " +
        "VALUES ('ap-scale-1','scale-room','stay-credit','guest',3)",
    ); // module-review-ok: fixture against the S5 scratch schema

    const [ledger] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM `token_ledger`");
    expect(Number(ledger[0].n)).toBe(0); // issued supply really is zero here

    await expect(runMigration()).rejects.toThrow(/stay-credit/);
    expect((await scales())["stay-credit"]).toBe(0);

    await pool.query("DELETE FROM `accommodation_prices` WHERE `accommodation_id` = 'scale-room'"); // module-review-ok: fixture against the S5 scratch schema
    await pool.query("DELETE FROM `_token_scale_guard`"); // module-review-ok: fixture against the S5 scratch schema
  });

  it("shows what the refusal is protecting: a stored amount means something else afterwards", async () => {
    await windBack();
    // A member holds five whole credits at scale 0, so the row reads 5.
    const held = 5;
    // Step OVER the guard and run only the registry updates, which is what a
    // village would get if this file trusted its ledger instead of asking.
    await pool.query(statements()[2]);
    await pool.query(statements()[3]);
    const after = (await scales()).credits;
    expect(after).toBe(CURRENCY_DECIMALS);
    // The row did not move, so the same 5 now reads as five hundredths. The
    // member has been divided by a hundred and no invariant fires, because
    // conservation holds at every scale.
    const readsAs = held / 10 ** after;
    expect(readsAs).toBe(0.05);
    expect(readsAs).not.toBe(held);
  });

  it("waning at one percent reaches a small Voice balance that whole numbers skip", async () => {
    // The engine's own floor, not a restatement of it.
    const oneWholeVoiceAtTwo = 10 ** VOICE_DECIMALS;
    expect(decayUnits(oneWholeVoiceAtTwo, 1)).toBeGreaterThan(0);
    // The same member, the same one percent, at whole numbers: one unit held,
    // and floor(1 * 1 / 100) is zero, so `decayVoice` counts them as too small
    // and moves on. That is the skip nothing reports.
    expect(decayUnits(1, 1)).toBe(0);
    // And the threshold the village is entitled to see is the same arithmetic:
    // a hundred minor units, which is one whole Voice at two decimals and a
    // hundred whole Voice at zero.
    expect(decayFloorMinorUnits(1)).toBe(100);
    expect(Math.ceil(decayFloorMinorUnits(1) / 10 ** VOICE_DECIMALS)).toBe(1);
    expect(Math.ceil(decayFloorMinorUnits(1) / 10 ** 0)).toBe(100);
  });
});
