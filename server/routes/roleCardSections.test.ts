/**
 * THE FOUNDING SECTIONS AND THE FOUNDING TEAM over real HTTP against a real
 * database (phase A, lane A3).
 *
 *   1. the editor saves the founding sections beside the draft, through the
 *      editor's own gate, and a member without the power is refused (control:
 *      the holder's same save succeeds);
 *   2. an amount on the pay is refused in words and nothing is written;
 *   3. anyone reads a LISTED role's sections, with the village's pay shape and
 *      who last edited it; an unlisted role answers 404 to a visitor (control:
 *      the editor reads it);
 *   4. the founding team features only the listed roles the setting names, in
 *      its order, and nothing while the setting is off.
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { capabilityDecision, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import type { SubjectCloser } from "../lib/applyDue";
import { addChange, createDraft, publishDraft } from "../lib/orgDrafts";
import { register } from "./orgDraftDecide";
import { loadVariables } from "../lib/variables";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";

const USERS: Record<string, { id: string; name: string; role: string }> = {
  "holder-1": { id: "holder-1", name: "Holder One", role: "member" },
  "member-1": { id: "member-1", name: "Member One", role: "member" },
  "admin-1": { id: "admin-1", name: "Admin One", role: "admin" },
};
let holders = new Set<string>();
const closers: Record<string, SubjectCloser> = {};
const SEASON = { current: { id: "s1" }, seasons: [{ id: "s1", startsOn: "2026-01-01", endsOn: "2030-01-01" }], timezone: "UTC" };

const userOf = async (req: any) => USERS[String(req.headers["x-user"] ?? "")] ?? null;
const ctxOf = async (user: any): Promise<CapabilityCtx> => ({
  stageIndex: 0,
  stageIndexOf: () => 0,
  roleCapabilities: holders.has(String(user.id)) ? ["org.decide"] : [],
  isAdmin: user.role === "admin",
  villageHeld: [],
});
async function guard(req: any, res: any, cap: Capability, refusal?: { status: number; body: Record<string, unknown> }) {
  const user = await userOf(req);
  if (!user) {
    res.status(401).json({ error: "auth_required" });
    return false;
  }
  const d = capabilityDecision(cap, await ctxOf(user));
  if (d.allowed) return true;
  res.status(refusal?.status ?? 401).json(refusal?.body ?? { error: "auth_required" });
  return false;
}

async function call(method: string, route: string, user: string | null, body?: unknown) {
  const r = await fetch(base + route, { // module-review-ok: the test client dialling its own server on localhost
    method,
    headers: { "Content-Type": "application/json", ...(user ? { "x-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, json: type.includes("json") ? ((await r.json().catch(() => null)) as any) : null, text: type.includes("json") ? "" : await r.text() };
}

let seq = 0;
/** A circle and a role in it, through the same drafts a village's chart is made with. */
async function seedRole(extra: Record<string, unknown> = {}): Promise<{ id: string; circle: string }> {
  seq += 1;
  const circle = `rt-circle-${seq}`;
  const id = `rt-role-${seq}`;
  const made = await createDraft(pool, { title: `Seed ${seq}`, createdBy: "admin-1", sourceKind: "human", openCap: null });
  if (!made.ok) throw new Error(made.error);
  const add = async (op: any, orgRoleId: string, payload: any) => {
    const r = await addChange(pool, made.id, { op, orgRoleId, payload });
    if (!r.ok) throw new Error(r.error);
  };
  await add("create_circle", `circle:${circle}`, { name: `Reading Circle ${seq}` });
  await add("create_seat", id, { name: `Reader ${seq}`, circleId: circle, aim: "Old aim", domain: "Old domain", ...extra });
  const pub = await publishDraft(pool, made.id, "admin-1", null);
  if (!pub.ok) throw new Error(pub.error);
  return { id, circle };
}

const row = async (id: string) => {
  const [rows]: any = await pool.query("SELECT aim, domain, recruiting, terms_offer, terms_offer_by FROM org_roles WHERE id = ?", [id]); // module-review-ok: a test reading the table it asserts on
  return rows[0];
};


async function setVar(key: string, value: string | null) {
  if (value === null) await pool.query("DELETE FROM game_variables WHERE config_key = ?", [key]); // module-review-ok: a test setting the village's dial
  else await pool.query("INSERT INTO game_variables (config_key, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]); // module-review-ok: a test setting the village's dial
  await loadVariables(pool);
}

const SECTIONS = {
  idealBackground: ["Ideally studied finance"],
  qualities: ["Owns the whole domain", "In it for the long run"],
  aiSupport: "An AI companion keeps the books moving.",
  aiCompanion: "Heron",
  paid: true,
  payShape: [],
  payNote: "",
};

describe.skipIf(!configured)("the founding sections and the founding team", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: userOf,
      isAdmin: async (req: any) => (await userOf(req))?.role === "admin",
      guardCapability: guard,
      capabilityCtx: ctxOf,
      getPool: () => pool,
      notify: async () => ({}) as any,
      seasonState: () => SEASON,
      circlesRepo: { load: async () => {}, all: () => [] },
      liveHoldersOf: async () => Array.from(holders),
      overLimit: async () => false,
      ballotSetup: async () => ({}) as any,
      notifyRoll: async () => 0,
      governanceOn: () => true,
      closers,
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    holders = new Set();
    for (const k of ["org.founding_team", "org.founding_team_roles", "org.pay_shape", "org.pay_shape_at_risk", "org.pay_shape_note", "org.show_pay_ranges"]) await setVar(k, null);
  });

  it("the editor saves the sections beside the draft; a member without the power is refused (control: the holder's same save)", async () => {
    const { id } = await seedRole();
    const refused = await call("POST", `/api/org/role-edit/${id}`, "member-1", { sections: SECTIONS });
    expect(refused.status).toBe(403);
    expect((await call("GET", `/api/org/role-card/${id}`, null)).json.sections).toBeNull();
    holders = new Set(["holder-1"]);
    const saved = await call("POST", `/api/org/role-edit/${id}`, "holder-1", { sections: SECTIONS });
    expect(saved.status).toBe(200);
    expect(saved.json.changed).toEqual(["Who we hope for, and how pay works"]);
    expect(saved.json.state.sections.qualities).toEqual(SECTIONS.qualities);
    // The same set again changes nothing, and says so.
    expect((await call("POST", `/api/org/role-edit/${id}`, "holder-1", { sections: SECTIONS })).status).toBe(400);
    const read = await call("GET", `/api/org/role-card/${id}`, null);
    expect(read.status).toBe(200);
    expect(read.json.sections.aiCompanion).toBe("Heron");
    expect(read.json.lastEdited.on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A visitor is told the day, never a name, while people are not public to strangers.
    await setVar("org.public_people", "false");
    expect((await call("GET", `/api/org/role-card/${id}`, null)).json.lastEdited.by).toBeNull();
    await setVar("org.public_people", null);
  });

  it("refuses an amount on the pay in words, and writes nothing", async () => {
    const { id } = await seedRole();
    holders = new Set(["holder-1"]);
    const r = await call("POST", `/api/org/role-edit/${id}`, "holder-1", { sections: { ...SECTIONS, payNote: "6,750 to 9,000 USD a month" } });
    expect(r.status).toBe(400);
    expect(r.json.fields).toEqual(["sections.payNote"]);
    expect((await call("GET", `/api/org/role-card/${id}`, null)).json.sections).toBeNull();
  });

  it("serves the village's pay shape with every card, and keeps an unlisted role from a visitor (control: the editor reads it)", async () => {
    await setVar("org.pay_shape", "Cash 40, Equity 55, Credits 5");
    await setVar("org.pay_shape_note", "Indicative only. Terms are subject to legal review.");
    const open = await seedRole();
    const hidden = await seedRole({ listed: false });
    const r = await call("GET", `/api/org/role-card/${open.id}`, null);
    expect(r.json.villagePay.shape).toEqual([
      { label: "Cash", pct: 40 },
      { label: "Equity", pct: 55 },
      { label: "Credits", pct: 5 },
    ]);
    expect(r.json.villagePay.note).toBe("Indicative only. Terms are subject to legal review.");
    expect(r.json.showPayRanges).toBe(false);
    expect((await call("GET", `/api/org/role-card/${hidden.id}`, null)).status).toBe(404);
    expect((await call("GET", `/api/org/role-card/${hidden.id}`, "member-1")).status).toBe(404);
    holders = new Set(["holder-1"]);
    expect((await call("GET", `/api/org/role-card/${hidden.id}`, "holder-1")).status).toBe(200);
  });

  it("features only the listed roles the setting names, in its order, and nothing while off", async () => {
    const a = await seedRole();
    const b = await seedRole();
    const hidden = await seedRole({ listed: false });
    await setVar("org.founding_team_roles", `${b.id}, ${hidden.id}, nobody, ${a.id}`);
    expect((await call("GET", "/api/org/founding-team", null)).json).toMatchObject({ on: false, roleIds: [] });
    await setVar("org.founding_team", "true");
    const on = await call("GET", "/api/org/founding-team", null);
    expect(on.json.on).toBe(true);
    expect(on.json.roleIds).toEqual([b.id, a.id]);
    // The names travel with the ids, for the steward page's band, and only the featured roles' names.
    expect(on.json.names).toEqual({ [b.id]: `Reader ${b.id.split("-").pop()}`, [a.id]: `Reader ${a.id.split("-").pop()}` });
    await setVar("org.founding_team", null);
    expect((await call("GET", "/api/org/founding-team", null)).json.names).toEqual({});
  });
});
