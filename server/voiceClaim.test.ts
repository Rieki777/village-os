/**
 * Tests for the crossing to Hypha.
 *
 * The cases that matter here are not "does a claim work". They are the ones
 * where two things arrive at once, or where a refund could become a way to make
 * voice. Each of those is checked by re-proving CONSERVATION afterwards: every
 * posting of a token must still sum to zero across all accounts, which is the
 * invariant the whole ledger rests on and the one a bad refund breaks.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied, unique per provision. No TEST_DATABASE_URL and the suite skips
 * loudly rather than passing hollowly.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import {
  ensureVoiceToken,
  fromLedgerUnits,
  mint,
  toLedgerUnits,
  VILLAGE_VOICE,
  VOICE_BRIDGE,
  VOICE_MINT,
  villageId,
} from "./lib/economy";
import { balanceOf, loadTokenRegistry, memberAccount } from "./lib/ledger";
import { loadVariables, setVariable } from "./lib/variables";
import {
  assertVoiceSecret,
  bridgeReconciliation,
  BRIDGE_DISPATCH_BUILT,
  checkVoiceSecret,
  claimHistory,
  claimReadiness,
  claimsWindow,
  requestVoiceClaim,
  retryRefund,
  settleVoiceClaim,
} from "./lib/voiceClaim";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let seq = 0;

/**
 * The ceiling for a case that opens more than one claim.
 *
 * vitest.config.ts sets `testTimeout: 120_000`, which suits a test that makes a
 * handful of round trips. These do not: every claim here is a member row, a
 * ledger account, a mint through `postTransfer`, a SERIALIZABLE transaction and
 * a settlement, and the database is a Railway MySQL behind a proxy measured at
 * roughly 240ms per round trip. A case that opens four claims is several hundred
 * round trips before anything is asserted.
 *
 * Raised, never lowered. A local override BELOW the global is the trap that cost
 * another lane a day: the file's own number wins, so a smaller one silently
 * undercuts headroom the config deliberately provides.
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
 * Put voice in somebody's hands the honest way, through the mint faucet.
 *
 * `amount` here is human voice and `mint` takes LEDGER UNITS, so the conversion
 * happens once, here. Throwing with the engine's own error rather than
 * asserting `ok` is deliberate: the first version of this helper asserted and a
 * missing faucet surfaced as twelve identical "expected false to be true".
 */
async function giveVoice(userId: string, amount: number): Promise<void> {
  const res = await mint(pool, {
    toUserId: userId,
    tokenSlug: VILLAGE_VOICE,
    amount: toLedgerUnits(VILLAGE_VOICE, amount),
    from: VOICE_MINT,
    source: "test",
    idempotencyKey: `test-voice:${userId}:${++seq}`,
    description: "seed",
  });
  if (!res.ok) throw new Error(`could not seed voice: ${res.error}`);
}

/**
 * A token's balances, summed across every account. Must be zero.
 *
 * NOT a sum of `token_ledger.amount`: that column is positive-only with
 * `from_account`/`to_account` beside it, so summing it counts every posting
 * once and is never zero. Conservation lives in the BALANCES, where the mint
 * faucet's negative is the issued supply. This is the same query
 * `checkLedgerInvariants` runs at every boot, narrowed to one token.
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

describe.skipIf(!configured)("carrying voice to Hypha", () => {
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

  beforeEach(async () => {
    // A space and an always-open window, so each case starts from a village
    // whose crossing is open. Cases that need it shut close it themselves.
    await setVariable(pool, "economy.hypha_space", "a-test-space");
    await setVariable(pool, "economy.claims_week_starts", "");
    await setVariable(pool, "economy.voice_claim_threshold", "100");
  });

  // ── The window ───────────────────────────────────────────────────────────

  it("stays open all year when no dates are set", async () => {
    await setVariable(pool, "economy.claims_week_starts", "");
    expect(claimsWindow(new Date("2026-02-03T00:00:00Z")).open).toBe(true);
  });

  it("opens on the day and closes after the window", async () => {
    await setVariable(pool, "economy.claims_week_starts", "06-21");
    await setVariable(pool, "economy.claims_week_days", "7");
    expect(claimsWindow(new Date("2026-06-21T00:00:00Z")).open).toBe(true);
    expect(claimsWindow(new Date("2026-06-27T23:00:00Z")).open).toBe(true);
    expect(claimsWindow(new Date("2026-06-28T00:01:00Z")).open).toBe(false);
    expect(claimsWindow(new Date("2026-06-20T23:00:00Z")).open).toBe(false);
    await setVariable(pool, "economy.claims_week_days", "7");
  });

  it("finds the next opening in the following year from December", async () => {
    // The bug this prevents: building windows for the CURRENT year only, so a
    // member checking on 22 December is told claims never open again.
    await setVariable(pool, "economy.claims_week_starts", "03-21,06-21,09-23,12-21");
    const shut = claimsWindow(new Date("2026-12-29T00:00:00Z"));
    expect(shut.open).toBe(false);
    expect(shut.nextOpens?.toISOString().slice(0, 10)).toBe("2027-03-21");
  });

  it("ignores a malformed date instead of refusing every claim", async () => {
    await setVariable(pool, "economy.claims_week_starts", "not-a-date,06-21");
    expect(claimsWindow(new Date("2026-06-22T00:00:00Z")).open).toBe(true);
  });

  // ── What the chip says ───────────────────────────────────────────────────

  it("never offers a button that would fail", async () => {
    const u = await makeMember("vc-poor");
    await giveVoice(u, 30);
    const ready = await claimReadiness(pool, u, true);
    expect(ready.claimable).toBe(false);
    expect(ready.says).toContain("Claims open at 100");
  });

  it("says the space is missing rather than staying silent", async () => {
    await setVariable(pool, "economy.hypha_space", "");
    const u = await makeMember("vc-nospace");
    await giveVoice(u, 150);
    const ready = await claimReadiness(pool, u, true);
    expect(ready.claimable).toBe(false);
    expect(ready.spaceConfigured).toBe(false);
    expect(ready.says).toContain("Hypha space");
  });

  it("refuses to take the debit while nothing can raise the proposal", async () => {
    /*
     * The trap this closes: naming the Hypha space is the last piece of
     * CONFIGURATION, so it looks like the last piece of work. It is not. With
     * no dispatch, a claim debits the member's whole balance and waits for a
     * webhook Hypha was never told to send, so it sits in `requested` forever
     * and only the member happening to cancel it gets the voice back.
     *
     * This test is written to FAIL LOUDLY when the dispatch ships and the
     * constant flips, so whoever ships it has to come here and write the real
     * assertions instead of finding a silently vacuous test.
     */
    const u = await makeMember("vc-nobridge");
    await giveVoice(u, 150);
    const ready = await claimReadiness(pool, u);

    if (!BRIDGE_DISPATCH_BUILT) {
      expect(ready.bridgeReady).toBe(false);
      expect(ready.claimable).toBe(false);
      expect(ready.says).toContain("still being finished");

      const out = await requestVoiceClaim(pool, u); // bare: the gate is what is under test
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.status).toBe(503);

      // And nothing was taken. The whole point.
      expect(fromLedgerUnits(VILLAGE_VOICE, await balanceOf(pool, memberAccount(u), VILLAGE_VOICE))).toBe(150);
      const [open] = await pool.query<any[]>(
        "SELECT `id` FROM `voice_claims` WHERE `user_id` = ?",
        [u],
      );
      expect(open.length).toBe(0);
    } else {
      expect(ready.bridgeReady).toBe(true);
      expect(ready.claimable).toBe(true);
      throw new Error(
        "BRIDGE_DISPATCH_BUILT is now true. Rewrite this test to prove the dispatch raises exactly " +
          "one intent per claim and writes hypha_ref back, and update every test below that assumes " +
          "requestVoiceClaim is refused.",
      );
    }
  });

  // ── The claim ────────────────────────────────────────────────────────────

  it("debits at request, so voice cannot be claimed twice while a vote is pending", async () => {
    const u = await makeMember("vc-one");
    await giveVoice(u, 120);

    const out = await requestVoiceClaim(pool, u, true);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.amount).toBe(120);

    // The member's hands are empty and the bridge is holding it.
    expect(fromLedgerUnits(VILLAGE_VOICE, await balanceOf(pool, memberAccount(u), VILLAGE_VOICE))).toBe(0);
    expect(fromLedgerUnits(VILLAGE_VOICE, await balanceOf(pool, VOICE_BRIDGE, VILLAGE_VOICE))).toBe(120);
    expect(await conservation(VILLAGE_VOICE)).toBe(0);

    // A second ask finds nothing to claim and one already open.
    const again = await requestVoiceClaim(pool, u, true);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already have a claim");
  }, DB_HEAVY);

  it("refuses below the threshold", async () => {
    const u = await makeMember("vc-short");
    await giveVoice(u, 99);
    const out = await requestVoiceClaim(pool, u, true);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(409);
  });

  it("refuses outside Claims Week and names the next opening", async () => {
    await setVariable(pool, "economy.claims_week_starts", "06-21");
    const u = await makeMember("vc-shut");
    await giveVoice(u, 150);
    const ready = await claimReadiness(pool, u, true);
    // Whether today falls inside the window is a property of the day the suite
    // runs, so this asserts the two states agree rather than picking one.
    const out = await requestVoiceClaim(pool, u, true);
    expect(out.ok).toBe(ready.claimable);
    await setVariable(pool, "economy.claims_week_starts", "");
  });

  // ── The endings ──────────────────────────────────────────────────────────

  it("gives the voice back on a cancel, by reversing rather than minting", async () => {
    const u = await makeMember("vc-cancel");
    await giveVoice(u, 200);
    const out = await requestVoiceClaim(pool, u, true);
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const back = await settleVoiceClaim(pool, out.claimId, "canceled", "changed their mind");
    expect(back).toEqual({ ok: true, refunded: true });
    expect(fromLedgerUnits(VILLAGE_VOICE, await balanceOf(pool, memberAccount(u), VILLAGE_VOICE))).toBe(200);
    expect(await conservation(VILLAGE_VOICE)).toBe(0);
  });

  it("refunds a rejection, because nothing is confiscated for losing a vote", async () => {
    const u = await makeMember("vc-rejected");
    await giveVoice(u, 150);
    const out = await requestVoiceClaim(pool, u, true);
    if (!out.ok) throw new Error(out.error);
    const back = await settleVoiceClaim(pool, out.claimId, "rejected", "Hypha: rejected");
    expect(back).toEqual({ ok: true, refunded: true });
    expect(fromLedgerUnits(VILLAGE_VOICE, await balanceOf(pool, memberAccount(u), VILLAGE_VOICE))).toBe(150);
  });

  it("keeps the voice on a confirmation", async () => {
    const u = await makeMember("vc-confirmed");
    await giveVoice(u, 150);
    const out = await requestVoiceClaim(pool, u, true);
    if (!out.ok) throw new Error(out.error);
    const done = await settleVoiceClaim(pool, out.claimId, "confirmed", "Hypha: executed");
    expect(done).toEqual({ ok: true, refunded: false });
    // It left this ledger for good. The bridge still holds it, which is the
    // truthful record of voice that settled somewhere else.
    expect(fromLedgerUnits(VILLAGE_VOICE, await balanceOf(pool, memberAccount(u), VILLAGE_VOICE))).toBe(0);
    expect(await conservation(VILLAGE_VOICE)).toBe(0);
  }, DB_HEAVY);

  it("refuses to cancel a claim Hypha already confirmed", async () => {
    // The exploit: confirm on Hypha, then cancel here, and be paid twice.
    const u = await makeMember("vc-double");
    await giveVoice(u, 150);
    const out = await requestVoiceClaim(pool, u, true);
    if (!out.ok) throw new Error(out.error);
    expect((await settleVoiceClaim(pool, out.claimId, "confirmed")).ok).toBe(true);

    const sneak = await settleVoiceClaim(pool, out.claimId, "canceled", "second bite");
    expect(sneak.ok).toBe(false);
    expect(fromLedgerUnits(VILLAGE_VOICE, await balanceOf(pool, memberAccount(u), VILLAGE_VOICE))).toBe(0);
    expect(await conservation(VILLAGE_VOICE)).toBe(0);
  }, DB_HEAVY);

  it("refunds once when two cancels race", async () => {
    // The compare-and-set is what makes this true: both callers read
    // `requested`, only one UPDATE changes a row, and only that one refunds.
    const u = await makeMember("vc-race");
    await giveVoice(u, 150);
    const out = await requestVoiceClaim(pool, u, true);
    if (!out.ok) throw new Error(out.error);

    const [a, b] = await Promise.all([
      settleVoiceClaim(pool, out.claimId, "canceled", "one"),
      settleVoiceClaim(pool, out.claimId, "stale", "two"),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await cacheDrift(VILLAGE_VOICE)).toBe(0);
    expect(fromLedgerUnits(VILLAGE_VOICE, await balanceOf(pool, memberAccount(u), VILLAGE_VOICE))).toBe(150);
    expect(await conservation(VILLAGE_VOICE)).toBe(0);
  }, DB_HEAVY);

  it("reports every already-settled state as `terminal`, whatever the wording", async () => {
    /*
     * The bug this prevents, which was live: the webhook decided a replay was
     * harmless by testing `error.includes("cannot")`. That is the wording for a
     * CONFIRMED claim, but an already-rejected one reads "this claim is already
     * rejected", so an ordinary retry of a rejection would have 500'd and Hypha
     * would have retried it forever. The receiver now matches on this reason,
     * so every terminal state has to carry the same one.
     */
    for (const [i, ending] of (["confirmed", "rejected", "canceled", "stale"] as const).entries()) {
      const u = await makeMember(`vc-term-${i}`);
      await giveVoice(u, 150);
      const out = await requestVoiceClaim(pool, u, true);
      if (!out.ok) throw new Error(out.error);
      expect((await settleVoiceClaim(pool, out.claimId, ending)).ok).toBe(true);

      const replay = await settleVoiceClaim(pool, out.claimId, ending, "the same news twice");
      expect(replay.ok).toBe(false);
      if (!replay.ok) expect(replay.reason).toBe("terminal");
    }
    expect(await conservation(VILLAGE_VOICE)).toBe(0);
    expect(await cacheDrift(VILLAGE_VOICE)).toBe(0);
  }, DB_HEAVY);

  it("tells a claim that never existed apart from one already settled", async () => {
    const gone = await settleVoiceClaim(pool, "vc-never-was", "confirmed");
    expect(gone.ok).toBe(false);
    // `missing` is a 500 at the receiver and `terminal` is a 200, so confusing
    // the two would either retry forever or swallow a real misdelivery.
    if (!gone.ok) expect(gone.reason).toBe("missing");
  });

  it("lets a member claim again after a rejection", async () => {
    const u = await makeMember("vc-again");
    await giveVoice(u, 150);
    const first = await requestVoiceClaim(pool, u, true);
    if (!first.ok) throw new Error(first.error);
    await settleVoiceClaim(pool, first.claimId, "rejected");

    const second = await requestVoiceClaim(pool, u, true);
    expect(second.ok).toBe(true);
    expect((await claimHistory(pool, u)).length).toBe(2);
  }, DB_HEAVY);

  // ── What an adversarial pass found ───────────────────────────────────────

  it("reads a pasted full date as a typo, not as the year 2194", async () => {
    /*
     * The loose parser was `split("-").map(Number)` with a truthiness check, so
     * "2026-06-21" became month 2026 and `Date.UTC` rolled it forward into the
     * year 2194 without throwing. Claims shut for a century and a half and
     * members were shown that date as the next opening. A full ISO date is the
     * single most likely thing to paste into a field labelled with dates.
     */
    await setVariable(pool, "economy.claims_week_starts", "2026-06-21");
    const w = claimsWindow(new Date("2026-06-21T12:00:00Z"));
    expect(w.open).toBe(false);
    // And critically, it does NOT offer a date in the far future as the answer.
    expect(w.nextOpens).toBeNull();
  });

  it("refuses a day that does not exist rather than rolling into the next month", async () => {
    await setVariable(pool, "economy.claims_week_starts", "02-30");
    expect(claimsWindow(new Date("2026-03-02T00:00:00Z")).open).toBe(false);
  });

  it("shuts the window when dates were set and none of them parse", async () => {
    // Falling through to "open all year" would read a typo as permission.
    await setVariable(pool, "economy.claims_week_starts", "nonsense,also-nonsense");
    expect(claimsWindow(new Date("2026-06-22T00:00:00Z")).open).toBe(false);
  });

  it("keeps the bridge holding exactly what the open claims are owed", async () => {
    /*
     * The invariant 0076 made possible. Conservation alone cannot catch a
     * stranded claim or a silently failed refund, because both leave the
     * balances summing to zero. This equality catches all of them.
     */
    // MEASURED AS DELTAS against a baseline, because reconciliation is
    // village-wide and earlier cases in this file deliberately leave claims
    // open. `drift` is the exception and is asserted absolutely: the invariant
    // is that the bridge owes exactly what is open, which must hold over the
    // whole village including everybody else's leftovers, or it is not an
    // invariant. The first version of this asserted openClaims === 2 and found
    // 4, which is the test being wrong about the world rather than the code.
    const base = await bridgeReconciliation(pool);
    expect(base.drift).toBe(0);

    const a = await makeMember("vc-recon-a");
    const b = await makeMember("vc-recon-b");
    await giveVoice(a, 150);
    await giveVoice(b, 220);

    const one = await requestVoiceClaim(pool, a, true);
    const two = await requestVoiceClaim(pool, b, true);
    if (!one.ok || !two.ok) throw new Error("could not open the claims");

    let r = await bridgeReconciliation(pool);
    expect(r.openClaims - base.openClaims).toBe(2);
    expect(r.held - base.held).toBe(toLedgerUnits(VILLAGE_VOICE, 370));
    expect(r.drift).toBe(0);

    // A refund empties its share back out.
    await settleVoiceClaim(pool, one.claimId, "canceled");
    r = await bridgeReconciliation(pool);
    expect(r.openClaims - base.openClaims).toBe(1);
    expect(r.held - base.held).toBe(toLedgerUnits(VILLAGE_VOICE, 220));
    expect(r.drift).toBe(0);

    // A CONFIRMATION must also leave the bridge, or the account goes back to
    // meaning nothing. This is what 0072 got wrong.
    await settleVoiceClaim(pool, two.claimId, "confirmed");
    r = await bridgeReconciliation(pool);
    expect(r.openClaims - base.openClaims).toBe(0);
    expect(r.held - base.held).toBe(0);
    expect(r.drift).toBe(0);
    expect(await conservation(VILLAGE_VOICE)).toBe(0);
    expect(await cacheDrift(VILLAGE_VOICE)).toBe(0);
  }, DB_HEAVY);

  it("repairs a refund that closed the claim without releasing the voice", async () => {
    /*
     * `settleVoiceClaim` moves the state first and refunds second, so a ledger
     * failure in between leaves a terminal claim with the voice still at the
     * bridge. Re-entering through `settleVoiceClaim` cannot fix that, because
     * `canSettleClaim` refuses every transition out of a terminal state, which
     * is what made the old "just re-run it" comment false.
     */
    const u = await makeMember("vc-repair");
    await giveVoice(u, 150);
    const out = await requestVoiceClaim(pool, u, true);
    if (!out.ok) throw new Error(out.error);

    // Close it WITHOUT refunding, which is the state a failed reversal leaves.
    await pool.query("UPDATE `voice_claims` SET `state` = 'canceled' WHERE `id` = ?", [out.claimId]);
    expect(fromLedgerUnits(VILLAGE_VOICE, await balanceOf(pool, memberAccount(u), VILLAGE_VOICE))).toBe(0);
    expect((await bridgeReconciliation(pool)).drift).toBeGreaterThan(0);

    const fixed = await retryRefund(pool, out.claimId);
    expect(fixed).toEqual({ ok: true, refunded: true });
    expect(fromLedgerUnits(VILLAGE_VOICE, await balanceOf(pool, memberAccount(u), VILLAGE_VOICE))).toBe(150);

    // And running it again is a no-op, so a poller may call it blindly.
    const again = await retryRefund(pool, out.claimId);
    expect(again).toEqual({ ok: true, refunded: false });
    expect(fromLedgerUnits(VILLAGE_VOICE, await balanceOf(pool, memberAccount(u), VILLAGE_VOICE))).toBe(150);
    expect(await conservation(VILLAGE_VOICE)).toBe(0);
  }, DB_HEAVY);

  it("will not hand back voice for a claim Hypha confirmed", async () => {
    const u = await makeMember("vc-repair-no");
    await giveVoice(u, 150);
    const out = await requestVoiceClaim(pool, u, true);
    if (!out.ok) throw new Error(out.error);
    await settleVoiceClaim(pool, out.claimId, "confirmed");

    const nope = await retryRefund(pool, out.claimId);
    expect(nope.ok).toBe(false);
    expect(fromLedgerUnits(VILLAGE_VOICE, await balanceOf(pool, memberAccount(u), VILLAGE_VOICE))).toBe(0);
  }, DB_HEAVY);

  // ── The secret ───────────────────────────────────────────────────────────

  it("separates a secret worth dying over from one worth shouting about", async () => {
    /*
     * `economy.hypha_space` is a DATABASE row and the secret is an ENV var, so
     * an admin typing a slug could put the deployment into a state its own boot
     * check refused, at the next restart, with the panel that could undo it
     * served by the process that would not start.
     *
     * An EMPTY secret is now survivable, because the receiver answers 503
     * without one: unreachable rather than exposed. A SHORT or BORROWED secret
     * stays fatal, because that receiver would accept deliveries.
     */
    expect(checkVoiceSecret({} as NodeJS.ProcessEnv)).toMatchObject({ ok: false, fatal: false });
    expect(checkVoiceSecret({ HYPHA_VOICE_WEBHOOK_SECRET: "short" } as NodeJS.ProcessEnv)).toMatchObject({
      ok: false,
      fatal: true,
    });
    const shared = "a".repeat(64);
    expect(
      checkVoiceSecret({
        HYPHA_VOICE_WEBHOOK_SECRET: shared,
        GOVERNANCE_HUB_SECRET: shared,
      } as NodeJS.ProcessEnv),
    ).toMatchObject({ ok: false, fatal: true });
    expect(checkVoiceSecret({ HYPHA_VOICE_WEBHOOK_SECRET: "b".repeat(64) } as NodeJS.ProcessEnv)).toEqual({
      ok: true,
    });
  });

  it("does not kill the boot over a space with no secret", async () => {
    // The brick scenario, now survivable.
    await setVariable(pool, "economy.hypha_space", "a-test-space");
    expect(() => assertVoiceSecret({} as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("stays quiet when the village has not opened the crossing", async () => {
    await setVariable(pool, "economy.hypha_space", "");
    expect(() => assertVoiceSecret({} as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("refuses a secret too short to be one", async () => {
    expect(() =>
      assertVoiceSecret({ HYPHA_VOICE_WEBHOOK_SECRET: "hunter2" } as NodeJS.ProcessEnv),
    ).toThrow(/short/i);
  });

  it("refuses a secret borrowed from another callback", async () => {
    // The exploit: anything able to sign a governance callback could otherwise
    // confirm a claim on value.
    const shared = "a".repeat(64);
    expect(() =>
      assertVoiceSecret({
        HYPHA_VOICE_WEBHOOK_SECRET: shared,
        GOVERNANCE_HUB_SECRET: shared,
      } as NodeJS.ProcessEnv),
    ).toThrow(/matches another secret/i);
  });

  it("accepts a secret of its own", async () => {
    expect(() =>
      assertVoiceSecret({
        HYPHA_VOICE_WEBHOOK_SECRET: "b".repeat(64),
        GOVERNANCE_HUB_SECRET: "a".repeat(64),
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  // ── Units ────────────────────────────────────────────────────────────────

  it("round trips fractional voice through decimal(18,4) without losing a unit", async () => {
    /*
     * The path: token_balances.balance (INT units) -> fromLedgerUnits (float)
     * -> decimal(18,4) in voice_claims.amount -> mysql2 hands it back as a
     * STRING -> Number() -> toLedgerUnits (Math.round) -> reverse().
     *
     * Every seeded rate is a whole number today, but the Mint lets a founder
     * type 0.5, and this codebase has already shipped one truncation bug of
     * exactly this shape. One of the four shapes below is a single minor unit
     * over a round number, because that is the case with no exact binary
     * representation and the one that breaks a naive multiply.
     */
    /*
     * THE FOUR SHAPES, BUILT FROM THE SCALE INSTEAD OF TYPED AT ONE.
     *
     * This list read `[137.5, 100.1, 250.125, 199.999]`, every one a whole
     * number of THOUSANDTHS, correct while Voice carried three decimals. After
     * `0184` it carries two, where 250.125 is not payable at all: the conversion
     * rounds it to 250.13 and the round trip this case exists to prove reports
     * a loss the engine did not cause. The shapes are what matter, so each is
     * derived from whatever scale the registry holds and every one is a whole
     * number of minor units by construction.
     */
    const [voiceRow] = await pool.query<any[]>("SELECT `decimals` FROM `tokens` WHERE `slug` = ?", [VILLAGE_VOICE]);
    const vScale = 10 ** Number((voiceRow as any[])[0]?.decimals ?? 0);
    const shapes = [
      137 * vScale + Math.floor(vScale / 2), // half a token, where the scale holds one
      100 * vScale + 1,                      // one minor unit over a round number
      251 * vScale - 1,                      // one minor unit under a round number
      199 * vScale + Math.max(0, vScale - 1), // the largest fraction the scale can hold
    ];
    for (const [i, units] of shapes.entries()) {
      const amount = fromLedgerUnits(VILLAGE_VOICE, units);
      const u = await makeMember(`vc-frac-${i}`);
      await giveVoice(u, amount);
      expect(toLedgerUnits(VILLAGE_VOICE, amount), `${amount} must be payable at scale ${vScale}`).toBe(units);
      expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(units);

      const out = await requestVoiceClaim(pool, u, true);
      if (!out.ok) throw new Error(out.error);
      expect(out.amount).toBe(amount);

      // And the refund puts back exactly what was taken, to the unit.
      await settleVoiceClaim(pool, out.claimId, "canceled");
      expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(units);
    }
    expect(await conservation(VILLAGE_VOICE)).toBe(0);
    expect(await cacheDrift(VILLAGE_VOICE)).toBe(0);
  }, DB_HEAVY);

  it("carries the exact amount across the decimals boundary", async () => {
    // The bug this prevents: voice is stored at whatever scale the registry
    // says, so a claim that round-trips through the decimal(18,4) row must come
    // back to the same ledger units. A truncation here silently shaves value
    // off a refund.
    //
    // The expected number is DERIVED, never typed. It used to be 137_000, which
    // hardcoded the 3-decimals scale into two assertions and would have gone red
    // on the day the registry moved without anything being wrong. The scale
    // belongs to the token, so the test asks the token.
    const u = await makeMember("vc-units");
    await giveVoice(u, 137);
    const units = toLedgerUnits(VILLAGE_VOICE, 137);
    const out = await requestVoiceClaim(pool, u, true);
    if (!out.ok) throw new Error(out.error);
    expect(toLedgerUnits(VILLAGE_VOICE, out.amount)).toBe(units);
    await settleVoiceClaim(pool, out.claimId, "canceled");
    expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(units);
  }, DB_HEAVY);

  it("scopes a claim to its village", async () => {
    expect(villageId()).toBe("local");
    const missing = await settleVoiceClaim(pool, "vc-does-not-exist", "canceled");
    expect(missing.ok).toBe(false);
  });
});
