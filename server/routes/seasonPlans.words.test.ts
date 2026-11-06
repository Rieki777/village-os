/**
 * A PLAYER'S OWN WORDS ON THEIR PLAN, OVER REAL HTTP AND A REAL SCHEMA
 * (player role card PR 6, migration 0267).
 *
 *   - repo round trip: goals served with how each helps, seasonal goals and
 *     card words go in and come back, and `serves_goal` holds the first goal;
 *   - a save that leaves a group out keeps the newest version's, and card
 *     words carry from an earlier season until this one has its own;
 *   - the card's editor (`PUT /mine/card`) saves only its groups and leaves
 *     the aim, commitments and seats handed back alone, still as a new
 *     version; a change to card words alone leaves a filed plan filed;
 *   - previous-release read: a row written with the 0258 columns only reads
 *     as one goal served, no seasonal goals and no card words;
 *   - the village page reads the goals and seasonal goals of the FILED version;
 *   - `PUT /mine/load`: signed out is 401 before the database is read, the row
 *     is always the caller's whatever the body names, a second read the same
 *     moon replaces the first, and a level outside 1 to 5 is refused;
 *   - erasure nulls every new column on every version and deletes the loads,
 *     and leaves another member's alone (control).
 */
import http from "node:http";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import { CALENDAR_CLOCK } from "../../shared/cycleClock";
import type { PlanSeason } from "../../shared/seasonPlans";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { eraseSeasonPlanWords, insertPlanVersion, moonLoadOf, moonLoadsOfMember, planToStore, planVersions } from "../repos/seasonPlans";
import { changedSinceFiling, register } from "./seasonPlans";

const LADDER = ["visitor", "guest", "member"];
const NOW = new Date("2027-02-15T12:00:00Z");
const MOON = CALENDAR_CLOCK.idFor(NOW);
const PEOPLE = [
  { id: "u-ana", name: "Ana Quillfeather", handle: "ana" },
  { id: "u-zed", name: "Zed Lanternwick", handle: "zed" },
];
const GOALS = ["Plant the north orchard", "Open the guest kitchen"];
const SEASONS: PlanSeason[] = [
  { id: "s-now", name: "Running Season", startsOn: "2026-12-01", endsOn: "2027-03-01" },
  { id: "s-next", name: "Next Season", startsOn: "2027-03-01", endsOn: "2027-06-01", goals: GOALS.map((text) => ({ text })) },
];

const configured = testDbConfigured();
if (!configured) console.warn("[seasonPlans.words] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

function harness() {
  const state = {
    viewer: null as { id: string; stage: string } | null,
    seasons: SEASONS,
    pool: (): any => {
      throw new Error("the database was read before the gate answered");
    },
  };
  let server: http.Server;
  let base = "";
  const ctxFor = () =>
    ({ stageIndex: LADDER.indexOf(state.viewer?.stage ?? "visitor"), stageIndexOf: (id: string) => LADDER.indexOf(id), roleCapabilities: [] }) as unknown as CapabilityCtx;
  const start = async () => {
    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async () => (state.viewer ? PEOPLE.find((p) => p.id === state.viewer!.id) ?? null : null),
      guardCapability: async (_req: any, res: any, cap: any, refusal?: { status: number; body: Record<string, unknown> }) => {
        if (state.viewer && hasCapability(cap, ctxFor())) return true;
        res.status(refusal?.status ?? 401).json(refusal?.body ?? { error: "auth_required" });
        return false;
      },
      capabilityCtx: async () => ctxFor(),
      getPool: () => state.pool(),
      notify: async () => ({ fresh: true }),
      overLimit: async () => false,
      members: { all: async () => PEOPLE } as any,
      isPresent: (m: any) => !!m,
      seasonState: () => ({ seasons: state.seasons, timezone: "UTC" }),
      clock: () => CALENDAR_CLOCK,
      lapse: () => ({ currentSeasonId: "s-now", cadence: "never" }),
      moduleGate: (_req, _res, next) => next(),
      now: () => NOW,
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  };
  const stop = () => new Promise<void>((resolve) => server?.close(() => resolve()));
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`${base}${url}`, { // module-review-ok: this suite's own loopback server, not an outbound call
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  return { state, start, stop, call };
}

describe("the moon load refuses a visitor before the database is read", () => {
  const h = harness();
  beforeAll(h.start);
  afterAll(h.stop);

  it("PUT /mine/load and PUT /mine/card answer 401 signed out", async () => {
    h.state.viewer = null;
    expect((await h.call("PUT", "/api/season-plans/mine/load", { level: 3 })).status).toBe(401);
    expect((await h.call("PUT", "/api/season-plans/mine/card", { cardWords: { findMe: "Mondays" } })).status).toBe(401);
  });

  it("CONTROL: signed in, the route reaches the database (here it throws, so 500)", async () => {
    h.state.viewer = { id: "u-ana", stage: "member" };
    expect((await h.call("PUT", "/api/season-plans/mine/load", { level: 3 })).status).toBe(500);
  });
});

describe.skipIf(!configured)("a player's own words, on a real schema", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    h.state.pool = () => pool;
    await h.start();
    for (const p of PEOPLE) {
      await pool.query("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`) VALUES (?,?,?,'x',?)", [p.id, p.name, `${p.id}@example.org`, p.handle]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
  }, 180_000);

  afterAll(async () => {
    await h.stop();
    await pool?.end();
    await db?.drop();
  });

  it("repo round trip: every group comes back, and `serves_goal` holds the first goal served", async () => {
    const plan = planToStore(
      {
        aim: "Round trip",
        servesGoal: GOALS[1],
        servesGoals: [{ goal: GOALS[1], howItHelps: "Meals for every gathering." }, { goal: GOALS[0], howItHelps: null }],
        seasonalGoals: [{ title: "Press the cider", doneWhen: "Every apple pressed." }],
        cardWords: { findMe: "Mondays.", growingEdge: "Handing off sooner." },
        commitments: {},
        handingBack: [],
      },
      null,
    );
    const saved = await insertPlanVersion(pool, "u-zed", "s-now", plan);
    expect(saved.servesGoals).toEqual(plan.servesGoals);
    expect(saved.seasonalGoals).toEqual(plan.seasonalGoals);
    expect(saved.cardWords).toEqual(plan.cardWords);
    const [rows] = await pool.query<any[]>("SELECT serves_goal FROM season_plans WHERE id = ?", [saved.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(rows[0].serves_goal).toBe(GOALS[1]);
  });

  it("Your season saves goals served and seasonal goals, and card words carry over from an earlier season", async () => {
    h.state.viewer = { id: "u-zed", stage: "member" };
    const r = await h.call("PUT", "/api/season-plans/mine", {
      aim: "Plant the orchard",
      servesGoals: [{ goal: GOALS[0], howItHelps: "Forty trees in." }],
      seasonalGoals: [{ title: "Graft the old pears", doneWhen: "Ten grafts take." }],
      commitments: {},
      handingBack: [],
    });
    expect(r.status).toBe(200);
    expect(r.body.plan.servesGoal).toBe(GOALS[0]);
    expect(r.body.plan.servesGoals).toEqual([{ goal: GOALS[0], howItHelps: "Forty trees in." }]);
    expect(r.body.plan.seasonalGoals).toEqual([{ title: "Graft the old pears", doneWhen: "Ten grafts take." }]);
    // Written in s-now, read in s-next: the card words describe the player.
    expect(r.body.cardWords).toEqual({ findMe: "Mondays.", growingEdge: "Handing off sooner." });
  });

  it("a save that leaves a group out keeps the newest version's", async () => {
    const r = await h.call("PUT", "/api/season-plans/mine", { aim: "Plant the orchard, again", servesGoal: GOALS[0], commitments: {}, handingBack: [] });
    expect(r.status).toBe(200);
    expect(r.body.plan.version).toBe(2);
    expect(r.body.plan.seasonalGoals).toEqual([{ title: "Graft the old pears", doneWhen: "Ten grafts take." }]);
    expect(r.body.cardWords).toEqual({ findMe: "Mondays.", growingEdge: "Handing off sooner." });
    // CONTROL: null clears a group.
    const c = await h.call("PUT", "/api/season-plans/mine", { aim: "Plant the orchard, again", servesGoal: GOALS[0], seasonalGoals: null, commitments: {}, handingBack: [] });
    expect(c.body.plan.seasonalGoals).toEqual([]);
  });

  it("the card's editor saves only its groups, as a new version, and leaves the rest alone", async () => {
    await h.call("PUT", "/api/season-plans/mine", {
      aim: "Keep this aim",
      servesGoals: [{ goal: GOALS[0], howItHelps: "Forty trees in." }],
      seasonalGoals: [{ title: "Graft the old pears", doneWhen: null }],
      commitments: { quests: { perMoonMin: 2, perMoonMax: 4 } },
      handingBack: [],
    });
    expect((await h.call("POST", "/api/season-plans/mine/file")).status).toBe(200);
    const before = await planVersions(pool, "u-zed", "s-next");

    const r = await h.call("PUT", "/api/season-plans/mine/card", { cardWords: { decisions: "By consent." } });
    expect(r.status).toBe(200);
    const after = await planVersions(pool, "u-zed", "s-next");
    expect(after).toHaveLength(before.length + 1);
    const newest = after[after.length - 1];
    expect(newest.aim).toBe("Keep this aim");
    expect(newest.commitments.quests).toMatchObject({ perMoonMin: 2, perMoonMax: 4 });
    expect(newest.commitments).toEqual(before[before.length - 1].commitments);
    expect(newest.servesGoals).toEqual([{ goal: GOALS[0], howItHelps: "Forty trees in." }]);
    expect(newest.cardWords).toEqual({ decisions: "By consent." });
    // Card words alone leave the filed plan filed.
    expect(r.body.changedSinceFiling).toBe(false);

    // CONTROL: a change the village reads does mark it.
    const g = await h.call("PUT", "/api/season-plans/mine/card", { servesGoals: [{ goal: GOALS[1], howItHelps: "Meals." }] });
    expect(g.body.changedSinceFiling).toBe(true);
    expect(g.body.plan.servesGoal).toBe(GOALS[1]);
    expect(g.body.plan.aim).toBe("Keep this aim");
  });

  it("the card's editor refuses another part of the plan, an empty body, and a bad group", async () => {
    expect((await h.call("PUT", "/api/season-plans/mine/card", { aim: "sneaky" })).body.field).toBe("aim");
    expect((await h.call("PUT", "/api/season-plans/mine/card", {})).status).toBe(400);
    const bad = await h.call("PUT", "/api/season-plans/mine/card", { seasonalGoals: [{ title: "x".repeat(121) }] });
    expect(bad.status).toBe(400);
    expect(bad.body.field).toBe("seasonalGoals.0.title");
  });

  it("the village page reads the goals and seasonal goals of the filed version", async () => {
    const r = await h.call("GET", "/api/season-plans");
    const zed = r.body.people.find((p: any) => p.userId === "u-zed");
    expect(zed.servesGoals).toEqual([{ goal: GOALS[0], howItHelps: "Forty trees in." }]);
    expect(zed.seasonalGoals).toEqual([{ title: "Graft the old pears", doneWhen: null }]);
    expect(JSON.stringify(r.body)).not.toContain("By consent.");
  });

  it("previous-release read: a row with only the 0258 columns serves its one goal", async () => {
    // The previous release's INSERT, verbatim: it names none of 0267's columns.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO season_plans (id, user_id, season_id, version, aim, serves_goal, commitments_json, handing_back) VALUES (?,?,?,?,?,?,?,?)",
      ["sp-oldrelease0001", "u-ana", "s-next", 1, "Old page aim", GOALS[1], "{}", "[]"],
    );
    const [v] = await planVersions(pool, "u-ana", "s-next");
    expect(v.servesGoals).toEqual([{ goal: GOALS[1], howItHelps: null }]);
    expect(v.seasonalGoals).toEqual([]);
    expect(v.cardWords).toBeNull();
    h.state.viewer = { id: "u-ana", stage: "member" };
    const r = await h.call("GET", "/api/season-plans/mine");
    expect(r.body.plan.servesGoals).toEqual([{ goal: GOALS[1], howItHelps: null }]);
    expect(r.body.cardWords).toBeNull();
  });

  it("PUT /mine/load keeps one read per moon, the latest, and only ever the caller's", async () => {
    h.state.viewer = { id: "u-ana", stage: "member" };
    const first = await h.call("PUT", "/api/season-plans/mine/load", { level: 2 });
    expect(first.status).toBe(200);
    expect(first.body.moonLoad).toEqual({ cycleId: MOON, level: 2 });
    // The body names another member: the row is still the caller's.
    const second = await h.call("PUT", "/api/season-plans/mine/load", { level: 5, userId: "u-zed" });
    expect(second.body.moonLoad.level).toBe(5);
    expect((await moonLoadOf(pool, "u-ana", MOON))?.level).toBe(5);
    expect(await moonLoadOf(pool, "u-zed", MOON)).toBeNull();
    expect(await moonLoadsOfMember(pool, "u-ana")).toHaveLength(1);
    expect((await h.call("GET", "/api/season-plans/mine")).body.moonLoad).toEqual({ cycleId: MOON, level: 5 });
    for (const level of [0, 6, 2.5, "3"]) {
      const r = await h.call("PUT", "/api/season-plans/mine/load", { level });
      expect(r.status, String(level)).toBe(400);
    }
    expect((await moonLoadOf(pool, "u-ana", MOON))?.level).toBe(5);
  });

  it("erasure nulls every new column on every version and deletes the loads; another member keeps theirs", async () => {
    h.state.viewer = { id: "u-zed", stage: "member" };
    await h.call("PUT", "/api/season-plans/mine/load", { level: 4 });
    await eraseSeasonPlanWords(pool, "u-zed");
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT aim, serves_goal, commitments_json, serves_goals_json, seasonal_goals_json, card_words_json FROM season_plans WHERE user_id = ?",
      ["u-zed"],
    );
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) {
      expect([r.aim, r.serves_goal, r.commitments_json, r.serves_goals_json, r.seasonal_goals_json, r.card_words_json]).toEqual([null, null, null, null, null, null]);
    }
    expect(await moonLoadsOfMember(pool, "u-zed")).toEqual([]);
    // CONTROL: the other member's plan and load stand.
    expect((await planVersions(pool, "u-ana", "s-next"))[0].aim).toBe("Old page aim");
    expect((await moonLoadOf(pool, "u-ana", MOON))?.level).toBe(5);
  });
});

describe("changedSinceFiling", () => {
  const v = (version: number, extra: Record<string, unknown> = {}) =>
    ({ version, aim: "a", servesGoals: [], seasonalGoals: [], commitments: {}, handingBack: [], cardWords: null, ...extra }) as any;
  it("ignores card words and sees everything the village reads", () => {
    expect(changedSinceFiling(v(2, { cardWords: { findMe: "x" } }), v(1))).toBe(false);
    expect(changedSinceFiling(v(2, { aim: "b" }), v(1))).toBe(true);
    expect(changedSinceFiling(v(2, { seasonalGoals: [{ title: "t", doneWhen: null }] }), v(1))).toBe(true);
    expect(changedSinceFiling(v(1), v(1))).toBe(false);
    expect(changedSinceFiling(v(1), null)).toBe(false);
  });
});
