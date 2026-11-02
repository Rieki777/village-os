/**
 * A FLAT ROLE AMOUNT, TURNED BACK ON, PAYS DUES-PAYING MEMBERS (item 13,
 * parts 2 and 3). Rye, 2026-11-01: "if this is turned on again it would be
 * attached to those who are paying members, so that each cycle they're paying
 * membership dues they're getting these tokens minted to them."
 *
 * Decided by the coordinator from his words: PER PAYING MEMBER, once per cycle,
 * no role needed. Rye ruled the second call himself: CARD dues only for now, so
 * "paid this cycle" is a `fiat_charges` row for a `membership` product, paid
 * inside the cycle, and a reversed charge does not count.
 *
 * Each case is one of the attacks the brief named, driven through the real
 * `runSettlement` and read back off the ledger:
 *
 *   paid dues and no role          paid once; the mint is per member
 *   paid dues and two roles        paid once, never per seat
 *   a role and no dues             nothing flat
 *   a refunded charge              nothing
 *   a former member who paid       nothing
 *   a donation, not dues           nothing
 *   dues paid late in the cycle    paid, even when the next run is in the next cycle
 *   a charge at the boundary       counts for the cycle it opens, never the one before
 *   settled twice                  paid once
 *   the flat amount blank          nothing at all, dues or not
 *   a role's own list              still paid per seat, beside the dividend
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { CREDITS, cycleWindow, ensureVoiceToken, runSettlement, VILLAGE_VOICE, villageId } from "./lib/economy";
import { loadTokenRegistry, memberAccount } from "./lib/ledger";
import { loadVariables } from "./lib/variables";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let receipt = 9000;

async function setRoleRule(token: string, amount: number | null): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`, `effective_from_cycle`) " +
      "VALUES (?,?,'role.cycle',?,?,250,'holder',1,0)",
    [`dd-role-${token}`, villageId(), token, amount],
  );
}

async function makeMember(id: string, admitted = true): Promise<string> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `membership_granted`) VALUES (?,?,?,'x',?) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@examples.invalid`, admitted ? 1 : 0],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
    [memberAccount(id), "member", id, id],
  );
  return id;
}

async function seat(seatId: string, roleId: string, userId: string, tokens: Array<{ token: string; amount: number }> | null = null): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT IGNORE INTO `org_roles` (`id`, `name`, `value_tokens`) VALUES (?,?,?)",
    [roleId, roleId, tokens === null ? null : JSON.stringify(tokens)],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `is_example`) VALUES (?,?,'member',?,?,0)",
    [seatId, roleId, userId, `${userId}:${seatId}`],
  );
}

/** One card charge against a product, the way `settleProductPurchase` records one billed period. */
async function charge(userId: string, kind: "membership" | "donation", paidAt: Date, status: "paid" | "reversed" = "paid"): Promise<void> {
  const product = `dd-product-${kind}`;
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT IGNORE INTO `payment_products` (`id`, `name`, `kind`, `amount_minor`, `recurring`, `provider`, `active`, `created_by`) VALUES (?,?,?,1000,'month','stripe',1,'admin')",
    [product, product, kind],
  );
  const purchase = `dd-pp-${userId}-${kind}-${receipt}`;
  receipt += 1;
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `product_purchases` (`id`, `product_id`, `user_id`, `amount_minor`, `receipt_no`, `status`, `periods_paid`, `paid_at`) VALUES (?,?,?,1000,?,'paid',1,?)",
    [purchase, product, userId, receipt, paidAt],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `fiat_charges` (`id`, `user_id`, `module`, `order_id`, `amount_minor`, `currency`, `status`, `paid_at`) VALUES (?,?,'commerce',?,1000,'usd',?,?)",
    [`dd-fc-${purchase}`, userId, `${purchase}#p1`, status, paidAt],
  );
}

/** Every dues-dividend leg one member has received: token and the cycle key it was paid under. */
async function dividendsTo(userId: string): Promise<Array<{ token: string; key: string }>> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT `token_type`, `idempotency_key` FROM `token_ledger` WHERE `source` = 'dues_dividend' AND `to_account` = ? ORDER BY `token_type`",
    [memberAccount(userId)],
  );
  return rows.map((r) => ({ token: String(r.token_type), key: String(r.idempotency_key) }));
}

async function roleLegsTo(userId: string): Promise<number> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT COUNT(*) AS n FROM `token_ledger` WHERE `source` = 'role_cycle' AND `to_account` = ?",
    [memberAccount(userId)],
  );
  return Number(rows[0].n);
}

const inside = (at: Date) => new Date(cycleWindow(at).startsAt.getTime() + 60 * 60 * 1000);

describe.skipIf(!configured)("a flat role amount pays dues-paying members, once a cycle", () => {
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
    for (const t of ["fiat_charges", "product_purchases", "payment_products", "org_role_assignments", "org_roles", "mint_rules", "exits"]) {
      await pool.query("DELETE FROM `" + t + "`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
    await pool.query("DELETE FROM `token_ledger` WHERE `source` IN ('dues_dividend','role_cycle')"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await setRoleRule(CREDITS, 25);
    await setRoleRule(VILLAGE_VOICE, 50);
  });

  it("pays each member whose card dues were paid this cycle once, role or no role, and nobody else", async () => {
    const now = new Date();
    const at = inside(now);
    const noRole = await makeMember("dd-payer-norole");
    const twoRoles = await makeMember("dd-payer-tworoles");
    const unpaid = await makeMember("dd-holder-unpaid");
    await seat("dd-s1", "dd-r1", twoRoles);
    await seat("dd-s2", "dd-r2", twoRoles);
    await seat("dd-s3", "dd-r3", unpaid);
    await charge(noRole, "membership", at);
    await charge(twoRoles, "membership", at);

    await runSettlement(pool, at);
    expect((await dividendsTo(noRole)).map((d) => d.token), "the mint is per member: no role needed").toEqual([CREDITS, VILLAGE_VOICE]);
    expect((await dividendsTo(twoRoles)).length, "two seats, paid once").toBe(2);
    expect(await dividendsTo(unpaid), "a role without dues is paid nothing flat").toEqual([]);
    expect(await roleLegsTo(twoRoles), "and no seat is paid the flat amount any more").toBe(0);
    expect(await roleLegsTo(unpaid)).toBe(0);

    await runSettlement(pool, at);
    expect((await dividendsTo(noRole)).length, "settled twice, paid once").toBe(2);
  });

  it("pays nothing for a refunded charge, a donation, or a former member's dues", async () => {
    const at = inside(new Date());
    const refunded = await makeMember("dd-refunded");
    const donor = await makeMember("dd-donor");
    const left = await makeMember("dd-left", false);
    await charge(refunded, "membership", at, "reversed");
    await charge(donor, "donation", at);
    await charge(left, "membership", at);
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `exits` (`id`, `user_id`, `status`, `opened_by`) VALUES ('dd-exit', ?, 'resolved', ?)",
      [left, left],
    );

    await runSettlement(pool, at);
    expect(await dividendsTo(refunded), "a reversed charge does not count").toEqual([]);
    expect(await dividendsTo(donor), "a donation is not dues").toEqual([]);
    expect(await dividendsTo(left), "a former member is not a paying member").toEqual([]);
  });

  it("pays dues paid in the last minute of a cycle, under that cycle, when the next run falls in the next", async () => {
    const window = cycleWindow(new Date());
    const late = await makeMember("dd-late");
    const opener = await makeMember("dd-opener");
    await charge(late, "membership", new Date(window.endsAt.getTime() - 60 * 1000));
    await charge(opener, "membership", window.endsAt);

    const nextRun = new Date(window.endsAt.getTime() + 60 * 60 * 1000);
    const nextKey = cycleWindow(nextRun).key;
    await runSettlement(pool, nextRun);
    const lateLegs = await dividendsTo(late);
    expect(lateLegs.length, "late dues are not lost to the boundary").toBe(2);
    for (const d of lateLegs) expect(d.key, "paid under the cycle the dues were for").toContain(window.key);
    const openerLegs = await dividendsTo(opener);
    expect(openerLegs.length).toBe(2);
    for (const d of openerLegs) {
      expect(d.key, "a charge at the boundary belongs to the cycle it opens").toContain(nextKey);
      expect(d.key).not.toContain(window.key);
    }
  });

  it("keeps a flat amount already queued to go blank paying each seat, with no dividend, until the blank lands", async () => {
    // The cycle part 1 lands in: the automatic mint is retiring, not reborn.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "UPDATE `mint_rules` SET `pending_amount` = NULL, `pending_ceiling` = 250, `pending_enabled` = 1, `pending_from_cycle` = 999999 WHERE `trigger` = 'role.cycle'",
    );
    const at = inside(new Date());
    const holder = await makeMember("dd-retiring-holder");
    const payer = await makeMember("dd-retiring-payer");
    await seat("dd-ret-1", "dd-ret-role", holder);
    await charge(payer, "membership", at);

    await runSettlement(pool, at);
    expect(await roleLegsTo(holder), "the seat keeps this cycle's flat pay").toBe(2);
    expect(await dividendsTo(payer), "and no surprise dividend appears the day the change lands").toEqual([]);
  });

  it("pays nothing flat while the amount is blank, and still pays a role its own list per seat", async () => {
    await pool.query("DELETE FROM `mint_rules`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await setRoleRule(CREDITS, null);
    await setRoleRule(VILLAGE_VOICE, null);
    const at = inside(new Date());
    const holder = await makeMember("dd-own-list");
    await seat("dd-own-1", "dd-own-role", holder, [{ token: CREDITS, amount: 40 }]);
    await charge(holder, "membership", at);

    await runSettlement(pool, at);
    expect(await dividendsTo(holder), "a blank flat amount pays no dividend").toEqual([]);
    expect(await roleLegsTo(holder), "the role's own list is paid").toBe(1);
  });
});
