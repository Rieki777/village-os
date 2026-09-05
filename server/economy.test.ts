/**
 * Tests for the village economy engine.
 *
 * Every case here was a live exploit in one of the two adversarial passes over
 * the build spec. They are written against the engine rather than over HTTP on
 * purpose: a route can refuse a retry on a status check and never reach the
 * guard, which proves the route and says nothing about the rule. These call the
 * rule.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied, unique per provision. No TEST_DATABASE_URL and the suite skips
 * loudly rather than passing hollowly.
 */
import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import mysql from "mysql2/promise";
import {
  allowanceFor,
  canConfirm,
  canSettleClaim,
  checkGive,
  ceilingAtScale,
  ceilingOutcome,
  clampToCeiling,
  claimRefunds,
  publicRules,
  CREDITS,
  cycleWindow,
  decayVoice,
  economyEpoch,
  faucetFor,
  publicSupply,
  ruleCannotPay,
  economyReady,
  ensureVoiceToken,
  forgetEpoch,
  fromLedgerUnits,
  give,
  HEARTS,
  isReversed,
  keys,
  MAX_KEY,
  mint,
  mintForConfirmedClaim,
  mintView,
  queueRuleChange,
  applyPendingRules,
  rulesFor,
  reverse,
  reversePair,
  runSettlement,
  shareCapFor,
  VILLAGE_VOICE,
  VOICE_DECIMALS,
  VOICE_BRIDGE,
  VOICE_DECAY,
  VOICE_MINT,
  villageId,
  writeGratitudeRow,
  type MintRule,
} from "./lib/economy";
import { balanceOf, checkLedgerInvariants, CYCLE_POOL_FAUCET, loadTokenRegistry, memberAccount, MINT_FAUCET, postTransfer, postTransferPair, registerToken, RECOGNITION_FAUCET, TREASURY } from "./lib/ledger";
import { createExit } from "./lib/exit";
import { VOICE_SETTLED } from "./lib/voiceClaim";
import { loadVariables, numberVar, setVariable } from "./lib/variables";
import { cycleBoundsFor } from "../shared/lunar";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { sendGratitude, type GratitudeDeps } from "./lib/gratitude";
import { gratitudeLogRepo } from "./repos/gratitude";
import type { UsersRepo } from "./repos/users";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

/**
 * The stage multiplier `give` now takes (R73: one allowance, so the engine
 * reads `gratitude.base_budget` times the giver's stage the same way the
 * acknowledgement flow does). These members exist as bare rows with no
 * training, membership or quests, and the real resolver lives in the host, so
 * the tests state the multiplier they mean: 1, which is Guest, which is what
 * every registered member is at minimum.
 */
const AT_GUEST = async () => 1;

/**
 * The Hypha-governed voice mirror seeded by 0006, used here as the stand-in
 * for "a token this platform is forbidden to issue". The equity token is the
 * other one and would say the same thing, but it is a brand name and platform
 * code may not carry one (scripts/check-brand-refs.mjs).
 */
const HYPHA_MIRROR = "voice";

/**
 * The scale a token actually carries, read off the `tokens` table.
 *
 * NOT off `toLedgerUnits`: an assertion that calls the conversion under test
 * can only ever agree with it. `tokens.decimals` is the column the flip
 * migration moves, so an expectation derived from it stays true across the flip
 * rather than restating today's scale as a literal.
 */
async function scaleOf(p: mysql.Pool, slug: string): Promise<number> {
  const [rows] = await p.query<any[]>(
    "SELECT `decimals` FROM `tokens` WHERE `slug` = ?",
    [slug],
  );
  return 10 ** Number(rows[0]?.decimals ?? 0);
}

/** A member with a ledger account, which `give` needs to lock. */
async function makeMember(id: string): Promise<string> {
  await pool.query(
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@examples.invalid`],
  );
  await pool.query(
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
    [memberAccount(id), "member", id, id],
  );
  return id;
}

const rule = (over: Partial<MintRule> = {}): MintRule => ({
  id: "r1",
  trigger: "quest.completed",
  tokenSlug: HEARTS,
  amount: null,
  ceiling: 100,
  recipient: "claimant",
  enabled: true,
  effectiveFromCycle: 0,
  ...over,
});

describe.skipIf(!configured)("the village economy engine", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 10 });
    await loadTokenRegistry(pool);
    await loadVariables(pool);
    await ensureVoiceToken(pool, "Village Voice");
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  // ── Keys ─────────────────────────────────────────────────────────────────

  it("names an occurrence, so a repeatable thing repeats", () => {
    // The bug this prevents: a key of `quest.completed:<quest>` pays a weekly
    // quest once for all time, and gives eight people on a build day one
    // shared payout between them.
    const weekOne = keys.questCompleted("local", "q-swale", "claim-1", "u1", CREDITS);
    const weekTwo = keys.questCompleted("local", "q-swale", "claim-2", "u1", CREDITS);
    const otherHand = keys.questCompleted("local", "q-swale", "claim-3", "u2", CREDITS);
    expect(weekOne).not.toBe(weekTwo);
    expect(weekOne).not.toBe(otherHand);
  });

  it("keeps the same key in two villages apart", () => {
    // Two villages running the same seeded quest must not collide on a UNIQUE
    // index, and without the scope segment they would.
    expect(keys.questCompleted("alder", "q1", "c1", "u1", CREDITS)).not.toBe(
      keys.questCompleted("birch", "q1", "c1", "u1", CREDITS),
    );
  });

  it("refuses a key too long for the ledger's unique index rather than truncating", async () => {
    const huge = "x".repeat(MAX_KEY + 1);
    const res = await mint(pool, {
      toUserId: "u1",
      tokenSlug: HEARTS,
      amount: 1,
      from: RECOGNITION_FAUCET,
      source: "test",
      idempotencyKey: huge,
    });
    // Truncation is the dangerous outcome: two occurrences would collapse to
    // one string, the second would read as already-paid, and somebody simply
    // would not be paid.
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/characters/);
  });

  // ── Minting ──────────────────────────────────────────────────────────────

  it("mints once for the same occurrence key, twice over", async () => {
    const u = await makeMember("econ-mint-1");
    const key = keys.questCompleted(villageId(), "q1", "c1", u, HEARTS);
    const first = await mint(pool, {
      toUserId: u, tokenSlug: HEARTS, amount: 10,
      from: RECOGNITION_FAUCET, source: "quest_consent", idempotencyKey: key,
    });
    const second = await mint(pool, {
      toUserId: u, tokenSlug: HEARTS, amount: 10,
      from: RECOGNITION_FAUCET, source: "quest_consent", idempotencyKey: key,
    });
    expect(first.ok && first.duplicate).toBe(false);
    // A duplicate is SUCCESS: it means this occurrence already paid, which is
    // what the caller wanted to be true. Reporting failure teaches retries to
    // do something worse.
    expect(second.ok && second.duplicate).toBe(true);
    expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(10);
  });

  it("refuses zero and negative amounts", async () => {
    const u = await makeMember("econ-mint-2");
    for (const amount of [0, -5]) {
      const res = await mint(pool, {
        toUserId: u, tokenSlug: HEARTS, amount,
        from: RECOGNITION_FAUCET, source: "test",
        idempotencyKey: `neg:${amount}:${u}`,
      });
      // A negative gift debits the person being thanked. That is an attack.
      expect(res.ok).toBe(false);
    }
    expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(0);
  });

  it("refuses to mint a token governed on Hypha", async () => {
    const u = await makeMember("econ-mint-3");
    // A registered hypha token rather than the deployment's real equity slug:
    // the brand guard counts a village's name anywhere in platform code, and
    // it is right to. The rule under test is about GOVERNANCE, not about which
    // village happens to have named a token after itself.
    await registerToken(pool, {
      slug: "test-equity", name: "Test Equity", kind: "equity",
      governance: "hypha", transferable: false,
    });
    await loadTokenRegistry(pool);
    const res = await mint(pool, {
      toUserId: u, tokenSlug: "test-equity", amount: 1,
      from: RECOGNITION_FAUCET, source: "test", idempotencyKey: `hypha:${u}`,
    });
    // Hearts are recognition and equity is equity. If this platform ever
    // posted an equity token it would quietly become the source of truth for
    // the cap table, which is the one thing it must never be.
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/Hypha/);
  });

  it("clamps a from_source amount to the rule's ceiling", () => {
    // The third argument is the SCALE the answer comes back in, passed and
    // never looked up: the clamp now answers in the token's minor units,
    // because the ledger row is what a ceiling has to bind. Gratitude carries
    // 0 decimals today, so every number below is unchanged by that.
    expect(clampToCeiling(40, rule({ ceiling: 100 }), 0)).toBe(40);
    expect(clampToCeiling(4000, rule({ ceiling: 100 }), 0)).toBe(100);
    // A fixed amount ignores what the source posted entirely.
    expect(clampToCeiling(4000, rule({ amount: 20, ceiling: 100 }), 0)).toBe(20);
    // Fail closed: 0 means zero, never unlimited.
    expect(clampToCeiling(50, rule({ ceiling: 0 }), 0)).toBe(0);
    // And at a scale, which is what the answer is now in: the same rule on a
    // token at 3 decimals answers in thousandths.
    expect(clampToCeiling(40, rule({ ceiling: 100 }), 3)).toBe(40000);
  });

  // ── Gratitude ────────────────────────────────────────────────────────────

  /**
   * R73, the arithmetic, held away from the database.
   *
   * The share replaced a flat `economy.hearts_per_recipient_per_moon` of 10,
   * which meant one thing against an allowance of 30 and something entirely
   * different against 500. A share means the same thing at every stage, and
   * the two edges below are the ones worth pinning: it rounds DOWN, and it
   * never rounds down to zero.
   */
  it("caps one recipient at a share of the allowance, floored at 1", () => {
    const at = (total: number) => ({ total, spent: 0, remaining: total, cycleKey: "lunar-000001" });
    const send = (amount: number, total: number, already: number) =>
      checkGive({ fromUserId: "a", toUserId: "b", amount }, at(total), already);

    // 25% of 100 is 25, and the 26th unit to the same person is refused.
    expect(send(25, 100, 0).ok).toBe(true);
    expect(send(26, 100, 0).ok).toBe(false);
    // It is a RUNNING total for the pair, so a second small send is measured
    // against what the first one already used.
    expect(send(5, 100, 20).ok).toBe(true);
    expect(send(6, 100, 20).ok).toBe(false);
    // It rounds down: 25% of 50 is 12.5, and the ceiling is 12.
    expect(send(12, 50, 0).ok).toBe(true);
    expect(send(13, 50, 0).ok).toBe(false);
    // And it never rounds down to zero. 25% of 3 is 0.75, and a ceiling of 0
    // would refuse every gift in the village while both dials still read as
    // sane numbers.
    expect(send(1, 3, 0).ok).toBe(true);
    expect(send(2, 3, 0).ok).toBe(false);
  });

  it("blocks self-gratitude", async () => {
    const u = await makeMember("econ-self");
    const res = await give(pool, { fromUserId: u, toUserId: u, amount: 3 }, AT_GUEST);
    // Thanking yourself mints standing out of nothing, which is the cheapest
    // possible attack on a reputation number.
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/others/);
  });

  it("refuses a give from a member who does not exist", async () => {
    const to = await makeMember("econ-ghost-to");
    // A row that does not exist cannot be locked, so this must refuse rather
    // than run every guard below against an unlocked world.
    const res = await give(pool, { fromUserId: "nobody-at-all", toUserId: to, amount: 1 }, AT_GUEST);
    expect(res.ok).toBe(false);
  });

  it("holds the allowance against five simultaneous gives", async () => {
    const from = await makeMember("econ-race-from");
    const recipients = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => makeMember(`econ-race-to-${n}`)),
    );
    const before = await allowanceFor(pool, from, 1);
    // A quarter of the allowance, which at the stock dials is also exactly the
    // per-recipient share (R73): any larger and the share would refuse these
    // rather than the lock, and the test would prove nothing about the lock.
    const each = Math.max(1, Math.floor(before.total / 4));

    // Four of these fit in the allowance and the fifth does not. Fired
    // together, so the only thing that can refuse the last one is the lock.
    const results = await Promise.all(
      recipients.map((to) => give(pool, { fromUserId: from, toUserId: to, amount: each }, AT_GUEST)),
    );

    const after = await allowanceFor(pool, from, 1);
    expect(after.spent).toBeLessThanOrEqual(before.total);
    const accepted = results.filter((r) => r.ok).length;
    expect(accepted * each).toBeLessThanOrEqual(before.total);
    expect(accepted).toBeGreaterThan(0);
  });

  /*
   * THE VILLAGE AGAINST ITSELF, not one member against themselves.
   *
   * The test above fires five gives from ONE member, so the only lock it
   * exercises is the one that holds a giver against their own second tap. It
   * passed for months while the village was broken against ITSELF.
   *
   * `writeGratitudeRow` ran at SERIALIZABLE, which turns its two SUM reads
   * over `gratitude_log` into range locks, and the range every giver reads
   * overlaps every other giver's. Two members thanking somebody at the same
   * moment deadlocked, and the one InnoDB killed was handed the storage
   * engine's own words — "Deadlock found when trying to get lock; try
   * restarting transaction" — as a 400. Measured on this test before the fix:
   * at twelve concurrent givers, ten failed.
   *
   * Different givers, one gift each: nothing here is over any budget, over
   * any share, or racing itself. Every one of them MUST land, and each must
   * leave a ledger row, because the note is what spends the allowance and the
   * ledger row is the only thing that puts anything in the recipient's hands.
   */
  it("lets twenty-four different members thank the same person at once", async () => {
    const to = await makeMember("econ-crowd-to");
    const givers = await Promise.all(
      Array.from({ length: 24 }, (_, n) => makeMember(`econ-crowd-from-${n}`)),
    );

    const before = await balanceOf(pool, memberAccount(to), HEARTS);
    const results = await Promise.all(
      givers.map((from) => give(pool, { fromUserId: from, toUserId: to, amount: 1 }, AT_GUEST)),
    );

    const failures = results.filter((r) => !r.ok).map((r) => (r as any).error);
    expect(failures).toEqual([]);
    expect(results.filter((r) => r.ok).length).toBe(24);

    // The note spent the allowance; the ledger row is the delivery. One of
    // each, or a member was charged for a gift that never arrived.
    const noteIds = results.map((r) => r.noteId).filter(Boolean) as string[];
    expect(noteIds.length).toBe(24);
    const [led] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM token_ledger WHERE source = 'gratitude_received' AND source_ref IN (?)",
      [noteIds],
    );
    expect(Number(led[0].n)).toBe(24);
    expect(await balanceOf(pool, memberAccount(to), HEARTS)).toBe(before + 24);
  });

  /*
   * NO NOTE WITHOUT ITS CREDIT, under the contention that used to break the
   * pair apart.
   *
   * The note row IS the charge (the allowance is a SUM over `gratitude_log`)
   * and the ledger row is the credit. They used to be two transactions with
   * the commit of the first outside the lock of the second, so a deadlock on
   * the ledger post left the allowance spent and nothing delivered: 20, 20
   * and 30 units of 100 lost across three measured runs, invisible to every
   * surface because nothing had been created out of balance — nothing had
   * been created at all.
   *
   * This asserts the pairing directly, over every note these members write.
   */
  it("never charges a member for a credit it did not deliver", async () => {
    const from = await makeMember("econ-pair-from");
    const recipients = await Promise.all(
      Array.from({ length: 8 }, (_, n) => makeMember(`econ-pair-to-${n}`)),
    );

    // ONE giver, on purpose. Their notes serialise on their own row and every
    // one of them commits, which is exactly the condition that leaves the
    // ledger posts to race each other on the recognition faucet's account
    // row afterwards, with the budget already spent. 40 gives of 2 is 80
    // against an allowance of 100, and 10 to any one recipient against a
    // share of 25, so nothing here may be refused for any lawful reason:
    // every attempt must land AND carry its credit.
    const attempts = recipients.flatMap((to) => [to, to, to, to, to]);
    const results = await Promise.all(
      attempts.map((to) =>
        // Caught, because an uncaught throw is the loss rather than the report
        // of it, and the LEFT JOIN below is what has to see it.
        give(pool, { fromUserId: from, toUserId: to, amount: 2 }, AT_GUEST).catch(
          (e) => ({ ok: false as const, error: String(e?.message ?? e) }),
        ),
      ),
    );
    // The loss is asserted FIRST, because it is the worse failure: a give that
    // is refused costs a member a retry, and a give that is charged and never
    // delivered costs them the gift and tells nobody.
    const [orphans] = await pool.query<any[]>(
      "SELECT g.id, g.amount FROM gratitude_log g " +
        "LEFT JOIN token_ledger t ON t.source_ref = g.id AND t.source IN ('gratitude_received','heart_received') " +
        "WHERE g.from_id = ? AND t.id IS NULL",
      [from],
    );
    expect(orphans.map((r: any) => `${r.id} charged ${r.amount} and delivered nothing`)).toEqual([]);

    expect(results.filter((r) => !r.ok).map((r: any) => r.error)).toEqual([]);

    // And the recipients hold every heart the notes charged for.
    const delivered = await Promise.all(
      recipients.map((to) => balanceOf(pool, memberAccount(to), HEARTS)),
    );
    expect(delivered.reduce((a, b) => a + b, 0)).toBe(80);
  });

  /*
   * BOTH, OR NEITHER, proven on the mechanism rather than on the weather.
   *
   * The test above shows the note and its credit arriving together under
   * contention. This shows what happens when the credit genuinely cannot be
   * made: the note goes with it. A ledger refusal has real causes that no
   * retry heals — a village that has not launched, an account that does not
   * exist, an overdraft — and every one of them used to arrive AFTER the note
   * had committed and spent the budget.
   *
   * A member being told "no" and keeping their allowance is the correct
   * outcome. A member being told "no" and paying for it is the bug.
   */
  it("rolls the note back when the ledger refuses its credit", async () => {
    const from = await makeMember("econ-atomic-from");
    const to = await makeMember("econ-atomic-to");
    const before = await allowanceFor(pool, from, 1);

    const res = await writeGratitudeRow(
      pool,
      { fromUserId: from, toUserId: to, amount: 4 },
      1,
      async () => ({ ok: true }),
      async () => ({ ok: false, error: "the ledger refused the credit" }),
    );

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("the ledger refused the credit");
    // No note, so no charge: the row IS the charge.
    const [rows] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM gratitude_log WHERE from_id = ?",
      [from],
    );
    expect(Number(rows[0].n)).toBe(0);
    const after = await allowanceFor(pool, from, 1);
    expect(after.spent).toBe(before.spent);
    expect(after.remaining).toBe(before.remaining);
  });

  /*
   * AND WHEN ONE HAPPENS ANYWAY, SOMEBODY CAN SEE IT.
   *
   * `give()` cannot leave a note uncredited any more, but this is not the
   * only way a row lands in `gratitude_log`: the acknowledgement door still
   * posts its credit after the note commits, an import can backdate a cycle,
   * and a future caller can be written carelessly. A charge with no delivery
   * leaves the books perfectly balanced — conservation holds, the cache
   * agrees, nothing is negative — so every check in `checkLedgerInvariants`
   * passed over the loss and the founder's reconciliation panel said the
   * economy was clean.
   *
   * It is reported in `uncredited` and NOT in `problems`, so the founder sees
   * it and the village keeps serving. A loss is worth a person's attention;
   * it is not a reason to take the village offline, and `gratitude_log`
   * legitimately carries rows this platform never minted for.
   */
  it("shows a founder a gift that was charged and never delivered", async () => {
    const from = await makeMember("econ-seen-from");
    const to = await makeMember("econ-seen-to");
    const clean = await checkLedgerInvariants(pool);
    expect(clean.uncredited).toEqual([]);

    // The shape the bug used to leave behind: the charge, and nothing else.
    await pool.query(
      "INSERT INTO gratitude_log (id, village_id, kind, from_id, to_id, amount, message, cycle_id, cycle_number) " +
        "VALUES (?,?,?,?,?,?,?,?,?)",
      ["grat-orphan-seen", villageId(), "gratitude", from, to, 6, "", "lunar-000900", 900],
    );

    const seen = await checkLedgerInvariants(pool);
    expect(seen.uncredited.length).toBe(1);
    expect(seen.uncredited[0]).toContain("charged 6 and delivered nothing");
    // Still servable: this is a finding, not a corruption.
    expect(seen.ok).toBe(true);
    expect(seen.problems).toEqual([]);

    await pool.query("DELETE FROM gratitude_log WHERE id = ?", ["grat-orphan-seen"]);
  });

  /*
   * The allowance is still EXACTLY enforced after the isolation level came
   * down. This is the half of the fix that could have been broken silently:
   * SERIALIZABLE was doing two jobs, and only one of them was the deadlock.
   *
   * 40 gives of 5 from one member against an allowance of 100 has one right
   * answer and it is not "at most 20". Spread over 8 recipients so the
   * per-recipient share (25) never binds before the allowance does.
   */
  it("spends the allowance to the unit and not one heart further", async () => {
    const from = await makeMember("econ-exact-from");
    const recipients = await Promise.all(
      Array.from({ length: 8 }, (_, n) => makeMember(`econ-exact-to-${n}`)),
    );
    const before = await allowanceFor(pool, from, 1);
    expect(before.spent).toBe(0);
    const each = 5;
    const fits = Math.floor(before.total / each);
    // Five attempts per recipient: 5 * 5 = 25, which is exactly the share
    // cap, so the share can refuse nothing the allowance would have allowed.
    const attempts = recipients.flatMap((to) => [to, to, to, to, to]);
    expect(attempts.length).toBeGreaterThan(fits);

    const results = await Promise.all(
      attempts.map((to) => give(pool, { fromUserId: from, toUserId: to, amount: each }, AT_GUEST)),
    );

    const accepted = results.filter((r) => r.ok).length;
    expect(accepted).toBe(fits);
    const after = await allowanceFor(pool, from, 1);
    expect(after.spent).toBe(fits * each);
    expect(after.remaining).toBe(before.total - fits * each);
  });

  it("computes the allowance from the ledger rather than a counter", async () => {
    const from = await makeMember("econ-allow-from");
    const to = await makeMember("econ-allow-to");
    const before = await allowanceFor(pool, from, 1);
    const res = await give(pool, { fromUserId: from, toUserId: to, amount: 2 }, AT_GUEST);
    expect(res.ok).toBe(true);
    const after = await allowanceFor(pool, from, 1);
    // Spent is a SUM, so it cannot drift from what was actually given.
    expect(after.spent).toBe(before.spent + 2);
    expect(after.remaining).toBe(before.remaining - 2);
  });

  it("treats one tap arriving twice as one gift", async () => {
    const from = await makeMember("econ-nonce-from");
    const to = await makeMember("econ-nonce-to");
    const nonce = "tap-once-please";
    const a = await give(pool, { fromUserId: from, toUserId: to, amount: 1, clientNonce: nonce }, AT_GUEST);
    const b = await give(pool, { fromUserId: from, toUserId: to, amount: 1, clientNonce: nonce }, AT_GUEST);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
  });

  // ── Reversal ─────────────────────────────────────────────────────────────

  it("writes one mirror however many times it is reversed", async () => {
    const u = await makeMember("econ-rev-1");
    const key = keys.questCompleted(villageId(), "q-rev", "c-rev", u, HEARTS);
    await mint(pool, {
      toUserId: u, tokenSlug: HEARTS, amount: 7,
      from: RECOGNITION_FAUCET, source: "quest_consent", idempotencyKey: key,
    });
    const opts = {
      from: memberAccount(u), to: RECOGNITION_FAUCET,
      tokenSlug: HEARTS, amount: 7, note: "withdrawn",
    };
    const first = await reverse(pool, key, opts);
    const second = await reverse(pool, key, opts);
    expect(first.ok && first.duplicate).toBe(false);
    // The mirror carries its own key, so the second call is a duplicate and
    // not a second refund.
    expect(second.ok && second.duplicate).toBe(true);
    expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(0);
    expect(await isReversed(pool, key)).toBe(true);
  });

  it("refuses to reverse a reversal", async () => {
    const res = await reverse(pool, `reversal:${villageId()}:anything`, {
      from: RECOGNITION_FAUCET, to: RECOGNITION_FAUCET, tokenSlug: HEARTS, amount: 1,
    });
    // Otherwise two calls alternate forever and each one looks locally fine.
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/cannot itself be reversed/);
  });

  it("refuses to reverse a posting that never happened", async () => {
    const res = await reverse(pool, "quest.completed:local:ghost:ghost:ghost", {
      from: RECOGNITION_FAUCET, to: RECOGNITION_FAUCET, tokenSlug: HEARTS, amount: 1,
    });
    expect(res.ok).toBe(false);
  });

  it("mints cleanly as a new occurrence after a wrong reversal", async () => {
    const u = await makeMember("econ-redo");
    const wrong = keys.questCompleted(villageId(), "q-redo", "claim-a", u, HEARTS);
    await mint(pool, {
      toUserId: u, tokenSlug: HEARTS, amount: 5,
      from: RECOGNITION_FAUCET, source: "quest_consent", idempotencyKey: wrong,
    });
    await reverse(pool, wrong, {
      from: memberAccount(u), to: RECOGNITION_FAUCET, tokenSlug: HEARTS, amount: 5,
    });
    expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(0);

    // The honest re-do is a NEW claim row, so it is a new occurrence and the
    // spent key does not stand in its way.
    const redo = keys.questCompleted(villageId(), "q-redo", "claim-b", u, HEARTS);
    const res = await mint(pool, {
      toUserId: u, tokenSlug: HEARTS, amount: 5,
      from: RECOGNITION_FAUCET, source: "quest_consent", idempotencyKey: redo,
    });
    expect(res.ok && res.duplicate).toBe(false);
    expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(5);
  });

  /**
   * Rows read straight out of the database, because a return value is the one
   * witness that cannot contradict the code under test.
   */
  async function readRows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [out] = await pool.query(sql, params);
    return out as unknown as T[];
  }

  /** Every account and every faucet, one token. Double entry says zero. */
  async function conserved(token: string): Promise<number> {
    const [row] = await readRows<{ s: string | number }>(
      "SELECT COALESCE(SUM(`balance`), 0) AS s FROM `token_balances` WHERE `token_type` = ?",
      [token],
    );
    return Number(row?.s ?? 0);
  }

  interface LedgerRow {
    from_account: string;
    to_account: string;
    token_type: string;
    amount: number;
  }

  const ledgerRow = async (key: string): Promise<LedgerRow | undefined> =>
    (
      await readRows<LedgerRow>(
        "SELECT `from_account`, `to_account`, `token_type`, `amount` FROM `token_ledger` WHERE `idempotency_key` = ?",
        [key],
      )
    )[0];

  it("refuses a reversal for an amount the posting never moved", async () => {
    // THE ATTACK THIS FUNCTION WAS REWRITTEN FOR. An audit reversed a 25
    // credit posting into a 1,000,000 credit payment to the same member and
    // every invariant stayed green, because a mirror that invents its own
    // numbers still balances. The numbers come off the row now, and a caller
    // value that disagrees refuses the whole reversal before any write.
    const u = await makeMember("econ-rev-attack");
    const key = keys.questCompleted(villageId(), "q-attack", "c-attack", u, CREDITS);
    await mint(pool, {
      toUserId: u, tokenSlug: CREDITS, amount: 25,
      from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key,
    });
    expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(25);

    const inflated = await reverse(pool, key, {
      from: memberAccount(u), to: CYCLE_POOL_FAUCET, tokenSlug: CREDITS, amount: 1_000_000,
    });
    expect(inflated.ok).toBe(false);
    expect(inflated.ok === false && inflated.error).toMatch(/amount 1000000/);
    // Refused BEFORE the write, which is the only refusal worth having.
    expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(25);

    // The same attack pointed the other way: a "reversal" that pays the member
    // a second time instead of taking the first payment back.
    const paidAgain = await reverse(pool, key, {
      from: CYCLE_POOL_FAUCET, to: memberAccount(u), tokenSlug: CREDITS, amount: 25,
    });
    expect(paidAgain.ok).toBe(false);
    expect(paidAgain.ok === false && paidAgain.error).toMatch(/from/);
    expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(25);

    // A wrong token is refused on the same footing.
    const wrongToken = await reverse(pool, key, { tokenSlug: HEARTS });
    expect(wrongToken.ok).toBe(false);
    expect(wrongToken.ok === false && wrongToken.error).toMatch(/tokenSlug/);

    // Zero is a claim, not an absence: a caller that computed nothing is asking
    // for a refund it cannot describe, and gets a refusal rather than a mirror
    // derived behind its back.
    const zero = await reverse(pool, key, { amount: 0 });
    expect(zero.ok).toBe(false);
    expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(25);

    // And the true reversal, which is now the only reversal there is.
    const honest = await reverse(pool, key, { note: "withdrawn" });
    expect(honest.ok).toBe(true);
    expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(0);

    const mirrors = await readRows(
      "SELECT `id` FROM `token_ledger` WHERE `source` = 'reversal' AND `source_ref` = ?",
      [key],
    );
    expect(mirrors.length).toBe(1);
    expect(await conserved(CREDITS)).toBe(0);
  });

  it("derives the mirror from the row when the caller says only a note", async () => {
    const u = await makeMember("econ-rev-derive");
    const key = keys.questCompleted(villageId(), "q-derive", "c-derive", u, CREDITS);
    await mint(pool, {
      toUserId: u, tokenSlug: CREDITS, amount: 25,
      from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key,
    });
    expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(25);

    const out = await reverse(pool, key, { note: "nothing else supplied" });
    expect(out.ok).toBe(true);
    expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(0);

    // Read both rows. The mirror is the original with its two accounts swapped,
    // the same token, and the same number of minor units: no conversion, no
    // caller, no rounding.
    const original = await ledgerRow(key);
    const mirror = await ledgerRow(keys.reversal(villageId(), key));
    expect(original).toBeTruthy();
    expect(mirror).toBeTruthy();
    expect(mirror!.from_account).toBe(original!.to_account);
    expect(mirror!.to_account).toBe(original!.from_account);
    expect(mirror!.token_type).toBe(original!.token_type);
    expect(Number(mirror!.amount)).toBe(Number(original!.amount));
    expect(Number(mirror!.amount)).toBe(25);
    expect(await conserved(CREDITS)).toBe(0);
  });

  it("claws back value the member already spent, and says so with a negative balance", async () => {
    // The refusal this replaces was the dishonest one: the member spent the 25,
    // so taking it back cannot leave them at zero, and refusing the clawback
    // would leave the ledger insisting a withdrawn payment still stands.
    const spender = await makeMember("econ-rev-spent");
    const other = await makeMember("econ-rev-spent-to");
    const key = keys.questCompleted(villageId(), "q-spent", "c-spent", spender, CREDITS);
    await mint(pool, {
      toUserId: spender, tokenSlug: CREDITS, amount: 25,
      from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key,
    });
    // Onward, member to member, through the same guarded post every other
    // movement uses. The credits are gone from the first member's hands.
    const spent = await mint(pool, {
      toUserId: other, tokenSlug: CREDITS, amount: 25,
      from: memberAccount(spender), source: "test_spend",
      idempotencyKey: `test.spend:${villageId()}:${spender}`,
    });
    expect(spent.ok).toBe(true);
    expect(await balanceOf(pool, memberAccount(spender), CREDITS)).toBe(0);
    expect(await balanceOf(pool, memberAccount(other), CREDITS)).toBe(25);

    const back = await reverse(pool, key, { note: "quest withdrawn after the spend" });
    expect(back.ok).toBe(true);
    // The truthful state: the member owes the village 25.
    expect(await balanceOf(pool, memberAccount(spender), CREDITS)).toBe(-25);

    // Lawful, not merely permitted: the boot invariant exempts an account that
    // holds a debit from an ALLOW_NEGATIVE_SOURCES source, and `reversal` is
    // one, so this village still comes up.
    const report = await checkLedgerInvariants(pool);
    expect(report.problems.filter((p) => p.includes(memberAccount(spender)))).toEqual([]);
    expect(report.problems.filter((p) => p.includes("is negative"))).toEqual([]);
    expect(await conserved(CREDITS)).toBe(0);
  });

  it("refuses a reversal for an amount the original posting never moved", async () => {
    // THE EXPLOIT THIS CLOSES. `reverse` took its amount, its token and both
    // its accounts from the caller and checked only that SOME row carried the
    // original key. An audit reversed a 25-credit posting into a 1,000,000
    // payment to the same member and every invariant stayed green, because a
    // mirror is two legs and conservation balances at any size.
    const u = await makeMember("econ-rev-amount");
    const key = keys.questCompleted(villageId(), "q-mint", "c-mint", u, HEARTS);
    await mint(pool, {
      toUserId: u, tokenSlug: HEARTS, amount: 25,
      from: RECOGNITION_FAUCET, source: "quest_consent", idempotencyKey: key,
    });

    const inflated = await reverse(pool, key, {
      from: RECOGNITION_FAUCET, to: memberAccount(u), tokenSlug: HEARTS, amount: 1_000_000,
    });

    expect(inflated.ok).toBe(false);
    expect(inflated.ok === false && inflated.error).toMatch(/undoes exactly what was posted/);
    // THE OUTCOME: nothing was paid, and the original still stands unreversed,
    // so the honest correction is still available to whoever needs it.
    expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(25);
    expect(await isReversed(pool, key)).toBe(false);
  });

  it("refuses a reversal that runs the wrong way, and one in the wrong token", async () => {
    const u = await makeMember("econ-rev-shape");
    const key = keys.questCompleted(villageId(), "q-shape", "c-shape", u, HEARTS);
    await mint(pool, {
      toUserId: u, tokenSlug: HEARTS, amount: 4,
      from: RECOGNITION_FAUCET, source: "quest_consent", idempotencyKey: key,
    });

    // A mirror that pays the member AGAIN rather than clawing back.
    const backwards = await reverse(pool, key, {
      from: RECOGNITION_FAUCET, to: memberAccount(u), tokenSlug: HEARTS, amount: 4,
    });
    expect(backwards.ok).toBe(false);

    // A mirror in a token the original never touched.
    const wrongToken = await reverse(pool, key, {
      from: memberAccount(u), to: RECOGNITION_FAUCET, tokenSlug: VILLAGE_VOICE, amount: 4,
    });
    expect(wrongToken.ok).toBe(false);

    expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(4);
    expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(0);
  });

  it("reads the mirror off the original row when the caller names nothing", async () => {
    // The other half of the same rule: derived is not merely CHECKED against
    // the caller, it is the source. A caller that asserts nothing still gets
    // the true opposite of what was posted.
    const u = await makeMember("econ-rev-derived");
    const key = keys.questCompleted(villageId(), "q-derived", "c-derived", u, HEARTS);
    await mint(pool, {
      toUserId: u, tokenSlug: HEARTS, amount: 9,
      from: RECOGNITION_FAUCET, source: "quest_consent", idempotencyKey: key,
    });

    const back = await reverse(pool, key);

    expect(back.ok).toBe(true);
    expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(0);
  });

  it("claws back value the member has already spent, and says so as a negative", async () => {
    // A correction that cannot complete is not a correction. This member was
    // wrongly credited and has already spent it, so the clawback has to be
    // able to take them below zero: the alternative is that the mistaken
    // credit stands and the only repair left is a hand-written ledger row.
    //
    // What a negative balance MEANS: this member holds less than nothing until
    // new earnings bring them back to zero. The ledger's overdraft check
    // refuses any further spend that would take an account below zero, so they
    // cannot spend while under water, and the figure sits in the balance every
    // surface already reads rather than in a suspense account beside it.
    const u = await makeMember("econ-rev-negative");
    const key = keys.questCompleted(villageId(), "q-spent", "c-spent", u, HEARTS);
    await mint(pool, {
      toUserId: u, tokenSlug: HEARTS, amount: 12,
      from: RECOGNITION_FAUCET, source: "quest_consent", idempotencyKey: key,
    });
    // Spent: it left their account and is not coming back on its own.
    const spent = await postTransfer(pool, {
      from: memberAccount(u), to: RECOGNITION_FAUCET, tokenType: HEARTS, amount: 12,
      source: "manual", idempotencyKey: `spend:${key}`,
    });
    expect(spent.ok).toBe(true);
    expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(0);

    const back = await reverse(pool, key);

    // THE OUTCOME. Without `reversal` in ALLOW_NEGATIVE_SOURCES the overdraft
    // check refuses this and the balance stays at 0 with the bad credit
    // standing; with it the correction lands and the debt is visible.
    expect(back.ok).toBe(true);
    expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(-12);
    expect(await isReversed(pool, key)).toBe(true);
  });

  // ── Two-party consent ────────────────────────────────────────────────────

  it("refuses a steward witnessing their own work", () => {
    // Confirming releases value, so doing it for yourself has to be
    // structurally impossible, admin included.
    expect(canConfirm("u1", "u1").ok).toBe(false);
    expect(canConfirm("u1", "u2").ok).toBe(true);
    // A confirmation with nobody behind it is not a confirmation.
    expect(canConfirm("u1", "").ok).toBe(false);
  });

  // ── Voice claims ─────────────────────────────────────────────────────────

  it("will not cancel or refund a confirmed claim", () => {
    // The one that costs real value: a cancel arriving after a confirm refunds
    // voice the member has also already received on Hypha.
    expect(canSettleClaim("confirmed", "canceled").ok).toBe(false);
    expect(canSettleClaim("confirmed", "stale").ok).toBe(false);
    expect(canSettleClaim("confirmed", "rejected").ok).toBe(false);
  });

  it("refunds a cancelled claim exactly once", () => {
    expect(canSettleClaim("requested", "canceled").ok).toBe(true);
    // The second cancel finds the claim already settled and does nothing.
    expect(canSettleClaim("canceled", "canceled").ok).toBe(false);
  });

  it("refunds a rejection, because nothing is confiscated for losing a vote", () => {
    expect(canSettleClaim("requested", "rejected").ok).toBe(true);
    expect(claimRefunds("rejected")).toBe(true);
    expect(claimRefunds("canceled")).toBe(true);
    expect(claimRefunds("stale")).toBe(true);
    expect(claimRefunds("confirmed")).toBe(false);
  });

  it("never lets a settled claim go back to requested", () => {
    expect(canSettleClaim("requested", "requested").ok).toBe(false);
  });

  it("registers the village voice as a platform token it can actually accrue", async () => {
    const u = await makeMember("econ-voice");
    const res = await mint(pool, {
      toUserId: u, tokenSlug: VILLAGE_VOICE, amount: 1,
      from: VOICE_MINT, source: "quest_consent",
      idempotencyKey: keys.questCompleted(villageId(), "q-v", "c-v", u, VILLAGE_VOICE),
    });
    // The `voice` row seeded in 0006 is governance:'hypha', which validateLeg
    // refuses to move and a boot invariant requires to hold zero rows. Voice
    // has to accrue somewhere before it can be claimed, so the village's own
    // voice token is a separate, platform-governed slug.
    expect(res.ok).toBe(true);
    expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(1);
  });

  // ── The epoch and the flag ───────────────────────────────────────────────

  it("stamps an epoch on first read and keeps it", async () => {
    forgetEpoch();
    const first = await economyEpoch(pool);
    forgetEpoch();
    const second = await economyEpoch(pool);
    // Without a stored epoch, every quest ever consented becomes an unpaid
    // mint the moment the engine reads the table, and the first settlement
    // pays out years of backlog nobody chose.
    expect(second.getTime()).toBe(first.getTime());
  });

  // ── What a confirmed claim mints ─────────────────────────────────────────

  describe("a confirmed claim", () => {
    beforeAll(async () => {
      await pool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
          "VALUES ('rule-voice', ?, 'quest.completed', ?, 0.1000, 1, 'claimant', 1) " +
          "ON DUPLICATE KEY UPDATE `enabled` = 1",
        [villageId(), VILLAGE_VOICE],
      );
    });

    it("mints the village voice the rule describes", async () => {
      const u = await makeMember("econ-src-1");
      const out = await mintForConfirmedClaim(pool, {
        id: "claim-src-1", questId: "q-src", userId: u, confirmedAt: new Date(),
      });
      expect(out.skipped).toBeUndefined();
      expect(out.minted.map((m) => m.token)).toContain(VILLAGE_VOICE);

      // AND IT REPORTS WHAT IT POSTED. The rule reads 0.1 and the ledger row
      // holds 100 thousandths; this used to report the 0.1, which made the
      // caller's log and the ledger two different accounts of one payment with
      // nothing to reconcile them against. `runSettlement` already reported
      // units, so the two mint paths disagreed with each other as well.
      const voice = out.minted.find((m) => m.token === VILLAGE_VOICE);
      expect(voice?.units).toBe(100);
      expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(voice?.units);
    });

    it("does not mint Hearts again, because consent already did", async () => {
      const u = await makeMember("econ-src-2");
      const out = await mintForConfirmedClaim(pool, {
        id: "claim-src-2", questId: "q-src", userId: u, confirmedAt: new Date(),
      });
      // The consent route has minted recognition since S7 with the range, the
      // cap and the standing multiplier. A rule minting it again pays twice
      // for one piece of work.
      expect(out.minted.map((m) => m.token)).not.toContain(HEARTS);
      expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(0);
    });

    it("pays one occurrence once, however many times it is confirmed", async () => {
      const u = await makeMember("econ-src-3");
      const claim = { id: "claim-src-3", questId: "q-src", userId: u, confirmedAt: new Date() };
      await mintForConfirmedClaim(pool, claim);
      const again = await mintForConfirmedClaim(pool, claim);
      expect(again.minted).toHaveLength(0);
      // 0.1 Voice is what the rule promises, and the ledger holds it in the
      // token's own minor units: a rule of 0.1 posted with no conversion posts
      // nothing at all and leaves a member unpaid with no error anywhere. The
      // expectation is 0.1 times the scale the registry says, so it reads 100
      // at three decimals and 1000 at four without being edited.
      const voiceUnits = Math.round(0.1 * (await scaleOf(pool, VILLAGE_VOICE)));
      expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(voiceUnits);
      expect(fromLedgerUnits(VILLAGE_VOICE, voiceUnits)).toBeCloseTo(0.1);
    });

    it("treats a confirmation older than the epoch as history", async () => {
      const u = await makeMember("econ-src-4");
      const out = await mintForConfirmedClaim(pool, {
        id: "claim-src-4", questId: "q-src", userId: u,
        confirmedAt: new Date("2020-01-01T00:00:00Z"),
      });
      // The day the flag flips, every quest ever consented would otherwise
      // become a payable backlog and the first settlement would pay out years
      // of it at once. Nobody decided that; it is just what the query returns.
      expect(out.skipped).toMatch(/epoch/);
      expect(out.minted).toHaveLength(0);
      expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(0);
    });
  });

  // ── A rule that cannot pay says so ───────────────────────────────────────
  //
  // Measured on this build before the fix: a `quest.completed` rule on
  // `credits`, enabled, in force, after the epoch, returned `{ minted: [] }`
  // with no `skipped` reason and left the member's balance at 0. Nothing threw
  // and nothing logged. The Mint panel went on listing the rule as enabled and
  // `publicRules` went on publishing it as "25 Village Credits when a steward
  // confirms finished work". `faucetFor` returned null for `credits` and both
  // mint paths did `if (!faucet) continue`.
  //
  // Two separate defects, so two separate groups of tests: the engine could not
  // mint the token, and the engine did not say that it could not.

  describe("paying in village credits", () => {
    beforeAll(async () => {
      await pool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
          "VALUES ('rule-credits-test', ?, 'quest.completed', ?, 25, 250, 'claimant', 1) " +
          "ON DUPLICATE KEY UPDATE `enabled` = 1, `amount` = 25",
        [villageId(), CREDITS],
      );
    });

    it("issues credits from the cycle pool, which is where credits come from", () => {
      // Not sys:mint. That faucet's negative balance is each MODULE voucher's
      // outstanding supply; the cycle pool's is credits released to date, and
      // a quest releasing credits is a release. One counter, one answer to
      // "how many credits exist".
      expect(faucetFor(CREDITS)).toBe(CYCLE_POOL_FAUCET);
    });

    it("actually pays a member the credits the rule promises", async () => {
      const u = await makeMember("econ-credits-1");
      const out = await mintForConfirmedClaim(pool, {
        id: "claim-credits-1", questId: "q-credits", userId: u, confirmedAt: new Date(),
      });
      expect(out.minted.map((m) => m.token)).toContain(CREDITS);
      // The assertion that would have caught the original defect. 25 is what
      // the rule promises, in credits; the ledger holds 25 times whatever scale
      // the registry gives that token, which is 25 today and 250000 after the
      // flip. `minted[].amount` above is the HUMAN figure and stays 25 at both.
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(
        25 * (await scaleOf(pool, CREDITS)),
      );
    });

    it("counts what it issued against the cycle pool, not against nothing", async () => {
      // Conservation is the invariant every other surface is built on. A mint
      // that credited a member without debiting a faucet would still balance
      // only if it never happened at all, which is exactly the bug.
      const issued = await balanceOf(pool, CYCLE_POOL_FAUCET, CREDITS);
      expect(issued).toBeLessThan(0);
    });

    it("shows the credits it issued on the public supply feed", async () => {
      // `sys:cycle-pool` was missing from this feed's faucet list, so a village
      // publishing its books showed every token except the one members spend.
      const supply = await publicSupply(pool);
      expect(supply.tokens.map((t) => t.token)).toContain("Village Credits");
    });
  });

  describe("a rule the engine cannot honour", () => {
    it("names the reason rather than skipping in silence", async () => {
      // `voice` is the read-only Hypha mirror seeded by 0006. A village that
      // points a rule at a Hypha-governed token is asking this platform to
      // become the source of truth for something that lives on Base, which it
      // must refuse. Refusing is correct; refusing without saying so is the
      // defect. (The equity token is the other one of these, and is not named
      // here because it is a brand name and platform code may not carry one.)
      const problem = ruleCannotPay(HYPHA_MIRROR);
      expect(problem).toBeTruthy();
      expect(problem).toMatch(/Hypha/);
      // And a token that is not in the registry at all.
      expect(ruleCannotPay("no-such-token")).toMatch(/no token called/);
      // The tokens a village actually pays in are all payable.
      expect(ruleCannotPay(CREDITS)).toBeNull();
      expect(ruleCannotPay(VILLAGE_VOICE)).toBeNull();
      expect(ruleCannotPay(HEARTS)).toBeNull();
    });

    it("reports an unpayable quest rule to the caller", async () => {
      await pool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
          "VALUES ('rule-unpayable-test', ?, 'quest.completed', ?, 5, 50, 'claimant', 1) " +
          "ON DUPLICATE KEY UPDATE `enabled` = 1",
        [villageId(), HYPHA_MIRROR],
      );
      const u = await makeMember("econ-unpayable-1");
      const out = await mintForConfirmedClaim(pool, {
        id: "claim-unpayable-1", questId: "q-unpayable", userId: u, confirmedAt: new Date(),
      });
      // The whole point: the caller now HAS something to log. Before this the
      // consent route had no way to know one of the village's rules had just
      // paid nobody.
      expect(out.unpayable.map((x) => x.token)).toContain(HYPHA_MIRROR);
      expect(await balanceOf(pool, memberAccount(u), HYPHA_MIRROR)).toBe(0);
      // And the rules that CAN pay are unaffected: one bad rule must not stop
      // a member being paid what the others promise.
      expect(out.minted.map((m) => m.token)).toContain(VILLAGE_VOICE);
    });

    it("names a quest rule that reads its amount from work that posts none", async () => {
      // `amount: null` means "read it from whatever posted the work", and
      // `queueRuleChange` accepts it on any rule. The only amount a quest
      // posts is its Gratitude range, which the consent route already spends,
      // so a from_source rule on a second token can never resolve an amount on
      // any quest, ever. It used to fall through `if (human <= 0) continue`.
      // A token of its own. `mint_rules` is UNIQUE on
      // (village_id, trigger, token_slug), so reusing `credits` here would not
      // add a rule at all: it would silently rewrite the credits rule the
      // block above proved, and this test would then pass by mutating its
      // neighbour rather than by testing anything.
      await pool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
          "VALUES ('rule-fromsource-test', ?, 'quest.completed', 'stay-credit', NULL, 50, 'claimant', 1) " +
          "ON DUPLICATE KEY UPDATE `enabled` = 1, `amount` = NULL",
        [villageId()],
      );
      const u = await makeMember("econ-fromsource-1");
      const out = await mintForConfirmedClaim(pool, {
        id: "claim-fromsource-1", questId: "q-fromsource", userId: u, confirmedAt: new Date(),
      });
      const said = out.unpayable.find((x) => x.token === "stay-credit");
      expect(said?.reason).toMatch(/reads its amount/);
      // The credits rule beside it is untouched and still pays.
      expect(out.minted.map((m) => m.token)).toContain(CREDITS);
      // Clear it again: the rules table is shared by the tests below.
      await pool.query("DELETE FROM `mint_rules` WHERE `id` = 'rule-fromsource-test'");
    });

    it("stays quiet about a rule a village deliberately set to zero", async () => {
      // Zero is a decision, and shouting about it on every consent would bury
      // the rules that are genuinely broken.
      await pool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
          "VALUES ('rule-zero-test', ?, 'quest.completed', 'library-credit', 0, 50, 'claimant', 1) " +
          "ON DUPLICATE KEY UPDATE `enabled` = 1, `amount` = 0",
        [villageId()],
      );
      const u = await makeMember("econ-zero-1");
      const out = await mintForConfirmedClaim(pool, {
        id: "claim-zero-1", questId: "q-zero", userId: u, confirmedAt: new Date(),
      });
      expect(out.unpayable.map((x) => x.token)).not.toContain("library-credit");
      await pool.query("DELETE FROM `mint_rules` WHERE `id` = 'rule-zero-test'");
    });

    it("keeps an unpayable rule out of the settlement forecast", async () => {
      // This used to multiply every enabled rule by the seat count, unpayable
      // ones included, and print the total as what next moon would pay.
      const view = await mintView(pool);
      const bad = view.rules.find((r) => r.id === "rule-unpayable-test");
      expect(bad?.problem).toMatch(/Hypha/);
      expect(view.settlementPreview.mints.map((m) => m.token)).not.toContain(HYPHA_MIRROR);
      // A rule that works carries no problem, so the panel can tell them apart.
      const good = view.rules.find((r) => r.id === "rule-credits-test");
      expect(good?.problem).toBeNull();
    });
  });

  // ── A dial change waits for the moon ─────────────────────────────────────

  describe("a queued rule change", () => {
    // Self-contained: this suite never runs seedEconomy, so the block makes
    // the row it measures rather than assuming one a seeder would have left.
    //
    // ON VOICE, AND NOT ON GRATITUDE. This block measures the DEFERRAL, and it
    // measures it with fractions (0.9, 0.7, 0.3, 0.4) because a fraction is
    // easy to tell apart from a live value. Gratitude has decimals 0, so every
    // one of those amounts rounds to nothing when it is posted, and
    // `queueRuleChange` now refuses them at save time rather than letting a
    // founder save a rule that pays nobody forever. Voice rides in thousandths,
    // so the same fractions are whole numbers of its smallest unit and the
    // deferral is still measured by the same numbers. The refusal itself is
    // asserted below, on a whole-unit token, where it belongs.
    //
    // Its own trigger, too: `mint_rules` is unique on (village, trigger,
    // token), and the confirmed-claim block above already owns
    // (local, quest.completed, voice). Sharing it would make this INSERT an
    // UPDATE of that row, leaving this block's own id absent and every
    // assertion here measuring a rule that does not exist.
    const RULE = "rule-deferral-test";
    beforeAll(async () => {
      await pool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
          "VALUES (?,?,'deferral.probe',?,0.1000,1,'claimant',1) ON DUPLICATE KEY UPDATE `amount` = 0.1000, " +
          "`ceiling` = 1, `enabled` = 1, `pending_from_cycle` = NULL",
        [RULE, villageId(), VILLAGE_VOICE],
      );
    });

    it("does not touch the live numbers", async () => {
      const before = (await rulesFor(pool, "deferral.probe")).find((r) => r.id === RULE);
      expect(before).toBeTruthy();
      const out = await queueRuleChange(pool, RULE, { amount: 0.9 }, "admin-1");
      expect(out.ok).toBe(true);
      // The whole point of the deferral. A rule cannot be raised, paid against
      // and lowered again around a settlement, and nobody's owed amount changes
      // under them mid-cycle.
      const after = (await rulesFor(pool, "deferral.probe")).find((r) => r.id === RULE);
      expect(after?.amount).toBe(before?.amount);
    });

    it("lands at the NEXT cycle, never this one", async () => {
      const out = await queueRuleChange(pool, RULE, { amount: 0.7 }, "admin-1");
      expect(out.ok && out.fromCycle).toBe(cycleBoundsFor(new Date()).cycleNumber + 1);
    });

    it("replaces a queued change rather than stacking on it", async () => {
      await queueRuleChange(pool, RULE, { amount: 0.7 }, "admin-1");
      await queueRuleChange(pool, RULE, { amount: 0.3 }, "admin-2");
      const view = await mintView(pool);
      const r = view.rules.find((x) => x.id === RULE);
      // Two pending amounts for one rule have no defined meaning, and somebody
      // would have to invent one.
      expect(r?.pending?.amount).toBe(0.3);
    });

    it("refuses a fixed amount above its own ceiling", async () => {
      const out = await queueRuleChange(pool, RULE, { amount: 99 }, "admin-1");
      expect(out.ok).toBe(false);
    });

    it("refuses an amount that rounds away in the token it pays", async () => {
      // MEASURED: `mint_rules.amount` is decimal(18,4) and Gratitude has
      // decimals 0, so 0.4 saved cleanly, published as a live rule, and paid
      // nothing for the rest of the village's life. The engine reported it as
      // unpayable, but only after somebody had been promised it and gone
      // unpaid, in a log the founder is not reading.
      const WHOLE = "rule-rounding-test";
      await pool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
          "VALUES (?,?,'rounding.probe',?,1,100,'claimant',1) ON DUPLICATE KEY UPDATE `amount` = 1",
        [WHOLE, villageId(), HEARTS],
      );

      // FIRST, THE HALF A ZERO-CHECK CANNOT CATCH, so that removing this guard
      // fails here rather than on the easier case below. 1.5 rounds to 2
      // units, so "does it round to nothing?" says it is fine and the rule
      // silently pays 2 where the panel and the ballot both say 1.5. Only
      // asking whether it is a WHOLE number of the token's smallest unit
      // finds this one.
      const rounded = await queueRuleChange(pool, WHOLE, { amount: 1.5 }, "admin-1");
      expect(rounded.ok).toBe(false);
      expect(rounded.ok === false && rounded.error).toMatch(/steps of 1/);

      // Then the one that rounds to nothing at all, which is the measurement
      // this defect was filed under.
      const refused = await queueRuleChange(pool, WHOLE, { amount: 0.4 }, "admin-1");
      expect(refused.ok).toBe(false);
      // A sentence a founder can act on: it names the step to round to.
      expect(refused.ok === false && refused.error).toMatch(/steps of 1/);

      // THE OUTCOME: nothing was queued, so the rule still pays what it paid.
      const view = await mintView(pool);
      expect(view.rules.find((r) => r.id === WHOLE)?.pending ?? null).toBeNull();

      // And a whole number still saves, so this refuses the broken case only.
      expect((await queueRuleChange(pool, WHOLE, { amount: 2 }, "admin-1")).ok).toBe(true);
    });

    it("accepts a fraction the token can actually hold", async () => {
      // The counterweight. Voice rides in thousandths, so 0.35 IS a whole
      // number of its smallest unit and refusing it would be the same mistake
      // pointed the other way.
      const out = await queueRuleChange(pool, RULE, { amount: 0.35 }, "admin-1");
      expect(out.ok).toBe(true);
      const tooFine = await queueRuleChange(pool, RULE, { amount: 0.0001 }, "admin-1");
      expect(tooFine.ok).toBe(false);

      // AND THE GUARD'S TOLERANCE IS LOAD-BEARING, which 0.35 does not show:
      // 0.35 * 1000 is exactly 350 in binary, so an exact test would accept it
      // too. 1.001 is also a whole number of thousandths and 1.001 * 1000 is
      // 1000.9999999999999, so an exact test refuses it — along with 175 other
      // amounts below 10 in this token. The ceiling rides along because this
      // rule's is 1 and the ceiling check runs first.
      const drifts = await queueRuleChange(pool, RULE, { amount: 1.001, ceiling: 2 }, "admin-1");
      expect(drifts.ok).toBe(true);
    });

    it("refuses a negative ceiling, and zero is a real answer", async () => {
      expect((await queueRuleChange(pool, RULE, { ceiling: -1 }, "a")).ok).toBe(false);
      expect((await queueRuleChange(pool, RULE, { ceiling: 0 }, "a")).ok).toBe(true);
    });

    it("promotes only when the moon has come, and clears the queue with it", async () => {
      await queueRuleChange(pool, RULE, { amount: 0.4, ceiling: 1 }, "admin-1");
      // A cycle that has not arrived promotes nothing.
      expect(await applyPendingRules(pool, new Date())).toBe(0);

      // One lunation on, it lands.
      const nextMoon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      expect(await applyPendingRules(pool, nextMoon)).toBeGreaterThan(0);

      const view = await mintView(pool);
      const r = view.rules.find((x) => x.id === RULE);
      expect(r?.amount).toBe(0.4);
      // Applied and cleared in one write, so no rule ever carries both a new
      // value and a stale pending copy of it.
      expect(r?.pending).toBeNull();
      // And a second run has nothing left to do.
      expect(await applyPendingRules(pool, nextMoon)).toBe(0);
    });
  });

  // ── The ceiling binds where the payment happens ──────────────────────────
  //
  // Measured on this build before the fix, against a rule left at
  // `amount 25, ceiling 5`: `mintForConfirmedClaim` posted 25 and the member's
  // balance read 25. `clampToCeiling` existed, was exported, was documented as
  // the rule, and had NO CALLER anywhere under `server/`: the only reference to
  // it in the repository was the unit test three hundred lines above this one.
  // A function nobody calls is a comment with a type signature.
  //
  // WHAT THE COLUMN BOUNDS, because the answer decides every test below.
  // ONE OCCURRENCE, in the rule's own human units, and not a cycle's total.
  // Four citations say so and none says otherwise:
  //
  //   drizzle/0071_economy_core.sql:52  "The hard cap on any from_source amount"
  //   server/lib/economy.ts             `clampToCeiling`, per posted amount
  //   economy.ts `publicRules` and client/src/pages/Mint.tsx:365, which both
  //     print it as "up to N, as much as the work was posted for"
  //   economy.ts `queueRuleChange`      refuses ONE amount above it as
  //     "a rule that contradicts itself", which is a per-occurrence sentence
  //
  // So the last test in this block is the one that pins the reading down: the
  // shipped default of `amount 25, ceiling 250` pays eleven confirmed quests
  // 275, and that is the rule working rather than a cap being missed.
  describe("a rule's ceiling", () => {
    // `stay-credit` because the natural key is (village, trigger, token) and
    // every other token this file uses on `quest.completed` already carries a
    // rule from a block above. Registered here rather than assumed: the stays
    // module registers it at boot and this suite never boots one, so a rule
    // pointing at an unregistered token would report "no token called" and the
    // ceiling would never be reached at all.
    const TOKEN = "stay-credit";
    const RULE = "rule-ceiling-test";

    /** The rule's live numbers, written straight, in force from cycle zero. */
    async function setRule(amount: number | null, ceiling: number): Promise<void> {
      await pool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`, `effective_from_cycle`) " +
          "VALUES (?,?,'quest.completed',?,?,?,'claimant',1,0) " +
          "ON DUPLICATE KEY UPDATE `amount` = VALUES(`amount`), `ceiling` = VALUES(`ceiling`), " +
          "`enabled` = 1, `effective_from_cycle` = 0, `pending_from_cycle` = NULL",
        [RULE, villageId(), TOKEN, amount, ceiling],
      );
    }

    /** What the ledger actually holds for this token, from the rows themselves. */
    async function posted(account: string): Promise<{ rows: number; units: number }> {
      const [rows] = await pool.query<any[]>(
        "SELECT COUNT(*) AS n, COALESCE(SUM(`amount`), 0) AS units FROM `token_ledger` " +
          "WHERE `to_account` = ? AND `token_type` = ?",
        [account, TOKEN],
      );
      return { rows: Number(rows[0]?.n ?? 0), units: Number(rows[0]?.units ?? 0) };
    }

    beforeAll(async () => {
      await registerToken(pool, {
        slug: TOKEN, name: "Stay Credit", kind: "credit",
        governance: "platform", transferable: false, decimals: 0,
      });
      await loadTokenRegistry(pool);
    });

    afterAll(async () => {
      // The block below deletes every rule in the village and counts what is
      // left, so this one takes its own row out rather than leaving a rule the
      // next reader has to account for.
      await pool.query("DELETE FROM `mint_rules` WHERE `id` = ?", [RULE]);
    });

    it("pays the ceiling, not the amount, when a rule was left above its own ceiling", async () => {
      await setRule(25, 5);
      const u = await makeMember("econ-ceil-1");
      const out = await mintForConfirmedClaim(pool, {
        id: "claim-ceil-1", questId: "q-ceil", userId: u, confirmedAt: new Date(),
      });
      // Read on the balance and on the row, never on the return value: a mint
      // that reported 5 and posted 25 would pass an assertion on `minted`.
      expect(await balanceOf(pool, memberAccount(u), TOKEN)).toBe(5);
      expect(await posted(memberAccount(u))).toEqual({ rows: 1, units: 5 });
      // And the caller is told what it actually paid, so a route logging the
      // result does not tell the member 25.
      expect(out.minted.find((m) => m.token === TOKEN)).toEqual({ token: TOKEN, units: 5, decimals: 0 });
      expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
    });

    it("reaches that state through the governed path, with nobody typing the row", async () => {
      // GREEN EITHER WAY, on purpose, and it is the only test here that is.
      // It measures `queueRuleChange` and `applyPendingRules`, which this
      // change does not touch: its job is to prove the row the tests around
      // it measure is reachable without an admin typing it, not to prove the
      // clamp. Removing the clamp leaves this one passing.
      //
      // THE HOLE THIS CLOSES. `queueRuleChange` refuses an amount above the
      // ceiling, and skips that check entirely when the change carries a
      // ceiling and no amount. A village voting "the most it can pay" down
      // therefore lands the rule at 25 over a ceiling of 5, which is exactly
      // the row the test above measures, and no admin ever typed it.
      await setRule(25, 250);
      const queued = await queueRuleChange(pool, RULE, { ceiling: 5 }, "admin-ceiling");
      expect(queued.ok).toBe(true);

      const nextMoon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      expect(await applyPendingRules(pool, nextMoon)).toBeGreaterThan(0);

      const [rows] = await pool.query<any[]>(
        "SELECT `amount`, `ceiling` FROM `mint_rules` WHERE `id` = ?",
        [RULE],
      );
      expect(Number(rows[0].amount)).toBe(25);
      expect(Number(rows[0].ceiling)).toBe(5);
    });

    it("mints nothing on a ceiling of zero, and says which number stopped it", async () => {
      // An empty state and a real zero are different facts. `mint_rules.ceiling`
      // is NOT NULL DEFAULT 0 and `mintRuleValueProblem` tells a village in as
      // many words that "a ceiling is zero or more, and zero means zero", so
      // this is fail-closed by the same reading the swap caps use.
      await setRule(25, 0);
      const u = await makeMember("econ-ceil-zero");
      const out = await mintForConfirmedClaim(pool, {
        id: "claim-ceil-zero", questId: "q-ceil", userId: u, confirmedAt: new Date(),
      });
      expect(await balanceOf(pool, memberAccount(u), TOKEN)).toBe(0);
      expect(await posted(memberAccount(u))).toEqual({ rows: 0, units: 0 });
      // A refusal a person can read, naming the number to change. An amount of
      // zero stays quiet because it is a village saying "not this one, not
      // now"; a ceiling of zero under a positive amount is a row at war with
      // itself and somebody has to be told.
      const said = out.unpayable.find((x) => x.token === TOKEN);
      expect(said?.reason).toMatch(/ceiling is 0/);
      expect(said?.reason).toMatch(/Raise the ceiling or pause the rule/);
    });

    it("still pays once for one occurrence, whatever the clamp did", async () => {
      await setRule(25, 5);
      const u = await makeMember("econ-ceil-idem");
      const claim = { id: "claim-ceil-idem", questId: "q-ceil", userId: u, confirmedAt: new Date() };
      await mintForConfirmedClaim(pool, claim);
      const again = await mintForConfirmedClaim(pool, claim);
      // The key shape is untouched by this change, so a re-confirm is still a
      // duplicate and still pays nothing a second time.
      expect(again.minted.find((m) => m.token === TOKEN)).toBeUndefined();
      expect(await posted(memberAccount(u))).toEqual({ rows: 1, units: 5 });
    });

    it("holds the ceiling on two claims confirmed in the same instant", async () => {
      await setRule(25, 5);
      const a = await makeMember("econ-ceil-race-a");
      const b = await makeMember("econ-ceil-race-b");
      /*
       * A per-occurrence bound has NO RUNNING TOTAL TO RACE ON, so there is no
       * check-then-act window here for a `TransferGuard` to close: the clamp
       * is a pure function of the rule row and the amount, decided before the
       * post. What this measures is that contention cannot get more than the
       * ceiling past the clamp, and that the books still balance afterwards.
       *
       * `allSettled` AND NOT `all`, and the difference is not cosmetic. `all`
       * rejects the moment one side does and leaves the OTHER mint still
       * posting, which then deadlocks the next test in this block against a
       * transaction the previous test walked away from. That cost a flaky run
       * before it was understood.
       *
       * A REJECTION IS AN ACCEPTED OUTCOME HERE, and it is a defect this lane
       * found and did not fix, because it lives in `postTransfer` and not in
       * the mint path. `postTransferPair` retries `ER_LOCK_DEADLOCK` three
       * times and says in its own comment that "InnoDB may still pick a
       * deadlock victim under real contention even with perfect lock
       * ordering". `postTransfer`, which every single mint goes through, rolls
       * back and rethrows, and neither `mint` nor `mintForConfirmedClaim`
       * catches it. So `mintForConfirmedClaim`'s promise that "it never throws
       * into the consent route" is not true under contention. Measured at
       * 2026-09-03: one run in three of exactly this pair of calls.
       */
      const settled = await Promise.allSettled([
        mintForConfirmedClaim(pool, { id: "claim-race-a", questId: "q-ceil", userId: a, confirmedAt: new Date() }),
        mintForConfirmedClaim(pool, { id: "claim-race-b", questId: "q-ceil", userId: b, confirmedAt: new Date() }),
      ]);
      for (const s of settled) {
        // Narrow, so a NEW kind of failure still turns this red rather than
        // being absorbed by a tolerant assertion.
        if (s.status === "rejected") {
          expect(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]).toContain(s.reason?.code);
        }
      }
      // The rule holds whatever the ledger did. A call that came back paid
      // exactly the ceiling; a call that was the deadlock victim posted
      // nothing at all, because `postTransfer` rolls back before it rethrows.
      const who = [a, b];
      for (let i = 0; i < settled.length; i += 1) {
        const rows = await posted(memberAccount(who[i]));
        expect(rows).toEqual(settled[i].status === "fulfilled" ? { rows: 1, units: 5 } : { rows: 0, units: 0 });
      }
      expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
    });

    it("clamps a seat payout at settlement too, which is the other mint path", async () => {
      // The twin. `runSettlement` read `r.amount ?? 0` and posted it, so a
      // fix to the quest path alone would have left every seat in the village
      // paid over the ceiling once a moon.
      // No `org_roles` row: the seat query reads `org_role_assignments` alone
      // and this schema carries no foreign keys, so inventing a seat title
      // here would only be scenery.
      const u = await makeMember("econ-ceil-seat");
      await pool.query(
        "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `is_example`) " +
          "VALUES ('seat-ceiling-test','role-ceiling-test','member',?,?,0) " +
          "ON DUPLICATE KEY UPDATE `user_id` = VALUES(`user_id`)",
        [u, u],
      );
      await pool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`, `effective_from_cycle`) " +
          "VALUES ('rule-ceiling-seat',?,'role.cycle',?,25,5,'holder',1,0) " +
          "ON DUPLICATE KEY UPDATE `amount` = 25, `ceiling` = 5, `enabled` = 1, `effective_from_cycle` = 0",
        [villageId(), TOKEN],
      );
      const out = await runSettlement(pool);
      expect(out.stewardsThanked).toBe(1);
      expect(await balanceOf(pool, memberAccount(u), TOKEN)).toBe(5);
      expect(await posted(memberAccount(u))).toEqual({ rows: 1, units: 5 });
      await pool.query("DELETE FROM `mint_rules` WHERE `id` = 'rule-ceiling-seat'");
      await pool.query("DELETE FROM `org_role_assignments` WHERE `id` = 'seat-ceiling-test'");
    });

    it("leaves the shipped default alone: eleven quests at 25 under a ceiling of 250 issue 275", async () => {
      // GREEN EITHER WAY, and that is the point: a regression guard on the
      // reading rather than a proof of the clamp. If somebody later reads the
      // column as a per-cycle budget, this is the test that goes red and says
      // which village it would have stopped paying.
      //
      // THE READING, pinned. This is `rule-quest.completed-credits` as
      // `economySeed.ts` ships it, and 275 is what "25 Village Credits when a
      // steward confirms finished work" promises for eleven confirmed quests.
      //
      // Reading the column as a per-cycle budget would make this 250 and would
      // ALSO stop the shipped `role.cycle credits, amount 25, ceiling 250`
      // after the tenth seat in every village with more than ten seats, which
      // nobody has decided. That is a founder's call and it needs its own
      // column, not a new reading of this one.
      await setRule(25, 250);
      const u = await makeMember("econ-ceil-eleven");
      for (let i = 1; i <= 11; i += 1) {
        await mintForConfirmedClaim(pool, {
          id: `claim-ceil-11-${i}`, questId: "q-ceil", userId: u, confirmedAt: new Date(),
        });
      }
      expect(await posted(memberAccount(u))).toEqual({ rows: 11, units: 275 });
      expect(await balanceOf(pool, memberAccount(u), TOKEN)).toBe(275);
      expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
    });

    it("clamps a from_source amount the way it always said it did", () => {
      // Held on the function rather than on a balance, and this is a real
      // limit on what this suite proves: NEITHER mint path can reach the
      // from_source branch. `mintForConfirmedClaim` refuses `amount === null`
      // as "a quest posts no amount in this token" before any amount exists,
      // and `runSettlement` reads `r.amount ?? 0` and skips. So the branch the
      // column was written for has no live caller to measure, and the two
      // paths above are where the column now actually binds.
      expect(clampToCeiling(40, rule({ ceiling: 100 }), 0)).toBe(40);
      expect(clampToCeiling(4000, rule({ ceiling: 100 }), 0)).toBe(100);
      // And the branch this change added: a fixed amount is bounded too.
      expect(clampToCeiling(0, rule({ amount: 25, ceiling: 5 }), 0)).toBe(5);
      expect(clampToCeiling(0, rule({ amount: 25, ceiling: 250 }), 0)).toBe(25);
      expect(clampToCeiling(0, rule({ amount: 25, ceiling: 0 }), 0)).toBe(0);
    });

    it("answers the whole ceiling decision in one pure call, every case", () => {
      // THE TABLE THE DRY-RUN MODEL MIRRORS. `shared/dryRun/economicsModel.ts`
      // may not import anything under `server/` and its own test walks the
      // import graph to enforce that, so it copies this arithmetic the way it
      // copies the faucet map. This is the table to copy, and there is
      // deliberately no "issued so far this cycle" column in it: the ceiling
      // bounds an occurrence, so a running total is not an input.
      const cases: Array<[Partial<MintRule>, number, number, boolean]> = [
        // Read at 0 decimals, so `units` reads as the human figure and every
        // row below is the row it always was. The scale is an ARGUMENT now and
        // never a lookup (R31), and the two rows at the bottom are what the
        // argument bought: a ceiling the column can hold and the token cannot.
        // rule                          posted  units  refused
        [{ amount: 25, ceiling: 250 },        0,   25,  false],
        [{ amount: 25, ceiling: 5 },          0,    5,  false],
        [{ amount: 25, ceiling: 25 },         0,   25,  false], // exactly at it pays
        [{ amount: 25, ceiling: 0 },          0,    0,   true],
        [{ amount: 0, ceiling: 250 },         0,    0,  false], // the village's own off switch
        [{ amount: null, ceiling: 100 },     40,   40,  false],
        [{ amount: null, ceiling: 100 },   4000,  100,  false],
        [{ amount: null, ceiling: 0 },       40,    0,   true],
        [{ amount: 25, ceiling: 0.5 },        0,    0,   true], // below what a whole unit can hold
        [{ amount: 0.6, ceiling: 0.5 },       0,    0,   true], // and it stops the amount too
      ];
      for (const [over, posted, units, refused] of cases) {
        const out = ceilingOutcome(rule(over), posted, 0, "Village Credits");
        expect({ units: out.units, refused: out.refusal !== null }).toEqual({ units, refused });
      }
      // The same table at 4 decimals, where nothing the column can write is
      // below what the token can hold, so the last two rows stop refusing.
      expect(ceilingOutcome(rule({ amount: 0.6, ceiling: 0.5 }), 0, 4).units).toBe(5000);
      expect(ceilingOutcome(rule({ amount: 0.6, ceiling: 0.5 }), 0, 4).refusal).toBeNull();
      // The sentence itself, once, because a founder reads it and a route logs
      // it. It names the number that stopped the payment and what to do.
      expect(ceilingOutcome(rule({ amount: 25, ceiling: 0 }), 0, 0, "Village Credits").refusal).toBe(
        "this rule's ceiling is 0, so it can pay no Village Credits at all. Raise the ceiling or pause the rule",
      );
      // And the second one, which is a different number to change: the ceiling
      // is real and the token cannot express it.
      expect(ceilingOutcome(rule({ amount: 25, ceiling: 0.5 }), 0, 0, "Village Credits").refusal).toBe(
        "this rule's ceiling is 0.5, which is below the smallest amount of Village Credits this " +
          "village can post, so it can pay none at all. Raise the ceiling or pause the rule",
      );
    });
  });

  it("keeps the write paths shut when the rules were never seeded", async () => {
    await pool.query("DELETE FROM `mint_rules` WHERE `village_id` = ?", [villageId()]);
    const shut = await economyReady(pool);
    // The flag alone is not enough. A village with the flag on and no rules
    // mints nothing while believing it is running, and that failure only ever
    // shows up as an absence.
    expect(shut.ready).toBe(false);
    expect(shut.reason).toMatch(/mint rules/);

    await pool.query(
      "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
        "VALUES ('seed-1', ?, 'gratitude.given', ?, NULL, 30, 'receiver', 1)",
      [villageId(), HEARTS],
    );
    expect((await economyReady(pool)).ready).toBe(true);
  });
  /*
   * ── W3 adversary findings on the reversal law, closed here ────────────────
   *
   * Each case is a W3 lane's repro rewritten to read OUTCOMES: balances,
   * ledger rows and the boot invariant report. The comment above each one
   * quotes what the adversary observed, which is the thing the assertion
   * says is no longer true.
   *
   * Every one of these ran green on conservation at the time it was an
   * exploit, so none of them asserts conservation as the proof of anything.
   * Double entry summing to zero is a tautology of `postTransfer`.
   */

  describe("W3 F2/F19: a reversal is decided by the row, not by the key's spelling", () => {
    /** Rows straight out of the database, and only the columns that decide. */
    const rowsOf = async (sql: string, params: unknown[] = []) => {
      const [out] = await pool.query(sql, params);
      return out as unknown as Array<Record<string, unknown>>;
    };

    it("refuses `REVERSAL:` as a way to reverse the clawback, which used to pay the quest twice", async () => {
      // ADVERSARY G1, verbatim. Observed then:
      //   G1 clawback {ok:true} A -25
      //   G1 BYPASS of the clawback {"ok":true,"duplicate":false} A 0 B 25
      //   G1 invariants after bypass {"ok":true,"problems":[]} conserved 0
      // The village paid 25 twice for one quest: B kept what A sent them and
      // A was restored to zero, with every invariant green.
      const a = await makeMember("f2-spender");
      const b = await makeMember("f2-receiver");
      const key = keys.questCompleted(villageId(), "q-f2", "c-f2", a, CREDITS);
      await mint(pool, {
        toUserId: a, tokenSlug: CREDITS, amount: 25,
        from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key,
      });
      await mint(pool, {
        toUserId: b, tokenSlug: CREDITS, amount: 25,
        from: memberAccount(a), source: "test_spend",
        idempotencyKey: `test.spend:${villageId()}:f2`,
      });
      const clawback = await reverse(pool, key, { note: "withdrawn after the spend" });
      expect(clawback.ok).toBe(true);
      expect(await balanceOf(pool, memberAccount(a), CREDITS)).toBe(-25);
      expect(await balanceOf(pool, memberAccount(b), CREDITS)).toBe(25);

      // The bypass: the mirror's own key, spelled with a capital prefix, so
      // the old byte-exact JS guard let it past and the case-insensitive row
      // lookup found the mirror anyway.
      const mirrorKey = keys.reversal(villageId(), key);
      const bypass = await reverse(pool, `REVERSAL:${mirrorKey.slice("reversal:".length)}`, { note: "bypass" });
      expect(bypass.ok).toBe(false);
      expect(String(bypass.ok === false && bypass.error)).toMatch(/cannot itself be reversed/);
      // The outcome the return value used to lie about: nothing moved.
      expect(await balanceOf(pool, memberAccount(a), CREDITS)).toBe(-25);
      expect(await balanceOf(pool, memberAccount(b), CREDITS)).toBe(25);
      expect(await rowsOf(
        "SELECT `id` FROM `token_ledger` WHERE `source` = 'reversal' AND `source_ref` = ?",
        [key],
      )).toHaveLength(1);
    });

    it("refuses a key that only COLLATES equal to a real posting", async () => {
      // The same collation, pointed at an ordinary posting rather than at a
      // mirror. `WHERE idempotency_key = ?` answers under a case-insensitive
      // collation, so a caller who does not hold the exact key could still
      // reverse the row. The stored key is read back and compared as bytes.
      const u = await makeMember("f2-case");
      const key = keys.questCompleted(villageId(), "q-case", "c-case", u, CREDITS);
      await mint(pool, {
        toUserId: u, tokenSlug: CREDITS, amount: 11,
        from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key,
      });
      const shouted = await reverse(pool, key.toUpperCase(), { note: "not my key" });
      // On a case-sensitive index this is "no such posting"; on this one it is
      // the byte comparison. Either way the balance is the witness.
      expect(shouted.ok).toBe(false);
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(11);

      const padded = await reverse(pool, `${key} `, { note: "not my key either" });
      expect(padded.ok).toBe(false);
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(11);

      // And the honest one still works, so the narrowing did not break it.
      const honest = await reverse(pool, key, { note: "withdrawn" });
      expect(honest.ok).toBe(true);
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(0);
    });

    it("refuses to reverse a clawback keyed OUTSIDE the reversal namespace", async () => {
      // ADVERSARY A12. Every real clawback in this build is keyed
      // `ord:<id>:reversal-leg1` or `pp:<id>:reversal:<period>`, outside the
      // `reversal:` namespace the prefix guard watched. Observed then:
      //   PROBE.A12 reverseOfAReversal {"ok":true,"duplicate":false,...}
      //   mirror row [{"source":"reversal","amount":20,...}]
      // which hands a member back money the bank has already taken.
      const u = await makeMember("f19-member");
      await mint(pool, {
        toUserId: u, tokenSlug: CREDITS, amount: 20,
        from: CYCLE_POOL_FAUCET, source: "quest_consent",
        idempotencyKey: keys.questCompleted(villageId(), "q-f19", "c-f19", u, CREDITS),
      });
      const clawback = await postTransfer(pool, {
        from: memberAccount(u), to: CYCLE_POOL_FAUCET, tokenType: CREDITS, amount: 20,
        source: "payment_reversal", sourceRef: "evt-1",
        idempotencyKey: "payment_reversal:local:evt-1",
      });
      expect(clawback.ok).toBe(true);
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(0);

      const undoTheUndo = await reverse(pool, "payment_reversal:local:evt-1", { note: "undo the undo" });
      expect(undoTheUndo.ok).toBe(false);
      expect(String(undoTheUndo.ok === false && undoTheUndo.error)).toMatch(/itself a clawback/);
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(0);
      expect(await rowsOf(
        "SELECT `id` FROM `token_ledger` WHERE `idempotency_key` = ?",
        [keys.reversal(villageId(), "payment_reversal:local:evt-1")],
      )).toHaveLength(0);
    });

    it("still reverses a grace-night burn, which is a charge and not a clawback", async () => {
      // The bound on the rule above: `stay_night` is deliberately not a
      // clawback source, so a village that burnt a night wrongly can give it
      // back.
      const u = await makeMember("f19-stay");
      await mint(pool, {
        toUserId: u, tokenSlug: CREDITS, amount: 6,
        from: CYCLE_POOL_FAUCET, source: "quest_consent",
        idempotencyKey: keys.questCompleted(villageId(), "q-stay", "c-stay", u, CREDITS),
      });
      const burn = await postTransfer(pool, {
        from: memberAccount(u), to: CYCLE_POOL_FAUCET, tokenType: CREDITS, amount: 6,
        source: "stay_night", sourceRef: "stay-1", idempotencyKey: "stay:stay-1:night:2026-09-03",
      });
      expect(burn.ok).toBe(true);
      const back = await reverse(pool, "stay:stay-1:night:2026-09-03", { note: "wrong night" });
      expect(back.ok).toBe(true);
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(6);
    });
  });

  describe("W3 F3: isReversed reads a mirror, not a string", () => {
    it("refuses the squat that made isReversed true and the real clawback a no-op", async () => {
      // ADVERSARY A6. Observed then:
      //   PROBE.A6 squatMint {"ok":true,"duplicate":false,"balance":1} isReversed true;
      //   PROBE.A6 reverse {"ok":true,"duplicate":true,"balance":-52} victim 30 -> 30
      // A one-unit mint to a third party under the mirror key made
      // `isReversed` true with no reversal in existence, and the real
      // clawback then reported SUCCESS AS A DUPLICATE while moving nothing.
      const victim = await makeMember("f3-victim");
      const squatter = await makeMember("f3-squatter");
      const key = keys.questCompleted(villageId(), "q-f3", "c-f3", victim, CREDITS);
      await mint(pool, {
        toUserId: victim, tokenSlug: CREDITS, amount: 30,
        from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key,
      });

      const squat = await mint(pool, {
        toUserId: squatter, tokenSlug: CREDITS, amount: 1,
        from: CYCLE_POOL_FAUCET, source: "quest_consent",
        idempotencyKey: keys.reversal(villageId(), key),
      });
      expect(squat.ok).toBe(false);
      expect(squat.ok === false && squat.error).toMatch(/only reverse\(\) may write/);
      expect(await isReversed(pool, key)).toBe(false);
      expect(await balanceOf(pool, memberAccount(squatter), CREDITS)).toBe(0);

      // And the clawback the squat used to swallow.
      const clawback = await reverse(pool, key, { note: "clawback" });
      expect(clawback.ok && clawback.duplicate).toBe(false);
      expect(await balanceOf(pool, memberAccount(victim), CREDITS)).toBe(0);
      expect(await isReversed(pool, key)).toBe(true);
    });

    it("says false for a mirror-keyed row that does not mirror the posting", async () => {
      // The reader's half, proved independently of the writer's: even a row
      // that got into the namespace some other way (a legacy row, a hand
      // insert, a fork's migration) is not a reversal of THIS posting unless
      // it is its exact mirror.
      const u = await makeMember("f3-shape");
      const key = keys.questCompleted(villageId(), "q-shape", "c-shape", u, CREDITS);
      await mint(pool, {
        toUserId: u, tokenSlug: CREDITS, amount: 40,
        from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key,
      });
      await pool.query(
        "INSERT INTO `token_ledger` (`id`, `from_account`, `to_account`, `token_type`, `amount`, `source`, `idempotency_key`) " +
          "VALUES ('led-f3-shape', ?, ?, ?, 1, 'reversal', ?)",
        [memberAccount(u), CYCLE_POOL_FAUCET, CREDITS, keys.reversal(villageId(), key)],
      );
      // Right key, right source, right direction, WRONG amount: 1 against 40.
      expect(await isReversed(pool, key)).toBe(false);
      await pool.query("DELETE FROM `token_ledger` WHERE `id` = 'led-f3-shape'");
      expect(await isReversed(pool, key)).toBe(false);
    });
  });

  describe("W3 F6: an atomic pair is reversed whole or not at all", () => {
    const PAY = "rev-pair-pay";
    const GET = "rev-pair-get";

    it("refuses one leg by name, and reverses both together through reversePair", async () => {
      // ADVERSARY G2. Observed then:
      //   G2 pair member 40 treasury 100
      //   G2 reverse leg2 only -> {"ok":true,"duplicate":false}
      //   G2 member 0 treasury 100
      //   G2 invariants {"ok":true,"problems":[]} conserved 0
      // THE MEMBER PAID 100 AND KEPT NOTHING, with no case trick needed: the
      // mirror posts as source `reversal`, which is inside the keystone set,
      // although `exchange_swap` is deliberately outside it.
      await registerToken(pool, { slug: PAY, name: "Pair Pay", kind: "credit", governance: "platform", transferable: false });
      await registerToken(pool, { slug: GET, name: "Pair Get", kind: "credit", governance: "platform", transferable: false });
      const u = await makeMember("f6-swapper");
      await postTransfer(pool, { from: MINT_FAUCET, to: TREASURY, tokenType: GET, amount: 500, source: "exchange_stock", idempotencyKey: "f6-stock" });
      await postTransfer(pool, { from: MINT_FAUCET, to: memberAccount(u), tokenType: PAY, amount: 100, source: "admin_mint", idempotencyKey: "f6-grant" });

      const swap = await postTransferPair(pool, [
        { from: memberAccount(u), to: TREASURY, tokenType: PAY, amount: 100, source: "exchange_swap", sourceRef: "ord-f6", idempotencyKey: "ord:ord-f6:leg1" },
        { from: TREASURY, to: memberAccount(u), tokenType: GET, amount: 40, source: "exchange_swap", sourceRef: "ord-f6", idempotencyKey: "ord:ord-f6:leg2" },
      ]);
      expect(swap.ok).toBe(true);
      expect(await balanceOf(pool, memberAccount(u), PAY)).toBe(0);
      expect(await balanceOf(pool, memberAccount(u), GET)).toBe(40);

      const halfASwap = await reverse(pool, "ord:ord-f6:leg2", { note: "half a swap" });
      expect(halfASwap.ok).toBe(false);
      expect(String(halfASwap.ok === false && halfASwap.error)).toContain("ord:ord-f6:leg1");
      // The outcome: the member still holds what the swap gave them.
      expect(await balanceOf(pool, memberAccount(u), PAY)).toBe(0);
      expect(await balanceOf(pool, memberAccount(u), GET)).toBe(40);

      // The other leg is refused the same way, naming its sibling.
      const otherHalf = await reverse(pool, "ord:ord-f6:leg1", { note: "the other half" });
      expect(otherHalf.ok).toBe(false);
      expect(String(otherHalf.ok === false && otherHalf.error)).toContain("ord:ord-f6:leg2");

      const both = await reversePair(pool, "ord:ord-f6:leg1", "ord:ord-f6:leg2", { note: "swap undone" });
      expect(both.ok && both.duplicate).toBe(false);
      expect(await balanceOf(pool, memberAccount(u), PAY)).toBe(100);
      expect(await balanceOf(pool, memberAccount(u), GET)).toBe(0);
      const report = await checkLedgerInvariants(pool);
      expect(report.problems.filter((p) => p.includes(memberAccount(u)))).toEqual([]);

      // Replaying is one duplicate for the pair, not a second refund.
      const again = await reversePair(pool, "ord:ord-f6:leg1", "ord:ord-f6:leg2", { note: "swap undone" });
      expect(again.ok && again.duplicate).toBe(true);
      expect(await balanceOf(pool, memberAccount(u), PAY)).toBe(100);
    });

    it("refuses a pair reversal that would create debt, rather than creating it", async () => {
      // What `reverse()` could not do and `postTransferPair` can: a member
      // who has already spent what the swap gave them cannot have the swap
      // undone behind their back. A single clawback's negative is truthful;
      // half a swap's is not, so this refuses and a person settles it.
      const u = await makeMember("f6-spent");
      const sink = await makeMember("f6-sink");
      await postTransfer(pool, { from: MINT_FAUCET, to: memberAccount(u), tokenType: PAY, amount: 60, source: "admin_mint", idempotencyKey: "f6-spent-grant" });
      await postTransferPair(pool, [
        { from: memberAccount(u), to: TREASURY, tokenType: PAY, amount: 60, source: "exchange_swap", sourceRef: "ord-f6b", idempotencyKey: "ord:ord-f6b:leg1" },
        { from: TREASURY, to: memberAccount(u), tokenType: GET, amount: 20, source: "exchange_swap", sourceRef: "ord-f6b", idempotencyKey: "ord:ord-f6b:leg2" },
      ]);
      await postTransfer(pool, {
        from: memberAccount(u), to: memberAccount(sink), tokenType: GET, amount: 20,
        source: "member_send", idempotencyKey: "f6-spent-onward",
      });
      expect(await balanceOf(pool, memberAccount(u), GET)).toBe(0);

      const refused = await reversePair(pool, "ord:ord-f6b:leg1", "ord:ord-f6b:leg2", { note: "too late" });
      expect(refused.ok).toBe(false);
      expect(String(refused.ok === false && refused.error)).toContain("cannot overdraft");
      // Neither leg moved: the pair is still standing exactly as it was.
      expect(await balanceOf(pool, memberAccount(u), PAY)).toBe(0);
      expect(await balanceOf(pool, memberAccount(u), GET)).toBe(0);
    });

    it("leaves an ordinary posting that merely ends in :leg1 reversible", async () => {
      // The bound on the pair rule. `ord:<orderId>:leg1` is ALSO the key of
      // three single postings (a fiat exchange settlement, a stay purchase, a
      // manual stay purchase), and none of them has a sibling row, so the
      // suffix alone could never be the test.
      const u = await makeMember("f6-single");
      await postTransfer(pool, {
        from: MINT_FAUCET, to: memberAccount(u), tokenType: PAY, amount: 15,
        source: "exchange_purchase", sourceRef: "ord-single", idempotencyKey: "ord:ord-single:leg1",
      });
      const back = await reverse(pool, "ord:ord-single:leg1", { note: "order refunded" });
      expect(back.ok).toBe(true);
      expect(await balanceOf(pool, memberAccount(u), PAY)).toBe(0);
    });

    it("refuses two keys that were never one pair", async () => {
      // Two real postings under different sources: they were never a pair,
      // and the refusal says which two sources it read.
      const crossSource = await reversePair(pool, "ord:ord-f6:leg1", "ord:ord-single:leg1", { note: "invented" });
      expect(crossSource.ok).toBe(false);
      expect(String(crossSource.ok === false && crossSource.error)).toContain("never one pair");

      // And two legs of DIFFERENT pairs, which share a source and a suffix
      // shape and are still not siblings: the prefix has to match.
      const crossPair = await reversePair(pool, "ord:ord-f6:leg1", "ord:ord-f6b:leg2", { note: "invented" });
      expect(crossPair.ok).toBe(false);
      expect(String(crossPair.ok === false && crossPair.error)).toContain("not the two legs of one pair");
    });
  });

  describe("W4: the clawback law lives in the ledger, so the plain poster meets it too", () => {
    /*
     * A closing proof that wrote none of this code found that every rule in
     * `reverse()` could be walked around, because `reverse()` is not the only
     * way into `token_ledger`. `postTransfer` wrote any row at all whose
     * source was `reversal` so long as its key started with `reversal:`, and
     * asked nothing else: no original had to exist, no already-mirrored check
     * applied, no pair check applied. These are that proof's own
     * reproductions, through that same door, with the rules moved down into
     * the ledger where the row is written.
     */
    const PAY = "l8-pay";
    const GET = "l8-get";

    it("refuses a hand-posted mirror of one swap leg, which used to leave the payer holding nothing", async () => {
      // PROOF `NEW another door: post a mirror-shaped row through postTransfer
      // directly`. Observed then:
      //   NEW hand-posted single-leg mirror {"ok":true,...,"toBalance":80}
      //   credits 0 hearts 0
      //   NEW invariants after hand-posted mirror []
      // The member had paid 100 for the swap and was left with nothing, and
      // the boot check saw a clean economy over it.
      await registerToken(pool, { slug: PAY, name: "Door Pay", kind: "credit", governance: "platform", transferable: false });
      await registerToken(pool, { slug: GET, name: "Door Get", kind: "credit", governance: "platform", transferable: false });
      const u = await makeMember("l8-f6");
      await postTransfer(pool, { from: MINT_FAUCET, to: TREASURY, tokenType: GET, amount: 500, source: "exchange_stock", idempotencyKey: "l8-stock" });
      await postTransfer(pool, { from: MINT_FAUCET, to: memberAccount(u), tokenType: PAY, amount: 100, source: "admin_mint", idempotencyKey: "l8-grant" });
      const swap = await postTransferPair(pool, [
        { from: memberAccount(u), to: TREASURY, tokenType: PAY, amount: 100, source: "exchange_swap", sourceRef: "ord-l8", idempotencyKey: "ord:ord-l8:leg1" },
        { from: TREASURY, to: memberAccount(u), tokenType: GET, amount: 40, source: "exchange_swap", sourceRef: "ord-l8", idempotencyKey: "ord:ord-l8:leg2" },
      ]);
      expect(swap.ok).toBe(true);

      // The door: no reverse() anywhere, only the primitive every module has.
      const mirrorKey = keys.reversal(villageId(), "ord:ord-l8:leg2");
      const handPosted = await postTransfer(pool, {
        from: memberAccount(u), to: TREASURY, tokenType: GET, amount: 40,
        source: "reversal", sourceRef: "ord:ord-l8:leg2", idempotencyKey: mirrorKey,
      });
      expect(handPosted.ok).toBe(false);
      expect(String(handPosted.error)).toContain("ord:ord-l8:leg1");
      // The outcome the proof measured, now the other way round.
      expect(await balanceOf(pool, memberAccount(u), PAY)).toBe(0);
      expect(await balanceOf(pool, memberAccount(u), GET)).toBe(40);
      const [ghostRows] = await pool.query<any[]>(
        "SELECT COUNT(*) AS n FROM `token_ledger` WHERE `idempotency_key` = ?",
        [mirrorKey],
      );
      expect(Number(ghostRows[0].n)).toBe(0);
      expect((await checkLedgerInvariants(pool)).problems.filter((p) => p.includes(memberAccount(u)))).toEqual([]);

      // And the lawful door still undoes the whole swap, unchanged.
      const both = await reversePair(pool, "ord:ord-l8:leg1", "ord:ord-l8:leg2", { note: "undone" });
      expect(both.ok && both.duplicate).toBe(false);
      expect(await balanceOf(pool, memberAccount(u), PAY)).toBe(100);
      expect(await balanceOf(pool, memberAccount(u), GET)).toBe(0);
    });

    it("refuses a hand-posted mirror OF a mirror, which used to hand the clawed-back credits back", async () => {
      // PROOF `NEW another door: reverse a reversal by hand-posting its
      // mirror`. Observed then:
      //   NEW door2 hand-posted reversal-of-a-reversal {"ok":true,...,
      //   "toBalance":30} bal 30 isReversed(K) true
      //   NEW door2 invariants []
      const victim = await makeMember("l8-f2");
      const key = keys.questCompleted(villageId(), "q-l8f2", "c-l8f2", victim, CREDITS);
      await mint(pool, { toUserId: victim, tokenSlug: CREDITS, amount: 30, from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key });
      const clawback = await reverse(pool, key, { note: "taken back" });
      expect(clawback.ok).toBe(true);
      expect(await balanceOf(pool, memberAccount(victim), CREDITS)).toBe(0);

      const mirrorKey = keys.reversal(villageId(), key);
      const undo = await postTransfer(pool, {
        from: CYCLE_POOL_FAUCET, to: memberAccount(victim), tokenType: CREDITS, amount: 30,
        source: "reversal", sourceRef: mirrorKey.slice(0, 120),
        idempotencyKey: keys.reversal(villageId(), mirrorKey),
      });
      expect(undo.ok).toBe(false);
      expect(String(undo.error)).toContain("a reversal cannot itself be reversed");
      expect(await balanceOf(pool, memberAccount(victim), CREDITS)).toBe(0);
      expect(await isReversed(pool, key)).toBe(true);
    });

    it("refuses a FUNDED squat on the mirror key, so the real clawback still takes the value back", async () => {
      // PROOF F3F, the finding reported closed that was not. Observed then:
      //   F3F funded squat -> {"ok":true,...} isReversed(K) false
      //   F3F real clawback after a funded squat -> {"ok":true,
      //   "duplicate":true,...} victim balance 30
      // The mint-door squat and `isReversed` were both genuinely fixed; the
      // harm was not, because a FUNDED posting carrying source `reversal`
      // took the key and the real clawback then read as a replay.
      const victim = await makeMember("l8-f3v");
      const squatter = await makeMember("l8-f3s");
      const key = keys.questCompleted(villageId(), "q-l8f3", "c-l8f3", victim, CREDITS);
      await mint(pool, { toUserId: victim, tokenSlug: CREDITS, amount: 30, from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key });
      await mint(pool, {
        toUserId: squatter, tokenSlug: CREDITS, amount: 50, from: CYCLE_POOL_FAUCET,
        source: "quest_consent", idempotencyKey: keys.questCompleted(villageId(), "q-l8f3", "c-l8f3", squatter, CREDITS),
      });

      const squat = await postTransfer(pool, {
        from: memberAccount(squatter), to: CYCLE_POOL_FAUCET, tokenType: CREDITS, amount: 1,
        source: "reversal", sourceRef: key.slice(0, 120), idempotencyKey: keys.reversal(villageId(), key),
      });
      expect(squat.ok).toBe(false);
      expect(String(squat.error)).toContain("does not mirror");
      expect(await balanceOf(pool, memberAccount(squatter), CREDITS)).toBe(50);
      expect(await isReversed(pool, key)).toBe(false);

      const clawback = await reverse(pool, key, { note: "the real one" });
      expect(clawback.ok).toBe(true);
      expect(clawback.ok && clawback.duplicate).toBe(false);
      expect(await balanceOf(pool, memberAccount(victim), CREDITS)).toBe(0);
      expect(await isReversed(pool, key)).toBe(true);
    });

    it("refuses a mirror of nothing, and a SECOND mirror of something", async () => {
      const u = await makeMember("l8-l4");
      const key = keys.questCompleted(villageId(), "q-l8l4", "c-l8l4", u, CREDITS);
      await mint(pool, { toUserId: u, tokenSlug: CREDITS, amount: 12, from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key });

      const ghost = await postTransfer(pool, {
        from: memberAccount(u), to: CYCLE_POOL_FAUCET, tokenType: CREDITS, amount: 12,
        source: "reversal", idempotencyKey: keys.reversal(villageId(), "a-posting-that-never-happened"),
      });
      expect(ghost.ok).toBe(false);
      expect(String(ghost.error)).toContain("to reverse");

      const first = await reverse(pool, key, { note: "once" });
      expect(first.ok).toBe(true);
      // A SECOND mirror under a different village segment. The UNIQUE index on
      // the mirror key cannot see this one, because it is a different key.
      const twice = await postTransfer(pool, {
        from: memberAccount(u), to: CYCLE_POOL_FAUCET, tokenType: CREDITS, amount: 12,
        source: "reversal", idempotencyKey: `reversal:elsewhere:${key}`,
      });
      expect(twice.ok).toBe(false);
      expect(String(twice.error)).toContain("has already been reversed by");
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(0);
    });

    it("refuses a mirror of a clawback keyed outside the reversal namespace", async () => {
      // The `payment_reversal` half of the same rule, asked at the write this
      // time. `reverse()` has refused this since W3; the door did not.
      const u = await makeMember("l8-pr");
      await postTransfer(pool, { from: MINT_FAUCET, to: memberAccount(u), tokenType: CREDITS, amount: 20, source: "admin_mint", idempotencyKey: "l8-pr-grant" });
      await postTransfer(pool, {
        from: memberAccount(u), to: TREASURY, tokenType: CREDITS, amount: 20,
        source: "payment_reversal", sourceRef: "ord-l8pr", idempotencyKey: "ord:ord-l8pr:reversal-leg1",
      });
      const undo = await postTransfer(pool, {
        from: TREASURY, to: memberAccount(u), tokenType: CREDITS, amount: 20,
        source: "reversal", idempotencyKey: keys.reversal(villageId(), "ord:ord-l8pr:reversal-leg1"),
      });
      expect(undo.ok).toBe(false);
      expect(String(undo.error)).toContain("is itself a clawback");
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(0);
    });

    it("still writes one mirror when twelve reversals are in flight at once", async () => {
      // PROOF `S concurrent rejected 0 ok 12 fresh 1 mirrorRows 1 bal 0`, run
      // again because the law now takes its reads INSIDE the transaction and
      // under the account locks, which is exactly where a new deadlock or a
      // new stale read would show up.
      const u = await makeMember("l8-race");
      const key = keys.questCompleted(villageId(), "q-l8race", "c-l8race", u, CREDITS);
      await mint(pool, { toUserId: u, tokenSlug: CREDITS, amount: 25, from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key });
      const results = await Promise.all(Array.from({ length: 12 }, () => reverse(pool, key, { note: "at once" })));
      expect(results.filter((r) => r.ok).length).toBe(12);
      expect(results.filter((r) => r.ok && r.duplicate === false).length).toBe(1);
      const [rows] = await pool.query<any[]>(
        "SELECT COUNT(*) AS n FROM `token_ledger` WHERE `idempotency_key` = ?",
        [keys.reversal(villageId(), key)],
      );
      expect(Number(rows[0].n)).toBe(1);
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(0);
    });

    it("refuses a lone posting whose key collides with a pair shape, and fails closed on purpose", async () => {
      // THE CONFIRMED FALSE POSITIVE, KEPT, and now held by a test instead of
      // by a paragraph. Two genuinely single postings that share a prefix and
      // a source under the two leg suffixes are read as a pair. No shipped
      // path produces the shape. Narrowing the derivation would make FEWER
      // things count as a pair, which is the direction the pair-dismantling
      // loss lies in, so it stays as it is: the cost here is a refusal a
      // person answers by posting the correction as its own occurrence, and
      // the cost the other way is a member who paid for a swap keeping
      // nothing.
      const u = await makeMember("l8-fp");
      for (const suffix of ["leg1", "leg2"]) {
        await postTransfer(pool, {
          from: MINT_FAUCET, to: memberAccount(u), tokenType: CREDITS, amount: 3,
          source: "exchange_purchase", sourceRef: "ord-l8fp", idempotencyKey: `ord:ord-l8fp:${suffix}`,
        });
      }
      const refused = await reverse(pool, "ord:ord-l8fp:leg1", { note: "not really a pair" });
      expect(refused.ok).toBe(false);
      expect(String(refused.ok === false && refused.error)).toContain("ord:ord-l8fp:leg2");
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(6);
    });
  });

  describe("W4: the survivors, re-run against the new law", () => {
    /*
     * A fix that closes a hole by breaking something that held is not a fix.
     * The clawback law is new code on the write path of every reversal in the
     * build, so the closing proof's SURVIVED list is re-run here rather than
     * assumed: these are the attacks that were already refused before this
     * lane touched anything, and every one of them still is.
     *
     * The keystone half of the same list (forgery by literal, spread, clone,
     * Object.create, JSON round trip and Proxy; the near-miss spellings at
     * both gates; the mutation attempts on the frozen set; an ordinary spend
     * from a lawfully negative account; allowNegative inside a pair) lives in
     * `server/ledger.test.ts` and is re-run there.
     */
    const ORIG = "l8s-original";
    let payer = "";

    beforeAll(async () => {
      payer = await makeMember("l8s-payer");
      await postTransfer(pool, {
        from: CYCLE_POOL_FAUCET, to: memberAccount(payer), tokenType: CREDITS,
        amount: 25, source: "quest_consent", idempotencyKey: ORIG,
      });
    });

    it("refuses every claim about the row that disagrees with the row", async () => {
      // PROOF S: inflated, deflated, wrong direction, wrong token, and a
      // human-units figure on a minor-units row.
      const inflated = await reverse(pool, ORIG, { amount: 1_000_000 });
      expect(inflated.ok).toBe(false);
      expect(String(inflated.ok === false && inflated.error)).toContain("has amount 25");

      const deflated = await reverse(pool, ORIG, { amount: 1 });
      expect(deflated.ok).toBe(false);

      const wrongWay = await reverse(pool, ORIG, { from: CYCLE_POOL_FAUCET });
      expect(wrongWay.ok).toBe(false);
      expect(String(wrongWay.ok === false && wrongWay.error)).toContain("has from");

      const wrongToken = await reverse(pool, ORIG, { tokenSlug: HEARTS });
      expect(wrongToken.ok).toBe(false);
      expect(String(wrongToken.ok === false && wrongToken.error)).toContain("tokenSlug");

      // Nothing moved through any of them.
      expect(await balanceOf(pool, memberAccount(payer), CREDITS)).toBe(25);
    });

    it("refuses a degenerate key rather than matching something with it", async () => {
      // PROOF S: empty, whitespace, `%` and `_`. The lookup is an equality
      // and not a LIKE, and this is what says so out loud.
      for (const key of ["", "   ", "%", "_", "%%", "l8s-origina_"]) {
        const r = await reverse(pool, key, { note: "degenerate" });
        expect(r.ok, `reverse(${JSON.stringify(key)}) should refuse`).toBe(false);
      }
      expect(await balanceOf(pool, memberAccount(payer), CREDITS)).toBe(25);
    });

    it("refuses a padded or case-folded spelling of a real key", async () => {
      // PROOF S: the collation matches these to the real row, and the
      // byte-exact read back is what makes the refusal say so.
      //
      // THE TRAILING SPACE IS THE ONE ASSERTION IN THIS FILE THAT READS
      // DIFFERENTLY ON THE TWO ENGINES, so it asserts the OUTCOME and not the
      // sentence. `token_ledger` pins no charset (0005, 0009), so the column
      // inherits the server default: MariaDB here gives it
      // utf8mb4_uca1400_ai_ci, which is PAD SPACE, and the padded key matches
      // the real row and is then caught by the byte-exact read back, so the
      // refusal names the collation. CI pins mysql:8, whose default
      // utf8mb4_0900_ai_ci is NO PAD, so the padded key matches nothing and
      // the refusal is the plain one. Both are refusals and neither moves a
      // unit, which is the property; the wording is the engine's.
      const padded = await reverse(pool, `${ORIG} `, { note: "padded" });
      expect(padded.ok).toBe(false);
      expect(String(padded.ok === false && padded.error)).toMatch(/different key|no such posting/);

      // Case is folded by BOTH defaults (both are _ai_ci), so this one may
      // name the collation on either engine.
      const shouted = await reverse(pool, ORIG.toUpperCase(), { note: "shouted" });
      expect(shouted.ok).toBe(false);
      expect(String(shouted.ok === false && shouted.error)).toContain("different key");
      expect(await balanceOf(pool, memberAccount(payer), CREDITS)).toBe(25);
    });

    it("reverses once, then reports a duplicate, and refuses the mirror and its mirror", async () => {
      // PROOF S sequential double, and PROOF N nested reversal.
      const first = await reverse(pool, ORIG, { note: "once" });
      expect(first.ok && first.duplicate).toBe(false);
      const second = await reverse(pool, ORIG, { note: "twice" });
      expect(second.ok && second.duplicate).toBe(true);
      expect(await balanceOf(pool, memberAccount(payer), CREDITS)).toBe(0);

      const mirrorKey = keys.reversal(villageId(), ORIG);
      const undo = await reverse(pool, mirrorKey, { note: "undo the undo" });
      expect(undo.ok).toBe(false);
      const undoUndo = await reverse(pool, keys.reversal(villageId(), mirrorKey), { note: "deeper" });
      expect(undoUndo.ok).toBe(false);
      expect(await isReversed(pool, ORIG)).toBe(true);

      const [rows] = await pool.query<any[]>(
        "SELECT COUNT(*) AS n FROM `token_ledger` WHERE `source_ref` = ? AND `source` = 'reversal'",
        [ORIG],
      );
      expect(Number(rows[0].n)).toBe(1);
    });

    it("refuses a posting of zero and a posting to itself", async () => {
      // PROOF S degenerates, at the primitive rather than through reverse().
      const zero = await postTransfer(pool, {
        from: memberAccount(payer), to: TREASURY, tokenType: CREDITS,
        amount: 0, source: "member_send", idempotencyKey: "l8s-zero",
      });
      expect(zero.ok).toBe(false);
      expect(String(zero.error)).toContain("positive integer");

      const itself = await postTransfer(pool, {
        from: memberAccount(payer), to: memberAccount(payer), tokenType: CREDITS,
        amount: 1, source: "member_send", idempotencyKey: "l8s-self",
      });
      expect(itself.ok).toBe(false);
      expect(String(itself.error)).toContain("cannot transfer to itself");
    });

    it("holds every reversePair attack the proof tried", async () => {
      // PROOF RP: same key twice, a case-variant leg, a padded leg,
      // mismatched orders, a mirror passed as a leg, two ordinary postings,
      // and the two that must still WORK: swapped arguments and a replay.
      const PAY = "l8s-pay";
      const GET = "l8s-get";
      await registerToken(pool, { slug: PAY, name: "Survivor Pay", kind: "credit", governance: "platform", transferable: false });
      await registerToken(pool, { slug: GET, name: "Survivor Get", kind: "credit", governance: "platform", transferable: false });
      const u = await makeMember("l8s-swapper");
      await postTransfer(pool, { from: MINT_FAUCET, to: TREASURY, tokenType: GET, amount: 300, source: "exchange_stock", idempotencyKey: "l8s-stock" });
      await postTransfer(pool, { from: MINT_FAUCET, to: memberAccount(u), tokenType: PAY, amount: 61, source: "admin_mint", idempotencyKey: "l8s-grant" });
      const swap = await postTransferPair(pool, [
        { from: memberAccount(u), to: TREASURY, tokenType: PAY, amount: 61, source: "exchange_swap", sourceRef: "ord-l8s", idempotencyKey: "ord:ord-l8s:leg1" },
        { from: TREASURY, to: memberAccount(u), tokenType: GET, amount: 20, source: "exchange_swap", sourceRef: "ord-l8s", idempotencyKey: "ord:ord-l8s:leg2" },
      ]);
      expect(swap.ok).toBe(true);

      const same = await reversePair(pool, "ord:ord-l8s:leg1", "ord:ord-l8s:leg1", {});
      expect(same.ok).toBe(false);
      expect(String(same.ok === false && same.error)).toContain("two distinct keys");

      const shouted = await reversePair(pool, "ORD:ord-l8s:leg1", "ord:ord-l8s:leg2", {});
      expect(shouted.ok).toBe(false);
      expect(String(shouted.ok === false && shouted.error)).toContain("there is no posting keyed");

      const padded = await reversePair(pool, "ord:ord-l8s:leg1 ", "ord:ord-l8s:leg2", {});
      expect(padded.ok).toBe(false);
      expect(String(padded.ok === false && padded.error)).toContain("there is no posting keyed");

      const mismatched = await reversePair(pool, "ord:ord-l8s:leg1", "ord:other-l8s:leg2", {});
      expect(mismatched.ok).toBe(false);

      const mirrorAsLeg = await reversePair(pool, keys.reversal(villageId(), ORIG), "ord:ord-l8s:leg2", {});
      expect(mirrorAsLeg.ok).toBe(false);
      expect(String(mirrorAsLeg.ok === false && mirrorAsLeg.error)).toContain("cannot itself be reversed");

      const ordinary = await reversePair(pool, ORIG, "l8s-zero", {});
      expect(ordinary.ok).toBe(false);

      // Nothing above moved a thing.
      expect(await balanceOf(pool, memberAccount(u), PAY)).toBe(0);
      expect(await balanceOf(pool, memberAccount(u), GET)).toBe(20);

      // The two that must still work: legs in either order, and a replay.
      const swapped = await reversePair(pool, "ord:ord-l8s:leg2", "ord:ord-l8s:leg1", { note: "either order" });
      expect(swapped.ok && swapped.duplicate).toBe(false);
      expect(await balanceOf(pool, memberAccount(u), PAY)).toBe(61);
      expect(await balanceOf(pool, memberAccount(u), GET)).toBe(0);
      const replay = await reversePair(pool, "ord:ord-l8s:leg1", "ord:ord-l8s:leg2", { note: "either order" });
      expect(replay.ok && replay.duplicate).toBe(true);
      expect(await balanceOf(pool, memberAccount(u), PAY)).toBe(61);

      const report = await checkLedgerInvariants(pool);
      expect(report.problems.filter((p) => p.includes(memberAccount(u)))).toEqual([]);
    });
  });

  describe("W4: the description clamp counts the unit the column counts", () => {
    /*
     * PROOF CLIP. Observed then, on a note of 400 emoji:
     *   CLIP stored CHAR_LENGTH 258 contains EFBFBD (U+FFFD) true
     * The clamp sliced UTF-16 CODE UNITS against a limit MySQL counts in
     * CHARACTERS, so it clipped a note that would have fitted whole, and when
     * the boundary landed at an odd offset it cut a surrogate PAIR in half.
     * The lone surrogate reached the column as `EF BF BD`, the replacement
     * character, so the stored note ended in a black diamond nobody typed.
     */
    const stored = async (key: string): Promise<{ chars: number; hex: string }> => {
      const [rows] = await pool.query<any[]>(
        "SELECT CHAR_LENGTH(`description`) AS n, HEX(`description`) AS hex FROM `token_ledger` WHERE `idempotency_key` = ?",
        [key],
      );
      return { chars: Number(rows[0].n), hex: String(rows[0].hex) };
    };

    it("keeps a 400-emoji note whole, with no replacement character in it", async () => {
      const u = await makeMember("l8-clip");
      const key = keys.questCompleted(villageId(), "q-l8clip", "c-l8clip", u, CREDITS);
      await mint(pool, { toUserId: u, tokenSlug: CREDITS, amount: 5, from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key });
      const back = await reverse(pool, key, { note: "\u{1F600}".repeat(400) });
      expect(back.ok).toBe(true);
      const row = await stored(keys.reversal(villageId(), key));
      // 400 characters plus the key's tail, which is under the 500 the column
      // holds. The old arithmetic saw 800 and clipped.
      expect(row.chars).toBeLessThanOrEqual(500);
      expect(row.chars).toBeGreaterThan(400);
      expect(row.hex).not.toContain("EFBFBD");
    });

    it("clips a genuinely oversized astral note on a character boundary", async () => {
      const u = await makeMember("l8-clip2");
      const key = keys.questCompleted(villageId(), "q-l8clip2", "c-l8clip2", u, CREDITS);
      await mint(pool, { toUserId: u, tokenSlug: CREDITS, amount: 5, from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key });
      const back = await reverse(pool, key, { note: "\u{1F600}".repeat(600) });
      expect(back.ok).toBe(true);
      const row = await stored(keys.reversal(villageId(), key));
      expect(row.chars).toBeLessThanOrEqual(500);
      expect(row.hex).not.toContain("EFBFBD");
      // The clip is still marked, and the key still survives whole.
      const [rows] = await pool.query<any[]>(
        "SELECT `description` AS d FROM `token_ledger` WHERE `idempotency_key` = ?",
        [keys.reversal(villageId(), key)],
      );
      expect(String(rows[0].d)).toContain("...");
      expect(String(rows[0].d)).toContain(key);
    });
  });

  describe("W3 F11: a long reverse() note is clipped, never thrown", () => {
    it("refuses nothing and strands nothing when the note runs past varchar(500)", async () => {
      // ADVERSARY E3. Observed then:
      //   E3 600-char note -> {"THREW":"ER_DATA_TOO_LONG"}
      // balance unchanged at 25 and no mirror row: the reversal did not
      // happen and the caller got an exception rather than a refusal. In
      // `voiceClaim.settleClaim` the claim is compare-and-set to a TERMINAL
      // state before this call, so the throw escapes past the repair branch
      // and the member loses the voice AND the note that says so.
      const u = await makeMember("f11-note");
      const key = keys.questCompleted(villageId(), "q-f11", "c-f11", u, CREDITS);
      await mint(pool, {
        toUserId: u, tokenSlug: CREDITS, amount: 25,
        from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key,
      });
      const out = await reverse(pool, key, { note: "n".repeat(600) });
      expect(out.ok).toBe(true);
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(0);

      const [rows] = await pool.query(
        "SELECT `description` FROM `token_ledger` WHERE `idempotency_key` = ?",
        [keys.reversal(villageId(), key)],
      );
      const description = String((rows as unknown as Array<{ description: string }>)[0].description);
      expect(description.length).toBeLessThanOrEqual(500);
      // The KEY survives whole and the note gives way, in that order: the key
      // is what an auditor uses to find the posting that was undone.
      expect(description.endsWith(`(${key})`)).toBe(true);
      expect(description).toContain("...");
    });

    it("keeps a short note exactly as written", async () => {
      const u = await makeMember("f11-short");
      const key = keys.questCompleted(villageId(), "q-f11b", "c-f11b", u, CREDITS);
      await mint(pool, {
        toUserId: u, tokenSlug: CREDITS, amount: 5,
        from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: key,
      });
      await reverse(pool, key, { note: "withdrawn" });
      const [rows] = await pool.query(
        "SELECT `description` FROM `token_ledger` WHERE `idempotency_key` = ?",
        [keys.reversal(villageId(), key)],
      );
      expect(String((rows as unknown as Array<{ description: string }>)[0].description)).toBe(`withdrawn (${key})`);
    });
  });

  describe("W3 F17/F18: a key builder's segments cannot be moved or folded", () => {
    it("keeps a colon in an id inside its own segment", () => {
      // ADVERSARY A8. Observed then:
      //   PROBE.A8 "quest.completed:local:q:1:c:u" "quest.completed:local:q:1:c:u" true
      // Two distinct occurrences produced one byte-identical key, so the
      // second read as a duplicate and that member was not paid.
      expect(keys.questCompleted("local", "q:1", "c", "u", "credits")).not.toBe(
        keys.questCompleted("local", "q", "1:c", "u", "credits"),
      );
      // And the token-suffix form, which used to be appended unescaped at the
      // call site and is built here now.
      expect(keys.questCompleted("local", "q", "c", "u", "cred:it")).not.toBe(
        keys.questCompleted("local", "q", "c", "u:cred", "it"),
      );
      expect(keys.roleCycle("local", "lunar-1", "s:1", "u", "credits")).not.toBe(
        keys.roleCycle("local", "lunar-1", "s", "1:u", "credits"),
      );
      // A percent has to be escaped too, or the escape is ambiguous with a
      // literal one.
      expect(keys.questCompleted("local", "%3a", "c", "u", "credits")).not.toBe(
        keys.questCompleted("local", ":", "c", "u", "credits"),
      );
    });

    it("keeps two ids that differ only in case apart under a case-insensitive index", () => {
      // ADVERSARY A1. `usr-aB1` and `usr-Ab1` are ONE row to the UNIQUE index.
      const one = keys.questCompleted("local", "q", "c", "usr-aB1", "credits");
      const two = keys.questCompleted("local", "q", "c", "usr-Ab1", "credits");
      expect(one).not.toBe(two);
      // The test that matters: still different once the collation has folded
      // them, which plain byte inequality does not prove.
      expect(one.toLowerCase()).not.toBe(two.toLowerCase());
      // The output carries no uppercase at all, so there is nothing left to fold.
      expect(one).toBe(one.toLowerCase());
    });

    it("still recognises an already-posted legacy-shaped key as a duplicate", async () => {
      // THE IDEMPOTENCY PROOF ACROSS THE CHANGE. Escaping only moves a key
      // when a segment holds `:`, `%` or a capital, and every id generator in
      // this build is lowercase and colon-free (`usr-<epoch>-<base36>`,
      // `randomUUID`, slugs matched against `^[a-z0-9][a-z0-9-]{1,30}$`). So
      // the bytes a builder produced before this change and the bytes it
      // produces now are identical for every key the ledger actually holds,
      // and a replay is still a replay rather than a second payment.
      const u = await makeMember("legacy-dup");
      const legacy = `quest.completed:${villageId()}:q-legacy:c-legacy:${u}:${CREDITS}`;
      const first = await mint(pool, {
        toUserId: u, tokenSlug: CREDITS, amount: 9,
        from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: legacy,
      });
      expect(first.ok && first.duplicate).toBe(false);

      const built = keys.questCompleted(villageId(), "q-legacy", "c-legacy", u, CREDITS);
      expect(built).toBe(legacy);
      const replay = await mint(pool, {
        toUserId: u, tokenSlug: CREDITS, amount: 9,
        from: CYCLE_POOL_FAUCET, source: "quest_consent", idempotencyKey: built,
      });
      expect(replay.ok && replay.duplicate).toBe(true);
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(9);
    });
  });


  // ── Voice that wanes (R3, R15) ───────────────────────────────────────────

  /**
   * ITS OWN SCRATCH SCHEMA, and that is not tidiness.
   *
   * Waning reads EVERY member account holding Voice, and the suites above
   * leave three members holding 1, 100 and 100 minor units between them. On
   * the shared schema a "one member was too small to wane" count would read as
   * two, and the sink would hold units nobody in this block ever minted. Every
   * number below is exact, so the village it is measured in has to be.
   *
   * `beforeEach` empties the Voice ledger between tests for the same reason. A
   * raw DELETE is never allowed in product code and is the right tool here: it
   * is a fixture reset in a schema that exists for six seconds, and the
   * alternative is every test carrying the arithmetic of every test before it.
   */
  describe("Voice that wanes", () => {
    let ddb: TestDb;
    let dpool: mysql.Pool;
    let seedNo = 0;

    beforeAll(async () => {
      ddb = await provisionTestDb();
      dpool = mysql.createPool({ uri: ddb.url, timezone: "Z", connectionLimit: 10 });
      await loadTokenRegistry(dpool);
      await loadVariables(dpool);
      await ensureVoiceToken(dpool, "Village Voice");
      await loadTokenRegistry(dpool);
      await economyEpoch(dpool);
    });

    afterAll(async () => {
      await dpool?.end();
      await ddb?.drop();
    });

    beforeEach(async () => {
      await dpool.query("DELETE FROM `token_ledger` WHERE `token_type` = ?", [VILLAGE_VOICE]);
      await dpool.query("DELETE FROM `token_balances` WHERE `token_type` = ?", [VILLAGE_VOICE]);
      await dpool.query("DELETE FROM `exits`");
      // One enabled rule, so `economyReady` is true, and DELIBERATELY not a
      // `role.cycle` one: that is the village shape the early-return trap
      // lives in, so every test here runs inside the trap rather than one.
      await dpool.query("DELETE FROM `mint_rules` WHERE `village_id` = ?", [villageId()]);
      await dpool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
          "VALUES ('decay-quest-rule', ?, 'quest.completed', ?, 10, 100, 'claimant', 1)",
        [villageId(), VILLAGE_VOICE],
      );
    });

    /** A member holding `units` minor units of Voice, issued from the faucet. */
    async function holding(id: string, units: number): Promise<string> {
      await dpool.query(
        "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
          "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
        [id, id, `${id}@examples.invalid`],
      );
      const r = await mint(dpool, {
        toUserId: id,
        tokenSlug: VILLAGE_VOICE,
        amount: units,
        from: VOICE_MINT,
        source: "role_cycle",
        sourceRef: id,
        description: "seeded for a waning test",
        idempotencyKey: `test.waning.seed:${id}:${++seedNo}`,
      });
      expect(r.ok, `seeding ${id}`).toBe(true);
      return id;
    }

    /** Conservation, read the way the boot invariant reads it. */
    async function voiceSum(): Promise<number> {
      const [rows] = await dpool.query<any[]>(
        "SELECT COALESCE(SUM(`balance`), 0) AS s FROM `token_balances` WHERE `token_type` = ?",
        [VILLAGE_VOICE],
      );
      return Number(rows[0].s);
    }

    it("wanes 1 percent of 5.000 Voice, and the books still balance", async () => {
      // Nothing sets the dial here ON PURPOSE. An unset dial reads the
      // platform default, and the default IS the ruling: 1 percent a cycle.
      expect(numberVar("economy.voice_decay_pct")).toBe(1);

      const at = new Date();
      const u = await holding("wane-five", 5000);
      const out = await runSettlement(dpool, at);

      // 5000 minor units at VOICE_DECIMALS = 2 is 50.00 Voice. One percent of
      // it is 50 units, which is 0.50 Voice, so the chip reads 49.50. The
      // assertions are in MINOR units, so they hold at any scale and the scale
      // only decides what a member reads.
      expect(await balanceOf(dpool, memberAccount(u), VILLAGE_VOICE)).toBe(4950);
      expect(await balanceOf(dpool, VOICE_DECAY, VILLAGE_VOICE)).toBe(50);
      // The whole reason waning is a posting: per token, every balance still
      // sums to zero.
      expect(await voiceSum()).toBe(0);
      expect(out.decay).toEqual({
        slug: VILLAGE_VOICE,
        pct: 1,
        total: 50,
        holders: 1,
        skippedTooSmall: 0,
        skippedExiting: 0,
        cycleKey: cycleWindow(at).key,
      });
    });

    it("follows floor arithmetic for twelve moons, and conserves at every step", async () => {
      const u = await holding("wane-twelve", 5000);
      /*
       * Floored, never rounded, twelve times. Rounding would take 4950, 4901,
       * 4852, 4803 ... and the fourth number is where the two series part: one
       * percent of 4852 is 48.52, which rounds to 49 and floors to 48. Taking
       * the larger of the two is taking more than the dial says.
       */
      const expected = [4950, 4901, 4852, 4804, 4756, 4709, 4662, 4616, 4570, 4525, 4480, 4436];
      const start = new Date();
      const seen: number[] = [];
      const cycles = new Set<string>();

      for (let i = 0; i < 12; i += 1) {
        // Thirty days apart, which is longer than a lunation (29.53 days), so
        // each run lands in its own cycle. The set below proves it did.
        const at = new Date(start.getTime() + i * 30 * 24 * 60 * 60 * 1000);
        cycles.add(cycleWindow(at).key);
        await runSettlement(dpool, at);
        seen.push(await balanceOf(dpool, memberAccount(u), VILLAGE_VOICE));
        expect(await voiceSum(), `moon ${i + 1}`).toBe(0);
      }

      expect(cycles.size).toBe(12);
      expect(seen).toEqual(expected);
      expect(await balanceOf(dpool, VOICE_DECAY, VILLAGE_VOICE)).toBe(5000 - 4436);
    });

    it("wanes nothing twice in one moon, and a resumed run finishes a partial one", async () => {
      const a = await holding("wane-twice-a", 5000);
      const b = await holding("wane-twice-b", 5000);
      const at = new Date();
      const cycleKey = cycleWindow(at).key;

      // A PARTIAL RUN, written by hand: the first member's posting landed and
      // the process died before the second. That is what an interrupted
      // hourly job leaves behind, and there is no flag anywhere recording it.
      const first = await postTransfer(dpool, {
        from: memberAccount(a),
        to: VOICE_DECAY,
        tokenType: VILLAGE_VOICE,
        amount: 50,
        source: "voice_decay",
        sourceRef: cycleKey,
        description: "Voice that waned this moon",
        idempotencyKey: keys.voiceDecay(villageId(), cycleKey, a, VILLAGE_VOICE),
      });
      expect(first.ok).toBe(true);

      const resumed = await runSettlement(dpool, at);
      expect(await balanceOf(dpool, memberAccount(a), VILLAGE_VOICE)).toBe(4950);
      expect(await balanceOf(dpool, memberAccount(b), VILLAGE_VOICE)).toBe(4950);
      // Only the member the partial run never reached is new work.
      expect(resumed.decay.holders).toBe(1);
      expect(resumed.decay.total).toBe(50);
      expect(await balanceOf(dpool, VOICE_DECAY, VILLAGE_VOICE)).toBe(100);

      // And the hourly job asking again inside the same moon moves nothing.
      const again = await runSettlement(dpool, at);
      expect(again.decay.holders).toBe(0);
      expect(again.decay.total).toBe(0);
      expect(await balanceOf(dpool, memberAccount(a), VILLAGE_VOICE)).toBe(4950);
      expect(await balanceOf(dpool, memberAccount(b), VILLAGE_VOICE)).toBe(4950);
      expect(await balanceOf(dpool, VOICE_DECAY, VILLAGE_VOICE)).toBe(100);
      expect(await voiceSum()).toBe(0);
    });

    it("wanes in a village whose only rule is quest.completed", async () => {
      /*
       * THE EARLY-RETURN TRAP. `runSettlement` returns as soon as no
       * `role.cycle` rule is in force, and waning written after that line
       * would never run in this village at all: the dial would read 1 percent
       * and nothing would ever move, with no error and no log line.
       */
      expect(await rulesFor(dpool, "role.cycle")).toHaveLength(0);
      const u = await holding("wane-quest-only", 5000);
      const out = await runSettlement(dpool);

      expect(out.stewardsThanked).toBe(0);
      expect(out.decay.holders).toBe(1);
      expect(await balanceOf(dpool, memberAccount(u), VILLAGE_VOICE)).toBe(4950);
    });

    it("does not wane the seat payout that this same moon just made", async () => {
      /*
       * WHERE THE STEP SITS IS AN ECONOMIC DECISION, not a tidiness one.
       *
       * Waning runs BEFORE the seat loop, so a balance wanes only after it has
       * sat through a cycle. That is what makes the published ceiling true: an
       * accrual of `a` a moon against a rate `d` settles at `a / d`. Waning
       * after the payout would settle at `a * (1 - d) / d`, a whole cycle of
       * accrual lower than every figure a founder is shown beside the dial.
       */
      await dpool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
          "VALUES ('decay-seat-rule', ?, 'role.cycle', ?, 50, 200, 'holder', 1)",
        [villageId(), VILLAGE_VOICE],
      );
      const id = "wane-seated";
      await dpool.query(
        "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
          "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
        [id, id, `${id}@examples.invalid`],
      );
      await dpool.query(
        "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
        [memberAccount(id), "member", id, id],
      );
      await dpool.query("INSERT IGNORE INTO `org_roles` (`id`, `name`, `is_example`) VALUES (?,?,0)", [
        `role-${id}`,
        `Seat for ${id}`,
      ]);
      await dpool.query(
        "INSERT IGNORE INTO `org_role_assignments` " +
          "(`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `is_example`) VALUES (?,?,'member',?,?,0)",
        [`seat-${id}`, `role-${id}`, id, id],
      );

      /*
       * The rule pays 50 in HUMAN Voice, so what lands in the ledger is 50
       * times the token's scale. Written as that arithmetic and not as a
       * constant: every other case in this block seeds MINOR units directly
       * and is scale-free, and this is the one that converts, so it is the one
       * that has to say which scale it converted at.
       */
      const seat = 50 * 10 ** VOICE_DECIMALS;
      const first = new Date();
      const firstRun = await runSettlement(dpool, first);
      // Nothing waned: the member held nothing when the moon opened.
      expect(firstRun.decay.holders).toBe(0);
      expect(await balanceOf(dpool, memberAccount(id), VILLAGE_VOICE)).toBe(seat);

      const second = new Date(first.getTime() + 30 * 24 * 60 * 60 * 1000);
      await runSettlement(dpool, second);
      // One percent of what they held at the open, then this moon's seat.
      const waned = Math.floor(seat / 100);
      expect(await balanceOf(dpool, memberAccount(id), VILLAGE_VOICE)).toBe(seat - waned + seat);
      expect(await balanceOf(dpool, VOICE_DECAY, VILLAGE_VOICE)).toBe(waned);
      expect(await voiceSum()).toBe(0);
    });

    it("MEASURED: a member who held nothing at the moon's first ask wanes on what it paid them", async () => {
      /*
       * NOT a proof that this is right, only a record of what it does.
       *
       * The job asks hourly and a member holding nothing is not in the read,
       * so no key is written for them. Paid later in the same moon, the next
       * ask finds a positive balance and wanes one percent of it. It happens
       * once in a member's life and closing it would mean posting a ledger row
       * of zero, which `postTransfer` refuses. If the founder decides a new
       * member's first moon should be untouched, this test is where that
       * decision changes.
       */
      const at = new Date();
      const firstAsk = await runSettlement(dpool, at);
      expect(firstAsk.decay.holders).toBe(0);

      const u = await holding("wane-latecomer", 50000);
      const secondAsk = await runSettlement(dpool, at);
      expect(secondAsk.decay.holders).toBe(1);
      expect(await balanceOf(dpool, memberAccount(u), VILLAGE_VOICE)).toBe(49500);
    });

    it("leaves a member who is in the middle of leaving alone, and says how many", async () => {
      const leaver = await holding("wane-leaver", 5000);
      const staying = await holding("wane-stayer", 5000);
      const exit = await createExit(dpool, {
        userId: leaver,
        kind: "voluntary",
        openedBy: "admin-1",
        noticeDays: 0,
      });
      expect(exit.ok).toBe(true);

      const out = await runSettlement(dpool);
      // Their balances are already on the way to `sys:exit-settlement` and a
      // notice period has been quoted to them. Moving the number mid
      // departure changes what they settle at after they were told.
      expect(await balanceOf(dpool, memberAccount(leaver), VILLAGE_VOICE)).toBe(5000);
      expect(await balanceOf(dpool, memberAccount(staying), VILLAGE_VOICE)).toBe(4950);
      expect(out.decay.skippedExiting).toBe(1);
      expect(out.decay.holders).toBe(1);
      expect(out.decay.total).toBe(50);
    });

    it("wanes nothing from a balance too small to reach, and counts those members", async () => {
      // 50 minor units is 0.05 Voice. One percent of it is half a unit, and
      // the ledger holds integers, so flooring makes this an exemption rather
      // than a unit quietly costed to somebody.
      const dust = await holding("wane-dust", 50);
      const out = await runSettlement(dpool);

      expect(await balanceOf(dpool, memberAccount(dust), VILLAGE_VOICE)).toBe(50);
      expect(await balanceOf(dpool, VOICE_DECAY, VILLAGE_VOICE)).toBe(0);
      expect(out.decay.skippedTooSmall).toBe(1);
      expect(out.decay.holders).toBe(0);
      expect(out.decay.total).toBe(0);
    });

    it("never touches the bridge or the settled account", async () => {
      const u = await holding("wane-bridge", 5000);
      // Voice on its way to Hypha is debited from the member at REQUEST and
      // held by the bridge, and part of it has already settled.
      const held = await postTransfer(dpool, {
        from: memberAccount(u),
        to: VOICE_BRIDGE,
        tokenType: VILLAGE_VOICE,
        amount: 1000,
        source: "voice_claim",
        description: "Voice claimed toward Hypha",
        idempotencyKey: "test.waning.bridge",
      });
      expect(held.ok).toBe(true);
      const settled = await postTransfer(dpool, {
        from: VOICE_BRIDGE,
        to: VOICE_SETTLED,
        tokenType: VILLAGE_VOICE,
        amount: 400,
        source: "voice_claim_settled",
        description: "settled on Hypha",
        idempotencyKey: "test.waning.settled",
      });
      expect(settled.ok).toBe(true);

      await runSettlement(dpool);

      // Waning the bridge would change the amount arriving at the far end of
      // a crossing that has already been quoted, and a later refund reverses
      // the original debit, so it would then hand back a different number
      // than was taken.
      expect(await balanceOf(dpool, VOICE_BRIDGE, VILLAGE_VOICE)).toBe(600);
      expect(await balanceOf(dpool, VOICE_SETTLED, VILLAGE_VOICE)).toBe(400);
      // The member's own remaining 4000 wanes as normal.
      expect(await balanceOf(dpool, memberAccount(u), VILLAGE_VOICE)).toBe(3960);
      expect(await balanceOf(dpool, VOICE_DECAY, VILLAGE_VOICE)).toBe(40);
      expect(await voiceSum()).toBe(0);
    });

    it("wanes nothing at all when the dial is set to 0", async () => {
      const u = await holding("wane-off", 5000);
      const at = new Date();
      const set = await setVariable(dpool, "economy.voice_decay_pct", "0");
      expect(set.ok).toBe(true);
      try {
        const out = await runSettlement(dpool, at);
        // Zero means zero. Nothing is counted either, because nothing was
        // attempted: a member is not "too small to wane" in a village that
        // does not wane.
        expect(out.decay).toEqual({
          slug: VILLAGE_VOICE,
          pct: 0,
          total: 0,
          holders: 0,
          skippedTooSmall: 0,
          skippedExiting: 0,
          cycleKey: cycleWindow(at).key,
        });
        expect(await balanceOf(dpool, memberAccount(u), VILLAGE_VOICE)).toBe(5000);
        expect(await balanceOf(dpool, VOICE_DECAY, VILLAGE_VOICE)).toBe(0);
      } finally {
        await setVariable(dpool, "economy.voice_decay_pct", "1");
      }
    });

    it("refuses an unshipped basis, and wanes nothing if one is written by hand", async () => {
      // The dial offers ONE value. `unspent` is not shippable here because a
      // member's balance already IS their unspent Voice: Voice leaves a member
      // account through a voice claim and an exit sweep, and both have taken
      // it out of the balance before this reads it.
      const refused = await setVariable(dpool, "economy.voice_decay_basis", "unspent");
      expect(refused.ok).toBe(false);

      const u = await holding("wane-basis", 5000);
      // The only way to a value the registry refuses is a hand-written row,
      // and failing CLOSED in the taking direction is the only safe way to
      // fail.
      await dpool.query(
        "INSERT INTO `game_variables` (`config_key`, `value`, `value_type`) VALUES (?,?,?) " +
          "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
        ["economy.voice_decay_basis", "unspent", "text"],
      );
      await loadVariables(dpool);
      try {
        const problems: Array<{ token: string; reason: string }> = [];
        const summary = await decayVoice(dpool, new Date(), problems);
        expect(summary.holders).toBe(0);
        expect(summary.total).toBe(0);
        expect(problems).toEqual([]);
        expect(await balanceOf(dpool, memberAccount(u), VILLAGE_VOICE)).toBe(5000);
      } finally {
        await dpool.query("DELETE FROM `game_variables` WHERE `config_key` = ?", [
          "economy.voice_decay_basis",
        ]);
        await loadVariables(dpool);
      }
    });

    it("leaves checkLedgerInvariants with nothing new to say", async () => {
      // PROVED rather than assumed. The sink is a non-faucet account whose
      // balance only rises, so no invariant here has to learn about it: the
      // conservation sum, the cache-drift join and the negative-balance check
      // all read it correctly as an ordinary account.
      const before = await checkLedgerInvariants(dpool);
      expect(before.problems).toEqual([]);

      await holding("wane-invariants", 5000);
      await runSettlement(dpool);
      expect(await balanceOf(dpool, VOICE_DECAY, VILLAGE_VOICE)).toBe(50);

      const after = await checkLedgerInvariants(dpool);
      expect(after.problems).toEqual([]);
      expect(after.ok).toBe(true);
    });

    it("wanes nothing in a village whose engine is not running", async () => {
      const u = await holding("wane-not-ready", 5000);
      await dpool.query("DELETE FROM `mint_rules` WHERE `village_id` = ?", [villageId()]);
      const at = new Date();
      expect((await economyReady(dpool)).ready).toBe(false);

      const out = await runSettlement(dpool, at);
      // Every number zero, and the field still present. A reader cannot
      // mistake "the engine never reached this step" for "nothing waned",
      // because `pct` is 0 here while the dial itself reads 1.
      expect(out.decay).toEqual({
        slug: VILLAGE_VOICE,
        pct: 0,
        total: 0,
        holders: 0,
        skippedTooSmall: 0,
        skippedExiting: 0,
        cycleKey: cycleWindow(at).key,
      });
      expect(numberVar("economy.voice_decay_pct")).toBe(1);
      expect(await balanceOf(dpool, memberAccount(u), VILLAGE_VOICE)).toBe(5000);
      expect(await balanceOf(dpool, VOICE_DECAY, VILLAGE_VOICE)).toBe(0);
    });

    it("wanes nothing before the village has voted its Game into existence", async () => {
      /*
       * `economyReady` does NOT cover this, although the design said it did:
       * `seedEconomy` writes four of its five rules enabled at BOOT, so a
       * village that has never issued a token reads as ready. The founding
       * allocation would have waned before the launch vote, which is the
       * opposite of what the birthing screen promises.
       */
      const u = await holding("wane-prelaunch", 5000);
      const [saved] = await dpool.query<any[]>(
        "SELECT `value` FROM `app_config` WHERE `config_key` = 'game-start'",
      );
      await dpool.query("DELETE FROM `app_config` WHERE `config_key` = 'game-start'");
      try {
        expect((await economyReady(dpool)).ready).toBe(true);
        const out = await runSettlement(dpool);
        // The dial WAS read, and the launch fact is what stopped it. That is
        // the difference between this row and the one above.
        expect(out.decay.pct).toBe(1);
        expect(out.decay.holders).toBe(0);
        expect(await balanceOf(dpool, memberAccount(u), VILLAGE_VOICE)).toBe(5000);
        expect(await balanceOf(dpool, VOICE_DECAY, VILLAGE_VOICE)).toBe(0);
      } finally {
        await dpool.query(
          "INSERT IGNORE INTO `app_config` (`config_key`, `value`) VALUES ('game-start', ?)",
          [typeof saved[0].value === "string" ? saved[0].value : JSON.stringify(saved[0].value)],
        );
      }
    });

    it("names the sink in the settlement report when the account is missing, once", async () => {
      const a = await holding("wane-nosink-a", 5000);
      const b = await holding("wane-nosink-b", 5000);
      await dpool.query("DELETE FROM `token_balances` WHERE `account_id` = ?", [VOICE_DECAY]);
      await dpool.query("DELETE FROM `ledger_accounts` WHERE `id` = ?", [VOICE_DECAY]);
      try {
        const out = await runSettlement(dpool);
        // `postTransfer` RETURNS a refusal for a missing system account, so
        // without this the village would wane nothing, silently, forever.
        expect(out.decay.holders).toBe(0);
        const named = out.unpayable.filter((p) => p.reason.includes(VOICE_DECAY));
        // ONE line for two members, and it would be one for four hundred: a
        // report that repeats itself per member is a report nobody reads.
        expect(named).toHaveLength(1);
        expect(named[0].token).toBe(VILLAGE_VOICE);
        expect(await balanceOf(dpool, memberAccount(a), VILLAGE_VOICE)).toBe(5000);
        expect(await balanceOf(dpool, memberAccount(b), VILLAGE_VOICE)).toBe(5000);
      } finally {
        await dpool.query(
          "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,NULL,?,0)",
          [VOICE_DECAY, "system", "Voice that waned"],
        );
      }
    });

    it("publishes what has waned beside what was issued", async () => {
      const u = await holding("wane-supply", 5000);
      const before = (await publicSupply(dpool)).tokens.find((t) => t.token === "Village Voice");
      expect(before).toMatchObject({ issued: 5000, waned: 0, circulating: 5000 });

      await runSettlement(dpool);

      // `issued` counts what came OUT of a faucet and nothing puts it back, so
      // on its own it would climb every moon while this member's chip fell.
      const after = (await publicSupply(dpool)).tokens.find((t) => t.token === "Village Voice");
      expect(after).toMatchObject({ issued: 5000, waned: 50, circulating: 4950 });
      expect(await balanceOf(dpool, memberAccount(u), VILLAGE_VOICE)).toBe(4950);
    });
  });

  /*
   * ── THE CEILING BINDS THE NUMBER THAT IS ACTUALLY POSTED (MX) ─────────────
   *
   * The block far above proves the clamp answers correctly in the rule's own
   * human units. This one is about the UNIT it handed that answer to.
   * `mint_rules.ceiling` is `decimal(18,4)` and six of the seven shipped
   * tokens carry 0 decimals, so the column holds places the token cannot, and
   * `toLedgerUnits` ROUNDS. Both mint paths compared exactly and then rounded,
   * and the rounding was bounded by nothing.
   *
   * Measured on this build before the fix, read off `token_ledger`:
   *
   *   decimals 0   amount 0.6    ceiling 0.5     posted 1     200% of the cap
   *   decimals 0   amount 1.5    ceiling 1.5     posted 2
   *   decimals 0   amount 25.5   ceiling 25.5    posted 26
   *   decimals 3   amount 0.0006 ceiling 0.0005  posted 1 thousandth
   *
   * MOVING THE CLAMP INTO MINOR UNITS WOULD HAVE CHANGED NOTHING, and that is
   * the part worth writing down. Rounding is monotone, so
   * `round(min(a, c) * s)` and `min(round(a * s), round(c * s))` are the same
   * number for every input on this table. The fix is the DIRECTION: an amount
   * rounds to the nearest payable figure, and a bound may only ever fall.
   */
  describe("the ceiling binds the number that is posted", () => {
    // `library-credit` because it has a faucet (`sys:library-mint`), so the
    // engine can actually pay it, and because no other block in this file
    // holds a `quest.completed` rule on it. A token with no faucet would be
    // refused by `ruleCannotPay` and the ceiling would never be reached.
    const TOKEN = "library-credit";
    const RULE = "rule-mx-ceiling";
    const SEAT_RULE = "rule-mx-seat";
    const SEAT = "seat-mx-ceiling";

    /**
     * Re-denominate the test token and reload the registry that reads it.
     *
     * `registerToken` deliberately never moves `decimals` on an existing row,
     * because rescaling a token that holds balances multiplies everyone's
     * holdings and no invariant would notice. This suite writes the column
     * directly to walk one token across the scales the flip will walk it.
     */
    async function atScale(decimals: number): Promise<void> {
      await pool.query("UPDATE `tokens` SET `decimals` = ? WHERE `slug` = ?", [decimals, TOKEN]);
      await loadTokenRegistry(pool);
    }

    async function setRule(amount: number | null, ceiling: number): Promise<void> {
      await pool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`, `effective_from_cycle`) " +
          "VALUES (?,?,'quest.completed',?,?,?,'claimant',1,0) " +
          "ON DUPLICATE KEY UPDATE `amount` = VALUES(`amount`), `ceiling` = VALUES(`ceiling`), " +
          "`enabled` = 1, `effective_from_cycle` = 0, `pending_from_cycle` = NULL",
        [RULE, villageId(), TOKEN, amount, ceiling],
      );
    }

    async function setSeatRule(amount: number | null, ceiling: number): Promise<void> {
      await pool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`, `effective_from_cycle`) " +
          "VALUES (?,?,'role.cycle',?,?,?,'holder',1,0) " +
          "ON DUPLICATE KEY UPDATE `amount` = VALUES(`amount`), `ceiling` = VALUES(`ceiling`), " +
          "`enabled` = 1, `effective_from_cycle` = 0, `pending_from_cycle` = NULL",
        [SEAT_RULE, villageId(), TOKEN, amount, ceiling],
      );
    }

    /** What the ledger holds for one member in this token, off the rows. */
    async function heldBy(userId: string): Promise<number> {
      const [rows] = await pool.query<any[]>(
        "SELECT COALESCE(SUM(`amount`), 0) AS units FROM `token_ledger` " +
          "WHERE `to_account` = ? AND `token_type` = ?",
        [memberAccount(userId), TOKEN],
      );
      return Number(rows[0]?.units ?? 0);
    }

    beforeAll(async () => {
      await registerToken(pool, {
        slug: TOKEN, name: "Library Credit", kind: "credit",
        governance: "platform", transferable: false, decimals: 0,
      });
      await atScale(0);
    });

    afterAll(async () => {
      await pool.query("DELETE FROM `mint_rules` WHERE `id` IN (?,?)", [RULE, SEAT_RULE]);
      await pool.query("DELETE FROM `org_role_assignments` WHERE `id` = ?", [SEAT]);
      await atScale(0);
    });

    // The adversary's table, driven through the real mint path and read back
    // off `token_ledger`, never off a return value: a mint that reported 0.5
    // and posted 1 would pass an assertion on what it said it did.
    const table: Array<{ decimals: number; amount: number; ceiling: number; units: number }> = [
      { decimals: 0, amount: 0.6, ceiling: 0.5, units: 0 },
      { decimals: 0, amount: 1.5, ceiling: 1.5, units: 1 },
      { decimals: 0, amount: 25.5, ceiling: 25.5, units: 25 },
      { decimals: 3, amount: 0.0006, ceiling: 0.0005, units: 0 },
      { decimals: 3, amount: 0.0015, ceiling: 0.0015, units: 1 },
      // Four, where nothing the column can write is below what the token can
      // hold, so the clamp is the plain one and neither refusal fires. No
      // shipped token carries this scale and none is going to: Rye settled the
      // question on whole numbers (section 11.1). It is here because
      // `tokens.decimals` is an int a village writes and `registerToken` takes
      // whatever it is given, so a fork can reach this column any day.
      { decimals: 4, amount: 0.6, ceiling: 0.5, units: 5000 },
      { decimals: 4, amount: 0.4, ceiling: 0.5, units: 4000 },
    ];
    for (const row of table) {
      const tag = `${row.decimals}-${String(row.amount).replace(".", "p")}`;
      it(`posts at or below a ceiling of ${row.ceiling} at ${row.decimals} decimals`, async () => {
        await atScale(row.decimals);
        await setRule(row.amount, row.ceiling);
        const u = await makeMember(`mx-ceil-${tag}`);
        await mintForConfirmedClaim(pool, {
          id: `claim-mx-${tag}`, questId: "q-mx", userId: u, confirmedAt: new Date(),
        });
        const units = await heldBy(u);
        expect(units).toBe(row.units);
        // The property, in the ceiling's own units and independent of the
        // table: nothing the ledger holds is above what the village voted for.
        expect(units / 10 ** row.decimals).toBeLessThanOrEqual(row.ceiling);
        expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
      });
    }

    it("returns the ledger row and not the number before it was rounded", async () => {
      await atScale(3);
      await setRule(0.0015, 0.0015);
      const u = await makeMember("mx-return-row");
      const out = await mintForConfirmedClaim(pool, {
        id: "claim-mx-return", questId: "q-mx", userId: u, confirmedAt: new Date(),
      });
      // The row holds one thousandth. The old return value said 0.0015, which
      // is a figure no row in this database holds, and a route logging it told
      // the member a number that was never posted.
      expect(out.minted.find((m) => m.token === TOKEN)).toEqual({
        token: TOKEN, units: await heldBy(u), decimals: 3,
      });
      expect(await heldBy(u)).toBe(1);
    });

    it("says which number stopped it when a ceiling falls below what the token can hold", async () => {
      await atScale(0);
      await setRule(25, 0.5);
      const u = await makeMember("mx-ceil-unreachable");
      const out = await mintForConfirmedClaim(pool, {
        id: "claim-mx-unreachable", questId: "q-mx", userId: u, confirmedAt: new Date(),
      });
      expect(await heldBy(u)).toBe(0);
      const said = out.unpayable.find((x) => x.token === TOKEN);
      // A ceiling fact gets a ceiling's sentence. Reporting it as "the amount
      // is too small" would send the founder to the number that is fine.
      expect(said?.reason).toMatch(/ceiling is 0.5/);
      expect(said?.reason).toMatch(/Raise the ceiling or pause the rule/);
    });

    it("publishes what the engine will pay on the feed a member reads", async () => {
      await atScale(0);
      await setRule(25, 5);
      const shown = (await publicRules(pool)).find((r) => r.token === "Library Credit");
      // The engine pays 5. This feed is unauthenticated and it published 25.
      expect(shown?.says).toContain("5 Library Credit");
      expect(shown?.says).not.toContain("25 Library Credit");

      await setRule(25, 0);
      const shut = (await publicRules(pool)).find((r) => r.token === "Library Credit");
      expect(shut?.says).toContain("no Library Credit");
    });

    it("previews and settles the same number, and never a payout the run will not make", async () => {
      await atScale(0);
      await setSeatRule(25, 5);
      await pool.query(
        "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `is_example`) " +
          "VALUES (?,'role-mx','member',?,?,0) ON DUPLICATE KEY UPDATE `user_id` = VALUES(`user_id`)",
        [SEAT, await makeMember("mx-seat-holder"), "mx-seat-holder"],
      );
      const view = await mintView(pool);
      const seats = view.settlementPreview.seats;
      const previewed = view.settlementPreview.mints.find((m) => m.token === TOKEN);
      // The preview said `amount * seats` and the engine pays `clamp * seats`.
      expect(previewed).toEqual({ token: TOKEN, units: 5 * seats, decimals: 0 });
      // And the panel's own card states the clamp and the cap, so a founder
      // reading the rule sees the same number the preview does.
      const card = view.rules.find((r) => r.id === SEAT_RULE);
      expect(card?.pays).toEqual({ units: 5, ceilingUnits: 5, decimals: 0 });
      expect(card?.problem).toBeNull();

      const out = await runSettlement(pool);
      expect(out.minted.find((m) => m.token === TOKEN)).toEqual({ token: TOKEN, units: 5, decimals: 0 });
      expect(await heldBy("mx-seat-holder")).toBe(5);
    });

    it("previews nothing where the engine would pay nothing, and says why", async () => {
      await atScale(0);
      await setSeatRule(25, 0);
      const view = await mintView(pool);
      expect(view.settlementPreview.mints.map((m) => m.token)).not.toContain(TOKEN);
      const card = view.rules.find((r) => r.id === SEAT_RULE);
      // Served AND carried by the client's own interface now, so the panel can
      // stop putting a green badge over a rule that pays nobody.
      expect(card?.problem).toMatch(/ceiling is 0/);
      expect(card?.pays).toEqual({ units: 0, ceilingUnits: 0, decimals: 0 });
    });

    it("carries the scale for the one shipped token that has one, which is live today", async () => {
      /*
       * NOT A HYPOTHETICAL AND NOT ABOUT THE CANCELLED FLIP. Village Voice
       * carries 3 decimals in the registry as this ships, and the seeded seat
       * rule pays 50 of it. The preview therefore carried 50000 with no scale
       * anywhere in the payload and the panel printed "50000 of village-voice"
       * for a village that had promised 50.
       */
      await pool.query(
        "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`, `effective_from_cycle`) " +
          "VALUES ('rule-mx-voice',?,'role.cycle',?,50,200,'holder',1,0) " +
          "ON DUPLICATE KEY UPDATE `amount` = 50, `ceiling` = 200, `enabled` = 1, `effective_from_cycle` = 0",
        [villageId(), VILLAGE_VOICE],
      );
      const view = await mintView(pool);
      const seats = view.settlementPreview.seats;
      const voice = view.settlementPreview.mints.find((m) => m.token === VILLAGE_VOICE);
      // The scale off the registry, never a literal here: the assertion holds
      // whatever a village has set this token to.
      const scale = await scaleOf(pool, VILLAGE_VOICE);
      expect(voice).toEqual({ token: VILLAGE_VOICE, units: 50 * scale * seats, decimals: Math.log10(scale) });
      expect(voice!.units).toBeGreaterThan(50 * seats);
      await pool.query("DELETE FROM `mint_rules` WHERE `id` = 'rule-mx-voice'");
    });

    it("does not call a settlement that could pay nothing an already settled moon", async () => {
      // The seat rule reads its amount from the work and a seat posts none, so
      // this rule can never pay. It used to sail through the payable filter,
      // pay nobody, and come back `alreadyRun: true` with an EMPTY unpayable
      // list: a misconfiguration reported as a completed moon, which is the
      // reading that stops anybody looking.
      await atScale(0);
      await pool.query("DELETE FROM `mint_rules` WHERE `village_id` = ? AND `trigger` = 'role.cycle'", [
        villageId(),
      ]);
      await setSeatRule(null, 0);
      const out = await runSettlement(pool);
      expect(out.minted).toEqual([]);
      expect(out.alreadyRun).toBe(false);
      expect(out.unpayable.find((x) => x.token === TOKEN)?.reason).toMatch(/reads its amount from the work/);
    });

    // ── What held before this change, and still holds ────────────────────────

    it("still fails closed on every ceiling that is not a positive number", () => {
      const bad: unknown[] = [-1, NaN, null, undefined, "", Infinity, -Infinity];
      for (const c of bad) {
        const out = ceilingOutcome(rule({ amount: 25, ceiling: c as number }), 0, 0, "Library Credit");
        // An Infinity ceiling is the one worth naming: a cap that is not a
        // number must never read as no cap at all.
        expect({ at: String(c), units: out.units, refused: out.refusal !== null })
          .toEqual({ at: String(c), units: 0, refused: true });
      }
      // And the bound itself answers the same way.
      expect(ceilingAtScale(Infinity, 0)).toBe(0);
      expect(ceilingAtScale(NaN, 0)).toBe(0);
    });

    it("still bounds ONE occurrence: twenty at 25 under a ceiling of 250 post 500", async () => {
      // GREEN EITHER WAY, and that is the point. The column is a per-occurrence
      // cap and not a per-cycle budget, so twenty confirmed quests at 25 issue
      // 500 and the ceiling of 250 never fires. Reading it as a budget would
      // make this 250 and would stop the shipped `role.cycle` default after the
      // tenth seat in every village with more than ten seats.
      await atScale(0);
      await setRule(25, 250);
      const u = await makeMember("mx-twenty");
      for (let i = 1; i <= 20; i += 1) {
        await mintForConfirmedClaim(pool, {
          id: `claim-mx-20-${i}`, questId: "q-mx-20", userId: u, confirmedAt: new Date(),
        });
      }
      expect(await heldBy(u)).toBe(500);
      expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
    });

    it("still pays once for one occurrence, and once only", async () => {
      await atScale(0);
      await setRule(25, 5);
      const u = await makeMember("mx-idem");
      const claim = { id: "claim-mx-idem", questId: "q-mx", userId: u, confirmedAt: new Date() };
      await mintForConfirmedClaim(pool, claim);
      const again = await mintForConfirmedClaim(pool, claim);
      expect(again.minted.find((m) => m.token === TOKEN)).toBeUndefined();
      expect(await heldBy(u)).toBe(5);
    });

    it("still holds the ceiling under six concurrent calls on one claim", async () => {
      /*
       * Six calls, two claims, and the clamp has no running total to race on:
       * it is a pure function of the row and the amount, decided before the
       * post. What this measures is that contention cannot get more than the
       * ceiling past it and that the books balance afterwards.
       *
       * `allSettled` and not `all`, and a rejection is an accepted outcome:
       * `postTransfer` rolls back and rethrows on a deadlock victim and
       * neither `mint` nor `mintForConfirmedClaim` catches it, which the block
       * above measured at one run in three. A victim posts nothing at all.
       */
      await atScale(0);
      await setRule(25, 5);
      const a = await makeMember("mx-race-a");
      const b = await makeMember("mx-race-b");
      const call = (id: string, userId: string) =>
        mintForConfirmedClaim(pool, { id, questId: "q-mx-race", userId, confirmedAt: new Date() });
      const settled = await Promise.allSettled([
        call("claim-mx-race-a", a), call("claim-mx-race-a", a), call("claim-mx-race-a", a),
        call("claim-mx-race-b", b), call("claim-mx-race-b", b), call("claim-mx-race-b", b),
      ]);
      for (const s of settled) {
        if (s.status === "rejected") {
          expect(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]).toContain(s.reason?.code);
        }
      }
      // One row each at most, at the ceiling, whatever the ledger did. Read
      // off the rows: a second row would be a double pay and a row above 5
      // would be the clamp losing a race it cannot have.
      for (const who of [a, b]) {
        const [rows] = await pool.query<any[]>(
          "SELECT COUNT(*) AS n, COALESCE(SUM(`amount`), 0) AS units FROM `token_ledger` " +
            "WHERE `to_account` = ? AND `token_type` = ?",
          [memberAccount(who), TOKEN],
        );
        const n = Number(rows[0].n);
        expect(n).toBeLessThanOrEqual(1);
        expect(Number(rows[0].units)).toBe(n * 5);
      }
      expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
    });

    it("refuses a queued change the column would round away", async () => {
      await atScale(0);
      await setRule(25, 250);
      // Reachable through the governed path: `queueRuleChange` is the writer
      // the admin route and the ballot executor both use.
      const zeroed = await queueRuleChange(pool, RULE, { ceiling: 0.00001 }, "admin-mx");
      expect(zeroed.ok).toBe(false);
      expect(zeroed.ok === false && zeroed.error).toContain("nothing at all");
      const off = await queueRuleChange(pool, RULE, { amount: 0.00001 }, "admin-mx");
      expect(off.ok).toBe(false);
      // And the one that used to throw a driver error out of the executor.
      const huge = await queueRuleChange(pool, RULE, { ceiling: 1e14 }, "admin-mx");
      expect(huge.ok).toBe(false);
      expect(huge.ok === false && huge.error).toContain("above that");
      // Nothing was queued by any of the three.
      const [rows] = await pool.query<any[]>(
        "SELECT `pending_from_cycle` FROM `mint_rules` WHERE `id` = ?", [RULE],
      );
      expect(rows[0].pending_from_cycle).toBeNull();
    });
  });
});

/*
 * ── THE GRATITUDE PATH ACROSS A DECIMALS FLIP (sweep lane F) ────────────────
 *
 * WHY THIS SUITE EXISTS. Every gratitude assertion above runs against
 * `gratitude` at `decimals 0`, where a human number and a ledger unit are the
 * same number. At that scale a `toLedgerUnits` call and no call at all are
 * byte-identical, so the suite above stayed green through the whole defect and
 * would stay green through the wrong fix. It cannot detect which unit this
 * engine speaks, and nothing in the tree could until this file.
 *
 * THE SCALE SEAM is `UPDATE tokens SET decimals` followed by
 * `loadTokenRegistry`, which is exactly what the flip migration will do.
 * `registerToken` cannot do it: it leaves `decimals` out of its upsert on
 * purpose, so re-registering a token at boot can never rescale one that
 * already holds a balance.
 *
 * BOTH DIRECTIONS, AND A SCHEMA EACH. The same cases run at 0 and at 4. A case
 * that ran only at 4 could be satisfied by code that is wrong at 0, and a case
 * that ran only at 0 proves nothing whatever. They get separate scratch
 * schemas rather than sharing one, because `allowanceFor`'s reversal SUM is
 * keyed on the note and not on the giver (see the comment at that query), so
 * one scale's reversed gift would otherwise be divided by the other scale and
 * subtracted from its allowance.
 *
 * EVERY EXPECTED NUMBER IS DECIMALS ARITHMETIC over the scale this suite SET
 * (5 Gratitude at four decimals is 5 x 10^4 = 50_000 units), never a call to
 * the conversion under test. Each case reads BOTH sides at once, the ledger
 * row or balance AND the allowance or the note, because a test that reads only
 * one of them is satisfiable by a fix that is wrong by ten thousand on the
 * other.
 */
function gratitudeAtScale(decimals: number): void {
  // 10^decimals, written once so no assertion below has to restate the scale.
  const ONE = 10 ** decimals;
  const tag = `d${decimals}`;

  describe.skipIf(!configured)(`the gratitude path at ${decimals} decimals`, () => {
    let fdb: TestDb;
    let fpool: mysql.Pool;

    beforeAll(async () => {
      fdb = await provisionTestDb();
      fpool = mysql.createPool({ uri: fdb.url, timezone: "Z", connectionLimit: 10 });
      // The seam, before anything is posted. What the flip migration does,
      // minus the rescale of rows already held.
      await fpool.query("UPDATE `tokens` SET `decimals` = ? WHERE `slug` = ?", [decimals, HEARTS]); // module-review-ok: the decimals seam this suite exists to exercise, against the S5 scratch schema
      await loadTokenRegistry(fpool);
      await loadVariables(fpool);
    });

    afterAll(async () => {
      await fpool?.end();
      await fdb?.drop();
    });

    const member = async (id: string): Promise<string> => {
      await fpool.query(
        "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " + // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
        [id, id, `${id}@examples.invalid`],
      );
      await fpool.query(
        "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)", // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        [memberAccount(id), "member", id, id],
      );
      return id;
    };

    /** The ledger row one posting wrote, found by its occurrence key. */
    const legFor = async (key: string) => {
      const [rows] = await fpool.query<any[]>(
        "SELECT `amount`, `token_type` FROM `token_ledger` WHERE `idempotency_key` = ?",
        [key],
      );
      return rows[0] ?? null;
    };

    /** What `gratitude_log` recorded, which is what both allowances sum. */
    const notedAmount = async (noteId: string) => {
      const [rows] = await fpool.query<any[]>(
        "SELECT `amount` FROM `gratitude_log` WHERE `id` = ?",
        [noteId],
      );
      return rows[0] == null ? null : Number(rows[0].amount);
    };

    const noteCount = async (fromId: string) => {
      const [rows] = await fpool.query<any[]>(
        "SELECT COUNT(*) AS n FROM `gratitude_log` WHERE `from_id` = ?",
        [fromId],
      );
      return Number(rows[0].n);
    };

    /**
     * The clawback row `reverse` wrote against one gift, found the way the
     * allowance finds it: by the `source_ref` the mirror carries, which is the
     * gift's own occurrence key. Read as a ROW so a case can say what the
     * mirror does and does not name.
     */
    const mirrorOf = async (giftKey: string) => {
      const [rows] = await fpool.query<any[]>(
        "SELECT `from_account`, `to_account`, `amount`, `source_ref` FROM `token_ledger` " +
          "WHERE `source` = 'reversal' AND `source_ref` = ?",
        [giftKey],
      );
      return rows[0] ?? null;
    };

    const mirrorCount = async (giftKey: string) => {
      const [rows] = await fpool.query<any[]>(
        "SELECT COUNT(*) AS n FROM `token_ledger` WHERE `source` = 'reversal' AND `source_ref` = ?",
        [giftKey],
      );
      return Number(rows[0].n);
    };

    /** The users repo the acknowledgement door needs, over the scratch pool. */
    const usersOver = (p: mysql.Pool): UsersRepo => {
      const load = async (where: string, v: string) => {
        const [rows] = await p.query<any[]>(`SELECT * FROM \`users\` WHERE ${where} = ? LIMIT 1`, [v]);
        return rows[0] ?? null;
      };
      return {
        async all() {
          const [rows] = await p.query<any[]>("SELECT * FROM `users`");
          return rows as any;
        },
        byId: (id: string) => load("`id`", id),
        byEmail: (email: string) => load("`email`", email),
        async update() {
          /* the recipient's balance is measured off the ledger in this suite */
        },
      } as unknown as UsersRepo;
    };

    /*
     * NO `checkLedgerInvariants` CALL IN THIS SUITE, and that is a judgement
     * rather than an omission. Conservation is SCALE-FREE: a gift posted ten
     * thousand times too large still sums to zero against its faucet, so the
     * invariant cannot see a units error and adds nothing to a units proof.
     * What it would have checked here is the balance cache, and every case
     * below already reads that cache with `balanceOf` and pins it to an exact
     * integer. It also runs a GROUP BY and a LEFT JOIN over the whole schema,
     * which on a database shared with eight other lanes answered "Out of
     * memory" twice while the assertions around it were green.
     */
    it("posts a give of five in minor units and spends five of the allowance", async () => {
      const from = await member(`f-give-from-${tag}`);
      const to = await member(`f-give-to-${tag}`);
      const before = await allowanceFor(fpool, from, 1);
      expect(before.spent).toBe(0);

      const res = await give(fpool, { fromUserId: from, toUserId: to, amount: 5 }, AT_GUEST);
      expect(res.ok, res.ok === false ? res.error : "").toBe(true);
      const noteId = String(res.noteId);

      // THE LEDGER, in minor units. 5 times the scale this describe set, which
      // is 5 at zero decimals and 50000 at four.
      const leg = await legFor(keys.gratitudeGiven(villageId(), noteId));
      expect(leg).not.toBeNull();
      expect(Number(leg.amount)).toBe(5 * ONE);
      expect(String(leg.token_type)).toBe(HEARTS);
      expect(await balanceOf(fpool, memberAccount(to), HEARTS)).toBe(5 * ONE);
      // `give` hands its caller the ledger's own number, which is what
      // `MintOutcome.balance` says it is.
      expect(res.ok && res.balance).toBe(5 * ONE);

      // THE NOTE AND THE ALLOWANCE, in human units, and 5 at BOTH scales. The
      // note is the charge, `gratitude_log.amount` is an int, and a member
      // reads these numbers in the refusals.
      expect(await notedAmount(noteId)).toBe(5);
      const after = await allowanceFor(fpool, from, 1);
      expect(after.spent).toBe(5);
      expect(after.remaining).toBe(before.total - 5);

    });

    it("weighs the share cap against the gift in one unit", async () => {
      const from = await member(`f-cap-from-${tag}`);
      const to = await member(`f-cap-to-${tag}`);
      const allowance = await allowanceFor(fpool, from, 1);
      const cap = shareCapFor(allowance.total);
      // The cap lives in the ALLOWANCE's unit, so it cannot exceed it. Scaled
      // to minor units it would be ten thousand times the whole allowance and
      // would bound nothing at all.
      expect(cap).toBeGreaterThan(0);
      expect(cap).toBeLessThanOrEqual(allowance.total);

      const over = await give(fpool, { fromUserId: from, toUserId: to, amount: cap + 1 }, AT_GUEST);
      expect(over.ok).toBe(false);
      // And the sentence names the cap in the unit the member typed in.
      expect(over.ok === false && over.error).toContain(`${cap} is the most`);
      expect(await noteCount(from)).toBe(0);

      const exact = await give(fpool, { fromUserId: from, toUserId: to, amount: cap }, AT_GUEST);
      expect(exact.ok, exact.ok === false ? exact.error : "").toBe(true);
      expect(await balanceOf(fpool, memberAccount(to), HEARTS)).toBe(cap * ONE);
      expect((await allowanceFor(fpool, from, 1)).spent).toBe(cap);
    });

    it("refuses a fractional tap with a sentence rather than truncating it", async () => {
      const from = await member(`f-frac-from-${tag}`);
      const to = await member(`f-frac-to-${tag}`);
      const res = await give(fpool, { fromUserId: from, toUserId: to, amount: 5.5 }, AT_GUEST);
      expect(res.ok).toBe(false);
      expect(res.ok === false && res.error).toMatch(/whole positive/);
      // Nothing written on either side. `gratitude_log.amount` is an int, so a
      // 5.5 that got past this would be stored rounded while the ledger posted
      // 5.5 times the scale, and the allowance would be summed from a number
      // nobody gave.
      expect(await noteCount(from)).toBe(0);
      expect(await balanceOf(fpool, memberAccount(to), HEARTS)).toBe(0);
      expect((await allowanceFor(fpool, from, 1)).spent).toBe(0);
    });

    it("spends the allowance to the unit under forty concurrent gives", async () => {
      const from = await member(`f-exact-from-${tag}`);
      const recipients = await Promise.all(
        Array.from({ length: 8 }, (_, n) => member(`f-exact-to-${n}-${tag}`)),
      );
      const before = await allowanceFor(fpool, from, 1);
      expect(before.spent).toBe(0);
      const each = 5;
      const fits = Math.floor(before.total / each);
      // Five attempts per recipient, which is exactly the share cap at the
      // stock dials, so the share refuses nothing the allowance would allow.
      const attempts = recipients.flatMap((to) => [to, to, to, to, to]);
      expect(attempts.length).toBeGreaterThan(fits);

      const results = await Promise.all(
        attempts.map((to) =>
          give(fpool, { fromUserId: from, toUserId: to, amount: each }, AT_GUEST).catch(
            (e) => ({ ok: false as const, error: String(e?.message ?? e) }),
          ),
        ),
      );

      // The deadlock fix's own assertion, re-run at this scale: the allowance
      // is still exactly enforced, and it is enforced in human units.
      expect(results.filter((r) => r.ok).length).toBe(fits);
      const after = await allowanceFor(fpool, from, 1);
      expect(after.spent).toBe(fits * each);
      expect(after.remaining).toBe(before.total - fits * each);
      // And every one of those gifts arrived at full size, in minor units.
      const delivered = await Promise.all(
        recipients.map((to) => balanceOf(fpool, memberAccount(to), HEARTS)),
      );
      expect(delivered.reduce((a, b) => a + b, 0)).toBe(fits * each * ONE);
    });

    it("sends seven through the acknowledgement door, minor to the ledger and human to the budget", async () => {
      const from = await member(`f-ack-from-${tag}`);
      const to = await member(`f-ack-to-${tag}`);
      const deps: GratitudeDeps = {
        pool: fpool,
        log: gratitudeLogRepo(fpool),
        members: usersOver(fpool),
        stageMultiplierFor: async () => 1,
      };
      const fromUser = await deps.members.byId(from);
      const out = await sendGratitude(deps, {
        fromUser,
        toId: to,
        amount: 7,
        message: "for the water line",
      });
      expect(out.ok, out.ok === false ? out.error : "").toBe(true);
      if (!out.ok) throw new Error(out.error);

      // MINOR to the ledger, and on the token this door now NAMES rather than
      // inheriting from two separate fallbacks in two files.
      //
      // THE KEY IS THE BUILDER'S, and this line used to spell it by hand as
      // `gratitude_received:<entry id>`, which is what the door wrote and
      // what the allowance's refund arm could never find. The assertion below
      // is about units and the token; asserting them through the old spelling
      // made this case a statement that the mismatch was the specification.
      // server/gratitudeKeys.test.ts holds the cases about the key itself.
      const leg = await legFor(keys.gratitudeGiven(villageId(), out.entry.id));
      expect(leg).not.toBeNull();
      expect(String(leg.token_type)).toBe(HEARTS);
      expect(Number(leg.amount)).toBe(7 * ONE);
      expect(await balanceOf(fpool, memberAccount(to), HEARTS)).toBe(7 * ONE);

      // HUMAN to everything a member reads: the budget, the entry, the row.
      expect(out.budget.spent).toBe(7);
      expect(out.entry.amount).toBe(7);
      expect(await notedAmount(out.entry.id)).toBe(7);
    });

    /*
     * IT USED TO HAVE TO RUN LAST IN THIS DESCRIBE, AND D30 IS WHY.
     *
     * `allowanceFor`'s reversal SUM was keyed on the note id and carried no
     * giver, so the reversal below was visible to EVERY allowance in this
     * schema for the rest of the cycle. Run earlier, it took 5 off two later
     * cases and made them fail by exactly that: the share-cap case read a spend
     * of 20 after giving 25, and the concurrency case fitted a twenty-first
     * give into an allowance of 100. Both at decimals 0 and at 4, which is how
     * it was legible as a leak and not as a scale error.
     *
     * Lane AF closed it (`gratitudeGivenInCycle` in server/lib/economy.ts), so
     * the ordering constraint is gone and the cases that prove it are below.
     * The position is left alone because moving a green test proves nothing;
     * what proves it is `isolates the refund to the member who gave`, which
     * fails on the old code wherever it is placed.
     */
    it("refunds five of the allowance when that gift is reversed, never fifty thousand", async () => {
      const from = await member(`f-rev-from-${tag}`);
      const to = await member(`f-rev-to-${tag}`);

      // A gift that STAYS, so the allowance has something to clamp against.
      // Without it both the right answer and the wrong one floor at zero and
      // this case would be green over the defect it exists to catch.
      const kept = await give(fpool, { fromUserId: from, toUserId: to, amount: 3 }, AT_GUEST);
      expect(kept.ok).toBe(true);
      const undoneGift = await give(fpool, { fromUserId: from, toUserId: to, amount: 5 }, AT_GUEST);
      expect(undoneGift.ok).toBe(true);
      expect((await allowanceFor(fpool, from, 1)).spent).toBe(8);

      const key = keys.gratitudeGiven(villageId(), String(undoneGift.noteId));
      // The claim is in MINOR units, which is what the row holds and what
      // `ReverseOpts.amount` states. A wrong unit here is refused rather than
      // posted, so this line is a second reading of the same fact.
      const undone = await reverse(fpool, key, {
        from: memberAccount(to),
        to: RECOGNITION_FAUCET,
        tokenSlug: HEARTS,
        amount: 5 * ONE,
      });
      expect(undone.ok, undone.ok === false ? undone.error : "").toBe(true);
      expect(await balanceOf(fpool, memberAccount(to), HEARTS)).toBe(3 * ONE);

      // THE WHOLE POINT OF THE COMMIT. `given` is 8 human and the reversal SUM
      // is 50000 minor at four decimals. Subtracted raw, `spent` floors at zero
      // and the giver's whole moon comes back; divided first, exactly the 5
      // that was undone returns and the 3 that stands is still spent.
      const after = await allowanceFor(fpool, from, 1);
      expect(after.spent).toBe(3);
      expect(after.remaining).toBe(after.total - 3);
    });

    /*
     * ── D30, THE REFUND THAT PAID THE WHOLE VILLAGE (lane AF) ───────────────
     *
     * The four cases below replace the one this file used to carry, which
     * asserted the leak instead of the answer and said in its own words that
     * whoever closed it should delete it. Deleted here, and the reading it was
     * holding a place for is now the assertion: reversing MY gift returns MY
     * allowance and nobody else's.
     *
     * EVERY NUMBER IS READ BACK OUT OF THE DATABASE. `allowanceFor` is itself a
     * pair of queries over `gratitude_log` and `token_ledger`, and each case
     * also reads the rows underneath it, because a figure that agrees with a
     * return value and not with a row is the shape this defect had.
     */
    it("isolates the refund to the member who gave", async () => {
      const mine = await member(`f-iso-mine-${tag}`);
      const theirs = await member(`f-iso-theirs-${tag}`);
      const to = await member(`f-iso-to-${tag}`);

      const a = await give(fpool, { fromUserId: mine, toUserId: to, amount: 5 }, AT_GUEST);
      const b = await give(fpool, { fromUserId: theirs, toUserId: to, amount: 5 }, AT_GUEST);
      expect(a.ok, a.ok === false ? a.error : "").toBe(true);
      expect(b.ok, b.ok === false ? b.error : "").toBe(true);
      // The two charges, read off the log the allowance is summed from.
      expect(await notedAmount(String(a.noteId))).toBe(5);
      expect(await notedAmount(String(b.noteId))).toBe(5);
      const mineBefore = await allowanceFor(fpool, mine, 1);
      const theirsBefore = await allowanceFor(fpool, theirs, 1);
      expect(mineBefore.spent).toBe(5);
      expect(theirsBefore.spent).toBe(5);

      // ONE member undoes ONE gift.
      const undone = await reverse(fpool, keys.gratitudeGiven(villageId(), String(a.noteId)), {
        from: memberAccount(to),
        to: RECOGNITION_FAUCET,
        tokenSlug: HEARTS,
        amount: 5 * ONE,
      });
      expect(undone.ok, undone.ok === false ? undone.error : "").toBe(true);
      // The mirror exists and it names the gift, which is the only thread back
      // to the giver: it debits the RECIPIENT and credits the faucet, so
      // neither account on it is the member whose allowance comes back.
      const mirror = await mirrorOf(keys.gratitudeGiven(villageId(), String(a.noteId)));
      expect(mirror).not.toBeNull();
      expect(String(mirror.from_account)).toBe(memberAccount(to));
      expect(Number(mirror.amount)).toBe(5 * ONE);

      const mineAfter = await allowanceFor(fpool, mine, 1);
      const theirsAfter = await allowanceFor(fpool, theirs, 1);
      // The reverser gets exactly their 5 back.
      expect(mineAfter.spent).toBe(0);
      expect(mineAfter.remaining).toBe(mineAfter.total);
      // And the other giver is unchanged TO THE UNIT. This is the assertion the
      // old code failed by exactly 5, at both scales.
      expect(theirsAfter.spent).toBe(5);
      expect(theirsAfter.remaining).toBe(theirsBefore.remaining);
      // Their note is still on the log, so the 5 they still owe the cycle is a
      // real charge and not an empty window.
      expect(await noteCount(theirs)).toBe(1);
    });

    it("leaves a member who gave nothing where they were", async () => {
      const bystander = await member(`f-iso-none-${tag}`);
      const giver = await member(`f-iso-giver-${tag}`);
      const to = await member(`f-iso-recip-${tag}`);

      const before = await allowanceFor(fpool, bystander, 1);
      expect(before.spent).toBe(0);
      // AN EMPTY WINDOW, said as a row count and not as a zero. A member who
      // gave nothing and a member whose gifts were all reversed both read a
      // spend of zero, and they are different facts.
      expect(await noteCount(bystander)).toBe(0);

      const gift = await give(fpool, { fromUserId: giver, toUserId: to, amount: 6 }, AT_GUEST);
      expect(gift.ok, gift.ok === false ? gift.error : "").toBe(true);
      const undone = await reverse(fpool, keys.gratitudeGiven(villageId(), String(gift.noteId)), {
        from: memberAccount(to),
        to: RECOGNITION_FAUCET,
        tokenSlug: HEARTS,
        amount: 6 * ONE,
      });
      expect(undone.ok, undone.ok === false ? undone.error : "").toBe(true);

      const after = await allowanceFor(fpool, bystander, 1);
      expect(after.spent).toBe(0);
      expect(after.remaining).toBe(before.total);
      expect(await noteCount(bystander)).toBe(0);
      // The other member IS refunded, so the reversal really happened and this
      // case is measuring isolation and not a reversal that did nothing.
      const giverAfter = await allowanceFor(fpool, giver, 1);
      expect(giverAfter.spent).toBe(0);
      expect(await noteCount(giver)).toBe(1);

      /*
       * THE TWO LINES ABOVE ARE GREEN ON THE BROKEN ENGINE, AND THAT IS THE
       * POINT OF THE TWO BELOW. `spent` is floored at zero, so a bystander
       * holding a leaked credit and a bystander holding nothing print the same
       * number: the old code computed max(0, 0 - 6) and read 0, the same 0 this
       * case wanted. The leak only becomes visible once they have something for
       * it to be subtracted from, so they give 2 and it has to cost 2.
       */
      const own = await give(fpool, { fromUserId: bystander, toUserId: to, amount: 2 }, AT_GUEST);
      expect(own.ok, own.ok === false ? own.error : "").toBe(true);
      expect(await notedAmount(String(own.noteId))).toBe(2);
      const spending = await allowanceFor(fpool, bystander, 1);
      expect(spending.spent).toBe(2);
      expect(spending.remaining).toBe(before.total - 2);
    });

    it("refunds a gift once however many times it is reversed", async () => {
      const from = await member(`f-idem-from-${tag}`);
      const to = await member(`f-idem-to-${tag}`);

      const kept = await give(fpool, { fromUserId: from, toUserId: to, amount: 4 }, AT_GUEST);
      const gone = await give(fpool, { fromUserId: from, toUserId: to, amount: 7 }, AT_GUEST);
      expect(kept.ok).toBe(true);
      expect(gone.ok).toBe(true);
      expect((await allowanceFor(fpool, from, 1)).spent).toBe(11);

      const key = keys.gratitudeGiven(villageId(), String(gone.noteId));
      const claim = { from: memberAccount(to), to: RECOGNITION_FAUCET, tokenSlug: HEARTS, amount: 7 * ONE };
      const first = await reverse(fpool, key, claim);
      expect(first.ok, first.ok === false ? first.error : "").toBe(true);
      const second = await reverse(fpool, key, claim);
      expect(second.ok, second.ok === false ? second.error : "").toBe(true);
      expect(second.ok && second.duplicate).toBe(true);

      // ONE mirror row on the ledger, which is what makes the second call a
      // duplicate and not a second refund.
      expect(await mirrorCount(key)).toBe(1);
      const after = await allowanceFor(fpool, from, 1);
      expect(after.spent).toBe(4);
      expect(after.remaining).toBe(after.total - 4);
      // The recipient keeps the gift that stands, in minor units.
      expect(await balanceOf(fpool, memberAccount(to), HEARTS)).toBe(4 * ONE);
    });

    /*
     * THE SHARE CAP, WHICH IS THE OTHER FIGURE A REVERSAL HAS TO UNWIND.
     *
     * `gratitude.max_share_per_recipient` is weighed against what this giver
     * has put on THIS recipient, and that sum was never village-wide, so D30
     * did not reach it: it was already keyed on `from_id` AND `to_id`. What it
     * did not do was subtract reversals at all, so a member got their allowance
     * back and could not spend it on the person it came back from. This pins
     * both halves: the headroom returns for the giver, and it returns for
     * nobody else.
     */
    it("returns the giver's headroom on that recipient and nobody else's", async () => {
      const mine = await member(`f-cap-iso-mine-${tag}`);
      const theirs = await member(`f-cap-iso-theirs-${tag}`);
      const to = await member(`f-cap-iso-to-${tag}`);
      const cap = shareCapFor((await allowanceFor(fpool, mine, 1)).total);
      expect(cap).toBeGreaterThan(1);

      // Both members fill their share on the SAME recipient.
      const a = await give(fpool, { fromUserId: mine, toUserId: to, amount: cap }, AT_GUEST);
      const b = await give(fpool, { fromUserId: theirs, toUserId: to, amount: cap }, AT_GUEST);
      expect(a.ok, a.ok === false ? a.error : "").toBe(true);
      expect(b.ok, b.ok === false ? b.error : "").toBe(true);
      const full = await give(fpool, { fromUserId: mine, toUserId: to, amount: 1 }, AT_GUEST);
      expect(full.ok).toBe(false);
      expect(full.ok === false && full.error).toContain(`${cap} is the most`);

      const undone = await reverse(fpool, keys.gratitudeGiven(villageId(), String(a.noteId)), {
        from: memberAccount(to),
        to: RECOGNITION_FAUCET,
        tokenSlug: HEARTS,
        amount: cap * ONE,
      });
      expect(undone.ok, undone.ok === false ? undone.error : "").toBe(true);

      // The reverser can put the whole share on that person again.
      const again = await give(fpool, { fromUserId: mine, toUserId: to, amount: cap }, AT_GUEST);
      expect(again.ok, again.ok === false ? again.error : "").toBe(true);
      // And the other member's headroom on the same recipient did not move.
      const other = await give(fpool, { fromUserId: theirs, toUserId: to, amount: 1 }, AT_GUEST);
      expect(other.ok).toBe(false);
      expect(other.ok === false && other.error).toContain(`you have given them ${cap}`);
      // Read off the log: three notes stand for this pair and one is reversed.
      expect(await noteCount(mine)).toBe(2);
      expect((await allowanceFor(fpool, mine, 1)).spent).toBe(cap);
      expect((await allowanceFor(fpool, theirs, 1)).spent).toBe(cap);
    });
  });
}

// The order matters only in that each call takes its own schema. Zero first,
// because a suite that is red at zero has broken the village that exists today.
gratitudeAtScale(0);
gratitudeAtScale(4);
