/**
 * THE REDEMPTION CLOSER'S OWN ERROR, THROUGH THE FAILED-ACTIONS REPORT.
 *
 * When giving back a stopped redemption vote's held tokens fails, the closer
 * throws a sentence that names the redemption, the member and the repair
 * (server/lib/redemptionBallot.ts, `giveBack`). The report copies that sentence
 * into `last_error` and scrubs member ids and addresses out of it on the way in
 * (server/repos/failedActionItems.ts, `scrubPersonal`). Two things must both be
 * true of what lands on the tab, and each has its own case below:
 *
 *  - the member id is gone, in both shapes a member id is minted in;
 *  - the redemption id is whole, because "Run retryRelease for this id" is the
 *    repair, and a scrub greedy enough to eat the id would leave a sentence that
 *    still reads fine and can no longer be acted on.
 *
 * NOTHING HERE IS A COPY OF THE CLOSER'S WORDS. The real `redemptionCloser`
 * throws, the engine's real `closeUnlanded` records it, and the report's real
 * governance area reads it back through a real run. The ids come from the code
 * that mints them: `requestRedemption` mints the redemption ids
 * (`rdm-<epoch>-<base36>`, server/lib/redemptionStore.ts). Member ids are built
 * the way their minters build them, because a member is seeded here, never
 * registered: `user-<epoch>-<8 hex>` by registration (server/routes/register.ts,
 * server/routes/authGoogle.ts) and `usr-<epoch>-<6 hex>` by bootstrap
 * (server/index.ts). The ballot ids are built the way `openBallot` builds them
 * (server/lib/ballots.ts).
 *
 * BOTH THROWS THE CLOSER HAS. A redemption still open when its vote is stopped
 * fails as "could not be released". One a steward already refused over a
 * release that failed hits the terminal branch and fails as "is refused and its
 * hold is still held". Each is driven for each member id shape, and the hold is
 * broken the way server/redemptionBallot.test.ts breaks it: its posting removed.
 *
 * No TEST_DATABASE_URL: the suite skips, and an unfiltered run fails on the way
 * out (house rule). A skip is not a pass.
 */
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { closeUnlanded, type UnlandedDeps } from "./lib/applyDue";
import { CREDITS, cycleWindow, mint, toLedgerUnits } from "./lib/economy";
import { defaultSources, runFailedActions } from "./lib/failedActions";
import { CYCLE_POOL_FAUCET, loadTokenRegistry, memberAccount } from "./lib/ledger";
import { REDEMPTION_HOLD } from "./lib/redemption";
import { REDEMPTION_SUBJECT, redemptionCloser } from "./lib/redemptionBallot";
import { redemptionById, requestRedemption, settleRedemption } from "./lib/redemptionStore";
import { loadVariables, setVariable } from "./lib/variables";
import { stuckLandings } from "./repos/governanceExecutorPending";

const configured = testDbConfigured();
if (!configured) {
  console.warn("[failedActions.redemption] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");
}

/** As server/routes/register.ts and server/routes/authGoogle.ts mint it. */
const registeredMemberId = () => `user-${Date.now()}-${randomBytes(4).toString("hex")}`;
/** As the bootstrap founder is minted in server/index.ts. */
const bootstrapMemberId = () => `usr-${Date.now()}-${randomBytes(3).toString("hex")}`;
/** As `openBallot` mints it in server/lib/ballots.ts. */
const ballotId = () => `bal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** The shape `newId` in server/lib/redemptionStore.ts mints, checked so a seeded id cannot pass for one. */
const REDEMPTION_ID = /^rdm-\d{13}-[a-z0-9]{1,6}$/;

interface Case {
  label: string;
  memberId: string;
  /** "open": still requested when the vote is stopped. "refused": a steward refused it first, over a release that failed. */
  standing: "open" | "refused";
  stoppedAs: "vetoed" | "expired";
  redemptionId: string;
  ballotId: string;
}

describe.skipIf(!configured)("the redemption closer's error, as the failed-actions report keeps it", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let seq = 0;
  const cases: Case[] = [];
  /** What the tab holds for each case, read once after the run. */
  const kept = new Map<string, { title: string; lastError: string | null }>();
  /** What the landing record holds for each case: the closer's whole sentence. */
  const recorded = new Map<string, string | null>();

  const q = (sql: string, params: unknown[] = []) => pool.query(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned

  const seedMember = async (id: string) => {
    await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [id, "Wren Halloway", `${id}@examples.invalid`]);
    await q("INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)", [
      memberAccount(id),
      "member",
      id,
      id,
    ]);
    const res = await mint(pool, {
      toUserId: id,
      tokenSlug: CREDITS,
      amount: toLedgerUnits(CREDITS, 100),
      from: CYCLE_POOL_FAUCET,
      source: "test",
      idempotencyKey: `report-redemption-credits:${id}:${++seq}`,
      description: "seed",
    });
    if (!res.ok) throw new Error(`could not seed credits: ${res.error}`);
  };

  /** Asked the ordinary way, so the id is minted by the real code and the hold is a real posting. */
  const askFor = async (userId: string): Promise<string> => {
    const out = await requestRedemption(pool, {
      userId,
      tokenSlug: CREDITS,
      amountUnits: toLedgerUnits(CREDITS, 20),
      askedFor: "a bicycle",
      exitOpen: false,
      cycleStart: cycleWindow().startsAt,
    });
    if (!out.ok) throw new Error(`the ask did not land: ${out.error}`);
    return out.row.id;
  };

  /** Seeded as `recordVetoOnBallot` or `markExpired` leaves a passed redemption vote. */
  const stoppedBallot = async (id: string, redemptionId: string, stoppedAs: "vetoed" | "expired") => {
    await q(
      "INSERT INTO `ballots` (`id`, `subject_type`, `subject_ref`, `open_key`, `title`, `doc_markdown`, `method`, `weight_mode`, " +
        "`unity_pct`, `quorum_pct`, `total_weight`, `electorate_count`, `opened_by`, `opens_at`, `closes_at`, `status`, `landing_status`) " +
        "VALUES (?, ?, ?, ?, 'Redeem 20 credits', 'body', 'custom', 'equal', 60, 20, 3, 3, 'governance', NOW(), NOW(), ?, ?)",
      [id, REDEMPTION_SUBJECT, redemptionId, `${REDEMPTION_SUBJECT}:${id}`, stoppedAs === "vetoed" ? "failed" : "passed", stoppedAs],
    );
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await loadTokenRegistry(pool);
    await loadVariables(pool);
    await setVariable(pool, "redemption.holds_on_propose", "true");
    await setVariable(pool, "redemption.per_member_per_cycle", "50");

    const registered = registeredMemberId();
    const bootstrap = bootstrapMemberId();
    for (const id of [registered, bootstrap]) await seedMember(id);
    const plan: Array<Omit<Case, "redemptionId" | "ballotId">> = [
      { label: "registered member, open redemption, vetoed", memberId: registered, standing: "open", stoppedAs: "vetoed" },
      { label: "registered member, refused redemption, written off", memberId: registered, standing: "refused", stoppedAs: "expired" },
      { label: "bootstrap member, open redemption, written off", memberId: bootstrap, standing: "open", stoppedAs: "expired" },
      { label: "bootstrap member, refused redemption, vetoed", memberId: bootstrap, standing: "refused", stoppedAs: "vetoed" },
    ];
    for (const p of plan) cases.push({ ...p, redemptionId: await askFor(p.memberId), ballotId: ballotId() });

    // Break every hold: the posting each release mirrors is removed.
    for (const c of cases) {
      const row = await redemptionById(pool, c.redemptionId);
      await q("DELETE FROM `token_ledger` WHERE `idempotency_key` = ?", [row!.holdKey]);
    }
    await q("DELETE FROM `token_balances` WHERE `account_id` = ?", [REDEMPTION_HOLD]);

    // A steward's refusal first, over the broken hold, for the terminal branch.
    for (const c of cases.filter((x) => x.standing === "refused")) {
      const out = await settleRedemption(pool, { id: c.redemptionId, to: "refused", actorUserId: null, note: "a steward refused it" });
      if (out.ok || out.reason !== "release-failed") throw new Error(`the refusal should have failed to release: ${JSON.stringify(out)}`);
    }

    const deps: UnlandedDeps = {
      pool,
      closerFor: (subjectType: string) =>
        subjectType === REDEMPTION_SUBJECT ? redemptionCloser({ getPool: () => pool, notify: async () => ({ ok: true }) }) : undefined,
    };
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const c of cases) {
        await stoppedBallot(c.ballotId, c.redemptionId, c.stoppedAs);
        const outcome = await closeUnlanded(deps, c.ballotId, c.stoppedAs === "vetoed" ? "vetoed" : "written_off");
        if (outcome !== "failed") throw new Error(`${c.label}: the give-back should have thrown, and answered ${outcome}`);
      }
    } finally {
      quiet.mockRestore();
    }

    const governance = defaultSources(pool).filter((s) => s.key === "governance");
    await runFailedActions({ pool, sources: governance, retries: [], notifyAdmins: async () => undefined, isFirstRun: async () => false });

    const [rows] = await q("SELECT `item_key`, `title`, `last_error` FROM `failed_action_items` WHERE `source` = 'governance' AND `resolved_at` IS NULL");
    for (const r of rows as Array<{ item_key: string; title: string; last_error: string | null }>) {
      kept.set(String(r.item_key), { title: String(r.title), lastError: r.last_error == null ? null : String(r.last_error) });
    }
    for (const s of await stuckLandings(pool, new Date())) recorded.set(s.ballotId, s.lastError);
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("drives both throws the closer has, for both member id shapes, and lists every one", () => {
    // The known positive under the two cases after it: four real failures,
    // four items, and each landing record carries the closer's own sentence.
    expect(cases.map((c) => c.memberId.split("-")[0]).sort()).toEqual(["user", "user", "usr", "usr"]);
    for (const c of cases) {
      expect(c.redemptionId, `${c.label}: minted by requestRedemption`).toMatch(REDEMPTION_ID);
      const whole = recorded.get(c.ballotId);
      expect(whole, c.label).toContain(`redemption ${c.redemptionId} for member ${c.memberId}`);
      expect(whole, c.label).toContain(c.standing === "open" ? "could not be released" : "is refused and its hold is still held");
      expect(kept.has(`give-back:${c.ballotId}`), `${c.label}: on the tab`).toBe(true);
    }
    expect(kept.size).toBe(cases.length);
  });

  it("scrubs the member id out of the give-back error, a registration id and a bootstrap one alike", () => {
    for (const c of cases) {
      const item = kept.get(`give-back:${c.ballotId}`)!;
      expect(item.lastError, `${c.label}: the member id is gone`).not.toContain(c.memberId);
      expect(item.lastError, `${c.label}: and said as a member`).toContain("for member (a member)");
      expect(item.title, c.label).not.toContain(c.memberId);
    }
    // The landing record keeps the whole sentence for whoever finishes it.
    for (const c of cases) expect(recorded.get(c.ballotId), c.label).toContain(c.memberId);
  });

  it("keeps the redemption id whole, so the error still says which redemption to repair", () => {
    for (const c of cases) {
      const item = kept.get(`give-back:${c.ballotId}`)!;
      expect(item.lastError, `${c.label}: the redemption id survives the scrub`).toContain(`redemption ${c.redemptionId} for member`);
      expect(item.lastError, `${c.label}: and the repair still names it`).toContain("Run retryRelease for this id");
      expect(item.title, `${c.label}: the ballot id survives in the title`).toContain(`(ballot ${c.ballotId})`);
    }
  });
});
