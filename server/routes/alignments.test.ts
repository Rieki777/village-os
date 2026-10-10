/**
 * ALIGNING, OVER REAL HTTP AND A REAL SCHEMA (seat settings PR5).
 *
 * The member door (server/routes/seatApplications.ts) and the alignment
 * routes (server/routes/alignments.ts) mounted together on one app, against
 * the S5 scratch schema with migration 0242 applied. What is pinned:
 *
 *   - "Propose and align" writes the application, text v1, both parties and
 *     the candidate's alignment in one act, and the text's hash is the one the
 *     application records; the words are the words the Review route rendered;
 *   - words that changed since Review are refused and nothing is written;
 *   - a hash that is not the text's is refused (409), and so is a member who
 *     is not a party (403);
 *   - MONEY: terms carrying pay with a stale confirmation get the re-confirm
 *     demand, and a fresh confirmation aligns; terms with no money align in
 *     one click with no confirmation at all;
 *   - the village aligns by the holder's adopt click (`holder`) and by the
 *     landed ballot (`ballot`), and the closer refuses a text whose hash is not
 *     the one the application recorded;
 *   - in force once both have aligned and the seating is open; each party told
 *     once; sealed when the village can sign, and the receipt verifies with
 *     `verifyDocument`; unsealed when it cannot, then sealed by the sweep;
 *   - the retrofit: an application from before PR5 aligns from its stored terms;
 *   - another member's list is for terms.read readers, without hash or salt;
 *   - the export carries texts, own rows and receipts, counterparties as name
 *     and capacity only.
 *
 * Every name is fake, and every figure is in XTS, the ISO 4217 code reserved for testing.
 */
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import type { SeatCalendar } from "../../shared/seatTerms";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { openBallotFor } from "../lib/ballots";
import type { LandingDeps, SubjectCloser } from "../lib/applyDue";
import { createOrgRole } from "../lib/orgChart";
import { contentHashOf, settleAll } from "../lib/alignmentSubjects";
import { adoptApplication } from "../lib/seatApplicationCloser";
import { ensureSigningKey, publicKeyBlock, resetSigningKeyForTests, signingKey, verifyDocument } from "../lib/villageExport";
import { alignmentsOf, partiesOf, readText, sealsOf, textsForSubject } from "../repos/alignments";
import { insertApplication, readApplication } from "../repos/seatApplications";
import { register as registerApplications } from "./seatApplications";
import { alignmentsForExport, register as registerAlignments } from "./alignments";

const LADDER = ["visitor", "guest", "member"];
const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "right horse battery";

const PEOPLE: Record<string, { id: string; name: string; handle: string }> = {
  "u-ana": { id: "u-ana", name: "Ana Quillfeather", handle: "anaq" },
  "u-hal": { id: "u-hal", name: "Hal Keeper", handle: "halk" },
  "u-ivo": { id: "u-ivo", name: "Ivo Lantern", handle: "ivol" },
  "u-guest": { id: "u-guest", name: "Gale Visitor", handle: "galev" },
};

const MONEY_TERMS = { v: 1, pay: { kind: "fixed", currency: "XTS", amountMinor: 4321000, per: "month" } };
const HONORARY_TERMS = { v: 1, pay: { kind: "honorary" }, quests: { perMoonMin: 2, perMoonMax: 4, doneWhenRequired: true } };
const NOTE = "I kept the orchard ledger for the whole of last season.";
const DELIVERABLES = "By the end of the season two more people can run the orchard ledger without me.";

const CALENDAR: SeatCalendar = {
  seasons: [{ id: "s-now", startsOn: "2026-01-01", endsOn: "2029-12-31" }],
  currentSeasonId: "s-now",
  timezone: "UTC",
};

const configured = testDbConfigured();
if (!configured) console.warn("[alignments] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

function harness() {
  const state = {
    viewer: null as { id: string; stage: string } | null,
    holders: [] as string[],
    villageHeld: [] as string[],
    /** When each member last confirmed it is them, ms. Absent: never. */
    confirmedAt: {} as Record<string, number>,
    pool: (): any => {
      throw new Error("the database was read before the gate answered");
    },
  };
  const notices: Array<{ userId: string; title: string; link?: string | null; dedupeKey: string }> = [];
  const adminNotices: string[] = [];
  const seenKeys = new Set<string>();
  const closers: Record<string, SubjectCloser> = {};
  let server: http.Server;
  let base = "";

  const member = (id: string) => {
    const p = PEOPLE[id] ?? { id, name: "Someone", handle: id };
    const at = state.confirmedAt[id];
    return { ...p, tokenVersion: 0, passwordHash: "x", prefs: at ? { identityConfirmedAt: { at, v: 0 } } : {} };
  };
  // The notification spine keeps one row per dedupe key; so does this.
  const notify = async (input: any) => {
    if (seenKeys.has(input.dedupeKey)) return { inserted: false } as any;
    seenKeys.add(input.dedupeKey);
    notices.push(input);
    return { inserted: true } as any;
  };
  const notifyAdmins = async (_t: string, title: string, key: string) => {
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    adminNotices.push(`${key} ${title}`);
  };
  const guardCapability = async (_req: any, res: any, cap: any, refusal?: { status: number; body: Record<string, unknown> }) => {
    const ctx = { stageIndex: LADDER.indexOf(state.viewer?.stage ?? "visitor"), stageIndexOf: (x: string) => LADDER.indexOf(x), roleCapabilities: [] } as unknown as CapabilityCtx;
    if (state.viewer && hasCapability(cap, ctx)) return true;
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
    const members = {
      byId: async (id: string) => PEOPLE[id] ?? null,
      update: async (id: string, mutate: (m: any) => void) => {
        const m = member(id);
        mutate(m);
        if (m.prefs?.identityConfirmedAt?.at) state.confirmedAt[id] = m.prefs.identityConfirmedAt.at;
        return m;
      },
    } as any;
    registerApplications(app, {
      authedUser,
      capabilityCtx: async () =>
        ({ stageIndex: LADDER.indexOf(state.viewer?.stage ?? "visitor"), stageIndexOf: (x: string) => LADDER.indexOf(x), roleCapabilities: [], villageHeld: [...state.villageHeld] }) as unknown as CapabilityCtx,
      guardCapability,
      getPool: () => state.pool(),
      notify,
      notifyAdmins,
      overLimit: async () => false,
      members,
      firstName: (n: string) => String(n ?? "").split(" ")[0] ?? "",
      liveHoldersOf: async () => [...state.holders],
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
      // The village's one identity gate, as exit and delete use it: a password here.
      confirmIdentity: async (req: any) =>
        req.body?.password === PASSWORD
          ? { ok: true, via: "password" }
          : { ok: false, body: { error: "Confirm with your password to align with terms that carry money" } },
      googleAvailable: () => false,
      authSecret: "test-secret",
      seatCalendar: () => CALENDAR,
      idForHandle: async (h: string) => Object.values(PEOPLE).find((p) => p.handle === h)?.id ?? null,
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
  return { state, notices, adminNotices, closers, start, stop, call };
}

describe("the alignment reads refuse everyone below the member rung", () => {
  const h = harness();
  beforeAll(h.start);
  afterAll(h.stop);

  it("a visitor and a guest get 401 on another member's list, and the database is never read", async () => {
    h.state.viewer = null;
    expect((await h.call("GET", "/api/alignments?party=anaq")).status).toBe(401);
    expect((await h.call("GET", "/api/profile/alignments")).status).toBe(401);
    expect((await h.call("POST", "/api/profile/alignments", { textId: "at-0123456789abcdef", contentHash: "0".repeat(64) })).status).toBe(401);
    h.state.viewer = { id: "u-guest", stage: "guest" };
    const r = await h.call("GET", "/api/alignments?party=anaq");
    expect(r.status).toBe(401);
    expect(r.body).not.toHaveProperty("alignments");
  });
});

describe.skipIf(!configured)("aligning, on a real schema", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;
  let n = 0;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    h.state.pool = () => pool;
    resetSigningKeyForTests();
    await ensureSigningKey(pool, { VILLAGE_SECRETS_KEY: "a".repeat(64) });
    await h.start();
  });

  afterAll(async () => {
    await h.stop();
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    h.state.viewer = { id: "u-ana", stage: "member" };
    h.state.holders = [];
    h.state.villageHeld = [];
    // Ana confirmed a minute ago, so money terms align for her unless a test says otherwise.
    h.state.confirmedAt = { "u-ana": Date.now() - 60_000, "u-hal": Date.now() - 60_000 };
    h.notices.length = 0;
    h.adminNotices.length = 0;
  });

  const seat = async (name: string, places = 1) => {
    n += 1;
    return createOrgRole(pool, { id: `seat-${n}-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`, name, seats: places });
  };
  const words = (body: Record<string, unknown>) => h.call("POST", "/api/governance/role-applications/words", body);
  const apply = async (body: Record<string, unknown>, opts: { withWords?: boolean } = { withWords: true }) => {
    const full = { deliverables: DELIVERABLES, fitStatement: NOTE, seatSettings: { v: 1 }, ...body };
    const w = opts.withWords ? (await words(full)).body.body : undefined;
    return h.call("POST", "/api/governance/role-applications", { ...full, ...(w !== undefined ? { alignedWords: w } : {}) });
  };
  const land = async (applicationId: string) => {
    const ballot = await openBallotFor(pool, "role_application", applicationId);
    if (!ballot) throw new Error("no open ballot for the application");
    return h.closers.role_application!.execute!(ballot, "governance");
  };
  const count = async (table: string) =>
    Number(((await pool.query<any[]>(`SELECT COUNT(*) AS c FROM ${table}`))[0] as any[])[0].c); // module-review-ok: fixture count against the S5 scratch schema, never a production table

  // ── Propose and align ─────────────────────────────────────────────────────

  it("PROPOSE AND ALIGN: one act writes the application, text v1, both parties and the candidate's alignment", async () => {
    const s = await seat("Orchard steward");
    const shown = await words({ seatIds: [s], seatSettings: HONORARY_TERMS });
    expect(shown.status).toBe(200);
    expect(shown.body.body).toContain("THE SEAT\n  Orchard steward");
    expect(shown.body.money).toBe(false);
    const a = await h.call("POST", "/api/governance/role-applications", {
      seatIds: [s],
      deliverables: DELIVERABLES,
      fitStatement: NOTE,
      seatSettings: HONORARY_TERMS,
      alignedWords: shown.body.body,
    });
    expect(a.status).toBe(201);
    const app = (await readApplication(pool, a.body.id))!;
    const text = (await readText(pool, a.body.textId))!;
    expect(app.textId).toBe(text.id);
    expect(app.textHash).toBe(text.contentHash);
    // The stored words are exactly the words Review showed.
    expect(text.body).toBe(shown.body.body);
    expect(text.version).toBe(1);
    expect(text.subjectRef).toBe(app.id);
    // No candidate name in the words: the parties carry who.
    expect(text.body).not.toContain("Ana");
    const parties = await partiesOf(pool, [text.id]);
    expect(parties.map((p) => [p.partyKey, p.capacity, p.required]).sort()).toEqual([
      ["user:u-ana", "individually", true],
      ["village", "for the village", true],
    ]);
    const rows = await alignmentsOf(pool, [text.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ partyKey: "user:u-ana", userId: "u-ana", method: "click", contentHash: text.contentHash });
    expect(rows[0].intentText).toBe("I align with these terms for Orchard steward.");
    // The salted hash recomputes from what was stored.
    expect(contentHashOf({ ...text, parties })).toBe(text.contentHash);
  });

  it("words that changed since Review are refused, and nothing is written", async () => {
    const s = await seat("Changed words");
    const before = await Promise.all(["seat_applications", "alignment_texts", "alignments"].map(count));
    const r = await h.call("POST", "/api/governance/role-applications", {
      seatIds: [s],
      deliverables: DELIVERABLES,
      fitStatement: NOTE,
      seatSettings: HONORARY_TERMS,
      alignedWords: "Terms for something else entirely",
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("words_changed");
    expect(await Promise.all(["seat_applications", "alignment_texts", "alignments"].map(count))).toEqual(before);
    // Control: the words Review renders are taken.
    expect((await apply({ seatIds: [s], seatSettings: HONORARY_TERMS })).status).toBe(201);
  });

  // ── Money asks the re-confirm ─────────────────────────────────────────────

  it("MONEY: a stale confirmation gets the re-confirm demand at Propose and align, and a fresh one aligns", async () => {
    const s = await seat("Paid seat");
    h.state.confirmedAt = { "u-ana": Date.now() - 20 * 60_000 };
    const before = await count("alignments");
    const stale = await apply({ seatIds: [s], seatSettings: MONEY_TERMS });
    expect(stale.status).toBe(403);
    expect(stale.body.error).toBe("reconfirm_required");
    expect(await count("alignments")).toBe(before);
    // A wrong password does not confirm.
    expect((await h.call("POST", "/api/profile/alignments/confirm", { password: "wrong" })).status).toBe(403);
    expect((await h.call("GET", "/api/profile/alignments/confirm")).body.fresh).toBe(false);
    const ok = await h.call("POST", "/api/profile/alignments/confirm", { password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.fresh).toBe(true);
    const fresh = await apply({ seatIds: [s], seatSettings: MONEY_TERMS });
    expect(fresh.status).toBe(201);
    expect(await alignmentsOf(pool, [fresh.body.textId])).toHaveLength(1);
  });

  it("CONTROL for money: terms with no money align in one click with no confirmation ever given", async () => {
    h.state.confirmedAt = {};
    const r = await apply({ seatIds: [await seat("Honorary seat")], seatSettings: HONORARY_TERMS });
    expect(r.status).toBe(201);
    expect(await alignmentsOf(pool, [r.body.textId])).toHaveLength(1);
  });

  // ── Another party aligns: the textId door ─────────────────────────────────

  /** An application from before PR5, with no text: written straight into the table. */
  const legacyApplication = async (settings: unknown, status: "awaiting-holder" | "voting" = "awaiting-holder") => {
    const s = await seat(`Legacy ${n}`);
    const id = `sa-${crypto.randomBytes(8).toString("hex")}`;
    await insertApplication(pool, {
      id,
      candidateUserId: "u-ana",
      proposedBy: "u-ana",
      seatIds: [s],
      note: NOTE,
      deliverables: DELIVERABLES,
      settings: settings as any,
      settingsHash: "f".repeat(64),
      termEndsAt: new Date("2029-06-30T00:00:00Z"),
      termSeasonId: "s-now",
      termFollowsSeason: false,
      startsAt: null,
      status,
    });
    return { id, seat: s };
  };

  it("a hash that is not the text's is refused, and so is a member who is not a party", async () => {
    // A pre-PR5 application the holder adopts: the village aligns, the text is written, Ana has not aligned yet.
    h.state.holders = ["u-hal"];
    const legacy = await legacyApplication(HONORARY_TERMS);
    h.state.viewer = { id: "u-hal", stage: "member" };
    expect((await h.call("POST", `/api/governance/role-applications/${legacy.id}/adopt`)).status).toBe(200);
    const text = (await textsForSubject(pool, "seat_terms", legacy.id))[0]!;
    expect((await readApplication(pool, legacy.id))!.textHash).toBe(text.contentHash);

    // Ivo is no party to these terms.
    h.state.viewer = { id: "u-ivo", stage: "member" };
    const stranger = await h.call("POST", "/api/profile/alignments", { textId: text.id, contentHash: text.contentHash });
    expect(stranger.status).toBe(403);
    expect(stranger.body.error).toBe("not_a_party");

    // Ana with the wrong hash.
    h.state.viewer = { id: "u-ana", stage: "member" };
    const wrong = await h.call("POST", "/api/profile/alignments", { textId: text.id, contentHash: "0".repeat(64) });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error).toBe("hash_mismatch");
    expect((await alignmentsOf(pool, [text.id])).map((a) => a.partyKey)).toEqual(["village"]);

    // CONTROL: Ana with the text's own hash aligns, and the terms are in force on her open seating.
    const right = await h.call("POST", "/api/profile/alignments", { textId: text.id, contentHash: text.contentHash });
    expect(right.status).toBe(201);
    expect(right.body.alignment.state).toBe("in-force");
    // A second click aligns nothing new.
    const again = await h.call("POST", "/api/profile/alignments", { textId: text.id, contentHash: text.contentHash });
    expect(again.status).toBe(200);
    expect(again.body.already).toBe(true);
  });

  it("MONEY on the textId door: stale gets the demand, fresh aligns", async () => {
    h.state.holders = ["u-hal"];
    const legacy = await legacyApplication(MONEY_TERMS);
    h.state.viewer = { id: "u-hal", stage: "member" };
    expect((await h.call("POST", `/api/governance/role-applications/${legacy.id}/adopt`)).status).toBe(200);
    const text = (await textsForSubject(pool, "seat_terms", legacy.id))[0]!;
    h.state.viewer = { id: "u-ana", stage: "member" };
    h.state.confirmedAt = { "u-ana": Date.now() - 16 * 60_000 };
    const stale = await h.call("POST", "/api/profile/alignments", { textId: text.id, contentHash: text.contentHash });
    expect(stale.status).toBe(403);
    expect(stale.body.error).toBe("reconfirm_required");
    expect((await alignmentsOf(pool, [text.id])).some((a) => a.partyKey === "user:u-ana")).toBe(false);
    await h.call("POST", "/api/profile/alignments/confirm", { password: PASSWORD });
    const fresh = await h.call("POST", "/api/profile/alignments", { textId: text.id, contentHash: text.contentHash });
    expect(fresh.status).toBe(201);
  });

  it("MONEY at the holder's adopt click: the holder aligning for the village is asked too", async () => {
    h.state.holders = ["u-hal"];
    const legacy = await legacyApplication(MONEY_TERMS);
    h.state.viewer = { id: "u-hal", stage: "member" };
    h.state.confirmedAt = {};
    const stale = await h.call("POST", `/api/governance/role-applications/${legacy.id}/adopt`);
    expect(stale.status).toBe(403);
    expect(stale.body.error).toBe("reconfirm_required");
    expect((await readApplication(pool, legacy.id))!.status).toBe("awaiting-holder");
    await h.call("POST", "/api/profile/alignments/confirm", { password: PASSWORD });
    expect((await h.call("POST", `/api/governance/role-applications/${legacy.id}/adopt`)).status).toBe(200);
  });

  // ── The village aligns ────────────────────────────────────────────────────

  it("the holder's adopt click is the village's alignment, and the terms come into force, sealed, each party told once", async () => {
    h.state.holders = ["u-hal"];
    const s = await seat("Holder adopts");
    const a = await apply({ seatIds: [s], seatSettings: HONORARY_TERMS });
    expect(a.body.status).toBe("awaiting-holder");
    h.state.viewer = { id: "u-hal", stage: "member" };
    expect((await h.call("POST", `/api/governance/role-applications/${a.body.id}/adopt`)).status).toBe(200);

    const rows = await alignmentsOf(pool, [a.body.textId]);
    const village = rows.find((r) => r.partyKey === "village")!;
    expect(village).toMatchObject({ method: "holder", userId: "u-hal", authorityRef: "org.seat@role-stewards" });
    expect(village.intentText).toBe("The village aligns with these terms for Holder adopts.");

    // In force, and each party heard once, with the seat name and a link only.
    h.state.viewer = { id: "u-ana", stage: "member" };
    const mine = (await h.call("GET", "/api/profile/alignments")).body.alignments.find((x: any) => x.textId === a.body.textId);
    expect(mine.state).toBe("in-force");
    expect(mine.sealed).toBe(true);
    const told = h.notices.filter((x) => x.dedupeKey.startsWith(`alignment:${a.body.textId}:`));
    expect(told.map((x) => [x.userId, x.dedupeKey]).sort()).toEqual([
      ["u-ana", `alignment:${a.body.textId}:user:u-ana:in-force`],
      ["u-hal", `alignment:${a.body.textId}:village:in-force`],
    ]);
    expect(told[0].title).toBe("Aligned and in force: the terms for Holder adopts");
    expect(told[0].link).toBe(`/seat-applications/${a.body.id}`);

    // The receipt verifies against the village's key, and carries the hash, never the words.
    const [seal] = await sealsOf(pool, [a.body.textId]);
    expect(verifyDocument(seal.receipt, signingKey().publicKeyPem)).toBe(true);
    expect(seal.receipt.contentHash).toBe(mine.contentHash);
    expect(JSON.stringify(seal.receipt)).not.toContain("Holder adopts");
    // CONTROL: a receipt with one byte changed does not verify.
    expect(verifyDocument({ ...seal.receipt, contentHash: "0".repeat(64) }, signingKey().publicKeyPem)).toBe(false);

    // The download hands the party their own copy, and the hash recomputes from it.
    const dl = await h.call("GET", `/api/profile/alignments/${a.body.textId}/receipt`);
    expect(dl.status).toBe(200);
    expect(verifyDocument(dl.body.receipt, dl.body.publicKey.publicKeyPem)).toBe(true);
    expect(contentHashOf(dl.body.copy)).toBe(dl.body.copy.contentHash);
    // Ivo is no party, so no receipt.
    h.state.viewer = { id: "u-ivo", stage: "member" };
    expect((await h.call("GET", `/api/profile/alignments/${a.body.textId}/receipt`)).status).toBe(403);
  });

  it("the landed ballot is the village's alignment", async () => {
    const s = await seat("Ballot adopts");
    const a = await apply({ seatIds: [s], seatSettings: HONORARY_TERMS });
    expect(a.body.status).toBe("voting");
    await land(a.body.id);
    const rows = await alignmentsOf(pool, [a.body.textId]);
    const village = rows.find((r) => r.partyKey === "village")!;
    expect(village.method).toBe("ballot");
    expect(village.userId).toBeNull();
    expect(village.authorityRef).toBe(a.body.ballot.id);
  });

  it("the closer refuses a text whose hash is not the one the application recorded", async () => {
    // The text exists; the application recorded a different hash for it.
    const legacy = await legacyApplication(HONORARY_TERMS, "voting");
    h.state.viewer = { id: "u-ana", stage: "member" };
    const page = await h.call("GET", `/api/governance/role-applications/${legacy.id}`);
    const retro = await h.call("POST", "/api/profile/alignments", { applicationId: legacy.id, words: page.body.application.alignment.body });
    expect(retro.status).toBe(201);
    const textId = retro.body.textId;
    const tampered = `sa-${crypto.randomBytes(8).toString("hex")}`;
    const original = (await readApplication(pool, legacy.id))!;
    await insertApplication(pool, { ...original, id: tampered, status: "voting", textId, textHash: "e".repeat(64) });
    const out = await adoptApplication(pool, tampered, ["voting"], { via: "ballot", ref: "bal-x", authority: "bal-x" }, {
      now: new Date(),
      lapse: { currentSeasonId: "s-now", cadence: "season_turn" },
      calendar: CALENDAR,
    });
    expect(out.outcome.kind).toBe("cannot");
    expect((await readApplication(pool, tampered))!.status).toBe("not-adopted");
    expect((await alignmentsOf(pool, [textId])).some((r) => r.partyKey === "village")).toBe(false);
    // CONTROL: the honest application, whose recorded hash matches, adopts and the village aligns.
    const honest = await adoptApplication(pool, legacy.id, ["voting"], { via: "ballot", ref: "bal-y", authority: "bal-y" }, {
      now: new Date(),
      lapse: { currentSeasonId: "s-now", cadence: "season_turn" },
      calendar: CALENDAR,
    });
    expect(honest.outcome.kind).toBe("seated");
    expect((await alignmentsOf(pool, [textId])).some((r) => r.partyKey === "village")).toBe(true);
  });

  // ── Unsealed, then sealed ─────────────────────────────────────────────────

  it("with no key the terms are in force UNSEALED, and the sweep seals them once the key is back", async () => {
    h.state.holders = ["u-hal"];
    const a = await apply({ seatIds: [await seat("Unsealed seat")], seatSettings: HONORARY_TERMS });
    resetSigningKeyForTests();
    try {
      h.state.viewer = { id: "u-hal", stage: "member" };
      await h.call("POST", `/api/governance/role-applications/${a.body.id}/adopt`);
      h.state.viewer = { id: "u-ana", stage: "member" };
      const row = (await h.call("GET", "/api/profile/alignments")).body.alignments.find((x: any) => x.textId === a.body.textId);
      expect(row.state).toBe("in-force");
      expect(row.sealed).toBe(false);
      expect(await sealsOf(pool, [a.body.textId])).toHaveLength(0);
    } finally {
      await ensureSigningKey(pool, { VILLAGE_SECRETS_KEY: "a".repeat(64) });
    }
    await settleAll({ getPool: () => pool, notify: async () => ({}), notifyAdmins: async () => {}, today: () => new Date().toISOString().slice(0, 10) });
    const [seal] = await sealsOf(pool, [a.body.textId]);
    expect(verifyDocument(seal.receipt, signingKey().publicKeyPem)).toBe(true);
  });

  // ── The retrofit ──────────────────────────────────────────────────────────

  it("RETROFIT: an application from before PR5 aligns from its stored terms", async () => {
    const legacy = await legacyApplication(HONORARY_TERMS);
    const page = await h.call("GET", `/api/governance/role-applications/${legacy.id}`);
    expect(page.status).toBe(200);
    const shown = page.body.application.alignment;
    expect(shown.retrofit).toBe(true);
    expect(shown.textId).toBeNull();
    expect(shown.you.mayAlign).toBe(true);
    expect(shown.body).toContain("Quests");
    // Words that are not the stored terms' words are refused.
    expect((await h.call("POST", "/api/profile/alignments", { applicationId: legacy.id, words: "other words" })).status).toBe(409);
    // Hal is not the candidate.
    h.state.viewer = { id: "u-hal", stage: "member" };
    expect((await h.call("POST", "/api/profile/alignments", { applicationId: legacy.id, words: shown.body })).status).toBe(403);
    h.state.viewer = { id: "u-ana", stage: "member" };
    const ok = await h.call("POST", "/api/profile/alignments", { applicationId: legacy.id, words: shown.body });
    expect(ok.status).toBe(201);
    const text = (await readText(pool, ok.body.textId))!;
    expect(text.body).toBe(shown.body);
    expect((await readApplication(pool, legacy.id))!.textHash).toBe(text.contentHash);
    // The page now reads the stored text.
    const after = (await h.call("GET", `/api/governance/role-applications/${legacy.id}`)).body.application.alignment;
    expect(after.textId).toBe(text.id);
    expect(after.you.aligned).toBe(true);
  });

  // ── Another member's list, and the export ─────────────────────────────────

  it("another member's list is for a terms.read reader, with no hash and no salt", async () => {
    const a = await apply({ seatIds: [await seat("Read by others")], seatSettings: HONORARY_TERMS });
    h.state.viewer = { id: "u-ivo", stage: "member" };
    const theirs = await h.call("GET", "/api/alignments?party=anaq");
    expect(theirs.status).toBe(200);
    const row = theirs.body.alignments.find((x: any) => x.textId === a.body.textId);
    expect(row.contentHash).toBeNull();
    expect(row.you).toBeNull();
    const text = (await readText(pool, a.body.textId))!;
    expect(JSON.stringify(theirs.body)).not.toContain(text.salt);
    expect(JSON.stringify(theirs.body)).not.toContain(text.contentHash);
    // CONTROL: Ana's own list carries the hash, so the absence above is about the reader.
    h.state.viewer = { id: "u-ana", stage: "member" };
    const mine = await h.call("GET", "/api/profile/alignments");
    expect(JSON.stringify(mine.body)).toContain(text.contentHash);
  });

  it("the export carries texts, own rows and receipts; counterparties as name and capacity only", async () => {
    h.state.holders = ["u-hal"];
    const a = await apply({ seatIds: [await seat("Exported seat")], seatSettings: HONORARY_TERMS });
    h.state.viewer = { id: "u-hal", stage: "member" };
    await h.call("POST", `/api/governance/role-applications/${a.body.id}/adopt`);
    const doc = await alignmentsForExport(pool, "u-ana", async (id) => PEOPLE[id]?.name ?? null);
    expect(Object.keys(doc).sort()).toEqual(["alignments", "receipts", "texts"]);
    const t = doc.texts.find((x) => x.textId === a.body.textId)!;
    expect(Object.keys(t).sort()).toEqual(
      ["body", "contentHash", "counterparties", "createdAt", "effectiveFrom", "effectiveTo", "redactedAt", "salt", "settings", "subjectType", "textId", "title", "version", "yourCapacity"].sort(),
    );
    expect(t.yourCapacity).toBe("individually");
    expect(t.counterparties).toEqual([{ name: "The village", capacity: "for the village" }]);
    for (const c of doc.texts.flatMap((x) => x.counterparties)) expect(Object.keys(c).sort()).toEqual(["capacity", "name"]);
    expect(doc.alignments.every((r) => r.partyKey === "user:u-ana")).toBe(true);
    expect(doc.alignments.some((r) => r.textId === a.body.textId)).toBe(true);
    expect(doc.receipts.some((r) => r.textId === a.body.textId)).toBe(true);
    // The holder's own row is in HIS export, never in Ana's: user ids name nobody else.
    expect(JSON.stringify(doc)).not.toContain("u-hal");
    expect(publicKeyBlock(signingKey()).alg).toBe("ed25519");
  });
});
