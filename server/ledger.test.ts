/**
 * Tests for the token ledger, S7 edition: transfer rows in MySQL.
 *
 * These exist because the end-to-end test cannot prove the properties that
 * matter here. Retrying a quest consent over HTTP is refused by the status
 * guard, so the request never reaches the ledger — idempotency is a property
 * of postTransfer and is tested against postTransfer, same key twice. The
 * new keystone properties are tested the same way: overdraft refusal rolls
 * the whole transaction back, faucets run negative by design and their
 * negative balance IS issuance-to-date, and conservation (per token, all
 * balances sum to zero) survives any mix of posts.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL → skips loudly.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import {
  balanceOf,
  balancesFor,
  checkLedgerInvariants,
  CYCLE_POOL_FAUCET,
  entriesForMember,
  loadTokenRegistry,
  memberAccount,
  MINT_FAUCET,
  PLATFORM_TOKEN,
  postTransfer,
  postTransferPair,
  questCreditsFor,
  RECOGNITION_FAUCET,
  refusalForMember,
  registerToken,
  tokenDef,
  TREASURY,
} from "./lib/ledger";
import { repairTaintedListings } from "./lib/exchange";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

describe.skipIf(!configured)("the MySQL token ledger", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("loads the registry from the tokens table (0006/0007 seeds)", () => {
    expect(tokenDef("gratitude")?.governance).toBe("platform");
    expect(tokenDef("equity")?.governance).toBe("hypha");
    expect(tokenDef("voice")?.governance).toBe("hypha");
    expect(tokenDef("credits")?.name).toBe("Village Credits");
    expect(tokenDef("nope")).toBeUndefined();
  });

  it("posts a faucet issue and returns the recomputed receiving balance", async () => {
    const r = await postTransfer(pool, {
      from: RECOGNITION_FAUCET,
      to: memberAccount("usr-1"),
      amount: 40,
      source: "quest_consent",
      idempotencyKey: "quest_consent:claim-1",
    });
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(false);
    expect(r.toBalance).toBe(40);
    expect(await balanceOf(pool, memberAccount("usr-1"))).toBe(40);
    // The faucet went negative by exactly what it issued.
    expect(await balanceOf(pool, RECOGNITION_FAUCET)).toBe(-40);
  });

  it("THE property: the same idempotency key posts exactly once", async () => {
    const input = {
      from: RECOGNITION_FAUCET,
      to: memberAccount("usr-1"),
      amount: 40,
      source: "quest_consent",
      idempotencyKey: "quest_consent:claim-1",
    };
    const second = await postTransfer(pool, input);
    const third = await postTransfer(pool, input);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(third.duplicate).toBe(true);
    expect(second.toBalance).toBe(40);
    expect((await entriesForMember(pool, "usr-1")).length).toBe(1);
    expect(await balanceOf(pool, RECOGNITION_FAUCET)).toBe(-40);
  });

  it("refuses an overdraft for non-faucet accounts and rolls the whole post back", async () => {
    // usr-1 holds 40 and tries to send 100 to usr-2.
    const r = await postTransfer(pool, {
      from: memberAccount("usr-1"),
      to: memberAccount("usr-2"),
      amount: 100,
      source: "test_transfer",
      idempotencyKey: "overdraft-attempt-1",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("insufficient");
    // Nothing moved and the failed row did not survive the rollback: the same
    // key can be used again once the account is funded.
    expect(await balanceOf(pool, memberAccount("usr-1"))).toBe(40);
    expect(await balanceOf(pool, memberAccount("usr-2"))).toBe(0);
    const retry = await postTransfer(pool, {
      from: memberAccount("usr-1"),
      to: memberAccount("usr-2"),
      amount: 15,
      source: "test_transfer",
      idempotencyKey: "overdraft-attempt-1",
    });
    expect(retry.ok).toBe(true);
    expect(retry.duplicate).toBe(false);
    expect(await balanceOf(pool, memberAccount("usr-1"))).toBe(25);
    expect(await balanceOf(pool, memberAccount("usr-2"))).toBe(15);
  });

  it("the treasury is NOT a faucet: it must be funded before it can spend", async () => {
    const broke = await postTransfer(pool, {
      from: TREASURY,
      to: memberAccount("usr-1"),
      amount: 5,
      source: "test_grant",
      idempotencyKey: "treasury-broke-1",
    });
    expect(broke.ok).toBe(false);
    expect(broke.error).toContain("insufficient");
  });

  it("fails loud on an unknown token, never coercing", async () => {
    const r = await postTransfer(pool, {
      from: RECOGNITION_FAUCET,
      to: memberAccount("usr-1"),
      tokenType: "definitely-not-registered",
      amount: 5,
      source: "test",
      idempotencyKey: "unknown-token-1",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("unknown token");
  });

  it("refuses to move hypha-governed tokens — the cap table lives on Base", async () => {
    const r = await postTransfer(pool, {
      from: RECOGNITION_FAUCET,
      to: memberAccount("usr-1"),
      tokenType: "equity",
      amount: 5,
      source: "test",
      idempotencyKey: "hypha-attempt-1",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Hypha");
  });

  it("refuses self-transfers, zero, negative and missing-account posts", async () => {
    const self = await postTransfer(pool, {
      from: memberAccount("usr-1"),
      to: memberAccount("usr-1"),
      amount: 5,
      source: "test",
      idempotencyKey: "self-1",
    });
    expect(self.ok).toBe(false);
    const zero = await postTransfer(pool, {
      from: RECOGNITION_FAUCET,
      to: memberAccount("usr-1"),
      amount: 0,
      source: "test",
      idempotencyKey: "zero-1",
    });
    expect(zero.ok).toBe(false);
    const missing = await postTransfer(pool, {
      from: "sys:no-such-account",
      to: memberAccount("usr-1"),
      amount: 5,
      source: "test",
      idempotencyKey: "missing-1",
    });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("does not exist");
  });

  it("cycle pool pays a separate token from its own faucet", async () => {
    const r = await postTransfer(pool, {
      from: CYCLE_POOL_FAUCET,
      to: memberAccount("usr-2"),
      tokenType: "credits",
      amount: 1000,
      source: "gratitude_pool",
      idempotencyKey: "gratitude_pool:1:usr-2",
    });
    expect(r.ok).toBe(true);
    const balances = await balancesFor(pool, memberAccount("usr-2"));
    expect(balances).toEqual({ gratitude: 15, credits: 1000 });
    expect(await balanceOf(pool, CYCLE_POOL_FAUCET, "credits")).toBe(-1000);
  });

  it("shows a member their movements signed from their side, newest first", async () => {
    const entries = await entriesForMember(pool, "usr-1");
    // usr-1: +40 (quest), -15 (sent to usr-2).
    const amounts = entries.map((e) => e.amount);
    expect(amounts).toContain(40);
    expect(amounts).toContain(-15);
    expect(entries.every((e) => typeof e.at === "string")).toBe(true);
  });

  it("registers a module token at runtime and can post it immediately", async () => {
    await registerToken(pool, {
      slug: "library-credits",
      name: "Material Library Credits",
      kind: "credit",
      governance: "platform",
      transferable: true,
    });
    expect(tokenDef("library-credits")?.name).toBe("Material Library Credits");
    const r = await postTransfer(pool, {
      from: CYCLE_POOL_FAUCET,
      to: memberAccount("usr-1"),
      tokenType: "library-credits",
      amount: 3,
      source: "module_grant",
      idempotencyKey: "module-grant-1",
    });
    expect(r.ok).toBe(true);
    expect(r.toBalance).toBe(3);
  });

  // ── S57: the paired post — two legs, one transaction ──────────────────────
  // A swap is the first operation where "leg 1 committed, leg 2 failed" is
  // reachable by ordinary use. These pin that it cannot happen.

  it("posts both legs of a pair atomically and recomputes every touched balance", async () => {
    await registerToken(pool, { slug: "pair-a", name: "Pair A", kind: "credit", governance: "platform", transferable: false });
    await registerToken(pool, { slug: "pair-b", name: "Pair B", kind: "credit", governance: "platform", transferable: false });
    // The pair's own Hypha-governed fixture, so the refusal test does not
    // depend on what THIS deployment happens to have named its DHO token.
    await registerToken(pool, { slug: "pair-dho", name: "Pair DHO", kind: "voice", governance: "hypha", transferable: false });
    // Stock the treasury with B, and give the member some A to trade.
    await postTransfer(pool, { from: "sys:mint", to: TREASURY, tokenType: "pair-b", amount: 100, source: "exchange_stock", idempotencyKey: "pair-stock-b" });
    await postTransfer(pool, { from: "sys:mint", to: memberAccount("swapper"), tokenType: "pair-a", amount: 50, source: "admin_mint", idempotencyKey: "pair-grant-a" });

    const r = await postTransferPair(pool, [
      { from: memberAccount("swapper"), to: TREASURY, tokenType: "pair-a", amount: 10, source: "exchange_swap", idempotencyKey: "ord:pair-1:leg1" },
      { from: TREASURY, to: memberAccount("swapper"), tokenType: "pair-b", amount: 20, source: "exchange_swap", idempotencyKey: "ord:pair-1:leg2" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(false);
    expect(r.balances[`${memberAccount("swapper")}|pair-a`]).toBe(40);
    expect(r.balances[`${memberAccount("swapper")}|pair-b`]).toBe(20);
    expect(r.balances[`${TREASURY}|pair-a`]).toBe(10);
    expect(r.balances[`${TREASURY}|pair-b`]).toBe(80);
    expect((await checkLedgerInvariants(pool)).ok).toBe(true);
  });

  it("replays a whole pair exactly once", async () => {
    const again = await postTransferPair(pool, [
      { from: memberAccount("swapper"), to: TREASURY, tokenType: "pair-a", amount: 10, source: "exchange_swap", idempotencyKey: "ord:pair-1:leg1" },
      { from: TREASURY, to: memberAccount("swapper"), tokenType: "pair-b", amount: 20, source: "exchange_swap", idempotencyKey: "ord:pair-1:leg2" },
    ]);
    expect(again.ok).toBe(true);
    expect(again.duplicate).toBe(true);
    // Nothing moved a second time.
    expect(await balanceOf(pool, memberAccount("swapper"), "pair-a")).toBe(40);
    expect(await balanceOf(pool, memberAccount("swapper"), "pair-b")).toBe(20);
  });

  it("ROLLS BOTH LEGS BACK when the second leg cannot be covered", async () => {
    const beforeA = await balanceOf(pool, memberAccount("swapper"), "pair-a");
    const beforeB = await balanceOf(pool, memberAccount("swapper"), "pair-b");
    const [[rowsBefore]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM token_ledger");
    // The treasury holds 80 B; ask for 5000.
    const r = await postTransferPair(pool, [
      { from: memberAccount("swapper"), to: TREASURY, tokenType: "pair-a", amount: 5, source: "exchange_swap", idempotencyKey: "ord:pair-fail:leg1" },
      { from: TREASURY, to: memberAccount("swapper"), tokenType: "pair-b", amount: 5000, source: "exchange_swap", idempotencyKey: "ord:pair-fail:leg2" },
    ]);
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("cannot overdraft");
    // THE POINT: the member was not debited by the leg that DID insert.
    expect(await balanceOf(pool, memberAccount("swapper"), "pair-a")).toBe(beforeA);
    expect(await balanceOf(pool, memberAccount("swapper"), "pair-b")).toBe(beforeB);
    const [[rowsAfter]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM token_ledger");
    expect(Number(rowsAfter.n)).toBe(Number(rowsBefore.n));
    expect((await checkLedgerInvariants(pool)).ok).toBe(true);
  });

  it("refuses allowNegative, duplicate keys within the pair, and invalid legs", async () => {
    const debt = await postTransferPair(pool, [
      { from: memberAccount("swapper"), to: TREASURY, tokenType: "pair-a", amount: 1, source: "exchange_swap", idempotencyKey: "k1", allowNegative: true },
      { from: TREASURY, to: memberAccount("swapper"), tokenType: "pair-b", amount: 1, source: "exchange_swap", idempotencyKey: "k2" },
    ]);
    expect(debt.ok).toBe(false);
    expect(String(debt.error)).toContain("allowNegative is illegal");

    const sameKey = await postTransferPair(pool, [
      { from: memberAccount("swapper"), to: TREASURY, tokenType: "pair-a", amount: 1, source: "exchange_swap", idempotencyKey: "same" },
      { from: TREASURY, to: memberAccount("swapper"), tokenType: "pair-b", amount: 1, source: "exchange_swap", idempotencyKey: "same" },
    ]);
    expect(sameKey.ok).toBe(false);
    expect(String(sameKey.error)).toContain("two distinct keys");

    // Leg validation is the SAME validator single posts use.
    const hypha = await postTransferPair(pool, [
      { from: memberAccount("swapper"), to: TREASURY, tokenType: "pair-dho", amount: 1, source: "exchange_swap", idempotencyKey: "h1" },
      { from: TREASURY, to: memberAccount("swapper"), tokenType: "pair-b", amount: 1, source: "exchange_swap", idempotencyKey: "h2" },
    ]);
    expect(hypha.ok).toBe(false);
    expect(String(hypha.error)).toContain("issued on Hypha");
  });

  it("refuses to guess when only ONE key of a pair already exists", async () => {
    // A key from one order reused in another is a key-shape bug. Under one
    // transaction this state is unreachable, so the primitive refuses rather
    // than completing half a story.
    await expect(
      postTransferPair(pool, [
        { from: memberAccount("swapper"), to: TREASURY, tokenType: "pair-a", amount: 1, source: "exchange_swap", idempotencyKey: "ord:pair-1:leg1" },
        { from: TREASURY, to: memberAccount("swapper"), tokenType: "pair-b", amount: 1, source: "exchange_swap", idempotencyKey: "ord:brand-new:leg2" },
      ]),
    ).rejects.toThrow(/partial idempotency collision/);
  });

  it("serializes concurrent pairs on the treasury without deadlocking", async () => {
    // Treasury holds 80 - 0 = 80 B. Five concurrent swaps of 20 each: four
    // can be covered, the fifth must fail cleanly rather than deadlock.
    await postTransfer(pool, { from: "sys:mint", to: memberAccount("swapper"), tokenType: "pair-a", amount: 100, source: "admin_mint", idempotencyKey: "pair-grant-a2" });
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        postTransferPair(pool, [
          { from: memberAccount("swapper"), to: TREASURY, tokenType: "pair-a", amount: 5, source: "exchange_swap", idempotencyKey: `ord:conc-${i}:leg1` },
          { from: TREASURY, to: memberAccount("swapper"), tokenType: "pair-b", amount: 20, source: "exchange_swap", idempotencyKey: `ord:conc-${i}:leg2` },
        ]).catch((e) => ({ ok: false, duplicate: false, error: String(e.message), balances: {} })),
      ),
    );
    const ok = results.filter((r) => r.ok).length;
    const errors = results.filter((r) => !r.ok).map((r) => String(r.error));
    // Four fit in the treasury's 80; the fifth must refuse CLEANLY — not
    // deadlock, not throw a raw MySQL error at a member.
    expect({ ok, errors }).toEqual({ ok: 4, errors: errors });
    expect(errors.every((e) => e.includes("cannot overdraft"))).toBe(true);
    expect(await balanceOf(pool, TREASURY, "pair-b")).toBe(0);
    expect((await checkLedgerInvariants(pool)).ok).toBe(true);
  });

  it("enforces a caller's limit under the SAME lock that orders the writes", async () => {
    // The bug this exists to prevent: a per-cycle cap read before the
    // transaction is check-then-act. N concurrent requests all read the same
    // pre-swap total, all decide they fit, and all execute — the cap bounds
    // one request instead of the cycle. A guard runs after the accounts are
    // locked, so each concurrent pair sees its committed predecessors.
    await postTransfer(pool, { from: "sys:mint", to: TREASURY, tokenType: "pair-b", amount: 500, source: "exchange_stock", idempotencyKey: "pair-guard-stock" });
    await postTransfer(pool, { from: "sys:mint", to: memberAccount("capped"), tokenType: "pair-a", amount: 500, source: "admin_mint", idempotencyKey: "pair-guard-grant" });

    const LIMIT = 40; // …of pair-b out of the treasury, total, across all six.
    const guard = async (conn: any): Promise<string | null> => {
      const [[row]] = await conn.query(
        "SELECT COALESCE(SUM(amount),0) AS s FROM token_ledger WHERE from_account = ? AND token_type = 'pair-b' AND source = 'capped_swap'",
        [TREASURY],
      );
      return Number(row.s) + 20 > LIMIT ? `allowance spent (${Math.max(0, LIMIT - Number(row.s))} left)` : null;
    };

    const results = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((i) =>
        postTransferPair(
          pool,
          [
            { from: memberAccount("capped"), to: TREASURY, tokenType: "pair-a", amount: 5, source: "capped_swap", idempotencyKey: `ord:cap-${i}:leg1` },
            { from: TREASURY, to: memberAccount("capped"), tokenType: "pair-b", amount: 20, source: "capped_swap", idempotencyKey: `ord:cap-${i}:leg2` },
          ],
          guard,
        ).catch((e) => ({ ok: false, duplicate: false, error: String(e.message), balances: {} })),
      ),
    );

    // Exactly two fit under the limit of 40. Without the guard inside the
    // transaction, all six would have passed a pre-flight check reading 0.
    expect(results.filter((r) => r.ok).length).toBe(2);
    expect(results.filter((r) => !r.ok).every((r) => String(r.error).includes("allowance spent"))).toBe(true);
    // A vetoed pair wrote NOTHING — not one leg, not a partial.
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM token_ledger WHERE source = 'capped_swap'");
    expect(Number(rows[0].n)).toBe(4);
    expect(await balanceOf(pool, memberAccount("capped"), "pair-b")).toBe(40);
    expect((await checkLedgerInvariants(pool)).ok).toBe(true);
  });

  it("narrows a tainted listing on the swap side ONLY, leaving the legal shop open", async () => {
    // Buying a faucet-issued token is legal; swapping one never is. A token
    // listed for both that later becomes tainted must lose the swap listing
    // and keep the sale — closing the shop as well would delist a legal
    // trade silently, at a boot nobody was watching.
    await registerToken(pool, { slug: "shop-swap", name: "Shop Swap", kind: "credit", governance: "platform", transferable: false });
    await pool.query(
      "INSERT INTO token_exchange_settings (token_slug, purchasable, swappable, active) VALUES ('shop-swap', 1, 1, 1) " +
        "ON DUPLICATE KEY UPDATE purchasable = 1, swappable = 1, active = 1",
    );
    // Stocking the treasury is faucet -> treasury, which never taints.
    await postTransfer(pool, { from: "sys:mint", to: TREASURY, tokenType: "shop-swap", amount: 50, source: "exchange_stock", idempotencyKey: "shop-swap-stock" });
    expect(await repairTaintedListings(pool)).toEqual([]);

    // Now a faucet pays a MEMBER — the token is a reward from here on.
    await postTransfer(pool, { from: "sys:mint", to: memberAccount("rewarded"), tokenType: "shop-swap", amount: 5, source: "admin_mint", idempotencyKey: "shop-swap-taint" });
    const repaired = await repairTaintedListings(pool);
    expect(repaired.length).toBe(1);
    expect(repaired[0]).toContain("shop-swap");
    const [[row]] = await pool.query<any[]>("SELECT purchasable, swappable FROM token_exchange_settings WHERE token_slug = 'shop-swap'");
    expect({ purchasable: !!row.purchasable, swappable: !!row.swappable }).toEqual({ purchasable: true, swappable: false });
  });

  it("holds the invariants after all of the above: conservation ≡ 0, no drift, no illegal negatives", async () => {
    const report = await checkLedgerInvariants(pool);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("detects manufactured corruption: cache drift, hypha rows, orphan tokens", async () => {
    // Tamper directly, the way a bug (not postTransfer) would.
    await pool.query("UPDATE token_balances SET balance = balance + 7 WHERE account_id = ? AND token_type = 'gratitude'", [
      memberAccount("usr-1"),
    ]);
    await pool.query(
      "INSERT INTO token_ledger (id, from_account, to_account, token_type, amount, source, idempotency_key) VALUES " +
        "('led-tamper-1', 'sys:treasury', ?, 'equity', 5, 'tamper', 'tamper-hypha-1')",
      [memberAccount("usr-1")],
    );
    const report = await checkLedgerInvariants(pool);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes("drift"))).toBe(true);
    expect(report.problems.some((p) => p.includes("hypha"))).toBe(true);

    // Clean up so this test documents detection without poisoning the schema
    // for anything that runs after it.
    await pool.query("DELETE FROM token_ledger WHERE id = 'led-tamper-1'");
    await pool.query("UPDATE token_balances SET balance = balance - 7 WHERE account_id = ? AND token_type = 'gratitude'", [
      memberAccount("usr-1"),
    ]);
    expect((await checkLedgerInvariants(pool)).ok).toBe(true);
  });

  /**
   * WHAT A CONSENTED QUEST ACTUALLY CREDITED, per claim.
   *
   * The quest card prints `claim.amount`, which is the grant BEFORE a standing
   * badge multiplies it, so the card under-reported every badge holder's
   * payout. `questCreditsFor` reads what moved instead.
   *
   * The trap this pins was found by driving a real consent, not by reading the
   * route: a consent posts TWO rows under `source = 'quest_consent'` with the
   * SAME `source_ref`, the recognition credit and whatever the village's rules
   * mint on a confirmed contribution. Without the token filter the mint
   * overwrote the credit and an 80-point quest reported 10000.
   */
  it("reads a claim's credit from the ledger, per token", async () => {
    const member = memberAccount("credits-reader");
    const claim = "claim-credits-1";

    await postTransfer(pool, {
      from: RECOGNITION_FAUCET,
      to: member,
      amount: 112,
      source: "quest_consent",
      sourceRef: claim,
      description: "Quest consented: a swale (80 x1.4 for a standing badge)",
      idempotencyKey: `quest_consent:${claim}`,
    });

    const before = await questCreditsFor(pool, "credits-reader");
    expect(before.get(claim)).toBe(112);

    // The voice mint the same consent fires: same source, same ref, a
    // different token and a wildly different magnitude.
    await registerToken(pool, {
      slug: "credit-voice",
      name: "Credit Voice",
      kind: "voice",
      governance: "platform",
      transferable: false,
    });
    await postTransfer(pool, {
      from: MINT_FAUCET,
      to: member,
      amount: 10000,
      tokenType: "credit-voice",
      source: "quest_consent",
      sourceRef: claim,
      description: "Confirmed contribution: a swale",
      idempotencyKey: `mint:${claim}`,
    });

    const after = await questCreditsFor(pool, "credits-reader");
    expect(after.get(claim), "the voice mint must not be read as the payout").toBe(112);
    expect(PLATFORM_TOKEN).toBe("gratitude");
  });

  it("omits a claim that never posted, which is what a zero grant looks like", async () => {
    const credits = await questCreditsFor(pool, "credits-reader");
    expect(credits.has("claim-never-posted")).toBe(false);
  });

  it("keeps one member's quest credits out of another's", async () => {
    await postTransfer(pool, {
      from: RECOGNITION_FAUCET,
      to: memberAccount("credits-other"),
      amount: 7,
      source: "quest_consent",
      sourceRef: "claim-other-1",
      idempotencyKey: "quest_consent:claim-other-1",
    });
    const mine = await questCreditsFor(pool, "credits-reader");
    expect(mine.has("claim-other-1")).toBe(false);
    const theirs = await questCreditsFor(pool, "credits-other");
    expect(theirs.get("claim-other-1")).toBe(7);
  });

});

/**
 * THE SENTENCE A MEMBER IS SHOWN WHEN THE LEDGER SAYS NO.
 *
 * `postTransfer` authors an AUDIT sentence and is right to: it names the
 * account by its internal id and the balance in MINOR units, which is what a
 * steward reading a log needs. `/api/wallet/send` handed that string to a
 * member verbatim, so somebody who typed an amount into the send card was
 * shown their own `mem:user-...` id and a balance a thousand times the one the
 * card printed an inch above the box.
 *
 * Needs no database: it is a pure translation, and it is tested pure so a run
 * without TEST_DATABASE_URL still proves it.
 */
describe("a ledger refusal, translated for the person who caused it", () => {
  const ANNA = "mem:user-17885-abcdef";
  const BEN = "mem:user-90210-fedcba";
  const ctx = { accountIds: [ANNA, BEN], holds: "9.999", tokenName: "Village Voice" };

  it("states what the member holds, in the member's own units", () => {
    const said = refusalForMember(
      `insufficient village-voice: "${ANNA}" holds 9999 and cannot overdraft`,
      ctx,
    );
    expect(said).toBe("You hold 9.999 Village Voice, which is not enough to send that");
  });

  it("never leaks an internal account id, whichever side of the send it names", () => {
    for (const acct of [ANNA, BEN]) {
      const said = refusalForMember(`account "${acct}" does not exist`, ctx);
      expect(said).not.toContain(acct);
      expect(said).not.toContain("mem:");
      // And it does not pretend an absent account was an insufficiency, which
      // is a different fact about a different problem.
      expect(said).not.toContain("not enough");
    }
  });

  it("passes through a refusal that is already a sentence for a member", () => {
    // The issuance and veto refusals name a rule, not an account. Swallowing
    // those would replace the only explanation a member gets with nothing.
    expect(refusalForMember("This village has not started issuing yet", ctx))
      .toBe("This village has not started issuing yet");
  });

  it("still says something when the ledger said nothing", () => {
    expect(refusalForMember(undefined, ctx)).toBe("That send did not go through");
    expect(refusalForMember("", ctx)).toBe("That send did not go through");
  });
});
