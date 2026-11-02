/**
 * RYE, 2026-10-23, AND WHAT EACH RULING DOES TO A LEDGER ROW.
 *
 *   1. "badges that have multipliers should multiply token pay (the multiplier
 *      is attached to a token, so voice, credits, etc)"
 *   2. "definitely a work token. GRATITUDE is only sent from player to player
 *      using the send gratitude function, gratitude is not distributed in any
 *      other way!"
 *
 * Every case reads the ledger back. A badge multiplier is asserted on the
 * posted units of the token it names and on the units of one it does not; an
 * accepted proposal on the rows it posts and on the Gratitude it no longer
 * mints; each closed door on what it refuses AND on what still passes through
 * it, so a refusal that refused everything would not pass.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import {
  CREDITS,
  ensureVoiceToken,
  HEARTS,
  owedForClaim,
  postOwed,
  quoteWorkPay,
  runSettlement,
  VILLAGE_VOICE,
  villageId,
} from "./lib/economy";
import { seedEconomy } from "./lib/economySeed";
import { balanceOf, loadTokenRegistry, memberAccount, TREASURY } from "./lib/ledger";
import { loadVariables } from "./lib/variables";
import { rewardMultipliersFor, MAX_REWARD_MULTIPLIER } from "./lib/seasonPatterns";
import { payAcceptedProposal } from "./lib/proposalAward";
import { badgeProblem } from "./lib/badges";
import { unitProblem } from "./lib/resources";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { GRATITUDE_ONLY_SENT } from "../shared/workValue";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

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

async function badge(id: string, kind: string, multipliers: Record<string, number> | null): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `badges` (`id`, `name`, `kind`, `capabilities`, `denies`, `multipliers`, `active`) VALUES (?,?,?,'[]','[]',?,1) " +
      "ON DUPLICATE KEY UPDATE `multipliers` = VALUES(`multipliers`)",
    [id, id, kind, multipliers ? JSON.stringify(multipliers) : null],
  );
}

async function award(badgeId: string, userId: string): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT IGNORE INTO `badge_awards` (`id`, `badge_id`, `user_id`) VALUES (?,?,?)",
    [`aw-${badgeId}-${userId}`, badgeId, userId],
  );
}

/** Minor units of one token, off the registry's own scale. */
async function unitsOf(slug: string, human: number): Promise<number> {
  const [rows] = await pool.query<any[]>("SELECT `decimals` FROM `tokens` WHERE `slug` = ?", [slug]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return Math.round(human * 10 ** Number(rows[0]?.decimals ?? 0));
}

describe.skipIf(!configured)("badge multipliers name a token, and Gratitude is only ever sent", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    await loadVariables(pool);
    await ensureVoiceToken(pool, "Village Voice");
    await seedEconomy(pool, villageId());
    await loadTokenRegistry(pool);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  // ── 1. A badge multiplies the token it names ─────────────────────────────

  describe("a badge's multipliers", () => {
    it("compound per token, stop at the limit, and skip a sleeping, self or Gratitude one", async () => {
      const u = await makeMember("bm-holder");
      await badge("bm-elder", "granted", { [VILLAGE_VOICE]: 1.5, [CREDITS]: 2 });
      await badge("bm-steward", "granted", { [VILLAGE_VOICE]: 2.5 });
      await badge("bm-self", "self", { [CREDITS]: 3 });
      await badge("bm-asleep", "granted", { [CREDITS]: 3 });
      await badge("bm-thanks", "granted", { [HEARTS]: 2 });
      for (const b of ["bm-elder", "bm-steward", "bm-self", "bm-asleep", "bm-thanks"]) await award(b, u);

      const boost = await rewardMultipliersFor(pool, u, ["bm-asleep"]);
      // Voice: 1.5 x 2.5 = 3.75, held at the limit. Credits: 2 from the one
      // awake granted badge; the self badge and the sleeping one add nothing.
      expect(boost).toEqual({ [VILLAGE_VOICE]: MAX_REWARD_MULTIPLIER, [CREDITS]: 2 });
      expect(boost[HEARTS]).toBeUndefined();
      // Nobody else is touched.
      expect(await rewardMultipliersFor(pool, await makeMember("bm-nobody"), [])).toEqual({});
    });

    it("multiply what a quest pays in that token, and only that token", async () => {
      const plain = quoteWorkPay([{ tokenSlug: CREDITS, amount: 25 }, { tokenSlug: VILLAGE_VOICE, amount: 10 }], null, "quest");
      const boosted = quoteWorkPay([{ tokenSlug: CREDITS, amount: 25 }, { tokenSlug: VILLAGE_VOICE, amount: 10 }], null, "quest", { [CREDITS]: 2 });
      expect(boosted.lines.find((l) => l.token === CREDITS)?.units).toBe(2 * plain.lines.find((l) => l.token === CREDITS)!.units);
      expect(boosted.lines.find((l) => l.token === VILLAGE_VOICE)?.units).toBe(plain.lines.find((l) => l.token === VILLAGE_VOICE)!.units);
    });

    it("reach a quest consent's owed rows through the claim", async () => {
      const u = await makeMember("bm-claimant");
      const owed = await owedForClaim(pool, { id: "bm-claim-1", questId: "bm-q", userId: u, boost: { [CREDITS]: 2 } });
      // The seeded quest rules: 25 credits and 10 voice.
      expect(owed.owed.find((o) => o.tokenSlug === CREDITS)?.units).toBe(await unitsOf(CREDITS, 50));
      expect(owed.owed.find((o) => o.tokenSlug === VILLAGE_VOICE)?.units).toBe(await unitsOf(VILLAGE_VOICE, 10));
    });

    it("reach each role holder at settlement, through the caller's reader", async () => {
      const u = await makeMember("bm-seat-holder");
      // The role names its own 25 credits: the seed's role rule carries no flat
      // amount since Rye ended the automatic role mint (2026-11-01).
      await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO `org_roles` (`id`, `name`, `value_tokens`) VALUES ('bm-role','bm-role',?)",
        [JSON.stringify([{ token: CREDITS, amount: 25 }])],
      );
      await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `is_example`) VALUES ('bm-seat','bm-role','member',?,?,0)",
        [u, u],
      );
      const before = await balanceOf(pool, memberAccount(u), CREDITS);
      await runSettlement(pool, new Date(), { boostFor: async (who): Promise<Record<string, number>> => (who === u ? { [CREDITS]: 3 } : {}) });
      // The role pays 25 credits; the holder's badge makes it 75.
      expect((await balanceOf(pool, memberAccount(u), CREDITS)) - before).toBe(await unitsOf(CREDITS, 75));
    });

    it("are judged before they are stored", () => {
      const base = { kind: "granted", capabilities: [], denies: [], rule: null };
      expect(badgeProblem({ ...base, multipliers: { [CREDITS]: 2 } })).toBeNull();
      expect(badgeProblem({ ...base, multipliers: { [HEARTS]: 2 } })).toMatch(/only sent member to member/);
      expect(badgeProblem({ ...base, multipliers: { [CREDITS]: 4 } })).toMatch(/above 3/);
      expect(badgeProblem({ ...base, multipliers: { [CREDITS]: 0.5 } })).toMatch(/below 1/);
      expect(badgeProblem({ ...base, kind: "self", multipliers: { [CREDITS]: 2 } })).toMatch(/carry no powers/);
    });
  });

  // ── 2. An accepted proposal pays work tokens, never Gratitude ────────────

  describe("an accepted Work With Us proposal", () => {
    it("pays the seeded proposal rules, multiplied by the proposer's badges, and once", async () => {
      const u = await makeMember("bm-proposer");
      const voiceBefore = await balanceOf(pool, memberAccount(u), VILLAGE_VOICE);
      const heartsBefore = await balanceOf(pool, memberAccount(u), HEARTS);
      const first = await payAcceptedProposal(pool, { submissionId: "sub-bm-1", userId: u, boost: { [VILLAGE_VOICE]: 2 } });
      expect(first.ok).toBe(true);
      expect(first.paid.map((p) => [p.token, p.amount]).sort()).toEqual([[CREDITS, 25], [VILLAGE_VOICE, 20]].sort());
      expect((await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)) - voiceBefore).toBe(await unitsOf(VILLAGE_VOICE, 20));
      // No Gratitude, from any faucet.
      expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(heartsBefore);
      const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT `token_type` FROM `token_ledger` WHERE `source` = 'proposal_accepted' AND `source_ref` = 'sub-bm-1'",
      );
      expect(rows.map((r) => r.token_type).sort()).toEqual([CREDITS, VILLAGE_VOICE].sort());
      // A second accept of the same submission pays nothing more.
      await payAcceptedProposal(pool, { submissionId: "sub-bm-1", userId: u, boost: { [VILLAGE_VOICE]: 2 } });
      expect((await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)) - voiceBefore).toBe(await unitsOf(VILLAGE_VOICE, 20));
    });
  });

  // ── 2. Every other door Gratitude came through is shut ───────────────────

  describe("the doors that are shut", () => {
    it("refuses an owed posting in Gratitude, and still pays one in credits", async () => {
      const u = await makeMember("bm-owed");
      const row = {
        toUserId: u, units: 5, decimals: 0, from: TREASURY, source: "quest_consent",
        sourceRef: "bm-owed-claim", description: "test",
      };
      const refused = await postOwed(pool, { ...row, tokenSlug: HEARTS, idempotencyKey: "bm-owed-hearts" });
      expect(refused).toMatchObject({ outcome: "refused", message: GRATITUDE_ONLY_SENT });
      const owed = await owedForClaim(pool, { id: "bm-owed-claim-2", questId: "bm-q", userId: u });
      const credits = owed.owed.find((o) => o.tokenSlug === CREDITS)!;
      expect((await postOwed(pool, credits)).outcome).not.toBe("refused");
    });

    it("refuses a circle budget in Gratitude, and still takes one in credits", () => {
      const known = (slug: string) => slug === HEARTS || slug === CREDITS;
      expect(unitProblem(`token:${HEARTS}`, known)).toBe(GRATITUDE_ONLY_SENT);
      expect(unitProblem(`token:${CREDITS}`, known)).toBeNull();
    });
  });
});
