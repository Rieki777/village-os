/**
 * THE FOUNDERS TAKE THE STEWARD'S SEAT WHEN THE LAUNCH VOTE CARRIES.
 *
 * Rye, 2026-09-23: "Seat them at launch."
 *
 * ── WHAT THIS SUITE IS FOR, WHICH IS NOT WHAT THE STEWARDSHIP SUITE IS FOR ──
 *
 * `server/stewardship.db.test.ts` already drives `seatCatalystsAsStewards`
 * hard: the role, the capability, the village's holding, the term column, the
 * per-term history, the unique key. Every one of those assertions passed for
 * eight weeks while NOTHING outside that suite ever called the function, which
 * is the defect this lane closes. A green function nobody calls is a green
 * about code that never runs.
 *
 * So nothing here re-asserts those writes. This suite pins the half that was
 * missing: that the LAUNCH CLOSER's seating runs at all, that the term comes
 * from `resolveSeatTerm` the way a voted seat's does and is capped at the
 * season's end, that a retried close seats and tells nobody twice, that a
 * calendar which cannot give a term does not take the launch down with it, and
 * that being seated is what hands a founder the break-glass.
 *
 * It drives `seatFoundersAtLaunch` against a real schema with the closer's
 * side effects recorded rather than performed, because those side effects ARE
 * the behaviour: a seat nobody was told about and a village with no record of
 * it is not a seating.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { loadVariables } from "./lib/variables";
import { seatFoundersAtLaunch, type LaunchSeatingDeps } from "./lib/launchSeating";
import { holdingHasLapsed, stewardHoldingId, STEWARD_ROLE_ID, STEWARD_VETO } from "./lib/stewardship";
import { civilDateInstant, type SeatCalendar } from "../shared/seatTerms";

const configured = testDbConfigured();

const LAUNCH_BALLOT = "bal-birthing";
const TZ = "UTC";
/** A civil date `n` days from now, which is what a season list holds. */
const day = (n: number): string => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
/** Well inside `RECORD_LIMIT` (2038-01-19), which `resolveSeatTerm` refuses past. */
const SEASON_ENDS_ON = day(40);

const runningSeason = (): SeatCalendar => ({
  seasons: [{ id: "rooting-2026", startsOn: day(-10), endsOn: SEASON_ENDS_ON }],
  currentSeasonId: "rooting-2026",
  timezone: TZ,
});

interface Rung {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  dedupeKey: string;
}

/** The closer's side effects, recorded instead of performed. */
function recorder(pool: Pool) {
  const rung: Rung[] = [];
  const pulse: string[] = [];
  const admins: string[] = [];
  const audits: string[] = [];
  let reloads = 0;
  return {
    rung,
    pulse,
    admins,
    audits,
    reloads: () => reloads,
    deps(over: Partial<LaunchSeatingDeps> = {}): LaunchSeatingDeps {
      return {
        pool,
        calendar: runningSeason(),
        ballotId: LAUNCH_BALLOT,
        actorId: "cat-1",
        withRoleHolderLock: (fn) => fn(),
        reloadRoleCaches: async () => {
          reloads += 1;
        },
        notify: async (i) => {
          rung.push(i as Rung);
        },
        addActivity: async (text) => {
          pulse.push(text);
        },
        audit: (text) => {
          audits.push(text);
        },
        notifyAdmins: async (title, dedupeKey) => {
          admins.push(`${title}|${dedupeKey}`);
        },
        ...over,
      };
    },
  };
}

/**
 * A pool with BOTH halves of the app's timezone discipline, not just one.
 *
 * `server/db/pool.ts` sets `timezone: "Z"` AND `SET time_zone = '+00:00'` on
 * every connection, and its own header says why: the driver option only says
 * how a JS Date is rendered, while the SESSION zone is what MySQL reads that
 * rendering back in. The scratch-schema suites all set the first and not the
 * second, which cancels out for anything written and read through the driver
 * and does NOT cancel for `UNIX_TIMESTAMP`, the only read that cannot be
 * shifted by a host's zone. Measured on this machine's database: seven hours
 * off in one direction on one date and eight on another, forty days apart,
 * which is a daylight-saving boundary and exactly the shape of bug a relative
 * assertion never sees.
 *
 * So this suite runs the app's own discipline and then reads the true instant.
 */
function connect(url: string): Pool {
  const p = mysql.createPool({ uri: url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  p.on("connection", (c) => {
    c.query("SET time_zone = '+00:00'"); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });
  return p;
}

async function member(pool: Pool, id: string, name: string, role: string): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
    "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)",
    [id, name, `${id}@example.invalid`, "x", role],
  );
}

/**
 * A seat as the column holds it, read through UNIX_TIMESTAMP.
 *
 * `term_ends_at` is a TIMESTAMP, and a driver read of one shifts by the
 * database host's offset, which is how a term can look an hour or a day off
 * while the stored instant is exact. The epoch second is the same number
 * everywhere.
 */
async function seatOf(pool: Pool, userId: string): Promise<{ id: string; endsAtMs: number; seasonId: string | null; grantedBy: string | null; followsSeason: boolean } | null> {
  const [rows]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT id, UNIX_TIMESTAMP(term_ends_at) AS ends, season_id, granted_by, term_follows_season FROM role_holders WHERE role_id = ? AND user_id = ?",
    [STEWARD_ROLE_ID, userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    endsAtMs: Number(r.ends) * 1000,
    seasonId: r.season_id === null ? null : String(r.season_id),
    grantedBy: r.granted_by === null ? null : String(r.granted_by),
    followsSeason: !!r.term_follows_season,
  };
}

/**
 * THE TWO FACTS PR #312's BREAK-GLASS STEP READS, and no restatement of its rule.
 *
 * `capabilityDecision` (shared/capabilities.ts, PR #312) lets a break-glass
 * through only for a requester whose ACCOUNT ROLE is `founder` and whose
 * `roleCapabilities` list carries `BREAK_GLASS_SEAT`, which is `steward.veto`.
 * That list is built by `roleCapabilitiesFor` in server/index.ts, over the
 * roles of holdings `holdingHasLapsed` says are still live.
 *
 * This measures those two inputs off the same rows, because #312 is not on
 * main yet and this branch cannot import its gate. When it lands, this helper
 * is what its `CapabilityCtx` is built from, and the assertions below do not
 * move. The rule itself stays in exactly one place, which is #312's.
 */
async function breakGlassFactsFor(pool: Pool, userId: string): Promise<{ isFounder: boolean; roleCapabilities: string[] }> {
  const [users]: any = await pool.query("SELECT role FROM users WHERE id = ?", [userId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  const [holders]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT role_id, term_ends_at FROM role_holders WHERE user_id = ?",
    [userId],
  );
  const live = holders.filter((h: any) => !holdingHasLapsed({ termEndsAt: h.term_ends_at }));
  const caps = new Set<string>();
  if (live.length > 0) {
    const [roles]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      `SELECT capabilities FROM roles WHERE id IN (${live.map(() => "?").join(",")})`,
      live.map((h: any) => h.role_id),
    );
    for (const r of roles) {
      const list = typeof r.capabilities === "string" ? JSON.parse(r.capabilities) : r.capabilities;
      for (const c of list ?? []) caps.add(String(c));
    }
  }
  return { isFounder: String(users[0]?.role ?? "") === "founder", roleCapabilities: Array.from(caps) };
}

describe.skipIf(!configured)("the launch seats the village's founders as stewards", () => {
  let db: TestDb;
  let pool: Pool;
  let log: ReturnType<typeof recorder>;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = connect(db.url);
    await loadVariables(pool);
    // Rye has ruled a village has three founders. All three are seated, and
    // the member beside them is what makes the seating a filter rather than a
    // sweep of the roll.
    await member(pool, "cat-1", "Wren Alder", "founder");
    await member(pool, "cat-2", "Iris Fenn", "founder");
    await member(pool, "cat-3", "Bram Quill", "founder");
    await member(pool, "mem-1", "Rook Salt", "member");
    log = recorder(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("finds nobody on the seat before the vote carries, so the seating below is the thing that fills it", async () => {
    // The known positive for every empty answer in this block: the table is
    // empty because nothing has run, not because the query is wrong.
    const [rows]: any = await pool.query("SELECT COUNT(*) AS n FROM role_holders"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(Number(rows[0].n)).toBe(0);
  });

  it("seats every founder, with a term, and the term is the season's end", async () => {
    const out = await seatFoundersAtLaunch(log.deps());
    expect(out.ok).toBe(true);
    expect(out.held).toBeNull();
    expect(out.seated.sort()).toEqual(["cat-1", "cat-2", "cat-3"]);
    expect(out.alreadySeated).toEqual([]);
    expect(out.termEndsOn).toBe(SEASON_ENDS_ON);

    const capAt = civilDateInstant(SEASON_ENDS_ON, TZ)!.getTime();
    for (const id of ["cat-1", "cat-2", "cat-3"]) {
      const seat = await seatOf(pool, id);
      expect(seat, `${id} holds a seat`).not.toBeNull();
      // NOT "has a term": the term is the season's end to the second, which is
      // the cap of ruling 2026-09-14. A seat a day past it would have a term
      // and still be the defect.
      expect(seat!.endsAtMs, `${id}'s term is capped at the season's end`).toBe(capAt);
      expect(seat!.endsAtMs).toBeGreaterThan(Date.now());
      expect(seat!.seasonId).toBe("rooting-2026");
      expect(seat!.followsSeason, "so an admin moving the season moves the seat").toBe(true);
      expect(seat!.grantedBy, "the village put them here, not an administrator").toBe(LAUNCH_BALLOT);
    }
  });

  it("writes no seat with no term, which is the standing ruling", async () => {
    const [rows]: any = await pool.query("SELECT COUNT(*) AS n FROM role_holders WHERE term_ends_at IS NULL"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(Number(rows[0].n)).toBe(0);
  });

  it("does not seat a member who is not a founder", async () => {
    expect(await seatOf(pool, "mem-1")).toBeNull();
    expect(log.rung.some((r) => r.userId === "mem-1")).toBe(false);
  });

  it("tells each seated founder, once, and says when the seat ends", async () => {
    const seatNotices = log.rung.filter((r) => r.type === "role_appointed");
    expect(seatNotices.map((r) => r.userId).sort()).toEqual(["cat-1", "cat-2", "cat-3"]);
    expect(seatNotices[0].dedupeKey).toBe(`role:${stewardHoldingId(seatNotices[0].userId)}`);
    expect(String(seatNotices[0].body)).toContain(SEASON_ENDS_ON);
    expect(String(seatNotices[0].title)).toContain("Steward");
  });

  it("leaves one line the village can read, and reloads the caches the gate reads", async () => {
    expect(log.pulse).toHaveLength(1);
    expect(log.pulse[0]).toContain("Steward");
    expect(log.pulse[0]).toContain(SEASON_ENDS_ON);
    expect(log.reloads(), "or the capability gate serves the old answer until the process restarts").toBeGreaterThan(0);
    expect(log.admins, "nothing here needs an administrator").toEqual([]);
  });

  it("seats nobody twice and tells nobody twice when the close is retried", async () => {
    // A failed at-close landing parks `village_launch` and the landing job runs
    // `execute` again (server/lib/atCloseLanding.ts), so this is the ordinary
    // case and not an exotic one.
    const before = log.rung.length;
    const pulseBefore = log.pulse.length;
    const again = await seatFoundersAtLaunch(log.deps());

    expect(again.ok).toBe(true);
    expect(again.seated, "nothing to do, which is not a failure").toEqual([]);
    expect(again.alreadySeated.sort()).toEqual(["cat-1", "cat-2", "cat-3"]);
    expect(log.rung.length - before, "no second notice").toBe(0);
    expect(log.pulse.length - pulseBefore, "no second line on the pulse").toBe(0);

    const [rows]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) AS n FROM role_holders WHERE role_id = ?",
      [STEWARD_ROLE_ID],
    );
    expect(Number(rows[0].n), "one seat each, not two").toBe(3);
    const [terms]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) AS n FROM role_holder_terms WHERE role_id = ?",
      [STEWARD_ROLE_ID],
    );
    expect(Number(terms[0].n), "one mandate each in the history").toBe(3);
  });
});

describe.skipIf(!configured)("a founder who already holds the seat", () => {
  let db: TestDb;
  let pool: Pool;
  let log: ReturnType<typeof recorder>;
  /** Ten days out: a real term, and deliberately not the season's end. */
  const THEIRS_ENDS_AT = new Date(Math.floor((Date.now() + 10 * 86400000) / 1000) * 1000);

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = connect(db.url);
    await loadVariables(pool);
    await member(pool, "cat-1", "Wren Alder", "founder");
    await member(pool, "cat-2", "Iris Fenn", "founder");
    log = recorder(pool);
    // Voted into the seat before the launch, on a shorter term of their own.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
      "INSERT INTO roles (id, name, capabilities) VALUES (?,?,?)",
      [STEWARD_ROLE_ID, "Steward", JSON.stringify([STEWARD_VETO])],
    );
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema
      "INSERT INTO role_holders (id, role_id, user_id, granted_by, term_ends_at, season_id, term_follows_season) VALUES (?,?,?,?,?,?,?)",
      ["rh-voted-in", STEWARD_ROLE_ID, "cat-1", "bal-earlier-seat", THEIRS_ENDS_AT, "rooting-2026", 0],
    );
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("keeps the seat and the term they already had, and hears nothing about it", async () => {
    const out = await seatFoundersAtLaunch(log.deps());
    expect(out.ok).toBe(true);
    expect(out.alreadySeated).toEqual(["cat-1"]);
    expect(out.seated).toEqual(["cat-2"]);

    const theirs = await seatOf(pool, "cat-1");
    expect(theirs!.id, "the row they were voted into, not a new one").toBe("rh-voted-in");
    expect(theirs!.endsAtMs, "their own term, not the season's end").toBe(THEIRS_ENDS_AT.getTime());
    expect(theirs!.endsAtMs).not.toBe(civilDateInstant(SEASON_ENDS_ON, TZ)!.getTime());
    expect(theirs!.followsSeason, "and it still does not follow the season").toBe(false);
    expect(theirs!.grantedBy, "the vote that seated them is still the grantor").toBe("bal-earlier-seat");

    expect(log.rung.map((r) => r.userId), "only the founder this run seated is told").toEqual(["cat-2"]);
    const [terms]: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) AS n FROM role_holder_terms WHERE user_id = 'cat-1'",
    );
    expect(Number(terms[0].n), "and no second mandate is opened over the one they hold").toBe(0);
  });
});

describe.skipIf(!configured)("a calendar that cannot give the seat a term", () => {
  let db: TestDb;
  let pool: Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = connect(db.url);
    await loadVariables(pool);
    await member(pool, "cat-1", "Wren Alder", "founder");
    await member(pool, "cat-2", "Iris Fenn", "founder");
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  /**
   * THE DECISION THIS PINS, because it was a choice between three answers.
   *
   * Refusing the launch is wrong: it has carried, `recordGameStart` has run,
   * and throwing would park it for the landing job to retry a calendar problem
   * every five minutes while telling the village its launch has not taken
   * effect. Seating nobody silently is wrong and is what the code did before.
   *
   * So the Game starts, nobody is seated, and the village is told in the
   * refusal's own words. The empty seat is then the ordinary empty seat
   * `vacancyState` calls healthy, and the village can vote one in.
   */
  for (const [what, calendar, expected] of [
    ["no season is running", { seasons: [], currentSeasonId: null, timezone: TZ }, "no season is running"],
    [
      "the season has no end date",
      { seasons: [{ id: "founding", startsOn: day(-10), endsOn: null }], currentSeasonId: "founding", timezone: TZ },
      "has no end date",
    ],
  ] as Array<[string, SeatCalendar, string]>) {
    it(`seats nobody, refuses nothing, and says so when ${what}`, async () => {
      const log = recorder(pool);
      const out = await seatFoundersAtLaunch(log.deps({ calendar }));

      expect(out.ok).toBe(false);
      expect(out.seated).toEqual([]);
      expect(out.termEndsOn).toBeNull();

      // Said out loud, in the village's own record and in the words
      // `resolveSeatTerm` chose, which name the screen an admin fixes it on.
      expect(String(out.held)).toContain("started its Game");
      expect(String(out.held)).toContain(expected);
      expect(String(out.held)).toContain("Admin");
      expect(log.pulse, "the village reads it, not only the administrators").toEqual([out.held]);
      expect(log.admins).toHaveLength(1);
      expect(log.admins[0]).toContain(`bal:${LAUNCH_BALLOT}:launch-seating-held`);

      // And it wrote nothing on its way out: no seat, and no role carrying the
      // veto for a seat nobody sits in.
      const [holders]: any = await pool.query("SELECT COUNT(*) AS n FROM role_holders"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      expect(Number(holders[0].n)).toBe(0);
      const [roles]: any = await pool.query("SELECT COUNT(*) AS n FROM roles WHERE id = ?", [STEWARD_ROLE_ID]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      expect(Number(roles[0].n)).toBe(0);
      expect(log.rung, "and nobody is told they hold a seat they do not").toEqual([]);
    });
  }
});

describe.skipIf(!configured)("the break-glass a founder gets by being seated (PR #312)", () => {
  let db: TestDb;
  let pool: Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = connect(db.url);
    await loadVariables(pool);
    await member(pool, "cat-1", "Wren Alder", "founder");
    await member(pool, "mem-1", "Rook Salt", "member");
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("a founder cannot reach past the village before the launch, and can after it", async () => {
    /*
     * WHY THIS TEST IS HERE AT ALL. Rye ruled on 2026-09-21 that a founder
     * keeps an override on a power the village holds "only if the founder is
     * holding the Steward role and has the power to veto". Launch is also the
     * moment the founder's standing powers end (`founderPowerStands`). So a
     * launch that seated nobody took the last door away in the same instant it
     * took the founder's powers, and this is the assertion that the two
     * halves of that ruling arrive together.
     */
    const before = await breakGlassFactsFor(pool, "cat-1");
    expect(before.isFounder, "being a founder was never the whole of it").toBe(true);
    expect(before.roleCapabilities, "and on its own it opens nothing").not.toContain(STEWARD_VETO);

    const log = recorder(pool);
    const out = await seatFoundersAtLaunch(log.deps());
    expect(out.ok).toBe(true);

    const after = await breakGlassFactsFor(pool, "cat-1");
    expect(after.isFounder).toBe(true);
    expect(after.roleCapabilities, "seated, with the veto, on a term that has not lapsed").toContain(STEWARD_VETO);

    // And an ordinary member is where they were, through the same read.
    const other = await breakGlassFactsFor(pool, "mem-1");
    expect(other.isFounder).toBe(false);
    expect(other.roleCapabilities).not.toContain(STEWARD_VETO);
  });
});
