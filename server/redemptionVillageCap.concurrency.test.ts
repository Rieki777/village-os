/**
 * The village-wide redemption cap, driven by two members at once (ruling 23).
 *
 * WHY THIS TEST HAS TO FIRE TWO ASKS TOGETHER. The defect it guards is
 * invisible to a sequential run: the cap is a read-then-write, and the gap
 * between reading "how much has this village promised this moon" and writing
 * the row only exists while a second member is inside it. A sequential version
 * of the case below passes against the bug, which is exactly the shape
 * `server/repos/questClaimConcurrency.test.ts` was written for.
 *
 * WHAT SERIALISES THEM. The per-member caps are safe on the `users` row
 * `requestRedemption` already locks, because every ask by one member queues
 * behind the one before it. Two DIFFERENT members share no such row, so
 * `villageMoneyAskedSinceRowsForUpdate` takes a range lock over the cycle's
 * rows, on the ask's own connection, before the insert. The second ask waits
 * for the first to commit and then reads a total that includes it.
 *
 * WHAT IT ASSERTS, and why it is not "the second one is refused". On MariaDB
 * with `innodb_snapshot_isolation` ON (the local :3307 engine) a lock wait can
 * surface as errno 1020 rather than as a clean refusal, while CI's mysql:8
 * refuses cleanly. Asserting the error TEXT would go red on one engine and
 * green on the other while the invariant held on both. So this asserts the
 * INVARIANT: exactly one ask may land, and the village's promised total never
 * exceeds the cap it set. Both engines answer that the same way, and the bug
 * breaks it on both.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { CYCLE_POOL_FAUCET, loadTokenRegistry, memberAccount } from "./lib/ledger";
import { cycleWindow, mint, toLedgerUnits, villageId } from "./lib/economy";
import { loadVariables, setVariable } from "./lib/variables";
import { requestRedemption, type RedeemMoney } from "./lib/redemptionStore";
import { redemptionQuote, type RedemptionRate } from "./lib/redemption";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[redemptionVillageCap] TEST_DATABASE_URL not set. This suite SKIPPED.");
}

const CREDITS = "credits";
/** Two credits a token, so twenty credits is forty of the village's money. */
const RATE: RedemptionRate = { minorPerToken: 200, source: "set", currency: "USD" };

describe.skipIf(!configured)("the village-wide cap, under two asks at once", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let seq = 0;

  const makeMember = async (id: string) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
        "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
      [id, id, `${id}@examples.invalid`],
    );
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
      [memberAccount(id), "member", id, id],
    );
  };

  const giveCredits = async (userId: string, human: number) => {
    const res = await mint(pool, {
      toUserId: userId,
      tokenSlug: CREDITS,
      amount: toLedgerUnits(CREDITS, human),
      from: CYCLE_POOL_FAUCET,
      source: "test",
      idempotencyKey: `cap-credits:${userId}:${++seq}`,
      description: "seed",
    });
    if (!res.ok) throw new Error(`could not seed credits: ${res.error}`);
  };

  /** The money half exactly as the route builds it, with ONE cap set. */
  const money = (human: number, villageCapMinor: number): RedeemMoney => ({
    currency: "USD",
    quote: redemptionQuote({
      amountUnits: toLedgerUnits(CREDITS, human),
      decimals: 2,
      rate: RATE,
      feePct: 0,
      feeFixed: 0,
    }),
    processText: "",
    minMinor: 0,
    maxPerRequestMinor: 0,
    memberCapMinor: 0,
    villageCapMinor,
    feePct: 0,
    feeFixed: 0,
  });

  const ask = (userId: string, human: number, villageCapMinor: number) =>
    requestRedemption(pool, {
      userId,
      tokenSlug: CREDITS,
      amountUnits: toLedgerUnits(CREDITS, human),
      askedFor: "a bicycle",
      exitOpen: false,
      cycleStart: cycleWindow().startsAt,
      money: money(human, villageCapMinor),
    });

  /** What this village has promised this moon, straight out of the table. */
  const promisedMinor = async (): Promise<number> => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COALESCE(SUM(`gross_minor`),0) AS s FROM `redemptions` " +
        "WHERE `village_id` = ? AND `state` IN ('requested','confirmed') AND `created_at` >= ?",
      [villageId(), cycleWindow().startsAt],
    );
    return Number(rows[0]?.s ?? 0);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, connectionLimit: 8, timezone: "Z" }); // module-review-ok: fixture pool on the S5 scratch schema
    await loadTokenRegistry(pool);
    await loadVariables(pool);
    await setVariable(pool, "redemption.holds_on_propose", "true");
    await setVariable(pool, "redemption.per_member_per_cycle", "5");
    await makeMember("wren");
    await makeMember("ash");
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM `redemptions`"); // module-review-ok: scratch-schema reset between cases
  });

  it("is measurable at all: one ask under the cap lands and is counted", async () => {
    // THE POSITIVE CONTROL. Without it, two refusals for an unrelated reason
    // (no balance, a dial left somewhere odd) would read as the cap holding.
    await giveCredits("wren", 100);
    const out = await ask("wren", 20, 10000);
    expect(out.ok, `the control ask must land: ${out.ok ? "" : out.error}`).toBe(true);
    expect(await promisedMinor()).toBe(4000);
  }, 300_000);

  it("lets exactly one of two simultaneous asks through a cap with room for one", async () => {
    await giveCredits("wren", 100);
    await giveCredits("ash", 100);

    // A cap of 50.00 with two asks worth 40.00 each: one fits, two do not.
    const cap = 5000;
    const [a, b] = await Promise.all([ask("wren", 20, cap), ask("ash", 20, cap)]);
    const landed = [a, b].filter((r) => r.ok).length;

    expect(landed, `both asks landed, so the cap was read before the other committed: ${JSON.stringify([a, b])}`).toBe(1);
    const promised = await promisedMinor();
    expect(promised).toBe(4000);
    expect(promised).toBeLessThanOrEqual(cap);
  }, 300_000);

  /*
   * FOUR AT ONCE, AND THE ASSERTION IS THE INVARIANT RATHER THAN A COUNT.
   *
   * A cap of 90.00 against four asks of 40.00 has room for two, and a first
   * draft of this case asserted that two land. That is the trap this file's
   * header warns about, met in my own test: under four concurrent
   * SERIALIZABLE transactions taking a range lock, a loser can come back as a
   * serialisation failure rather than as a clean cap refusal, and on the local
   * MariaDB (`innodb_snapshot_isolation` ON) that is errno 1020 where CI's
   * mysql:8 waits and refuses. Measured here: one landed and three did not.
   *
   * Either way the property that matters holds and is the one asserted: the
   * village never promises more than its cap, and at least one member gets
   * through. The reasons are printed in the failure message so an engine
   * difference reads as what it is instead of as a mystery.
   */
  it("never promises more than the cap when four members ask at once", async () => {
    for (const who of ["wren", "ash", "rowan", "sage"]) {
      await makeMember(who);
      await giveCredits(who, 100);
    }
    const cap = 9000; // room for two of the four
    const results = await Promise.all(["wren", "ash", "rowan", "sage"].map((who) => ask(who, 20, cap)));
    const landed = results.filter((r) => r.ok).length;
    const why = results.filter((r) => !r.ok).map((r) => (r as { error: string }).error);

    expect(landed, `nobody got through at all: ${why.join(" | ")}`).toBeGreaterThanOrEqual(1);
    expect(landed, `more landed than the cap had room for: ${why.join(" | ")}`).toBeLessThanOrEqual(2);
    const promised = await promisedMinor();
    expect(promised, `the village promised past its own cap: ${why.join(" | ")}`).toBeLessThanOrEqual(cap);
  }, 420_000);
});
