/**
 * THE WANING GUARD, DRIVEN THROUGH `decayVoice` WITH THE RACE PUT IN BY HAND.
 *
 * `decayVoice` sizes each member's waning from a read on the pool and posts it
 * several awaits later. A spend that lands in that window used to leave the
 * posting as it was, so a one percent waning could take five percent of what
 * was left. Racing two real requests into a window that narrow is a flake, not
 * a test, so the window is opened on purpose: `balanceRowFor` is the read that
 * sizes the waning, and the mock below runs a real spend straight after it
 * answers. Everything after that point is the production path, unmocked:
 * `postTransfer`, its account lock, the guard and the ledger rows.
 *
 * The guard is also asked directly, through `postTransfer`, in both wrong
 * directions and the right one.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { balanceOf, checkLedgerInvariants, loadTokenRegistry, memberAccount, postTransfer } from "./lib/ledger";
import { loadVariables } from "./lib/variables";
import { recordGameStart } from "./lib/gameStart";
import {
  cycleWindow,
  decayVoice,
  ensureVoiceToken,
  mint,
  VILLAGE_VOICE,
  VOICE_BRIDGE,
  VOICE_DECAY,
  VOICE_MINT,
  WANING_MOVED,
  waningGuard,
  waningUnits,
} from "./lib/economy";
import { decayUnits } from "../shared/tokenScale";

const race = vi.hoisted(() => ({ afterRead: null as null | (() => Promise<void>) }));

vi.mock("./repos/tokenBalances", async (importOriginal) => {
  const real = await importOriginal<typeof import("./repos/tokenBalances")>();
  return {
    ...real,
    balanceRowFor: async (...args: Parameters<typeof real.balanceRowFor>) => {
      const rows = await real.balanceRowFor(...args);
      const spend = race.afterRead;
      race.afterRead = null;
      if (spend) await spend();
      return rows;
    },
  };
});

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[voiceDecay.guard] TEST_DATABASE_URL not set. This suite SKIPPED.");
}

describe.skipIf(!configured)("a waning is decided again under the account lock", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let seq = 0;

  /** A member holding `units` of Voice carried INTO the current moon. */
  const carriedIn = async (id: string, units: number): Promise<string> => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`,`name`,`email`,`password_hash`) VALUES (?,?,?,'x') " +
        "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
      [id, id, `${id}@examples.invalid`],
    );
    const key = `guard.seed:${id}:${(seq += 1)}`;
    const r = await mint(pool, {
      toUserId: id,
      tokenSlug: VILLAGE_VOICE,
      amount: units,
      from: VOICE_MINT,
      source: "role_cycle",
      sourceRef: id,
      description: "seeded for the waning guard",
      idempotencyKey: key,
    });
    expect(r.ok, `seeding ${id}`).toBe(true);
    const before = Math.floor(cycleWindow(new Date()).startsAt.getTime() / 1000) - 24 * 60 * 60;
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "UPDATE `token_ledger` SET `at` = FROM_UNIXTIME(?) WHERE `idempotency_key` = ?",
      [before, key],
    );
    return id;
  };

  /** A real spend of the member's Voice, the way a voice claim debits it. */
  const spend = (id: string, units: number) => async () => {
    const r = await postTransfer(pool, {
      from: memberAccount(id),
      to: VOICE_BRIDGE,
      tokenType: VILLAGE_VOICE,
      amount: units,
      source: "voice_claim",
      description: "Voice claimed toward Hypha",
      idempotencyKey: `guard.spend:${id}:${(seq += 1)}`,
    });
    expect(r.ok, `spending from ${id}`).toBe(true);
  };

  /** Every waning leg taken from one member, off the rows. */
  const wanedFrom = async (id: string): Promise<number[]> => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `amount` FROM `token_ledger` WHERE `source` = 'voice_decay' AND `from_account` = ? AND `token_type` = ?",
      [memberAccount(id), VILLAGE_VOICE],
    );
    return rows.map((row) => Number(row.amount));
  };

  const voiceSum = async (): Promise<number> => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COALESCE(SUM(`balance`), 0) AS s FROM `token_balances` WHERE `token_type` = ?",
      [VILLAGE_VOICE],
    );
    return Number(rows[0].s);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await loadTokenRegistry(pool);
    await loadVariables(pool);
    await ensureVoiceToken(pool, "Village Voice");
    await loadTokenRegistry(pool);
    await recordGameStart(pool, { ballotId: "blt-guard", startedBy: "usr-guard", note: "for the waning guard" });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    race.afterRead = null;
    await pool.query("DELETE FROM `token_ledger` WHERE `token_type` = ?", [VILLAGE_VOICE]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `token_balances` WHERE `token_type` = ?", [VILLAGE_VOICE]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `exits`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  it("takes nothing when the balance falls between the read and the post, then the rate on what is left", async () => {
    const u = await carriedIn("guard-race", 5000);
    const at = new Date();
    const problems: Array<{ token: string; reason: string }> = [];

    // The read sees 5000 and sizes the waning at 50. Then 4000 leaves.
    race.afterRead = spend(u, 4000);
    const raced = await decayVoice(pool, at, problems);

    // Fifty from a balance of 1000 is five percent under a one percent dial.
    // Nothing moved instead, nothing was keyed, and nothing was reported,
    // because a member spending their own Voice is not a fault.
    expect(race.afterRead).toBeNull();
    expect(await wanedFrom(u)).toEqual([]);
    expect(raced.holders).toBe(0);
    expect(raced.total).toBe(0);
    expect(problems).toEqual([]);
    expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(1000);

    // The next ask in the same moon takes the rate on the smaller of what they
    // carried in and what they hold: one percent of 1000.
    const next = await decayVoice(pool, at, problems);
    const rate = decayUnits(Math.min(5000, 1000), 1);
    expect(rate).toBe(10);
    expect(await wanedFrom(u)).toEqual([rate]);
    expect(next.total).toBe(rate);
    expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(1000 - rate);
    expect(await balanceOf(pool, VOICE_DECAY, VILLAGE_VOICE)).toBe(rate);

    // And it stays once: a third ask is a duplicate.
    const third = await decayVoice(pool, at, problems);
    expect(third.total).toBe(0);
    expect(await wanedFrom(u)).toEqual([rate]);
    expect(await voiceSum()).toBe(0);
    expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
  });

  it("refuses a posting above or below the rate on the locked balance, and passes the exact one", async () => {
    const u = await carriedIn("guard-direct", 5000);
    await spend(u, 4000)();
    const account = memberAccount(u);
    const post = (amount: number, tag: string) =>
      postTransfer(
        pool,
        {
          from: account,
          to: VOICE_DECAY,
          tokenType: VILLAGE_VOICE,
          amount,
          source: "voice_decay",
          description: "Voice that waned this moon",
          idempotencyKey: `guard.direct:${u}:${tag}`,
        },
        waningGuard(account, 5000, 1, amount),
      );

    // Sized off the 5000 carried in, as a stale read would size it.
    const above = await post(waningUnits(5000, 5000, 1), "above");
    expect(above).toMatchObject({ ok: false, duplicate: false, error: WANING_MOVED });
    // Below the rate would write the moon's key and could never be topped up.
    const below = await post(5, "below");
    expect(below).toMatchObject({ ok: false, duplicate: false, error: WANING_MOVED });
    expect(await wanedFrom(u)).toEqual([]);
    expect(await balanceOf(pool, account, VILLAGE_VOICE)).toBe(1000);

    const exact = await post(waningUnits(5000, 1000, 1), "exact");
    expect(exact.ok).toBe(true);
    expect(await wanedFrom(u)).toEqual([10]);
    expect(await balanceOf(pool, account, VILLAGE_VOICE)).toBe(990);
    expect(await voiceSum()).toBe(0);
  });

  it("sizes a waning off the smaller of what was carried in and what is held, and nothing below zero", () => {
    expect(waningUnits(5000, 1000, 1)).toBe(10);
    expect(waningUnits(1000, 5000, 1)).toBe(10);
    expect(waningUnits(0, 5000, 1)).toBe(0);
    expect(waningUnits(5000, 0, 1)).toBe(0);
    expect(waningUnits(5000, -25, 1)).toBe(0);
    expect(waningUnits(50, 50000, 1)).toBe(0);
  });
});
