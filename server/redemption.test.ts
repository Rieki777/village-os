/**
 * Tests for turning tokens into something real.
 *
 * The cases that matter are not "does a redemption work". They are the ones
 * where the village has already paid and the tokens are gone, where two people
 * press at the same instant, and where somebody spends what is spoken for.
 * Every one of them re-proves CONSERVATION afterwards, which is the invariant
 * the whole ledger rests on and the one a bad release breaks.
 *
 * ── THE DEBIT PATHS, ENUMERATED AND THEN FILTERED ──────────────────────────
 *
 * The lock is only worth what the spend paths cannot do, so the paths were
 * enumerated by CLOSURE and not by keyword. Exactly two statements in the whole
 * repository write `token_ledger` (`server/lib/ledger.ts:1009` inside
 * `postTransferOn` and `:1313` inside `postTransferPairOnce`), seven public
 * doors reach them, and every non-test call site of all seven was read. That is
 * SIXTEEN call sites across FOURTEEN distinct paths where a member account is
 * the `from` side:
 *
 *    1  member to member send            server/index.ts POST /api/wallet/send
 *    2  seat at a gathering              chargeForPlace, server/lib/eventSeats.ts
 *    3  library loan deposit             reserveItem, server/lib/library.ts
 *    4  a night of a stay                postNightsForStay, server/lib/stays.ts
 *    5  exchange swap, pay leg           executeSwap, server/lib/exchange.ts
 *    6  voice claim debit                requestVoiceClaim, server/lib/voiceClaim.ts
 *    7  voice waning                     decayVoice, server/lib/economy.ts
 *    8  exit sweep, remainder            sweepBalances, server/lib/exit.ts
 *    9  exit sweep, voice conversion     sweepBalances, server/lib/exit.ts
 *   10  admin stay adjustment, negative  server/routes/stays.ts
 *   11  admin library adjustment, neg.   server/index.ts
 *   12  stay purchase refund             server/routes/stays.ts
 *   13  the three Stripe reversal legs   server/index.ts
 *   14  the clawback mirror              reverse / reversePair
 *
 * SIX OF THE FOURTEEN CANNOT REACH A LOCKED TOKEN AT ALL, and that is a fact
 * about the token firewall and not about the lock. Paths 3 and 11 handle the
 * library credit and 6, 7, 9 the village voice, and neither is redeemable.
 *
 * THAT COUNT WAS NINE UNTIL 2026-09-04 and the ruling that moved it is worth
 * naming, because the number is the whole argument. Rye ruled that a stay
 * credit may be redeemed, so `REDEEMABLE_VOUCHERS` admits it and paths 4, 10
 * and 12 (and 13, which debits whatever a Stripe stay purchase credited) can
 * now meet a locked token. Nothing new guards them and nothing needs to: the
 * hold moved the tokens out of the member's account, which is the property
 * this whole module was built on and the reason it is an account and not a
 * reservation column. `server/stayRedeem.test.ts` drives path 4 against a real
 * hold and reads the outcome out of the ledger.
 *
 * FIVE CAN, and this file drives four of them for real plus the chokepoint
 * every one of the sixteen ends at:
 *
 *   - the ledger's own overdraft test, which is the single place all sixteen
 *     arrive, driven directly
 *   - the member-to-member send, driven with the route's own arguments
 *   - the seat fee, driven through `chargeForPlace` itself
 *   - the exit sweep, driven through `sweepBalances` itself
 *   - the clawback, driven through `reverse`, which is the one that is SUPPOSED
 *     to succeed and which must not touch the hold
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied, unique per provision. No TEST_DATABASE_URL and the suite skips
 * loudly rather than passing hollowly.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import {
  CREDITS,
  cycleWindow,
  fromLedgerUnits,
  keys,
  mint,
  reverse,
  toLedgerUnits,
  villageId,
} from "./lib/economy";
import {
  CYCLE_POOL_FAUCET,
  balanceOf,
  balancesFor,
  checkLedgerInvariants,
  loadTokenRegistry,
  memberAccount,
  postTransfer,
  registerToken,
} from "./lib/ledger";
import { loadVariables, setVariable } from "./lib/variables";
import { chargeForPlace } from "./lib/eventSeats";
import { createExit, exitSplitPolicy, sweepBalances } from "./lib/exit";
import {
  REDEEMED,
  REDEMPTION_HOLD,
  canSettleRedemption,
  confirmRefusal,
  redeemableToken,
  redemptionRefusal,
  redemptionReleases,
  type RedeemAsk,
} from "./lib/redemption";
import {
  expireRedemptions,
  heldForRedemption,
  holdReconciliation,
  redemptionById,
  requestRedemption,
  retiredSupply,
  retryRelease,
  settleRedemption,
} from "./lib/redemptionStore";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let seq = 0;

/**
 * The ceiling for a case that opens several redemptions.
 *
 * Raised, never lowered: a local override BELOW vitest.config.ts's global
 * silently undercuts headroom the config deliberately provides.
 */
const DB_HEAVY = 420_000;

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

/**
 * Put credits in somebody's hands the honest way, through the faucet.
 *
 * Throwing with the engine's own error rather than asserting is deliberate: an
 * asserting helper turns one missing faucet into a dozen identical
 * "expected false to be true".
 */
async function giveCredits(userId: string, human: number): Promise<void> {
  const res = await mint(pool, {
    toUserId: userId,
    tokenSlug: CREDITS,
    amount: toLedgerUnits(CREDITS, human),
    from: CYCLE_POOL_FAUCET,
    source: "test",
    idempotencyKey: `test-credits:${userId}:${++seq}`,
    description: "seed",
  });
  if (!res.ok) throw new Error(`could not seed credits: ${res.error}`);
}

/**
 * A token's balances, summed across every account. Must be zero.
 *
 * NOT a sum of `token_ledger.amount`: that column is positive-only with
 * `from_account`/`to_account` beside it, so summing it counts every posting
 * once and is never zero. Conservation lives in the BALANCES, where the
 * faucet's negative is the issued supply.
 */
async function conservation(tokenSlug: string): Promise<number> {
  const [rows] = await pool.query<any[]>(
    "SELECT COALESCE(SUM(`balance`),0) AS s FROM `token_balances` WHERE `token_type` = ?",
    [tokenSlug],
  );
  return Number(rows[0]?.s ?? 0);
}

/** Does the cached balance still match what the postings actually say? */
async function cacheDrift(tokenSlug: string): Promise<number> {
  const [rows] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM `token_balances` tb LEFT JOIN (" +
      "  SELECT account_id, token_type, SUM(delta) actual FROM (" +
      "    SELECT to_account account_id, token_type, amount delta FROM token_ledger" +
      "    UNION ALL SELECT from_account, token_type, -amount FROM token_ledger" +
      "  ) m GROUP BY account_id, token_type) x " +
      "ON x.account_id = tb.account_id AND x.token_type = tb.token_type " +
      "WHERE tb.token_type = ? AND tb.balance <> COALESCE(x.actual, 0)",
    [tokenSlug],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * The issued figure exactly as `publicSupply` and `GET /api/admin/tokens`
 * compute it: minus the faucet's balance.
 *
 * Written out here rather than imported, because the point of the case that
 * uses it is that TWO INDEPENDENT SURFACES agree, and importing one of them
 * would prove only that a function equals itself.
 */
async function issuedFromFaucet(tokenSlug: string): Promise<number> {
  const [rows] = await pool.query<any[]>(
    "SELECT COALESCE(-SUM(tb.`balance`),0) AS issued FROM `token_balances` tb " +
      "JOIN `ledger_accounts` a ON a.`id` = tb.`account_id` " +
      "WHERE a.`faucet` = 1 AND tb.`balance` < 0 AND tb.`token_type` = ?",
    [tokenSlug],
  );
  return Number(rows[0]?.issued ?? 0);
}

/** `mintView`'s reading: gross outflow from the faucets, which never falls. */
async function issuedFromRows(tokenSlug: string): Promise<number> {
  const [rows] = await pool.query<any[]>(
    "SELECT COALESCE(SUM(l.`amount`),0) AS out_ FROM `token_ledger` l " +
      "JOIN `ledger_accounts` a ON a.`id` = l.`from_account` " +
      "WHERE a.`faucet` = 1 AND l.`token_type` = ?",
    [tokenSlug],
  );
  return Number(rows[0]?.out_ ?? 0);
}

async function ask(userId: string, human: number, askedFor = "a bicycle") {
  return requestRedemption(pool, {
    userId,
    tokenSlug: CREDITS,
    amountUnits: toLedgerUnits(CREDITS, human),
    askedFor,
    exitOpen: false,
    cycleStart: cycleWindow().startsAt,
  });
}

const baseAsk = (over: Partial<RedeemAsk> = {}): RedeemAsk => ({
  slug: CREDITS,
  amountUnits: 100,
  balanceUnits: 500,
  heldUnits: 0,
  openedThisCycle: 0,
  perCycle: 2,
  askedFor: "a bicycle",
  confirmedBy: "steward",
  votePathBuilt: false,
  exitOpen: false,
  ...over,
});

// ── The half that needs no database ────────────────────────────────────────

describe("the redemption state machine", () => {
  it("lets a waiting redemption reach each of its four endings", () => {
    for (const to of ["confirmed", "refused", "withdrawn", "expired"] as const) {
      expect(canSettleRedemption("requested", to), to).toEqual({ ok: true });
    }
  });

  it("refuses to move a confirmed redemption, and says why in the sentence that costs value", () => {
    const v = canSettleRedemption("confirmed", "refused");
    expect(v.ok).toBe(false);
    expect(v.error).toBe("this redemption is confirmed and the tokens are gone");
  });

  it("refuses every other terminal state, and refuses going back to waiting", () => {
    expect(canSettleRedemption("refused", "confirmed").ok).toBe(false);
    expect(canSettleRedemption("withdrawn", "confirmed").ok).toBe(false);
    expect(canSettleRedemption("expired", "confirmed").ok).toBe(false);
    expect(canSettleRedemption("requested", "requested").ok).toBe(false);
  });

  it("gives the tokens back on three endings and destroys them on one", () => {
    expect(redemptionReleases("refused")).toBe(true);
    expect(redemptionReleases("withdrawn")).toBe(true);
    expect(redemptionReleases("expired")).toBe(true);
    expect(redemptionReleases("confirmed")).toBe(false);
  });
});

describe("who confirms", () => {
  it("refuses a member confirming their own redemption, at any amount", () => {
    expect(
      confirmRefusal({
        memberUserId: "wren",
        actorUserId: "wren",
        tokenStillReal: true,
        memberStillHere: true,
        tokenName: "Village Credits",
        note: "paid in cash",
      }),
    ).toBe("This is your own redemption. Someone else confirms it");
  });

  it("re-runs the token guard at the confirm door, and names the token", () => {
    expect(
      confirmRefusal({
        memberUserId: "wren",
        actorUserId: "ash",
        tokenStillReal: false,
        memberStillHere: true,
        tokenName: "Village Credits",
        note: "paid",
      }),
    ).toBe("Village Credits has been retired from the registry since this was asked for");
  });

  it("requires a reason, because a decision with none is not a record", () => {
    expect(
      confirmRefusal({
        memberUserId: "wren",
        actorUserId: "ash",
        tokenStillReal: true,
        memberStillHere: true,
        tokenName: "Village Credits",
        note: "   ",
      }),
    ).toBe("Say why, in a sentence. A decision with no stated reason is not a record");
  });
});

// ── Everything else ────────────────────────────────────────────────────────

describe.skipIf(!configured)("turning tokens into something real", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 10 });
    await loadTokenRegistry(pool);
    await loadVariables(pool);
    // The stays and library modules register these at boot and a scratch
    // schema has no boot, so the voucher branches below would otherwise be
    // tested against an UNREGISTERED slug and pass for the wrong reason.
    // Registered here exactly as server/lib/stays.ts and server/lib/library.ts
    // register them.
    await registerToken(pool, {
      slug: "stay-credit",
      name: "Stay Credit",
      kind: "credit",
      governance: "platform",
      transferable: false,
      isExample: false,
    });
    // The voucher that is still refused. Rye's 2026-09-04 ruling admitted the
    // stay credit to redemption and said nothing about this one, so this is
    // now the slug that carries the voucher refusal.
    await registerToken(pool, {
      slug: "library-credit",
      name: "Library Credits",
      kind: "credit",
      governance: "platform",
      transferable: false,
      isExample: false,
    });
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  /*
   * EVERY CASE STARTS FROM AN EMPTY LEDGER.
   *
   * The hold and the sink are village-wide accounts, so without this the second
   * case reads the first one's balance and every absolute assertion becomes a
   * running total. Deleting the postings and the cache together keeps them
   * consistent: `token_balances` is recomputed per posting, never rebuilt, so
   * clearing one and not the other is a cache drift this file's own helper
   * would then report.
   */
  beforeEach(async () => {
    await pool.query("DELETE FROM `redemptions`");
    await pool.query("DELETE FROM `token_ledger`");
    await pool.query("DELETE FROM `token_balances`");
    await pool.query("DELETE FROM `event_seat_charges`");
    await pool.query("DELETE FROM `events`");
    await pool.query("DELETE FROM `exits`");
    await setVariable(pool, "redemption.confirmed_by", "steward");
    await setVariable(pool, "redemption.holds_on_propose", "true");
    await setVariable(pool, "redemption.per_member_per_cycle", "2");
    await setVariable(pool, "redemption.expires_after_days", "30");
    await setVariable(pool, "redemption.tokens", "");
  });

  // ── Which tokens ─────────────────────────────────────────────────────────

  it("refuses a token nobody registered, by its slug", () => {
    expect(redemptionRefusal(baseAsk({ slug: "not-a-token" }))).toBe(
      '"not-a-token" is not a token this village issues',
    );
  });

  it("refuses a token governed on Base, and says where it is settled", () => {
    const said = redemptionRefusal(baseAsk({ slug: "equity" }));
    expect(said).toContain("lives on Base and is only read here");
  });

  it("refuses recognition, and says there is nothing in it to redeem", () => {
    const said = redemptionRefusal(baseAsk({ slug: "gratitude" }));
    expect(said).toContain("recognition is a record of what happened");
    expect(said).toContain("There is nothing in it to redeem");
  });

  it("refuses a module voucher, and says what it is worth instead", () => {
    // `library-credit` and NOT `stay-credit`. Rye ruled on 2026-09-04 that a
    // stay credit may be redeemed, so `REDEEMABLE_VOUCHERS` carries it past
    // this branch and `server/stayRedeem.test.ts` drives the whole path. The
    // library credit is a deposit against a shelf, no ruling exists on
    // destroying one, and it still meets this sentence.
    const said = redemptionRefusal(baseAsk({ slug: "library-credit" }));
    expect(said).toContain("buys one thing from the village");
  });

  it("refuses a token the village narrowed away, and says who can change it", async () => {
    await setVariable(pool, "redemption.tokens", "some-other-token");
    expect(redeemableToken(CREDITS)).toBe(false);
    const said = redemptionRefusal(baseAsk());
    expect(said).toContain("is not one of the tokens this village redeems");
    expect(said).toContain("A steward can change that in the village's dials");
    await setVariable(pool, "redemption.tokens", "");
  });

  it("cannot be widened past the firewall by the dial, for equity or for voice", async () => {
    await setVariable(pool, "redemption.tokens", "equity,voice,village-voice,gratitude,credits");
    expect(redeemableToken("equity")).toBe(false);
    expect(redeemableToken("voice")).toBe(false);
    expect(redeemableToken("gratitude")).toBe(false);
    expect(redeemableToken(CREDITS)).toBe(true);
    await setVariable(pool, "redemption.tokens", "");
  });

  // ── Asking ───────────────────────────────────────────────────────────────

  it("refuses more than the member holds, and says what there is", async () => {
    const wren = await makeMember("rd-short");
    await giveCredits(wren, 40);
    const out = await ask(wren, 100);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("You hold 40 Village Credits");
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) n FROM `redemptions`");
    expect(Number(rows[0].n)).toBe(0);
  });

  it("refuses when the village has chosen a village vote, before anything is held", async () => {
    const wren = await makeMember("rd-vote");
    await giveCredits(wren, 500);
    await setVariable(pool, "redemption.confirmed_by", "vote");
    const before = await balanceOf(pool, memberAccount(wren), CREDITS);
    const out = await ask(wren, 100);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("redemptions go to a village vote");
    expect(await balanceOf(pool, memberAccount(wren), CREDITS)).toBe(before);
  });

  it("holds the tokens, and the member's account really falls", async () => {
    const wren = await makeMember("rd-hold");
    await giveCredits(wren, 500);
    const out = await ask(wren, 500);
    expect(out.ok).toBe(true);
    expect(await balanceOf(pool, memberAccount(wren), CREDITS)).toBe(0);
    expect(await balanceOf(pool, REDEMPTION_HOLD, CREDITS)).toBe(toLedgerUnits(CREDITS, 500));
    expect(await conservation(CREDITS)).toBe(0);
    expect(await cacheDrift(CREDITS)).toBe(0);
  });

  it("counts a member's open redemptions against the per-cycle number", async () => {
    const wren = await makeMember("rd-cap");
    await giveCredits(wren, 500);
    await setVariable(pool, "redemption.per_member_per_cycle", "1");
    expect((await ask(wren, 10)).ok).toBe(true);
    const second = await ask(wren, 10);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("which is what this village allows");
  });

  // ── The lock, against the paths that can reach it ────────────────────────

  it("refuses the ledger's own overdraft test, which is where all sixteen call sites arrive", async () => {
    const wren = await makeMember("rd-ledger");
    const ash = await makeMember("rd-ledger-2");
    await giveCredits(wren, 500);
    expect((await ask(wren, 500)).ok).toBe(true);
    const res = await postTransfer(pool, {
      from: memberAccount(wren),
      to: memberAccount(ash),
      tokenType: CREDITS,
      amount: toLedgerUnits(CREDITS, 500),
      source: "test_any_debit",
      idempotencyKey: `rd-any:${++seq}`,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("insufficient");
    expect(res.error).toContain("cannot overdraft");
  });

  it("refuses the member-to-member send, driven with the route's own arguments", async () => {
    const wren = await makeMember("rd-send");
    const ash = await makeMember("rd-send-2");
    await giveCredits(wren, 500);
    expect((await ask(wren, 500)).ok).toBe(true);
    // POST /api/wallet/send, server/index.ts: source `member_send`, key
    // `send:<userId>:<nonce>`, member to member, no guard.
    const res = await postTransfer(pool, {
      from: memberAccount(wren),
      to: memberAccount(ash),
      tokenType: CREDITS,
      amount: toLedgerUnits(CREDITS, 500),
      source: "member_send",
      idempotencyKey: `send:${wren}:${++seq}`,
      description: "for Ash",
    });
    expect(res.ok).toBe(false);
    expect(await balanceOf(pool, memberAccount(ash), CREDITS)).toBe(0);
    expect(await balanceOf(pool, REDEMPTION_HOLD, CREDITS)).toBe(toLedgerUnits(CREDITS, 500));
  });

  it("refuses a seat fee through chargeForPlace itself, in the member's own words", async () => {
    const wren = await makeMember("rd-seat");
    await giveCredits(wren, 500);
    await pool.query(
      "INSERT INTO `events` (`id`, `title`, `starts_at`, `status`, `seat_price`, `seat_token`) " +
        "VALUES ('rd-evt','A work party', NOW(), 'scheduled', ?, ?)",
      [500, CREDITS],
    );
    expect((await ask(wren, 500)).ok).toBe(true);
    const charged = await chargeForPlace(pool, "rd-evt", wren, "once", "A work party");
    expect(charged.ok).toBe(false);
    if (!charged.ok) expect(charged.error).toContain("your balance does not cover it");
    expect(await conservation(CREDITS)).toBe(0);
  });

  it("leaves held tokens out of the exit sweep, driven through sweepBalances itself", async () => {
    const wren = await makeMember("rd-exit");
    await giveCredits(wren, 500);
    expect((await ask(wren, 300)).ok).toBe(true);
    const opened = await createExit(pool, {
      userId: wren,
      kind: "voluntary",
      openedBy: "rd-exit",
      noticeDays: 0,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const swept = await sweepBalances(pool, {
      exitId: opened.exit.id,
      userId: wren,
      policy: { ...exitSplitPolicy(), coolingDays: 0, keepPct: { credit: 0, voice: 0, recognition: 0, equity: 0 } },
    });
    expect(swept.refusal).toBeNull();
    // 200 was free and went; the 300 held against the redemption never appears
    // in `balancesFor(mem:...)`, which is the only thing the sweep walks.
    expect(swept.swept[CREDITS] ?? 0).toBe(200);
    expect(await balanceOf(pool, REDEMPTION_HOLD, CREDITS)).toBe(toLedgerUnits(CREDITS, 300));
    expect(await conservation(CREDITS)).toBe(0);
  });

  it("lets a clawback drive the member negative and still does not touch the hold", async () => {
    const wren = await makeMember("rd-claw");
    await giveCredits(wren, 500);
    const paid = await postTransfer(pool, {
      from: CYCLE_POOL_FAUCET,
      to: memberAccount(wren),
      tokenType: CREDITS,
      amount: toLedgerUnits(CREDITS, 100),
      source: "test_paid",
      idempotencyKey: `rd-paid:${++seq}`,
    });
    expect(paid.ok).toBe(true);
    expect((await ask(wren, 600)).ok).toBe(true);
    expect(await balanceOf(pool, memberAccount(wren), CREDITS)).toBe(0);
    // The clawback is one of the five allow-negative paths, so it SUCCEEDS and
    // takes the member below zero. What it must not do is find the held tokens.
    const back = await reverse(pool, `rd-paid:${seq}`, {});
    expect(back.ok).toBe(true);
    expect(await balanceOf(pool, memberAccount(wren), CREDITS)).toBe(toLedgerUnits(CREDITS, -100));
    expect(await balanceOf(pool, REDEMPTION_HOLD, CREDITS)).toBe(toLedgerUnits(CREDITS, 600));
    expect(await conservation(CREDITS)).toBe(0);
  });

  // ── Ending one ───────────────────────────────────────────────────────────

  it(
    "destroys exactly what was held when a steward confirms, and no more",
    async () => {
      const wren = await makeMember("rd-burn");
      await giveCredits(wren, 500);
      const out = await ask(wren, 300);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const done = await settleRedemption(pool, {
        id: out.row.id,
        to: "confirmed",
        actorUserId: "rd-steward",
        note: "handed over on Tuesday",
      });
      expect(done.ok).toBe(true);
      expect(await balanceOf(pool, REDEMPTION_HOLD, CREDITS)).toBe(0);
      expect(await balanceOf(pool, REDEEMED, CREDITS)).toBe(toLedgerUnits(CREDITS, 300));
      expect(await balanceOf(pool, memberAccount(wren), CREDITS)).toBe(toLedgerUnits(CREDITS, 200));
      expect(await conservation(CREDITS)).toBe(0);
      expect(await cacheDrift(CREDITS)).toBe(0);
    },
    DB_HEAVY,
  );

  it("gives the whole amount back on a refusal", async () => {
    const wren = await makeMember("rd-refuse");
    await giveCredits(wren, 500);
    const out = await ask(wren, 500);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const done = await settleRedemption(pool, {
      id: out.row.id,
      to: "refused",
      actorUserId: "rd-steward",
      note: "the village cannot pay this one",
    });
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.released).toBe(true);
    expect(await balanceOf(pool, memberAccount(wren), CREDITS)).toBe(toLedgerUnits(CREDITS, 500));
    expect(await balanceOf(pool, REDEMPTION_HOLD, CREDITS)).toBe(0);
    expect(await balanceOf(pool, REDEEMED, CREDITS)).toBe(0);
    expect(await conservation(CREDITS)).toBe(0);
  });

  it("gives the whole amount back on an expiry, through the same door a human uses", async () => {
    const wren = await makeMember("rd-expire");
    await giveCredits(wren, 500);
    await setVariable(pool, "redemption.expires_after_days", "1");
    const out = await ask(wren, 250);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(await expireRedemptions(pool, new Date(Date.now() - 1000))).toBe(0);
    const closed = await expireRedemptions(pool, new Date(Date.now() + 2 * 24 * 3600 * 1000));
    expect(closed).toBe(1);
    const after = await redemptionById(pool, out.row.id);
    expect(after?.state).toBe("expired");
    expect(await balanceOf(pool, memberAccount(wren), CREDITS)).toBe(toLedgerUnits(CREDITS, 500));
    expect(await balanceOf(pool, REDEMPTION_HOLD, CREDITS)).toBe(0);
    expect(await conservation(CREDITS)).toBe(0);
  });

  it("never expires a redemption in a village that lets them wait forever", async () => {
    const wren = await makeMember("rd-forever");
    await giveCredits(wren, 500);
    await setVariable(pool, "redemption.expires_after_days", "0");
    const out = await ask(wren, 100);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row.expiresAt).toBeNull();
    expect(await expireRedemptions(pool, new Date(Date.now() + 3650 * 24 * 3600 * 1000))).toBe(0);
  });

  it("destroys once when the same confirmation is pressed twice", async () => {
    const wren = await makeMember("rd-twice");
    await giveCredits(wren, 500);
    const out = await ask(wren, 400);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const first = await settleRedemption(pool, {
      id: out.row.id,
      to: "confirmed",
      actorUserId: "rd-steward",
      note: "paid",
    });
    expect(first.ok).toBe(true);
    const second = await settleRedemption(pool, {
      id: out.row.id,
      to: "confirmed",
      actorUserId: "rd-steward",
      note: "paid again",
    });
    expect(second.ok).toBe(false);
    expect(await balanceOf(pool, REDEEMED, CREDITS)).toBe(toLedgerUnits(CREDITS, 400));
    const [rows] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM `token_ledger` WHERE `idempotency_key` = ?",
      [keys.redemptionBurn(villageId(), out.row.id)],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it(
    "destroys once when two confirmations arrive at the same instant",
    async () => {
      const wren = await makeMember("rd-race");
      await giveCredits(wren, 500);
      const out = await ask(wren, 500);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const both = await Promise.all([
        settleRedemption(pool, { id: out.row.id, to: "confirmed", actorUserId: "a", note: "paid" }),
        settleRedemption(pool, { id: out.row.id, to: "confirmed", actorUserId: "b", note: "paid" }),
      ]);
      expect(both.filter((r) => r.ok)).toHaveLength(1);
      expect(await balanceOf(pool, REDEEMED, CREDITS)).toBe(toLedgerUnits(CREDITS, 500));
      expect(await conservation(CREDITS)).toBe(0);
    },
    DB_HEAVY,
  );

  it(
    "gives the tokens back once when a refusal and a withdrawal arrive together",
    async () => {
      const wren = await makeMember("rd-race2");
      await giveCredits(wren, 500);
      const out = await ask(wren, 500);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const both = await Promise.all([
        settleRedemption(pool, { id: out.row.id, to: "refused", actorUserId: "a", note: "no" }),
        settleRedemption(pool, { id: out.row.id, to: "withdrawn", actorUserId: wren, note: "" }),
      ]);
      expect(both.filter((r) => r.ok)).toHaveLength(1);
      expect(await balanceOf(pool, memberAccount(wren), CREDITS)).toBe(toLedgerUnits(CREDITS, 500));
      expect(await conservation(CREDITS)).toBe(0);
    },
    DB_HEAVY,
  );

  it("cannot confirm a redemption that was already given back", async () => {
    const wren = await makeMember("rd-after");
    await giveCredits(wren, 500);
    const out = await ask(wren, 200);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect((await settleRedemption(pool, { id: out.row.id, to: "refused", actorUserId: "a", note: "no" })).ok).toBe(true);
    const late = await settleRedemption(pool, { id: out.row.id, to: "confirmed", actorUserId: "b", note: "paid" });
    expect(late.ok).toBe(false);
    expect(await balanceOf(pool, REDEEMED, CREDITS)).toBe(0);
  });

  it("repairs a release with retryRelease and does not double it", async () => {
    const wren = await makeMember("rd-repair");
    await giveCredits(wren, 500);
    const out = await ask(wren, 150);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect((await settleRedemption(pool, { id: out.row.id, to: "refused", actorUserId: "a", note: "no" })).ok).toBe(true);
    const again = await retryRelease(pool, out.row.id);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.released).toBe(false);
    expect(await balanceOf(pool, memberAccount(wren), CREDITS)).toBe(toLedgerUnits(CREDITS, 500));
    expect(await conservation(CREDITS)).toBe(0);
  });

  it(
    "refuses to confirm a row whose hold never posted, so it cannot burn somebody else's",
    async () => {
      const wren = await makeMember("rd-phantom");
      const ash = await makeMember("rd-phantom-2");
      await giveCredits(ash, 500);
      // Ash's redemption is real and its 400 are genuinely in the hold account.
      const real = await ask(ash, 400);
      expect(real.ok).toBe(true);
      if (!real.ok) return;

      /*
       * Wren's is a PHANTOM: the row says 400 are held and no ledger posting
       * ever took them. This is the shape a process that died between
       * `requestRedemption`'s commit and its hold posting leaves behind, and it
       * is written directly because that crash cannot be staged.
       *
       * The danger is precise: `sys:redemption-hold` pools every open
       * redemption, so a burn against this row would take 400 out of it and
       * those 400 are ASH'S. Conservation would stay at zero and the boot
       * invariants would report nothing.
       */
      const phantomId = "rd-phantom-row";
      await pool.query(
        "INSERT INTO `redemptions` (`id`,`village_id`,`user_id`,`token_slug`,`amount`,`asked_for`," +
          "`state`,`confirmed_by_mode`,`held_account`,`hold_key`,`burn_key`) " +
          "VALUES (?,?,?,?,?,?,'requested','steward',?,?,?)",
        [
          phantomId,
          villageId(),
          wren,
          CREDITS,
          toLedgerUnits(CREDITS, 400),
          "a bicycle",
          REDEMPTION_HOLD,
          `redemption:${villageId()}:${phantomId}:hold`,
          `redemption:${villageId()}:${phantomId}:burn`,
        ],
      );

      const held = await balanceOf(pool, REDEMPTION_HOLD, CREDITS);
      const out = await settleRedemption(pool, {
        id: phantomId,
        to: "confirmed",
        actorUserId: "rd-steward",
        note: "paid",
      });
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.error).toContain("nothing was destroyed");
        expect(out.error).toContain("would destroy somebody else's");
      }
      // Nothing left the hold, nothing was retired, and the claim went back so
      // a repaired row can still be confirmed.
      expect(await balanceOf(pool, REDEMPTION_HOLD, CREDITS)).toBe(held);
      expect(await balanceOf(pool, REDEEMED, CREDITS)).toBe(0);
      expect((await redemptionById(pool, phantomId))?.state).toBe("requested");
      // And Ash's real redemption still settles, out of tokens that are theirs.
      const good = await settleRedemption(pool, {
        id: real.row.id,
        to: "confirmed",
        actorUserId: "rd-steward",
        note: "paid",
      });
      expect(good.ok).toBe(true);
      expect(await balanceOf(pool, REDEEMED, CREDITS)).toBe(toLedgerUnits(CREDITS, 400));
      expect(await conservation(CREDITS)).toBe(0);
    },
    DB_HEAVY,
  );

  // ── What the village can read afterwards ─────────────────────────────────

  it("holds exactly what its open rows say it holds", async () => {
    const wren = await makeMember("rd-recon");
    const ash = await makeMember("rd-recon-2");
    await giveCredits(wren, 500);
    await giveCredits(ash, 500);
    expect((await ask(wren, 100)).ok).toBe(true);
    expect((await ask(ash, 250)).ok).toBe(true);
    const lines = await holdReconciliation(pool);
    const credits = lines.find((l) => l.token === CREDITS);
    expect(credits?.heldUnits).toBe(toLedgerUnits(CREDITS, 350));
    expect(credits?.owedUnits).toBe(toLedgerUnits(CREDITS, 350));
    expect(credits?.driftUnits).toBe(0);
    expect(credits?.openCount).toBe(2);
    expect((await heldForRedemption(pool, wren))[CREDITS]).toBe(toLedgerUnits(CREDITS, 100));
  });

  it(
    "leaves both balance-based supply surfaces and the row-based one agreeing after a redemption",
    async () => {
      const wren = await makeMember("rd-supply");
      await giveCredits(wren, 500);
      const issuedBefore = await issuedFromFaucet(CREDITS);
      const rowsBefore = await issuedFromRows(CREDITS);
      const out = await ask(wren, 500);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(
        (await settleRedemption(pool, { id: out.row.id, to: "confirmed", actorUserId: "a", note: "paid" })).ok,
      ).toBe(true);
      // ISSUED DOES NOT FALL, on either reading, because the burn touches no
      // faucet. That is the property that makes the sink safe to ship while the
      // mint-cap counter is being changed by another lane.
      expect(await issuedFromFaucet(CREDITS)).toBe(issuedBefore);
      expect(await issuedFromRows(CREDITS)).toBe(rowsBefore);
      // And the retired figure is the whole of what changed.
      expect((await retiredSupply(pool))[CREDITS]).toBe(toLedgerUnits(CREDITS, 500));
    },
    DB_HEAVY,
  );

  it("reports nothing from the boot invariants after a whole redemption", async () => {
    const wren = await makeMember("rd-inv");
    await giveCredits(wren, 500);
    const out = await ask(wren, 500);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect((await settleRedemption(pool, { id: out.row.id, to: "confirmed", actorUserId: "a", note: "paid" })).ok).toBe(true);
    const report = await checkLedgerInvariants(pool);
    expect(report.problems).toEqual([]);
  });

  // ── The founder's own case, end to end ───────────────────────────────────

  it(
    "confirms a redemption after the village has paid, and both figures come out of the database",
    async () => {
      const wren = await makeMember("rd-bicycle");
      await giveCredits(wren, 500);

      // Monday. Wren asks for 500 credits to become a bicycle.
      const out = await ask(wren, 500, "a bicycle");
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.row.askedFor).toBe("a bicycle");

      // Tuesday. A steward hands over the bicycle. Nothing happens here,
      // because that half is off the platform and this software never sees it.

      // Wednesday. Wren tries to send the same credits to Ash, which is the
      // exact sequence that makes his ordering unexecutable without the hold.
      // THIS ASSERTION IS THE WHOLE CASE, and it is placed before the one about
      // the hold account on purpose: with the hold turned off this line is what
      // goes red, and the red then reads as the double spend it is instead of
      // as a missing column.
      const ash = await makeMember("rd-bicycle-2");
      const sent = await postTransfer(pool, {
        from: memberAccount(wren),
        to: memberAccount(ash),
        tokenType: CREDITS,
        amount: toLedgerUnits(CREDITS, 500),
        source: "member_send",
        idempotencyKey: `send:${wren}:${++seq}`,
      });
      expect(sent.ok).toBe(false);
      expect(out.row.heldAccount).toBe(REDEMPTION_HOLD);

      // Thursday. The steward confirms, and only now is anything destroyed.
      const done = await settleRedemption(pool, {
        id: out.row.id,
        to: "confirmed",
        actorUserId: "rd-steward",
        note: "handed the bicycle over on Tuesday",
      });
      expect(done.ok).toBe(true);

      const [balanceRows] = await pool.query<any[]>(
        "SELECT `balance` FROM `token_balances` WHERE `account_id` = ? AND `token_type` = ?",
        [memberAccount(wren), CREDITS],
      );
      const [retiredRows] = await pool.query<any[]>(
        "SELECT `balance` FROM `token_balances` WHERE `account_id` = ? AND `token_type` = ?",
        [REDEEMED, CREDITS],
      );
      expect(fromLedgerUnits(CREDITS, Number(balanceRows[0]?.balance ?? 0))).toBe(0);
      expect(fromLedgerUnits(CREDITS, Number(retiredRows[0]?.balance ?? 0))).toBe(500);
      expect(await balanceOf(pool, memberAccount(ash), CREDITS)).toBe(0);
      expect(await conservation(CREDITS)).toBe(0);
      expect(await cacheDrift(CREDITS)).toBe(0);
      expect((await balancesFor(pool, memberAccount(wren)))[CREDITS] ?? 0).toBe(0);
    },
    DB_HEAVY,
  );

  // ── The village that turned the hold off ─────────────────────────────────

  it(
    "settles the way it was opened when the hold dial moves mid-flight",
    async () => {
      const wren = await makeMember("rd-dial");
      await giveCredits(wren, 500);
      const out = await ask(wren, 200);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.row.heldAccount).toBe(REDEMPTION_HOLD);
      // Somebody turns the hold off while this one is open.
      await setVariable(pool, "redemption.holds_on_propose", "false");
      const done = await settleRedemption(pool, {
        id: out.row.id,
        to: "confirmed",
        actorUserId: "a",
        note: "paid",
      });
      expect(done.ok).toBe(true);
      // Burnt out of the hold account, which is where the tokens actually are,
      // and the member keeps the 300 that was never held.
      expect(await balanceOf(pool, REDEMPTION_HOLD, CREDITS)).toBe(0);
      expect(await balanceOf(pool, memberAccount(wren), CREDITS)).toBe(toLedgerUnits(CREDITS, 300));
      expect(await conservation(CREDITS)).toBe(0);
    },
    DB_HEAVY,
  );

  it("takes nothing at all when the village has the hold turned off", async () => {
    const wren = await makeMember("rd-nohold");
    await giveCredits(wren, 500);
    await setVariable(pool, "redemption.holds_on_propose", "false");
    const out = await ask(wren, 200);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row.heldAccount).toBeNull();
    expect(out.row.holdKey).toBeNull();
    expect(await balanceOf(pool, memberAccount(wren), CREDITS)).toBe(toLedgerUnits(CREDITS, 500));
    const done = await settleRedemption(pool, {
      id: out.row.id,
      to: "confirmed",
      actorUserId: "a",
      note: "paid",
    });
    expect(done.ok).toBe(true);
    expect(await balanceOf(pool, memberAccount(wren), CREDITS)).toBe(toLedgerUnits(CREDITS, 300));
    expect(await balanceOf(pool, REDEEMED, CREDITS)).toBe(toLedgerUnits(CREDITS, 200));
    expect(await conservation(CREDITS)).toBe(0);
  });
});
