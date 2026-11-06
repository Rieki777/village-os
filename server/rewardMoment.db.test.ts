/**
 * THE REWARD MOMENT (0294), against a real schema.
 *
 * What a reader could get wrong, each pinned:
 *
 *   1. The first look is a baseline: work paid before it is history, and the
 *      call returns nothing.
 *   2. Tokens and Voice for one piece of work are one line, named by the work
 *      (a quest's title, a role's name, a proposal's own words), and every
 *      piece of work since the last look comes back in ONE moment.
 *   3. Gratitude is not earnings, even on a work source.
 *   4. Cash marked paid is an arrival; cash merely owed is not.
 *   5. Seen is seen on every device: once marked, the same arrivals never
 *      come back, and a key that is not this member's own is never written.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { CREDITS, ensureVoiceToken, faucetFor, mint, VILLAGE_VOICE } from "./lib/economy";
import { loadTokenRegistry, memberAccount, PLATFORM_TOKEN, RECOGNITION_FAUCET } from "./lib/ledger";
import { loadVariables } from "./lib/variables";
import { claimsAnnouncedHere, markRewardMomentSeen, pendingRewardMoment } from "./lib/rewardMoment";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let n = 0;

async function makeMember(id: string): Promise<string> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@examples.invalid`],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
    [memberAccount(id), "member", id, id],
  );
  return id;
}

async function pay(userId: string, token: string, units: number, source: string, sourceRef: string): Promise<void> {
  const out = await mint(pool, {
    toUserId: userId,
    tokenSlug: token,
    amount: units,
    from: token === PLATFORM_TOKEN ? RECOGNITION_FAUCET : faucetFor(token)!,
    source,
    sourceRef,
    description: "reward moment fixture",
    idempotencyKey: `rm-test:${++n}`,
  });
  expect(out.ok).toBe(true);
}

async function claimFor(userId: string, claimId: string, title: string): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `quest_claims` (`id`, `quest_id`, `quest_title`, `user_id`, `status`) VALUES (?, ?, ?, ?, 'consented')",
    [claimId, `q-${claimId}`, title, userId],
  );
}

async function cashRow(userId: string, id: string, title: string, state: "owed" | "paid"): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `cash_owed` (`id`, `occurrence_key`, `user_id`, `work_kind`, `work_ref`, `work_title`, `amount_minor`, `currency`, `state`, `paid_at`) " +
      "VALUES (?, ?, ?, 'quest', 'q', ?, 2500000, 'CRC', ?, IF(? = 'paid', CURRENT_TIMESTAMP, NULL))",
    [id, `rm:${id}`, userId, title, state, state],
  );
}

describe.skipIf(!configured)("a reward moment each time something lands", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await loadVariables(pool);
    await ensureVoiceToken(pool, "Voice");
    await loadTokenRegistry(pool);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("treats the first look as a baseline, and work paid before it as history", async () => {
    const u = await makeMember("rm-history");
    await claimFor(u, "rm-old-claim", "Clear the old path");
    await pay(u, CREDITS, 40, "quest_consent", "rm-old-claim");
    // TIMESTAMP is whole seconds: step past the second the old credit landed in.
    await new Promise((r) => setTimeout(r, 1100));

    expect(await pendingRewardMoment(pool, u)).toEqual({ keys: [], lines: [] });
    // Still history on the second look.
    expect((await pendingRewardMoment(pool, u)).lines).toEqual([]);
  });

  it("gathers everything since the last look into one moment, a line per piece of work", async () => {
    const u = await makeMember("rm-earner");
    await pendingRewardMoment(pool, u); // the baseline

    await claimFor(u, "rm-claim-1", "Seed bank shelves");
    await pay(u, CREDITS, 40, "quest_consent", "rm-claim-1");
    await pay(u, VILLAGE_VOICE, 5, "quest_consent", "rm-claim-1");

    await pool.query("INSERT INTO `org_roles` (`id`, `name`) VALUES ('rm-role', 'Seed Keeper')"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`) VALUES ('rm-seat', 'rm-role', 'member', ?, ?)",
      [u, u],
    );
    await pay(u, CREDITS, 12, "role_cycle", "rm-seat");

    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `submissions` (`id`, `type`, `status`, `data`) VALUES ('rm-sub', 'work', 'accepted', ?)",
      [JSON.stringify({ work: "A rain garden by the gate" })],
    );
    await pay(u, VILLAGE_VOICE, 3, "proposal_accepted", "rm-sub");

    const view = await pendingRewardMoment(pool, u);
    expect(view.keys).toHaveLength(4);
    expect(view.lines).toHaveLength(3);
    const [quest, role, proposal] = view.lines;
    expect(quest).toMatchObject({ kind: "earned", work: "Seed bank shelves" });
    expect(quest.kind === "earned" && quest.tokens.map((t) => [t.token, t.name])).toEqual([
      [CREDITS, expect.any(String)],
      [VILLAGE_VOICE, "Voice"],
    ]);
    expect(role).toMatchObject({ kind: "earned", work: "holding Seed Keeper" });
    expect(proposal).toMatchObject({ kind: "earned", work: "A rain garden by the gate" });
  });

  it("leaves Gratitude out, even when a work source carried it", async () => {
    const u = await makeMember("rm-gratitude");
    await pendingRewardMoment(pool, u);
    await claimFor(u, "rm-g-claim", "An old consent");
    await pay(u, PLATFORM_TOKEN, 80, "quest_consent", "rm-g-claim");
    await pay(u, PLATFORM_TOKEN, 10, "gratitude_received", "someone");

    expect(await pendingRewardMoment(pool, u)).toEqual({ keys: [], lines: [] });
  });

  it("names cash once it is paid, and never while it is only owed", async () => {
    const u = await makeMember("rm-cash");
    await pendingRewardMoment(pool, u);
    await cashRow(u, "rm-cash-owed", "Mend the fence", "owed");
    await cashRow(u, "rm-cash-paid", "Rebuild the water tank", "paid");

    const view = await pendingRewardMoment(pool, u);
    expect(view.keys).toEqual(["cash:rm-cash-paid"]);
    expect(view.lines).toEqual([{ kind: "cash_paid", work: "Rebuild the water tank", amountMinor: 2500000, currency: "CRC" }]);
  });

  it("never replays once seen, and writes only the member's own keys", async () => {
    const u = await makeMember("rm-seen");
    const other = await makeMember("rm-other");
    await pendingRewardMoment(pool, u);
    await pendingRewardMoment(pool, other);
    await claimFor(u, "rm-s-claim", "Fix the gate");
    await pay(u, CREDITS, 7, "quest_consent", "rm-s-claim");
    await cashRow(other, "rm-s-cash", "Somebody else's work", "paid");

    const view = await pendingRewardMoment(pool, u);
    expect(view.keys).toHaveLength(1);

    // The other member's key and an invented one are refused; only u's lands.
    const recorded = await markRewardMomentSeen(pool, u, [...view.keys, "cash:rm-s-cash", "ledger:not-a-row"]);
    expect(recorded).toBe(1);
    expect(await pendingRewardMoment(pool, u)).toEqual({ keys: [], lines: [] });

    // The other member still has theirs.
    expect((await pendingRewardMoment(pool, other)).keys).toEqual(["cash:rm-s-cash"]);

    // A later arrival is a new moment, with only the new work in it.
    await claimFor(u, "rm-s-claim-2", "Paint the shed");
    await pay(u, CREDITS, 9, "quest_consent", "rm-s-claim-2");
    const next = await pendingRewardMoment(pool, u);
    expect(next.lines).toEqual([expect.objectContaining({ work: "Paint the shed" })]);
  });

  it("tells the quest page which consents it announces, so each is announced once", async () => {
    const u = await makeMember("rm-once");
    await claimFor(u, "rm-once-old", "Before the baseline");
    await pay(u, CREDITS, 10, "quest_consent", "rm-once-old");
    // No look yet, so no baseline: the reward moment announces nothing, and owns nothing.
    expect(await claimsAnnouncedHere(pool, u)).toEqual(new Set());
    await new Promise((r) => setTimeout(r, 1100));
    await pendingRewardMoment(pool, u); // the baseline

    await claimFor(u, "rm-once-paid", "Build the seed shelves");
    await pay(u, CREDITS, 40, "quest_consent", "rm-once-paid");
    await claimFor(u, "rm-once-thanks", "Thanked only");
    await pay(u, PLATFORM_TOKEN, 5, "quest_consent", "rm-once-thanks");
    await pay(u, CREDITS, 7, "role_cycle", "rm-once-role");

    const owned = await claimsAnnouncedHere(pool, u);
    // Earnings after the baseline, from a consent: named by the reward moment, so the quest page stays quiet.
    expect(owned.has("rm-once-paid")).toBe(true);
    // History, Gratitude only, and work that is not a quest remain the quest page's to celebrate.
    expect(owned.has("rm-once-old")).toBe(false);
    expect(owned.has("rm-once-thanks")).toBe(false);
    expect(owned.has("rm-once-role")).toBe(false);
    // And what it owns is a quest it names.
    expect((await pendingRewardMoment(pool, u)).lines.map((l) => l.work)).toContain("Build the seed shelves");
  });
});
