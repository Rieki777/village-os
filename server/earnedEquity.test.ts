/**
 * Earned equity: accrued here, claimed across to Hypha, and never the mirror.
 *
 * WHAT THIS HAS TO PROVE, in the order a founder would ask it:
 *
 *   1. The token 0266 seeds is the village's to mint and nobody's to sell or
 *      send, and the `equity` mirror beside it is still unmovable.
 *   2. A claim on it is gated shut by the same honesty Village Voice is, so no
 *      member can be debited toward a Hypha that will never be told.
 *   3. With the gate held open by the test, a claim on it runs through the SAME
 *      code a voice claim does: debit at request into its own bridge, refund by
 *      reversal, confirm into its own settled account, repair by retry.
 *   4. The two lanes never see each other. An open equity claim does not block
 *      a voice claim, does not count as voice the voice bridge owes, and a row
 *      naming a token no lane carries is refused before its state moves.
 *
 * Every ledger case re-proves conservation and cache drift for BOTH tokens
 * afterwards, because a lane that settled into the wrong account would still
 * conserve for one of them and not for the other.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied, unique per provision. No TEST_DATABASE_URL and the suite skips
 * loudly rather than passing hollowly.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import {
  EARNED_EQUITY,
  EQUITY_BRIDGE,
  EQUITY_MINT,
  VILLAGE_VOICE,
  VOICE_BRIDGE,
  VOICE_MINT,
  ensureVoiceToken,
  faucetFor,
  fromLedgerUnits,
  mint,
  ruleCannotPay,
  rulesFor,
  toLedgerUnits,
} from "./lib/economy";
import { balanceOf, checkLedgerInvariants, loadTokenRegistry, memberAccount, postTransfer, tokenDef } from "./lib/ledger";
import { loadVariables, setVariable } from "./lib/variables";
import { tradingProblem } from "./lib/exchange";
import { isPriceableToken, priceRefusal } from "./lib/spending";
import { seedEconomy } from "./lib/economySeed";
import {
  BRIDGE_DISPATCH_BUILT,
  EQUITY_LANE,
  EQUITY_SETTLED,
  VOICE_LANE,
  bridgeReconciliation,
  claimHistory,
  claimReadinessFor,
  laneForToken,
  requestClaim,
  requestVoiceClaim,
  retryRefund,
  settleClaim,
  settleVoiceClaim,
} from "./lib/voiceClaim";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[earnedEquity] TEST_DATABASE_URL not set. This suite SKIPPED.");
}

let db: TestDb;
let pool: mysql.Pool;
let seq = 0;

async function makeMember(id: string): Promise<string> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@examples.invalid`],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
    [memberAccount(id), "member", id, id],
  );
  return id;
}

/** Put a token in somebody's hands the honest way: out of its own faucet, through `mint`. */
async function give(userId: string, slug: string, human: number): Promise<void> {
  const res = await mint(pool, {
    toUserId: userId,
    tokenSlug: slug,
    amount: toLedgerUnits(slug, human),
    from: faucetFor(slug)!,
    source: "test",
    idempotencyKey: `test-earned-equity:${userId}:${slug}:${++seq}`,
    description: "seed",
  });
  if (!res.ok) throw new Error(`could not seed ${slug}: ${res.error}`);
}

const held = async (account: string, slug: string) => fromLedgerUnits(slug, await balanceOf(pool, account, slug));

/** Per token, balances summed across every account. Must be zero. */
async function conservation(slug: string): Promise<number> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT COALESCE(SUM(`balance`),0) AS s FROM `token_balances` WHERE `token_type` = ?",
    [slug],
  );
  return Number(rows[0]?.s ?? 0);
}

/** Does the cached balance still match what the postings say? */
async function cacheDrift(slug: string): Promise<number> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT COUNT(*) AS n FROM `token_balances` tb LEFT JOIN (" +
      "  SELECT account_id, token_type, SUM(delta) actual FROM (" +
      "    SELECT to_account account_id, token_type, amount delta FROM token_ledger" +
      "    UNION ALL SELECT from_account, token_type, -amount FROM token_ledger" +
      "  ) m GROUP BY account_id, token_type) x " +
      "ON x.account_id = tb.account_id AND x.token_type = tb.token_type " +
      "WHERE tb.token_type = ? AND tb.balance <> COALESCE(x.actual, 0)",
    [slug],
  );
  return Number(rows[0]?.n ?? 0);
}

async function claimRow(id: string): Promise<any> {
  const [rows] = await pool.query<any[]>("SELECT * FROM `voice_claims` WHERE `id` = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return rows[0];
}

async function bothBooksBalance(): Promise<void> {
  for (const slug of [EARNED_EQUITY, VILLAGE_VOICE]) {
    expect(await conservation(slug), `${slug} does not conserve`).toBe(0);
    expect(await cacheDrift(slug), `${slug} has cache drift`).toBe(0);
  }
  expect((await bridgeReconciliation(pool, EQUITY_LANE)).drift).toBe(0);
  expect((await bridgeReconciliation(pool, VOICE_LANE)).drift).toBe(0);
}

describe.skipIf(!configured)("earned equity, claimed toward Hypha", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 10 });
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
    // whose crossing is configured. Only the bridge gate stays as shipped.
    await setVariable(pool, "economy.hypha_space", "a-test-space");
    await setVariable(pool, "economy.claims_week_starts", "");
    await setVariable(pool, "economy.voice_claim_threshold", "100");
    await setVariable(pool, "economy.equity_claim_threshold", "1");
  });

  // ── The token ────────────────────────────────────────────────────────────

  it("arrives from 0266 as the village's to mint and nobody's to send", async () => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `slug`, `name`, `kind`, `governance`, `transferable`, `decimals`, `spendable`, `active` " +
        "FROM `tokens` WHERE `slug` = ?",
      [EARNED_EQUITY],
    );
    expect(rows).toEqual([
      {
        slug: "earned-equity",
        name: "Earned Equity",
        kind: "equity",
        governance: "platform",
        transferable: 0,
        decimals: 0,
        spendable: 0,
        active: 1,
      },
    ]);
    // The registry the engine reads agrees with the table.
    expect(tokenDef(EARNED_EQUITY)).toMatchObject({ kind: "equity", governance: "platform", transferable: false });

    // A rule can pay it, out of its own faucet.
    expect(faucetFor(EARNED_EQUITY)).toBe(EQUITY_MINT);
    expect(ruleCannotPay(EARNED_EQUITY)).toBeNull();

    const [accounts] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `id`, `faucet` FROM `ledger_accounts` WHERE `id` IN (?,?,?) ORDER BY `id`",
      [EQUITY_BRIDGE, EQUITY_MINT, EQUITY_SETTLED],
    );
    expect(accounts).toEqual([
      { id: "sys:equity-bridge", faucet: 0 },
      { id: "sys:equity-mint", faucet: 1 },
      { id: "sys:equity-settled", faucet: 0 },
    ]);
  });

  it("can never be bought, swapped or priced", () => {
    expect(tradingProblem(EARNED_EQUITY)).toMatch(/equity token/);
    expect(isPriceableToken(EARNED_EQUITY)).toBe(false);
    expect(priceRefusal(EARNED_EQUITY)).toMatch(/credit token/);
  });

  it("leaves the Hypha mirror exactly as unmovable as it was", async () => {
    const u = await makeMember("ee-mirror");
    // The mirror's refusal is the ledger's own, by name, before anything opens.
    const refused = await postTransfer(pool, {
      from: EQUITY_MINT,
      to: memberAccount(u),
      tokenType: "equity",
      amount: 1,
      source: "test",
      idempotencyKey: `test-mirror:${u}`,
    });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/issued on Hypha and only read here/);
    // And the mint path refuses it the same way.
    const viaMint = await mint(pool, {
      toUserId: u,
      tokenSlug: "equity",
      amount: 1,
      from: EQUITY_MINT,
      source: "test",
      idempotencyKey: `test-mirror-mint:${u}`,
    });
    expect(viaMint.ok).toBe(false);
    expect(faucetFor("equity")).toBeNull();
    expect(ruleCannotPay("equity")).toMatch(/governed on Hypha/);

    // The boot check still finds no ledger row for any hypha token.
    const report = await checkLedgerInvariants(pool);
    expect(report.problems.filter((p) => p.startsWith("hypha token"))).toEqual([]);
  });

  it("mints from its own faucet, whose negative balance is the equity issued", async () => {
    const u = await makeMember("ee-mint");
    const before = await held(EQUITY_MINT, EARNED_EQUITY);
    await give(u, EARNED_EQUITY, 5);
    expect(await held(memberAccount(u), EARNED_EQUITY)).toBe(5);
    expect(await held(EQUITY_MINT, EARNED_EQUITY)).toBe(before - 5);
    await bothBooksBalance();
  });

  it("is seeded three rules, all switched off, so a village decides what pays it", async () => {
    await seedEconomy(pool, "local");
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `id`, `trigger`, `amount`, `ceiling`, `recipient`, `enabled` FROM `mint_rules` " +
        "WHERE `token_slug` = ? ORDER BY `trigger`",
      [EARNED_EQUITY],
    );
    // An accepted proposal is work too (Rye, 2026-10-23), so it gets an Earned
    // Equity rule beside the quest's and the role's, off like them.
    // The role's is blank: no flat role mint (Rye, 2026-11-01), so a role pays
    // Earned Equity only from its own list once a village turns this on.
    expect(rows.map((r) => ({ ...r, amount: r.amount === null ? null : Number(r.amount), ceiling: Number(r.ceiling) }))).toEqual([
      { id: "rule-proposal.accepted-earned-equity", trigger: "proposal.accepted", amount: 1, ceiling: 1, recipient: "claimant", enabled: 0 },
      { id: "rule-quest.completed-earned-equity", trigger: "quest.completed", amount: 1, ceiling: 1, recipient: "claimant", enabled: 0 },
      { id: "rule-role.cycle-earned-equity", trigger: "role.cycle", amount: null, ceiling: 1, recipient: "holder", enabled: 0 },
    ]);
    // Off means the engine never reads them.
    for (const trigger of ["proposal.accepted", "quest.completed", "role.cycle"]) {
      expect((await rulesFor(pool, trigger)).some((r) => r.tokenSlug === EARNED_EQUITY)).toBe(false);
    }
  });

  // ── The gate ─────────────────────────────────────────────────────────────

  it("takes nothing while nothing can raise the proposal", async () => {
    // Same trap the voice suite names: naming the Hypha space is the last piece
    // of configuration and not the last piece of work. This fails loudly the
    // day the dispatch ships, so whoever ships it rewrites it on purpose.
    const u = await makeMember("ee-gate");
    await give(u, EARNED_EQUITY, 4);
    const ready = await claimReadinessFor(pool, u, EQUITY_LANE);
    if (!BRIDGE_DISPATCH_BUILT) {
      expect(ready.bridgeReady).toBe(false);
      expect(ready.claimable).toBe(false);
      expect(ready.says).toContain("still being finished");
      const out = await requestClaim(pool, u, EQUITY_LANE); // bare: the gate is what is under test
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.status).toBe(503);
      expect(await held(memberAccount(u), EARNED_EQUITY)).toBe(4);
      const [rows] = await pool.query<any[]>("SELECT `id` FROM `voice_claims` WHERE `user_id` = ?", [u]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      expect(rows.length).toBe(0);
    } else {
      throw new Error(
        "BRIDGE_DISPATCH_BUILT is now true. Rewrite this case to prove the dispatch raises one intent " +
          "per equity claim, as server/voiceClaim.test.ts must be rewritten for voice.",
      );
    }
  });

  it("names its own threshold, and stays shut below it", async () => {
    await setVariable(pool, "economy.equity_claim_threshold", "10");
    const u = await makeMember("ee-short");
    await give(u, EARNED_EQUITY, 3);
    const ready = await claimReadinessFor(pool, u, EQUITY_LANE, true);
    expect(ready.token).toBe(EARNED_EQUITY);
    expect(ready.threshold).toBe(10);
    expect(ready.claimable).toBe(false);
    expect(ready.says).toBe("3 gathered. Claims open at 10.");
    const out = await requestClaim(pool, u, EQUITY_LANE, true);
    expect(out.ok).toBe(false);
    expect(await held(memberAccount(u), EARNED_EQUITY)).toBe(3);
  });

  it("offers no claim on nothing, whatever the threshold says", async () => {
    const u = await makeMember("ee-empty");
    const ready = await claimReadinessFor(pool, u, EQUITY_LANE, true);
    expect(ready.balance).toBe(0);
    expect(ready.claimable).toBe(false);
    const out = await requestClaim(pool, u, EQUITY_LANE, true);
    expect(out.ok).toBe(false);
  });

  // ── The claim, through the shared machinery ──────────────────────────────

  it("debits into the equity bridge, and a voice claim beside it is its own", async () => {
    const u = await makeMember("ee-both");
    await give(u, EARNED_EQUITY, 7);
    await give(u, VILLAGE_VOICE, 150);
    const eqBase = await bridgeReconciliation(pool, EQUITY_LANE);
    const vBase = await bridgeReconciliation(pool, VOICE_LANE);

    const eq = await requestClaim(pool, u, EQUITY_LANE, true);
    if (!eq.ok) throw new Error(eq.error);
    expect(eq.amount).toBe(7);
    expect(await held(memberAccount(u), EARNED_EQUITY)).toBe(0);
    expect(await held(EQUITY_BRIDGE, EARNED_EQUITY)).toBe(7);
    // Voice was not touched by an equity claim.
    expect(await held(memberAccount(u), VILLAGE_VOICE)).toBe(150);

    // ONE OPEN CLAIM PER TOKEN: the equity claim does not block a voice claim.
    const voice = await requestVoiceClaim(pool, u, true);
    if (!voice.ok) throw new Error(voice.error);
    expect(voice.amount).toBe(150);
    // And a second equity claim is refused while the first is open.
    await give(u, EARNED_EQUITY, 2);
    const again = await requestClaim(pool, u, EQUITY_LANE, true);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already have a claim");

    // Each bridge owes exactly its own open claims, and neither counts the other's.
    const eqNow = await bridgeReconciliation(pool, EQUITY_LANE);
    const vNow = await bridgeReconciliation(pool, VOICE_LANE);
    expect(eqNow.openClaims - eqBase.openClaims).toBe(1);
    expect(eqNow.held - eqBase.held).toBe(toLedgerUnits(EARNED_EQUITY, 7));
    expect(vNow.openClaims - vBase.openClaims).toBe(1);
    expect(vNow.held - vBase.held).toBe(toLedgerUnits(VILLAGE_VOICE, 150));
    await bothBooksBalance();

    // The row says which lane it is, and carries that lane's keys.
    const row = await claimRow(eq.claimId);
    expect(row.token_slug).toBe(EARNED_EQUITY);
    expect(eq.claimId.startsWith("ec-")).toBe(true);
    expect(row.debit_key).toBe(`equity-claim-debit:local:${eq.claimId}`);
    expect(row.intent_key).toBe(`equity-claim:local:${eq.claimId}`);
    const vRow = await claimRow(voice.claimId);
    expect(vRow.token_slug).toBe(VILLAGE_VOICE);
    expect(vRow.debit_key).toBe(`voice-claim-debit:local:${voice.claimId}`);
    expect(vRow.intent_key).toBe(`voice-claim:local:${voice.claimId}`);

    // Histories are per lane.
    expect((await claimHistory(pool, u, 20, EQUITY_LANE)).map((c) => c.id)).toEqual([eq.claimId]);
    expect((await claimHistory(pool, u)).map((c) => c.id)).toEqual([voice.claimId]);
  });

  it("refunds a cancel by reversal, through the lane on the row", async () => {
    const u = await makeMember("ee-cancel");
    await give(u, EARNED_EQUITY, 6);
    const eq = await requestClaim(pool, u, EQUITY_LANE, true);
    if (!eq.ok) throw new Error(eq.error);

    // The name every existing caller uses settles an equity claim too.
    const out = await settleVoiceClaim(pool, eq.claimId, "canceled", "The member withdrew it");
    expect(out).toEqual({ ok: true, refunded: true });
    expect(await held(memberAccount(u), EARNED_EQUITY)).toBe(6);
    expect((await claimRow(eq.claimId)).state).toBe("canceled");

    // The refund is a mirror of the debit, never a fresh mint.
    const [mirror] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `from_account`, `to_account`, `source`, `token_type` FROM `token_ledger` WHERE `idempotency_key` = ?",
      [`reversal:local:equity-claim-debit:local:${eq.claimId}`],
    );
    expect(mirror).toEqual([
      { from_account: EQUITY_BRIDGE, to_account: memberAccount(u), source: "reversal", token_type: EARNED_EQUITY },
    ]);
    await bothBooksBalance();
  });

  it("refunds a rejection, because nothing is confiscated for losing a vote", async () => {
    const u = await makeMember("ee-reject");
    await give(u, EARNED_EQUITY, 3);
    const eq = await requestClaim(pool, u, EQUITY_LANE, true);
    if (!eq.ok) throw new Error(eq.error);
    expect(await settleClaim(pool, eq.claimId, "rejected")).toEqual({ ok: true, refunded: true });
    expect(await held(memberAccount(u), EARNED_EQUITY)).toBe(3);
    await bothBooksBalance();
  });

  it("moves a confirmation off the bridge and onto the equity settled account", async () => {
    const u = await makeMember("ee-confirm");
    await give(u, EARNED_EQUITY, 9);
    const settledBefore = await held(EQUITY_SETTLED, EARNED_EQUITY);
    const eq = await requestClaim(pool, u, EQUITY_LANE, true);
    if (!eq.ok) throw new Error(eq.error);

    expect(await settleClaim(pool, eq.claimId, "confirmed")).toEqual({ ok: true, refunded: false });
    expect(await held(memberAccount(u), EARNED_EQUITY)).toBe(0);
    expect(await held(EQUITY_SETTLED, EARNED_EQUITY)).toBe(settledBefore + 9);
    // Nothing of it landed on the voice side.
    const [voiceSide] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) AS n FROM `token_ledger` WHERE `source_ref` = ? AND `token_type` <> ?",
      [eq.claimId, EARNED_EQUITY],
    );
    expect(Number(voiceSide[0].n)).toBe(0);

    // And a confirmed claim can never be cancelled into a second payment.
    const late = await settleClaim(pool, eq.claimId, "canceled");
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.reason).toBe("terminal");
    expect(await held(memberAccount(u), EARNED_EQUITY)).toBe(0);
    await bothBooksBalance();
  });

  it("repairs an equity refund that closed without releasing, and the repair is idempotent", async () => {
    const u = await makeMember("ee-repair");
    await give(u, EARNED_EQUITY, 5);
    const eq = await requestClaim(pool, u, EQUITY_LANE, true);
    if (!eq.ok) throw new Error(eq.error);
    // Close it WITHOUT refunding, which is the state a failed reversal leaves.
    await pool.query("UPDATE `voice_claims` SET `state` = 'canceled' WHERE `id` = ?", [eq.claimId]); // module-review-ok: fixture standing in for a reversal that failed
    expect((await bridgeReconciliation(pool, EQUITY_LANE)).drift).toBeGreaterThan(0);
    // The voice bridge is not blamed for it.
    expect((await bridgeReconciliation(pool, VOICE_LANE)).drift).toBe(0);

    expect(await retryRefund(pool, eq.claimId)).toEqual({ ok: true, refunded: true });
    expect(await retryRefund(pool, eq.claimId)).toEqual({ ok: true, refunded: false });
    expect(await held(memberAccount(u), EARNED_EQUITY)).toBe(5);
    await bothBooksBalance();
  });

  it("refuses a claim row for a token no lane carries, before its state moves", async () => {
    const u = await makeMember("ee-stray");
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `voice_claims` (`id`, `village_id`, `user_id`, `token_slug`, `amount`, `state`, `debit_key`, `intent_key`) " +
        "VALUES ('xc-stray', 'local', ?, 'credits', 5, 'requested', 'stray-debit', 'stray-intent')",
      [u],
    );
    const out = await settleClaim(pool, "xc-stray", "canceled");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("unknown-token");
    expect((await claimRow("xc-stray")).state).toBe("requested");
    const repair = await retryRefund(pool, "xc-stray");
    expect(repair.ok).toBe(false);
    await pool.query("DELETE FROM `voice_claims` WHERE `id` = 'xc-stray'"); // module-review-ok: scratch-schema reset so the village-wide reconciliation below reads only real claims
  });

  it("knows which tokens cross and which do not", () => {
    expect(laneForToken(EARNED_EQUITY)).toBe(EQUITY_LANE);
    expect(laneForToken(VILLAGE_VOICE)).toBe(VOICE_LANE);
    // The mirrors are what a claim settles INTO; they never accrue here.
    expect(laneForToken("equity")).toBeNull();
    expect(laneForToken("voice")).toBeNull();
    expect(laneForToken("credits")).toBeNull();
    expect(EQUITY_LANE.mirror).toBe("equity");
    expect(VOICE_LANE.mirror).toBe("voice");
    // Neither bridge is the other's, and neither is a faucet's account.
    expect(EQUITY_LANE.bridge).not.toBe(VOICE_BRIDGE);
    expect(EQUITY_LANE.bridge).not.toBe(EQUITY_MINT);
    expect(VOICE_LANE.bridge).not.toBe(VOICE_MINT);
  });

  it("leaves both books whole after everything above", async () => {
    await bothBooksBalance();
    const report = await checkLedgerInvariants(pool);
    expect(report.problems).toEqual([]);
  });
});
