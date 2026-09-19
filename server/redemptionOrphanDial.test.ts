/**
 * A VILLAGE THAT STORED A RETIRED DIAL STILL BOOTS, and still redeems.
 *
 * `redemption.confirmed_by` left the registry on 2026-09-15 when who confirms
 * became derived from who holds the redemption key. Thirteen founder instances
 * pull the same image, and any of them that ever touched that setting carries a
 * row in `game_variables` naming a key the code no longer knows.
 *
 * THE HAZARD IS REAL AND IT IS NAMED IN THE CODE THIS TESTS. `variable()`
 * THROWS on an unknown key, deliberately, "because a typo must not read as 0".
 * So the question is not whether an orphan row is tidy, it is whether anything
 * in the boot path or the redemption path ever asks for that key by name. If
 * something did, the throw would land inside `loadVariables`' callers or inside
 * an ask, and a village would meet it as a server that will not start or a
 * redemption door that 500s.
 *
 * So this seeds exactly that row and drives both: the variables load that boot
 * performs, and a real redemption through `requestRedemption`.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { CYCLE_POOL_FAUCET, loadTokenRegistry, memberAccount } from "./lib/ledger";
import { CREDITS, cycleWindow, mint, toLedgerUnits } from "./lib/economy";
import { allVariables, loadVariables, storedOverride, variable } from "./lib/variables";
import { requestRedemption } from "./lib/redemptionStore";
import { VARIABLES_BY_KEY } from "../shared/gameVariables";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[redemptionOrphanDial] TEST_DATABASE_URL not set. This suite SKIPPED.");
}

const RETIRED = "redemption.confirmed_by";

describe.skipIf(!configured)("a stored value of a dial that no longer exists", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, connectionLimit: 4, timezone: "Z" }); // module-review-ok: fixture pool on the S5 scratch schema
    await loadTokenRegistry(pool);
    // The row a village that used the old dial is carrying right now.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, standing in for a village's own stored setting
      "INSERT INTO `game_variables` (`config_key`, `value`, `value_type`) VALUES (?,?,'text') " +
        "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
      [RETIRED, "vote"],
    );
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("is genuinely a retired key: the registry does not carry it and the row does", async () => {
    // The control. Without it, every assertion below would pass just as well
    // against a key that was never stored at all.
    expect(VARIABLES_BY_KEY[RETIRED]).toBeUndefined();
    await loadVariables(pool);
    expect(storedOverride(RETIRED)).toBe("vote");
  }, 300_000);

  it("loads the village's variables without throwing", async () => {
    await expect(loadVariables(pool)).resolves.toBeUndefined();
    // And the Admin listing walks the REGISTRY, so the orphan is simply not in
    // it: no empty row, no dial a founder can set that nothing reads.
    expect(allVariables().some((v) => v.key === RETIRED)).toBe(false);
  }, 300_000);

  it("still refuses to read the retired key by name, which is the guard working", async () => {
    // Stated as a case rather than left implicit: the row does not make the key
    // readable again. Anything that still asked for it would fail loudly here
    // instead of silently reading "vote" as a live setting.
    expect(() => variable(RETIRED)).toThrow(/Unknown game variable/);
  }, 300_000);

  it("lets a member redeem, with the stored value changing nothing", async () => {
    await loadVariables(pool);
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES ('orphan','orphan','orphan@examples.invalid','x') " +
        "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    );
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
      [memberAccount("orphan"), "member", "orphan", "orphan"],
    );
    const seeded = await mint(pool, {
      toUserId: "orphan",
      tokenSlug: CREDITS,
      amount: toLedgerUnits(CREDITS, 100),
      from: CYCLE_POOL_FAUCET,
      source: "test",
      idempotencyKey: "orphan-dial-credits",
      description: "seed",
    });
    expect(seeded.ok).toBe(true);

    // The caller derives the mode; the stored "vote" is not consulted.
    const out = await requestRedemption(pool, {
      userId: "orphan",
      tokenSlug: CREDITS,
      amountUnits: toLedgerUnits(CREDITS, 10),
      askedFor: "a bicycle",
      exitOpen: false,
      cycleStart: cycleWindow().startsAt,
      confirmedBy: "steward",
    });
    expect(out.ok, out.ok ? "" : out.error).toBe(true);
    if (out.ok) expect(out.row.confirmedByMode).toBe("steward");
  }, 300_000);
});
