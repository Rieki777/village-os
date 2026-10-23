/**
 * 0125, run against a village that already exists.
 *
 * The migration itself is a no-op on a fresh install: migrations run before
 * `seedEconomy`, so on a new instance there are no mint rules for it to touch
 * and the seed's own defaults are the whole story. That means the harness
 * proving "every migration applies from cold" proves nothing at all about what
 * this file DOES. It only proves the SQL parses.
 *
 * The case that matters is the one the file was written for: Amora, which
 * seeded its rules months ago and so will never see a new default from
 * `economySeed.ts` again, because money rules are INSERT IF ABSENT and are
 * never updated. This suite builds that village and runs the real file at it.
 *
 * And the case it must NOT touch: a village that has been paying its seat
 * holders in Gratitude for three moons. The founder's word was that Amora's
 * ledger is empty; this file does not take that on trust, it asks the ledger,
 * and this suite proves the question is actually being asked.
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";

const configured = testDbConfigured();
const MIGRATION = path.join(process.cwd(), "drizzle", "0125_payouts_stop_defaulting_to_gratitude.sql");
const VILLAGE = "local";

let db: TestDb;
let pool: mysql.Pool;

/** The rules a village seeded BEFORE this release: gratitude on, no credits. */
async function seedTheOldWay(): Promise<void> {
  await pool.query("DELETE FROM `mint_rules`");
  await pool.query("DELETE FROM `token_ledger`");
  for (const r of [
    ["rule-quest.completed-village-voice", "quest.completed", "village-voice", 10, 100, "claimant"],
    ["rule-role.cycle-gratitude", "role.cycle", "gratitude", 20, 100, "holder"],
    ["rule-role.cycle-village-voice", "role.cycle", "village-voice", 50, 200, "holder"],
  ]) {
    await pool.query(
      "INSERT INTO `mint_rules` (`id`,`village_id`,`trigger`,`token_slug`,`amount`,`ceiling`,`recipient`,`enabled`) " +
        "VALUES (?,?,?,?,?,?,?,1)",
      [r[0], VILLAGE, r[1], r[2], r[3], r[4], r[5]],
    );
  }
}

/**
 * Run the migration file the way `server/db/migrate.ts` does: split on
 * semicolons at statement level and execute in order. Reading the real file
 * rather than restating its SQL is the point — a test that carries its own
 * copy of the statements proves the copy works.
 */
async function runMigration(): Promise<void> {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  for (const stmt of sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s && !s.split("\n").every((l) => l.trim().startsWith("--")))) {
    await pool.query(stmt);
  }
}

async function ruleRow(id: string): Promise<any> {
  const [rows] = await pool.query<any[]>("SELECT * FROM `mint_rules` WHERE `id` = ?", [id]);
  return rows[0];
}

describe.skipIf(!configured)("0125, on a village that already seeded", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 10 });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("switches the seat-holder gratitude rule off", async () => {
    await seedTheOldWay();
    expect((await ruleRow("rule-role.cycle-gratitude")).enabled).toBe(1);
    await runMigration();
    expect((await ruleRow("rule-role.cycle-gratitude")).enabled).toBe(0);
  });

  it("leaves the rule on the books, with its amount intact", async () => {
    // Off, not gone: no route in this build creates a mint rule, so a deleted
    // row is a payout the village can never make again.
    const rule = await ruleRow("rule-role.cycle-gratitude");
    expect(rule).toBeDefined();
    expect(Number(rule.amount)).toBe(20);
  });

  it("adds the two credit rules the new defaults ship with", async () => {
    const quest = await ruleRow("rule-quest.completed-credits");
    const role = await ruleRow("rule-role.cycle-credits");
    expect(quest?.enabled).toBe(1);
    expect(role?.enabled).toBe(1);
    expect(Number(quest.amount)).toBe(25);
    expect(Number(role.amount)).toBe(25);
    // Same ids the seed uses, so a village created after this release gets
    // these rows from `economySeed.ts` and the migration finds them present.
    expect(quest.village_id).toBe(VILLAGE);
  });

  it("runs twice without doing anything twice", async () => {
    // The runner keys on filename and will not replay this file, but a
    // migration that is only safe because nothing replays it is a migration
    // that breaks the first time somebody restores a backup.
    const before = await pool.query<any[]>("SELECT COUNT(*) n FROM `mint_rules`");
    await runMigration();
    const after = await pool.query<any[]>("SELECT COUNT(*) n FROM `mint_rules`");
    expect(Number((after[0] as any)[0].n)).toBe(Number((before[0] as any)[0].n));
  });

  it("does not touch a village that has been paying gratitude for seats", async () => {
    // THE GUARD. A village three moons into paying its seat holders in
    // Gratitude keeps paying them, and its founder makes that change
    // themselves. A deploy does not get to decide it.
    await seedTheOldWay();
    await pool.query(
      "INSERT INTO `token_ledger` (`id`,`from_account`,`to_account`,`token_type`,`amount`,`source`,`idempotency_key`) " +
        "VALUES ('tl-0125-history','sys:gratitude-pool','sys:treasury','gratitude',20,'role_cycle','tl-0125-history')",
    );
    await runMigration();
    expect((await ruleRow("rule-role.cycle-gratitude")).enabled).toBe(1);
  });

  it("does not switch on a credit payout under a village already issuing credits", async () => {
    await seedTheOldWay();
    await pool.query(
      "INSERT INTO `token_ledger` (`id`,`from_account`,`to_account`,`token_type`,`amount`,`source`,`idempotency_key`) " +
        "VALUES ('tl-0125-credits','sys:cycle-pool','sys:treasury','credits',500,'gratitude_pool','tl-0125-credits')",
    );
    await runMigration();
    // Starting a new payout stream under a running economy is that village's
    // decision, not a side effect of pulling an image.
    expect(await ruleRow("rule-quest.completed-credits")).toBeUndefined();
    expect(await ruleRow("rule-role.cycle-credits")).toBeUndefined();
  });
});
