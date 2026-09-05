/**
 * The steward read, against a real schema.
 *
 * `server/lib/pathLadders.test.ts` proves the derivation from rows handed to it.
 * This proves the rows: that the query returns the ones a ladder needs, in a
 * shape the derivation can read, and that its two riskiest properties hold
 * against MySQL rather than against a comment.
 *
 *  1. ENDED SEATINGS COME BACK. They never lift a position, and they are the
 *     only thing that can say a rung was reached. A query that filtered them
 *     out would make a steward's ladder go blank on the day they stood down,
 *     with nothing able to tell that apart from somebody who was never seated.
 *  2. THE SEAT'S OWN FLAGS ARRIVE WITH THE SEATING. Two of the three rungs are
 *     decided by columns on `org_roles`, and a mis-spelled alias would leave
 *     them all false and every ladder one rung short, silently.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { stewardLadder, NO_MOONS } from "../lib/pathLadders";
import type { LapseContext } from "../lib/orgChart";
import { seatingsForMember } from "./pathLadders";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

const MEMBER = "u-ines";
const OTHER = "u-tomas";

const CTX: LapseContext = { currentSeasonId: "s2", cadence: "season_turn" };

describe.skipIf(!configured)("the steward path's read", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM org_role_assignments"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query("DELETE FROM org_roles"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
  });

  const addSeat = async (
    id: string,
    over: { representsCircle?: boolean; expiresEachSeason?: number | null; active?: number } = {},
  ) => {
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO org_roles (id, name, represents_circle, expires_each_season, active) VALUES (?,?,?,?,?)",
      [
        id,
        `Seat ${id}`,
        over.representsCircle ? 1 : 0,
        over.expiresEachSeason === undefined ? null : over.expiresEachSeason,
        over.active === undefined ? 1 : over.active,
      ],
    );
  };

  const seat = async (
    id: string,
    roleId: string,
    userId: string,
    over: { seasonId?: string | null; endedAt?: string | null; endedReason?: string | null } = {},
  ) => {
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO org_role_assignments " +
        "(id, org_role_id, holder_kind, user_id, holder_key, season_id, ended_at, ended_reason) " +
        "VALUES (?,?,'member',?,?,?,?,?)",
      [id, roleId, userId, userId, over.seasonId ?? "s2", over.endedAt ?? null, over.endedReason ?? null],
    );
  };

  it("returns this member's seatings and nobody else's", async () => {
    await addSeat("r1");
    await seat("a1", "r1", MEMBER);
    await seat("a2", "r1", OTHER);
    const mine = await seatingsForMember(pool, MEMBER);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.orgRoleId).toBe("r1");
  });

  it("returns ended seatings alongside live ones", async () => {
    await addSeat("r1");
    await addSeat("r2");
    await seat("a1", "r1", MEMBER, { endedAt: "2026-05-01 00:00:00", endedReason: "stood down" });
    await seat("a2", "r2", MEMBER);
    const rows = await seatingsForMember(pool, MEMBER);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.endedAt !== null)).toHaveLength(1);
    expect(rows.find((r) => r.endedAt !== null)?.endedReason).toBe("stood down");
  });

  it("carries the seat's own flags on every seating", async () => {
    await addSeat("r1", { representsCircle: true, expiresEachSeason: 0 });
    await seat("a1", "r1", MEMBER);
    const rows = await seatingsForMember(pool, MEMBER);
    expect(rows[0]?.roleRepresentsCircle).toBe(true);
    expect(rows[0]?.roleExpiresEachSeason).toBe(false);
    expect(rows[0]?.roleActive).toBe(true);
    expect(rows[0]?.roleIsExample).toBe(false);
  });

  /*
   * LEFT and not INNER. A seating whose seat has been deleted still returns,
   * with the role flags absent, which the derivation reads as a seat that is
   * not active and speaks for nothing. An INNER join would drop the row and
   * shorten the member's history with no error anywhere.
   */
  it("still returns a seating whose seat has gone", async () => {
    await addSeat("r1");
    await seat("a1", "r1", MEMBER);
    await pool.query("DELETE FROM org_roles WHERE id = 'r1'"); // module-review-ok: the scratch schema this suite provisioned
    const rows = await seatingsForMember(pool, MEMBER);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.roleActive).toBe(false);
    expect(rows[0]?.roleRepresentsCircle).toBe(false);
  });

  /*
   * THE WHOLE JOURNEY, end to end against real rows: the position is derived
   * on every read, so ending the seating in the database lowers it with nothing
   * else written and no cache to clear.
   */
  it("falls a rung when the seating ends, with no update path anywhere", async () => {
    await addSeat("r1");
    await seat("a1", "r1", MEMBER);
    const before = stewardLadder(await seatingsForMember(pool, MEMBER), CTX, NO_MOONS);
    expect(before.position).toBe(2);

    await pool.query( // module-review-ok: the scratch schema this suite provisioned
      "UPDATE org_role_assignments SET ended_at = '2026-05-01 00:00:00', ended_reason = ? WHERE id = 'a1'",
      ["term finished"],
    );
    const after = stewardLadder(await seatingsForMember(pool, MEMBER), CTX, NO_MOONS);
    expect(after.position).toBe(0);
    // And the record still knows it happened.
    expect(after.rungs[0]?.fell).toBe(true);
    expect(after.rungs[0]?.note).toBe("term finished");
  });

  /*
   * A season turn writes nothing at all. The same row read against a different
   * current season answers one rung lower, which is the property that makes a
   * stored rung unnecessary and a stored rung wrong.
   */
  it("falls a rung at a season turn with the row untouched", async () => {
    await addSeat("r1");
    await seat("a1", "r1", MEMBER, { seasonId: "s1" });
    const rows = await seatingsForMember(pool, MEMBER);
    expect(stewardLadder(rows, { ...CTX, currentSeasonId: "s1" }, NO_MOONS).position).toBe(2);
    expect(stewardLadder(rows, { ...CTX, currentSeasonId: "s2" }, NO_MOONS).position).toBe(1);

    const [check] = await pool.query<any[]>( // module-review-ok: the scratch schema this suite provisioned
      "SELECT season_id, ended_at FROM org_role_assignments WHERE id = 'a1'",
    );
    expect(check[0]?.season_id).toBe("s1");
    expect(check[0]?.ended_at).toBeNull();
  });
});
