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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import * as ledgerModule from "./lib/ledger";
import {
  ALLOW_NEGATIVE_SOURCES,
  balanceOf,
  balancesFor,
  checkLedgerInvariants,
  CLAWBACK_SOURCES,
  CYCLE_POOL_FAUCET,
  type DebtProof,
  entriesForMember,
  frozenSet,
  loadTokenRegistry,
  memberAccount,
  MINT_FAUCET,
  PLATFORM_TOKEN,
  postClawbackMirror,
  postClawbackMirrorPair,
  postGraceNightBurn,
  postPaymentReversalLeg,
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
      { from: memberAccount("swapper"), to: TREASURY, tokenType: "pair-a", amount: 1, source: "exchange_swap", idempotencyKey: "k1", allowNegative: {} as unknown as DebtProof },
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

  /*
   * ── W3 adversary findings, closed here ────────────────────────────────────
   *
   * Every case below is one of the four W3 lanes' repros, rewritten to read
   * outcomes rather than return values: balances, ledger rows and the boot
   * invariant report. Each names its finding, quotes what the adversary
   * observed, and asserts the fact that observation was a lie about.
   */

  describe("W3 F12/F13: allowNegative is a capability, not a flag beside a string", () => {
    /** Fund an account through the ordinary primitive, so nothing is raw. */
    const fund = async (member: string, amount: number, key: string) => {
      const r = await postTransfer(pool, {
        from: RECOGNITION_FAUCET, to: memberAccount(member),
        amount, source: "admin_mint", idempotencyKey: key,
      });
      expect(r.ok).toBe(true);
    };

    it("refuses `allowNegative: true`, which used to take an account holding 10 down to -990", async () => {
      // ADVERSARY A1, verbatim: postTransfer with source "reversal",
      // allowNegative true, 1000 out of an account holding 10.
      // Observed then: `A1 ok= true err= undefined balance= -990`.
      await fund("f12-a1", 10, "f12-a1-fund");
      const attack = await postTransfer(pool, {
        from: memberAccount("f12-a1"), to: TREASURY, amount: 1000,
        source: "reversal",
        // The old signature took `true` here. It is a type error now, and the
        // cast is what an attacker (or a JavaScript caller) actually has.
        allowNegative: true as unknown as DebtProof,
        idempotencyKey: "reversal:local:f12-a1",
      });
      expect(attack.ok).toBe(false);
      expect(String(attack.error)).toContain("capability the ledger issues");
      expect(await balanceOf(pool, memberAccount("f12-a1"), PLATFORM_TOKEN)).toBe(10);
    });

    it("refuses a forged proof, and a real proof spent on the wrong source", async () => {
      await fund("f12-forge", 10, "f12-forge-fund");
      const forged = await postTransfer(pool, {
        from: memberAccount("f12-forge"), to: TREASURY, amount: 1000,
        source: "reversal",
        allowNegative: { reason: "reversal" } as unknown as DebtProof,
        idempotencyKey: "reversal:local:f12-forge",
      });
      // Shape is not the gate. Identity is: this object is not one of the three.
      expect(forged.ok).toBe(false);
      expect(String(forged.error)).toContain("capability the ledger issues");

      // The other half of this test used to spend a REAL `CLAWBACK_DEBT` on
      // source "stay_night" and read back "licenses source". It cannot be
      // written any more, and that is the improvement: the three proofs are
      // module-private, so no test and no module can hold one to mis-spend.
      // The proof/source agreement check stays in `validateLeg` as defence in
      // depth; what proves it now is that the names do not leave the module,
      // which `the debt capability never leaves the ledger` asserts below.
      const stillForged = await postTransfer(pool, {
        from: memberAccount("f12-forge"), to: TREASURY, amount: 1000,
        source: "stay_night", allowNegative: { reason: "stay_night" } as unknown as DebtProof,
        idempotencyKey: "f12-forge-mismatch",
      });
      expect(stillForged.ok).toBe(false);
      expect(String(stillForged.error)).toContain("capability the ledger issues");
      expect(await balanceOf(pool, memberAccount("f12-forge"), PLATFORM_TOKEN)).toBe(10);
    });

    it("keeps source `reversal` inside the mirror namespace, both ways", async () => {
      await fund("f12-ns", 10, "f12-ns-fund");
      // ADVERSARY B6: all three keystone sources let an arbitrary caller
      // create debt. `reversal` cannot be spelled outside reverse() now,
      // because a mirror is keyed `reversal:<village>:<original>`.
      const loose = await postTransfer(pool, {
        from: memberAccount("f12-ns"), to: TREASURY, amount: 5,
        source: "reversal", allowNegative: { reason: "reversal" } as unknown as DebtProof,
        idempotencyKey: "f12-ns-not-a-mirror",
      });
      expect(loose.ok).toBe(false);
      expect(String(loose.error)).toContain("reserved for the mirror reverse() derives");

      // And the other direction: the namespace does not accept a squatter.
      const squat = await postTransfer(pool, {
        from: RECOGNITION_FAUCET, to: memberAccount("f12-ns"), amount: 1,
        source: "quest_consent", idempotencyKey: "reversal:local:f12-ns-squat",
      });
      expect(squat.ok).toBe(false);
      expect(String(squat.error)).toContain("only reverse() may write");
      expect(await balanceOf(pool, memberAccount("f12-ns"), PLATFORM_TOKEN)).toBe(10);
    });

    it("refuses every near-miss spelling of a keystone source, which used to tag an account for free", async () => {
      // ADVERSARY B2/A7. "REVERSAL" was postable with NO flag at all,
      // because the JS gate is byte-exact and never saw it, and it then
      // exempted the account from invariant 5 because the SQL gate's
      // collation could not tell it from `reversal`. Observed:
      // {"reversal ":0, "REVERSAL":0, "ReVeRsAl":0} where 0 means an illegal
      // negative went UNREPORTED.
      await fund("f13-variants", 10, "f13-variants-fund");
      const variants = ["REVERSAL", "reversal ", " reversal", "ReVeRsAl", "reversal\t", "Stay_Night", "PAYMENT_REVERSAL"];
      for (const variant of variants) {
        const r = await postTransfer(pool, {
          from: memberAccount("f13-variants"), to: TREASURY, amount: 1,
          source: variant, idempotencyKey: `f13-variant:${JSON.stringify(variant)}`,
        });
        expect([variant, r.ok]).toEqual([variant, false]);
        expect(String(r.error)).toContain("differs only in case or whitespace");
      }
      expect(await balanceOf(pool, memberAccount("f13-variants"), PLATFORM_TOKEN)).toBe(10);
    });

    it("reads the SQL half of the gate byte-exactly, so a `REVERSAL` row buys no exemption", async () => {
      // The variants are refused at the write now, so the only way this row
      // exists is a legacy one or a hand insert. Manufacture it the way the
      // adversary did and check the boot report, which is the surface that
      // was blind.
      const account = memberAccount("f13-sql");
      await pool.query(
        "INSERT IGNORE INTO ledger_accounts (id, kind, user_id, label, faucet) VALUES (?,?,?,?,0)",
        [account, "member", "f13-sql", "f13-sql"],
      );
      await pool.query(
        "INSERT INTO token_ledger (id, from_account, to_account, token_type, amount, source, idempotency_key) VALUES " +
          "('led-f13-tag', ?, ?, ?, 1, 'REVERSAL', 'f13-sql-tag')," +
          "('led-f13-hole', ?, ?, ?, 500, 'quest_consent', 'f13-sql-hole')",
        [account, TREASURY, PLATFORM_TOKEN, account, TREASURY, PLATFORM_TOKEN],
      );
      await pool.query(
        "INSERT INTO token_balances (account_id, token_type, balance) VALUES (?,?,-501) " +
          "ON DUPLICATE KEY UPDATE balance = balance - 501",
        [account, PLATFORM_TOKEN],
      );
      await pool.query(
        "INSERT INTO token_balances (account_id, token_type, balance) VALUES (?,?,501) " +
          "ON DUPLICATE KEY UPDATE balance = balance + 501",
        [TREASURY, PLATFORM_TOKEN],
      );

      const report = await checkLedgerInvariants(pool);
      const mine = report.problems.filter((p) => p.includes(account));
      expect(mine.length).toBe(1);
      expect(mine[0]).toContain("is negative: -501");
      // The `REVERSAL` row counts for nothing, so the whole -501 is unlawful.
      expect(mine[0]).toContain("only 0 of that is lawful");

      await pool.query("DELETE FROM token_ledger WHERE id IN ('led-f13-tag','led-f13-hole')");
      await pool.query("UPDATE token_balances SET balance = balance + 501 WHERE account_id = ? AND token_type = ?", [account, PLATFORM_TOKEN]);
      await pool.query("UPDATE token_balances SET balance = balance - 501 WHERE account_id = ? AND token_type = ?", [TREASURY, PLATFORM_TOKEN]);
      expect((await checkLedgerInvariants(pool)).ok).toBe(true);
    });
  });

  describe("W3 F14: the keystone set is frozen for real, not by its type", () => {
    it("throws on .add, .delete and .clear, and on the borrowed-method form", () => {
      // ADVERSARY A9: `(ALLOW_NEGATIVE_SOURCES as Set<string>).add("spend")`
      // then a post with source "spend" and allowNegative. Observed:
      // `A9 before ok= false insufficient gratitude | after add() ok= true |
      //  balance= -490`, and `A9 negatives while mutated: []`.
      const before = Array.from(ALLOW_NEGATIVE_SOURCES).sort();
      const live = ALLOW_NEGATIVE_SOURCES as Set<string>;
      expect(() => live.add("spend")).toThrow(/frozen/);
      expect(() => live.delete("reversal")).toThrow(/frozen/);
      expect(() => live.clear()).toThrow(/frozen/);
      // A subclass would leave this one working. A Proxy has no [[SetData]].
      expect(() => Set.prototype.add.call(live, "spend")).toThrow(TypeError);
      expect(Array.from(ALLOW_NEGATIVE_SOURCES).sort()).toEqual(before);
      expect(ALLOW_NEGATIVE_SOURCES.has("spend")).toBe(false);
      expect(ALLOW_NEGATIVE_SOURCES.size).toBe(3);
    });

    it("still reads as a Set everywhere the ledger uses one", () => {
      expect(ALLOW_NEGATIVE_SOURCES instanceof Set).toBe(true);
      expect(ALLOW_NEGATIVE_SOURCES.has("reversal")).toBe(true);
      expect(ALLOW_NEGATIVE_SOURCES.has("REVERSAL")).toBe(false);
      let counted = 0;
      ALLOW_NEGATIVE_SOURCES.forEach(() => { counted += 1; });
      expect(counted).toBe(3);
      expect([...ALLOW_NEGATIVE_SOURCES].sort()).toEqual(["payment_reversal", "reversal", "stay_night"]);
    });

    it("leaves the debt gate exactly where it was after the mutation attempt", async () => {
      try { (ALLOW_NEGATIVE_SOURCES as Set<string>).add("spend"); } catch { /* the point */ }
      await postTransfer(pool, {
        from: RECOGNITION_FAUCET, to: memberAccount("f14-gate"), amount: 10,
        source: "admin_mint", idempotencyKey: "f14-gate-fund",
      });
      const r = await postTransfer(pool, {
        from: memberAccount("f14-gate"), to: TREASURY, amount: 500,
        source: "spend", allowNegative: { reason: "spend" } as unknown as DebtProof, idempotencyKey: "f14-gate-attack",
      });
      expect(r.ok).toBe(false);
      expect(await balanceOf(pool, memberAccount("f14-gate"), PLATFORM_TOKEN)).toBe(10);
    });
  });

  describe("W3 F17/F24: a collation collision is refused, never called a duplicate", () => {
    it("refuses a second occurrence whose key differs only by case", async () => {
      // ADVERSARY A1 (keys lane): mint `...usr-aB1` then `...usr-Ab1`.
      // Observed: `first {"ok":true,"duplicate":false,"balance":7} second
      // {"ok":true,"duplicate":true,"balance":7}` and ONE row for both keys.
      // The second member was silently not paid while mint reported ok.
      const first = await postTransfer(pool, {
        from: RECOGNITION_FAUCET, to: memberAccount("collide-one"), amount: 7,
        source: "quest_consent", idempotencyKey: "quest.completed:local:q:c:usr-aB1",
      });
      expect(first.ok && !first.duplicate).toBe(true);
      const second = await postTransfer(pool, {
        from: RECOGNITION_FAUCET, to: memberAccount("collide-two"), amount: 7,
        source: "quest_consent", idempotencyKey: "quest.completed:local:q:c:usr-Ab1",
      });
      expect(second.ok).toBe(false);
      expect(second.duplicate).toBe(false);
      expect(String(second.error)).toContain("collides with the already-posted key");
      // Nobody was quietly told they had been paid.
      expect(await balanceOf(pool, memberAccount("collide-two"), PLATFORM_TOKEN)).toBe(0);
      expect(await balanceOf(pool, memberAccount("collide-one"), PLATFORM_TOKEN)).toBe(7);
    });

    it("refuses a trailing-space variant, and still replays the exact key as a duplicate", async () => {
      // ADVERSARY A2: `bare {...balance:3} padded {"duplicate":true,...}`
      // under the PAD SPACE half of the local collation.
      await postTransfer(pool, {
        from: RECOGNITION_FAUCET, to: memberAccount("pad-one"), amount: 3,
        source: "quest_consent", idempotencyKey: "quest.completed:local:pad:c:u",
      });
      const padded = await postTransfer(pool, {
        from: RECOGNITION_FAUCET, to: memberAccount("pad-two"), amount: 3,
        source: "quest_consent", idempotencyKey: "quest.completed:local:pad:c:u ",
      });
      // A NO PAD collation (mysql:8's utf8mb4_0900_ai_ci) lets this through as
      // a second row, which is also correct: two keys, two occurrences, two
      // payments. What must never happen is two occurrences reported as one.
      if (!padded.ok) {
        expect(String(padded.error)).toContain("collides with the already-posted key");
        expect(await balanceOf(pool, memberAccount("pad-two"), PLATFORM_TOKEN)).toBe(0);
      } else {
        expect(padded.duplicate).toBe(false);
        expect(await balanceOf(pool, memberAccount("pad-two"), PLATFORM_TOKEN)).toBe(3);
      }
      const replay = await postTransfer(pool, {
        from: RECOGNITION_FAUCET, to: memberAccount("pad-one"), amount: 3,
        source: "quest_consent", idempotencyKey: "quest.completed:local:pad:c:u",
      });
      expect(replay.ok && replay.duplicate).toBe(true);
      expect(await balanceOf(pool, memberAccount("pad-one"), PLATFORM_TOKEN)).toBe(3);
    });
  });

  describe("W3 F5: invariant 5 is bounded by what the allow-negative legs took", () => {
    /**
     * The account's cache and the ledger have to agree or invariant 4 fires
     * instead of invariant 5, so these build the illegal negative the way the
     * adversary did (a posting that skipped `postTransfer`) and then move both
     * sides by hand.
     */
    const manufacture = async (
      member: string,
      rows: Array<{ id: string; amount: number; source: string; key: string }>,
    ) => {
      const account = memberAccount(member);
      await pool.query(
        "INSERT IGNORE INTO ledger_accounts (id, kind, user_id, label, faucet) VALUES (?,?,?,?,0)",
        [account, "member", member, member],
      );
      let total = 0;
      for (const r of rows) {
        await pool.query(
          "INSERT INTO token_ledger (id, from_account, to_account, token_type, amount, source, idempotency_key) VALUES (?,?,?,?,?,?,?)",
          [r.id, account, TREASURY, PLATFORM_TOKEN, r.amount, r.source, r.key],
        );
        total += r.amount;
      }
      for (const [acct, delta] of [[account, -total], [TREASURY, total]] as Array<[string, number]>) {
        await pool.query(
          "INSERT INTO token_balances (account_id, token_type, balance) VALUES (?,?,?) " +
            "ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)",
          [acct, PLATFORM_TOKEN, delta],
        );
      }
      return account;
    };
    const unmanufacture = async (account: string, ids: string[], total: number) => {
      await pool.query(`DELETE FROM token_ledger WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
      await pool.query("UPDATE token_balances SET balance = balance + ? WHERE account_id = ? AND token_type = ?", [total, account, PLATFORM_TOKEN]);
      await pool.query("UPDATE token_balances SET balance = balance - ? WHERE account_id = ? AND token_type = ?", [total, TREASURY, PLATFORM_TOKEN]);
    };

    it("reports a -99925 balance that one lawful 25 clawback used to excuse forever", async () => {
      // ADVERSARY B4. Observed then: `B4 balance= -99925 | negatives: []`.
      // The exemption was an EXISTENCE test, so a single reversal debit put
      // the account outside invariant 5 for that token permanently.
      const rows = [
        { id: "led-b4-lawful", amount: 25, source: "reversal", key: "reversal:local:b4-original" },
        { id: "led-b4-hole", amount: 99900, source: "quest_consent", key: "b4-hole" },
      ];
      const account = await manufacture("b4-member", rows);
      const report = await checkLedgerInvariants(pool);
      const mine = report.problems.filter((p) => p.includes(account));
      expect(mine.length).toBe(1);
      expect(mine[0]).toContain("is negative: -99925");
      expect(mine[0]).toContain("only -25 of that is lawful");
      await unmanufacture(account, rows.map((r) => r.id), 99925);
    });

    it("still passes a genuine -25 after a clawback of a spent 25", async () => {
      // The lawful shape the bound must not break: the member owes exactly
      // what the clawback took, and the village still boots.
      const rows = [{ id: "led-b3-lawful", amount: 25, source: "reversal", key: "reversal:local:b3-original" }];
      const account = await manufacture("b3-member", rows);
      const report = await checkLedgerInvariants(pool);
      expect(report.problems.filter((p) => p.includes(account))).toEqual([]);
      await unmanufacture(account, ["led-b3-lawful"], 25);
    });

    it("cannot be laundered clean by a 1-unit clawback posted after the fact", async () => {
      // ADVERSARY C1. Observed then:
      //   C1 before, balance= -4900 negatives: ["non-faucet account mem:c1 ..."]
      //   C1 launder post ok= true
      //   C1 after,  balance= -4901 negatives: []
      // One minor unit silenced a standing boot failure that predated it.
      const account = await manufacture("c1-member", [
        { id: "led-c1-hole", amount: 4900, source: "quest_consent", key: "c1-hole" },
      ]);
      const before = (await checkLedgerInvariants(pool)).problems.filter((p) => p.includes(account));
      expect(before.length).toBe(1);

      await manufacture("c1-member", [
        { id: "led-c1-launder", amount: 1, source: "reversal", key: "reversal:local:c1-launder" },
      ]);
      const after = (await checkLedgerInvariants(pool)).problems.filter((p) => p.includes(account));
      expect(after.length).toBe(1);
      expect(after[0]).toContain("is negative: -4901");
      expect(after[0]).toContain("only -1 of that is lawful");
      await unmanufacture(account, ["led-c1-hole", "led-c1-launder"], 4901);
    });

    it("does not let one token's clawback excuse another token's debt", async () => {
      // ADVERSARY B1/A8 held on the old code and must keep holding: the bound
      // is per (account, token), not per account.
      const account = memberAccount("b1-member");
      await pool.query(
        "INSERT IGNORE INTO ledger_accounts (id, kind, user_id, label, faucet) VALUES (?,?,?,?,0)",
        [account, "member", "b1-member", "b1-member"],
      );
      await registerToken(pool, { slug: "b1-other", name: "B1 Other", kind: "credit", governance: "platform", transferable: false });
      await pool.query(
        "INSERT INTO token_ledger (id, from_account, to_account, token_type, amount, source, idempotency_key) VALUES " +
          "('led-b1-lawful', ?, ?, ?, 50, 'reversal', 'reversal:local:b1-original')," +
          "('led-b1-other', ?, ?, 'b1-other', 5, 'quest_consent', 'b1-other-hole')",
        [account, TREASURY, PLATFORM_TOKEN, account, TREASURY],
      );
      const moves: Array<[string, string, number]> = [
        [account, PLATFORM_TOKEN, -50], [TREASURY, PLATFORM_TOKEN, 50],
        [account, "b1-other", -5], [TREASURY, "b1-other", 5],
      ];
      for (const [acct, token, delta] of moves) {
        await pool.query(
          "INSERT INTO token_balances (account_id, token_type, balance) VALUES (?,?,?) " +
            "ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)",
          [acct, token, delta],
        );
      }
      const mine = (await checkLedgerInvariants(pool)).problems.filter((p) => p.includes(account));
      expect(mine.length).toBe(1);
      expect(mine[0]).toContain("b1-other");
      await pool.query("DELETE FROM token_ledger WHERE id IN ('led-b1-lawful','led-b1-other')");
      await pool.query("UPDATE token_balances SET balance = balance + 50 WHERE account_id = ? AND token_type = ?", [account, PLATFORM_TOKEN]);
      await pool.query("UPDATE token_balances SET balance = balance - 50 WHERE account_id = ? AND token_type = ?", [TREASURY, PLATFORM_TOKEN]);
      await pool.query("UPDATE token_balances SET balance = balance + 5 WHERE account_id = ? AND token_type = 'b1-other'", [account]);
      await pool.query("UPDATE token_balances SET balance = balance - 5 WHERE account_id = ? AND token_type = 'b1-other'", [TREASURY]);
      expect((await checkLedgerInvariants(pool)).ok).toBe(true);
    });
  });

  describe("W4: the three narrow doors, and the law behind the clawback one", () => {
    /*
     * The debt proofs used to be `export const`, so the set of modules that
     * could create member debt was every module willing to type an import. A
     * closing proof imported all three into a test module and took one
     * account to -990, -990 and -777 through the ordinary public primitive,
     * with `checkLedgerInvariants` reporting NOTHING each time: the debit's
     * own source is allow-negative, so it raises the account's lawful bound
     * by exactly what it just took.
     *
     * The proofs are module-private now and these three functions are what
     * left the module instead. Each supplies its own proof and pins the
     * source that proof licenses, so the capability is never a value anybody
     * holds.
     */
    const DOOR = "l8-door";

    beforeAll(async () => {
      await registerToken(pool, { slug: DOOR, name: "Door Credit", kind: "credit", governance: "platform", transferable: false });
    });

    const fundDoor = async (member: string, amount: number, key: string): Promise<void> => {
      const r = await postTransfer(pool, {
        from: MINT_FAUCET, to: memberAccount(member), tokenType: DOOR,
        amount, source: "admin_mint", idempotencyKey: key,
      });
      expect(r.ok).toBe(true);
    };

    it("burns a grace night into debt, and the debt is lawful at boot", async () => {
      await fundDoor("l8-gn", 10, "l8-gn-fund");
      const burn = await postGraceNightBurn(pool, {
        from: memberAccount("l8-gn"), to: TREASURY, tokenType: DOOR, amount: 25,
        sourceRef: "stay-l8", description: "Night of 2026-09-03",
        idempotencyKey: "stay:stay-l8:night:2026-09-03",
      });
      expect(burn.ok).toBe(true);
      expect(await balanceOf(pool, memberAccount("l8-gn"), DOOR)).toBe(-15);
      const report = await checkLedgerInvariants(pool);
      expect(report.problems.filter((p) => p.includes(memberAccount("l8-gn")))).toEqual([]);
    });

    it("posts a payment reversal leg into debt, and the debt is lawful at boot", async () => {
      await fundDoor("l8-pv", 5, "l8-pv-fund");
      const claw = await postPaymentReversalLeg(pool, {
        from: memberAccount("l8-pv"), to: TREASURY, tokenType: DOOR, amount: 20,
        sourceRef: "ord-l8pv", description: "Refund: tokens returned to stock",
        idempotencyKey: "ord:ord-l8pv:reversal-leg1",
      });
      expect(claw.ok).toBe(true);
      expect(await balanceOf(pool, memberAccount("l8-pv"), DOOR)).toBe(-15);
      const report = await checkLedgerInvariants(pool);
      expect(report.problems.filter((p) => p.includes(memberAccount("l8-pv")))).toEqual([]);
    });

    it("mirrors a posting through the clawback door, into debt, lawfully", async () => {
      const payer = memberAccount("l8-cb");
      const spent = memberAccount("l8-cb-sink");
      const original = await postTransfer(pool, {
        from: MINT_FAUCET, to: payer, tokenType: DOOR, amount: 25,
        source: "quest_consent", idempotencyKey: "l8-cb-original",
      });
      expect(original.ok).toBe(true);
      // Spent onward, which is the case where the clawback has to be able to
      // finish and the negative balance is the truthful state.
      await postTransfer(pool, {
        from: payer, to: spent, tokenType: DOOR, amount: 25,
        source: "member_send", idempotencyKey: "l8-cb-spent",
      });
      const mirror = await postClawbackMirror(pool, {
        from: payer, to: MINT_FAUCET, tokenType: DOOR, amount: 25,
        sourceRef: "l8-cb-original", description: "l8-cb-original",
        idempotencyKey: "reversal:local:l8-cb-original",
      });
      expect(mirror.ok).toBe(true);
      expect(await balanceOf(pool, payer, DOOR)).toBe(-25);
      const report = await checkLedgerInvariants(pool);
      expect(report.problems.filter((p) => p.includes(payer))).toEqual([]);
    });

    it("refuses an invented mirror even through the narrow door, because the law is behind it", async () => {
      // Holding the door buys nothing on its own: the law derives the row
      // from the posting the key names, so a caller who invents a number
      // gets the same refusal a caller of plain postTransfer would.
      await fundDoor("l8-inv", 40, "l8-inv-fund");
      const inflated = await postClawbackMirror(pool, {
        from: memberAccount("l8-inv"), to: MINT_FAUCET, tokenType: DOOR, amount: 1000,
        idempotencyKey: "reversal:local:l8-cb-original",
      });
      expect(inflated.ok).toBe(false);
      expect(String(inflated.error)).toContain("does not mirror");

      const ghost = await postClawbackMirror(pool, {
        from: memberAccount("l8-inv"), to: MINT_FAUCET, tokenType: DOOR, amount: 5,
        idempotencyKey: "reversal:local:l8-never-happened",
      });
      expect(ghost.ok).toBe(false);
      expect(String(ghost.error)).toContain("to reverse");
      expect(await balanceOf(pool, memberAccount("l8-inv"), DOOR)).toBe(40);
    });

    it("undoes both legs of a pair through the pair door, and neither alone", async () => {
      const u = memberAccount("l8-pair");
      await fundDoor("l8-pair", 100, "l8-pair-fund");
      await postTransfer(pool, { from: MINT_FAUCET, to: TREASURY, tokenType: PLATFORM_TOKEN, amount: 500, source: "exchange_stock", idempotencyKey: "l8-pair-stock" });
      const swap = await postTransferPair(pool, [
        { from: u, to: TREASURY, tokenType: DOOR, amount: 100, source: "exchange_swap", sourceRef: "ord-l8p", idempotencyKey: "ord:ord-l8p:leg1" },
        { from: TREASURY, to: u, tokenType: PLATFORM_TOKEN, amount: 40, source: "exchange_swap", sourceRef: "ord-l8p", idempotencyKey: "ord:ord-l8p:leg2" },
      ]);
      expect(swap.ok).toBe(true);

      // One leg alone, through the door that carries no proof at all: still
      // refused, and the refusal names the sibling.
      const half = await postClawbackMirror(pool, {
        from: u, to: TREASURY, tokenType: PLATFORM_TOKEN, amount: 40,
        idempotencyKey: "reversal:local:ord:ord-l8p:leg2",
      });
      expect(half.ok).toBe(false);
      expect(String(half.error)).toContain("ord:ord-l8p:leg1");

      const both = await postClawbackMirrorPair(pool, [
        { from: TREASURY, to: u, tokenType: DOOR, amount: 100, idempotencyKey: "reversal:local:ord:ord-l8p:leg1" },
        { from: u, to: TREASURY, tokenType: PLATFORM_TOKEN, amount: 40, idempotencyKey: "reversal:local:ord:ord-l8p:leg2" },
      ]);
      expect(both.ok).toBe(true);
      expect(await balanceOf(pool, u, DOOR)).toBe(100);
      expect(await balanceOf(pool, u, PLATFORM_TOKEN)).toBe(0);
    });

    it("still reports a report after a prototype swap on the keystone set is refused", async () => {
      // The other half of the prototype finding: an emptied set made
      // `IN (?)` expand to `IN ()`, which MySQL will not parse, so the boot
      // check THREW where it was meant to report. The trap stops the set
      // being emptied and the placeholder list stops the empty case being
      // expressible; this asks the check itself, against a real database.
      expect(() => Object.setPrototypeOf(ALLOW_NEGATIVE_SOURCES as object, { has: () => true })).toThrow();
      expect(Array.from(ALLOW_NEGATIVE_SOURCES)).toHaveLength(3);
      const report = await checkLedgerInvariants(pool);
      expect(Array.isArray(report.problems)).toBe(true);
    });
  });

});

/**
 * THE DEBT CAPABILITY NEVER LEAVES THE LEDGER, held by a walk instead of by a
 * paragraph.
 *
 * This needs no database and is deliberately outside the skip above: the
 * property it defends is about the module graph, and a machine with no
 * `TEST_DATABASE_URL` can still tell the truth about it. It follows the same
 * shape `server/dryRun.test.ts` uses to pin its own isolation, and it asks
 * two independent questions, because either one alone can be satisfied while
 * the property is false:
 *
 *  - the RUNTIME namespace of `server/lib/ledger.ts` carries no `_DEBT` name,
 *    which is the exact measurement a closing proof made when it printed
 *    `_DEBT names on ledger module ["GRACE_NIGHT_DEBT", ...]` and then
 *    borrowed all three;
 *  - no module under `server/` NAMES one in an import clause, which is the
 *    call-graph question rather than a substring question: a comment saying
 *    `CLAWBACK_DEBT` is documentation, and an import of it is a capability.
 */
describe("the debt capability never leaves the ledger", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const LEDGER = path.join(HERE, "lib", "ledger.ts");
  const PROOF_NAMES = ["GRACE_NIGHT_DEBT", "PAYMENT_REVERSAL_DEBT", "CLAWBACK_DEBT"];

  const tsFilesUnder = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        out.push(...tsFilesUnder(full));
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        out.push(full);
      }
    }
    return out;
  };

  /** The names a file imports, from every `import { ... } from "..."` clause. */
  const importedNames = (src: string): string[] => {
    const names: string[] = [];
    for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
      for (const raw of m[1].split(",")) {
        const cleaned = raw.replace(/\btype\b/, "").trim().split(/\s+as\s+/)[0].trim();
        if (cleaned) names.push(cleaned);
      }
    }
    return names;
  };

  it("exports none of the three proofs, at runtime", () => {
    const exported = Object.keys(ledgerModule).filter((k) => k.endsWith("_DEBT"));
    expect(exported).toEqual([]);
    for (const name of PROOF_NAMES) {
      expect((ledgerModule as Record<string, unknown>)[name]).toBeUndefined();
    }
  });

  it("declares them module-private in the source, and exports the narrow doors instead", () => {
    const source = fs.readFileSync(LEDGER, "utf8");
    expect(source.length).toBeGreaterThan(1000);
    expect(source).not.toMatch(/export\s+const\s+\w*_DEBT\b/);
    for (const name of PROOF_NAMES) {
      expect(source).toMatch(new RegExp(`^const ${name}: DebtProof = issueDebtProof\\(`, "m"));
    }
    for (const door of ["postGraceNightBurn", "postPaymentReversalLeg", "postClawbackMirror"]) {
      expect(source).toMatch(new RegExp(`export async function ${door}\\(`));
    }
  });

  it("is imported by nobody under server/", () => {
    const files = tsFilesUnder(HERE).filter((f) => path.resolve(f) !== path.resolve(LEDGER));
    expect(files.length).toBeGreaterThan(50);
    const borrowers: string[] = [];
    for (const file of files) {
      const names = importedNames(fs.readFileSync(file, "utf8"));
      if (names.some((n) => PROOF_NAMES.includes(n))) borrowers.push(path.relative(HERE, file));
    }
    expect(borrowers).toEqual([]);
  });
});

/**
 * The frozen set's last hole, closed. No database: this is about one object.
 */
describe("a frozen set keeps its prototype too", () => {
  it("refuses a prototype swap that used to make `has` answer anything", () => {
    // PROOF FS: `Object.setPrototypeOf -> SUCCEEDED: has("zzz")=true
    // Array.from=[]`, and on the keystone itself `has(spend) = true |
    // Array.from = [] | size = undefined`. One line widened the allow-negative
    // gate to every source there is and emptied the list the boot check builds
    // its `IN (...)` from.
    const set = frozenSet(["a", "b"]);
    expect(() => Object.setPrototypeOf(set as object, { has: () => true })).toThrow(/frozen/);
    expect(set.has("zzz")).toBe(false);
    expect(Array.from(set)).toEqual(["a", "b"]);
    expect(set.size).toBe(2);
  });

  it("keeps the two keystone sets intact through the attempt", () => {
    expect(() => Object.setPrototypeOf(ALLOW_NEGATIVE_SOURCES as object, { has: () => true })).toThrow(/frozen/);
    expect(() => Object.setPrototypeOf(CLAWBACK_SOURCES as object, { has: () => true })).toThrow(/frozen/);
    expect(ALLOW_NEGATIVE_SOURCES.has("spend")).toBe(false);
    expect(ALLOW_NEGATIVE_SOURCES.has("reversal")).toBe(true);
    expect([...ALLOW_NEGATIVE_SOURCES].sort()).toEqual(["payment_reversal", "reversal", "stay_night"]);
    expect([...CLAWBACK_SOURCES].sort()).toEqual(["payment_reversal", "reversal"]);
    expect(ALLOW_NEGATIVE_SOURCES.size).toBe(3);
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
