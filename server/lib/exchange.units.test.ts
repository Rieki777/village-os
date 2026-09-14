/**
 * THE EXCHANGE'S UNITS, PROVED AT TWO DIFFERENT SCALES.
 *
 * `server/lib/exchange.test.ts` is about what money may buy and never touches
 * the ledger. `server/swap.test.ts` is about the quote arithmetic and never
 * touches the ledger either. `server/loop.e2e.test.ts` does touch it, and every
 * token in its fixtures has `decimals = 0`, where a human number and a minor
 * unit are the same number. So nothing in the tree could tell a correct posting
 * from one ten thousand times too small.
 *
 * Every case below runs TWICE, once against tokens registered at decimals 0 and
 * once at decimals 4, and the expected numbers are derived from that decimals
 * value rather than written down. A case that reads the same at both scales is
 * not a decimals test; it is a scale test wearing one's clothes.
 *
 * Two things are deliberately NOT asserted through `toLedgerUnits`: the ledger
 * amounts and the balances. Those are computed here as `human * 10 ** decimals`
 * so the test does not prove the converter against itself.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and it skips loudly.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  MINT_FAUCET,
  TREASURY,
  balanceOf,
  checkLedgerInvariants,
  loadTokenRegistry,
  memberAccount,
  postTransfer,
  registerToken,
  tokenDef,
  type PairGuard,
} from "./ledger";
import { fromLedgerUnits, toLedgerUnits } from "./economy";
import {
  executeSwap,
  quoteSwap,
  settleExchangeOrder,
  swapCycleUsage,
  swappableBalance,
  treasuryStock,
  type PriceRow,
} from "./exchange";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

/** A member with a users row, so the order rows below read like real ones. */
async function makeMember(id: string): Promise<string> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,'x') " +
      "ON DUPLICATE KEY UPDATE name = VALUES(name)",
    [id, id, `${id}@example.test`],
  );
  return id;
}

/** Rows in `token_ledger` right now, for the "nothing moved" assertions. */
async function ledgerRowCount(): Promise<number> {
  const [[row]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM token_ledger"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return Number(row.n);
}

/** The raw minor figure, read past every converter. */
async function rawBalance(account: string, slug: string): Promise<number> {
  const [[row]] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT COALESCE(balance, 0) AS b FROM token_balances WHERE account_id = ? AND token_type = ?",
    [account, slug],
  );
  return Number(row?.b ?? 0);
}

/** The legs one order posted, in the order the ledger holds them. */
async function legsFor(sourceRef: string): Promise<any[]> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT token_type, amount, from_account, to_account FROM token_ledger WHERE source_ref = ? ORDER BY at, id",
    [sourceRef],
  );
  return rows;
}

/** Stock the treasury the way the admin route does, in MINOR units. */
async function stockTreasury(slug: string, minorAmount: number, key: string): Promise<void> {
  const r = await postTransfer(pool, {
    from: MINT_FAUCET, to: TREASURY, tokenType: slug, amount: minorAmount,
    source: "exchange_stock", idempotencyKey: key,
  });
  expect(r.ok).toBe(true);
}

describe.skipIf(!configured)("the exchange's units, at two scales", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the eventSeats.test.ts shape
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  // ── The quote engine, which owns no decimals at all ───────────────────────

  it("prices a swap in WHOLE tokens and ceils toward the treasury, whatever the registry says", () => {
    // `quoteSwap` never sees a slug, only two prices in cents per WHOLE token.
    // Its ceil proof is stated over integers, so a decimals change cannot move
    // it, and this case exists to pin that it did not.
    const prices = (minor: number): PriceRow => ({
      id: `p-${minor}`, tokenSlug: "x", priceMinor: minor,
      note: "a posted price", setBy: null, effectiveAt: "2026-01-01",
    });
    const even = quoteSwap({
      payToken: "swap-a", receiveToken: "swap-b", receiveQuantity: 10,
      payPrice: prices(500), receivePrice: prices(200), spreadBps: 0,
    });
    expect("error" in even).toBe(false);
    if ("error" in even) return;
    // 10 receive at 200 is 2000 cents; paying in 500-cent units needs 4.
    expect(even.payQuantity).toBe(4);
    expect(even.valueMinor).toBe(2000);
    expect(even.netMinor).toBe(2000);
    expect(even.takeMinor).toBe(0);

    // The rounding case: 10 at 220 is 2200, which is 4.4 units of 500. The
    // ceil goes to the treasury, never to the member.
    const rounded = quoteSwap({
      payToken: "swap-a", receiveToken: "swap-b", receiveQuantity: 10,
      payPrice: prices(500), receivePrice: prices(220), spreadBps: 0,
    });
    expect("error" in rounded).toBe(false);
    if ("error" in rounded) return;
    expect(rounded.payQuantity).toBe(5);
    expect(rounded.takeMinor).toBe(2500 - 2200);
    expect(rounded.takeMinor).toBeGreaterThan(0);
  });

  // ── Everything that touches the ledger, once per scale ────────────────────

  for (const decimals of [0, 4]) {
    const scale = 10 ** decimals;
    const BUY = `ud${decimals}-buy`;
    const PAY = `ud${decimals}-pay`;
    const RECV = `ud${decimals}-recv`;
    const tag = `at decimals ${decimals}`;

    describe(`${tag}`, () => {
      const buyer = `units-buyer-${decimals}`;
      const swapper = `units-swapper-${decimals}`;

      beforeAll(async () => {
        for (const slug of [BUY, PAY, RECV]) {
          await registerToken(pool, {
            slug, name: `Units ${slug}`, kind: "credit", governance: "platform",
            transferable: false, decimals,
          });
        }
        await makeMember(buyer);
        await makeMember(swapper);
        // 500 whole tokens of each, stocked in the unit the ledger holds.
        await stockTreasury(BUY, 500 * scale, `units-stock-buy-${decimals}`);
        await stockTreasury(PAY, 500 * scale, `units-stock-pay-${decimals}`);
        await stockTreasury(RECV, 500 * scale, `units-stock-recv-${decimals}`);
      });

      it("registers the scale it says it does", () => {
        // The seam the rest of the block rests on. If this is wrong every
        // number below is measuring the wrong thing.
        expect(tokenDef(BUY)?.decimals).toBe(decimals);
        expect(toLedgerUnits(BUY, 1)).toBe(scale);
        expect(fromLedgerUnits(BUY, scale)).toBe(1);
      });

      it("settles a purchase in MINOR units and takes exactly that much out of the treasury", async () => {
        const orderId = `units-ord-${decimals}`;
        const quantity = 30;
        await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          "INSERT INTO exchange_orders (id, receipt_no, user_id, token_slug, quantity, price_minor_each, amount_minor, status) " +
            "VALUES (?,?,?,?,?,?,?, 'pending')",
          [orderId, 8000 + decimals, buyer, BUY, quantity, 1200, quantity * 1200],
        );
        const treasuryBefore = await rawBalance(TREASURY, BUY);

        await settleExchangeOrder(pool, orderId, {
          id: orderId, user_id: buyer, token_slug: BUY, quantity, receipt_no: 8000 + decimals,
        });

        // The ROW, not a return value: what the ledger actually holds.
        const legs = await legsFor(orderId);
        expect(legs.length).toBe(1);
        expect(Number(legs[0].amount)).toBe(quantity * scale);
        expect(String(legs[0].from_account)).toBe(TREASURY);

        // The buyer's balance, in the unit balances are kept in.
        expect(await balanceOf(pool, memberAccount(buyer), BUY)).toBe(quantity * scale);
        // The treasury fell by exactly the converted quantity, not by the
        // human number and not by the human number times two scales.
        expect(treasuryBefore - (await rawBalance(TREASURY, BUY))).toBe(quantity * scale);
        // And the desk reads the drop in whole tokens.
        expect((await treasuryStock(pool))[BUY]).toBe(500 - quantity);

        expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
      });

      it("refuses a purchase the treasury cannot cover, and mints nothing to cover it", async () => {
        const orderId = `units-ord-oos-${decimals}`;
        // Far more than the 470 whole tokens left after the settle above.
        const quantity = 100_000;
        await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          "INSERT INTO exchange_orders (id, receipt_no, user_id, token_slug, quantity, price_minor_each, amount_minor, status) " +
            "VALUES (?,?,?,?,?,?,?, 'pending')",
          [orderId, 8100 + decimals, buyer, BUY, quantity, 1200, 1200],
        );
        const rowsBefore = await ledgerRowCount();
        const mintBefore = await rawBalance(MINT_FAUCET, BUY);
        const treasuryBefore = await rawBalance(TREASURY, BUY);

        await expect(
          settleExchangeOrder(pool, orderId, {
            id: orderId, user_id: buyer, token_slug: BUY, quantity, receipt_no: 8100 + decimals,
          }),
        ).rejects.toThrow(/treasury cannot cover/);

        // Out of stock is a fact, never a mint opportunity: the faucet's
        // issuance-to-date is untouched and no row was written at all.
        expect(await ledgerRowCount()).toBe(rowsBefore);
        expect(await rawBalance(MINT_FAUCET, BUY)).toBe(mintBefore);
        expect(await rawBalance(TREASURY, BUY)).toBe(treasuryBefore);
        expect(await legsFor(orderId)).toEqual([]);
        expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
      });

      it("posts BOTH swap legs in minor, each at its own token's scale, and conserves", async () => {
        // The swapper gets their pay-side tokens the way a member really gets
        // them: out of the stocked treasury, through a settled purchase.
        const seedId = `units-seed-${decimals}`;
        await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          "INSERT INTO exchange_orders (id, receipt_no, user_id, token_slug, quantity, price_minor_each, amount_minor, status, paid_at) " +
            "VALUES (?,?,?,?,?,?,?, 'paid', NOW())",
          [seedId, 8200 + decimals, swapper, PAY, 100, 500, 50_000],
        );
        await settleExchangeOrder(pool, seedId, {
          id: seedId, user_id: swapper, token_slug: PAY, quantity: 100, receipt_no: 8200 + decimals,
        });
        expect(await balanceOf(pool, memberAccount(swapper), PAY)).toBe(100 * scale);

        const swapId = `units-swap-${decimals}`;
        const r = await executeSwap(pool, {
          id: swapId, user_id: swapper,
          pay_token_slug: PAY, pay_quantity: 4,
          token_slug: RECV, quantity: 10,
          receipt_no: 8300 + decimals,
        });
        expect(r).toEqual({ ok: true });

        const legs = await legsFor(swapId);
        expect(legs.length).toBe(2);
        const payLeg = legs.find((l) => String(l.token_type) === PAY);
        const recvLeg = legs.find((l) => String(l.token_type) === RECV);
        expect(Number(payLeg.amount)).toBe(4 * scale);
        expect(Number(recvLeg.amount)).toBe(10 * scale);
        expect(String(payLeg.to_account)).toBe(TREASURY);
        expect(String(recvLeg.from_account)).toBe(TREASURY);

        expect(await balanceOf(pool, memberAccount(swapper), PAY)).toBe((100 - 4) * scale);
        expect(await balanceOf(pool, memberAccount(swapper), RECV)).toBe(10 * scale);
        // Conservation, which is the property a units error can still satisfy
        // and is therefore necessary rather than sufficient.
        expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
      });

      it("reports the treasury and the cycle's swap usage in WHOLE tokens", async () => {
        // Both are the ledger's own number divided by the token's scale, and
        // both are compared against steward-typed whole numbers by every
        // consumer, so this is the assertion that keeps the caps meaningful.
        const rawTreasury = await rawBalance(TREASURY, RECV);
        expect((await treasuryStock(pool))[RECV]).toBe(rawTreasury / scale);
        // 500 stocked, 10 swapped out.
        expect((await treasuryStock(pool))[RECV]).toBe(490);

        const [[sum]] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          "SELECT COALESCE(SUM(amount),0) AS s FROM token_ledger " +
            "WHERE from_account = ? AND token_type = ? AND source = 'exchange_swap'",
          [TREASURY, RECV],
        );
        const cycleStart = new Date(Date.now() - 30 * 86_400_000);
        const used = await swapCycleUsage(pool, RECV, cycleStart);
        expect(used).toBe(Number(sum.s) / scale);
        expect(used).toBe(10);
        expect(await swapCycleUsage(pool, RECV, cycleStart, swapper)).toBe(10);
      });

      it("binds the per-cycle swap cap on the whole-token number a steward typed", async () => {
        // The route's PairGuard in miniature: the same read, the same
        // comparison, inside the transaction that would do the writing.
        const cycleStart = new Date(Date.now() - 30 * 86_400_000);
        const CAP = 12; // whole tokens out per cycle; 10 are already spent
        const capGuard = (want: number): PairGuard => async (conn) => {
          const used = await swapCycleUsage(conn, RECV, cycleStart);
          return used + want > CAP ? `cap: ${Math.max(0, CAP - used)} left` : null;
        };

        const rowsBefore = await ledgerRowCount();
        const refused = await executeSwap(pool, {
          id: `units-cap-no-${decimals}`, user_id: swapper,
          pay_token_slug: PAY, pay_quantity: 2, token_slug: RECV, quantity: 5,
          receipt_no: 8400 + decimals,
        }, capGuard(5));
        expect(refused.ok).toBe(false);
        // The remaining figure is a whole-token count a member can read: 2.
        expect(String(refused.error)).toContain("2 left");
        expect(await ledgerRowCount()).toBe(rowsBefore);

        // One inside the cap still goes through, so the cap is refusing on
        // the boundary and not simply refusing everything.
        const allowed = await executeSwap(pool, {
          id: `units-cap-yes-${decimals}`, user_id: swapper,
          pay_token_slug: PAY, pay_quantity: 1, token_slug: RECV, quantity: 2,
          receipt_no: 8500 + decimals,
        }, capGuard(2));
        expect(allowed).toEqual({ ok: true });
        expect(await swapCycleUsage(pool, RECV, cycleStart)).toBe(12);
        expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
      });

      it("computes the chargeback hold ONCE per unit, adding a human hold to a converted one", async () => {
        // The trap this case exists for: `held` sums a HUMAN column and a
        // MINOR column. Converting the whole sum divides the human half a
        // second time, which under-counts the hold by one whole scale and
        // reopens the side door the commerce leg was added to close.
        const holder = await makeMember(`units-holder-${decimals}`);
        const HOLD_TOKEN = `ud${decimals}-hold`;
        await registerToken(pool, {
          slug: HOLD_TOKEN, name: `Units ${HOLD_TOKEN}`, kind: "credit",
          governance: "platform", transferable: false, decimals,
        });
        await stockTreasury(HOLD_TOKEN, 500 * scale, `units-stock-hold-${decimals}`);

        // 60 whole tokens in hand, all of them out of the treasury.
        const seedId = `units-hold-seed-${decimals}`;
        await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          "INSERT INTO exchange_orders (id, receipt_no, user_id, kind, token_slug, quantity, price_minor_each, amount_minor, status, paid_at) " +
            "VALUES (?,?,?, 'fiat_purchase', ?,?,?,?, 'paid', NOW())",
          [seedId, 8600 + decimals, holder, HOLD_TOKEN, 43, 100, 4300],
        );
        await settleExchangeOrder(pool, seedId, {
          id: seedId, user_id: holder, token_slug: HOLD_TOKEN, quantity: 43, receipt_no: 8600 + decimals,
        });
        // A commerce token pack, which lands as a `product_grant` ledger row
        // in MINOR units and never touches `exchange_orders`.
        const grant = await postTransfer(pool, {
          from: TREASURY, to: memberAccount(holder), tokenType: HOLD_TOKEN,
          amount: 17 * scale, source: "product_grant",
          idempotencyKey: `units-grant-${decimals}`,
        });
        expect(grant.ok).toBe(true);

        const hold = await swappableBalance(pool, holder, HOLD_TOKEN, 7);
        // Every field is a whole-token figure.
        expect(hold.balance).toBe(43 + 17);
        expect(hold.held).toBe(43 + 17);
        expect(hold.swappable).toBe(0);
        expect(hold.clearsAt).toBeTruthy();
        // What the double conversion would have said. Named so a future
        // "consistency" edit that divides `row.held` too fails here rather
        // than in production, where it reads as a hold that quietly stopped
        // holding.
        if (scale > 1) {
          expect(hold.held).not.toBe(43 / scale + 17);
        }

        // The fiat hold ages out; the ledger balance does not move with it.
        await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          "UPDATE exchange_orders SET paid_at = (NOW() - INTERVAL 30 DAY) WHERE id = ?",
          [seedId],
        );
        await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          "UPDATE token_ledger SET at = (NOW() - INTERVAL 30 DAY) WHERE idempotency_key = ?", // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          [`units-grant-${decimals}`],
        );
        const cleared = await swappableBalance(pool, holder, HOLD_TOKEN, 7);
        expect(cleared.balance).toBe(60);
        expect(cleared.held).toBe(0);
        expect(cleared.swappable).toBe(60);

        // The zero-hold early return answers in the same unit as the long
        // path. It used to be the one door that leaked a raw minor figure.
        const noHold = await swappableBalance(pool, holder, HOLD_TOKEN, 0);
        expect(noHold.balance).toBe(60);
        expect(noHold.swappable).toBe(60);
        expect(await balanceOf(pool, memberAccount(holder), HOLD_TOKEN)).toBe(60 * scale);
      });
    });
  }
});
