/**
 * WHAT A DEPARTURE ACTUALLY MOVES, ONCE THE DIALS DECIDE IT (R4).
 *
 * `server/lib/exitDefaults.test.ts` proves the other half: on the shipped
 * dials, this file's `sweepBalances` writes the rows `origin/main` wrote. This
 * one proves that a village that MOVES a dial gets what the dial says, and it
 * asserts outcomes rather than calls: balances after the sweep, the ledger rows
 * that produced them, the text left on the exit row, and conservation summed
 * over every account including the faucets.
 *
 * THE POLICY IS INJECTED, never written to `game_variables`. `sweepBalances`
 * takes the reading as an argument and falls back to `exitSplitPolicy()`, so
 * these cases are about the ARITHMETIC and the POSTINGS and never about
 * whether a registry row loaded. The registry side is asserted in
 * `shared/gameVariables.test.ts` and driven end to end in
 * `server/exitLevers.routes.e2e.test.ts`.
 *
 * THREE TOKENS AT THREE SCALES, for the reason `exit.test.ts` gives: at
 * decimals 0 a units bug is invisible, because a human number and a minor unit
 * are the same number. Two of the three are credit-kind and one is voice, so
 * every case also says whether the share was found by KIND or by name.
 *
 * Runs against the S5 harness: a scratch schema, unique per provision. No
 * TEST_DATABASE_URL and it skips loudly.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { CREDITS, ensureVoiceToken, fromLedgerUnits, VILLAGE_VOICE, VOICE_MINT } from "./economy";
import {
  balanceOf,
  checkLedgerInvariants,
  CYCLE_POOL_FAUCET,
  loadTokenRegistry,
  memberAccount,
  MINT_FAUCET,
  postGraceNightBurn,
  postTransfer,
  registerToken,
  TREASURY,
} from "./ledger";
import {
  blockingStates,
  capturedSplit,
  coolingRefusal,
  createExit,
  EXIT_SETTLEMENT,
  exitById,
  exitOpenState,
  settlesFrom,
  sweepBalances,
  type ExitSplitPolicy,
} from "./exit";

const configured = testDbConfigured();
if (!configured) {
  console.warn("[exitSplit] TEST_DATABASE_URL not set - this file SKIPPED. A skip is not a pass.");
}

/**
 * Credit kind, and it is NOT decimals 0 any more.
 *
 * This constant was named for a property `0184` took away: `credits` carried no
 * decimals when this file was written and carries two now. The name is kept,
 * because every case here is about the credit KIND and renaming forty-two
 * mentions would say nothing new, but the file no longer assumes the scale.
 *
 * WHAT THAT CHANGES, AND IT IS ONE THING. The fixtures still post MINOR units
 * and the sweep still reads them, so the arithmetic and the flooring are
 * unaffected at any scale. `captured.lines` and `swept` report HUMAN, because a
 * person reads them off the exit record, so every expectation about those is
 * stated through `fromLedgerUnits` rather than as a bare integer that was only
 * ever right at scale 1.
 */
const WHOLE = CREDITS;
/** decimals 3 today, registered by `ensureVoiceToken`. Voice kind. */
const VOICE = VILLAGE_VOICE;
/** decimals 4: a village's OWN credit, so the share has to be found by kind. */
const FINE = "exit-split-fine";

/** One integer, three scales. Seeded as MINOR, which is what the sweep reads. */
const MINOR = 12_345;

/** Read off the registry in `beforeAll`, because `0184` moves both of them. */
let vDec = 0;
let wDec = 0;

/**
 * MINOR Voice into MINOR credits, mirroring `convertedMinor` in
 * server/lib/exit.ts exactly: BigInt throughout, floored by the division.
 *
 * WRITTEN OUT RATHER THAN APPROXIMATED. That function is not exported, and the
 * obvious float spelling disagrees with it: `(12345 / 100) * 2.5 * 100` is
 * 30862.500000000004 in IEEE 754, so a floor of the float and a floor of the
 * exact ratio can differ by one at exactly the amounts this case is about. The
 * point of these cases is the flooring, so the expectation has to floor the
 * same way the engine does.
 */
function convertedCredits(voiceMinor: number, num: number, den: number): number {
  const ten = BigInt(10);
  return Number(
    (BigInt(Math.trunc(voiceMinor)) * BigInt(num) * ten ** BigInt(wDec)) /
      (BigInt(den) * ten ** BigInt(vDec)),
  );
}

/** Every default reproduced, so a case changes exactly the dial it is about. */
const DEFAULTS: ExitSplitPolicy = {
  keepPct: { credit: 0, voice: 0, recognition: 0, equity: 0 },
  remainderAccount: "settlement",
  coolingDays: 0,
  voiceOnExit: "forfeit",
  voiceConvertRate: "0",
};
const policy = (over: Partial<ExitSplitPolicy>): ExitSplitPolicy => ({ ...DEFAULTS, ...over });

const DAY = 24 * 3600 * 1000;

describe.skipIf(!configured)("a departure on dials a village actually moved", () => {
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

  /** Put a known number of MINOR units in an account. */
  const give = async (to: string, token: string, units: number): Promise<void> => {
    const r = await postTransfer(pool, {
      from: MINT_FAUCET,
      to,
      tokenType: token,
      amount: units,
      source: "test_seed",
      idempotencyKey: `exit-split:seed:${to}:${token}:${++seq}`,
    });
    if (!r.ok) throw new Error(`could not seed ${token}: ${r.error}`);
  };

  /**
   * A real debt, the only lawful way: a source in `ALLOW_NEGATIVE_SOURCES`
   * with `allowNegative` set. A hand-written balance row would be a cache the
   * ledger disagrees with, which the boot invariant reports as drift.
   */
  const owe = async (userId: string, token: string, units: number): Promise<void> => {
    // The ledger ISSUES the debt proof and no longer exports it, so this is
    // the one door that carries it and the source is pinned inside.
    const r = await postGraceNightBurn(pool, {
      from: memberAccount(userId),
      to: TREASURY,
      tokenType: token,
      amount: units,
      idempotencyKey: `exit-split-debt:${userId}:${token}:${++seq}`,
    });
    if (!r.ok) throw new Error(`could not seed a debt in ${token}: ${r.error}`);
  };

  const openExit = async (userId: string, noticeDays = 0): Promise<string> => {
    const made = await createExit(pool, { userId, kind: "voluntary", openedBy: "admin", noticeDays });
    if (!made.ok) throw new Error(made.error);
    return made.exit.id;
  };

  /** Every posting one exit produced, in a stable order. */
  const rowsFor = async (exitId: string): Promise<any[]> => {
    const [rows] = await pool.query<any[]>(
      "SELECT `from_account`, `to_account`, `token_type`, `amount`, `description`, `idempotency_key` " +
        "FROM `token_ledger` WHERE `source_ref` = ? ORDER BY `idempotency_key`",
      [exitId],
    );
    return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  };

  /**
   * CONSERVATION, summed over EVERY account there is, faucets included. Per
   * token the total must be exactly zero: a split that invented or destroyed a
   * unit shows up here whatever the two ends looked like.
   */
  const conserves = async (): Promise<void> => {
    const [sums] = await pool.query<any[]>(
      "SELECT `token_type`, SUM(`balance`) AS total FROM `token_balances` GROUP BY `token_type`",
    );
    for (const row of sums) {
      expect(Number(row.total), `${row.token_type} summed over every account`).toBe(0);
    }
    const report = await checkLedgerInvariants(pool);
    expect(report.problems).toEqual([]);
  };

  /** What the settle route does with the note, done here the same way. */
  const appendNote = async (exitId: string, note: string): Promise<void> => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "UPDATE `exits` SET `status` = 'settling', `resolution` = CONCAT(COALESCE(`resolution`,''), ?) WHERE `id` = ?",
      [note, exitId],
    );
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the exit.test.ts shape
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
    await loadTokenRegistry(pool);
    const [dec] = await pool.query<any[]>("SELECT `slug`, `decimals` FROM `tokens` WHERE `slug` IN (?, ?)", [WHOLE, VOICE]);
    vDec = Number((dec as any[]).find((r) => String(r.slug) === VOICE)?.decimals ?? 0);
    wDec = Number((dec as any[]).find((r) => String(r.slug) === WHOLE)?.decimals ?? 0);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  // ── The share ────────────────────────────────────────────────────────────

  it("a 40 percent credit keep leaves 40 in place and posts 60, per token, by KIND", async () => {
    const u = await member("exit-split-keep40");
    for (const token of [WHOLE, VOICE, FINE]) await give(memberAccount(u), token, MINOR);
    const exitId = await openExit(u);

    const result = await sweepBalances(pool, {
      exitId,
      userId: u,
      policy: policy({ keepPct: { credit: 40, voice: 0, recognition: 0, equity: 0 } }),
    });
    expect(result.errors).toEqual([]);
    expect(result.refusal).toBeNull();

    // 12345 at forty percent is 4938 exactly, so this case is about the SHARE
    // and the case below is about what happens when it does not divide.
    const kept = 4938;
    const moved = MINOR - kept;
    for (const token of [WHOLE, FINE]) {
      expect(await balanceOf(pool, memberAccount(u), token), `${token} left with the leaver`).toBe(kept);
      expect(result.swept[token], `${token} as a person reads it`).toBe(fromLedgerUnits(token, moved));
    }
    // Voice is a different KIND, so the credit share never touched it. This is
    // the assertion a slug allowlist would pass and a kind lookup earns.
    expect(await balanceOf(pool, memberAccount(u), VOICE)).toBe(0);
    expect(result.swept[VOICE]).toBe(fromLedgerUnits(VOICE, MINOR));

    const rows = await rowsFor(exitId);
    expect(rows.map((r) => [r.token_type, r.amount])).toEqual(
      [
        [WHOLE, moved],
        [FINE, moved],
        [VOICE, MINOR],
      ].sort((a, b) => String(`exit:${exitId}:sweep:${a[0]}`).localeCompare(`exit:${exitId}:sweep:${b[0]}`)),
    );
    for (const row of rows) {
      expect(row.to_account).toBe(EXIT_SETTLEMENT);
      expect(row.description).toBe("Balance settled at departure");
    }
    await conserves();
  });

  it("a share that does not divide is FLOORED, so the remainder can never exceed the balance", async () => {
    const u = await member("exit-split-floor");
    // Seven minor units at 33 percent is 2.31, which is the whole point: the
    // kept share floors to 2 and the village receives 5. Rounding UP would
    // hand the leaver more than they held once the two sides were added.
    await give(memberAccount(u), WHOLE, 7);
    await give(memberAccount(u), FINE, MINOR);
    const exitId = await openExit(u);

    const result = await sweepBalances(pool, {
      exitId,
      userId: u,
      policy: policy({ keepPct: { credit: 33, voice: 0, recognition: 0, equity: 0 } }),
    });
    expect(result.errors).toEqual([]);
    expect(await balanceOf(pool, memberAccount(u), WHOLE)).toBe(2);
    // 12345 * 33 / 100 is 4073.85, floored to 4073, and the village gets 8272.
    expect(await balanceOf(pool, memberAccount(u), FINE)).toBe(4073);

    const whole = result.captured?.lines.find((l) => l.token === WHOLE);
    const fine = result.captured?.lines.find((l) => l.token === FINE);
    // MINOR in, HUMAN out: seven minor units are floored into two and five,
    // and the captured line states them the way a reader sees them.
    expect(whole).toEqual({
      token: WHOLE, kind: "credit", to: EXIT_SETTLEMENT,
      held: fromLedgerUnits(WHOLE, 7), kept: fromLedgerUnits(WHOLE, 2), moved: fromLedgerUnits(WHOLE, 5),
    });
    // kept plus moved is EXACTLY held, at every scale, which is the property
    // the floor buys and the one conservation depends on.
    expect((fine!.kept + fine!.moved).toFixed(4)).toBe(fine!.held.toFixed(4));
    await conserves();
  });

  it("a hundred percent keep posts nothing at all, and says so as an absence", async () => {
    const u = await member("exit-split-keepall");
    await give(memberAccount(u), WHOLE, 500);
    const exitId = await openExit(u);

    const result = await sweepBalances(pool, {
      exitId,
      userId: u,
      policy: policy({ keepPct: { credit: 100, voice: 0, recognition: 0, equity: 0 } }),
    });
    expect(result.errors).toEqual([]);
    // An absent key, never a swept amount of zero: an admin reading "credits:
    // 0" would think a sweep that should have moved something moved nothing.
    expect(WHOLE in result.swept).toBe(false);
    expect(await rowsFor(exitId)).toEqual([]);
    expect(await balanceOf(pool, memberAccount(u), WHOLE)).toBe(500);
    // Nothing posted and the policy still applied, so the split is captured:
    // this run IS the first application, and a later retry must not rewrite it.
    expect(result.captured?.keep.credit).toBe(100);
    expect(result.captured?.lines[0]).toEqual({
      token: WHOLE, kind: "credit", to: EXIT_SETTLEMENT,
      held: fromLedgerUnits(WHOLE, 500), kept: fromLedgerUnits(WHOLE, 500), moved: 0,
    });
    await conserves();
  });

  // ── Where the rest goes ──────────────────────────────────────────────────

  it("each of the four remainder accounts receives it, and burn finds the token's OWN faucet", async () => {
    const cases: Array<[string, ExitSplitPolicy["remainderAccount"], string, string]> = [
      ["exit-split-to-settlement", "settlement", WHOLE, EXIT_SETTLEMENT],
      ["exit-split-to-treasury", "treasury", WHOLE, TREASURY],
      ["exit-split-to-pool", "cycle-pool", WHOLE, CYCLE_POOL_FAUCET],
      // Voice on purpose: its faucet is `sys:voice-mint`, so a burn that
      // resolved to one hardcoded account would pass three of these and fail
      // this one.
      ["exit-split-to-burn", "burn", VOICE, VOICE_MINT],
    ];
    for (const [name, where, token, account] of cases) {
      const u = await member(name);
      await give(memberAccount(u), token, 1_000);
      const exitId = await openExit(u);
      const before = await balanceOf(pool, account, token);

      const result = await sweepBalances(pool, { exitId, userId: u, policy: policy({ remainderAccount: where }) });
      expect(result.errors, `${where} errors`).toEqual([]);
      expect((await balanceOf(pool, account, token)) - before, `${where} arriving at ${account}`).toBe(1_000);
      expect(await balanceOf(pool, memberAccount(u), token), `${where} left with the leaver`).toBe(0);
      expect(result.captured?.lines[0]?.to, `${where} captured destination`).toBe(account);
    }
    await conserves();
  });

  it("burn refuses a token with no faucet, names it, and moves nothing", async () => {
    await registerToken(pool, {
      slug: "exit-split-orphan",
      name: "Orphan Credit",
      kind: "credit",
      governance: "platform",
      transferable: false,
      decimals: 0,
    });
    await loadTokenRegistry(pool);
    const u = await member("exit-split-orphan-holder");
    await give(memberAccount(u), "exit-split-orphan", 100);
    const exitId = await openExit(u);

    const result = await sweepBalances(pool, { exitId, userId: u, policy: policy({ remainderAccount: "burn" }) });
    expect(result.errors).toEqual(["Orphan Credit has no faucet, so there is nowhere to burn it back to."]);
    expect(await rowsFor(exitId)).toEqual([]);
    expect(await balanceOf(pool, memberAccount(u), "exit-split-orphan")).toBe(100);
    await conserves();
  });

  // ── Voice, and the conversion that is one pair or nothing ────────────────

  it("CONVERT posts a pair: the Voice leaves and the credits arrive, under two keys", async () => {
    const u = await member("exit-split-convert");
    await give(memberAccount(u), VOICE, MINOR);
    // Funded from the arithmetic, not from a literal: at two decimals on both
    // sides this conversion needs thirty thousand minor credits, and a fixed
    // 1_000 left the treasury unable to pay a bill the engine was right about.
    const paid = convertedCredits(MINOR, 25, 10);
    await give(TREASURY, WHOLE, paid + 1_000);
    const exitId = await openExit(u);
    const treasuryBefore = await balanceOf(pool, TREASURY, WHOLE);
    const settlementBefore = await balanceOf(pool, EXIT_SETTLEMENT, VOICE);

    const result = await sweepBalances(pool, {
      exitId,
      userId: u,
      policy: policy({
        keepPct: { credit: 0, voice: 100, recognition: 0, equity: 0 },
        voiceOnExit: "convert",
        voiceConvertRate: "2.5",
      }),
    });
    expect(result.errors).toEqual([]);

    // The arithmetic is done in the smallest unit of BOTH tokens and floored,
    // so the expectation is computed the same way at whatever scales the
    // registry holds. It used to read a bare 30, which was 12.345 Voice at
    // three decimals into whole credits, and both of those scales have moved.
    expect(await balanceOf(pool, memberAccount(u), WHOLE)).toBe(paid);
    expect(await balanceOf(pool, memberAccount(u), VOICE)).toBe(0);
    expect((await balanceOf(pool, TREASURY, WHOLE)) - treasuryBefore).toBe(-paid);
    // The Voice itself went to the remainder account, so the village received
    // every unit of it and the treasury paid for it. That is the pair.
    expect((await balanceOf(pool, EXIT_SETTLEMENT, VOICE)) - settlementBefore).toBe(MINOR);

    const keys = (await rowsFor(exitId)).map((r) => r.idempotency_key);
    expect(keys).toEqual([`exit:${exitId}:convert-credit:${VOICE}`, `exit:${exitId}:convert:${VOICE}`]);
    const line = result.captured?.lines.find((l) => l.token === VOICE);
    expect(line?.converted).toBe(fromLedgerUnits(WHOLE, paid));
    expect(line?.convertedTo).toBe(WHOLE);
    expect(line?.kept).toBe(0);
    await conserves();
  });

  it("a HALF conversion is impossible: a treasury that cannot pay moves neither leg", async () => {
    const u = await member("exit-split-convert-broke");
    await give(memberAccount(u), VOICE, MINOR);
    const exitId = await openExit(u);
    // Drain the treasury of credits, so the paying leg cannot land. A pair
    // never creates debt, so the whole transaction rolls back.
    const treasury = await balanceOf(pool, TREASURY, WHOLE);
    if (treasury > 0) {
      const r = await postTransfer(pool, {
        from: TREASURY, to: EXIT_SETTLEMENT, tokenType: WHOLE, amount: treasury,
        source: "test_seed", idempotencyKey: `exit-split:drain:${++seq}`,
      });
      expect(r.ok, `drain: ${r.error}`).toBe(true);
    }
    expect(await balanceOf(pool, TREASURY, WHOLE)).toBe(0);

    const result = await sweepBalances(pool, {
      exitId,
      userId: u,
      policy: policy({
        keepPct: { credit: 0, voice: 100, recognition: 0, equity: 0 },
        voiceOnExit: "convert",
        voiceConvertRate: "2.5",
      }),
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("insufficient");
    // NEITHER leg. The member still holds every unit of their Voice and has no
    // credits, which is the state a two-call implementation cannot promise.
    expect(await balanceOf(pool, memberAccount(u), VOICE)).toBe(MINOR);
    expect(await balanceOf(pool, memberAccount(u), WHOLE)).toBe(0);
    expect(await rowsFor(exitId)).toEqual([]);
    await conserves();
  });

  it("a rate too small to pay one unit converts nothing and says so", async () => {
    const u = await member("exit-split-convert-dust");
    await give(TREASURY, WHOLE, 1_000);
    // ONE MINOR UNIT of Voice, which is what "too small to pay one unit" means
    // at any scale. It read 100 minor with a comment about 0.1 Voice against
    // whole credits; at two decimals on both sides that pays 50 minor credits
    // and converts perfectly well, so the case had stopped describing dust.
    await give(memberAccount(u), VOICE, 1);
    const exitId = await openExit(u);

    const result = await sweepBalances(pool, {
      exitId,
      userId: u,
      policy: policy({
        keepPct: { credit: 0, voice: 100, recognition: 0, equity: 0 },
        voiceOnExit: "convert",
        // Half a credit per Voice, so one minor unit of Voice buys half a
        // minor unit of credit, and half a unit is nothing the ledger can hold.
        voiceConvertRate: "0.5",
      }),
    });
    // The premise, stated rather than assumed: this really does floor to zero.
    expect(convertedCredits(1, 5, 10), "the fixture must be dust at these scales").toBe(0);
    expect(result.errors).toEqual([
      `${VOICE}: this rate pays nothing on that share, so no Voice was converted.`,
    ]);
    expect(await balanceOf(pool, memberAccount(u), VOICE)).toBe(1);
    expect(await balanceOf(pool, memberAccount(u), WHOLE)).toBe(0);
    await conserves();
  });

  it("FORFEIT moves the whole holding whatever share the Voice dial names", async () => {
    // The dial's own words: at forfeit the share "goes with everything else".
    // A share of Voice only changes a departure once the second dial does.
    const u = await member("exit-split-forfeit");
    await give(memberAccount(u), VOICE, MINOR);
    const exitId = await openExit(u);

    const result = await sweepBalances(pool, {
      exitId,
      userId: u,
      policy: policy({ keepPct: { credit: 0, voice: 80, recognition: 0, equity: 0 }, voiceOnExit: "forfeit" }),
    });
    expect(result.errors).toEqual([]);
    expect(await balanceOf(pool, memberAccount(u), VOICE)).toBe(0);
    expect(result.swept[VOICE]).toBe(fromLedgerUnits(VOICE, MINOR));
    await conserves();
  });

  it("what this exit PAID the member is never swept back by a second settle", async () => {
    const u = await member("exit-split-paid-back");
    const paidBack = convertedCredits(MINOR, 25, 10);
    await give(TREASURY, WHOLE, paidBack + 1_000);
    await give(memberAccount(u), VOICE, MINOR);
    const exitId = await openExit(u);
    const converting = policy({
      keepPct: { credit: 0, voice: 100, recognition: 0, equity: 0 },
      voiceOnExit: "convert",
      voiceConvertRate: "2.5",
    });

    const first = await sweepBalances(pool, { exitId, userId: u, policy: converting });
    expect(first.errors).toEqual([]);
    await appendNote(exitId, first.note);
    expect(await balanceOf(pool, memberAccount(u), WHOLE)).toBe(paidBack);

    // A second settle under a policy that takes sixty percent of credits. The
    // the credits in the leaver's hands came from THIS exit, so they are
    // not a balance to settle: they are what the settlement already paid.
    const again = await sweepBalances(pool, {
      exitId,
      userId: u,
      policy: policy({ ...converting, keepPct: { credit: 40, voice: 100, recognition: 0, equity: 0 } }),
    });
    expect(again.paidOut).toContain(WHOLE);
    expect(again.swept).toEqual({});
    expect(await balanceOf(pool, memberAccount(u), WHOLE)).toBe(paidBack);
    await conserves();
  });

  // ── The trap: the amount changes and the key does not ────────────────────

  it("a retry after a dial change posts NOTHING and reports the CAPTURED split", async () => {
    const u = await member("exit-split-retry");
    await give(memberAccount(u), WHOLE, 1_000);
    const exitId = await openExit(u);

    const first = await sweepBalances(pool, {
      exitId, userId: u, policy: policy({ keepPct: { credit: 40, voice: 0, recognition: 0, equity: 0 } }),
    });
    await appendNote(exitId, first.note);
    // `swept` is HUMAN, the figure the note prints for a person.
    expect(first.swept[WHOLE]).toBe(fromLedgerUnits(WHOLE, 600));
    expect(first.captured?.keep.credit).toBe(40);

    /*
     * THE TRAP, AND WHY IT IS CORRECT. The idempotency key carries no policy,
     * so the second sweep is a duplicate and posts nothing. The 400 the leaver
     * kept stays 400 even though the dial now says 90. That is right, because
     * value moves once. It is only honest if a reader is told the SPLIT THAT
     * HAPPENED instead of the dial that stands now.
     */
    const second = await sweepBalances(pool, {
      exitId, userId: u, policy: policy({ keepPct: { credit: 90, voice: 0, recognition: 0, equity: 0 } }),
    });
    await appendNote(exitId, second.note);

    expect(second.swept).toEqual({});
    expect(second.errors).toEqual([]);
    expect(await balanceOf(pool, memberAccount(u), WHOLE)).toBe(400);
    expect((await rowsFor(exitId)).length).toBe(1);

    // The live dial says 90 and the run says so; the split of record says 40.
    expect(second.policy.keepPct.credit).toBe(90);
    expect(second.captured?.keep.credit).toBe(40);
    expect(second.captured?.lines[0]).toEqual({
      token: WHOLE, kind: "credit", to: EXIT_SETTLEMENT,
      held: fromLedgerUnits(WHOLE, 1_000), kept: fromLedgerUnits(WHOLE, 400), moved: fromLedgerUnits(WHOLE, 600),
    });

    // And a READER coming to the exit row cold reads the same 40, because the
    // second run wrote no capture over the first.
    const row = await exitById(pool, exitId);
    expect(capturedSplit(row?.resolution)?.keep.credit).toBe(40);
    expect(row?.resolution).toContain("already settled under the policy recorded above");
    // The line the route has always written is still there, and still first.
    expect(row?.resolution).toContain(`balances swept: {"credits":${fromLedgerUnits(WHOLE, 600)}}`);
    await conserves();
  });

  it("a resolution with no capture reads as absent, which is what an older exit is", () => {
    expect(capturedSplit(null)).toBeNull();
    expect(capturedSplit("\n[2026-01-01] balances swept: {}")).toBeNull();
    expect(capturedSplit("\n[2026-01-01] exit policy applied: {not json")).toBeNull();
  });

  // ── The cooling period ───────────────────────────────────────────────────

  it("the cooling period refuses the settle, names the date, and moves nothing", async () => {
    const u = await member("exit-split-cooling");
    await give(memberAccount(u), WHOLE, 1_000);
    const exitId = await openExit(u, 30);
    const exit = (await exitById(pool, exitId))!;
    const opened = new Date(exit.openedAt).getTime();
    const cooling = policy({ coolingDays: 14 });

    const held = await sweepBalances(pool, { exitId, userId: u, policy: cooling, now: new Date(opened + DAY) });
    const expected = new Date(opened + 14 * DAY).toISOString().slice(0, 10);
    expect(held.refusal).toBe(
      `Balances on this exit settle from ${expected}. Today is ${new Date(opened + DAY).toISOString().slice(0, 10)}.`,
    );
    expect(await rowsFor(exitId)).toEqual([]);
    expect(await balanceOf(pool, memberAccount(u), WHOLE)).toBe(1_000);
    expect(held.note).toBe("");

    // And the same exit settles once the days have passed.
    const after = await sweepBalances(pool, { exitId, userId: u, policy: cooling, now: new Date(opened + 15 * DAY) });
    expect(after.refusal).toBeNull();
    expect(after.swept[WHOLE]).toBe(fromLedgerUnits(WHOLE, 1_000));
    await conserves();
  });

  it("the cooling date never runs past the notice date the member's own exit carries", async () => {
    // The save guard compares a cooling period against the policy as it stands
    // the day the DIAL is written, and this member was told seven days when
    // their exit opened. A longer cooling period saved afterwards cannot hold
    // their balance past the date their own departure promised.
    const u = await member("exit-split-cooling-capped");
    const exitId = await openExit(u, 7);
    const exit = (await exitById(pool, exitId))!;
    const notice = new Date(exit.noticeEndsAt!).getTime();

    /*
     * ASSERTED AGAINST THE EXIT'S OWN COLUMN, and the first draft of this case
     * asserted `opened_at + 7 days` instead and failed by seven hours, which
     * turned out to be a fact about the platform rather than about this guard.
     * `opened_at` is written by MySQL's `NOW()` in the server's session zone
     * and read back through a pool declaring `timezone: "Z"`, so `openedAt` is
     * the session offset behind true UTC (measured here: `NOW()` read as
     * 20:28Z while `UTC_TIMESTAMP()` was 03:28Z, a seven-hour skew), while
     * `notice_ends_at` is written from a JS Date and is true UTC. The cap
     * below is therefore the half of this guard that is exact.
     */
    const from = settlesFrom(exit, policy({ coolingDays: 45 }));
    expect(from!.toISOString()).toBe(new Date(notice).toISOString());
    expect(coolingRefusal(exit, policy({ coolingDays: 45 }), new Date(notice + DAY))).toBeNull();
    expect(coolingRefusal(exit, policy({ coolingDays: 45 }), new Date(notice - DAY))).toContain(
      new Date(notice).toISOString().slice(0, 10),
    );
    // Zero days is today's behaviour: nothing is held, whatever notice says.
    expect(settlesFrom(exit, DEFAULTS)).toBeNull();
    expect(coolingRefusal(exit, DEFAULTS, new Date(notice - 30 * DAY))).toBeNull();
  });

  // ── The debt, which no policy ever touches ───────────────────────────────

  it("a negative balance is still never swept and still blocks resolve, at any share", async () => {
    const u = await member("exit-split-debt");
    await give(memberAccount(u), VOICE, MINOR);
    await owe(u, WHOLE, 40);
    expect(await balanceOf(pool, memberAccount(u), WHOLE)).toBe(-40);
    const exitId = await openExit(u);

    const result = await sweepBalances(pool, {
      exitId,
      userId: u,
      policy: policy({ keepPct: { credit: 40, voice: 0, recognition: 0, equity: 0 }, remainderAccount: "treasury" }),
    });
    // An absence, never a zero: a debt reported as "swept 0" reads as settled.
    expect(WHOLE in result.swept).toBe(false);
    expect(result.captured?.lines.some((l) => l.token === WHOLE)).toBe(false);
    expect(await balanceOf(pool, memberAccount(u), WHOLE)).toBe(-40);

    const blocking = blockingStates(await exitOpenState(pool, u, []));
    expect(blocking.map((s) => s.domain)).toContain("debts");
    expect(blocking.find((s) => s.domain === "debts")?.count).toBe(1);
    await conserves();
  });
});
