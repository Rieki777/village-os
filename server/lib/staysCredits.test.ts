/**
 * A night paid in the village's own credits (0092).
 *
 * The stay-credit path has been proved end to end by `loop.e2e.test.ts` since
 * S30. This file is about the second currency and the three things that had to
 * stay true when it arrived:
 *
 *   1. The snapshot decides. A stay charges the token it was ACTIVATED in, at
 *      the rate it was activated at, and re-pricing the room afterwards moves
 *      neither.
 *   2. The sink follows the token. Stay credits retire into the faucet that
 *      issued them; village credits land in the treasury, because burning them
 *      into `sys:cycle-pool` would redefine that faucet's negative balance from
 *      "released to date" into "outstanding".
 *   3. The grace window is the SAME window, whichever token pays, and a member
 *      in grace on credits is legal for exactly the same reason a member in
 *      grace on stay credits is. `checkLedgerInvariants` asks its
 *      negative-balance question per (account, token), so this is a property to
 *      confirm and not one to add.
 *
 * Conservation is re-proved after every case.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  CYCLE_POOL_FAUCET,
  MINT_FAUCET,
  TREASURY,
  balanceOf,
  checkLedgerInvariants,
  loadTokenRegistry,
  memberAccount,
  postTransfer,
  registerToken,
} from "./ledger";
import {
  STAY_CREDIT,
  ensureStayToken,
  mintStayCredits,
  nightsOwed,
  nightsRemaining,
  postNightsForStay,
  priceFromStored,
  priceToStored,
  stayById,
} from "./stays";
import { loadVariables, setVariable } from "./variables";

const configured = testDbConfigured();
/**
 * PINNED to 0 in the setup below. It used to inherit the registry default, and
 * `0184` ended that: credits are currency-like and now carry two places. This
 * file is about a conversion being applied exactly once in each direction, so
 * it needs one token with no scale and one with a big one, and the pin is what
 * keeps the first of those true.
 */
const CREDITS = "credits";
/**
 * A credit token at FOUR decimals, which is where the whole platform is going.
 *
 * It has to be a token of its own: `registerToken` deliberately leaves
 * `decimals` out of its upsert, so re-registering `credits` could never change
 * its scale, which is the guard that stops a boot rescaling a live holding.
 *
 * Every expected number below is written as its decimals arithmetic (8 credits
 * is 8 x 10^4 = 80_000 units) rather than as a call to `toLedgerUnits`, so a
 * conversion that went missing cannot also go missing from the assertion.
 */
const CREDITS_4 = "credits-4dp";
const ONE_4 = 10_000;

describe.skipIf(!configured)("a night paid in village credits", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  const dateStr = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  const member = async (id: string, token: string, amount: number) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?)",
      [id, id, `${id}@example.test`, "h"],
    );
    if (amount > 0) {
      const r = await postTransfer(pool, {
        from: token === STAY_CREDIT ? MINT_FAUCET : CYCLE_POOL_FAUCET,
        to: memberAccount(id), tokenType: token, amount,
        source: token === STAY_CREDIT ? "stay_comp" : "gratitude_pool",
        idempotencyKey: `seed:${id}:${token}:${amount}`,
      });
      expect(r.ok).toBe(true);
    }
  };

  /** An ACTIVE stay, snapshot at `rate` of `token`, arriving `days` ago. */
  const stay = async (id: string, userId: string, token: string, rate: number, days: number) => {
    await pool.query("INSERT IGNORE INTO accommodations (id, name, capacity) VALUES ('acc-1','Cabin',2)"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO stays (id, user_id, accommodation_id, status, arrive_on, autopay, rate_snapshot_credits, rate_snapshot_token, audience_snapshot) " +
        "VALUES (?,?, 'acc-1', 'active', ?, 1, ?, ?, 'guest')",
      [id, userId, dateStr(-days), rate, token],
    );
    return (await stayById(pool, id))!;
  };

  const conserves = async () => {
    expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    await loadTokenRegistry(pool);
    // A fresh schema seeds gratitude, equity, voice and credits. `stay-credit`
    // is registered at BOOT by the stays module, not by a migration, so a
    // suite that talks to it has to do what boot does.
    await ensureStayToken(pool);
    await registerToken(pool, {
      slug: CREDITS_4,
      name: "Four Decimal Credits",
      kind: "credit",
      governance: "platform",
      transferable: true,
      decimals: 4,
    });
    // The pin. See CREDITS above: this file needs one token with no scale, and
    // the platform no longer ships one under that slug.
    await pool.query("UPDATE tokens SET decimals = 0 WHERE slug = ?", [CREDITS]); // module-review-ok: the decimals seam this file exists to exercise, against the S5 scratch schema
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    // Variables come from the table, so the reset is a table reset plus a
    // reload. Leaving one case's grace window set would make the next case
    // pass or fail for a reason it never states.
    await pool.query("DELETE FROM game_variables"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await loadVariables(pool);
    await pool.query("DELETE FROM stays"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM token_ledger"); // module-review-ok: scratch-schema teardown between cases, not a ledger write: value only ever moves here through postTransfer
    await pool.query("DELETE FROM token_balances"); // module-review-ok: scratch-schema teardown between cases, not a ledger write: value only ever moves here through postTransfer
    await pool.query("DELETE FROM users"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  it("defaults an old row to stay credits, so nothing that existed changes", async () => {
    // The column default is the whole migration-safety story: every stay that
    // existed before 0092 pays exactly what it paid yesterday.
    await member("u-1", STAY_CREDIT, 30);
    await pool.query("INSERT IGNORE INTO accommodations (id, name, capacity) VALUES ('acc-1','Cabin',2)"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO stays (id, user_id, accommodation_id, status, arrive_on, autopay, rate_snapshot_credits, audience_snapshot) " +
        "VALUES ('s-old','u-1','acc-1','active', ?, 1, 5, 'guest')",
      [dateStr(-2)],
    );
    const row = (await stayById(pool, "s-old"))!;
    expect(row.rateSnapshotToken).toBe(STAY_CREDIT);
  });

  it("burns village credits to the TREASURY, one night at a time", async () => {
    await member("u-1", CREDITS, 30);
    const s = await stay("s-1", "u-1", CREDITS, 5, 3);

    const r = await postNightsForStay(pool, s, dateStr(0));
    expect(r.stopped).toBe(false);
    expect(r.posted).toBe(3);
    expect(await balanceOf(pool, memberAccount("u-1"), CREDITS)).toBe(15);
    // The treasury holds it; the cycle-pool faucet's own figure is untouched,
    // so "released to date" still means released to date.
    expect(await balanceOf(pool, TREASURY, CREDITS)).toBe(15);
    expect(await balanceOf(pool, CYCLE_POOL_FAUCET, CREDITS)).toBe(-30);
    await conserves();
  });

  it("still retires a STAY credit into the faucet that issued it", async () => {
    await member("u-2", STAY_CREDIT, 30);
    const s = await stay("s-2", "u-2", STAY_CREDIT, 5, 2);
    await postNightsForStay(pool, s, dateStr(0));
    expect(await balanceOf(pool, memberAccount("u-2"), STAY_CREDIT)).toBe(20);
    // Outstanding supply fell by what was spent, which is the number the mint
    // panel reads.
    expect(await balanceOf(pool, MINT_FAUCET, STAY_CREDIT)).toBe(-20);
    expect(await balanceOf(pool, TREASURY, STAY_CREDIT)).toBe(0);
    await conserves();
  });

  it("reads the balance of the SNAPSHOT token, never of stay credits", async () => {
    // The defect this closes: a guest paying credits, holding zero stay
    // credits, would have looked broke to a posting loop reading the wrong
    // token, and the grace check would have stopped their first night.
    await member("u-3", CREDITS, 30);
    const s = await stay("s-3", "u-3", CREDITS, 5, 1);
    expect(await balanceOf(pool, memberAccount("u-3"), STAY_CREDIT)).toBe(0);

    const r = await postNightsForStay(pool, s, dateStr(0));
    expect(r.posted).toBe(1);
    expect(r.stopped).toBe(false);
    await conserves();
  });

  it("honours the SAME grace window on credits, and stops at its floor", async () => {
    await setVariable(pool, "stay.grace_nights", "1");
    await member("u-4", CREDITS, 10);
    const s = await stay("s-4", "u-4", CREDITS, 5, 5);

    const r = await postNightsForStay(pool, s, dateStr(0));
    // Two nights from the balance, one more into the grace window, then stop.
    expect(r.posted).toBe(3);
    expect(r.stopped).toBe(true);
    expect(await balanceOf(pool, memberAccount("u-4"), CREDITS)).toBe(-5);
    // A legal negative: the boot invariant permits it because the debit came
    // from `stay_night`, and it asks that per (account, token).
    await conserves();
  });

  it("posts each night once, so a catch-up run after a nap converges", async () => {
    await member("u-5", CREDITS, 40);
    const s = await stay("s-5", "u-5", CREDITS, 5, 4);
    expect(nightsOwed(s, dateStr(0))).toHaveLength(4);

    await postNightsForStay(pool, s, dateStr(0));
    const after = (await stayById(pool, "s-5"))!;
    // The re-read row knows what it has posted, so the second sweep owes zero.
    expect(nightsOwed(after, dateStr(0))).toHaveLength(0);
    const second = await postNightsForStay(pool, after, dateStr(0));
    expect(second.posted).toBe(0);
    expect(await balanceOf(pool, memberAccount("u-5"), CREDITS)).toBe(20);
    await conserves();
  });

  /*
   * ── The unit boundary, at both scales ──────────────────────────────────
   *
   * Every case above runs against tokens at `decimals: 0`, where a human
   * number and a ledger unit are the same number and the question cannot be
   * asked. These ask it.
   *
   * The cases are written so that REMOVING the conversion in `priceToStored`
   * turns each of them red, which is the only thing that makes them tests
   * rather than restatements: at decimals 0 an identity conversion is
   * indistinguishable from no conversion at all.
   */

  it("stores a posted token price in MINOR units and reads it back whole", async () => {
    // decimals 0: the identity, both ways. This is the half that must not move.
    expect(priceToStored(CREDITS, 8)).toBe(8);
    expect(priceFromStored(CREDITS, 8)).toBe(8);

    // decimals 4: 8 credits is 8 x 10^4 units.
    expect(priceToStored(CREDITS_4, 8)).toBe(80_000);
    expect(priceFromStored(CREDITS_4, 80_000)).toBe(8);
    expect(priceFromStored(CREDITS_4, priceToStored(CREDITS_4, 3))).toBe(3);

    // usd is not a token and never converts: the column already holds cents,
    // and the admin form is the thing that multiplied by 100.
    expect(priceToStored("usd", 12_345)).toBe(12_345);
    expect(priceFromStored("usd", 12_345)).toBe(12_345);

    // The whole-unit contract the route's own refusal states survives.
    expect(priceToStored(CREDITS_4, 8.7)).toBe(80_000);
  });

  it("burns a four-decimal night at the LEDGER's scale, not the typed one", async () => {
    // 20 credits held, a night posted at 8. Written as units, because that is
    // what the column holds once the price route has converted.
    await member("u-6", CREDITS_4, 20 * ONE_4);
    const s = await stay("s-6", "u-6", CREDITS_4, priceToStored(CREDITS_4, 8), 2);

    const r = await postNightsForStay(pool, s, dateStr(0));
    expect(r.posted).toBe(2);
    expect(r.stopped).toBe(false);
    // 200_000 - 2 x 80_000. An unconverted rate would take 16 units and leave
    // 199_984, and the guest would sleep 12,500 nights on twenty credits.
    expect(await balanceOf(pool, memberAccount("u-6"), CREDITS_4)).toBe(40_000);
    expect(await balanceOf(pool, TREASURY, CREDITS_4)).toBe(160_000);

    // Each posted leg is one night at the token's own scale.
    const [legs] = await pool.query<any[]>(
      "SELECT amount FROM token_ledger WHERE token_type = ? AND source = 'stay_night' AND from_account = ? ORDER BY idempotency_key",
      [CREDITS_4, memberAccount("u-6")],
    );
    expect(legs.map((l: any) => Number(l.amount))).toEqual([80_000, 80_000]);

    // And the number a steward acts on agrees: 4 credits left buys no night
    // at 8. Both arguments are minor, so this is right at any decimals.
    expect(nightsRemaining(40_000, priceToStored(CREDITS_4, 8))).toBe(0);
    expect(nightsRemaining(240_000, priceToStored(CREDITS_4, 8))).toBe(3);
    await conserves();
  });

  it("stops a four-decimal stay at the SAME grace floor, one night past empty", async () => {
    /*
     * The grace floor is the failure that has no upper bound. It is built from
     * the snapshot rate and compared against a `token_balances` figure, so a
     * human rate against a minor balance makes `balance - rate < graceFloor`
     * effectively unsatisfiable and the posting loop runs to the 366-night
     * runaway guard instead of stopping.
     *
     * 10 credits held, 8 a night, one night of grace, five nights owed:
     *   night 1  100_000 -> 20_000
     *   night 2   20_000 -> -60_000   (floor is -80_000, so this is allowed)
     *   night 3  -60_000 - 80_000 = -140_000 < -80_000  -> STOP
     */
    await setVariable(pool, "stay.grace_nights", "1");
    await member("u-7", CREDITS_4, 10 * ONE_4);
    const s = await stay("s-7", "u-7", CREDITS_4, priceToStored(CREDITS_4, 8), 5);

    const r = await postNightsForStay(pool, s, dateStr(0));
    expect(r.posted).toBe(2);
    expect(r.stopped).toBe(true);
    expect(await balanceOf(pool, memberAccount("u-7"), CREDITS_4)).toBe(-60_000);
    // A legal negative, asked per (account, token) exactly as at decimals 0.
    await conserves();
  });

  it("mints exactly the MINOR amount it is handed, and converts nothing", async () => {
    /*
     * `mintStayCredits` is a pass-through with a MINOR contract, and it has to
     * stay one: two of its four callers hand it a number already derived from
     * a minor `priceFor`. A `toLedgerUnits` inside it would multiply those a
     * second time, which on a token sold for money is the free-money direction.
     */
    await member("u-8", STAY_CREDIT, 0);
    const r = await mintStayCredits(pool, {
      userId: "u-8",
      amount: 40_000,
      source: "stay_purchase",
      sourceRef: "sp-unit-1",
      idempotencyKey: "ord:sp-unit-1:leg1",
    });
    expect(r.ok).toBe(true);
    expect(await balanceOf(pool, memberAccount("u-8"), STAY_CREDIT)).toBe(40_000);
    const [rows] = await pool.query<any[]>(
      "SELECT amount, to_account FROM token_ledger WHERE idempotency_key = ?",
      ["ord:sp-unit-1:leg1"],
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.to_account)).toBe(memberAccount("u-8"));
    expect(Number(rows[0]?.amount)).toBe(40_000);
    await conserves();
  });
});
