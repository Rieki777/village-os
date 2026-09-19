/**
 * What a redemption ballot DOES, at every ending, against a real schema.
 *
 * The closer is called by governance's engine and never by a route, so these
 * cases call it the way the engine does: directly, with a ballot row naming the
 * redemption. `onUnlanded` is called directly for the same reason, and because
 * the engine LOGS a throw and never retries it (server/lib/applyDue.ts), which
 * makes "a second call is a no-op" a property a person depends on rather than a
 * nicety.
 *
 * WHAT EACH CASE IS FOR:
 *   passed          the hold burns to sys:redeemed, through the same door a
 *                   steward's confirmation uses
 *   failed          the hold comes back in full
 *   no_quorum       the same, because too few voting is not the village saying no
 *   onWithdraw      the same, because a pulled ballot does not keep the tokens
 *   onUnlanded      the same, for a veto and for a write-off: the village's yes
 *                   was stopped, and nothing else would ever release the hold
 *   twice           the second call reverses NOTHING further and does not throw
 *   broken ledger   a genuine failure throws, naming the redemption, the member
 *                   and the repair, because the engine's report is where it lands
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { CYCLE_POOL_FAUCET, balanceOf, loadTokenRegistry, memberAccount } from "./lib/ledger";
import { CREDITS, cycleWindow, mint, toLedgerUnits, villageId } from "./lib/economy";
import { loadVariables, setVariable } from "./lib/variables";
import { REDEEMED, REDEMPTION_HOLD } from "./lib/redemption";
import { redemptionById, requestRedemption } from "./lib/redemptionStore";
import { openRedemptionBallot, redemptionCloser, REDEMPTION_SUBJECT } from "./lib/redemptionBallot";
import type { BallotRow } from "./lib/ballots";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[redemptionBallot] TEST_DATABASE_URL not set. This suite SKIPPED.");
}

describe.skipIf(!configured)("a redemption the village votes on", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let seq = 0;
  const told: Array<{ userId: string; type: string; title: string }> = [];

  const closer = () =>
    redemptionCloser({
      getPool: () => pool,
      notify: async (input) => {
        told.push({ userId: input.userId, type: input.type, title: input.title });
        return { ok: true };
      },
    });

  /** A ballot row carrying only what the closer reads. */
  const ballotFor = (redemptionId: string): BallotRow =>
    ({ id: `bal-${redemptionId}`, subjectType: REDEMPTION_SUBJECT, subjectRef: redemptionId, openedBy: "wren" } as BallotRow);

  const seedMember = async (id: string) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
        "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
      [id, id, `${id}@examples.invalid`],
    );
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
      [memberAccount(id), "member", id, id],
    );
    const res = await mint(pool, {
      toUserId: id,
      tokenSlug: CREDITS,
      amount: toLedgerUnits(CREDITS, 100),
      from: CYCLE_POOL_FAUCET,
      source: "test",
      idempotencyKey: `ballot-credits:${id}:${++seq}`,
      description: "seed",
    });
    if (!res.ok) throw new Error(`could not seed credits: ${res.error}`);
  };

  /** Open a request the ordinary way, so the hold is a real posting. */
  const askFor = async (userId: string, human = 20): Promise<string> => {
    const out = await requestRedemption(pool, {
      userId,
      tokenSlug: CREDITS,
      amountUnits: toLedgerUnits(CREDITS, human),
      askedFor: "a bicycle",
      exitOpen: false,
      cycleStart: cycleWindow().startsAt,
    });
    if (!out.ok) throw new Error(`the ask did not land: ${out.error}`);
    return out.row.id;
  };

  const held = () => balanceOf(pool, REDEMPTION_HOLD, CREDITS);
  const retired = () => balanceOf(pool, REDEEMED, CREDITS);
  const mine = (userId: string) => balanceOf(pool, memberAccount(userId), CREDITS);

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, connectionLimit: 4, timezone: "Z" }); // module-review-ok: fixture pool on the S5 scratch schema
    await loadTokenRegistry(pool);
    await loadVariables(pool);
    await setVariable(pool, "redemption.holds_on_propose", "true");
    await setVariable(pool, "redemption.per_member_per_cycle", "50");
    await seedMember("wren");
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    told.length = 0;
  });

  it("burns the hold when the village passes it", async () => {
    const before = await mine("wren");
    const id = await askFor("wren");
    expect(await mine("wren")).toBe(before - toLedgerUnits(CREDITS, 20));
    const retiredBefore = await retired();

    await closer().settle(ballotFor(id), "passed", "the village agreed Wren was paid", "closer");

    expect((await redemptionById(pool, id))?.state).toBe("confirmed");
    expect(await retired()).toBe(retiredBefore + toLedgerUnits(CREDITS, 20));
    // The member is not paid back: they were paid off the platform.
    expect(await mine("wren")).toBe(before - toLedgerUnits(CREDITS, 20));
    expect(told.map((t) => t.type)).toContain("redemption_confirmed");
  }, 300_000);

  it("gives the tokens back when the village fails it, and when too few vote", async () => {
    for (const outcome of ["failed", "no_quorum"] as const) {
      const before = await mine("wren");
      const id = await askFor("wren");
      await closer().settle(ballotFor(id), outcome, "", "closer");
      expect((await redemptionById(pool, id))?.state, outcome).toBe("refused");
      expect(await mine("wren"), outcome).toBe(before);
    }
    expect(await held()).toBe(0);
  }, 300_000);

  it("gives the tokens back when the ballot is withdrawn", async () => {
    const before = await mine("wren");
    const id = await askFor("wren");
    await closer().onWithdraw?.(ballotFor(id));
    expect((await redemptionById(pool, id))?.state).toBe("refused");
    expect(await mine("wren")).toBe(before);
  }, 300_000);

  /*
   * THE HOOK THIS FILE EXISTS FOR. A passed ballot stopped in its landing
   * window, or written off after it stalled, is the one ending where nothing
   * else would ever release the hold: the ballot is over so no closer runs
   * again, and the expiry reaper only looks at rows still `requested`.
   */
  it("gives the tokens back when a passed decision is vetoed, and when it is written off", async () => {
    for (const reason of ["vetoed", "written_off"] as const) {
      const before = await mine("wren");
      const id = await askFor("wren");
      await closer().onUnlanded?.(ballotFor(id), reason);
      expect((await redemptionById(pool, id))?.state, reason).toBe("refused");
      expect(await mine("wren"), reason).toBe(before);
      expect(told.some((t) => t.type === "redemption_refused"), reason).toBe(true);
    }
    expect(await held()).toBe(0);
  }, 300_000);

  it("is a no-op the second time, and never a second refund", async () => {
    const before = await mine("wren");
    const id = await askFor("wren");
    await closer().onUnlanded?.(ballotFor(id), "vetoed");
    const afterFirst = await mine("wren");
    expect(afterFirst).toBe(before);

    // The engine calls once, but a person is the retry when it throws, so the
    // second call has to be safe. It must not reverse anything further.
    await closer().onUnlanded?.(ballotFor(id), "vetoed");
    expect(await mine("wren")).toBe(afterFirst);
    expect(await held()).toBe(0);
  }, 300_000);

  it("is a no-op when a steward already refused the same request", async () => {
    const before = await mine("wren");
    const id = await askFor("wren");
    // A steward's refusal through the ordinary door.
    const { settleRedemption } = await import("./lib/redemptionStore");
    await settleRedemption(pool, { id, to: "refused", actorUserId: "ash", note: "not this moon" });
    expect(await mine("wren")).toBe(before);

    await closer().onUnlanded?.(ballotFor(id), "written_off");
    expect(await mine("wren")).toBe(before);
    expect((await redemptionById(pool, id))?.state).toBe("refused");
  }, 300_000);

  /*
   * A REAL FAILURE THROWS, AND THE MESSAGE IS THE WHOLE POINT. The engine logs
   * it and never retries, and the failed-actions tab does not keep rows in this
   * landing state, so the sentence a person eventually reads has to name the
   * redemption, the member and what to run.
   */
  it("throws a message a person can act on when the ledger cannot give the tokens back", async () => {
    const id = await askFor("wren");
    const row = await redemptionById(pool, id);
    // Break the reversal by removing the posting it mirrors.
    await pool.query("DELETE FROM `token_ledger` WHERE `idempotency_key` = ?", [row!.holdKey]); // module-review-ok: fixture breaking one posting on the S5 scratch schema, to drive the failure path
    await pool.query("DELETE FROM `token_balances` WHERE `account_id` = ?", [REDEMPTION_HOLD]); // module-review-ok: fixture on the S5 scratch schema

    await expect(closer().onUnlanded?.(ballotFor(id), "vetoed")).rejects.toThrow(
      new RegExp(`${id}[\\s\\S]*wren[\\s\\S]*retryRelease`),
    );
  }, 300_000);

  /*
   * OPENING ONE. The vote path is refused at the door while VOTE_PATH_BUILT is
   * false, so this drives the opener directly: it is the half that has to be
   * right BEFORE the flag flips, because a vote-mode request whose ballot never
   * opened would hold tokens with nothing left to decide them.
   */
  it("opens a ballot the village can actually vote on, carrying the member's own words", async () => {
    const id = await askFor("wren", 20);
    const out = await openRedemptionBallot(
      pool,
      {
        method: "majority",
        dials: { unityPct: 60, quorumPct: 30 },
        snapshot: { mode: "equal", token: null },
        electorate: [{ userId: "wren", weight: 1 }],
        durationDays: 3,
      },
      id,
    );
    expect(out.ok, out.ok ? "" : out.error).toBe(true);
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT subject_type, subject_ref, title, doc_markdown, opened_by FROM ballots WHERE subject_ref = ?",
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].subject_type).toBe(REDEMPTION_SUBJECT);
    expect(String(rows[0].opened_by)).toBe("wren");
    // What a yes MEANS has to be on the ballot, not only in the panel.
    expect(String(rows[0].doc_markdown)).toContain("a bicycle");
    expect(String(rows[0].doc_markdown)).toContain("HAS BEEN PAID");
  }, 300_000);

  it("says so instead of throwing when the redemption is gone entirely", async () => {
    const out = await closer().settle(ballotFor("rdm-nobody"), "passed", "", "closer");
    expect(out.held).toContain("no longer exists");
  }, 300_000);
});
