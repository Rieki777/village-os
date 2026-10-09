/**
 * THE KEY MOMENTS' WIRING AND THE CANVAS MOON'S DOORS, over real HTTP against
 * a real database (plan 4.2 and 4.4; Wave 4).
 *
 * `register` hands three things over at boot: the delivery behind every raise,
 * the event observer, and the canvas moon's reader. This file proves each one
 * reaches the right people from the host's own readers (the admins before the
 * handover, the care holder alone for conflict), and that the moon's offer
 * makes a DRAFT gathering once and never seeds one. The routes in
 * server/index.ts that raise a moment are driven in
 * server/canvasRevisit.routes.e2e.test.ts.
 *
 * The gate is a model, as in server/routes/canvas.test.ts. DB-backed; skips
 * loudly without TEST_DATABASE_URL.
 */
import http from "node:http";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { capabilityDecision, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import { CANVAS_MOON_TITLE, revisitTitle } from "../../shared/canvasRevisit";
import { newMoonsBetween } from "../../shared/lunar";
import { insertNotification, type NotifyDeps } from "../lib/notify";
import { raiseCanvasRevisit, setCanvasRevisitDelivery, settleCanvasRevisits } from "../lib/canvasRevisit";
import { recordEvent } from "../lib/events";
import { loadModuleSettings } from "../lib/modules";
import { setCanvasMoonProvider } from "../lib/calendarBrief";
import { CANVAS_MEMBERS_ONLY } from "./canvas";
import { updateGathering } from "../lib/gatherings";
import { CANVAS_MOON_KEY, MOON_CALENDAR_OFF, MOON_OFFERED, MOON_OFFER_REFUSAL, register, revisitDepsFrom } from "./canvasRevisit";

const configured = testDbConfigured();
if (!configured) console.warn("[canvasRevisit.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

interface Person {
  id: string;
  name: string;
  role: string;
  caps: string[];
  membershipGranted: boolean;
  passwordHash: string;
}

const PEOPLE: Record<string, Person> = {
  admin: { id: "cr-admin", name: "Moss Fielding", role: "admin", caps: [], membershipGranted: false, passwordHash: "x" },
  keeper: { id: "cr-keeper", name: "Juniper Vale", role: "member", caps: ["event.manage"], membershipGranted: true, passwordHash: "x" },
  care: { id: "cr-care", name: "Wren Halloway", role: "member", caps: [], membershipGranted: true, passwordHash: "x" },
  member: { id: "cr-member", name: "Ash Brook", role: "member", caps: [], membershipGranted: true, passwordHash: "x" },
  gone: { id: "cr-gone", name: "Linden Rowe", role: "member", caps: [], membershipGranted: true, passwordHash: "" },
  stranger: { id: "cr-stranger", name: "Rook Talbot", role: "member", caps: [], membershipGranted: false, passwordHash: "x" },
};

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";

const who = (req: express.Request): Person | null => PEOPLE[String(req.headers.authorization ?? "").replace(/^Bearer /, "")] ?? null;
const ctxFor = (u: Person): CapabilityCtx => ({
  stageIndex: 0,
  stageIndexOf: () => -1,
  roleCapabilities: u.caps,
  isAdmin: u.role === "admin",
  isFounder: false,
  villageHeld: [],
});

async function call(method: string, route: string, as: keyof typeof PEOPLE | null, body?: unknown) {
  const r = await fetch(`${base}${route}`, { // module-review-ok: the test client dialling its own in-process server on localhost, as every route suite does
    method,
    headers: { "Content-Type": "application/json", ...(as ? { Authorization: `Bearer ${as}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
}

const spine = (): NotifyDeps => ({
  pool,
  memberById: async (id) => Object.values(PEOPLE).find((p) => p.id === id) ?? null,
  sendEmail: async () => {},
  origin: () => "https://example.test",
  projectName: () => "Alder Creek",
  isPresent: (m: any) => !!m?.passwordHash,
});

const rowsOf = async (userId: string): Promise<string[]> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: reading the scratch schema this suite provisioned
    "SELECT title FROM notifications WHERE user_id = ? AND type = 'canvas_revisit' ORDER BY dedupe_key",
    [userId],
  );
  return rows.map((r) => String(r.title));
};

const hostDeps = () => ({
  authedUser: async (req: express.Request) => who(req),
  isAdmin: async (req: express.Request) => who(req)?.role === "admin",
  hasMembership: (u: any) => !!u?.membershipGranted,
  getPool: () => pool,
  capabilityCtx: async (u: any) => ctxFor(u),
  guardCapability: async (req: express.Request, res: express.Response, cap: Capability, refusal?: { status: number; body: Record<string, unknown> }) => {
    const u = who(req);
    if (u && capabilityDecision(cap, ctxFor(u)).allowed) return true;
    if (refusal) res.status(refusal.status).json(refusal.body);
    else res.status(401).json({ error: "auth_required" });
    return false;
  },
  members: { all: async () => Object.values(PEOPLE) } as any,
  isPresent: (m: any) => !!m?.passwordHash,
  notify: (input: any) => insertNotification(spine(), input),
  liveHoldersOf: async () => [],
  readExitPolicy: () => ({ restorative: { intakeContactRole: "care-role" } }),
  roleHolders: () => [{ roleId: "care-role", userId: PEOPLE.care.id, termEndsAt: null }],
  villageTimezone: () => "UTC",
});

describe.skipIf(!configured)("the key moments' wiring and the canvas moon", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await loadModuleSettings(pool);
    const app = express();
    app.use(express.json());
    register(app, hostDeps());
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  }, 120_000);

  afterAll(async () => {
    setCanvasRevisitDelivery(null);
    setCanvasMoonProvider(null);
    await new Promise<void>((r) => server?.close(() => r()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM notifications"); // module-review-ok: resetting the scratch schema between cases
  });

  it("reads every admitted, present member for the village-wide rule, and nobody else", async () => {
    const d = revisitDepsFrom(hostDeps());
    expect((await d.everyMember()).sort()).toEqual([PEOPLE.care.id, PEOPLE.keeper.id, PEOPLE.member.id].sort());
    expect(await d.admins()).toEqual([PEOPLE.admin.id]);
    expect(await d.careHolders()).toEqual([PEOPLE.care.id]);
    const noCare = revisitDepsFrom({ ...hostDeps(), readExitPolicy: () => ({ restorative: {} }) });
    expect(await noCare.careHolders()).toEqual([]);
  });

  it("delivers a raised moment to the admins before the handover", async () => {
    raiseCanvasRevisit("birthing-opened");
    await settleCanvasRevisits();
    expect(await rowsOf(PEOPLE.admin.id)).toEqual([
      revisitTitle("funding", "impact"),
      revisitTitle("funding", "legal"),
      revisitTitle("funding", "power"),
      revisitTitle("funding", "resourcing"),
    ]);
    for (const p of [PEOPLE.member, PEOPLE.keeper, PEOPLE.care]) expect(await rowsOf(p.id)).toEqual([]);
  });

  it("delivers a conflict moment to the care holder alone", async () => {
    raiseCanvasRevisit("exit-opened");
    await settleCanvasRevisits();
    expect(await rowsOf(PEOPLE.care.id)).toEqual([revisitTitle("conflict", "conflict")]);
    for (const p of [PEOPLE.admin, PEOPLE.member, PEOPLE.keeper]) expect(await rowsOf(p.id)).toEqual([]);
  });

  it("raises from the audit event a peer village's arrival records", async () => {
    await recordEvent(pool, { kind: "audit", text: "network:peer-added:Alder Creek", entityType: "peer", entityRef: "peer-1", audience: "admin" });
    await settleCanvasRevisits();
    expect(await rowsOf(PEOPLE.admin.id)).toHaveLength(12);
  });

  it("shows members the next canvas moon, block titles only, and refuses the unadmitted", async () => {
    expect((await call("GET", "/api/canvas/moon", null)).status).toBe(401);
    const s = await call("GET", "/api/canvas/moon", "stranger");
    expect(s.status).toBe(403);
    expect(s.body).toEqual({ error: CANVAS_MEMBERS_ONLY });

    const r = await call("GET", "/api/canvas/moon", "member");
    expect(r.status).toBe(200);
    const next = newMoonsBetween(new Date(), new Date(Date.now() + 31 * 86_400_000))[0];
    expect(r.body.next.newMoonAt).toBe(next.toISOString());
    expect(r.body.next.blocks.length).toBeGreaterThan(0);
    for (const b of r.body.next.blocks) expect(Object.keys(b).sort()).toEqual(["id", "name"]);
    expect(r.body.gathering).toBeNull();
    expect(r.body.mayOffer, "a member without event.manage is not offered it").toBe(false);
  });

  it("refuses the offer while the calendar is off, and to anybody who does not manage events", async () => {
    const off = await call("POST", "/api/canvas/moon/gathering", "keeper");
    expect(off.status).toBe(409);
    expect(off.body).toEqual({ error: MOON_CALENDAR_OFF });
    const no = await call("POST", "/api/canvas/moon/gathering", "member");
    expect(no.status).toBe(403);
    expect(no.body).toEqual({ error: MOON_OFFER_REFUSAL });
  });

  it("offers the canvas moon once, as a draft recurring on every new moon", async () => {
    await pool.query("INSERT INTO module_settings (module_id, lifecycle) VALUES ('events','members')"); // module-review-ok: switching a module on in the scratch schema
    await loadModuleSettings(pool);
    const before = await call("GET", "/api/canvas/moon", "keeper");
    expect(before.body.calendarOn).toBe(true);
    expect(before.body.mayOffer).toBe(true);

    const made = await call("POST", "/api/canvas/moon/gathering", "keeper");
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.gathering.status).toBe("draft");
    const [[row]] = await pool.query<any[]>("SELECT title, status, recurrence, layer, created_by FROM events WHERE id = ?", [made.body.gathering.id]); // module-review-ok: reading the scratch schema this suite provisioned
    expect(row.title).toBe(CANVAS_MOON_TITLE);
    expect(row.status).toBe("draft");
    expect(typeof row.recurrence === "string" ? JSON.parse(row.recurrence) : row.recurrence).toEqual({ freq: "lunar", on: "new_moon" });
    expect(row.created_by).toBe(PEOPLE.keeper.id);

    const again = await call("POST", "/api/canvas/moon/gathering", "keeper");
    expect(again.status).toBe(409);
    const after = await call("GET", "/api/canvas/moon", "keeper");
    expect(after.body.gathering).toEqual({ id: made.body.gathering.id, status: "draft" });
    expect(after.body.mayOffer).toBe(false);
    const [[doc]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM app_config WHERE config_key = ?", [CANVAS_MOON_KEY]); // module-review-ok: reading the scratch schema this suite provisioned
    expect(Number(doc.n)).toBe(1);
  });

  it("offers again once the offered gathering is gone", async () => {
    const [[g]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM events WHERE title = ?", [CANVAS_MOON_TITLE]); // module-review-ok: reading the scratch schema this suite provisioned
    expect(Number(g.n)).toBe(1);
    await pool.query("DELETE FROM events WHERE title = ?", [CANVAS_MOON_TITLE]); // module-review-ok: removing the gathering in the scratch schema, as the calendar's delete does
    const r = await call("GET", "/api/canvas/moon", "keeper");
    expect(r.body.gathering).toBeNull();
    expect(r.body.mayOffer).toBe(true);
  });

  /*
   * The calendar's visible action for a published gathering is Cancel, which
   * keeps the row (audit of Wave 4, 2026-10-01). A cancelled series read as
   * "on the village calendar" to every member and refused a fresh offer.
   */
  it("treats a cancelled canvas moon as not offered, and offers it again", async () => {
    const made = await call("POST", "/api/canvas/moon/gathering", "keeper");
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.message).toBe(MOON_OFFERED);
    // What the Calendar tab's Cancel does (PUT /api/admin/events/:id with a status).
    expect(await updateGathering(pool, made.body.gathering.id, { status: "cancelled" })).toBeTruthy();

    const read = await call("GET", "/api/canvas/moon", "member");
    expect(read.body.gathering, "a cancelled series is not on the calendar").toBeNull();
    expect((await call("GET", "/api/canvas/moon", "keeper")).body.mayOffer).toBe(true);

    const again = await call("POST", "/api/canvas/moon/gathering", "keeper");
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.gathering.id).not.toBe(made.body.gathering.id);
    expect((await call("GET", "/api/canvas/moon", "member")).body.gathering).toEqual({ id: again.body.gathering.id, status: "draft" });
  });
});
