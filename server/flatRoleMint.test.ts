/**
 * THE FLAT ROLE MINT IS OFF (Rye, 2026-11-01, item 13): "Yes send a lane to
 * turn off the automatic mint - if this is turned on again it would be
 * attached to those who are paying members, so that each cycle they're paying
 * membership dues they're getting these tokens minted to them."
 *
 * The mint was the `role.cycle` rules' own flat amounts: 50 Voice and 25
 * Credits to every live seat every cycle (economySeed.ts, and 0125 for the
 * Credits row). "Off" here means the flat AMOUNT goes blank. The rule itself
 * stays enabled, because an enabled `role.cycle` rule is also what lets a
 * role's own pay list (`value_tokens`) pay that token, and disabling it would
 * stop every role's pay with it.
 *
 * What each case defends, driven through the real settlement:
 *
 *   a new village is seeded with no flat amount on a role rule
 *   a running village keeps THIS cycle's flat pay, and has none from the next
 *   a role that names its own pay is still paid, before and after
 *   a change an admin had already queued keeps its moon, ceiling and switch
 *   a rule with no flat amount is left alone, and a second run changes nothing
 *   no other trigger is touched
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { CREDITS, cycleWindow, ensureVoiceToken, runSettlement, VILLAGE_VOICE, villageId } from "./lib/economy";
import { seedEconomy } from "./lib/economySeed";
import { blankFlatRoleMint } from "./lib/flatRoleMint";
import { currentCycleNumber } from "./lib/gratitude-cycles";
import { loadTokenRegistry, memberAccount } from "./lib/ledger";
import { loadVariables } from "./lib/variables";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

async function setRule(id: string, trigger: string, token: string, amount: number | null, ceiling = 250): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`, `effective_from_cycle`) " +
      "VALUES (?,?,?,?,?,?,?,1,0)",
    [id, villageId(), trigger, token, amount, ceiling, trigger === "role.cycle" ? "holder" : "claimant"],
  );
}

async function ruleRow(id: string): Promise<any> {
  const [rows] = await pool.query<any[]>("SELECT * FROM `mint_rules` WHERE `id` = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return rows[0];
}

async function makeMember(id: string): Promise<string> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@examples.invalid`],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
    [memberAccount(id), "member", id, id],
  );
  return id;
}

async function seat(seatId: string, roleId: string, userId: string, tokens: Array<{ token: string; amount: number }> | null): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `org_roles` (`id`, `name`, `value_tokens`) VALUES (?,?,?)",
    [roleId, roleId, tokens === null ? null : JSON.stringify(tokens)],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `is_example`) VALUES (?,?,'member',?,?,0)",
    [seatId, roleId, userId, userId],
  );
}

/** Every role-cycle leg one member has received, as token and minor units. */
async function rolePayTo(userId: string): Promise<Array<[string, number]>> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT `token_type`, `amount` FROM `token_ledger` WHERE `source` = 'role_cycle' AND `to_account` = ? ORDER BY `at`, `token_type`",
    [memberAccount(userId)],
  );
  return rows.map((r) => [String(r.token_type), Number(r.amount)]);
}

describe.skipIf(!configured)("the flat role mint is off from the next cycle", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    await loadVariables(pool);
    await ensureVoiceToken(pool, "Village Voice");
    await loadTokenRegistry(pool);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    for (const t of ["org_role_assignments", "org_roles", "mint_rules"]) {
      await pool.query("DELETE FROM `" + t + "`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
    await pool.query("DELETE FROM `token_ledger` WHERE `source` = 'role_cycle'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  it("seeds a new village's role rules with no flat amount, still switched on", async () => {
    await seedEconomy(pool, villageId());
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `token_slug`, `amount`, `enabled` FROM `mint_rules` WHERE `trigger` = 'role.cycle' AND `token_slug` IN (?,?)",
      [VILLAGE_VOICE, CREDITS],
    );
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.amount, `${r.token_slug} carries no flat amount`).toBeNull();
      expect(Number(r.enabled), `${r.token_slug} stays on, so a role's own list can pay it`).toBe(1);
    }
  });

  it("keeps this cycle's flat pay, pays none from the next, and still pays a role its own list", async () => {
    await setRule("flat-credits", "role.cycle", CREDITS, 25);
    await setRule("flat-voice", "role.cycle", VILLAGE_VOICE, 50, 200);
    const flat = await makeMember("frm-flat");
    const own = await makeMember("frm-own");
    await seat("frm-seat-flat", "frm-role-flat", flat, null);
    await seat("frm-seat-own", "frm-role-own", own, [{ token: CREDITS, amount: 100 }]);

    const now = new Date();
    await blankFlatRoleMint(pool, now);
    const credits = await ruleRow("flat-credits");
    expect(Number(credits.amount), "the live amount serves out this cycle").toBe(25);
    expect(credits.pending_amount, "and goes blank").toBeNull();
    expect(Number(credits.pending_from_cycle), "from the next cycle").toBe(currentCycleNumber(now) + 1);
    expect(Number(credits.pending_enabled), "with the rule still on").toBe(1);

    await runSettlement(pool, now);
    const flatThisCycle = await rolePayTo(flat);
    expect(flatThisCycle.length, "this cycle still pays the flat Credits and Voice").toBe(2);
    expect((await rolePayTo(own)).length).toBe(1);

    const next = new Date(cycleWindow(now).endsAt.getTime() + 60 * 60 * 1000);
    await runSettlement(pool, next);
    expect(await rolePayTo(flat), "nothing flat from the next cycle").toEqual(flatThisCycle);
    expect((await rolePayTo(own)).length, "a role's own list is still paid").toBe(2);
    expect((await ruleRow("flat-credits")).amount, "the blank has landed").toBeNull();
  });

  it("keeps an admin's queued change, blanking only its amount", async () => {
    await setRule("flat-credits", "role.cycle", CREDITS, 25);
    const later = currentCycleNumber(new Date()) + 3;
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "UPDATE `mint_rules` SET `pending_amount` = 30, `pending_ceiling` = 300, `pending_enabled` = 0, `pending_from_cycle` = ? WHERE `id` = 'flat-credits'",
      [later],
    );
    await blankFlatRoleMint(pool);
    const r = await ruleRow("flat-credits");
    expect(r.pending_amount).toBeNull();
    expect(Number(r.pending_ceiling)).toBe(300);
    expect(Number(r.pending_enabled)).toBe(0);
    expect(Number(r.pending_from_cycle), "it lands on the moon the admin chose").toBe(later);
  });

  it("leaves a rule with no flat amount alone, touches no other trigger, and changes nothing on a second run", async () => {
    await setRule("blank-voice", "role.cycle", VILLAGE_VOICE, null, 200);
    await setRule("quest-credits", "quest.completed", CREDITS, 25);
    await setRule("flat-credits", "role.cycle", CREDITS, 25);
    await blankFlatRoleMint(pool);
    const once = { blank: await ruleRow("blank-voice"), quest: await ruleRow("quest-credits"), flat: await ruleRow("flat-credits") };
    expect(once.blank.pending_from_cycle, "nothing to blank").toBeNull();
    expect(once.quest.pending_from_cycle, "quest pay is not the role mint").toBeNull();
    expect(Number(once.quest.amount)).toBe(25);
    await blankFlatRoleMint(pool);
    const twice = await ruleRow("flat-credits");
    expect(twice.pending_from_cycle).toEqual(once.flat.pending_from_cycle);
    expect(twice.pending_amount).toBeNull();
  });
});
