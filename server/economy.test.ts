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
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import {
  allowanceFor,
  canConfirm,
  canSettleClaim,
  checkGive,
  fullSendsIn,
  shareCapFor,
  clampToCeiling,
  claimRefunds,
  CREDITS,
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
  VILLAGE_VOICE,
  VOICE_MINT,
  villageId,
  writeGratitudeRow,
  type MintRule,
} from "./lib/economy";
import { balanceOf, checkLedgerInvariants, CYCLE_POOL_FAUCET, loadTokenRegistry, memberAccount, postTransfer, registerToken, RECOGNITION_FAUCET } from "./lib/ledger";
import { loadVariables } from "./lib/variables";
import { cycleBoundsFor } from "../shared/lunar";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";

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
    const weekOne = keys.questCompleted("local", "q-swale", "claim-1", "u1");
    const weekTwo = keys.questCompleted("local", "q-swale", "claim-2", "u1");
    const otherHand = keys.questCompleted("local", "q-swale", "claim-3", "u2");
    expect(weekOne).not.toBe(weekTwo);
    expect(weekOne).not.toBe(otherHand);
  });

  it("keeps the same key in two villages apart", () => {
    // Two villages running the same seeded quest must not collide on a UNIQUE
    // index, and without the scope segment they would.
    expect(keys.questCompleted("alder", "q1", "c1", "u1")).not.toBe(
      keys.questCompleted("birch", "q1", "c1", "u1"),
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
    const key = keys.questCompleted(villageId(), "q1", "c1", u);
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
    expect(clampToCeiling(40, rule({ ceiling: 100 }))).toBe(40);
    expect(clampToCeiling(4000, rule({ ceiling: 100 }))).toBe(100);
    // A fixed amount ignores what the source posted entirely.
    expect(clampToCeiling(4000, rule({ amount: 20, ceiling: 100 }))).toBe(20);
    // Fail closed: 0 means zero, never unlimited.
    expect(clampToCeiling(50, rule({ ceiling: 0 }))).toBe(0);
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
  it("caps one recipient at a fraction of the allowance, floored at 1", () => {
    const at = (total: number) => ({ total, spent: 0, remaining: total, cycleKey: "lunar-000001" });
    const send = (amount: number, total: number, already: number) =>
      checkGive({ fromUserId: "a", toUserId: "b", amount }, at(total), already);

    // The default is 7 full sends, so an allowance of 105 gives 15 to any one
    // person and the 16th unit to the same person is refused.
    expect(send(15, 105, 0).ok).toBe(true);
    expect(send(16, 105, 0).ok).toBe(false);
    // It is a RUNNING total for the pair, so a second small send is measured
    // against what the first one already used.
    expect(send(5, 105, 10).ok).toBe(true);
    expect(send(6, 105, 10).ok).toBe(false);
    // It rounds down: 50 across 7 is 7.14, and the ceiling is 7.
    expect(send(7, 50, 0).ok).toBe(true);
    expect(send(8, 50, 0).ok).toBe(false);
    // And it never rounds down to zero. 3 across 7 is 0.43, and a ceiling of 0
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

  it("holds the allowance against simultaneous gives, one more than it can hold", async () => {
    const from = await makeMember("econ-race-from");
    const before = await allowanceFor(pool, from, 1);
    // EXACTLY the per-recipient ceiling, read from the engine rather than
    // written down here. Any larger and that ceiling would refuse these gifts
    // before the lock ever saw them, and the test would prove nothing about
    // the lock. This used to be `total / 4`, which was the ceiling only while
    // the dial happened to be 25 percent, and it stopped being true the moment
    // the dial became a count of full sends.
    const each = shareCapFor(before.total);
    expect(each).toBeGreaterThan(0);

    // One more gift than the allowance can hold, whatever the dials say: the
    // allowance holds `fullSendsIn` of these by definition, so asking for one
    // more guarantees the overflow the lock has to refuse.
    const n = fullSendsIn(before.total) + 1;
    const recipients = await Promise.all(
      Array.from({ length: n }, (_, i) => makeMember(`econ-race-to-${i + 1}`)),
    );

    // All of them fired together, so the only thing that can refuse the last
    // one is the lock.
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
    const key = keys.questCompleted(villageId(), "q-rev", "c-rev", u);
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
    const wrong = keys.questCompleted(villageId(), "q-redo", "claim-a", u);
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
    const redo = keys.questCompleted(villageId(), "q-redo", "claim-b", u);
    const res = await mint(pool, {
      toUserId: u, tokenSlug: HEARTS, amount: 5,
      from: RECOGNITION_FAUCET, source: "quest_consent", idempotencyKey: redo,
    });
    expect(res.ok && res.duplicate).toBe(false);
    expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(5);
  });

  it("refuses a reversal for an amount the original posting never moved", async () => {
    // THE EXPLOIT THIS CLOSES. `reverse` took its amount, its token and both
    // its accounts from the caller and checked only that SOME row carried the
    // original key. An audit reversed a 25-credit posting into a 1,000,000
    // payment to the same member and every invariant stayed green, because a
    // mirror is two legs and conservation balances at any size.
    const u = await makeMember("econ-rev-amount");
    const key = keys.questCompleted(villageId(), "q-mint", "c-mint", u);
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
    const key = keys.questCompleted(villageId(), "q-shape", "c-shape", u);
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
    const key = keys.questCompleted(villageId(), "q-derived", "c-derived", u);
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
    const key = keys.questCompleted(villageId(), "q-spent", "c-spent", u);
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
      idempotencyKey: keys.questCompleted(villageId(), "q-v", "c-v", u),
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
      // Thousandths in the ledger, 0.1 on the chip. The ledger's amount is an
      // INT and postTransfer truncates, so a rule of 0.1 posted directly would
      // post nothing and leave a member unpaid with no error anywhere.
      expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(100);
      expect(fromLedgerUnits(VILLAGE_VOICE, 100)).toBeCloseTo(0.1);
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
      // The assertion that would have caught the original defect. Whole units:
      // `credits` carries decimals 0, so 25 in the rule is 25 in the ledger.
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(25);
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
});
