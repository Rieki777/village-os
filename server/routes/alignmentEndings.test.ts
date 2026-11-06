/**
 * ENDING ALIGNED TERMS, OVER REAL HTTP AND A REAL SCHEMA (seat settings PR8).
 *
 * The member door (server/routes/seatApplications.ts) and the alignment
 * routes (server/routes/alignments.ts) on one app, against the S5 scratch
 * schema with migration 0260 applied. What is pinned:
 *
 *   - NOTICE keeps the terms in force until its `effective_at`, which is now
 *     plus the terms' own notice days, and ends them after; it never unseats
 *     anybody (the seating stays open);
 *   - a WITHDRAWN notice ends nothing, and only the party who gave it can take
 *     it back;
 *   - an AMENDMENT adopted during a running notice is version 2, version 1
 *     stays in force with its notice until version 2 is, then reads
 *     "Superseded by version 2";
 *   - ENDING BY AGREEMENT needs both parties: one ask leaves the terms in
 *     force; the village's ask, by a live holder of org.seat who is not the
 *     candidate, ends them; the candidate acting for the village is refused,
 *     and with nobody holding the power the village side needs a vote;
 *   - an ENDED SEATING ends the terms through the derivation, whichever door
 *     ended it: a raw admin end, and the release a departure runs;
 *   - PARTY LEFT: leaving the village writes a `party_left` ending through the
 *     erasure sweep, before the seatings go, so the record says why;
 *   - TERM END: the sweep writes the `term_end` row once the term is over;
 *   - a member who is not a party is refused, and the endings table holds no
 *     words at all (nothing for an erasure to scrub).
 *
 * Every name is fake, and every figure is in XTS, the ISO 4217 code reserved for testing.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import type { SeatCalendar } from "../../shared/seatTerms";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import type { LandingDeps, SubjectCloser } from "../lib/applyDue";
import { createOrgRole, releaseSeatingsForUser } from "../lib/orgChart";
import { settleAll, viewText } from "../lib/alignmentSubjects";
import { recordPartyLeft } from "../lib/alignmentEndings";
import { anonymizeMember, type ErasureDeps } from "../lib/erasure";
import { clearMemberDrivers } from "../lib/memberDrivers";
import { usersRepo } from "../repos/users";
import { endingsOf, readText } from "../repos/alignments";
import { readApplication } from "../repos/seatApplications";
import { register as registerApplications } from "./seatApplications";
import { register as registerAlignments } from "./alignments";

const LADDER = ["visitor", "guest", "member"];
const DAY = 24 * 60 * 60 * 1000;

const PEOPLE: Record<string, { id: string; name: string; handle: string }> = {
  "u-ana": { id: "u-ana", name: "Ana Quillfeather", handle: "anaq" },
  "u-hal": { id: "u-hal", name: "Hal Keeper", handle: "halk" },
  "u-ivo": { id: "u-ivo", name: "Ivo Lantern", handle: "ivol" },
  "u-wren": { id: "u-wren", name: "Wren Halloway", handle: "wrenh" },
};

/** Ten days' notice in the ending group, so the notice's day is the terms' own and not the default. */
const TERMS = { v: 1, pay: { kind: "honorary" }, ending: { noticeDays: 10, payThroughNotice: false } };
const AMENDED = { v: 1, pay: { kind: "honorary" }, ending: { noticeDays: 21, payThroughNotice: false }, quests: { perMoonMin: 2, perMoonMax: 4, doneWhenRequired: true } };

const CALENDAR: SeatCalendar = {
  seasons: [{ id: "s-now", startsOn: "2026-01-01", endsOn: "2029-12-31" }],
  currentSeasonId: "s-now",
  timezone: "UTC",
};

const configured = testDbConfigured();
if (!configured) console.warn("[alignmentEndings] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

function harness() {
  const state = {
    viewer: null as { id: string; stage: string } | null,
    holders: [] as string[],
    villageHeld: [] as string[],
    /** The instant the alignment routes act at. Null: the clock. */
    now: null as Date | null,
    pool: (): any => {
      throw new Error("the database was read before the gate answered");
    },
  };
  const notices: Array<{ userId: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }> = [];
  const seenKeys = new Set<string>();
  const closers: Record<string, SubjectCloser> = {};
  let server: http.Server;
  let base = "";

  const member = (id: string) => ({ ...(PEOPLE[id] ?? { id, name: "Someone", handle: id }), tokenVersion: 0, passwordHash: "x", prefs: {} });
  const notify = async (input: any) => {
    if (seenKeys.has(input.dedupeKey)) return { inserted: false } as any;
    seenKeys.add(input.dedupeKey);
    notices.push(input);
    return { inserted: true } as any;
  };
  const notifyAdmins = async () => {};
  const ctxOf = () =>
    ({ stageIndex: LADDER.indexOf(state.viewer?.stage ?? "visitor"), stageIndexOf: (x: string) => LADDER.indexOf(x), roleCapabilities: [], villageHeld: [...state.villageHeld] }) as unknown as CapabilityCtx;
  const guardCapability = async (_req: any, res: any, cap: any, refusal?: { status: number; body: Record<string, unknown> }) => {
    if (state.viewer && hasCapability(cap, ctxOf())) return true;
    res.status(refusal?.status ?? 401).json(refusal?.body ?? { error: "auth_required" });
    return false;
  };
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
    const authedUser = async () => (state.viewer ? member(state.viewer.id) : null);
    const members = { byId: async (id: string) => PEOPLE[id] ?? null, update: async (id: string) => member(id) } as any;
    const liveHoldersOf = async () => [...state.holders];
    registerApplications(app, {
      authedUser,
      capabilityCtx: async () => ctxOf(),
      guardCapability,
      getPool: () => state.pool(),
      notify,
      notifyAdmins,
      overLimit: async () => false,
      members,
      firstName: (n: string) => String(n ?? "").split(" ")[0] ?? "",
      liveHoldersOf,
      rolesCarrying: () => [{ id: "role-stewards", name: "Stewards" }],
      loadRoleHolders: () => state.holders.map((userId) => ({ roleId: "role-stewards", userId })),
      roleBallotSetup: async () => ({
        method: "majority",
        dials: { unityPct: 50, quorumPct: 0 },
        snapshot: { mode: "equal", token: null },
        tokenProblem: null,
        electorate: ["u-ana", "u-hal", "u-ivo"].map((userId) => ({ userId, weight: 1 })),
        durationDays: 7,
      }),
      seatCalendar: () => CALENDAR,
      lapse: () => ({ currentSeasonId: "s-now", cadence: "season_turn" }),
      landingDeps: () => ({ pool: state.pool(), ...landing }) as unknown as LandingDeps,
      closers,
    } as any);
    registerAlignments(app, {
      authedUser,
      guardCapability,
      getPool: () => state.pool(),
      notify,
      notifyAdmins,
      overLimit: async () => false,
      members,
      confirmIdentity: async () => ({ ok: false, body: { error: "no confirmation in this suite" } }),
      googleAvailable: () => false,
      authSecret: "test-secret",
      seatCalendar: () => CALENDAR,
      now: () => state.now ?? new Date(),
      idForHandle: async (h: string) => Object.values(PEOPLE).find((p) => p.handle === h)?.id ?? null,
      capabilityCtx: async () => ctxOf(),
      liveHoldersOf,
    } as any);
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

describe.skipIf(!configured)("ending aligned terms, on a real schema", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;
  let n = 0;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
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
    h.state.holders = ["u-hal"];
    h.state.villageHeld = [];
    h.state.now = null;
    h.notices.length = 0;
  });

  const as = (id: string) => {
    h.state.viewer = { id, stage: "member" };
  };
  const seat = async (name: string) => {
    n += 1;
    return createOrgRole(pool, { id: `seat-end-${n}-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`, name, seats: 1 });
  };
  /** Apply as `who`, have Hal adopt for the village, and hand back the application and its text, in force. */
  const inForce = async (name: string, who = "u-ana", settings: Record<string, unknown> = TERMS) => {
    const s = await seat(name);
    as(who);
    const body = { seatIds: [s], deliverables: "The orchard ledger balances every moon.", fitStatement: "I kept it last season.", seatSettings: settings };
    const words = (await h.call("POST", "/api/governance/role-applications/words", body)).body.body;
    const a = await h.call("POST", "/api/governance/role-applications", { ...body, alignedWords: words });
    expect(a.status).toBe(201);
    as("u-hal");
    expect((await h.call("POST", `/api/governance/role-applications/${a.body.id}/adopt`)).status).toBe(200);
    as(who);
    const mine = await served(a.body.textId);
    expect(mine.state).toBe("in-force");
    return { seatId: s, appId: a.body.id as string, textId: a.body.textId as string };
  };
  /** The text as its party reads it on their profile, at the harness's now. */
  const served = async (textId: string, who = h.state.viewer?.id ?? "u-ana") => {
    const keep = h.state.viewer;
    as(who);
    const list = (await h.call("GET", "/api/profile/alignments")).body.alignments as any[];
    h.state.viewer = keep;
    return list.find((x) => x.textId === textId);
  };
  const openSeatings = async (appId: string) =>
    Number(((await pool.query<any[]>("SELECT COUNT(*) AS c FROM org_role_assignments WHERE application_id = ? AND ended_at IS NULL", [appId]))[0] as any[])[0].c); // module-review-ok: fixture read of the S5 scratch schema

  // ── Notice ────────────────────────────────────────────────────────────────

  it("NOTICE keeps the terms in force until effective_at, the terms' own days, and never unseats anybody", async () => {
    const t = await inForce("Notice keeper");
    const given = new Date();
    h.state.now = given;
    const r = await h.call("POST", `/api/profile/alignments/${t.textId}/notice`);
    expect(r.status).toBe(201);
    // The ending group's ten days, not the default fourteen.
    expect(new Date(r.body.effectiveAt).getTime()).toBe(given.getTime() + 10 * DAY);
    expect(r.body.alignment.state).toBe("in-force");
    expect(r.body.alignment.endingLine).toMatch(/^Notice given, ends \d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(r.body.alignment.you.acts.notice.id).toBe(r.body.endingId);
    expect(r.body.alignment.you.acts.mayGiveNotice).toBe(false);

    // A minute before it takes effect: still in force.
    h.state.now = new Date(given.getTime() + 10 * DAY - 60_000);
    expect((await served(t.textId)).state).toBe("in-force");
    // A minute after: ended by notice, and the seating is still open.
    h.state.now = new Date(given.getTime() + 10 * DAY + 60_000);
    const after = await served(t.textId);
    expect(after.state).toBe("ended");
    expect(after.endingLine).toMatch(/^Ended by notice on /);
    expect(after.why).toBe(after.endingLine);
    expect(await openSeatings(t.appId)).toBe(1);

    // The village heard, through the holder who aligned for it, with the seat name and a link only.
    const told = h.notices.filter((x) => x.dedupeKey.startsWith(`alignment:${t.textId}:village:notice:`));
    expect(told.map((x) => [x.userId, x.title, x.link, x.body ?? null])).toEqual([
      ["u-hal", "Notice given on the terms for Notice keeper", `/role-applications/${t.appId}`, null],
    ]);
    // Ana gave it, so she is not told her own act.
    expect(h.notices.some((x) => x.userId === "u-ana" && x.dedupeKey.includes(":notice:"))).toBe(false);
  });

  it("a WITHDRAWN notice ends nothing, and only the party who gave it can take it back", async () => {
    const t = await inForce("Withdrawn notice");
    const given = new Date();
    h.state.now = given;
    const r = await h.call("POST", `/api/profile/alignments/${t.textId}/notice`);
    expect(r.status).toBe(201);
    // A second notice while one runs is refused.
    expect((await h.call("POST", `/api/profile/alignments/${t.textId}/notice`)).body.error).toBe("notice_running");

    // Hal, for the village, may not take back Ana's notice.
    as("u-hal");
    const theirs = await h.call("POST", `/api/profile/alignments/${t.textId}/endings/${r.body.endingId}/take-back`, { as: "village" });
    expect(theirs.status).toBe(403);
    expect(theirs.body.error).toBe("not_yours");

    as("u-ana");
    const back = await h.call("POST", `/api/profile/alignments/${t.textId}/endings/${r.body.endingId}/take-back`);
    expect(back.status).toBe(201);
    expect(back.body.alignment.endingLine).toBeNull();
    expect(back.body.alignment.you.acts.mayGiveNotice).toBe(true);
    // Taken back once is taken back.
    expect((await h.call("POST", `/api/profile/alignments/${t.textId}/endings/${r.body.endingId}/take-back`)).body.error).toBe("taken_effect");

    // Past the day it would have taken effect: still in force.
    h.state.now = new Date(given.getTime() + 30 * DAY);
    expect((await served(t.textId)).state).toBe("in-force");
    // The record keeps both rows: the notice is never touched, the withdrawal names it.
    const rows = await endingsOf(pool, [t.textId]);
    expect(rows.map((e) => [e.kind, e.refersTo])).toEqual([
      ["notice", null],
      ["notice_withdrawn", r.body.endingId],
    ]);
  });

  // ── Amend ─────────────────────────────────────────────────────────────────

  it("SUPERSEDE DURING A RUNNING NOTICE: version 1 stays in force with its notice until version 2 is, then reads superseded", async () => {
    const t = await inForce("Ledger keeper");
    expect((await h.call("POST", `/api/profile/alignments/${t.textId}/notice`)).status).toBe(201);

    // The amendment: same seat, new terms, naming the application it amends.
    const body = { seatIds: [t.seatId], deliverables: "Two more people run the ledger.", fitStatement: "I kept it last season.", seatSettings: AMENDED, supersedesId: t.appId };
    const words = (await h.call("POST", "/api/governance/role-applications/words", body)).body.body;
    const a = await h.call("POST", "/api/governance/role-applications", { ...body, alignedWords: words });
    expect(a.status).toBe(201);
    const v2 = (await readText(pool, a.body.textId))!;
    expect(v2.version).toBe(2);
    expect(v2.supersedesId).toBe(t.textId);
    expect((await readApplication(pool, a.body.id))!.supersedesId).toBe(t.appId);

    // Not adopted yet: version 1 is in force, its notice still running.
    const waiting = await served(t.textId);
    expect(waiting.state).toBe("in-force");
    expect(waiting.endingLine).toMatch(/^Notice given, ends /);

    as("u-hal");
    expect((await h.call("POST", `/api/governance/role-applications/${a.body.id}/adopt`)).status).toBe(200);
    as("u-ana");
    const v1 = await served(t.textId);
    expect(v1.state).toBe("ended");
    expect(v1.endingLine).toBe("Superseded by version 2");
    expect(v1.you.acts).toEqual({ mayGiveNotice: false, notice: null, mayEndByAgreement: false, ask: null });
    const now2 = await served(a.body.textId);
    expect(now2.state).toBe("in-force");
    expect(now2.version).toBe(2);
    // The notice on version 1 does not carry to version 2.
    expect(now2.endingLine).toBeNull();
    const sup = (await endingsOf(pool, [t.textId])).find((e) => e.kind === "superseded")!;
    expect(sup.refersTo).toBe(a.body.textId);
  });

  it("an amendment is for the member's own terms in force, for the same seats", async () => {
    const t = await inForce("Gate keeper");
    const other = await seat("Other seat");
    const base = { deliverables: "The gate opens on time.", fitStatement: "I kept it.", seatSettings: AMENDED };
    const wrongSeats = await h.call("POST", "/api/governance/role-applications", { ...base, seatIds: [t.seatId, other], supersedesId: t.appId });
    expect(wrongSeats.status).toBe(409);
    expect(wrongSeats.body.field).toBe("seatIds");
    as("u-ivo");
    const notTheirs = await h.call("POST", "/api/governance/role-applications", { ...base, seatIds: [t.seatId], supersedesId: t.appId });
    expect(notTheirs.status).toBe(403);
    // CONTROL: Ana's own amendment for the same seat is taken.
    as("u-ana");
    expect((await h.call("POST", "/api/governance/role-applications", { ...base, seatIds: [t.seatId], supersedesId: t.appId })).status).toBe(201);
  });

  // ── By agreement ──────────────────────────────────────────────────────────

  it("ENDING BY AGREEMENT needs both: one ask keeps the terms, the village's ask by a holder ends them", async () => {
    const t = await inForce("Agreement seat");
    const ask = await h.call("POST", `/api/profile/alignments/${t.textId}/end-by-agreement`);
    expect(ask.status).toBe(201);
    expect(ask.body.alignment.state).toBe("in-force");
    expect(ask.body.alignment.endingLine).toBe("Ana Quillfeather asked to end by agreement");

    // The candidate may not answer for the village.
    const own = await h.call("POST", `/api/profile/alignments/${t.textId}/end-by-agreement`, { as: "village" });
    expect(own.status).toBe(403);
    expect(own.body.error).toBe("own_terms");
    // Nor may a member who holds nothing.
    as("u-ivo");
    expect((await h.call("POST", `/api/profile/alignments/${t.textId}/end-by-agreement`, { as: "village" })).status).toBe(403);
    // With nobody holding the power live, the village side needs a vote, and says so.
    h.state.holders = [];
    as("u-hal");
    const noHolder = await h.call("POST", `/api/profile/alignments/${t.textId}/end-by-agreement`, { as: "village" });
    expect(noHolder.status).toBe(409);
    expect(noHolder.body.error).toBe("needs_vote");
    expect((await served(t.textId, "u-ana")).state).toBe("in-force");

    // Hal, a live holder who is not the candidate, answers for the village.
    h.state.holders = ["u-hal"];
    const village = await h.call("POST", `/api/profile/alignments/${t.textId}/end-by-agreement`, { as: "village" });
    expect(village.status).toBe(201);
    expect(village.body.alignment.state).toBe("ended");
    expect(village.body.alignment.endingLine).toMatch(/^Ended by agreement on /);
    const done = h.notices.filter((x) => x.dedupeKey.startsWith(`alignment:${t.textId}:`) && x.dedupeKey.endsWith(":ended-by-agreement"));
    expect(done.map((x) => x.userId).sort()).toEqual(["u-ana", "u-hal"]);
  });

  // ── Whichever door ended the seating ──────────────────────────────────────

  it("an ENDED SEATING ends the terms through the derivation, whichever door ended it", async () => {
    // Door one: an admin ending the seating row by hand, writing nothing about terms.
    const a = await inForce("Admin ended");
    await pool.query("UPDATE org_role_assignments SET ended_at = NOW(), ended_reason = 'ended by an admin' WHERE application_id = ?", [a.appId]); // module-review-ok: the admin door's write, reproduced against the S5 scratch schema
    const one = await served(a.textId);
    expect(one.state).toBe("ended");
    expect(one.why).toBe("The seating these terms were held on has ended.");
    expect(one.endingLine).toBeNull();
    // Door two: the release a departure runs.
    const b = await inForce("Released", "u-ivo");
    await releaseSeatingsForUser(pool, "u-ivo", "member left the village");
    expect((await served(b.textId, "u-ivo")).state).toBe("ended");
    // CONTROL: no ending row was written by either door; the derivation alone ended them.
    expect(await endingsOf(pool, [a.textId, b.textId])).toEqual([]);
  });

  // ── Leaving ───────────────────────────────────────────────────────────────

  it("PARTY LEFT: leaving writes the ending before the seatings go, and leaving is never refused", async () => {
    await pool.query("INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?, 'x')", ["u-wren", "Wren Halloway", "wren@examples.invalid"]); // module-review-ok: the leaver's user row in the S5 scratch schema
    const t = await inForce("Wren's seat", "u-wren");
    const target = await usersRepo(pool).byId("u-wren");
    const uploads = fs.mkdtempSync(path.join(os.tmpdir(), "village-ending-"));
    clearMemberDrivers();
    const deps: ErasureDeps = {
      members: { byId: (id: string) => usersRepo(pool).byId(id), update: (id: string, fn: (u: any) => void) => usersRepo(pool).update(id, fn) },
      submissionsRepo: { all: () => [], replaceAll: async () => {} },
      roleHoldersRepo: { remove: async () => {} },
      withRoleHolderLock: (fn) => fn(),
      loadRoleHolders: () => [],
      uploadsDir: uploads,
    };
    try {
      await anonymizeMember(pool, target, null, deps);
    } finally {
      fs.rmSync(uploads, { recursive: true, force: true });
    }
    const rows = await endingsOf(pool, [t.textId]);
    expect(rows.map((e) => [e.kind, e.partyKey])).toEqual([["party_left", "user:u-wren"]]);
    // Ended by the leaving, not by the seating the sweep released after it.
    const v = (await viewText(pool, t.textId, "2027-01-01", "UTC", new Date()))!;
    expect(v.derived.endedBy).toBe("ending");
    expect(v.derived.ending?.kind).toBe("party_left");
    expect(await openSeatings(t.appId)).toBe(0);
    // A resumed sweep writes nothing twice, and names nothing it did not end.
    expect(await recordPartyLeft(pool, "u-wren", new Date())).toEqual([]);
    expect(await endingsOf(pool, [t.textId])).toHaveLength(1);
  });

  it("recordPartyLeft names the terms it ended, for the exit flow", async () => {
    const t = await inForce("Named on the way out", "u-ivo");
    expect(await recordPartyLeft(pool, "u-ivo", new Date())).toEqual(["Terms for Named on the way out"]);
    expect((await served(t.textId, "u-ivo")).endingLine).toMatch(/when a party left the village$/);
  });

  // ── The term's end, for the record ────────────────────────────────────────

  it("TERM END: once the term is over, the sweep writes the term_end row once", async () => {
    const t = await inForce("Term runner");
    const later = new Date("2030-02-01T12:00:00Z");
    const deps = { getPool: () => pool, notify: async () => ({}), notifyAdmins: async () => {}, today: () => "2030-02-01", now: () => later, timezone: () => "UTC" };
    const first = await settleAll(deps);
    expect(first).toMatch(/[1-9]\d* term end\(s\) recorded/);
    const rows = (await endingsOf(pool, [t.textId])).filter((e) => e.kind === "term_end");
    expect(rows).toHaveLength(1);
    h.state.now = later;
    expect((await served(t.textId)).endingLine).toMatch(/^The term ended on /);
    await settleAll(deps);
    expect((await endingsOf(pool, [t.textId])).filter((e) => e.kind === "term_end")).toHaveLength(1);
  });

  // ── Refusals and the record ───────────────────────────────────────────────

  it("a member who is not a party is refused, and a visitor is asked to sign in", async () => {
    const t = await inForce("Not yours");
    as("u-ivo");
    const r = await h.call("POST", `/api/profile/alignments/${t.textId}/notice`);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("not_a_party");
    expect((await h.call("POST", `/api/profile/alignments/${t.textId}/end-by-agreement`)).status).toBe(403);
    h.state.viewer = null;
    expect((await h.call("POST", `/api/profile/alignments/${t.textId}/notice`)).status).toBe(401);
    expect(await endingsOf(pool, [t.textId])).toEqual([]);
  });

  it("the endings table holds no words: nothing in it for an erasure to scrub", async () => {
    const [rows] = await pool.query<any[]>("SELECT * FROM alignment_endings"); // module-review-ok: fixture read of the S5 scratch schema
    expect((rows as any[]).length).toBeGreaterThan(0);
    const all = JSON.stringify(rows);
    for (const p of Object.values(PEOPLE)) {
      expect(all).not.toContain(p.name);
      expect(all).not.toContain(`@${p.handle}`);
    }
  });
});
