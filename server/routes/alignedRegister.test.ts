/**
 * THE ALIGNED REGISTER, OVER REAL HTTP AND A REAL SCHEMA (seat settings PR6).
 *
 * `GET /api/aligned` mounted with the member door it reads from, against the
 * scratch schema. What is pinned:
 *
 *   - a visitor and a signed-in guest get 401, and the database is never read;
 *   - a member reads every text, every version, with each party by name and
 *     capacity, the state from the store's own derivation, the day it came
 *     fully aligned in the VILLAGE'S zone, and how the village aligned (the
 *     ballot that adopted it, or the holder who aligned for it);
 *   - the content hash rides only to a party: a member who is no party reads
 *     the words and never the hash;
 *   - search ranks a money term for a member, over a per-request index;
 *   - THE CONCIERGE'S CORPUS HOLDS NO TERMS: the shelves, the village's second
 *     brain and the brief answer nothing for a word that lives only in a seat's
 *     terms, while the register finds it (the positive control), and no file
 *     the concierge reads from names the alignment store.
 *
 * Every name is fake, and every figure is in XTS, the ISO 4217 code reserved for testing.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import { civilDateKey } from "../../shared/lunar";
import { REGISTER_KINDS } from "../../shared/alignedRegister";
import type { SeatCalendar } from "../../shared/seatTerms";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { openBallotFor } from "../lib/ballots";
import type { LandingDeps, SubjectCloser } from "../lib/applyDue";
import { createOrgRole } from "../lib/orgChart";
import { readableKinds } from "../lib/alignedRegister";
import { loadShelves, rankSyntheses, relevantSections, relevantSyntheses } from "../lib/knowledge";
import { briefAll, briefIndexForPrompt } from "../lib/villageBrain";
import { ensureSigningKey, resetSigningKeyForTests } from "../lib/villageExport";
import { alignmentsOf, insertParty, insertText, partiesOf, readText } from "../repos/alignments";
import { register as registerApplications } from "./seatApplications";
import { register as registerAlignments } from "./alignments";

const LADDER = ["visitor", "guest", "member"];
const DAY = 24 * 60 * 60 * 1000;
const ROOT = path.resolve(__dirname, "../..");

const PEOPLE: Record<string, { id: string; name: string; handle: string }> = {
  "u-ana": { id: "u-ana", name: "Ana Quillfeather", handle: "anaq" },
  "u-hal": { id: "u-hal", name: "Hal Keeper", handle: "halk" },
  "u-ivo": { id: "u-ivo", name: "Ivo Lantern", handle: "ivol" },
};

/** A word that lives only in one seat's name, so only in that seat's terms. */
const SENTINEL = "Quorbelith";
const MONEY_TERMS = { v: 1, pay: { kind: "fixed", currency: "XTS", amountMinor: 4321000, per: "month" } };
const HONORARY_TERMS = { v: 1, pay: { kind: "honorary" }, quests: { perMoonMin: 2, perMoonMax: 4, doneWhenRequired: true } };
const NOTE = "I kept the orchard ledger for the whole of last season.";
const DELIVERABLES = "By the end of the season two more people can run the orchard ledger without me.";

/** Far east of UTC, so a day in the village's zone is not the day in UTC for ten hours of every day. */
const ZONE = "Pacific/Kiritimati";
const CALENDAR: SeatCalendar = {
  seasons: [{ id: "s-now", startsOn: "2026-01-01", endsOn: "2029-12-31" }],
  currentSeasonId: "s-now",
  timezone: ZONE,
};

const configured = testDbConfigured();
if (!configured) console.warn("[alignedRegister] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

function harness() {
  const state = {
    viewer: null as { id: string; stage: string } | null,
    holders: [] as string[],
    reads: 0,
    pool: (): any => {
      throw new Error("the database was read before the gate answered");
    },
  };
  const closers: Record<string, SubjectCloser> = {};
  const seen = new Set<string>();
  let server: http.Server;
  let base = "";
  // Everyone confirmed it was them a minute ago, so money terms align without the re-confirm.
  const member = (id: string) => ({
    ...(PEOPLE[id] ?? { id, name: "Someone", handle: id }),
    tokenVersion: 0,
    passwordHash: "x",
    prefs: { identityConfirmedAt: { at: Date.now() - 60_000, v: 0 } },
  });
  const notify = async (input: any) => (seen.has(input.dedupeKey) ? { inserted: false } : (seen.add(input.dedupeKey), { inserted: true })) as any;
  const notifyAdmins = async () => {};
  const ctxOf = () =>
    ({ stageIndex: LADDER.indexOf(state.viewer?.stage ?? "visitor"), stageIndexOf: (x: string) => LADDER.indexOf(x), roleCapabilities: [], villageHeld: [] }) as unknown as CapabilityCtx;
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
  const pool = () => {
    state.reads += 1;
    return state.pool();
  };

  const start = async () => {
    const app = express();
    app.use(express.json());
    const authedUser = async () => (state.viewer ? member(state.viewer.id) : null);
    const members = { byId: async (id: string) => PEOPLE[id] ?? null, update: async (id: string) => member(id) } as any;
    registerApplications(app, {
      authedUser,
      capabilityCtx: async () => ctxOf(),
      guardCapability,
      getPool: pool,
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
      getPool: pool,
      notify,
      notifyAdmins,
      overLimit: async () => false,
      members,
      confirmIdentity: async () => ({ ok: true, via: "password" }),
      googleAvailable: () => false,
      authSecret: "test-secret",
      seatCalendar: () => CALENDAR,
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
  return { state, closers, start, stop, call };
}

describe("the register refuses everyone below the member rung", () => {
  const h = harness();
  beforeAll(h.start);
  afterAll(h.stop);

  it("a visitor and a signed-in guest get 401, with no rows, and the database is never read", async () => {
    for (const viewer of [null, { id: "u-guest", stage: "guest" }]) {
      h.state.viewer = viewer;
      for (const url of ["/api/aligned", `/api/aligned?q=${SENTINEL}`, "/api/aligned?kind=seat_terms&offset=50"]) {
        const r = await h.call("GET", url);
        expect(r.status, `${viewer?.stage ?? "visitor"} ${url}`).toBe(401);
        expect(r.body).not.toHaveProperty("rows");
      }
    }
    expect(h.state.reads).toBe(0);
  });

  it("CONTROL: a member gets past the gate, which is where the database is first asked for", async () => {
    h.state.viewer = { id: "u-ivo", stage: "member" };
    const r = await h.call("GET", "/api/aligned");
    // No schema behind this harness: the read throws, so the member reached it.
    expect(r.status).toBe(500);
    expect(h.state.reads).toBeGreaterThan(0);
  });
});

describe("the kinds a viewer reads", () => {
  it("are the kinds whose capability the viewer holds, and only those", () => {
    expect(readableKinds(() => true).map((k) => k.id)).toEqual(REGISTER_KINDS.map((k) => k.id));
    expect(readableKinds(() => false)).toEqual([]);
    expect(readableKinds((c) => c === "terms.read").map((k) => k.label)).toContain("Role terms");
  });
});

describe.skipIf(!configured)("the register, on a real schema", () => {
  const h = harness();
  let db: TestDb;
  let pool: Pool;
  let n = 0;
  const made: Record<string, { id: string; textId: string; ballotId?: string }> = {};

  const seat = async (name: string) => {
    n += 1;
    return createOrgRole(pool, { id: `seat-${n}-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`, name, seats: 1 });
  };
  const apply = async (as: string, body: Record<string, unknown>) => {
    h.state.viewer = { id: as, stage: "member" };
    const full = { deliverables: DELIVERABLES, fitStatement: NOTE, seatSettings: { v: 1 }, ...body };
    const w = (await h.call("POST", "/api/governance/role-applications/words", full)).body.body;
    const r = await h.call("POST", "/api/governance/role-applications", { ...full, alignedWords: w });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    h.state.pool = () => pool;
    resetSigningKeyForTests();
    await ensureSigningKey(pool, { VILLAGE_SECRETS_KEY: "b".repeat(64) });
    await h.start();

    // Ana's money terms, adopted by the holder Hal: in force.
    h.state.holders = ["u-hal"];
    const money = await apply("u-ana", { seatIds: [await seat(`${SENTINEL} steward`)], seatSettings: MONEY_TERMS });
    h.state.viewer = { id: "u-hal", stage: "member" };
    expect((await h.call("POST", `/api/governance/role-applications/${money.id}/adopt`)).status).toBe(200);
    made.money = { id: money.id, textId: money.textId };

    // Ivo's honorary terms, adopted by the village's vote.
    h.state.holders = [];
    const honorary = await apply("u-ivo", { seatIds: [await seat("Ledger keeper")], seatSettings: HONORARY_TERMS });
    const ballot = await openBallotFor(pool, "role_application", honorary.id);
    await h.closers.role_application!.execute!(ballot!, "governance");
    made.honorary = { id: honorary.id, textId: honorary.textId, ballotId: ballot!.id };

    // Ivo's second application, still waiting on the village.
    const waiting = await apply("u-ivo", { seatIds: [await seat("Seed librarian")], seatSettings: HONORARY_TERMS });
    made.waiting = { id: waiting.id, textId: waiting.textId };

    // A second VERSION of the honorary text, as an amendment would write it (PR8).
    const v1 = (await readText(pool, honorary.textId))!;
    await insertText(pool, {
      ...v1,
      id: "at-00000000000000e2",
      version: 2,
      title: `${v1.title}, amended`,
      supersedesId: v1.id,
      contentHash: "e".repeat(64),
    });
    for (const p of await partiesOf(pool, [v1.id])) await insertParty(pool, { ...p, textId: "at-00000000000000e2" });
  });

  afterAll(async () => {
    await h.stop();
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    h.state.viewer = { id: "u-hal", stage: "member" };
  });

  const rowOf = (body: any, textId: string) => body.rows.find((r: any) => r.textId === textId);

  it("a member reads every text and every version, newest first, with no count", async () => {
    const r = await h.call("GET", "/api/aligned");
    expect(r.status).toBe(200);
    expect(r.body.kinds).toEqual([
      { id: "seat_terms", label: "Role terms" },
      // Seat settings PR9 turned the letter on.
      { id: "membership", label: "Membership letter" },
    ]);
    const ids = r.body.rows.map((x: any) => x.textId);
    for (const t of [made.money.textId, made.honorary.textId, made.waiting.textId, "at-00000000000000e2"]) expect(ids).toContain(t);
    expect(rowOf(r.body, made.honorary.textId).version).toBe(1);
    expect(rowOf(r.body, "at-00000000000000e2").version).toBe(2);
    expect(r.body.more).toBe(false);
    expect(JSON.stringify(Object.keys(r.body))).not.toMatch(/count|total/i);
    // Paging: one row a page, and `more` says so without a number.
    const first = await h.call("GET", "/api/aligned?limit=1");
    expect(first.body.rows).toHaveLength(1);
    expect(first.body.more).toBe(true);
    const second = await h.call("GET", "/api/aligned?limit=1&offset=1");
    expect(second.body.rows[0].textId).not.toBe(first.body.rows[0].textId);
  });

  it("each row: parties by name and capacity, the derived state, the day in the village's zone, and how the village aligned", async () => {
    const r = await h.call("GET", "/api/aligned");
    const money = rowOf(r.body, made.money.textId);
    expect(money.kindLabel).toBe("Role terms");
    expect(money.state).toBe("in-force");
    expect(money.money).toBe(true);
    expect(money.parties.map((p: any) => [p.label, p.capacity, p.aligned])).toEqual(
      expect.arrayContaining([
        ["Ana Quillfeather", "individually", true],
        ["The village", "for the village", true],
      ]),
    );
    expect(money.village).toEqual({ by: "holder", name: "Hal Keeper" });
    // The day it came fully aligned, in the village's zone: the later of the two alignments.
    const rows = await alignmentsOf(pool, [made.money.textId]);
    const last = rows.map((x) => x.at).sort((a, b) => b.getTime() - a.getTime())[0];
    expect(money.alignedOn).toBe(civilDateKey(last, ZONE));
    expect(money.year).toBe(money.writtenOn.slice(0, 4));

    const honorary = rowOf(r.body, made.honorary.textId);
    expect(honorary.village).toEqual({ by: "ballot", ballotId: made.honorary.ballotId, href: `/decisions/${made.honorary.ballotId}` });

    const waiting = rowOf(r.body, made.waiting.textId);
    expect(waiting.state).toBe("pending");
    expect(waiting.alignedOn).toBeNull();
    expect(waiting.village).toBeNull();
    expect(waiting.parties.find((p: any) => p.partyKey === "village").aligned).toBe(false);
  });

  it("A NON-PARTY SEES NO HASH; a party sees their own and nobody else's", async () => {
    const texts = await Promise.all([made.money.textId, made.honorary.textId].map((id) => readText(pool, id)));
    // Hal aligned FOR the village, which makes him no party: the village is.
    h.state.viewer = { id: "u-hal", stage: "member" };
    const hal = await h.call("GET", "/api/aligned");
    for (const row of hal.body.rows) expect(row.contentHash, row.textId).toBeNull();
    for (const t of texts) {
      expect(JSON.stringify(hal.body)).not.toContain(t!.contentHash);
      expect(JSON.stringify(hal.body)).not.toContain(t!.salt);
    }
    // CONTROL: Ana is a party to her own terms and reads that hash, and only that one.
    h.state.viewer = { id: "u-ana", stage: "member" };
    const ana = await h.call("GET", "/api/aligned");
    expect(rowOf(ana.body, made.money.textId).contentHash).toBe(texts[0]!.contentHash);
    expect(rowOf(ana.body, made.honorary.textId).contentHash).toBeNull();
    expect(JSON.stringify(ana.body)).not.toContain(texts[1]!.contentHash);
    // The same holds for a search.
    h.state.viewer = { id: "u-hal", stage: "member" };
    const found = await h.call("GET", `/api/aligned?q=${SENTINEL}`);
    expect(found.body.rows.length).toBeGreaterThan(0);
    for (const row of found.body.rows) expect(row.contentHash).toBeNull();
  });

  it("SEARCH ranks a money term for a member", async () => {
    const r = await h.call("GET", "/api/aligned?q=XTS%20a%20month");
    expect(r.status).toBe(200);
    expect(r.body.query).toBe("XTS a month");
    expect(r.body.rows[0]?.textId).toBe(made.money.textId);
    // Honorary terms carry no currency, so they never outrank the money.
    const ids = r.body.rows.map((x: any) => x.textId);
    expect(ids.indexOf(made.honorary.textId) === -1 || ids.indexOf(made.honorary.textId) > 0).toBe(true);
    // A seat name ranks its own terms, and a word in nothing finds nothing.
    expect((await h.call("GET", "/api/aligned?q=ledger%20keeper")).body.rows[0].seatNames).toEqual(["Ledger keeper"]);
    expect((await h.call("GET", "/api/aligned?q=xylophonic")).body.rows).toEqual([]);
  });

  it("an unknown kind is refused, and the one kind there is filters to itself", async () => {
    expect((await h.call("GET", "/api/aligned?kind=nothing")).status).toBe(400);
    const r = await h.call("GET", "/api/aligned?kind=seat_terms");
    expect(r.status).toBe(200);
    expect(r.body.rows.every((x: any) => x.kind === "seat_terms")).toBe(true);
  });

  // ── The concierge's corpus holds no terms ─────────────────────────────────

  it("THE CONCIERGE'S CORPUS HOLDS NO TERMS: shelves, second brain and brief answer nothing for a word only terms carry", async () => {
    // POSITIVE CONTROL, the store: the word is in the alignment store, and the register finds it.
    const found = await h.call("GET", `/api/aligned?q=${SENTINEL}`);
    expect(found.body.rows.map((r: any) => r.textId)).toContain(made.money.textId);

    // The shared brain: shelves loaded from the repository, as the server does at boot.
    const loaded = loadShelves(ROOT);
    expect(loaded.knowledge + loaded.modules).toBeGreaterThan(0);
    // POSITIVE CONTROL, the shelves: they answer a question they hold.
    expect(relevantSections("sociocracy consent circle").length).toBeGreaterThan(0);
    expect(relevantSections(`${SENTINEL} steward XTS`).map((s) => s.body).join("\n")).not.toContain(SENTINEL);

    // The village's second brain: the call syntheses, read from this same schema.
    expect(await relevantSyntheses(pool, SENTINEL, 10)).toEqual([]);
    // POSITIVE CONTROL, the ranker: it finds the word when a synthesis does carry it.
    const synth = rankSyntheses([{ body: `We talked about the ${SENTINEL} steward.`, title: "A call", recorded_at: new Date() } as any], SENTINEL, 3);
    expect(synth).toHaveLength(1);

    // The brief the concierge folds into its prompt.
    expect(JSON.stringify(await briefAll(pool, "admin"))).not.toContain(SENTINEL);
    expect(await briefIndexForPrompt(pool, 4000)).not.toContain(SENTINEL);
  });

  it("no file the concierge reads from names the alignment store or the register", () => {
    const CORPUS = [
      "server/lib/knowledge.ts",
      "server/lib/villageBrain.ts",
      "server/lib/villageReaders.ts",
      "server/lib/callSynthesis.ts",
      "server/lib/assistant.ts",
      "server/lib/assistantRouter.ts",
      "server/lib/assistantTemplates.ts",
      "server/lib/intents.ts",
    ];
    const STORE = /\b(?:alignment_texts|alignment_parties|alignment_seals|alignments)\b|repos\/alignments|alignmentSubjects|alignedRegister/;
    const code = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const f of CORPUS) expect(code(f), f).not.toMatch(STORE);
    // CONTROL: the scan finds the store where it is, and finds the register reaching for the shelves' helpers.
    expect(code("server/repos/alignments.ts")).toMatch(STORE);
    expect(code("server/lib/alignedRegister.ts")).toMatch(/from "\.\/knowledge"/);
  });
});
