/**
 * THE POOL THE SUITES RUN ON IS CONFIGURED LIKE THE POOL THE APP RUNS ON.
 *
 * `server/db/pool.test.ts` proves the application's pool pins its MySQL session
 * zone, and its third case reproduces, deliberately, the regime every suite in
 * this repository was actually running in: a pool with `timezone: "Z"` and no
 * session pin. This file is the other half of that sentence. It proves that a
 * pool built by `testPool` is pinned, and it measures what the unpinned shape
 * costs, so the cost is a number in a test rather than a warning in a comment.
 *
 * ── EVERY ASSERTION HERE IS HOST-INDEPENDENT, AND THAT IS THE HARD PART ────
 *
 * This defect is invisible on a UTC database, and CI's MySQL runs on one. A
 * test that asserted "the unpinned reading is wrong" would pass on the machine
 * where the bug bites and fail on the machine that decides, which is the wrong
 * way round for a guard. So nothing here demands a non-zero offset. What the
 * assertions pin instead is ABSOLUTE: the pinned pool reads a literal as the
 * epoch that literal actually names, and the unpinned one is displaced by a
 * whole zone offset, which is zero on a UTC server and eight hours here. Both
 * halves hold on either engine.
 *
 * The offset is measured and never named, for the reason
 * `server/db/sessionZone.ts` sets out: `@@session.time_zone` reads `SYSTEM` on
 * both engines, on the UTC one and on the one hours away from it. And it is
 * measured FOR THE DATE IN QUESTION, because the offset in force today is not
 * the offset that applies to a stored February instant. The control case says
 * what that cost, in numbers, when this file was written.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_ZONE, zoneProblem } from "./sessionZone";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./testDb";

const configured = testDbConfigured();

/** What the server says its offset from UTC is right now, in seconds. */
async function offsetSeconds(c: mysql.Connection): Promise<number> {
  const [[row]] = await c.query<any[]>("SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS s");
  return Number(row.s);
}

describe.skipIf(!configured)("the pool the suites run on", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await provisionTestDb();
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("pins the session zone on every connection it opens", async () => {
    const pool = testPool(db, { connectionLimit: 4 });
    try {
      // Four at once, so this reads more than one pooled connection. A hook
      // that fired for the first only would show up here and nowhere else.
      const seen = await Promise.all(
        [0, 1, 2, 3].map(async () => {
          const [rows] = await pool.query<any[]>("SELECT @@session.time_zone AS tz");
          return String(rows[0].tz);
        }),
      );
      expect(seen).toEqual([SESSION_ZONE, SESSION_ZONE, SESSION_ZONE, SESSION_ZONE]);
      expect(await zoneProblem(pool)).toBeNull();
    } finally {
      await pool.end();
    }
  });

  it("and reads NOW() in the same frame as this process's clock", async () => {
    const pool = testPool(db, { connectionLimit: 2 });
    try {
      const [[row]] = await pool.query<any[]>("SELECT NOW() AS n, UNIX_TIMESTAMP(NOW()) AS u");
      // Both readings, the rendered one and the numeric one, agree with us.
      expect(Math.abs(Date.now() - new Date(row.n).getTime())).toBeLessThan(5_000);
      expect(Math.abs(Number(row.u) * 1000 - Date.now())).toBeLessThan(5_000);
    } finally {
      await pool.end();
    }
  });

  it("THE CONTROL: the old unpinned shape is off by exactly the server's offset", async () => {
    /*
     * This is the shape 175 test files use today, spelled out rather than
     * imported so that fixing them does not quietly delete the evidence.
     *
     * On CI the offset is zero and this still asserts something real: that the
     * pinned and unpinned readings differ by precisely it. On a machine hours
     * from UTC the same line catches a whole hour.
     */
    const unpinned = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 2 }); // test-pool-ok: the unpinned shape IS the control this case measures
    const pinned = testPool(db, { connectionLimit: 2 });
    try {
      const [[loose]] = await unpinned.query<any[]>("SELECT UNIX_TIMESTAMP('2026-02-20 12:00:00') AS u");
      const [[tight]] = await pinned.query<any[]>("SELECT UNIX_TIMESTAMP('2026-02-20 12:00:00') AS u");

      // The pinned pool means exactly what it says, on any host.
      expect(Number(tight.u)).toBe(Date.UTC(2026, 1, 20, 12, 0, 0) / 1000);

      // The unpinned one is shifted by a whole zone offset, which is always a
      // round number of minutes and zero only on a UTC server.
      const dateOffset = Number(tight.u) - Number(loose.u);
      // `Math.abs` because a negative offset gives `-0` here, and vitest's
      // `toBe` is Object.is, under which -0 and 0 are different values.
      expect(Math.abs(dateOffset % 60)).toBe(0);

      /*
       * AND THE OFFSET THAT APPLIES IS THE ONE FOR THE DATE BEING READ, NEVER
       * THE ONE IN FORCE TODAY. This assertion was written the other way round
       * first and failed, usefully: run in September on a host observing
       * daylight saving, `NOW()` reported -25200 while the February literal
       * above was read at -28800. An hour apart, on the same connection, in the
       * same second.
       *
       * So a suite that tried to COMPENSATE by measuring the current offset
       * would still be wrong whenever the stored instant sits on the other side
       * of a boundary, which is why the fix is to pin the session rather than
       * to correct for it. On a UTC server both numbers are zero and the
       * assertion below still holds.
       */
      const probe = await mysql.createConnection({ uri: db.url, timezone: "Z" });
      const nowOffset = await offsetSeconds(probe);
      await probe.end();
      expect(Math.abs(nowOffset % 60)).toBe(0);
      // Both are "local, seconds from UTC", so they agree except across a
      // boundary, where they part by that zone's shift and never by more.
      expect(Math.abs(dateOffset - nowOffset)).toBeLessThanOrEqual(3600);

      // The unpinned pool also fails to answer for itself, wherever it runs.
      if (dateOffset !== 0) expect(await zoneProblem(unpinned)).toContain("SESSION ZONE IS");
    } finally {
      await unpinned.end();
      await pinned.end();
    }
  });

  it("a daylight-saving boundary moves the offset, so one suite is wrong by two different amounts", async () => {
    /*
     * The failure this whole change exists for, reproduced without depending on
     * the host's own zone.
     *
     * A WALL-CLOCK STRING passed to `UNIX_TIMESTAMP` is interpreted in the
     * SESSION zone, which is the case these cases drive. Read that precisely:
     * `UNIX_TIMESTAMP` of a `NOW()`-written COLUMN is self-consistent and is
     * the remedy, because both ends are evaluated in the same frame. It is the
     * literal, and a value compared against a JS `Date`, that move.
     *
     * A host that observes daylight saving therefore reads the same
     * stored wall clock differently in February and in April, and a suite
     * written against one of those dates is wrong by an hour more or less than
     * a suite written against the other. Two hard-coded numeric offsets stand
     * in for the two sides of the boundary, which is the mechanism exactly and
     * needs no timezone tables loaded.
     */
    const winter = await mysql.createConnection({ uri: db.url, timezone: "Z" });
    try {
      const readUnder = async (zone: string, literal: string): Promise<number> => {
        await winter.query(`SET time_zone = '${zone}'`); // module-review-ok: the session pin is the thing under test, on the S5 scratch schema
        const [[row]] = await winter.query<any[]>("SELECT UNIX_TIMESTAMP(?) AS u", [literal]);
        return Number(row.u);
      };

      const feb = await readUnder("-08:00", "2026-02-20 12:00:00");
      const apr = await readUnder("-07:00", "2026-04-01 12:00:00");
      const febUtc = await readUnder(SESSION_ZONE, "2026-02-20 12:00:00");
      const aprUtc = await readUnder(SESSION_ZONE, "2026-04-01 12:00:00");

      // Forty days apart, and the error is a different size on each date.
      expect(feb - febUtc).toBe(8 * 3600);
      expect(apr - aprUtc).toBe(7 * 3600);
      // Which is the whole point: the drift is not a constant a test can absorb.
      expect(feb - febUtc - (apr - aprUtc)).toBe(3600);
    } finally {
      await winter.end();
    }
  });

  it("and with real zone tables loaded, a named zone shows the same hour by itself", async () => {
    /*
     * The same proof without the stand-in, where the server can give it. MySQL
     * needs its timezone tables populated to accept a NAME, and a server
     * without them throws, which is why nothing in this codebase pins by name
     * and why this case reports rather than fails when it cannot run.
     */
    const c = await mysql.createConnection({ uri: db.url, timezone: "Z" });
    try {
      try {
        await c.query("SET time_zone = 'America/Los_Angeles'"); // module-review-ok: the session pin is the thing under test, on the S5 scratch schema
      } catch {
        console.warn("[sessionZone.test] no timezone tables on this server, the named-zone case did not run.");
        return;
      }
      const [[row]] = await c.query<any[]>(
        "SELECT UNIX_TIMESTAMP('2026-01-15 12:00:00') AS winter, UNIX_TIMESTAMP('2026-07-15 12:00:00') AS summer",
      );
      await c.query(`SET time_zone = '${SESSION_ZONE}'`); // module-review-ok: the session pin is the thing under test, on the S5 scratch schema
      const [[utc]] = await c.query<any[]>(
        "SELECT UNIX_TIMESTAMP('2026-01-15 12:00:00') AS winter, UNIX_TIMESTAMP('2026-07-15 12:00:00') AS summer",
      );
      const winterDrift = Number(row.winter) - Number(utc.winter);
      const summerDrift = Number(row.summer) - Number(utc.summer);
      expect(winterDrift).toBe(8 * 3600);
      expect(summerDrift).toBe(7 * 3600);
    } finally {
      await c.end();
    }
  });
});
