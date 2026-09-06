/**
 * A STAY CREDIT HAS TWO ENDINGS, AND THIS FILE IS ABOUT TELLING THEM APART.
 *
 * Rye, 2026-09-04: "Redeeming a stay token also destroys it, have this be the
 * same structure as redeeming currency tokens." So the same token now leaves a
 * member's hands two different ways and only one of them reduces what exists:
 *
 *   CONSUMED   a night. `spendSinkFor("stay-credit")` IS `sys:mint`, so the
 *              credit goes home to the faucet that issued it, the faucet's
 *              negative balance shrinks, and the village may issue it again.
 *              Nothing is destroyed. `readCycleIssuance` subtracts exactly
 *              this return from the cycle's issuance, which is the other
 *              surface that already depends on the fact.
 *   DESTROYED  a redemption. The burn lands on `sys:redeemed`, which is not a
 *              faucet and only ever receives. The faucet is untouched, so
 *              issued supply does not fall, and that credit can never buy a
 *              night for anybody again.
 *
 * A SURFACE THAT CONFLATED THESE WOULD BE WRONG IN THE DIRECTION THAT COSTS
 * ROOMS: it would say the village owes nights it does not owe, or it would say
 * a village had un-issued credits it has merely retired. So every case below
 * reads the outcome out of `token_balances` and `token_ledger` and never off a
 * return value, and the two endings are asserted to differ in BOTH halves of
 * the posting, the source and the destination, so a reader needs no convention.
 *
 * WHAT THE SETTING ALONE COULD NOT DO. `redemption.tokens` is documented as a
 * dial that "can only ever NARROW", and `redeemableToken` refuses every member
 * of `MODULE_VOUCHERS` BEFORE it ever reads the dial. Typing `stay-credit`
 * into it therefore changed nothing at all, which the first case here proves
 * by driving the dial. `REDEEMABLE_VOUCHERS` is the one hole the ruling opens
 * and the cases below hold the other three voucher questions shut.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL and it skips loudly.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import {
  MINT_FAUCET,
  balanceOf,
  checkLedgerInvariants,
  loadTokenRegistry,
  memberAccount,
  tokenDef,
} from "./lib/ledger";
import { cycleWindow, toLedgerUnits } from "./lib/economy";
import {
  REDEEMABLE_VOUCHERS,
  REDEEMED,
  REDEMPTION_HOLD,
  redeemableToken,
  redemptionRefusal,
  type RedeemAsk,
} from "./lib/redemption";
import { heldForRedemption, requestRedemption, retiredSupply, settleRedemption } from "./lib/redemptionStore";
import { MODULE_VOUCHERS, mayToggleTransferable, sendRefusal, spendSinkFor } from "./lib/spending";
import { ensureLibraryToken } from "./lib/library";
import { STAY_CREDIT, ensureStayToken, mintStayCredits, postNightsForStay, stayById } from "./lib/stays";
import { loadVariables, setVariable } from "./lib/variables";

const configured = testDbConfigured();
const LIBRARY_CREDIT = "library-credit";

/** A ceiling for a case that provisions and then posts several times. */
const DB_HEAVY = 420_000;

const baseAsk = (over: Partial<RedeemAsk> = {}): RedeemAsk => ({
  slug: STAY_CREDIT,
  amountUnits: 100,
  balanceUnits: 500,
  heldUnits: 0,
  openedThisCycle: 0,
  perCycle: 2,
  askedFor: "the caravan for a fortnight",
  confirmedBy: "steward",
  votePathBuilt: false,
  exitOpen: false,
  ...over,
});

describe.skipIf(!configured)("a stay credit redeemed, and a stay credit spent", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  const dateStr = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  /** Whole stay credits, in a person's unit, converted once at the boundary. */
  const units = (human: number) => toLedgerUnits(STAY_CREDIT, human);

  const member = async (id: string, human: number) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,'h')",
      [id, id, `${id}@examples.invalid`],
    );
    if (human > 0) {
      const r = await mintStayCredits(pool, {
        userId: id,
        amount: units(human),
        source: "stay_comp",
        idempotencyKey: `seed:${id}:${human}`,
        description: "seed",
      });
      expect(r.ok, r.error).toBe(true);
    }
    return id;
  };

  /** An ACTIVE stay in stay credits, snapshot at `rate`, arriving `days` ago. */
  const stay = async (id: string, userId: string, rateUnits: number, days: number) => {
    await pool.query("INSERT IGNORE INTO accommodations (id, name, capacity) VALUES ('acc-sr','Caravan',2)"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO stays (id, user_id, accommodation_id, status, arrive_on, autopay, rate_snapshot_credits, rate_snapshot_token, audience_snapshot) " +
        "VALUES (?,?, 'acc-sr', 'active', ?, 1, ?, ?, 'guest')",
      [id, userId, dateStr(-days), rateUnits, STAY_CREDIT],
    );
    return (await stayById(pool, id))!;
  };

  const ask = async (userId: string, human: number, askedFor = "a week in the caravan") =>
    requestRedemption(pool, {
      userId,
      tokenSlug: STAY_CREDIT,
      amountUnits: units(human),
      askedFor,
      exitOpen: false,
      cycleStart: cycleWindow().startsAt,
    });

  /**
   * Every posting of this token, as (source, from, to, amount).
   *
   * Read off `token_ledger` and not off any return value: the whole claim of
   * this file is that the two endings are legible to somebody reading the book
   * afterwards with no access to the code that wrote it.
   */
  const postings = async () => {
    const [rows] = await pool.query<any[]>(
      "SELECT `source`, `from_account`, `to_account`, `amount` FROM `token_ledger` " +
        "WHERE `token_type` = ? ORDER BY `id`",
      [STAY_CREDIT],
    );
    return rows.map((r) => ({
      source: String(r.source),
      from: String(r.from_account),
      to: String(r.to_account),
      amount: Number(r.amount),
    }));
  };

  const conserves = async () => {
    expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    await loadTokenRegistry(pool);
    // `stay-credit` is registered at BOOT by the stays module and not by a
    // migration, so a scratch schema has to do what boot does. Without this
    // every voucher case below would be testing an UNREGISTERED slug and would
    // pass for the wrong reason.
    await ensureStayToken(pool);
    // The OTHER voucher, and it has to be real for the same reason: the case
    // that proves the ruling did not widen to both vouchers would otherwise be
    // asserting against an unregistered slug and would read "not a token this
    // village issues", which is a refusal for an entirely different reason.
    await ensureLibraryToken(pool);
    await loadTokenRegistry(pool);
    await loadVariables(pool);
  }, DB_HEAVY);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM `redemptions`"); // module-review-ok: scratch-schema teardown between cases
    await pool.query("DELETE FROM `stays`"); // module-review-ok: scratch-schema teardown between cases
    await pool.query("DELETE FROM `token_ledger`"); // module-review-ok: scratch-schema teardown, not a ledger write: value only ever moves here through postTransfer
    await pool.query("DELETE FROM `token_balances`"); // module-review-ok: scratch-schema teardown, not a ledger write: value only ever moves here through postTransfer
    await pool.query("DELETE FROM `users`"); // module-review-ok: scratch-schema teardown between cases
    await pool.query("DELETE FROM `game_variables`"); // module-review-ok: scratch-schema teardown between cases
    await loadVariables(pool);
    await setVariable(pool, "redemption.confirmed_by", "steward");
    await setVariable(pool, "redemption.holds_on_propose", "true");
    await setVariable(pool, "redemption.per_member_per_cycle", "2");
    await setVariable(pool, "redemption.expires_after_days", "30");
    await setVariable(pool, "redemption.tokens", "");
  });

  // ── The firewall, and the one hole the ruling opened ─────────────────────

  it("registers the token this file is about, at the scale the platform ships", () => {
    const def = tokenDef(STAY_CREDIT);
    expect(def?.kind).toBe("credit");
    expect(def?.governance).toBe("platform");
    expect(def?.transferable).toBe(false);
    // Every amount below goes through `toLedgerUnits`, so this is the one place
    // the scale is named. A rescale that broke the conversions would land here
    // first rather than as an off-by-a-hundred in a balance.
    expect(def?.decimals).toBe(2);
  });

  it("admits a stay credit to redemption and leaves the library credit out", () => {
    expect(redeemableToken(STAY_CREDIT)).toBe(true);
    expect(redeemableToken(LIBRARY_CREDIT)).toBe(false);
    expect(Array.from(REDEEMABLE_VOUCHERS)).toEqual([STAY_CREDIT]);
    // The voucher firewall itself is untouched. Both are still vouchers.
    expect(Array.from(MODULE_VOUCHERS).sort()).toEqual([LIBRARY_CREDIT, STAY_CREDIT].sort());
  });

  it("keeps the other three voucher answers exactly where they were", () => {
    // Redemption is the fourth question about a voucher and the only one Rye
    // ruled on. A member still cannot hand a stay credit to another member,
    // and an admin still cannot open that by flipping the row.
    expect(sendRefusal(STAY_CREDIT)).toBe("Stay Credits buys one thing from the village and cannot be passed on");
    expect(mayToggleTransferable(tokenDef(STAY_CREDIT)!)).toContain("belongs to a module that issues it");
    // And a spent one still lands in the faucet, which is the whole distinction
    // this file exists to keep.
    expect(spendSinkFor(STAY_CREDIT)).toBe(MINT_FAUCET);
  });

  it("no longer tells a member that a stay credit is worth one thing only", () => {
    expect(redemptionRefusal(baseAsk())).toBeNull();
    const library = redemptionRefusal(baseAsk({ slug: LIBRARY_CREDIT }));
    expect(library).toBe("Library Credits buys one thing from the village, and that thing is what it is worth");
  });

  it("can still be narrowed away by the dial, and the dial still cannot widen", async () => {
    await setVariable(pool, "redemption.tokens", "credits");
    expect(redeemableToken(STAY_CREDIT)).toBe(false);
    expect(redemptionRefusal(baseAsk())).toContain("is not one of the tokens this village redeems");
    // The hole is one slug wide. Typing the other voucher in still does nothing.
    await setVariable(pool, "redemption.tokens", `${STAY_CREDIT},${LIBRARY_CREDIT}`);
    expect(redeemableToken(STAY_CREDIT)).toBe(true);
    expect(redeemableToken(LIBRARY_CREDIT)).toBe(false);
  });

  // ── The redemption path, read out of the database ────────────────────────

  it("holds a stay credit exactly the way it holds a currency token", async () => {
    await member("wren", 10);
    const opened = await ask("wren", 4);
    expect(opened.ok, "ok" in opened ? undefined : (opened as any).error).toBe(true);

    expect(await balanceOf(pool, memberAccount("wren"), STAY_CREDIT)).toBe(units(6));
    expect(await balanceOf(pool, REDEMPTION_HOLD, STAY_CREDIT)).toBe(units(4));
    expect((await heldForRedemption(pool, "wren"))[STAY_CREDIT]).toBe(units(4));
    // NOTHING HAS BEEN DESTROYED YET, and the faucet says so. The village has
    // not paid, so the tokens still exist and are merely spoken for.
    expect(await balanceOf(pool, MINT_FAUCET, STAY_CREDIT)).toBe(-units(10));
    expect(await balanceOf(pool, REDEEMED, STAY_CREDIT)).toBe(0);
    await conserves();
  });

  it("destroys the confirmed amount into the retired figure and never into the faucet", async () => {
    await member("wren", 10);
    await member("ash", 0);
    const opened = await ask("wren", 4);
    expect(opened.ok).toBe(true);
    const id = (opened as any).row.id as string;

    const done = await settleRedemption(pool, {
      id,
      to: "confirmed",
      actorUserId: "ash",
      note: "paid her in cash on Tuesday",
    });
    expect(done.ok, "ok" in done && done.ok ? undefined : (done as any).error).toBe(true);

    // THE THREE FIGURES THAT MAKE THE DISTINCTION, all read from the database.
    expect(await balanceOf(pool, REDEEMED, STAY_CREDIT)).toBe(units(4));
    expect((await retiredSupply(pool))[STAY_CREDIT]).toBe(units(4));
    // The faucet is EXACTLY where it was. Issued supply does not fall, which is
    // the sentence `retiredSupply` carries, and it is the whole reason a
    // destroyed credit is not a returned one.
    expect(await balanceOf(pool, MINT_FAUCET, STAY_CREDIT)).toBe(-units(10));
    expect(await balanceOf(pool, REDEMPTION_HOLD, STAY_CREDIT)).toBe(0);
    expect(await balanceOf(pool, memberAccount("wren"), STAY_CREDIT)).toBe(units(6));
    await conserves();
  });

  it("gives them back on a refusal, and the faucet still never moves", async () => {
    await member("wren", 10);
    await member("ash", 0);
    const opened = await ask("wren", 4);
    const id = (opened as any).row.id as string;

    const back = await settleRedemption(pool, {
      id,
      to: "refused",
      actorUserId: "ash",
      note: "we have no cash this moon",
    });
    expect(back.ok).toBe(true);
    expect(await balanceOf(pool, memberAccount("wren"), STAY_CREDIT)).toBe(units(10));
    expect(await balanceOf(pool, REDEMPTION_HOLD, STAY_CREDIT)).toBe(0);
    expect(await balanceOf(pool, REDEEMED, STAY_CREDIT)).toBe(0);
    expect(await balanceOf(pool, MINT_FAUCET, STAY_CREDIT)).toBe(-units(10));
    await conserves();
  });

  // ── The spend path, unchanged ────────────────────────────────────────────

  it("still consumes a night into the faucet, which is not destruction", async () => {
    await member("wren", 10);
    const s = await stay("s-sr", "wren", units(2), 3);

    const r = await postNightsForStay(pool, s, dateStr(0));
    expect(r.stopped).toBe(false);
    expect(r.posted).toBe(3);

    expect(await balanceOf(pool, memberAccount("wren"), STAY_CREDIT)).toBe(units(4));
    // THE FAUCET SHRANK. Ten were issued and six came home, so four are out
    // there and the village may issue those six again. This is the fact an
    // earlier audit found and it is unchanged by the ruling.
    expect(await balanceOf(pool, MINT_FAUCET, STAY_CREDIT)).toBe(-units(4));
    expect(await balanceOf(pool, REDEEMED, STAY_CREDIT)).toBe(0);
    expect((await retiredSupply(pool))[STAY_CREDIT] ?? 0).toBe(0);
    await conserves();
  });

  // ── The two endings, side by side, in one book ───────────────────────────

  it("writes the two endings so a reader of the ledger alone can tell them apart", async () => {
    await member("wren", 10);
    await member("ash", 0);
    const s = await stay("s-sr", "wren", units(2), 1);
    expect((await postNightsForStay(pool, s, dateStr(0))).posted).toBe(1);

    const opened = await ask("wren", 3);
    const id = (opened as any).row.id as string;
    expect(
      (await settleRedemption(pool, { id, to: "confirmed", actorUserId: "ash", note: "paid" })).ok,
    ).toBe(true);

    const book = await postings();
    const consumed = book.filter((p) => p.source === "stay_night");
    const destroyed = book.filter((p) => p.source === "redemption_burn");

    // BOTH HALVES DIFFER, so neither a source convention nor a destination
    // convention has to be trusted on its own.
    expect(consumed).toEqual([
      { source: "stay_night", from: memberAccount("wren"), to: MINT_FAUCET, amount: units(2) },
    ]);
    expect(destroyed).toEqual([
      { source: "redemption_burn", from: REDEMPTION_HOLD, to: REDEEMED, amount: units(3) },
    ]);
    // And the hold leg is its own third thing, so "spoken for" is legible too.
    expect(book.filter((p) => p.source === "redemption_hold")).toEqual([
      { source: "redemption_hold", from: memberAccount("wren"), to: REDEMPTION_HOLD, amount: units(3) },
    ]);

    // The two figures a village reads, after one of each.
    // Issued 10, consumed 2 back to the faucet, 3 retired for good.
    expect(await balanceOf(pool, MINT_FAUCET, STAY_CREDIT)).toBe(-units(8));
    expect(await balanceOf(pool, REDEEMED, STAY_CREDIT)).toBe(units(3));
    expect(await balanceOf(pool, memberAccount("wren"), STAY_CREDIT)).toBe(units(5));
    /*
     * WHAT THIS COSTS, MEASURED RATHER THAN ASSERTED AWAY.
     *
     * server/lib/stays.ts calls `-balanceOf(sys:mint, 'stay-credit')` the
     * outstanding credit supply. After a redemption that reading is one term
     * short: it says 8 are out there and 5 are, because 3 have been retired
     * without ever touching the faucet. The honest figure subtracts the
     * retired balance, and `GET /api/admin/tokens` prints the two side by side
     * and refuses to net them silently.
     */
    const faucetSays = -(await balanceOf(pool, MINT_FAUCET, STAY_CREDIT));
    const retired = (await retiredSupply(pool))[STAY_CREDIT] ?? 0;
    expect(faucetSays).toBe(units(8));
    expect(faucetSays - retired).toBe(units(5));
    await conserves();
  });

  it("leaves a held stay credit out of reach of the night that would have spent it", async () => {
    // The consequence of holding a token that has a spend path of its own.
    // `redemption.test.ts` enumerates fourteen debit paths and rules the stay
    // ones out because a voucher could never be redeemed; that is no longer
    // true for this one, so the interaction is driven for real. Nothing new
    // guards it and nothing needs to: the hold moved the tokens OUT of the
    // member's account, so the night simply finds nothing to take and stops.
    await member("wren", 4);
    const opened = await ask("wren", 4);
    expect(opened.ok).toBe(true);
    const s = await stay("s-sr", "wren", units(2), 2);

    const r = await postNightsForStay(pool, s, dateStr(0));
    // `stay.grace_nights` defaults above zero, so the first night posts into
    // grace and the run stops at the floor. What matters is that the redeemed
    // tokens were never available to it.
    expect(await balanceOf(pool, REDEMPTION_HOLD, STAY_CREDIT)).toBe(units(4));
    expect(r.posted + Number(r.stopped)).toBeGreaterThan(0);
    expect(await balanceOf(pool, memberAccount("wren"), STAY_CREDIT)).toBeLessThanOrEqual(0);
    await conserves();
  });
});
