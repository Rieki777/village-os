/**
 * WHAT A QUEST AND A ROLE PAY (0265), from the engine's own answer.
 *
 * Rye, 2026-10-21: every quest carries a value from the moment it is created,
 * and quest and role cards show every token assigned to them, or "inquire for
 * payment details" when no value is set. Gratitude is never one of them.
 *
 * The property every case here defends: the figure a card shows is the figure
 * the engine posts, because both come from `quoteWorkPay`. So the cases drive
 * the REAL pay paths (the consent's pricing and the cycle settlement) and read
 * the ledger back, and the card's answer is asked of the same data beside it.
 *
 * The two ways this could have gone wrong, and the case that would catch each:
 *
 *   a valued quest paid its own amounts AND the flat amounts, twice for one
 *   piece of work            "pays its own list and never the flat amounts"
 *   a figure a quest names held down by a ceiling, which Rye ruled out on
 *   2026-10-22 ("we definitely can't have caps on what things pay")
 *                            "pays a quest's own amount in full, far above any ceiling"
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import {
  CREDITS,
  ensureVoiceToken,
  HEARTS,
  keys,
  mintView,
  owedForClaim,
  publicRules,
  quoteWorkPay,
  rulesFor,
  runSettlement,
  VILLAGE_VOICE,
  villageId,
  type MintRule,
} from "./lib/economy";
import { balanceOf, loadTokenRegistry, memberAccount } from "./lib/ledger";
import { loadVariables } from "./lib/variables";
import { payableTokens, payLineProblem, questPay, rolePay } from "./lib/workPay";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { claimsRepo as makeClaimsRepo, questsRepo as makeQuestsRepo } from "./repos/quests";
import { register as registerQuestRoutes } from "./routes/quests";
import { GRATITUDE_NEVER_PAYS } from "../shared/workValue";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

const rule = (over: Partial<MintRule>): MintRule => ({
  id: "r",
  trigger: "quest.completed",
  tokenSlug: CREDITS,
  amount: 25,
  ceiling: 250,
  recipient: "claimant",
  enabled: true,
  effectiveFromCycle: 0,
  ...over,
});

async function setRules(trigger: string, rows: Array<{ token: string; amount: number | null; ceiling: number }>): Promise<void> {
  await pool.query("DELETE FROM `mint_rules` WHERE `village_id` = ? AND `trigger` = ?", [villageId(), trigger]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  for (const r of rows) {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`, `effective_from_cycle`) " +
        "VALUES (?,?,?,?,?,?,?,1,0)",
      [`wp-${trigger}-${r.token}`, villageId(), trigger, r.token, r.amount, r.ceiling, trigger === "role.cycle" ? "holder" : "claimant"],
    );
  }
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

/** Minor units of one token, off the registry's own scale. */
async function unitsOf(slug: string, human: number): Promise<number> {
  const [rows] = await pool.query<any[]>("SELECT `decimals` FROM `tokens` WHERE `slug` = ?", [slug]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return Math.round(human * 10 ** Number(rows[0]?.decimals ?? 0));
}

describe.skipIf(!configured)("what a quest and a role pay", () => {
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

  // ── The one pricing function ────────────────────────────────────────────

  describe("quoteWorkPay", () => {
    const rules = () => [rule({ tokenSlug: CREDITS, amount: 25, ceiling: 250 }), rule({ tokenSlug: VILLAGE_VOICE, amount: 10, ceiling: 100 })];

    it("pays the flat amounts to work with no list of its own, exactly as before", async () => {
      const q = quoteWorkPay(rules(), null, "quest");
      expect(q.source).toBe("standard");
      expect(q.lines.map((l) => [l.token, l.units])).toEqual([
        [CREDITS, await unitsOf(CREDITS, 25)],
        [VILLAGE_VOICE, await unitsOf(VILLAGE_VOICE, 10)],
      ]);
      expect(q.unpayable).toEqual([]);
    });

    it("pays its own list and never the flat amounts", async () => {
      const q = quoteWorkPay(rules(), [{ token: CREDITS, amount: 40 }], "quest");
      expect(q.source).toBe("own");
      // Denominator first: the list was priced at all.
      expect(q.lines).toHaveLength(1);
      expect(q.lines[0]).toMatchObject({ token: CREDITS, units: await unitsOf(CREDITS, 40) });
      // Voice is a flat rule this quest did not name, so it pays none.
      expect(q.lines.map((l) => l.token)).not.toContain(VILLAGE_VOICE);
    });

    it("pays nothing at all for an empty list, which is a decision", () => {
      const q = quoteWorkPay(rules(), [], "quest");
      expect(q.source).toBe("own");
      expect(q.lines).toEqual([]);
      expect(q.unpayable).toEqual([]);
    });

    it("pays a quest's own amount in full, far above any ceiling", async () => {
      // Rye, 2026-10-22: "no caps here! ... we definitely can't have caps on
      // what things pay". The rules here cap Voice at 100 and Credits at 250.
      const q = quoteWorkPay(rules(), [{ token: VILLAGE_VOICE, amount: 500 }, { token: CREDITS, amount: 25000 }], "quest");
      expect(q.lines.map((l) => [l.token, l.units])).toEqual([
        [CREDITS, await unitsOf(CREDITS, 25000)],
        [VILLAGE_VOICE, await unitsOf(VILLAGE_VOICE, 500)],
      ]);
      expect(q.unpayable).toEqual([]);
    });

    it("pays a rule's own amount in full too, whatever its ceiling says, zero included", async () => {
      // A row a ballot left at amount 25 over ceiling 5 used to pay 5, and a
      // ceiling of 0 used to pay nobody. Neither binds work now.
      for (const ceiling of [5, 0]) {
        const q = quoteWorkPay([rule({ tokenSlug: CREDITS, amount: 25, ceiling })], null, "quest");
        expect(q.lines.map((l) => [l.token, l.units]), `ceiling ${ceiling}`).toEqual([[CREDITS, await unitsOf(CREDITS, 25)]]);
      }
      const own = quoteWorkPay([rule({ tokenSlug: CREDITS, amount: 25, ceiling: 0 })], [{ token: CREDITS, amount: 900 }], "seat");
      expect(own.lines[0]?.units).toBe(await unitsOf(CREDITS, 900));
    });

    it("lets a rule that reads its amount from the work pay the work that names one, and stay quiet otherwise", async () => {
      const fromWork = [rule({ tokenSlug: CREDITS, amount: null, ceiling: 60 })];
      expect(quoteWorkPay(fromWork, [{ token: CREDITS, amount: 45 }], "quest").lines[0]?.units).toBe(await unitsOf(CREDITS, 45));
      const none = quoteWorkPay(fromWork, null, "quest");
      expect(none.lines).toEqual([]);
      expect(none.unpayable).toEqual([]);
    });

    it("refuses a token the work names with no rule behind it, because no rule lets it pay this work", () => {
      const q = quoteWorkPay([rule({ tokenSlug: CREDITS })], [{ token: VILLAGE_VOICE, amount: 5 }], "quest");
      expect(q.lines).toEqual([]);
      expect(q.unpayable).toHaveLength(1);
      expect(q.unpayable[0]).toMatchObject({ token: VILLAGE_VOICE });
      expect(q.unpayable[0].reason).toMatch(/no enabled quest rule/);
    });

    it("never pays Gratitude for work, from a rule or from a list", () => {
      const fromRule = quoteWorkPay([rule({ tokenSlug: HEARTS, amount: 50, ceiling: 300 })], null, "quest");
      expect(fromRule.lines).toEqual([]);
      expect(fromRule.unpayable).toEqual([{ token: HEARTS, reason: GRATITUDE_NEVER_PAYS }]);
      const fromList = quoteWorkPay([rule({ tokenSlug: CREDITS })], [{ token: HEARTS, amount: 50 }], "seat");
      expect(fromList.lines).toEqual([]);
      expect(fromList.unpayable).toEqual([{ token: HEARTS, reason: GRATITUDE_NEVER_PAYS }]);
    });
  });

  // ── The consent prices from it ──────────────────────────────────────────

  describe("a consent", () => {
    beforeEach(async () => {
      await setRules("quest.completed", [
        { token: CREDITS, amount: 25, ceiling: 250 },
        { token: VILLAGE_VOICE, amount: 10, ceiling: 100 },
      ]);
    });

    it("owes a valued quest its own list, keyed per token like every consent", async () => {
      const u = await makeMember("wp-consent-1");
      const out = await owedForClaim(pool, {
        id: "wp-claim-1",
        questId: "wp-q-1",
        userId: u,
        valueTokens: [{ token: CREDITS, amount: 40 }, { token: VILLAGE_VOICE, amount: 5 }],
      });
      expect(out.skipped).toBeUndefined();
      expect(out.owed.map((o) => [o.tokenSlug, o.units])).toEqual([
        [CREDITS, await unitsOf(CREDITS, 40)],
        [VILLAGE_VOICE, await unitsOf(VILLAGE_VOICE, 5)],
      ]);
      expect(out.owed[0].idempotencyKey).toBe(keys.questCompleted(villageId(), "wp-q-1", "wp-claim-1", u, CREDITS));
      expect(out.owed.every((o) => o.source === "quest_consent")).toBe(true);
    });

    it("owes an unvalued quest the flat amounts, as it always did", async () => {
      const u = await makeMember("wp-consent-2");
      const out = await owedForClaim(pool, { id: "wp-claim-2", questId: "wp-q-2", userId: u });
      expect(out.owed.map((o) => [o.tokenSlug, o.units])).toEqual([
        [CREDITS, await unitsOf(CREDITS, 25)],
        [VILLAGE_VOICE, await unitsOf(VILLAGE_VOICE, 10)],
      ]);
    });

    it("agrees with the card to the unit", async () => {
      const quest = { valueMinor: 2500000, valueCurrency: "CRC", valueTokens: [{ token: CREDITS, amount: 40 }] };
      const ruleRows = await rulesFor(pool, "quest.completed");
      const card = questPay(quest, ruleRows);
      const u = await makeMember("wp-consent-3");
      const owed = await owedForClaim(pool, { id: "wp-claim-3", questId: "wp-q-3", userId: u, valueTokens: quest.valueTokens });
      expect(card.value).toEqual({ minor: 2500000, currency: "CRC" });
      expect(card.lines.map((l) => [l.token, l.amount])).toEqual([[CREDITS, 40]]);
      expect(owed.owed.map((o) => [o.tokenSlug, o.units])).toEqual([[CREDITS, await unitsOf(CREDITS, 40)]]);
    });
  });

  // ── The cycle settlement pays from it ───────────────────────────────────

  describe("the cycle settlement", () => {
    const seat = async (id: string, roleId: string, userId: string) => {
      await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `is_example`) VALUES (?,?,'member',?,?,0)",
        [id, roleId, userId, userId],
      );
    };
    const role = async (id: string, tokens: Array<{ token: string; amount: number }> | null) => {
      await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO `org_roles` (`id`, `name`, `value_tokens`) VALUES (?,?,?)",
        [id, id, tokens === null ? null : JSON.stringify(tokens)],
      );
    };

    beforeEach(async () => {
      await pool.query("DELETE FROM `org_role_assignments`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      await pool.query("DELETE FROM `org_roles`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      await pool.query("DELETE FROM `token_ledger` WHERE `source` = 'role_cycle'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      await setRules("role.cycle", [
        { token: CREDITS, amount: 25, ceiling: 250 },
        { token: VILLAGE_VOICE, amount: 50, ceiling: 200 },
      ]);
    });

    /*
     * THE CASH A ROLE PAYS (0285): owed to each seat once per cycle, and owed
     * even when the village has no `role.cycle` rule at all, because the step
     * runs before the rules are read. The platform pays none of it.
     */
    it("owes a role's cash to each seat once per cycle, with no token rule at all", async () => {
      await pool.query("DELETE FROM `cash_owed`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      await setRules("role.cycle", []);
      const holder = await makeMember("wp-seat-cash");
      await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO `org_roles` (`id`, `name`, `cash_minor`, `cash_currency`) VALUES ('wp-role-cash', 'Treasurer', 2000000, 'CRC')",
      );
      await role("wp-role-none", null);
      await seat("wp-a-cash", "wp-role-cash", holder);
      await seat("wp-a-none", "wp-role-none", await makeMember("wp-seat-nocash"));

      const first = await runSettlement(pool);
      const again = await runSettlement(pool);
      expect(first.cashOwed, "the first run owes the one cash seat").toBe(1);
      expect(again.cashOwed, "and a rerun in the same cycle writes nothing").toBe(0);

      const [rows] = await pool.query<any[]>("SELECT * FROM `cash_owed`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      expect(rows.length, "a role that states no cash owes none").toBe(1);
      expect(rows[0]).toMatchObject({ user_id: holder, work_kind: "role", work_ref: "wp-role-cash", currency: "CRC", state: "owed" });
      expect(Number(rows[0].amount_minor)).toBe(2000000);
      expect(String(rows[0].work_title)).toBe(`Treasurer, ${first.cycleKey}`);
      // No token moved for it: cash never touches the ledger.
      const [legs] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM `token_ledger` WHERE `source` = 'role_cycle'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      expect(Number(legs[0].n)).toBe(0);
    });

    it("pays a role with its own list that list, and a role without one nothing flat", async () => {
      const own = await makeMember("wp-seat-own");
      const flat = await makeMember("wp-seat-flat");
      await role("wp-role-own", [{ token: CREDITS, amount: 100 }]);
      await role("wp-role-flat", null);
      await seat("wp-s-own", "wp-role-own", own);
      await seat("wp-s-flat", "wp-role-flat", flat);
      const before = {
        ownCredits: await balanceOf(pool, memberAccount(own), CREDITS),
        ownVoice: await balanceOf(pool, memberAccount(own), VILLAGE_VOICE),
        flatCredits: await balanceOf(pool, memberAccount(flat), CREDITS),
      };
      const out = await runSettlement(pool);
      // No flat role mint (Rye, 2026-11-01): a seat is paid its role's own list,
      // and a flat amount pays dues-paying members instead (server/duesDividend.test.ts).
      expect(out.stewardsThanked).toBe(1);
      expect((await balanceOf(pool, memberAccount(own), CREDITS)) - before.ownCredits).toBe(await unitsOf(CREDITS, 100));
      // The role's list did not name Voice, so it paid none: never the flat amount as well.
      expect((await balanceOf(pool, memberAccount(own), VILLAGE_VOICE)) - before.ownVoice).toBe(0);
      expect((await balanceOf(pool, memberAccount(flat), CREDITS)) - before.flatCredits, "a role naming nothing is paid nothing flat").toBe(0);
      // And again this cycle pays nobody twice.
      const again = await runSettlement(pool);
      expect(again.minted).toEqual([]);
      expect(again.alreadyRun).toBe(true);
    });

    it("lets a rule that reads its amount from the role pay the roles that name one", async () => {
      await setRules("role.cycle", [{ token: CREDITS, amount: null, ceiling: 80 }]);
      const u = await makeMember("wp-seat-src");
      await role("wp-role-src", [{ token: CREDITS, amount: 120 }]);
      await seat("wp-s-src", "wp-role-src", u);
      const before = await balanceOf(pool, memberAccount(u), CREDITS);
      const out = await runSettlement(pool);
      // In full: the rule's ceiling of 80 no longer binds role pay.
      expect((await balanceOf(pool, memberAccount(u), CREDITS)) - before).toBe(await unitsOf(CREDITS, 120));
      expect(out.unpayable).toEqual([]);
    });

    it("pays a role its own amount even when the rule's ceiling is zero", async () => {
      // A ceiling of 0 used to take the rule out of the run before any seat was
      // priced, so a role naming its own amount of that token was paid nothing.
      await setRules("role.cycle", [{ token: CREDITS, amount: 25, ceiling: 0 }]);
      const u = await makeMember("wp-seat-zero");
      await role("wp-role-zero", [{ token: CREDITS, amount: 300 }]);
      await seat("wp-s-zero", "wp-role-zero", u);
      const before = await balanceOf(pool, memberAccount(u), CREDITS);
      const out = await runSettlement(pool);
      expect((await balanceOf(pool, memberAccount(u), CREDITS)) - before).toBe(await unitsOf(CREDITS, 300));
      expect(out.unpayable).toEqual([]);
    });

    it("still says when a rule that reads its amount from the role is named by no role anybody holds", async () => {
      await setRules("role.cycle", [{ token: CREDITS, amount: null, ceiling: 80 }]);
      const u = await makeMember("wp-seat-none");
      await role("wp-role-none", null);
      await seat("wp-s-none", "wp-role-none", u);
      const out = await runSettlement(pool);
      expect(out.minted).toEqual([]);
      expect(out.alreadyRun).toBe(false);
      expect(out.unpayable.find((x) => x.token === CREDITS)?.reason).toMatch(/no role anybody holds names an amount/);
    });

    it("says a role's line it cannot pay once, however many seats it has", async () => {
      await setRules("role.cycle", [{ token: CREDITS, amount: 25, ceiling: 250 }]);
      await role("wp-role-many", [{ token: VILLAGE_VOICE, amount: 5 }]);
      for (const n of [1, 2, 3]) await seat(`wp-s-many-${n}`, "wp-role-many", await makeMember(`wp-many-${n}`));
      const out = await runSettlement(pool);
      expect(out.unpayable.filter((x) => x.token === VILLAGE_VOICE)).toHaveLength(1);
    });

    it("previews on the Mint panel what the settlement will post", async () => {
      await role("wp-role-p1", [{ token: CREDITS, amount: 100 }]);
      await role("wp-role-p2", null);
      await seat("wp-s-p1", "wp-role-p1", await makeMember("wp-p1"));
      await seat("wp-s-p2", "wp-role-p2", await makeMember("wp-p2"));
      const view = await mintView(pool);
      expect(view.settlementPreview.seats).toBe(2);
      // Each seat its role's own list, and nothing flat (Rye, 2026-11-01).
      const credits = view.settlementPreview.mints.find((m) => m.token === CREDITS);
      expect(credits?.units).toBe(await unitsOf(CREDITS, 100));
      expect(view.settlementPreview.mints.find((m) => m.token === VILLAGE_VOICE), "no role here names Voice").toBeUndefined();
    });

    it("prices a role's card the way it pays the seat", async () => {
      const rules = await rulesFor(pool, "role.cycle");
      const card = rolePay({ valueMinor: 4000000, valueCurrency: "CRC", valueTokens: [{ token: CREDITS, amount: 100 }] }, rules, null);
      expect(card.cadence).toBe("cycle");
      expect(card.lines.map((l) => [l.token, l.amount, l.name])).toEqual([[CREDITS, 100, expect.any(String)]]);
    });
  });

  // ── What the public feed and the editor say ─────────────────────────────

  describe("what the village says it pays", () => {
    it("tells a reader a quest with its own amount is paid that, and that Gratitude pays no work", async () => {
      await setRules("quest.completed", [
        { token: CREDITS, amount: 25, ceiling: 250 },
        { token: HEARTS, amount: 50, ceiling: 300 },
      ]);
      const feed = await publicRules(pool);
      const credits = feed.find((r) => r.trigger === "quest.completed" && /credit/i.test(r.token));
      expect(credits?.says).toMatch(/^25 .* when a steward confirms finished work; a quest that names its own amount is paid that$/);
      const hearts = feed.find((r) => r.trigger === "quest.completed" && !/credit/i.test(r.token));
      expect(hearts?.says).toMatch(/^no .* for work/);
    });

    it("offers the editor every token with a rule behind it, and never Gratitude", async () => {
      const offered = payableTokens([
        rule({ tokenSlug: CREDITS, amount: 25, ceiling: 250 }),
        rule({ tokenSlug: HEARTS, amount: 50, ceiling: 300 }),
        rule({ tokenSlug: "voice", amount: 1, ceiling: 1 }),
      ]);
      expect(offered.map((t) => t.token)).toEqual([CREDITS]);
      expect(offered[0]).toMatchObject({ standard: 25 });
      // No ceiling rides to the editor: work is paid in full.
      expect(offered[0]).not.toHaveProperty("ceiling");
    });

    it("refuses a line before it is stored, with a sentence naming what to change", () => {
      const rules = [rule({ tokenSlug: CREDITS, amount: 25, ceiling: 250 })];
      expect(payLineProblem(rules, CREDITS)).toBeNull();
      expect(payLineProblem(rules, VILLAGE_VOICE)).toMatch(/no enabled rule/);
      expect(payLineProblem(rules, HEARTS)).toBe(GRATITUDE_NEVER_PAYS);
    });
  });

  // ── The admin quest routes ──────────────────────────────────────────────

  describe("saving a quest", () => {
    type Handler = (req: any, res: any) => Promise<unknown> | unknown;
    const handlers = new Map<string, Handler>();
    const call = async (key: string, req: any = {}) => {
      const out: { status: number; body: any } = { status: 200, body: undefined };
      const res: any = {
        status(c: number) { out.status = c; return res; },
        json(b: unknown) { out.body = b; return res; },
        setHeader() { return res; },
        header() { return res; },
        send(b: unknown) { out.body = b; return res; },
      };
      await handlers.get(key)!({ params: {}, body: {}, query: {}, ...req }, res);
      return out;
    };

    beforeAll(() => {
      const record = (m: string) => (p: string, h: Handler) => void handlers.set(`${m} ${p}`, h);
      registerQuestRoutes({ get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") } as any, {
        isAdmin: async () => true,
        authedUser: async () => null,
        adminActor: () => ({ id: "founder-1" }),
        getPool: () => pool,
        uploadsDir: ".",
        members: { all: async () => [] },
        questsRepo: makeQuestsRepo(pool),
        claimsRepo: makeClaimsRepo(pool),
        crewsRepo: { all: async () => [] },
        firstName: (n: string) => n,
        notify: async () => {},
        stageOf: async () => "seed",
        loadRoles: () => [],
        roleIdsFor: () => [],
        currentPatternId: () => null,
        questConsentRecipients: async () => [],
        projectCurrency: () => "CRC",
      } as any);
    });

    beforeEach(async () => {
      await pool.query("DELETE FROM `quests`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      await setRules("quest.completed", [
        { token: CREDITS, amount: 25, ceiling: 250 },
        { token: VILLAGE_VOICE, amount: 10, ceiling: 100 },
      ]);
    });

    it("refuses a new quest with no value", async () => {
      const out = await call("POST /api/admin/quests", { body: { title: "Weed the beds" } });
      expect(out.status).toBe(400);
      expect(out.body.error).toMatch(/says what it is worth/);
    });

    it("stores the value in the village's currency, whatever the body says the currency is", async () => {
      const out = await call("POST /api/admin/quests", {
        body: { id: "wp-route-1", title: "Weed the beds", valueMinor: 2500000, valueCurrency: "USD", valueTokens: [{ token: CREDITS, amount: 40 }] },
      });
      expect(out.status).toBe(200);
      const stored = await makeQuestsRepo(pool).byId("wp-route-1");
      expect(stored).toMatchObject({ valueMinor: 2500000, valueCurrency: "CRC", valueTokens: [{ token: CREDITS, amount: 40 }] });
    });

    it("stores the cash a quest pays in the village's currency, and shows it on the card (0285)", async () => {
      const out = await call("POST /api/admin/quests", {
        body: { id: "wp-route-cash", title: "Fix the pump", valueMinor: 3000000, cashMinor: 2500000, cashCurrency: "USD", valueTokens: [{ token: CREDITS, amount: 5 }] },
      });
      expect(out.status).toBe(200);
      expect(await makeQuestsRepo(pool).byId("wp-route-cash")).toMatchObject({ cashMinor: 2500000, cashCurrency: "CRC" });
      const board = await call("GET /api/quests");
      expect(board.body.find((q: any) => q.id === "wp-route-cash").pay.cashPay).toEqual({ minor: 2500000, currency: "CRC" });
      // Zero clears it, and a save that does not carry it leaves it alone.
      await call("PUT /api/admin/quests/:id", { params: { id: "wp-route-cash" }, body: { title: "Fix the pump today" } });
      expect((await makeQuestsRepo(pool).byId("wp-route-cash"))?.cashMinor).toBe(2500000);
      await call("PUT /api/admin/quests/:id", { params: { id: "wp-route-cash" }, body: { cashMinor: 0 } });
      expect(await makeQuestsRepo(pool).byId("wp-route-cash")).toMatchObject({ cashMinor: null, cashCurrency: null });
    });

    it("refuses Gratitude before anything is written, and stores an amount far above the ceiling", async () => {
      const hearts = await call("POST /api/admin/quests", { body: { id: "wp-route-2", title: "A", valueMinor: 1, valueTokens: [{ token: HEARTS, amount: 40 }] } });
      expect(hearts.status).toBe(400);
      expect(hearts.body.error).toBe(GRATITUDE_NEVER_PAYS);
      expect(await makeQuestsRepo(pool).all()).toEqual([]);
      // The Voice rule's ceiling is 100. No cap on what work pays (Rye, 2026-10-22).
      const big = await call("POST /api/admin/quests", { body: { id: "wp-route-3", title: "B", valueMinor: 1, valueTokens: [{ token: VILLAGE_VOICE, amount: 5000 }] } });
      expect(big.status).toBe(200);
      expect((await makeQuestsRepo(pool).byId("wp-route-3"))?.valueTokens).toEqual([{ token: VILLAGE_VOICE, amount: 5000 }]);
    });

    it("leaves the value alone on a save that does not carry it, and never stores the card", async () => {
      await call("POST /api/admin/quests", { body: { id: "wp-route-4", title: "Weed", valueMinor: 500, valueTokens: [{ token: CREDITS, amount: 40 }] } });
      const board = await call("GET /api/quests");
      const listed = board.body.find((q: any) => q.id === "wp-route-4");
      // The board carries what the quest pays, from the engine.
      expect(listed.pay).toMatchObject({ value: { minor: 500, currency: "CRC" }, source: "own", cadence: "once" });
      expect(listed.pay.lines.map((l: any) => [l.token, l.amount])).toEqual([[CREDITS, 40]]);
      // A client posting the quest back as it received it, pay and all.
      const saved = await call("PUT /api/admin/quests/:id", { params: { id: "wp-route-4" }, body: { ...listed, title: "Weed the beds", valueMinor: undefined } });
      expect(saved.status).toBe(200);
      const after = await makeQuestsRepo(pool).byId("wp-route-4");
      expect(after?.title).toBe("Weed the beds");
      expect(after).toMatchObject({ valueCurrency: "CRC", valueTokens: [{ token: CREDITS, amount: 40 }] });
      expect((after as any).pay).toBeUndefined();
    });

    it("shows a quest nobody valued as having no value, so its card says to inquire", async () => {
      await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO `quests` (`id`, `title`, `gratitude`, `status`) VALUES ('wp-route-old', 'An old quest', '50-100', 'Open')",
      );
      await setRules("quest.completed", []);
      const board = await call("GET /api/quests");
      const old = board.body.find((q: any) => q.id === "wp-route-old");
      expect(old.pay).toEqual({ value: null, lines: [], source: "standard", cadence: "once", cashPay: null, badges: [] });
    });

    it("names Voice and the badge that multiplies it on the board, and leaves the figure alone (2026-10-30)", async () => {
      await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO `badges` (`id`, `name`, `kind`, `capabilities`, `denies`, `multipliers`, `active`) VALUES " +
          "('wp-b-builder','Builder','granted','[]','[]',?,1), ('wp-b-self','Self said','self','[]','[]',?,1)",
        [JSON.stringify({ [VILLAGE_VOICE]: 2 }), JSON.stringify({ [VILLAGE_VOICE]: 3 })],
      );
      try {
        await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          "INSERT INTO `quests` (`id`, `title`, `gratitude`, `status`) VALUES ('wp-route-voice', 'Mend the fence', '0', 'Open')",
        );
        const board = await call("GET /api/quests");
        const q = board.body.find((x: any) => x.id === "wp-route-voice");
        const voice = q.pay.lines.find((l: any) => l.token === VILLAGE_VOICE);
        expect(voice).toMatchObject({ amount: 10, voice: true });
        expect(q.pay.lines.find((l: any) => l.token === CREDITS).voice).toBeUndefined();
        // A self badge gates nothing and pays nothing, so it is never named.
        expect(q.pay.badges).toEqual([{ badge: "Builder", token: VILLAGE_VOICE, name: voice.name, factor: 2 }]);
      } finally {
        await pool.query("DELETE FROM `badges` WHERE `id` IN ('wp-b-builder','wp-b-self')"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      }
    });
  });
});
