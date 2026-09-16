/**
 * What a consent is owed, and posting it: `owedForClaim`, `postOwed`, `postOwedOn`.
 *
 * The quests lane records owed rows in the consent's own commit and posts them
 * afterwards, so these are held to the four things that design leans on, and
 * every assertion reads the LEDGER, never only a return value:
 *
 *   1. Pricing posts nothing, prices in minor units, uses the direct path's
 *      exact keys, omits zeros, leaves recognition to the consent route, and
 *      never owes what can never pay.
 *   2. `postOwedOn` never begins, commits or rolls back: the caller's rollback
 *      takes the posting with it, and the caller's commit keeps it.
 *   3. A replay is `duplicate`, never a second row, on either path.
 *   4. A refusal names its reason as a fact (`not_launched`, `key_clash`), and
 *      an infrastructure failure THROWS instead of returning refused, so a
 *      transient failure stays owed.
 *
 * ORDER MATTERS IN THIS FILE, once, on purpose. A fresh schema seeds gratitude,
 * equity, voice and credits and NOT `stay-credit`, which production registers
 * at boot (`ensureStayToken`). The first case uses that gap to prove a stay
 * reward on an unregistered token is unpayable rather than owed at the wrong
 * scale; the block after it registers the token the way boot does.
 *
 * `mintForConfirmedClaim` is the same two steps on the pool, and its behaviour
 * is held where it always was: server/economy.test.ts and
 * server/lib/economyEpoch.test.ts.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { balanceOf, loadTokenRegistry, memberAccount } from "./ledger";
import {
  CREDITS,
  HEARTS,
  VILLAGE_VOICE,
  decimalsFor,
  keys,
  owedForClaim,
  postOwed,
  postOwedOn,
  toLedgerUnits,
  villageId,
  type OwedPosting,
} from "./economy";
import { seedEconomy } from "./economySeed";
import { STAY_CREDIT, ensureStayToken } from "./stays";

const configured = testDbConfigured();
const VILLAGE = villageId();
const STAY = STAY_CREDIT;

let db: TestDb | undefined;
let pool: mysql.Pool;

async function seatAMember(id: string): Promise<string> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@examples.invalid`],
  );
  return id;
}

/** Every ledger row under one key, straight off the table. */
async function rowsFor(key: string): Promise<Array<{ amount: number; token: string }>> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT `amount`, `token_type` FROM `token_ledger` WHERE `idempotency_key` = ?",
    [key],
  );
  return rows.map((r) => ({ amount: Number(r.amount), token: String(r.token_type) }));
}

/** A stay-credit row built by the pricing itself, so the keys and units under test are the real ones. */
async function stayRowFor(claimId: string, userId: string, reward = 3): Promise<OwedPosting> {
  const priced = await owedForClaim(pool, {
    id: claimId,
    questId: `q-${claimId}`,
    userId,
    stay: { reward, questTitle: "Fixing the fence" },
  });
  const row = priced.owed.find((o) => o.tokenSlug === STAY);
  expect(row, "a stay reward prices a stay-credit row").toBeDefined();
  return row!;
}

describe.skipIf(!configured)("what a consent is owed, and posting it", () => {
  beforeAll(async () => {
    // Provisioned with the Game already started, which is the state every
    // posting case needs; the not_launched case removes that row and restores it.
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 10 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await loadTokenRegistry(pool);
    await seedEconomy(pool, VILLAGE);
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("owes nothing for a stay reward on a token this village has not registered, and says why", async () => {
    // Before this, pricing converted through a token it could not find, which
    // answers at whole units, and owed a figure a hundred times too small for
    // the token boot registers at two decimals.
    const u = await seatAMember("owed-no-stay-token");
    const priced = await owedForClaim(pool, {
      id: "claim-owed-no-stay-token",
      questId: "quest-owed-no-stay-token",
      userId: u,
      stay: { reward: 3, questTitle: "Fixing the fence" },
    });
    expect(priced.owed.some((o) => o.tokenSlug === STAY)).toBe(false);
    expect(priced.unpayable.find((x) => x.token === STAY)?.reason).toMatch(/no token called/);
    // The rules beside it still price.
    expect(priced.owed.some((o) => o.tokenSlug === CREDITS)).toBe(true);
  });

  describe("once the stay token is registered, the way boot registers it", () => {
    beforeAll(async () => {
      await ensureStayToken(pool);
      await loadTokenRegistry(pool);
    });

    it("prices the seeded rules and the stay in minor units, under the direct path's keys, and posts nothing", async () => {
      const u = await seatAMember("owed-price");
      const conn = await pool.getConnection();
      let priced;
      try {
        await conn.beginTransaction();
        priced = await owedForClaim(conn, {
          id: "claim-owed-price",
          questId: "quest-owed-price",
          userId: u,
          stay: { reward: 3, questTitle: "Fixing the fence" },
        });
        await conn.commit();
      } finally {
        conn.release();
      }

      expect(priced.skipped).toBeUndefined();
      expect(priced.unpayable).toEqual([]);
      const byToken = new Map(priced.owed.map((o) => [o.tokenSlug, o]));
      // The seeded quest.completed rules pay 25 Credits and 10 Voice, both whole
      // tokens, so the units are those times whatever scale the registry holds.
      expect(byToken.get(CREDITS)?.units).toBe(toLedgerUnits(CREDITS, 25));
      expect(byToken.get(VILLAGE_VOICE)?.units).toBe(toLedgerUnits(VILLAGE_VOICE, 10));
      expect(byToken.get(STAY)?.units).toBe(toLedgerUnits(STAY, 3));
      expect(byToken.get(STAY)?.decimals).toBe(decimalsFor(STAY));
      // Recognition is the consent route's own posting and is never priced here.
      expect(byToken.has(HEARTS)).toBe(false);

      // Exactly the keys the direct path has always posted, so a landed posting
      // replays as a duplicate.
      expect(byToken.get(CREDITS)?.idempotencyKey).toBe(
        keys.questCompleted(VILLAGE, "quest-owed-price", "claim-owed-price", u, CREDITS),
      );
      expect(byToken.get(STAY)?.idempotencyKey).toBe("queststay:claim-owed-price");

      // Pricing is a read. Not one row exists under any of those keys.
      for (const o of priced.owed) expect(await rowsFor(o.idempotencyKey)).toEqual([]);
      expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(0);
    });

    it("owes no stay credits for a reward of zero, and owes no zero anywhere", async () => {
      const u = await seatAMember("owed-zero");
      const priced = await owedForClaim(pool, {
        id: "claim-owed-zero",
        questId: "quest-owed-zero",
        userId: u,
        stay: { reward: 0, questTitle: "Nothing extra" },
      });
      expect(priced.owed.some((o) => o.tokenSlug === STAY)).toBe(false);
      expect(priced.owed.every((o) => o.units > 0)).toBe(true);
    });

    it("postOwedOn leaves the transaction to its caller: a rollback takes the posting with it", async () => {
      const u = await seatAMember("owed-rollback");
      const row = await stayRowFor("claim-owed-rollback", u);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const res = await postOwedOn(conn, row);
        expect(res.outcome).toBe("posted");
        // If postOwedOn had committed, this rollback could not undo it.
        await conn.rollback();
      } finally {
        conn.release();
      }
      expect(await rowsFor(row.idempotencyKey)).toEqual([]);
      expect(await balanceOf(pool, memberAccount(u), STAY)).toBe(0);
    });

    it("postOwedOn commits with its caller, and the retry after that commit is a duplicate", async () => {
      const u = await seatAMember("owed-commit");
      const row = await stayRowFor("claim-owed-commit", u);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        expect((await postOwedOn(conn, row)).outcome).toBe("posted");
        await conn.commit();

        await conn.beginTransaction();
        const again = await postOwedOn(conn, row);
        await conn.commit();
        expect(again).toEqual({ outcome: "duplicate", balance: row.units });
      } finally {
        conn.release();
      }
      expect(await rowsFor(row.idempotencyKey)).toEqual([{ amount: row.units, token: STAY }]);
    });

    it("postOwed posts once on the pool and reads the replay as a duplicate", async () => {
      const u = await seatAMember("owed-pool");
      const row = await stayRowFor("claim-owed-pool", u);

      expect(await postOwed(pool, row)).toEqual({ outcome: "posted", balance: row.units });
      expect(await postOwed(pool, row)).toEqual({ outcome: "duplicate", balance: row.units });
      expect(await rowsFor(row.idempotencyKey)).toEqual([{ amount: row.units, token: STAY }]);
      expect(await balanceOf(pool, memberAccount(u), STAY)).toBe(row.units);
    });

    it("refuses as not_launched, by asking the launch gate, and posts nothing", async () => {
      const u = await seatAMember("owed-unlaunched");
      const row = await stayRowFor("claim-owed-unlaunched", u);
      const [saved] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT `value` FROM `app_config` WHERE `config_key` = 'game-start'",
      );
      expect(saved.length, "provisioning started the Game, which this case undoes").toBe(1);
      await pool.query("DELETE FROM `app_config` WHERE `config_key` = 'game-start'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      try {
        const res = await postOwed(pool, row);
        expect(res.outcome).toBe("refused");
        expect(res.outcome === "refused" ? res.reason : null).toBe("not_launched");
        expect(await rowsFor(row.idempotencyKey)).toEqual([]);
      } finally {
        const value = saved[0].value;
        await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          "INSERT INTO `app_config` (`config_key`, `value`) VALUES ('game-start', ?)",
          [typeof value === "string" ? value : JSON.stringify(value)],
        );
      }
      // Restored: the same row now posts.
      expect((await postOwed(pool, row)).outcome).toBe("posted");
    });

    it("refuses a key that collides with a different stored key as key_clash, not as a rule", async () => {
      const u = await seatAMember("owed-clash");
      const row = await stayRowFor("claim-owed-clash", u);
      expect((await postOwed(pool, row)).outcome).toBe("posted");

      // The same key in capitals is ONE row under the ledger's case-insensitive
      // collation, and a different occurrence. It must never read as "already paid".
      const shouted = { ...row, idempotencyKey: row.idempotencyKey.toUpperCase() };
      const res = await postOwed(pool, shouted);
      expect(res.outcome).toBe("refused");
      expect(res.outcome === "refused" ? res.reason : null).toBe("key_clash");
      expect(await rowsFor(row.idempotencyKey)).toHaveLength(1);
    });

    it("throws on a dead connection instead of recording a refusal, so the obligation stays owed", async () => {
      const u = await seatAMember("owed-dead");
      const row = await stayRowFor("claim-owed-dead", u);
      const conn = await pool.getConnection();
      // Destroyed, not released: the socket is gone, which is what a lost
      // connection looks like to the code holding it.
      conn.destroy();
      await expect(postOwedOn(conn, row)).rejects.toBeTruthy();
      expect(await rowsFor(row.idempotencyKey)).toEqual([]);
    });
  });
});
