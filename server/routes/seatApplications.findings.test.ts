/**
 * THE SEAT APPLICATION DOOR, HELD TO THE RED TEAM'S FINDINGS (2026-10-09).
 *
 * Each case here failed on the build the review read (wt/season-roles at
 * a5f8761), for the reason its name gives, and passes on the fix. The
 * harness is the one server/routes/seatApplications.test.ts uses: the real
 * route and closer over a scratch schema, with the gate, the roll and the
 * calendar handed in.
 *
 * Every name is fake and every figure is in XTS.
 */
import http from "node:http";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import type { SeatCalendar } from "../../shared/seatTerms";
import { isSeatSubject } from "../../shared/governanceKinds";
import { whoMayPutHandToVillage } from "../../shared/powerHands";
import { APPLICATION_CLOSED_NOTE, ballotNamesItsCloser, closeNoteFor, putToVillageRefusal } from "../../shared/seatApplications";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { ballotById, openBallotFor } from "../lib/ballots";
import type { LandingDeps, SubjectCloser } from "../lib/applyDue";
import { createOrgRole } from "../lib/orgChart";
import { isVetoable } from "../lib/stewardship";
import { readApplication } from "../repos/seatApplications";
import { register } from "./seatApplications";

const LADDER = ["visitor", "guest", "member"];
const DAY = 24 * 60 * 60 * 1000;

const PEOPLE: Record<string, { id: string; name: string }> = {
  "u-ana": { id: "u-ana", name: "Ana Quillfeather" },
  "u-hal": { id: "u-hal", name: "Hal Keeper" },
  "u-ivo": { id: "u-ivo", name: "Ivo Lantern" },
  "u-guest": { id: "u-guest", name: "Gale Visitor" },
};

const NOTE = "I kept the orchard ledger for the whole of last season.";
const DELIVERABLES = "By the end of the season two more people can run the orchard ledger without me.";

const CALENDAR: SeatCalendar = {
  seasons: [
    { id: "s-now", startsOn: "2026-01-01", endsOn: "2029-12-31" },
    { id: "s-next", startsOn: "2029-12-31", endsOn: "2031-01-01" },
  ],
  currentSeasonId: "s-now",
  timezone: "UTC",
};
const ORIGINAL_SEASONS = JSON.stringify(CALENDAR.seasons);

const configured = testDbConfigured();
if (!configured) console.warn("[seatApplications.findings] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

interface State {
  viewer: { id: string; stage: string } | null;
  villageHeld: string[];
  holders: string[];
  /** Hits per bucket, so a cap can be read the way the real limiter counts. */
  hits: Map<string, number>;
  pool: () => any;
}

function harness() {
  const state: State = {
    viewer: null,
    villageHeld: [],
    holders: [],
    hits: new Map(),
    pool: () => {
      throw new Error("the database was read before the gate answered");
    },
  };
  const notices: Array<{ userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }> = [];
  const closers: Record<string, SubjectCloser> = {};
  let server: http.Server;
  let base = "";

  const landing = {
    vetoHours: () => 72,
    autoApplyEnabled: () => true,
    stewardCouncil: () => false,
    stewardVetoTiers: () => "all",
    consentNoticeHours: () => 0,
    nextBoundaryAfter: (after: Date) => new Date(after.getTime() + 20 * DAY),
    cycleNumberAt: () => 1,
    landingExpiryCycles: () => 3,
    closerFor: (t: string) => closers[t],
    notify: async () => {},
    endedUnclosedCycle: async () => false,
    waitsForCycleClose: () => false,
    snapsToBoundary: () => false,
  };

  const start = async () => {
    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async () =>
        state.viewer
          ? { ...(PEOPLE[state.viewer.id] ?? { id: state.viewer.id, name: "Someone" }), tokenVersion: 0, prefs: { identityConfirmedAt: { at: Date.now(), v: 0 } } }
          : null,
      capabilityCtx: async () =>
        ({
          stageIndex: LADDER.indexOf(state.viewer?.stage ?? "visitor"),
          stageIndexOf: (id: string) => LADDER.indexOf(id),
          roleCapabilities: [],
          villageHeld: [...state.villageHeld],
        }) as unknown as CapabilityCtx,
      guardCapability: async (_req: any, res: any, cap: any, refusal?: { status: number; body: Record<string, unknown> }) => {
        const ctx = {
          stageIndex: LADDER.indexOf(state.viewer?.stage ?? "visitor"),
          stageIndexOf: (id: string) => LADDER.indexOf(id),
          roleCapabilities: [],
        } as unknown as CapabilityCtx;
        if (state.viewer && hasCapability(cap, ctx)) return true;
        res.status(refusal?.status ?? 401).json(refusal?.body ?? { error: "auth_required" });
        return false;
      },
      getPool: () => state.pool(),
      notify: async (input: any) => {
        notices.push(input);
        return { inserted: true } as any;
      },
      notifyAdmins: async () => {},
      // Counted, the way the real limiter counts: every call is a hit.
      overLimit: async (bucket: string, max: number) => {
        const n = (state.hits.get(bucket) ?? 0) + 1;
        state.hits.set(bucket, n);
        return n > max;
      },
      members: { byId: async (id: string) => PEOPLE[id] ?? null } as any,
      firstName: (n: string) => String(n ?? "").split(" ")[0] ?? "",
      liveHoldersOf: async () => [...state.holders],
      rolesCarrying: () => [{ id: "role-stewards", name: "Stewards" }],
      loadRoleHolders: () => state.holders.map((userId) => ({ roleId: "role-stewards", userId })),
      roleBallotSetup: async () => ({
        method: "majority",
        dials: { unityPct: 50, quorumPct: 0 },
        snapshot: { mode: "equal", token: null },
        tokenProblem: null,
        electorate: Object.keys(PEOPLE).filter((id) => id !== "u-guest").map((userId) => ({ userId, weight: 1 })),
        durationDays: 7,
      }),
      seatCalendar: () => CALENDAR,
      lapse: () => ({ currentSeasonId: CALENDAR.currentSeasonId, cadence: "season_turn" }),
      landingDeps: () => ({ pool: state.pool(), ...landing }) as unknown as LandingDeps,
      closers,
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
  return { state, notices, closers, start, stop, call };
}

// ── Pure ──────────────────────────────────────────────────────────────────────

describe("G3: a seat application is a seating act, and no steward stops it", () => {
  it("is a seat subject, and is not vetoable even where stewards may veto everything", () => {
    // CONTROL: the default setting does put an ordinary subject inside the veto.
    expect(isVetoable("mechanics", [], { stewardSubjects: "all" }).vetoable).toBe(true);
    expect(isSeatSubject("role_application")).toBe(true);
    const v = isVetoable("role_application", [], { stewardSubjects: "all" });
    expect(v.vetoable).toBe(false);
    expect(v.why).toMatch(/no steward can stop it/);
  });
});

describe("G5: when the power that seats people leaves every holder, any member may put an application to the village", () => {
  it("answers no refusal to any member once nobody holds org.seat live", () => {
    expect(putToVillageRefusal(whoMayPutHandToVillage(false, []), "u-ivo")).toBeNull();
    expect(putToVillageRefusal(whoMayPutHandToVillage(true, ["u-hal"]), "u-ivo")).toBeNull();
    // CONTROL: a role still holding it live keeps the door to its holders.
    expect(putToVillageRefusal(whoMayPutHandToVillage(false, ["u-hal"]), "u-ivo")?.error).toBe("not_a_holder");
    expect(putToVillageRefusal(whoMayPutHandToVillage(false, ["u-hal"]), "u-hal")).toBeNull();
  });
});

describe("S1 and U12: an application's public ballot names nobody", () => {
  it("does not name whoever closed or withdrew it, and takes no free text at the close", () => {
    expect(ballotNamesItsCloser("role_application")).toBe(false);
    expect(closeNoteFor("role_application", "Ana Quillfeather got the seat.")).toBe(APPLICATION_CLOSED_NOTE);
    // CONTROL: every other ballot keeps its closer's name and its words.
    expect(ballotNamesItsCloser("mechanics")).toBe(true);
    expect(closeNoteFor("mechanics", "We agreed nine days.")).toBe("We agreed nine days.");
  });
});

// ── Over the database ─────────────────────────────────────────────────────────

describe.skipIf(!configured)("the member door, over a scratch schema", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;
  let n = 0;
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    h.state.pool = () => pool;
    await h.start();
  });
  afterAll(async () => {
    await h.stop();
    await pool?.end();
    await db?.drop();
  });
  beforeEach(() => {
    h.state.viewer = { id: "u-ana", stage: "member" };
    h.state.villageHeld = [];
    h.state.holders = [];
    h.state.hits.clear();
    h.notices.length = 0;
    CALENDAR.seasons = JSON.parse(ORIGINAL_SEASONS);
    CALENDAR.currentSeasonId = "s-now";
  });
  const seat = async (name: string, places = 1) => {
    n += 1;
    return createOrgRole(pool, { id: `seat-f${n}-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`, name, seats: places, aim: null });
  };
  const apply = (body: Record<string, unknown>) =>
    h.call("POST", "/api/governance/role-applications", { deliverables: DELIVERABLES, fitStatement: NOTE, seatSettings: { v: 1 }, ...body });

  it("G5: an application waiting on a holder is put to the village by any member once the power leaves every holder", async () => {
    h.state.holders = ["u-hal"];
    const s = await seat("Stranded seat");
    const a = await apply({ seatIds: [s] });
    expect(a.body.status).toBe("awaiting-holder");
    // CONTROL: while a holder is live, a member who is not one is refused.
    h.state.viewer = { id: "u-ivo", stage: "member" };
    expect((await h.call("POST", `/api/governance/role-applications/${a.body.id}/put-to-village`)).status).toBe(403);
    h.state.holders = [];
    const p = await h.call("POST", `/api/governance/role-applications/${a.body.id}/put-to-village`);
    expect(p.status).toBe(200);
    expect(p.body.status).toBe("voting");
    expect((await readApplication(pool, a.body.id))!.status).toBe("voting");
    expect(await openBallotFor(pool, "role_application", a.body.id)).not.toBeNull();
  });

  it("S1: a candidate's withdraw records the system and neutral words on the public ballot", async () => {
    const s = await seat("Withdrawn seat");
    const a = await apply({ seatIds: [s] });
    expect(a.body.status).toBe("voting");
    const w = await h.call("POST", `/api/governance/role-applications/${a.body.id}/withdraw`);
    expect(w.status).toBe(200);
    const b = (await ballotById(pool, a.body.ballot.id))!;
    expect(b.status).toBe("withdrawn");
    expect(b.closedBy).toBe("governance");
    expect(b.outcomeNote).toBe("The application was withdrawn.");
  });
});
