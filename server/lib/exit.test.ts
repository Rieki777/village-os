/**
 * The exit sweep, and the units it moves.
 *
 * WHY THIS FILE EXISTS. `sweepBalances` is the call site that proves the
 * decimals conversion cannot live inside `postTransfer`. It reads a member's
 * balances out of `token_balances` (which is a SUM over `token_ledger.amount`,
 * so already MINOR units) and posts them back unchanged. Wrapping that amount
 * in `toLedgerUnits` multiplies a departing member's whole settlement by the
 * token's scale: a thousandfold for Village Voice today, ten thousandfold for
 * every token once the 4-decimals ruling lands.
 *
 * The module had no unit test at all before this one. `exitPolicy.test.ts` is a
 * different module and imports nothing from here, and the only coverage was one
 * `loop.e2e.test.ts` block whose assertions read a decimals-0 token, where a
 * human number and a minor unit are the same number, so they are satisfied by
 * the right answer and by the 10,000x wrong one alike.
 *
 * HOW IT IS SHAPED SO THE WRONG FIX CANNOT GREEN IT. Every sweep case asserts
 * BOTH halves of the boundary in the same test:
 *
 *   - the exact MINOR integer that reached `token_ledger.amount`, and
 *   - the HUMAN number `sweepBalances` returned for it.
 *
 * Asserting only the first is satisfied by a build that reports minor units to
 * an admin. Asserting only the second is satisfied by a build that converts at
 * the posting and divides it back on the way out, which moves the wrong money
 * and prints the right number. Both together pin the boundary in one place.
 * Measured: with the amount wrapped in `toLedgerUnits`, three cases go red and
 * the sweep refuses outright on the overdraft check; with the three outbound
 * conversions removed, five cases go red on the human half while every minor
 * assertion stays green.
 *
 * WHERE TODAY'S SCALE IS ALLOWED TO LIVE. In exactly one case, the first one,
 * which says what the registry currently reports and is labelled as such. Every
 * other assertion is written against `MINOR` and against `fromLedgerUnits`, so
 * the day the registry moves to 4 decimals this file keeps testing the same
 * thing and only that one case has to be re-read. A test that hardcodes a scale
 * goes red on the day the scale legitimately changes, which teaches whoever is
 * flipping it that the code is wrong when the test is merely stale.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied, unique per provision. No TEST_DATABASE_URL and it skips loudly.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { ensureVoiceToken, fromLedgerUnits, toLedgerUnits, VILLAGE_VOICE } from "./economy";
import {
  balanceOf,
  checkLedgerInvariants,
  loadTokenRegistry,
  memberAccount,
  MINT_FAUCET,
  postGraceNightBurn,
  postTransfer,
  registerToken,
} from "./ledger";
import { blockingStates, createExit, EXIT_SETTLEMENT, exitOpenState, sweepBalances } from "./exit";

const configured = testDbConfigured();

/**
 * Registered by 0007, and PINNED to 0 in the setup below.
 *
 * It used to inherit 0 from the registry default, and `0184` ended that: credits
 * are currency-like and now carry two places. The pin is what keeps the three
 * tokens here at three DISTINCT scales, which is the property the last
 * assertion in the scale case depends on. Left to inherit, credits and Voice
 * would both read 2 and that assertion would be measuring two scales while
 * claiming three.
 */
const WHOLE = "credits";
/** Registered by `ensureVoiceToken`, `decimals` 2 since the 2026-09-04 ruling. */
const VOICE = VILLAGE_VOICE;
/**
 * A token at a scale no token ships at, registered here so this file proves the
 * sweep at a third scale. At decimals 0 a conversion bug is invisible, because a
 * human number and a minor unit are the same number; this token is what makes
 * the wrong fix show up as a factor of ten thousand instead of not at all.
 */
const FINE = "exit-sweep-fine";

const TOKENS = [WHOLE, VOICE, FINE] as const;

/**
 * The minor amount every case seeds, in every token.
 *
 * It is seeded as MINOR units on purpose, through `postTransfer`, because that
 * is exactly the shape `sweepBalances` reads back out of the balance cache. The
 * fixture and the thing under test agree about units by construction rather
 * than through a conversion this file performs, so a wrong conversion in the
 * code cannot be cancelled out by a matching one in the test.
 *
 * The same integer in all three tokens is what makes the human readings differ:
 * one number moving, three sentences about it.
 */
const MINOR = 12_345;

describe.skipIf(!configured)("what a departing member's balance is worth, and in which units", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let seq = 0;

  const member = async (id: string): Promise<string> => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'h')",
      [id, id, `${id}@example.test`],
    );
    return id;
  };

  /** Put a known number of MINOR units in somebody's hands. */
  const give = async (userId: string, token: string, units: number): Promise<void> => {
    const r = await postTransfer(pool, {
      from: MINT_FAUCET,
      to: memberAccount(userId),
      tokenType: token,
      amount: units,
      source: "test_seed",
      idempotencyKey: `exit-test:${userId}:${token}:${++seq}`,
    });
    if (!r.ok) throw new Error(`could not seed ${token}: ${r.error}`);
  };

  /**
   * Drive a balance below zero the only lawful way: a keystone source with
   * the capability the ledger issues for it. A debt has to be REAL
   * for this file's negative cases to mean anything, and a hand-written
   * `token_balances` row would be a cache the ledger disagrees with, which the
   * boot invariant would then report as drift instead of as a debt.
   */
  const owe = async (userId: string, token: string, units: number): Promise<void> => {
    // The debt proof is module-private now: `postGraceNightBurn` is the one
    // door that carries it, and it pins the source it licenses.
    const r = await postGraceNightBurn(pool, {
      from: memberAccount(userId),
      to: "sys:treasury",
      tokenType: token,
      amount: units,
      idempotencyKey: `exit-test-debt:${userId}:${token}:${++seq}`,
    });
    if (!r.ok) throw new Error(`could not seed a debt in ${token}: ${r.error}`);
  };

  /** The exact integer that reached the ledger for one sweep leg. */
  const sweptRow = async (exitId: string, token: string): Promise<number | null> => {
    const [rows] = await pool.query<any[]>(
      "SELECT `amount`, `to_account` FROM `token_ledger` WHERE `idempotency_key` = ?",
      [`exit:${exitId}:sweep:${token}`],
    );
    if (!rows[0]) return null;
    expect(rows[0].to_account).toBe(EXIT_SETTLEMENT);
    return Number(rows[0].amount);
  };

  const openExit = async (userId: string): Promise<string> => {
    const made = await createExit(pool, { userId, kind: "voluntary", openedBy: "admin", noticeDays: 0 });
    if (!made.ok) throw new Error(made.error);
    return made.exit.id;
  };

  /** Conservation, the invariant a bad sweep would break. */
  const conserves = async (): Promise<void> => {
    const report = await checkLedgerInvariants(pool);
    expect(report.problems).toEqual([]);
  };

  const stateFor = async (userId: string, domain: string) => {
    const states = await exitOpenState(pool, userId, []);
    const found = states.find((s) => s.domain === domain);
    if (!found) throw new Error(`no ${domain} state`);
    return found;
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    await loadTokenRegistry(pool);
    await ensureVoiceToken(pool, "Village Voice");
    await registerToken(pool, {
      slug: FINE,
      name: "Fine Grained Credit",
      kind: "credit",
      governance: "platform",
      transferable: false,
      decimals: 4,
    });
    // The pin. See WHOLE above: this file needs three distinct scales and the
    // platform now ships credits and Voice at the same one.
    await pool.query("UPDATE tokens SET decimals = 0 WHERE slug = ?", [WHOLE]); // module-review-ok: the decimals seam this file exists to exercise, against the S5 scratch schema
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  // ── Today's scale, in the one place it is allowed to be written down ──────

  it("reads one minor amount as three different numbers, at today's registered decimals", () => {
    /*
     * THE ONLY SCALE-BOUND CASE IN THIS FILE, and it is deliberately about the
     * registry rather than about the exit. 12345 minor units is 12345 credits
     * at the pinned 0, 123.45 voice at two places and 1.2345 of a decimals-4
     * token, and those three readings are what every other case below asks for
     * without naming them.
     *
     * The Voice reading moved from 12.345 to 123.45 when the 2026-09-04 ruling
     * took Voice from three places to two. Nothing else in the file moved,
     * which is the whole reason the numbers live here.
     */
    expect(fromLedgerUnits(WHOLE, MINOR)).toBe(12_345);
    expect(fromLedgerUnits(VOICE, MINOR)).toBe(123.45);
    expect(fromLedgerUnits(FINE, MINOR)).toBe(1.2345);

    // And the three scales really are three, which is what gives the cases
    // below the power to catch a conversion applied in the wrong direction.
    expect(new Set(TOKENS.map((t) => toLedgerUnits(t, 1))).size).toBe(3);
  });

  // ── The sweep ────────────────────────────────────────────────────────────

  it("posts the minor units it read, and reports the human number for them", async () => {
    const u = await member("exit-sweep-units");
    for (const token of TOKENS) await give(u, token, MINOR);
    for (const token of TOKENS) expect(await balanceOf(pool, memberAccount(u), token)).toBe(MINOR);

    // The settlement account is shared by every departure in this schema, so
    // what this case owns is the DELTA it caused, never the running total.
    const before = new Map<string, number>();
    for (const token of TOKENS) before.set(token, await balanceOf(pool, EXIT_SETTLEMENT, token));

    const exitId = await openExit(u);
    const result = await sweepBalances(pool, { exitId, userId: u });
    expect(result.errors).toEqual([]);

    for (const token of TOKENS) {
      // THE MINOR HALF. The balance moved unscaled, whatever the token's
      // decimals are. This is what a `toLedgerUnits` at the posting breaks.
      expect(await sweptRow(exitId, token), `${token} ledger row`).toBe(MINOR);
      expect(
        (await balanceOf(pool, EXIT_SETTLEMENT, token)) - before.get(token)!,
        `${token} arriving at exit settlement`,
      ).toBe(MINOR);
      expect(await balanceOf(pool, memberAccount(u), token), `${token} left with the member`).toBe(0);

      // THE HUMAN HALF. What the settle route writes into the permanent
      // resolution note and what the admin page toasts. Converted back through
      // the registry it has to be the exact integer that moved, which is the
      // assertion a build reporting raw minor units fails: `toLedgerUnits` of a
      // minor figure is that figure times the scale, not the figure.
      expect(toLedgerUnits(token, result.swept[token]!), `${token} reported, converted back`).toBe(MINOR);
      expect(result.swept[token], `${token} as a person reads it`).toBe(fromLedgerUnits(token, MINOR));
    }
    await conserves();
  });

  it("sweeps nothing the second time, and says so as an absence", async () => {
    const u = await member("exit-sweep-twice");
    await give(u, VOICE, MINOR);
    const exitId = await openExit(u);
    const before = await balanceOf(pool, EXIT_SETTLEMENT, VOICE);

    const first = await sweepBalances(pool, { exitId, userId: u });
    expect(first.swept[VOICE]).toBe(fromLedgerUnits(VOICE, MINOR));
    expect((await balanceOf(pool, EXIT_SETTLEMENT, VOICE)) - before).toBe(MINOR);

    // A second sweep finds a zero balance, so it never reaches the ledger. The
    // key is ABSENT, which is a different fact from a swept amount of zero: an
    // admin reading "village-voice: 0" would think a sweep that should have
    // moved something moved nothing, and this says nothing was there to move.
    const again = await sweepBalances(pool, { exitId, userId: u });
    expect(again.errors).toEqual([]);
    expect(VOICE in again.swept).toBe(false);
    expect((await balanceOf(pool, EXIT_SETTLEMENT, VOICE)) - before).toBe(MINOR);
    await conserves();
  });

  // ── The debt, which is never swept ───────────────────────────────────────

  it("leaves a negative balance where it is, and keeps refusing to resolve over it", async () => {
    const u = await member("exit-sweep-debt");
    await give(u, VOICE, MINOR);
    await owe(u, WHOLE, 40);
    expect(await balanceOf(pool, memberAccount(u), WHOLE)).toBe(-40);

    const exitId = await openExit(u);
    const result = await sweepBalances(pool, { exitId, userId: u });

    // The positive balance goes; the debt is untouched and unmentioned. Again
    // an absence, not a zero: a debt reported as "swept 0" reads as settled.
    expect(result.swept[VOICE]).toBe(fromLedgerUnits(VOICE, MINOR));
    expect(WHOLE in result.swept).toBe(false);
    expect(await sweptRow(exitId, WHOLE)).toBeNull();
    expect(await balanceOf(pool, memberAccount(u), WHOLE)).toBe(-40);

    // And the debt still blocks the door after the sweep has run.
    const blocking = blockingStates(await exitOpenState(pool, u, []));
    expect(blocking.map((s) => s.domain)).toContain("debts");
    expect(blocking.find((s) => s.domain === "debts")?.count).toBe(1);
    await conserves();
  });

  // ── The two sentences an admin reads on the exit desk ─────────────────────

  it("describes what a member holds in human units, at every scale", async () => {
    const u = await member("exit-state-holds");
    for (const token of TOKENS) await give(u, token, MINOR);

    const held = await stateFor(u, "balances");
    expect(held.count).toBe(TOKENS.length);
    for (const token of TOKENS) {
      expect(held.description, `${token} in the pre-sweep prompt`).toContain(
        `${fromLedgerUnits(token, MINOR)} ${token}`,
      );
    }
    // The failure this pins: the minor integer printed as prose. It was already
    // wrong for voice at 3 decimals before any ruling, and at 4 every token
    // joins it. The wrong string is named exactly, because "12345" on its own
    // also appears as the correct decimals-0 figure.
    expect(held.description).not.toContain(`${MINOR} ${VOICE}`);
    expect(held.description).not.toContain(`${MINOR} ${FINE}`);
  });

  it("describes what a member owes in human units, at every scale", async () => {
    const u = await member("exit-state-owes");
    for (const token of TOKENS) await owe(u, token, MINOR);

    const debts = await stateFor(u, "debts");
    expect(debts.count).toBe(TOKENS.length);
    expect(debts.blocking).toBe(true);
    for (const token of TOKENS) {
      expect(debts.description, `${token} in the debts sentence`).toContain(
        `${fromLedgerUnits(token, MINOR)} ${token}`,
      );
    }
    expect(debts.description).not.toContain(`${MINOR} ${VOICE}`);
    expect(debts.description).not.toContain(`${MINOR} ${FINE}`);
    await conserves();
  });

  it("says nothing held rather than an empty list when a member carries nothing", async () => {
    const u = await member("exit-state-empty");
    expect((await stateFor(u, "balances")).description).toBe("nothing held");
    expect((await stateFor(u, "balances")).count).toBe(0);
    expect((await stateFor(u, "debts")).description).toBe("no negative balances");
    expect(blockingStates(await exitOpenState(pool, u, [])).map((s) => s.domain)).not.toContain("debts");
  });
});
