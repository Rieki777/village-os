/**
 * THE CASH BUDGET'S DOORS, ON A REAL SCHEMA (server/routes/budgets.ts).
 *
 *   R21  one door for every write: a live holder of role.pay writes as their
 *        role; an admin writes before the launch vote and only while nobody
 *        holds the power; after launch with nobody holding it, or with the
 *        village holding it, the write is refused with the suggestion path
 *        named; so is a payee conflict and a warning badge's deny
 *   R22  the `budget_lines` suggestion control: a holder's Accept and a
 *        carried vote both apply through importBudgetLines, stale and payee
 *        conflicts refused
 *   R23  every member reads; committed and spent below the village total only
 *        for cash.pay holders; guests and former members read nothing; no
 *        account id ever leaves
 *
 * Driven against a fake Express, with the gate's context, the holders and the
 * launch handed in. The vote engine's `openBallot` is the one thing stubbed.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const opened: any[] = [];
vi.mock("../lib/ballots", async (orig) => ({
  ...(await orig<typeof import("../lib/ballots")>()),
  openBallot: async (_pool: unknown, input: any) => {
    opened.push(input);
    return { ok: true, ballot: { id: `bal-${opened.length}`, closesAt: new Date("2026-12-01T00:00:00Z"), title: input.title, openedBy: input.openedBy, subjectRef: input.subjectRef } };
  },
}));

import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { register as registerBudgets } from "./budgets";
import { register as registerSuggestions } from "./adminSuggestions";
import { adminGateWasConsulted } from "../lib/adminGate";
import { ADMIN_BEFORE_LAUNCH, BY_VILLAGE_VOTE } from "../../shared/budgets";
import { ADMIN_EDIT } from "../../shared/ballotSubjects";
import { resetBudgetEnv, configureBudgets } from "../lib/budgets";
import { cashKeys } from "../lib/cashOwed";
import { insertCashOwedRow } from "../repos/cashOwed";
import { createOrgRole } from "../lib/orgChart";
import { LUNAR_CLOCK } from "../../shared/cycleClock";
import type { SubjectCloser } from "../lib/applyDue";
import type { SuggestionRow, SuggestionStatus, SuggestionStore } from "../repos/adminSuggestions";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;
const configured = testDbConfigured();
const MOON = LUNAR_CLOCK.boundsFor(new Date()).id;
const STAGES = ["visitor", "guest", "member", "co-creator"];
const USERS: Record<string, any> = {
  "u-sam": { id: "u-sam", name: "Sam Rivers", stage: "member" },
  "u-gil": { id: "u-gil", name: "Gil Guest", stage: "guest" },
  "u-fay": { id: "u-fay", name: "Fay Former", stage: "member", former: true },
  "u-hana": { id: "u-hana", name: "Hana Holder", stage: "member", caps: ["role.pay"] },
  "u-hugo": { id: "u-hugo", name: "Hugo Holder", stage: "co-creator", caps: ["role.pay"] },
  "u-dee": { id: "u-dee", name: "Dee Denied", stage: "member", caps: ["role.pay"], denies: ["role.pay"] },
  "u-cass": { id: "u-cass", name: "Cass Cash", stage: "member", caps: ["cash.pay"] },
  "u-ada": { id: "u-ada", name: "Ada Admin", stage: "member", role: "admin" },
};

let db: TestDb;
let pool: mysql.Pool;
let handlers: Map<string, Handler>;
let holders: Record<string, string[]>;
let villageHeld: string[];
let launched: boolean;
let seats: Record<string, string[]>;
let store: ReturnType<typeof memoryStore>;
let closers: Record<string, SubjectCloser>;

function memoryStore(): SuggestionStore & { rows: SuggestionRow[] } {
  const rows: SuggestionRow[] = [];
  let n = 0;
  return {
    rows,
    async create(input) {
      const row: SuggestionRow = { id: `sugg-${++n}`, edit: input.edit, why: input.why, suggestedBy: input.suggestedBy, suggestedAt: new Date(), status: "proposed", decidedBy: null, decidedAt: null, note: null, ballotId: null };
      rows.push(row);
      return { ...row };
    },
    async byId(id) {
      const r = rows.find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    async withStatus(status) {
      return rows.filter((r) => r.status === status).map((r) => ({ ...r }));
    },
    async bySuggester(userId) {
      return rows.filter((r) => r.suggestedBy === userId).map((r) => ({ ...r }));
    },
    async move(id, from: SuggestionStatus, to: SuggestionStatus, fields) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.status !== from) return false;
      r.status = to;
      r.decidedBy = fields.decidedBy ?? null;
      r.note = fields.note ?? null;
      r.ballotId = fields.ballotId ?? null;
      return true;
    },
  };
}

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows as any[];
}

const ctxOf = async (u: any) => ({
  stageIndex: STAGES.indexOf(u.stage),
  stageIndexOf: (id: string) => STAGES.indexOf(id),
  roleCapabilities: u.caps ?? [],
  badgeDenies: u.denies ?? [],
  isAdmin: u.role === "admin",
  villageHeld,
});

function wire() {
  handlers = new Map();
  const record = (method: string) => (path: string, h: Handler) => void handlers.set(`${method} ${path}`, h);
  const app = { get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE") } as any;
  const common = {
    authedUser: async (req: any) => req.user ?? null,
    capabilityCtx: ctxOf,
    getPool: () => pool,
    overLimit: async () => false,
    liveHoldersOf: async (cap: string) => [...(holders[cap] ?? [])],
  };
  registerBudgets(app, {
    ...common,
    seasonState: () => ({ current: null, seasons: [], timezone: "UTC" }),
    projectCurrency: () => "CRC",
    rolesCarrying: (cap: string) => (cap === "role.pay" ? [{ id: "role-treasury", name: "Treasury" }] : []),
    roleHolders: () => [{ roleId: "role-treasury", userId: "u-hana" }, { roleId: "role-treasury", userId: "u-hugo" }],
    launched: async () => launched,
    isFormerMember: async (u: any) => !!u.former,
    seatedRoleIds: async (uid: string) => seats[uid] ?? [],
  } as any);
  store = memoryStore();
  closers = {};
  registerSuggestions(app, {
    ...common,
    guardCapability: async (req: any, res: any, key: string) => {
      const ok = (holders[key] ?? []).includes(req.user?.id);
      if (!ok) res.status(403).json({ error: "forbidden" });
      return ok;
    },
    notify: async () => undefined,
    members: { byId: async (id: string) => USERS[id] ?? null },
    firstName: (name: string) => name.split(/\s+/)[0],
    ballotSetup: async () => ({ method: "majority", dials: { unityPct: 50, quorumPct: 30 }, snapshot: { mode: "equal", token: null }, tokenProblem: null, electorate: [{ userId: "u-sam", weight: 1 }], durationDays: 7 }),
    notifyRoll: async () => 1,
    governanceOn: () => true,
    closers,
    store,
    isFormerMember: async (u: any) => !!u.former,
  } as any);
}

async function call(method: string, path: string, user: string | null, body: unknown = {}, params: Record<string, string> = {}, query: Record<string, string> = {}) {
  const out: { status: number; body: any; gated: boolean } = { status: 200, body: undefined, gated: false };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(b: any) {
      out.body = b;
      return res;
    },
  };
  const req: any = { user: user ? USERS[user] : null, body, params, query, headers: {}, get: () => undefined };
  const h = handlers.get(`${method} ${path}`);
  if (!h) throw new Error(`no handler for ${method} ${path}`);
  await h(req, res);
  out.gated = adminGateWasConsulted(req);
  return out;
}

const ROW = { period: MOON, category: "role_pay", label: "Garden crew pay", planned: "100,000" };
const FORMAT = { locale: "en", chosen: true };
const importAs = async (user: string, lines: unknown[] = [ROW]) => {
  const p = await call("POST", "/api/admin/budgets/import", user, { lines, format: FORMAT, dryRun: true });
  const c = await call("POST", "/api/admin/budgets/import", user, { lines, format: FORMAT, dryRun: false, revision: p.body?.revision });
  return { p, c };
};
const stored = () => q("SELECT label, status, planned_minor, spent_minor, changed_by, changed_as FROM budget_lines ORDER BY label");

describe.skipIf(!configured)("the cash budget's doors", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await q("INSERT INTO circles (id, name) VALUES ('c-garden', 'Garden')");
    await createOrgRole(pool, { id: "r-gardener", name: "Gardener", circleId: "c-garden", seats: 1 });
  }, 180_000);

  afterAll(async () => {
    resetBudgetEnv();
    await pool?.end();
    await db?.drop?.();
  });

  beforeEach(async () => {
    for (const t of ["budget_lines", "budget_syncs", "cash_owed", "fx_rates", "budget_period_notes"]) await q(`DELETE FROM \`${t}\``);
    resetBudgetEnv();
    holders = { "role.pay": ["u-hana", "u-hugo"], "cash.pay": ["u-cass"] };
    villageHeld = [];
    launched = true;
    seats = {};
    opened.length = 0;
    wire();
    configureBudgets({ currentMoonId: () => MOON });
  });

  // ── The door (R21) ────────────────────────────────────────────────────────

  it("lets a live holder write, recorded as the role they hold the power through, and marks the admin gate", async () => {
    const { p, c } = await importAs("u-hana");
    expect(p.status).toBe(200);
    expect(p.gated, "markAdminGate ran for the default-deny under /api/admin").toBe(true);
    expect(p.body.door).toEqual({ mayWrite: true, via: "holder" });
    expect(c.status).toBe(200);
    expect(c.body.written).toBe(true);
    expect(await stored()).toEqual([{ label: "Garden crew pay", status: "approved", planned_minor: 10_000_000, spent_minor: null, changed_by: "u-hana", changed_as: "Treasury" }]);
  });

  it("lets an admin write before the launch vote while nobody holds the power, and says so", async () => {
    holders = { "role.pay": [] };
    launched = false;
    const { p, c } = await importAs("u-ada");
    expect(p.body.door).toEqual({ mayWrite: true, via: "admin_before_launch" });
    expect(c.status).toBe(200);
    expect((await stored())[0]).toMatchObject({ changed_by: "u-ada", changed_as: ADMIN_BEFORE_LAUNCH });
  });

  it("refuses the admin after launch with nobody holding the power, naming the suggestion path, and writes nothing", async () => {
    holders = { "role.pay": [] };
    const { p, c } = await importAs("u-ada");
    expect(p.status, "the preview still works, and says what the door would answer").toBe(200);
    expect(p.body.door).toMatchObject({ mayWrite: false, code: "nobody_holds_it", suggest: { path: "/api/admin/suggestions", control: "budget_lines" } });
    expect(c.status).toBe(409);
    expect(c.body).toMatchObject({ code: "nobody_holds_it", suggest: { path: "/api/admin/suggestions", control: "budget_lines" } });
    expect(await stored()).toEqual([]);
  });

  it("refuses everybody but the looking-after role when the village holds the power, the admin included", async () => {
    villageHeld = ["role.pay"];
    holders = { "role.pay": [] };
    launched = false;
    const { c } = await importAs("u-ada");
    expect(c.status).toBe(409);
    expect(c.body).toMatchObject({ code: "village_holds_it", suggest: { control: "budget_lines" } });
    expect(await stored()).toEqual([]);
  });

  it("refuses a member who does not hold the power, and an admin while somebody else holds it, with the suggestion path", async () => {
    const member = await importAs("u-sam");
    expect(member.p.body.door).toMatchObject({ mayWrite: false, code: "holders_only" });
    expect(member.c.status).toBe(403);
    expect(member.c.body).toMatchObject({ code: "holders_only", suggest: { path: "/api/admin/suggestions" } });
    launched = false;
    const admin = await importAs("u-ada");
    expect(admin.c.status, "an admin is no exception while a role holds the power").toBe(403);
    expect(await stored()).toEqual([]);
  });

  it("refuses a holder a warning badge denies the power to", async () => {
    holders = { "role.pay": ["u-hana", "u-dee"] };
    const { c } = await importAs("u-dee");
    expect(c.status).toBe(403);
    expect(c.body).toMatchObject({ code: "denied", suggest: { control: "budget_lines" } });
    expect(await stored()).toEqual([]);
  });

  it("refuses a payee conflict: a line naming a role the writer is seated in goes to the village", async () => {
    seats = { "u-hana": ["r-gardener"] };
    const lines = [{ ...ROW, label: "Gardener pay", circle: "Garden", role: "Gardener" }];
    const { p, c } = await importAs("u-hana", lines);
    expect(p.body.door).toMatchObject({ mayWrite: false, code: "payee_conflict", suggest: { control: "budget_lines" } });
    expect(c.status).toBe(409);
    expect(c.body.code).toBe("payee_conflict");
    expect(await stored()).toEqual([]);
    // Another holder, not seated there, writes it.
    expect((await importAs("u-hugo", lines)).c.status).toBe(200);
  });

  it("previews for every member at the member rung, and for nobody below it or gone", async () => {
    expect((await call("POST", "/api/admin/budgets/import", null, { lines: [ROW] })).status).toBe(401);
    expect((await call("POST", "/api/admin/budgets/import", "u-gil", { lines: [ROW] })).status).toBe(403);
    expect((await call("POST", "/api/admin/budgets/import", "u-fay", { lines: [ROW] })).status).toBe(403);
    expect((await call("POST", "/api/admin/budgets/import", "u-sam", { lines: [ROW], format: FORMAT })).status).toBe(200);
  });

  it("adds, edits, withdraws and restores one line through the same door", async () => {
    const add = await call("POST", "/api/admin/budgets/lines", "u-hana", { line: ROW, format: FORMAT });
    const added = await call("POST", "/api/admin/budgets/lines", "u-hana", { line: ROW, format: FORMAT, dryRun: false, revision: add.body.revision });
    expect(added.status).toBe(200);
    const id = added.body.lineIds[0];
    const edit = await call("PATCH", "/api/admin/budgets/lines/:id", "u-hana", { changes: { planned: "80,000" }, format: FORMAT }, { id });
    expect((await call("PATCH", "/api/admin/budgets/lines/:id", "u-hana", { changes: { planned: "80,000" }, format: FORMAT, dryRun: false, revision: edit.body.revision }, { id })).status).toBe(200);
    expect((await stored())[0].planned_minor).toBe(8_000_000);
    expect((await call("POST", "/api/admin/budgets/lines/:id/withdraw", "u-hana", {}, { id })).status).toBe(200);
    expect((await stored())[0].status).toBe("withdrawn");
    expect((await call("POST", "/api/admin/budgets/lines/:id/withdraw", "u-sam", {}, { id })).status, "the same door for a withdrawal").toBe(403);
    expect((await call("POST", "/api/admin/budgets/lines/:id/restore", "u-hana", {}, { id })).status).toBe(200);
    expect((await stored())[0].status).toBe("approved");
    expect((await call("PATCH", "/api/admin/budgets/lines/:id", "u-hana", { changes: { planned: "1" }, format: FORMAT }, { id: "bl-nowhere" })).status).toBe(404);
    expect((await call("POST", "/api/admin/budgets/lines/:id/withdraw", "u-hana", {}, { id: "bl-nowhere" })).status).toBe(404);
  });

  // ── Reading (R23) ─────────────────────────────────────────────────────────

  it("lets every member read the lines and the village total, and keeps committed parts and spent to cash.pay holders", async () => {
    await importAs("u-hana", [{ ...ROW, spent: "1,000" }]);
    await insertCashOwedRow(pool, { id: "co-1", occurrenceKey: cashKeys.role(MOON, "seat-1", "u-hana"), userId: "u-hana", workKind: "role", workRef: "r", workTitle: "r", amountMinor: 5000, currency: "CRC" });
    const member = await call("GET", "/api/budgets", "u-sam", {}, {}, { moon: MOON });
    expect(member.status).toBe(200);
    expect(member.body.lines.map((l: any) => [l.label, l.plannedMinor, l.spentMinor, l.changedAs])).toEqual([["Garden crew pay", 10_000_000, null, "Treasury"]]);
    expect(member.body.figure).toMatchObject({ plannedMinor: 10_000_000, committedMinor: 5000, leftMinor: 10_000_000 - 5000 });
    expect(member.body.figure.working.committed, "the parts come from cash_owed, which is holder-only").toBeNull();
    expect(member.body.mayReadCash).toBe(false);
    expect(JSON.stringify(member.body), "no account id leaves, never a changed_by").not.toContain("u-hana");
    expect(JSON.stringify(member.body)).not.toContain("changedBy");

    const cash = await call("GET", "/api/budgets", "u-cass", {}, {}, { moon: MOON });
    expect(cash.body.lines[0].spentMinor).toBe(100_000);
    expect(cash.body.figure.working.committed).toMatchObject({ roleMinor: 5000 });

    expect((await call("GET", "/api/budgets", "u-gil")).status, "a guest reads nothing").toBe(403);
    expect((await call("GET", "/api/budgets", "u-fay")).status, "a former member reads nothing").toBe(403);
    expect((await call("GET", "/api/budgets", null)).status).toBe(401);
    expect((await call("GET", "/api/budgets", "u-sam", {}, {}, { moon: "next week" })).status).toBe(400);
  });

  it("reads null as no budget, and says so apart from a budget with nothing left", async () => {
    expect((await call("GET", "/api/budgets", "u-sam", {}, {}, { moon: MOON })).body.figure).toBeNull();
    await importAs("u-hana", [{ ...ROW, planned: "1" }]);
    await insertCashOwedRow(pool, { id: "co-2", occurrenceKey: cashKeys.role(MOON, "seat-1", "u-hugo"), userId: "u-hugo", workKind: "role", workRef: "r", workTitle: "r", amountMinor: 999, currency: "CRC" });
    expect((await call("GET", "/api/budgets", "u-sam", {}, {}, { moon: MOON })).body.figure).toMatchObject({ leftMinor: 0 });
  });

  // ── A rate a person locks (spec 5a, option b) ─────────────────────────────

  const storeDaily = async (usd = 1, crc = 500) => {
    const day = new Date().toISOString().slice(0, 10);
    await q("INSERT INTO fx_rates (quote, rate, as_of, source) VALUES ('USD', ?, ?, 'ecb'), ('CRC', ?, ?, 'ecb') ON DUPLICATE KEY UPDATE rate = VALUES(rate)", [usd, day, crc, day]);
  };
  const usdLine = async (label: string, planned = "1,200.00") => (await importAs("u-hana", [{ ...ROW, label, currency: "USD", planned }])).c.body.lineIds[0] as string;
  const fxOf = async (id: string) => (await q("SELECT fx_rate, fx_source, fx_locked_by FROM budget_lines WHERE id = ?", [id]))[0];

  it("locks a rate on one line in one press through the same door, re-locks it, and locks many with a preview bound by revision", async () => {
    await storeDaily();
    const a = await usdLine("A dollars");
    const b = await usdLine("B dollars", "300.00");
    const refused = await call("POST", "/api/admin/budgets/lines/:id/lock-rate", "u-sam", { use: "provider" }, { id: a });
    expect(refused.status, "the R21 door: a member who does not hold the power").toBe(403);
    expect(refused.body.suggest).toMatchObject({ control: "budget_lines" });
    const one = await call("POST", "/api/admin/budgets/lines/:id/lock-rate", "u-hana", { use: "provider" }, { id: a });
    expect(one.status).toBe(200);
    expect(one.gated).toBe(true);
    expect(await fxOf(a)).toEqual({ fx_rate: "500.00000000", fx_source: "daily rate, open.er-api.com", fx_locked_by: "u-hana" });
    expect((await call("POST", "/api/admin/budgets/lines/:id/lock-rate", "u-hana", { rate: "512.25", sourceNote: "Bank quote, 9 Nov" }, { id: a })).status).toBe(200);
    expect(await fxOf(a)).toMatchObject({ fx_rate: "512.25000000", fx_source: "typed: Bank quote, 9 Nov" });
    expect((await call("POST", "/api/admin/budgets/lines/:id/lock-rate", "u-hana", { use: "provider" }, { id: "bl-nowhere" })).status).toBe(404);

    const p = await call("POST", "/api/admin/budgets/lock-rates", "u-hana", { ids: [a, b], use: "provider" });
    expect(p.status).toBe(200);
    expect(p.body.changed.map((c: any) => [c.label, c.convertedMinor])).toEqual([["A dollars", 60_000_000], ["B dollars", 15_000_000]]);
    expect((await fxOf(b)).fx_rate, "a preview locks nothing").toBeNull();
    expect((await call("POST", "/api/admin/budgets/lock-rates", "u-hana", { ids: [a, b], use: "provider", dryRun: false, revision: "old" })).status).toBe(409);
    expect((await call("POST", "/api/admin/budgets/lock-rates", "u-hana", { ids: [a, b], use: "provider", dryRun: false, revision: p.body.revision })).status).toBe(200);
    expect((await fxOf(b)).fx_rate).toBe("500.00000000");
  });

  it("shows every member a locked line's rate, source, date and the role that locked it, never the account, and the drift at today's rate", async () => {
    await storeDaily(1, 530);
    const a = await usdLine("A dollars");
    await call("POST", "/api/admin/budgets/lines/:id/lock-rate", "u-hana", { rate: "500", sourceNote: "Bank quote, 9 Nov" }, { id: a });
    const read = await call("GET", "/api/budgets", "u-sam", {}, {}, { moon: MOON });
    expect(read.status).toBe(200);
    expect(read.body.lines[0]).toMatchObject({ currency: "USD", plannedMinor: 120_000, convertedMinor: 60_000_000 });
    expect(read.body.lines[0].fx).toMatchObject({ rate: "500.00000000", source: "typed: Bank quote, 9 Nov", lockedAs: "Treasury" });
    expect(read.body.figure.plannedMinor).toBe(60_000_000);
    expect(read.body.figure.working.lines[0].fx).toMatchObject({ rate: "500.00000000", lockedAs: "Treasury" });
    expect(read.body.figure.working.lines[0].fx.lockedBy).toBeUndefined();
    expect(read.body.drift).toEqual([expect.objectContaining({ id: a, lockedMinor: 60_000_000, todayMinor: 63_600_000, pct: 6, overThreshold: true })]);
    expect(read.body.driftWarning).toBe(true);
    expect(JSON.stringify(read.body), "no account id leaves").not.toContain("u-hana");
  });

  // ── Provenance, moons ahead, where it goes and period notes (v0.3, R29 to R32) ──

  it("names the newest import per source with its label, shows its link only to the door and cash.pay holders, and dates each header figure", async () => {
    const body = { lines: [ROW], format: FORMAT, sourceLabel: "November budget sheet", sourceLink: "https://sheets.example.test/november" };
    const p = await call("POST", "/api/admin/budgets/import", "u-hana", body);
    expect((await call("POST", "/api/admin/budgets/import", "u-hana", { ...body, dryRun: false, revision: p.body.revision })).status).toBe(200);
    const member = await call("GET", "/api/budgets", "u-sam", {}, {}, { moon: MOON });
    expect(member.body.syncs).toEqual([expect.objectContaining({ source: "upload", sourceLabel: "November budget sheet", sourceLink: null })]);
    expect(JSON.stringify(member.body), "a private sheet's address is not every member's to open").not.toContain("sheets.example.test");
    expect(member.body.asOf.planned).toEqual(expect.any(String));
    expect(member.body.asOf.committed).toBeNull();
    expect(member.body.asOf.left).toBe(member.body.asOf.planned);
    for (const who of ["u-cass", "u-hana"]) {
      const read = await call("GET", "/api/budgets", who, {}, {}, { moon: MOON });
      expect(read.body.syncs[0].sourceLink, who).toBe("https://sheets.example.test/november");
    }
  });

  it("shows every member the moon's planned amount per circle, village-wide lines as their own entry", async () => {
    await importAs("u-hugo", [ROW, { ...ROW, label: "Gardener pay", circle: "Garden", role: "Gardener", planned: "50,000" }, { ...ROW, label: "Garden tools", circle: "Garden", category: "materials", planned: "1,000" }]);
    const read = await call("GET", "/api/budgets", "u-sam", {}, {}, { moon: MOON });
    expect(read.body.byCircle).toEqual([
      { circleId: null, circleName: null, byCategory: { role_pay: 10_000_000, quest_pay: 0, materials: 0, other: 0 }, totalMinor: 10_000_000 },
      { circleId: "c-garden", circleName: "Garden", byCategory: { role_pay: 5_000_000, quest_pay: 0, materials: 100_000, other: 0 }, totalMinor: 5_100_000 },
    ]);
  });

  it("reads one to twelve moons ahead for every member, committed only for the current moon", async () => {
    await importAs("u-hana");
    const a = await call("GET", "/api/budgets/ahead", "u-sam", {}, {}, { from: MOON, count: "3" });
    expect(a.status).toBe(200);
    expect(a.body.moons).toHaveLength(3);
    expect(a.body.moons[0]).toMatchObject({ moonId: MOON, totalMinor: 10_000_000, committedMinor: 0 });
    expect(a.body.moons[1].committedMinor).toBeNull();
    for (const count of ["0", "13", "two"]) expect((await call("GET", "/api/budgets/ahead", "u-sam", {}, {}, { from: MOON, count })).status, count).toBe(400);
    expect((await call("GET", "/api/budgets/ahead", "u-sam", {}, {}, { from: "next week", count: "3" })).status).toBe(400);
    expect((await call("GET", "/api/budgets/ahead", "u-gil", {}, {}, { from: MOON, count: "3" })).status).toBe(403);
    expect((await call("GET", "/api/budgets/ahead", null, {}, {}, { from: MOON, count: "3" })).status).toBe(401);
  });

  it("keeps a note per period through the same door, checked for names, read by every member by role and never by account", async () => {
    const path = "/api/admin/budgets/notes/:period";
    expect((await call("PUT", path, "u-sam", { note: "Late harvest" }, { period: MOON })).status, "the R21 door").toBe(403);
    expect((await call("PUT", path, "u-hana", { note: "Write to sam@example.test" }, { period: MOON })).status).toBe(400);
    const ok = await call("PUT", path, "u-hana", { note: "The harvest pays out late this moon." }, { period: MOON });
    expect(ok.status).toBe(200);
    expect(ok.gated).toBe(true);
    const read = await call("GET", "/api/budgets", "u-sam", {}, {}, { moon: MOON });
    expect(read.body.note).toEqual({ periodKey: MOON, note: "The harvest pays out late this moon.", changedAt: expect.any(String), changedAs: "Treasury" });
    const ahead = await call("GET", "/api/budgets/ahead", "u-sam", {}, {}, { from: MOON, count: "1" });
    expect(ahead.body.moons[0].note).toMatchObject({ note: "The harvest pays out late this moon.", changedAs: "Treasury" });
    expect(JSON.stringify(read.body) + JSON.stringify(ahead.body)).not.toContain("u-hana");
  });

  // ── The suggestion control (R22) ──────────────────────────────────────────

  const suggest = async (user: string, lines: unknown[] = [ROW]) => {
    const read = await call("GET", "/api/budgets", user, {}, {}, { moon: MOON });
    return call("POST", "/api/admin/suggestions", user, { control: "budget_lines", payload: { source: "upload", lines, format: FORMAT }, why: "The garden needs it", was: read.body.stateRevision });
  };

  it("sends a member's suggestion to the holders, and a holder's Accept writes it through importBudgetLines", async () => {
    const made = await suggest("u-sam");
    expect(made.status).toBe(201);
    expect(made.body.route).toBe("holders");
    expect(await stored(), "a suggestion changes nothing").toEqual([]);
    const accepted = await call("POST", "/api/admin/suggestions/:id/accept", "u-hana", {}, { id: made.body.suggestion.id });
    expect(accepted.status).toBe(200);
    expect(await stored()).toEqual([{ label: "Garden crew pay", status: "approved", planned_minor: 10_000_000, spent_minor: null, changed_by: "u-hana", changed_as: "Treasury" }]);
    expect((await q("SELECT source, `by`, ok FROM budget_syncs"))[0]).toEqual({ source: "upload", by: "u-hana", ok: 1 });
  });

  it("refuses an Accept once the budget moved under the suggestion, and one that touches the accepter's own role", async () => {
    const made = await suggest("u-sam");
    await importAs("u-hugo", [{ ...ROW, label: "Something else" }]);
    const stale = await call("POST", "/api/admin/suggestions/:id/accept", "u-hana", {}, { id: made.body.suggestion.id });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("stale");

    seats = { "u-hana": ["r-gardener"] };
    const mine = await suggest("u-sam", [{ ...ROW, label: "Gardener pay", circle: "Garden", role: "Gardener" }]);
    const conflict = await call("POST", "/api/admin/suggestions/:id/accept", "u-hana", {}, { id: mine.body.suggestion.id });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("payee_conflict");
    expect((await store.byId(mine.body.suggestion.id))!.status, "a refused Accept leaves the suggestion waiting").toBe("proposed");
    expect((await stored()).map((l) => l.label)).toEqual(["Something else"]);
  });

  it("puts a suggestion to a vote when nobody holds the power, and the carried vote's closer writes it as the village", async () => {
    holders = { "role.pay": [] };
    const made = await suggest("u-sam");
    expect(made.status).toBe(201);
    expect(made.body.route).toBe("ballot");
    expect(opened).toHaveLength(1);
    expect(opened[0].docMarkdown, "the ballot says what changes in words").toContain('Adds "Garden crew pay"');
    const ballot = { id: "bal-1", subjectRef: made.body.suggestion.id, title: opened[0].title } as any;
    const out = await closers[ADMIN_EDIT].execute!(ballot, "system");
    expect(out.applied).toEqual([`admin_edit:${made.body.suggestion.id}`]);
    expect(await stored()).toEqual([{ label: "Garden crew pay", status: "approved", planned_minor: 10_000_000, spent_minor: null, changed_by: null, changed_as: BY_VILLAGE_VOTE }]);
  });
});
