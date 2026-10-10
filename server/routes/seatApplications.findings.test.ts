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
import { createOrgRole, isLapsed, seatHolder } from "../lib/orgChart";
import { isVetoable, runTermWatch } from "../lib/stewardship";
import { runSeasonTurn } from "../lib/seasonTurn";
import { viewText } from "../lib/alignmentSubjects";
import { readApplication, seatingsHolding } from "../repos/seatApplications";
import { textsToSettle } from "../repos/alignments";
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

  it("S5: the text's hash is served to the candidate, never to another member reading the page", async () => {
    const s = await seat("Hash seat");
    const a = await apply({ seatIds: [s] });
    const mine = await h.call("GET", `/api/governance/role-applications/${a.body.id}`);
    expect(mine.body.application.alignment.contentHash).toMatch(/^[0-9a-f]{64}$/);
    h.state.viewer = { id: "u-hal", stage: "member" };
    const theirs = await h.call("GET", `/api/governance/role-applications/${a.body.id}`);
    expect(theirs.status).toBe(200);
    expect(theirs.body.application.alignment.contentHash).toBeNull();
    const list = await h.call("GET", "/api/governance/role-applications");
    expect(JSON.stringify(list.body)).not.toContain(mine.body.application.alignment.contentHash);
  });

  it("S6: a member opens at most three application votes a day", async () => {
    h.state.viewer = { id: "u-ivo", stage: "member" };
    for (let i = 0; i < 3; i += 1) {
      const ok = await apply({ seatIds: [await seat(`Cap seat ${i}`)] });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    }
    const fourth = await apply({ seatIds: [await seat("Cap seat 4")] });
    expect(fourth.status).toBe(429);
    expect(fourth.body.error).toBe("too_many_votes");
    // CONTROL: another member is not held to Ivo's count.
    h.state.viewer = { id: "u-hal", stage: "member" };
    expect((await apply({ seatIds: [await seat("Cap seat 5")] })).status).toBe(201);
  });

  // ── The seating rules ───────────────────────────────────────────────────────

  const open = async (userId: string, seatId: string) =>
    (await pool.query<any[]>( // module-review-ok: fixture read of the scratch schema
      "SELECT id, application_id, term_ends_at, season_id, ended_at FROM org_role_assignments WHERE user_id = ? AND org_role_id = ? AND ended_at IS NULL",
      [userId, seatId],
    ))[0];
  const everyRow = async (userId: string, seatId: string) =>
    (await pool.query<any[]>( // module-review-ok: fixture read of the scratch schema
      "SELECT id, application_id, ended_at FROM org_role_assignments WHERE user_id = ? AND org_role_id = ? ORDER BY started_at, id",
      [userId, seatId],
    ))[0];
  const land = async (applicationId: string) => {
    const ballot = await openBallotFor(pool, "role_application", applicationId);
    if (!ballot) throw new Error("no open ballot");
    return h.closers.role_application!.execute!(ballot, "governance");
  };
  const lapseAt = (now: Date) => ({ currentSeasonId: CALENDAR.currentSeasonId, cadence: "season_turn" as const, now });
  const turn = (now: Date) =>
    runSeasonTurn({
      getPool: () => pool,
      notify: async (input: any) => {
        h.notices.push(input);
      },
      notifyAdmins: async () => {},
      closer: h.closers.role_application!,
      lapse: () => ({ currentSeasonId: CALENDAR.currentSeasonId, cadence: "season_turn" }),
      calendar: () => CALENDAR,
      now: () => now,
    });

  it("G6: two applies at once for the same seat: one lands, the other is refused", async () => {
    const s = await seat("Double click seat");
    const [x, y] = await Promise.all([apply({ seatIds: [s] }), apply({ seatIds: [s] })]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const [rows] = await pool.query<any[]>("SELECT id FROM seat_applications WHERE candidate_user_id = 'u-ana' AND JSON_CONTAINS(seat_ids, JSON_QUOTE(?))", [s]); // module-review-ok: fixture read of the scratch schema
    expect(rows).toHaveLength(1);
  });

  it("G6: an application adopted for later still holds its seats, so a second one for the same seat is refused", async () => {
    const s = await seat("Held for later seat");
    const a = await apply({ seatIds: [s], seasonId: "s-next" });
    await land(a.body.id);
    expect((await readApplication(pool, a.body.id))!.status).toBe("adopted");
    expect(await open("u-ana", s)).toHaveLength(0);
    const again = await apply({ seatIds: [s] });
    expect(again.status).toBe(409);
    expect(again.body.applicationId).toBe(a.body.id);
  });

  it("G1: a renewal over a lapsed seating seats the member afresh on the new terms and ends the old seating", async () => {
    const s = await seat("Renewed seat");
    await seatHolder(pool, s, { userId: "u-ana", seasonId: "s-old", termEndsAt: new Date("2029-03-01T00:00:00Z") });
    const before = (await open("u-ana", s))[0];
    // CONTROL: the seating being renewed reads lapsed.
    expect(isLapsed({ termEndsAt: new Date(before.term_ends_at), seasonId: before.season_id, endedAt: null }, { expiresEachSeason: null }, lapseAt(new Date())).lapsed).toBe(true);
    const a = await apply({ seatIds: [s] });
    expect(a.status).toBe(201);
    await land(a.body.id);
    const rows = await open("u-ana", s);
    expect(rows).toHaveLength(1);
    expect(rows[0].application_id).toBe(a.body.id);
    expect(rows[0].season_id).toBe("s-now");
    expect(isLapsed({ termEndsAt: new Date(rows[0].term_ends_at), seasonId: rows[0].season_id, endedAt: null }, { expiresEachSeason: null }, lapseAt(new Date())).lapsed).toBe(false);
    const history = await everyRow("u-ana", s);
    expect(history).toHaveLength(2);
    expect(history[0].ended_at).not.toBeNull();
  });

  it("G1: the earlier application's terms end when a later one renews the seat, and its history stays", async () => {
    const s = await seat("Twice applied seat");
    const first = await apply({ seatIds: [s] });
    await land(first.body.id);
    expect(await seatingsHolding(pool, first.body.id)).toHaveLength(1);
    const second = await apply({ seatIds: [s] });
    expect(second.status).toBe(201);
    await land(second.body.id);
    expect(await seatingsHolding(pool, second.body.id)).toHaveLength(1);
    expect(await seatingsHolding(pool, first.body.id)).toHaveLength(0);
    const history = await everyRow("u-ana", s);
    expect(history.map((r: any) => r.application_id)).toEqual([first.body.id, second.body.id]);
    const v = await viewText(pool, (await readApplication(pool, first.body.id))!.textId!, "2027-01-01");
    expect(v?.derived.state).toBe("ended");
  });

  it("G4 + G2: a holder adopting near a season's end waits for the turn, and the turn seats it in the new season", async () => {
    const soon = new Date(Date.now() + 2 * DAY);
    const soonDay = soon.toISOString().slice(0, 10);
    CALENDAR.seasons = [
      { id: "s-now", startsOn: "2026-01-01", endsOn: soonDay },
      { id: "s-next", startsOn: soonDay, endsOn: "2029-12-31" },
    ] as any;
    h.state.holders = ["u-hal"];
    const s = await seat("Edge seat");
    const a = await apply({ seatIds: [s] });
    expect(a.body.status).toBe("awaiting-holder");
    h.state.viewer = { id: "u-hal", stage: "member" };
    const ad = await h.call("POST", `/api/governance/role-applications/${a.body.id}/adopt`);
    expect(ad.body.status).toBe("adopted");
    // Nobody is seated with next season's id while this season runs.
    expect(await open("u-ana", s)).toHaveLength(0);
    // CONTROL: the turn before the day seats nobody.
    await turn(new Date());
    expect(await open("u-ana", s)).toHaveLength(0);
    // The season turns.
    CALENDAR.currentSeasonId = "s-next";
    const after = new Date(soon.getTime() + 2 * DAY);
    await turn(after);
    const rows = await open("u-ana", s);
    expect(rows).toHaveLength(1);
    expect(rows[0].season_id).toBe("s-next");
    expect(rows[0].application_id).toBe(a.body.id);
    expect(isLapsed({ termEndsAt: new Date(rows[0].term_ends_at), seasonId: rows[0].season_id, endedAt: null }, { expiresEachSeason: null }, lapseAt(after)).lapsed).toBe(false);
    expect(h.notices.some((x) => x.userId === "u-ana" && x.type === "role_appointed")).toBe(true);
  });

  it("G2: an application held for a full seat is seated by the turn once a place frees", async () => {
    const s = await seat("Frees later seat");
    const a = await apply({ seatIds: [s] });
    const hal = await seatHolder(pool, s, { userId: "u-hal", seasonId: "s-now", termEndsAt: new Date("2029-06-01T00:00:00Z") });
    await land(a.body.id);
    expect((await readApplication(pool, a.body.id))!.status).toBe("held-full");
    await turn(new Date());
    expect((await readApplication(pool, a.body.id))!.status).toBe("held-full");
    await pool.query("UPDATE org_role_assignments SET ended_at = NOW() WHERE id = ?", [hal.assignmentId]); // module-review-ok: fixture, Hal leaves the seat
    await turn(new Date());
    expect((await readApplication(pool, a.body.id))!.status).toBe("adopted");
    expect(await open("u-ana", s)).toHaveLength(1);
  });

  it("G2: the candidate may withdraw an application adopted for later, before any seating takes it up", async () => {
    const s = await seat("Later seat");
    const a = await apply({ seatIds: [s], seasonId: "s-next" });
    await land(a.body.id);
    const stored = (await readApplication(pool, a.body.id))!;
    expect(stored.status).toBe("adopted");
    const page = await h.call("GET", `/api/governance/role-applications/${a.body.id}`);
    expect(page.body.application.you.mayWithdraw).toBe(true);
    const w = await h.call("POST", `/api/governance/role-applications/${a.body.id}/withdraw`);
    expect(w.status).toBe(200);
    expect((await readApplication(pool, a.body.id))!.status).toBe("withdrawn");
    // And the turn never seats it.
    CALENDAR.currentSeasonId = "s-next";
    await turn(new Date("2030-01-05T00:00:00Z"));
    expect(await open("u-ana", s)).toHaveLength(0);
  });

  it("G2: the term watch says nothing about a seat whose renewal the village already adopted", async () => {
    const s = await seat("Renewing seat");
    const seated = await seatHolder(pool, s, { userId: "u-ana", seasonId: "s-old", termEndsAt: new Date(Date.now() - DAY) });
    const told: string[] = [];
    const watch = () =>
      runTermWatch({
        pool,
        notify: async (n) => {
          told.push(n.dedupeKey);
          return { fresh: true };
        },
        notifyAdmins: async () => {},
        seatings: [{ id: seated.assignmentId!, orgRoleId: s, holderKind: "member", userId: "u-ana", roleName: "Renewing seat", daysLeft: 0, lapsed: true }],
        season: { current: { id: "s-now" } },
      });
    // CONTROL: with no renewal adopted, the member is told their term ended.
    await watch();
    expect(told).toContain(`term-ended:${seated.assignmentId}`);
    told.length = 0;
    const a = await apply({ seatIds: [s], seasonId: "s-next" });
    await land(a.body.id);
    expect((await readApplication(pool, a.body.id))!.status).toBe("adopted");
    await watch();
    expect(told).not.toContain(`term-ended:${seated.assignmentId}`);
  });

  it("D4: an application left voting under a vote that already passed and landed is adopted by the sweep", async () => {
    const s = await seat("Stranded vote seat");
    const a = await apply({ seatIds: [s] });
    // What an older image leaves: the ballot marked applied with no closer run.
    await pool.query("UPDATE ballots SET status = 'passed', landing_status = 'applied', closed_at = NOW() WHERE id = ?", [a.body.ballot.id]); // module-review-ok: fixture, the rollback shape
    expect((await readApplication(pool, a.body.id))!.status).toBe("voting");
    await turn(new Date());
    expect((await readApplication(pool, a.body.id))!.status).toBe("adopted");
    expect(await open("u-ana", s)).toHaveLength(1);
    // And a vote that failed closes its application the same way.
    const s2 = await seat("Failed vote seat");
    const b = await apply({ seatIds: [s2] });
    await pool.query("UPDATE ballots SET status = 'failed', closed_at = NOW() WHERE id = ?", [b.body.ballot.id]); // module-review-ok: fixture
    await turn(new Date());
    expect((await readApplication(pool, b.body.id))!.status).toBe("not-adopted");
  });

  it("U1: a vote that carried and has not landed reads as carried, keeps its link, and cannot be withdrawn", async () => {
    const s = await seat("Carried seat");
    const a = await apply({ seatIds: [s] });
    await pool.query( // module-review-ok: fixture, a carried vote inside its window
      "UPDATE ballots SET status = 'passed', landing_status = 'pending', lands_at = ?, closed_at = NOW() WHERE id = ?",
      [new Date("2029-11-12T12:00:00Z"), a.body.ballot.id],
    );
    const page = await h.call("GET", `/api/governance/role-applications/${a.body.id}`);
    expect(page.body.application.statusWords).toBe("Carried, lands on 12 November 2029");
    expect(page.body.application.ballotId).toBe(a.body.ballot.id);
    expect(page.body.application.you.mayWithdraw).toBe(false);
    const w = await h.call("POST", `/api/governance/role-applications/${a.body.id}/withdraw`);
    expect(w.status).toBe(409);
    expect((await readApplication(pool, a.body.id))!.status).toBe("voting");
  });

  it("D8: listing applications costs the same reads for three more of them, and seatings are indexed by application", async () => {
    let reads = 0;
    const counting = new Proxy(pool, {
      get(target, key) {
        if (key === "query") {
          return (...args: any[]) => {
            reads += 1;
            return (target.query as any)(...args);
          };
        }
        const v = (target as any)[key];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    h.state.pool = () => counting;
    try {
      h.state.viewer = { id: "u-hal", stage: "member" };
      await apply({ seatIds: [await seat("List seat 1")] });
      const listed = async () => {
        reads = 0;
        const r = await h.call("GET", "/api/governance/role-applications");
        expect(r.status).toBe(200);
        return { reads, n: r.body.applications.length };
      };
      const before = await listed();
      for (let i = 2; i <= 3; i += 1) await apply({ seatIds: [await seat(`List seat ${i}`)] });
      h.state.viewer = { id: "u-ivo", stage: "member" };
      await apply({ seatIds: [await seat("List seat 4")] });
      const after = await listed();
      expect(after.n).toBe(before.n + 3);
      expect(after.reads).toBe(before.reads);
    } finally {
      h.state.pool = () => pool;
    }
    const [idx] = await pool.query<any[]>("SHOW INDEX FROM org_role_assignments WHERE Column_name = 'application_id'"); // module-review-ok: fixture read of the scratch schema
    expect(idx.length).toBeGreaterThan(0);
  });

  it("G7: a season-following term's alignment window moves with the season, so it stays in force", async () => {
    const s = await seat("Moving season seat");
    const a = await apply({ seatIds: [s] });
    expect(a.status).toBe(201);
    CALENDAR.seasons = [
      { id: "s-now", startsOn: "2026-01-01", endsOn: "2030-06-30" },
      { id: "s-next", startsOn: "2030-06-30", endsOn: "2031-01-01" },
    ] as any;
    await land(a.body.id);
    const rows = await open("u-ana", s);
    expect(new Date(rows[0].term_ends_at).toISOString()).toBe("2030-06-30T00:00:00.000Z");
    const v = await viewText(pool, (await readApplication(pool, a.body.id))!.textId!, "2030-03-01");
    expect(v?.derived.state).toBe("in-force");
    // CONTROL: after the moved end, it has ended.
    expect((await viewText(pool, (await readApplication(pool, a.body.id))!.textId!, "2030-07-01"))?.derived.state).toBe("ended");
  });

  it("D9: the hourly settle sweep stops reading a withdrawn application's text", async () => {
    const s = await seat("Withdrawn text seat");
    const a = await apply({ seatIds: [s] });
    const textId = (await readApplication(pool, a.body.id))!.textId!;
    expect(await textsToSettle(pool)).toContain(textId);
    await h.call("POST", `/api/governance/role-applications/${a.body.id}/withdraw`);
    expect(await textsToSettle(pool)).not.toContain(textId);
  });

  it("U6: the roll's notice names the day the vote closes in words, in the village's calendar", async () => {
    const s = await seat("Dated seat");
    const a = await apply({ seatIds: [s] });
    expect(a.status).toBe(201);
    await new Promise((r) => setTimeout(r, 200));
    const opened = h.notices.find((x) => x.type === "ballot_opened");
    expect(opened?.body).toMatch(/^Voting is open until \d{1,2} [A-Z][a-z]+ \d{4}\.$/);
  });
});
