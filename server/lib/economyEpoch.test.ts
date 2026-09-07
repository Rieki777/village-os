/**
 * The first quest of a village's life gets paid.
 *
 * This file exists because 3,666 tests were green while every village on the
 * platform silently lost its very first payout. `mintForConfirmedClaim` was
 * the only caller of `economyEpoch`, and `economyEpoch` STAMPED the epoch when
 * it found none. So the first confirmed claim in a fresh village wrote the
 * epoch at `now` and was then measured against it, having resolved twenty
 * milliseconds earlier. It lost. Once per village, deterministically, on the
 * first piece of work anybody there ever finished.
 *
 * Two things hid it, and both are worth naming because neither looks like a
 * gap when you are the one writing it:
 *
 *   1. `economySeed.test.ts` has a test called "pays a confirmed quest in
 *      voice and credits". It asserts on four columns of the `mint_rules`
 *      ROW. It proves the rule exists, is enabled, and carries the right
 *      amount. It never confirms a quest and never reads the ledger, so it
 *      would have stayed green through this bug for as long as the bug lived.
 *      A test named for an outcome that asserts on configuration proves the
 *      INTENT and not the outcome.
 *   2. That same file's `beforeAll` called `economyEpoch(pool)`, and so does
 *      `economy.test.ts` near the top. Both were reasonable: they wanted a
 *      running engine. But stamping the epoch in setup is exactly the state
 *      in which the bug cannot reproduce, so every later test in both files
 *      ran on the far side of the defect.
 *
 * So the rule for this file: it must never stamp the epoch in setup, and it
 * must assert on BALANCES, never on rules. If a future change makes this file
 * need an epoch in `beforeAll` to pass, that change is the bug coming back.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { balanceOf, loadTokenRegistry, memberAccount } from "./ledger";
import {
  CREDITS,
  forgetEpoch,
  mintForConfirmedClaim,
  startEconomyEpoch,
  VILLAGE_VOICE,
  villageId,
} from "./economy";
import { seedEconomy } from "./economySeed";

const configured = testDbConfigured();
const VILLAGE = villageId();

let db: TestDb | undefined;
let pool: mysql.Pool;

/**
 * A token's scale, read off the registry rather than typed. The seeded
 * `quest.completed` rules pay 10 Voice and 25 Credits, both HUMAN numbers in
 * `mint_rules.amount`, and `balanceOf` answers in MINOR units. Those were the
 * same number until `0184`, which is why these assertions read as bare
 * literals and why the literal is the wrong shape rather than the wrong value.
 */
async function scaleOf(slug: string): Promise<number> {
  const [rows] = await pool.query<any[]>("SELECT `decimals` FROM `tokens` WHERE `slug` = ?", [slug]);
  return 10 ** Number(rows[0]?.decimals ?? 0);
}

/** A member who can be paid. The mint needs a user row and a ledger account. */
async function seatAMember(id: string): Promise<string> {
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
 * Put the village back to never-having-started. Both halves are needed: the
 * module holds the epoch in a process-level cache, and the row survives it.
 */
async function neverStarted(): Promise<void> {
  forgetEpoch();
  await pool.query("DELETE FROM `app_config` WHERE `config_key` = 'economy-state'");
}

describe.skipIf(!configured)("the first confirmed quest in a village's life", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 10 });
    await loadTokenRegistry(pool);
    await seedEconomy(pool, VILLAGE);
    await loadTokenRegistry(pool);
    // Deliberately NOT stamping the epoch. See the header.
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("pays credits and voice, on a village where nothing has ever been minted", async () => {
    await neverStarted();
    const u = await seatAMember("epoch-first");

    const res = await mintForConfirmedClaim(pool, {
      id: "claim-first",
      questId: "quest-first",
      userId: u,
      // Resolved a moment ago, exactly like the confirm route hands it over.
      confirmedAt: new Date(Date.now() - 20),
    });

    // The sentence the server logged for every village's first quest.
    expect(res.skipped).toBeUndefined();
    // The seeded rule pays 25 Credits and 10 Voice, both whole tokens.
    expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(25 * (await scaleOf(CREDITS)));
    expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(10 * (await scaleOf(VILLAGE_VOICE)));
  });

  it("starts the clock at the claim, so the SECOND quest is paid the same as the first", async () => {
    const u = await seatAMember("epoch-second");
    const res = await mintForConfirmedClaim(pool, {
      id: "claim-second",
      questId: "quest-second",
      userId: u,
      confirmedAt: new Date(),
    });
    expect(res.skipped).toBeUndefined();
    expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(25 * (await scaleOf(CREDITS)));
  });

  it("still refuses work from before the engine started", async () => {
    await neverStarted();
    // The engine comes up now, the way boot does it.
    await startEconomyEpoch(pool);
    const u = await seatAMember("epoch-history");

    const res = await mintForConfirmedClaim(pool, {
      id: "claim-old",
      questId: "quest-old",
      userId: u,
      confirmedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    });

    // This is the protection the epoch exists for and it has to survive the
    // fix: a village that switches the engine on does not owe three months of
    // backlog to whoever re-confirms an old claim first.
    expect(res.skipped).toBe("confirmed before the economy epoch");
    expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(0);
  });

  it("never moves the epoch once it has been stamped", async () => {
    await neverStarted();
    const first = await startEconomyEpoch(pool);
    forgetEpoch();
    const second = await startEconomyEpoch(pool, new Date(Date.now() - 60_000));
    // Even asked to start it earlier, an already-running clock does not move.
    expect(second.getTime()).toBe(first.getTime());
  });

  it("refuses to be pushed into the future by a skewed clock", async () => {
    await neverStarted();
    const ahead = new Date(Date.now() + 60 * 60 * 1000);
    const stamped = await startEconomyEpoch(pool, ahead);
    // A future `confirmedAt` must not stamp an epoch that then rules out every
    // real piece of work between now and then.
    expect(stamped.getTime()).toBeLessThan(ahead.getTime());
  });
});
