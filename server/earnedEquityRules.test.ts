/**
 * EARNED EQUITY'S RULES, ON AND BLANK, FOR VILLAGES ALREADY RUNNING (Rye,
 * 2026-11-05: its meaning is set in Admin per village, "then enable the EE rule
 * seeded blank accordingly").
 *
 * New villages are seeded on and blank (economySeed.ts). A running village has
 * the rules seeded OFF with a placeholder of 1, so `enableEarnedEquityRules`
 * queues "on, amount blank" through the 0075 pending columns from the next
 * cycle. Blank pays nothing flat; a piece of work that names an amount pays
 * it, and none may name it until the village has written what it means.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { EARNED_EQUITY, villageId } from "./lib/economy";
import { enableEarnedEquityRules } from "./lib/earnedEquityRules";
import { currentCycleNumber } from "./lib/gratitude-cycles";
import { loadTokenRegistry } from "./lib/ledger";
import { loadVariables } from "./lib/variables";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

async function setRule(id: string, trigger: string, amount: number | null, enabled: boolean): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`, `effective_from_cycle`) VALUES (?,?,?,?,?,1,?,?,0)",
    [id, villageId(), trigger, EARNED_EQUITY, amount, trigger === "role.cycle" ? "holder" : "claimant", enabled ? 1 : 0],
  );
}
async function row(id: string): Promise<any> {
  const [rows] = await pool.query<any[]>("SELECT * FROM `mint_rules` WHERE `id` = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return rows[0];
}

describe.skipIf(!configured)("Earned Equity's rules go on, blank, from the next cycle", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 3 });
    await loadVariables(pool);
    await loadTokenRegistry(pool);
  }, 180_000);
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM `mint_rules`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  it("queues an off rule to go on with its amount blank, from the next cycle", async () => {
    await setRule("ee-quest", "quest.completed", 1, false);
    const now = new Date();
    await enableEarnedEquityRules(pool, now);
    const r = await row("ee-quest");
    expect(Number(r.enabled), "this cycle is untouched").toBe(0);
    expect(Number(r.pending_enabled)).toBe(1);
    expect(r.pending_amount).toBeNull();
    expect(Number(r.pending_from_cycle)).toBe(currentCycleNumber(now) + 1);
  });

  it("leaves a rule the village already switched on alone, and any other token", async () => {
    await setRule("ee-role", "role.cycle", 2, true);
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`, `effective_from_cycle`) VALUES ('credits-off',?,'quest.completed','credits',25,250,'claimant',0,0)",
      [villageId()],
    );
    await enableEarnedEquityRules(pool);
    expect((await row("ee-role")).pending_from_cycle, "a village's own choice stands").toBeNull();
    expect((await row("credits-off")).pending_from_cycle, "only Earned Equity").toBeNull();
  });

  it("leaves an off rule with a change already queued to the village's own decision", async () => {
    await setRule("ee-prop", "proposal.accepted", 1, false);
    await pool.query("UPDATE `mint_rules` SET `pending_enabled` = 0, `pending_amount` = 5, `pending_ceiling` = 5, `pending_from_cycle` = 999999 WHERE `id` = 'ee-prop'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await enableEarnedEquityRules(pool);
    const r = await row("ee-prop");
    expect(Number(r.pending_amount)).toBe(5);
    expect(Number(r.pending_from_cycle)).toBe(999999);
  });
});
