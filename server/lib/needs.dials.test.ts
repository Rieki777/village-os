/**
 * THE THREE NEEDS DIALS, PROVED BY WHAT THE SERVER DOES WITH THEM.
 *
 * `needs.aggregate_floor`, `needs.default_depth_target` and
 * `needs.default_breadth_pct` are open-ring dials any member may put on a
 * ballot, and until this file existed all three were shadowed: the store
 * returned the constant `NEEDS_AGGREGATE_FLOOR`, the scope write hardcoded
 * "satisfied" and 100, and the aggregate compared against a hardcoded
 * "satisfied". A village that voted its privacy floor to 5 was shown 5 in
 * Game Mechanics, told 3 by its own needs card, AND STILL AGGREGATED AT 3.
 *
 * WHY THIS IS ITS OWN FILE. `server/lib/variables.ts` holds the override cache
 * in a module-level variable, so a test that writes one and a test that reads
 * the platform default cannot share a module registry safely. Vitest gives
 * every FILE its own, and needs.test.ts asserts the untouched defaults from
 * end to end. Keeping the two apart is what makes the default path in that
 * file a real measurement instead of a leftover of whatever ran before it.
 *
 * EVERY ASSERTION READS AN OUTCOME. The floor is proved by a count that is
 * withheld at four answers and released at five, the depth and the breadth by
 * the COLUMN the write landed and by which side of the comparison an answer
 * fell on. Asserting that a function returns what a variable says would prove
 * the accessor and nothing about the server.
 */
import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { loadVariables } from "./variables";
import {
  NEEDS_AGGREGATE_FLOOR,
  NEEDS_DEFAULT_BREADTH_PCT,
  NEEDS_DEFAULT_DEPTH_TARGET,
  aggregateFloor,
  defaultBreadthPct,
  defaultDepthTarget,
  needsAggregate,
  readNeed,
  saveMemberNeed,
  upsertScopeNeed,
} from "./needs";

/* ========================================================================== *
 * The constants are the REGISTRY's defaults, and a test says so.
 *
 * Each of the three is allowed to stay in the source as the platform value a
 * reader can see. It is not allowed to drift from the number the registry
 * publishes in Game Mechanics, because a member reading the panel and a
 * village reading the fallback would then be reading two different rules.
 * ========================================================================== */

describe("the constants agree with the registry that publishes them", () => {
  it("declares the same floor Game Mechanics shows", () => {
    expect(Number(VARIABLES_BY_KEY["needs.aggregate_floor"].default)).toBe(NEEDS_AGGREGATE_FLOOR);
  });

  it("declares the same starting rung", () => {
    expect(VARIABLES_BY_KEY["needs.default_depth_target"].default).toBe(NEEDS_DEFAULT_DEPTH_TARGET);
  });

  it("declares the same starting share", () => {
    expect(Number(VARIABLES_BY_KEY["needs.default_breadth_pct"].default)).toBe(NEEDS_DEFAULT_BREADTH_PCT);
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("a village that voted its needs dials", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  const ANA = "usr-ana";
  const BEN = "usr-ben";
  const CAI = "usr-cai";
  const DEE = "usr-dee";
  const EVE = "usr-eve";

  /**
   * Write one override the way the admin route and the governance apply loop
   * both leave the table, then reload the cache the server reads.
   */
  const vote = async (key: string, value: string) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `game_variables` (`config_key`, `value`, `value_type`) VALUES (?,?,'text') " +
        "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
      [key, value],
    );
    await loadVariables(pool);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM `member_needs`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `need_links`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `village_needs`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  /**
   * A VILLAGE THAT HAS NEVER VOTED HAS NO ROW, and that is not the same fact
   * as a row holding the default. Every test below starts from no row, so the
   * default cases are reading the absence and never a zero somebody wrote.
   */
  afterEach(async () => {
    await pool.query("DELETE FROM `game_variables` WHERE `config_key` LIKE 'needs.%'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await loadVariables(pool);
  });

  describe("the privacy floor it voted is the floor the server keeps", () => {
    it("withholds a count of four when the village voted five", async () => {
      await vote("needs.aggregate_floor", "5");
      await upsertScopeNeed(pool, { needKey: "love", depthTarget: "satisfied" });
      for (const who of [ANA, BEN, CAI, DEE]) {
        await saveMemberNeed(pool, who, { needKey: "love", depth: "satisfied" });
      }

      const report = await needsAggregate(pool);
      expect(report.floor).toBe(5);
      const love = report.needs.find((n) => n.needKey === "love");
      expect(love?.suppressed).toBe(true);
      expect(love?.answers).toBeNull();
      expect(love?.atOrAbove).toBeNull();
      expect(love?.below).toBeNull();
    });

    it("releases the same count at the fifth answer", async () => {
      await vote("needs.aggregate_floor", "5");
      await upsertScopeNeed(pool, { needKey: "love", depthTarget: "satisfied" });
      for (const who of [ANA, BEN, CAI, DEE, EVE]) {
        await saveMemberNeed(pool, who, { needKey: "love", depth: "satisfied" });
      }

      const love = (await needsAggregate(pool)).needs.find((n) => n.needKey === "love");
      expect(love?.suppressed).toBe(false);
      expect(love?.answers).toBe(5);
      expect(love?.atOrAbove).toBe(5);
    });

    it("a floor under the registry's own minimum still suppresses one answer", async () => {
      await vote("needs.aggregate_floor", "0");
      await upsertScopeNeed(pool, { needKey: "love", depthTarget: "satisfied" });

      // No answers at all, under a floor a village tried to set to nothing.
      // 0 answers is still under a floor of 1, so the row is withheld and the
      // screen says "too few" instead of printing a confident zero.
      expect(aggregateFloor()).toBe(1);
      const love = (await needsAggregate(pool)).needs.find((n) => n.needKey === "love");
      expect(love?.suppressed).toBe(true);
    });

    it("with no row at all, the floor is the one the registry declares", async () => {
      await upsertScopeNeed(pool, { needKey: "love", depthTarget: "satisfied" });
      await saveMemberNeed(pool, ANA, { needKey: "love", depth: "satisfied" });
      await saveMemberNeed(pool, BEN, { needKey: "love", depth: "thriving" });

      const two = await needsAggregate(pool);
      expect(two.floor).toBe(NEEDS_AGGREGATE_FLOOR);
      expect(two.needs.find((n) => n.needKey === "love")?.suppressed).toBe(true);

      await saveMemberNeed(pool, CAI, { needKey: "love", depth: "deprived" });
      const three = (await needsAggregate(pool)).needs.find((n) => n.needKey === "love");
      expect(three?.suppressed).toBe(false);
      expect(three?.answers).toBe(3);
    });
  });

  describe("the rung it voted is the rung a new need starts at", () => {
    it("writes the voted depth into the column, and never the platform one", async () => {
      await vote("needs.default_depth_target", "thriving");
      await upsertScopeNeed(pool, { needKey: "love" });

      const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT `depth_target` FROM `village_needs` WHERE `need_key` = 'love'",
      );
      expect(rows[0].depth_target).toBe("thriving");
      expect((await readNeed(pool, "love"))?.depthTarget).toBe("thriving");
    });

    it("a scope editor that names a rung still wins over the dial", async () => {
      await vote("needs.default_depth_target", "thriving");
      await upsertScopeNeed(pool, { needKey: "love", depthTarget: "alive" });

      expect((await readNeed(pool, "love"))?.depthTarget).toBe("alive");
    });

    it("judges an out-of-scope need against the voted rung", async () => {
      await vote("needs.default_depth_target", "thriving");
      // Nobody adopted Play, and three members answered Satisfied on it. Under
      // the hardcoded "satisfied" all three counted as at-or-above; under the
      // rung this village actually voted, all three are below it.
      for (const who of [ANA, BEN, CAI]) {
        await saveMemberNeed(pool, who, { needKey: "play", depth: "satisfied" });
      }

      const play = (await needsAggregate(pool)).needs.find((n) => n.needKey === "play");
      expect(play?.inScope).toBe(false);
      expect(play?.depthTarget).toBe("thriving");
      expect(play?.atOrAbove).toBe(0);
      expect(play?.below).toBe(3);
    });

    it("with no row at all, a new need starts at the rung the registry declares", async () => {
      await upsertScopeNeed(pool, { needKey: "love" });
      expect((await readNeed(pool, "love"))?.depthTarget).toBe(NEEDS_DEFAULT_DEPTH_TARGET);
      expect(defaultDepthTarget()).toBe(NEEDS_DEFAULT_DEPTH_TARGET);
    });
  });

  describe("the share it voted is the share a new need aims at", () => {
    it("writes the voted percentage into the column", async () => {
      await vote("needs.default_breadth_pct", "40");
      await upsertScopeNeed(pool, { needKey: "love" });

      const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT `breadth_target_pct` FROM `village_needs` WHERE `need_key` = 'love'",
      );
      expect(Number(rows[0].breadth_target_pct)).toBe(40);
      expect((await readNeed(pool, "love"))?.breadthTargetPct).toBe(40);
    });

    it("a scope editor that names a share still wins over the dial", async () => {
      await vote("needs.default_breadth_pct", "40");
      await upsertScopeNeed(pool, { needKey: "love", breadthTargetPct: 75 });

      expect((await readNeed(pool, "love"))?.breadthTargetPct).toBe(75);
    });

    it("a voted zero is a real zero and never the platform hundred", async () => {
      await vote("needs.default_breadth_pct", "0");
      await upsertScopeNeed(pool, { needKey: "love" });

      expect((await readNeed(pool, "love"))?.breadthTargetPct).toBe(0);
      expect(defaultBreadthPct()).toBe(0);
    });

    it("with no row at all, a new need aims at the share the registry declares", async () => {
      await upsertScopeNeed(pool, { needKey: "love" });
      expect((await readNeed(pool, "love"))?.breadthTargetPct).toBe(NEEDS_DEFAULT_BREADTH_PCT);
      expect(defaultBreadthPct()).toBe(NEEDS_DEFAULT_BREADTH_PCT);
    });
  });
});
