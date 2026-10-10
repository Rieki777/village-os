/**
 * THE MEMBER DOOR OVER REAL HTTP AND A REAL SCHEMA (seat settings PR4).
 *
 * What is pinned, each against the route as it ships and the S5 scratch schema:
 *
 *   - every read answers 401 to a visitor and a signed-in guest, BEFORE the
 *     database is touched (the pool throws);
 *   - an application is judged by `parseSeatSettings`, and an example seat, a
 *     full seat and more than five seats are refused;
 *   - who adopts: a ballot when the village holds `org.seat` or nobody does; a
 *     holder when a live holder who is not the candidate exists; and the
 *     SELF-DEALING FALLTHROUGH, where a candidate who is the only holder goes to
 *     a ballot;
 *   - a holder who is the candidate is refused at :id/adopt, and the other
 *     holder adopts (control);
 *   - the closer re-reads the stored row and COUNTS THE SEATS AGAIN at landing,
 *     holding the whole application (`held-full`) when a place filled while the
 *     vote ran, with a control that seats when the place is still free;
 *   - a candidate already seated keeps that seating, which takes the terms;
 *   - the ballot's title and document carry no amount, currency, candidate
 *     name, note or hash, against a control fixture that carries every one;
 *   - withdrawing while voting withdraws the ballot;
 *   - `starts_at` in the future: adopted, nobody seated, then seated on the day
 *     by `seatFromApplication`;
 *   - one application over three seats seats all three on one term.
 *
 * Every figure is fake: XTS is the ISO 4217 code reserved for testing.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import type { SeatCalendar } from "../../shared/seatTerms";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { ballotById, openBallotFor } from "../lib/ballots";
import type { LandingDeps, SubjectCloser } from "../lib/applyDue";
import { createOrgRole, seatHolder } from "../lib/orgChart";
import { readApplication, seatingsHolding } from "../repos/seatApplications";
import { register, seatFromApplication } from "./seatApplications";

const LADDER = ["visitor", "guest", "member"];
const DAY = 24 * 60 * 60 * 1000;

const PEOPLE: Record<string, { id: string; name: string }> = {
  "u-ana": { id: "u-ana", name: "Ana Quillfeather" },
  "u-hal": { id: "u-hal", name: "Hal Keeper" },
  "u-ivo": { id: "u-ivo", name: "Ivo Lantern" },
  "u-guest": { id: "u-guest", name: "Gale Visitor" },
};

/** Terms carrying money, so the ballot privacy test has something to leak. */
const MONEY_TERMS = {
  v: 1,
  pay: { kind: "fixed", currency: "XTS", amountMinor: 4321000, per: "month", note: "Stipend reviewed with the stewards." },
  allowance: { kind: "flat", currency: "XTS", amountMinor: 87600, per: "month" },
  bonus: { kind: "equity", capWords: "up to a small share, rated each moon" },
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

const configured = testDbConfigured();
if (!configured) console.warn("[seatApplications] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

interface State {
  viewer: { id: string; stage: string } | null;
  villageHeld: string[];
  holders: string[];
  pool: () => any;
}

function harness() {
  const state: State = {
    viewer: null,
    villageHeld: [],
    holders: [],
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
      authedUser: async () => (state.viewer ? PEOPLE[state.viewer.id] ?? { id: state.viewer.id, name: "Someone" } : null),
      capabilityCtx: async () =>
        ({
          stageIndex: LADDER.indexOf(state.viewer?.stage ?? "visitor"),
          stageIndexOf: (id: string) => LADDER.indexOf(id),
          roleCapabilities: [],
          villageHeld: [...state.villageHeld],
        }) as unknown as CapabilityCtx,
      // The one gate's shape: refuse with the route's own refusal unless the reader holds the key.
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
      overLimit: async () => false,
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
      lapse: () => ({ currentSeasonId: "s-now", cadence: "season_turn" }),
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

describe("the reads refuse everyone below the member rung", () => {
  const h = harness();
  beforeAll(h.start);
  afterAll(h.stop);

  it("a visitor gets 401 on the list and on one, and the database is never read", async () => {
    h.state.viewer = null;
    for (const url of ["/api/governance/role-applications", "/api/governance/role-applications/sa-0123456789abcdef"]) {
      const r = await h.call("GET", url);
      expect(r.status, url).toBe(401);
      expect(r.body).not.toHaveProperty("applications");
      expect(r.body).not.toHaveProperty("application");
    }
  });

  it("a signed-in guest gets 401 too, and cannot apply", async () => {
    h.state.viewer = { id: "u-guest", stage: "guest" };
    expect((await h.call("GET", "/api/governance/role-applications")).status).toBe(401);
    expect((await h.call("POST", "/api/governance/role-applications", { seatIds: ["x"] })).status).toBe(403);
  });

  it("registers the role_application closer into the table it is handed", () => {
    expect(typeof h.closers.role_application?.settle).toBe("function");
    expect(typeof h.closers.role_application?.execute).toBe("function");
    expect(typeof h.closers.role_application?.onWithdraw).toBe("function");
  });
});

describe.skipIf(!configured)("applying, adopting and seating, on a real schema", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;
  let n = 0;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
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
    h.notices.length = 0;
  });

  /** A fresh seat of this village's own, with `places` places. */
  const seat = async (name: string, places = 1, aim: string | null = null) => {
    n += 1;
    return createOrgRole(pool, { id: `seat-${n}-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`, name, seats: places, aim });
  };

  const apply = (body: Record<string, unknown>) =>
    h.call("POST", "/api/governance/role-applications", { deliverables: DELIVERABLES, fitStatement: NOTE, seatSettings: { v: 1 }, ...body });

  const seatingsOf = async (userId: string, seatId: string) =>
    (
      await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT id, application_id, term_ends_at, season_id FROM org_role_assignments WHERE user_id = ? AND org_role_id = ? AND ended_at IS NULL",
        [userId, seatId],
      )
    )[0];

  /** Run the closer's landing half on an application's open ballot, as the dispatcher would. */
  const land = async (applicationId: string) => {
    const ballot = await openBallotFor(pool, "role_application", applicationId);
    if (!ballot) throw new Error("no open ballot for the application");
    return h.closers.role_application!.execute!(ballot, "governance");
  };

  // ── Validation ───────────────────────────────────────────────────────────

  it("judges the terms with parseSeatSettings, and refuses payment details in the words", async () => {
    const s = await seat("Ledger keeper");
    const voice = await apply({ seatIds: [s], seatSettings: { v: 1, voice: 3 } });
    expect(voice.status).toBe(400);
    expect(voice.body.error).toMatch(/Voice is never a term/);
    const digits = await apply({ seatIds: [s], fitStatement: "Pay me at 1234 5678 9012 please, I kept the ledger." });
    expect(digits.status).toBe(400);
    expect(digits.body.field).toBe("note");
    // Control: the same seat with clean terms and words is taken.
    expect((await apply({ seatIds: [s] })).status).toBe(201);
  });

  it("refuses an example seat, a full seat and more than five seats", async () => {
    const example = await seat("Demo seat");
    await pool.query("UPDATE org_roles SET is_example = 1 WHERE id = ?", [example]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const ex = await apply({ seatIds: [example] });
    expect(ex.status).toBe(409);
    expect(ex.body.error).toMatch(/example seats/);

    const full = await seat("Full seat");
    await seatHolder(pool, full, { userId: "u-ivo", seasonId: "s-now", termEndsAt: new Date("2029-06-01T00:00:00Z") });
    const f = await apply({ seatIds: [full] });
    expect(f.status).toBe(409);
    expect(f.body.code).toBe("seat_full");

    const six = await Promise.all(["a", "b", "c", "d", "e", "f"].map((x) => seat(`Six ${x}`)));
    const over = await apply({ seatIds: six });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/at most 5 seats/);
    // Control: five of them is one application.
    expect((await apply({ seatIds: six.slice(0, 5) })).status).toBe(201);
  });

  // ── Who adopts ───────────────────────────────────────────────────────────

  it("opens a ballot when the village holds org.seat, and when nobody holds it", async () => {
    h.state.villageHeld = ["org.seat"];
    h.state.holders = ["u-hal"];
    const a = await apply({ seatIds: [await seat("Village held")] });
    expect(a.status).toBe(201);
    expect(a.body.status).toBe("voting");
    expect(a.body.ballot.id).toBeTruthy();

    h.state.villageHeld = [];
    h.state.holders = [];
    const b = await apply({ seatIds: [await seat("Nobody holds")] });
    expect(b.body.status).toBe("voting");
  });

  it("waits for a live holder who is not the candidate, and tells them with the seat name and a link only", async () => {
    h.state.holders = ["u-hal"];
    const s = await seat("Holder path");
    const a = await apply({ seatIds: [s], seatSettings: MONEY_TERMS });
    expect(a.body.status).toBe("awaiting-holder");
    expect(await openBallotFor(pool, "role_application", a.body.id)).toBeNull();
    const told = h.notices.filter((x) => x.userId === "u-hal");
    expect(told).toHaveLength(1);
    expect(told[0].title).toContain("Holder path");
    expect(told[0].link).toBe(`/seat-applications/${a.body.id}`);
    expect(told[0].body ?? null).toBeNull();
    expect(JSON.stringify(told[0])).not.toMatch(/Ana|XTS|43,?210|orchard/);
  });

  it("SELF-DEALING: a candidate who is the only live holder falls through to a ballot", async () => {
    h.state.holders = ["u-ana"];
    const a = await apply({ seatIds: [await seat("Sole holder")] });
    expect(a.status).toBe(201);
    expect(a.body.status).toBe("voting");
    expect(await openBallotFor(pool, "role_application", a.body.id)).not.toBeNull();
    // Control: the same member with a second live holder beside them waits for that holder.
    h.state.holders = ["u-ana", "u-hal"];
    const b = await apply({ seatIds: [await seat("Two holders")] });
    expect(b.body.status).toBe("awaiting-holder");
  });

  it("a holder who is the candidate is refused at :id/adopt, and the other holder adopts", async () => {
    h.state.holders = ["u-ana", "u-hal"];
    const s = await seat("Self adopt");
    const a = await apply({ seatIds: [s] });
    expect(a.body.status).toBe("awaiting-holder");

    const self = await h.call("POST", `/api/governance/role-applications/${a.body.id}/adopt`);
    expect(self.status).toBe(403);
    expect(self.body.error).toBe("own_terms");
    expect(self.body.message).toBe("Your own terms go to the village to adopt.");
    expect(await seatingsOf("u-ana", s)).toHaveLength(0);

    // A member who holds nothing is refused too.
    h.state.viewer = { id: "u-ivo", stage: "member" };
    expect((await h.call("POST", `/api/governance/role-applications/${a.body.id}/adopt`)).status).toBe(403);

    h.state.viewer = { id: "u-hal", stage: "member" };
    const page = await h.call("GET", `/api/governance/role-applications/${a.body.id}`);
    expect(page.body.application.you).toMatchObject({ mayAdopt: true, mayPutToVillage: true, isCandidate: false });
    const ok = await h.call("POST", `/api/governance/role-applications/${a.body.id}/adopt`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("adopted");
    const rows = await seatingsOf("u-ana", s);
    expect(rows).toHaveLength(1);
    expect(rows[0].application_id).toBe(a.body.id);
    const stored = await readApplication(pool, a.body.id);
    expect(stored).toMatchObject({ status: "adopted", adoptedVia: "holder", adoptedRef: "u-hal", authorityRef: "org.seat@role-stewards" });
  });

  it("a holder can send it to the village instead, and a second click finds it already voting", async () => {
    h.state.holders = ["u-hal"];
    const a = await apply({ seatIds: [await seat("To the village")] });
    h.state.viewer = { id: "u-hal", stage: "member" };
    const r = await h.call("POST", `/api/governance/role-applications/${a.body.id}/put-to-village`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("voting");
    expect((await readApplication(pool, a.body.id))!.status).toBe("voting");
    expect((await h.call("POST", `/api/governance/role-applications/${a.body.id}/put-to-village`)).status).toBe(409);
  });

  // ── The closer ───────────────────────────────────────────────────────────

  it("the closer re-reads the row and counts again at landing: a seat filled while voting holds it", async () => {
    const s = await seat("Raced seat");
    const a = await apply({ seatIds: [s] });
    expect(a.body.status).toBe("voting");
    // Another door fills the only place while the vote runs.
    await seatHolder(pool, s, { userId: "u-ivo", seasonId: "s-now", termEndsAt: new Date("2029-06-01T00:00:00Z") });
    const routed = await land(a.body.id);
    expect(routed.held).toMatch(/no free place/);
    expect(routed.applied).toEqual([]);
    expect((await readApplication(pool, a.body.id))!.status).toBe("held-full");
    expect(await seatingsOf("u-ana", s)).toHaveLength(0);
    expect(h.notices.some((x) => x.userId === "u-ana" && /Held, a seat is full/.test(x.title))).toBe(true);
  });

  it("CONTROL: the same landing with the place still free seats the candidate on the stored term", async () => {
    const s = await seat("Free seat");
    const a = await apply({ seatIds: [s], seatSettings: { v: 1, term: { endsOn: "2029-06-30" } } });
    const routed = await land(a.body.id);
    expect(routed.held).toBeNull();
    expect(routed.applied).toEqual([`seat_application:${a.body.id}`]);
    const rows = await seatingsOf("u-ana", s);
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].term_ends_at).toISOString()).toBe("2029-06-30T00:00:00.000Z");
    expect((await readApplication(pool, a.body.id))).toMatchObject({ status: "adopted", adoptedVia: "ballot" });
  });

  it("a candidate already seated keeps that seating, and the seating takes the terms", async () => {
    const s = await seat("Already mine");
    const first = await seatHolder(pool, s, { userId: "u-ana", seasonId: "s-now", termEndsAt: new Date("2029-03-01T00:00:00Z") });
    // The seat's one place is theirs, so the application is not refused as full.
    const a = await apply({ seatIds: [s] });
    expect(a.status).toBe(201);
    await land(a.body.id);
    const rows = await seatingsOf("u-ana", s);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.assignmentId);
    expect(rows[0].application_id).toBe(a.body.id);
    // The existing term is untouched.
    expect(new Date(rows[0].term_ends_at).toISOString()).toBe("2029-03-01T00:00:00.000Z");
  });

  it("one application over three seats seats all three on the same term", async () => {
    const seats = [await seat("Lead steward"), await seat("Platform steward"), await seat("Design facilitator")];
    const a = await apply({ seatIds: seats, seatSettings: { ...MONEY_TERMS, term: { endsOn: "2029-09-30" } } });
    expect(a.body.status).toBe("voting");
    await land(a.body.id);
    const ends = new Set<string>();
    for (const s of seats) {
      const rows = await seatingsOf("u-ana", s);
      expect(rows, s).toHaveLength(1);
      expect(rows[0].application_id).toBe(a.body.id);
      ends.add(new Date(rows[0].term_ends_at).toISOString());
    }
    expect([...ends]).toEqual(["2029-09-30T00:00:00.000Z"]);
    expect(await seatingsHolding(pool, a.body.id)).toHaveLength(3);
  });

  it("starts_at in the future: adopted and nobody seated, then seated on the day", async () => {
    h.state.holders = ["u-hal"];
    const s = await seat("Next season seat");
    const a = await apply({ seatIds: [s], startsNoEarlierThan: "2029-12-31" });
    expect(a.body.status).toBe("awaiting-holder");
    h.state.viewer = { id: "u-hal", stage: "member" };
    const r = await h.call("POST", `/api/governance/role-applications/${a.body.id}/adopt`);
    expect(r.body.status).toBe("adopted");
    expect(await seatingsOf("u-ana", s)).toHaveLength(0);
    const stored = (await readApplication(pool, a.body.id))!;
    expect(stored.status).toBe("adopted");
    expect(stored.termSeasonId).toBe("s-next");

    // Too early, the later job seats nobody.
    const early = await seatFromApplication(pool, a.body.id, { now: new Date(), lapse: { currentSeasonId: "s-now", cadence: "season_turn" }, calendar: CALENDAR });
    expect(early.outcome.kind).toBe("later");
    // On the day it seats, in the season it was adopted for.
    const day = new Date("2030-01-02T00:00:00Z");
    const on = await seatFromApplication(pool, a.body.id, { now: day, lapse: { currentSeasonId: "s-next", cadence: "season_turn", now: day }, calendar: { ...CALENDAR, currentSeasonId: "s-next" } });
    expect(on.outcome.kind).toBe("seated");
    const rows = await seatingsOf("u-ana", s);
    expect(rows).toHaveLength(1);
    expect(rows[0].season_id).toBe("s-next");
    // And never twice.
    expect((await seatFromApplication(pool, a.body.id, { now: day, lapse: { currentSeasonId: "s-next", cadence: "season_turn" }, calendar: CALENDAR })).outcome.kind).toBe("lost");
  });

  it("CONTROL for starts_at: with no first day, the holder's adoption seats at once", async () => {
    h.state.holders = ["u-hal"];
    const s = await seat("Seat now");
    const a = await apply({ seatIds: [s] });
    h.state.viewer = { id: "u-hal", stage: "member" };
    await h.call("POST", `/api/governance/role-applications/${a.body.id}/adopt`);
    expect(await seatingsOf("u-ana", s)).toHaveLength(1);
  });

  it("SEASON PLANS: a season still to come sets the first day, so the term sits in that season", async () => {
    const s = await seat("Planned seat");
    const a = await apply({ seatIds: [s], seasonId: "s-next" });
    expect(a.status).toBe(201);
    const stored = (await readApplication(pool, a.body.id))!;
    expect(stored.termSeasonId).toBe("s-next");
    expect(stored.startsAt?.toISOString().slice(0, 10)).toBe("2029-12-31");
    // The running season sets nothing: the term sits in it, from adoption.
    const now = await apply({ seatIds: [await seat("Planned now")], seasonId: "s-now" });
    const nowRow = (await readApplication(pool, now.body.id))!;
    expect(nowRow.termSeasonId).toBe("s-now");
    expect(nowRow.startsAt).toBeNull();
    // A season the calendar does not have is refused in words.
    const stray = await apply({ seatIds: [await seat("Planned stray")], seasonId: "s-nowhere" });
    expect(stray.status).toBe(400);
    expect(stray.body.field).toBe("seasonId");
  });

  it("a vote that does not carry marks it not adopted and tells the candidate", async () => {
    const a = await apply({ seatIds: [await seat("Lost vote")] });
    const ballot = (await openBallotFor(pool, "role_application", a.body.id))!;
    await h.closers.role_application!.settle(ballot, "failed", "Not this season.", "governance");
    expect((await readApplication(pool, a.body.id))!.status).toBe("not-adopted");
    expect(h.notices.some((x) => x.userId === "u-ana" && /Not adopted/.test(x.title))).toBe(true);
  });

  // ── The ballot carries seats and aims only ───────────────────────────────

  it("the ballot's title and document carry no amount, currency, name, note or hash", async () => {
    const s = await seat("Orchard steward", 1, "Keep the orchard bearing and the ledger true.");
    const a = await apply({ seatIds: [s], seatSettings: MONEY_TERMS });
    const ballot = (await ballotById(pool, (await openBallotFor(pool, "role_application", a.body.id))!.id))!;
    const stored = (await readApplication(pool, a.body.id))!;
    const needles = [
      "Ana",
      "Quillfeather",
      "XTS",
      "4321000",
      "87600",
      "Stipend reviewed",
      "small share",
      "orchard ledger",
      NOTE,
      DELIVERABLES,
      stored.settingsHash,
    ];
    // CONTROL: the application as members read it carries every needle, so an
    // absence below is about the ballot and not about a needle nobody wrote.
    h.state.viewer = { id: "u-hal", stage: "member" };
    const served = await h.call("GET", `/api/governance/role-applications/${a.body.id}`);
    const fixture = `${JSON.stringify(served.body)} ${JSON.stringify(stored)}`;
    for (const needle of needles) expect(fixture, needle).toContain(needle);

    const publicText = `${ballot.title}\n${ballot.docMarkdown}`;
    for (const needle of needles) expect(publicText, needle).not.toContain(needle);
    expect(publicText).not.toMatch(/[0-9a-f]{64}/);
    // What it does carry: the seat and its aim, and where members read the rest.
    expect(ballot.title).toBe("Who holds Orchard steward");
    expect(ballot.docMarkdown).toContain("Keep the orchard bearing and the ledger true.");
    expect(ballot.docMarkdown).toContain(`/seat-applications/${a.body.id}`);
    // Plain lines: the decision page prints the document as written.
    expect(ballot.docMarkdown).not.toMatch(/^#|\*\*/m);
  });

  // ── Withdraw ─────────────────────────────────────────────────────────────

  it("withdrawing while voting withdraws the ballot", async () => {
    const a = await apply({ seatIds: [await seat("Withdrawn seat")] });
    const ballot = (await openBallotFor(pool, "role_application", a.body.id))!;
    // Somebody else may not withdraw it.
    h.state.viewer = { id: "u-hal", stage: "member" };
    expect((await h.call("POST", `/api/governance/role-applications/${a.body.id}/withdraw`)).status).toBe(403);
    h.state.viewer = { id: "u-ana", stage: "member" };
    const r = await h.call("POST", `/api/governance/role-applications/${a.body.id}/withdraw`);
    expect(r.status).toBe(200);
    expect((await ballotById(pool, ballot.id))!.status).toBe("withdrawn");
    expect((await readApplication(pool, a.body.id))!.status).toBe("withdrawn");
    expect(await openBallotFor(pool, "role_application", a.body.id)).toBeNull();
  });
});

describe("no public event anywhere in this feature", () => {
  it("names neither recordEvent nor addActivity in the files the door adds", () => {
    const root = path.resolve(__dirname, "..", "..");
    const files = [
      "server/routes/seatApplications.ts",
      "server/lib/seatApplicationCloser.ts",
      "server/repos/seatApplications.ts",
      "shared/seatApplications.ts",
    ];
    for (const f of files) {
      const text = fs.readFileSync(path.join(root, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(text, f).not.toMatch(/\brecordEvent\s*\(/);
      expect(text, f).not.toMatch(/\baddActivity\s*\(/);
    }
    // Control: the scan finds a call where one exists.
    const sibling = fs.readFileSync(path.join(root, "server/routes/powerHands.ts"), "utf8");
    expect(sibling).toMatch(/\brecordEvent\s*\(/);
  });
});
