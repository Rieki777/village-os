/**
 * THE BRAIN EDITOR'S DOORS over real HTTP, against a real database (canvas
 * follow-up D2 and G.4, Rye 2026-11-06).
 *
 * The nine shared sections ask `story.tell` through the one gate, as canvas
 * prose does: before the handover an admin writes and a holder writes, a plain
 * member is refused; once the village holds `story.tell` an admin gets the
 * gate's own 409 and the holder still writes. The four private sections ask the
 * canvas's admin pen: the administrators, until a `power_grant` vote seats
 * `brief.private` on a role, and after the Birthing its live holders, with an
 * unseated admin refused and a `story.tell` holder refused throughout.
 *
 * The gate handed to `register` is a MODEL built from the real decision,
 * `capabilityDecision`, wrapped the way `guardCapability` wraps it, exactly as
 * server/routes/canvas.test.ts does and says.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import http from "node:http";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { capabilityDecision, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import { ADMIN_ONLY_SECTIONS } from "../../shared/canvasFrames";
import { briefGet } from "../lib/villageBrain";
import { recordGameStart } from "../lib/gameStart";
import { BRAIN_PEN_REFUSAL, BRIEF_PRIVATE_REFUSAL, register } from "./villageBrainAdmin";

const configured = testDbConfigured();
if (!configured) console.warn("[villageBrainAdmin.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

const PEOPLE: Record<string, { id: string; name: string; role: string; roleCapabilities: string[] }> = {
  admin: { id: "vb-admin", name: "Moss Fielding", role: "admin", roleCapabilities: [] },
  teller: { id: "vb-teller", name: "Wren Halloway", role: "member", roleCapabilities: ["story.tell"] },
  keeper: { id: "vb-keeper", name: "Juniper Vale", role: "member", roleCapabilities: ["brief.private"] },
  member: { id: "vb-member", name: "Ash Brook", role: "member", roleCapabilities: [] },
};

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";
/** What the village holds, read by the gate on every call. */
let villageHeld: string[] = [];
/** Who holds `brief.private` live, as `liveHoldersOf` answers. */
let privateHolders: string[] = [];

const who = (req: express.Request) => PEOPLE[String(req.headers.authorization ?? "").replace(/^Bearer /, "")] ?? null;
const ctxFor = (u: (typeof PEOPLE)[string]): CapabilityCtx => ({
  stageIndex: 0,
  stageIndexOf: () => -1,
  roleCapabilities: u.roleCapabilities,
  isAdmin: u.role === "admin",
  isFounder: false,
  villageHeld,
});

async function call(method: string, route: string, as: keyof typeof PEOPLE | null, body?: unknown) {
  const r = await fetch(`${base}${route}`, { // module-review-ok: the test client dialling its own in-process server on localhost, as every route suite does
    method,
    headers: { "Content-Type": "application/json", ...(as ? { Authorization: `Bearer ${as}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
}

const put = (as: keyof typeof PEOPLE, section: string, body = "Written by the test, in a sentence or two.") =>
  call("PUT", `/api/admin/brain/${section}`, as, { body });

describe.skipIf(!configured)("the Brain editor's doors (D2, G.4)", () => {
  beforeAll(async () => {
    db = await provisionTestDb({ gameStarted: false });
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    for (const p of Object.values(PEOPLE)) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)",
        [p.id, p.name, `${p.id}@example.invalid`, "x", p.role],
      );
    }
    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async (req: express.Request) => who(req),
      isAdmin: async (req: express.Request) => who(req)?.role === "admin",
      getPool: () => pool,
      capabilityCtx: async (user: any) => ctxFor(user),
      guardCapability: async (req: express.Request, res: express.Response, cap: Capability, refusal?: { status: number; body: Record<string, unknown> }) => {
        const user = who(req);
        const decision = user ? capabilityDecision(cap, ctxFor(user)) : null;
        if (decision?.allowed) return true;
        if (user && decision?.villageHolds && ctxFor(user).isAdmin) {
          res.status(409).json({ error: "This village holds this one." });
          return false;
        }
        if (refusal) {
          res.status(refusal.status).json(refusal.body);
          return false;
        }
        res.status(401).json({ error: "auth_required" });
        return false;
      },
      liveHoldersOf: async (capability: string) => (capability === "brief.private" ? [...privateHolders] : []),
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
    await db?.drop?.();
  });

  beforeEach(async () => {
    villageHeld = [];
    privateHolders = [];
    await pool.query("DELETE FROM app_config WHERE config_key = 'game-start'"); // module-review-ok: each case starts before the Birthing, on the scratch schema this suite provisioned
  });

  describe("the shared sections ask story.tell through the one gate (D2)", () => {
    it("before the handover: an admin writes, a story.tell holder writes, a plain member is refused in words", async () => {
      expect((await put("admin", "membership", "The admin's words.")).status).toBe(200);
      expect((await put("teller", "membership", "The teller's words.")).status).toBe(200);
      expect((await briefGet(pool, "membership", "admin"))?.confirmedBy).toBe("vb-teller");
      expect(await put("member", "membership")).toEqual({ status: 403, body: { error: BRAIN_PEN_REFUSAL } });
      expect((await call("POST", "/api/admin/brain/membership/confirm", "member")).status).toBe(403);
      expect((await call("POST", "/api/admin/brain/membership/confirm", "teller")).status).toBe(200);
    });

    it("once the village holds story.tell: the admin gets the gate's own 409, and the holder still writes", async () => {
      villageHeld = ["story.tell"];
      expect((await put("admin", "membership")).status).toBe(409);
      expect((await call("POST", "/api/admin/brain/membership/confirm", "admin")).status).toBe(409);
      expect((await put("teller", "membership", "Still the teller's.")).status).toBe(200);
    });

    it("a story.tell holder reads the shared sections and never the four private ones", async () => {
      const r = await call("GET", "/api/admin/brain", "teller");
      expect(r.status).toBe(200);
      const ids = r.body.sections.map((s: any) => s.id);
      expect(ids).toContain("membership");
      for (const s of ADMIN_ONLY_SECTIONS) expect(ids, s).not.toContain(s);
      expect((await call("GET", "/api/admin/brain", "member")).status).toBe(401);
      const asAdmin = (await call("GET", "/api/admin/brain", "admin")).body.sections.map((s: any) => s.id);
      for (const s of ADMIN_ONLY_SECTIONS) expect(asAdmin, s).toContain(s);
    });
  });

  describe("the four private sections ask the admin pen (G.4)", () => {
    it("with nobody holding brief.private, the admins keep them, and a story.tell holder is refused naming the vote", async () => {
      expect((await put("admin", "legal", "The trust holds the title.")).status).toBe(200);
      const refused = await put("teller", "legal");
      expect(refused).toEqual({ status: 403, body: { error: BRIEF_PRIVATE_REFUSAL } });
      expect(BRIEF_PRIVATE_REFUSAL).toContain("a power_grant vote gives brief.private to a role");
      expect((await briefGet(pool, "legal", "admin"))?.body).toBe("The trust holds the title.");
    });

    it("after the Birthing, a seated holder reads and writes legal, and the unseated admin is refused once a holder is seated", async () => {
      await recordGameStart(pool, { ballotId: "b-birth", startedBy: "vb-admin", note: "The village began." });
      privateHolders = ["vb-keeper"];
      const wrote = await put("keeper", "legal", "The members hold the trust that holds the title.");
      expect(wrote.status, JSON.stringify(wrote.body)).toBe(200);
      const read = await call("GET", "/api/admin/brain", "keeper");
      expect(read.status).toBe(200);
      expect(read.body.sections.find((s: any) => s.id === "legal")?.body).toBe("The members hold the trust that holds the title.");
      // The holder of the private sections reads only those.
      expect(read.body.sections.map((s: any) => s.id)).not.toContain("membership");

      expect(await put("admin", "legal")).toEqual({ status: 403, body: { error: BRIEF_PRIVATE_REFUSAL } });
      expect((await call("POST", "/api/admin/brain/legal/confirm", "admin")).status).toBe(403);
      const adminRead = (await call("GET", "/api/admin/brain", "admin")).body.sections.map((s: any) => s.id);
      for (const s of ADMIN_ONLY_SECTIONS) expect(adminRead, s).not.toContain(s);
      expect(adminRead).toContain("membership");
      // The story's holder is still refused there.
      expect((await put("teller", "legal")).status).toBe(403);
      expect((await briefGet(pool, "legal", "admin"))?.body).toBe("The members hold the trust that holds the title.");
    });
  });
});
