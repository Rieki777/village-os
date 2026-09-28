/**
 * THE CANVAS RESOURCES ROUTES over real HTTP, against a real database (0224).
 *
 * What a member meets: the shelf under one block, with its credit and its
 * date; the snapshot when the village has never read the database; the NVC
 * rows gone from a safety surface; the canvas pen choosing where a resource
 * shows and everybody else refused in words; and the two nightly jobs
 * registered by the module itself.
 *
 * The gate handed to `register` is built from the REAL decision,
 * `capabilityDecision`, wrapped the way `guardCapability` wraps it, as
 * server/routes/canvas.test.ts explains.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import http from "node:http";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { capabilityDecision, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import { CANVAS_DATABASE, type CanvasResourcesPayload } from "../../shared/canvasResources";
import { registeredJobs } from "../lib/scheduler";
import { DAY_MS, LINK_CHECK_JOB, SNAPSHOT_TAKEN, SYNC_JOB } from "../lib/canvasResourcesSync";
import { liveResources } from "../repos/canvasResources";
import { CANVAS_MEMBERS_ONLY } from "./canvas";
import { RESOURCE_PEN_REFUSAL, register } from "./canvasResources";

const configured = testDbConfigured();
if (!configured) console.warn("[canvasResources.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

const PEOPLE: Record<string, { id: string; name: string; role: string; roleCapabilities: string[]; membershipGranted: boolean }> = {
  pen: { id: "res-pen", name: "Wren Halloway", role: "member", roleCapabilities: ["story.tell"], membershipGranted: true },
  member: { id: "res-member", name: "Ash Brook", role: "member", roleCapabilities: [], membershipGranted: true },
  admin: { id: "res-admin", name: "Moss Fielding", role: "admin", roleCapabilities: [], membershipGranted: false },
  stranger: { id: "res-stranger", name: "Rook Talbot", role: "member", roleCapabilities: [], membershipGranted: false },
};

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";

const who = (req: express.Request) => PEOPLE[String(req.headers.authorization ?? "").replace(/^Bearer /, "")] ?? null;
const ctxFor = (user: (typeof PEOPLE)[string]): CapabilityCtx => ({
  stageIndex: 0,
  stageIndexOf: () => -1,
  roleCapabilities: user.roleCapabilities,
  isAdmin: user.role === "admin" || user.role === "founder",
  isFounder: user.role === "founder",
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

describe("the nightly jobs", () => {
  it("are registered by the module, once a day each", () => {
    const before = registeredJobs().length;
    register(express(), {
      authedUser: async () => null,
      isAdmin: async () => false,
      hasMembership: () => false,
      guardCapability: async () => false,
      capabilityCtx: async (user) => ctxFor(user),
      getPool: () => {
        throw new Error("a job reads the pool only when it runs");
      },
    });
    const added = registeredJobs().slice(before);
    expect(added).toEqual([
      { name: SYNC_JOB, everyMs: DAY_MS },
      { name: LINK_CHECK_JOB, everyMs: DAY_MS },
    ]);
    expect(SYNC_JOB).toBe("canvas-resources-sync");
    expect(LINK_CHECK_JOB).toBe("canvas-resources-link-check");
  });
});

describe.skipIf(!configured)("the canvas resources routes", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async (req) => who(req),
      isAdmin: async (req) => ["admin", "founder"].includes(who(req)?.role ?? ""),
      hasMembership: (user) => !!(user as { membershipGranted?: boolean }).membershipGranted,
      capabilityCtx: async (user) => ctxFor(user),
      guardCapability: async (req, res, cap: Capability, refusal) => {
        const user = who(req);
        if (user && capabilityDecision(cap, ctxFor(user)).allowed) return true;
        if (refusal) {
          res.status(refusal.status).json(refusal.body);
          return false;
        }
        res.status(401).json({ error: "auth_required" });
        return false;
      },
      getPool: () => pool,
    });
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
    await pool.query("DELETE FROM canvas_resources"); // module-review-ok: resetting the scratch schema this suite provisioned
    await pool.query("DELETE FROM app_config WHERE config_key = 'canvas-resources-sync'"); // module-review-ok: resetting the scratch schema this suite provisioned
  });

  it("asks a visitor to sign in and tells an account the village has not admitted why", async () => {
    expect((await call("GET", "/api/canvas/resources?block=power", null)).status).toBe(401);
    const stranger = await call("GET", "/api/canvas/resources?block=power", "stranger");
    expect(stranger.status).toBe(403);
    expect(stranger.body.error).toBe(CANVAS_MEMBERS_ONLY);
  });

  it("refuses a block or a surface it does not know, in words", async () => {
    const block = await call("GET", "/api/canvas/resources?block=weather", "member");
    expect(block.status).toBe(400);
    expect(block.body.error).toContain("?block=power");
    const surface = await call("GET", "/api/canvas/resources?block=power&surface=admin", "member");
    expect(surface.status).toBe(400);
  });

  it("serves a member the shelf under one block from the snapshot, with the credit, the date and no suggestion link", async () => {
    const r = await call("GET", "/api/canvas/resources?block=power", "member");
    expect(r.status).toBe(200);
    const body = r.body as CanvasResourcesPayload;
    expect(body.block).toBe("power");
    expect(body.surface).toBe("learn");
    expect(body.credit).toEqual({ text: CANVAS_DATABASE.credit, url: CANVAS_DATABASE.sheetUrl });
    expect(body.source.kind).toBe("snapshot");
    expect(body.source.asOf).toBe(`${SNAPSHOT_TAKEN}T12:00:00.000Z`);
    expect(body.source.syncOn).toBe(true);
    expect(body.suggestUrl).toBeNull();
    expect(body.mayPlace).toBe(false);
    const names = body.resources.map((x) => x.name);
    expect(names).toContain("Consent decision making");
    expect(names).toContain("Governance Canvas");
    // Every one of them is under Power, by the platform's map, and in name order.
    expect(body.resources.every((x) => x.blocks.includes("power") && x.placing.by === "platform")).toBe(true);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    // The shelf was loaded on this first read, and the page says so.
    expect(await liveResources(pool)).toHaveLength(58);
    const pending = body.resources.find((x) => x.name === "Governance Canvas")!;
    expect(pending.url).toBeNull();
    expect(pending.linkPending).toBe(true);
  });

  it("leaves the NVC rows out of a safety surface and keeps them in the Learn frame", async () => {
    const learn = await call("GET", "/api/canvas/resources?block=conflict", "member");
    const safety = await call("GET", "/api/canvas/resources?block=conflict&surface=safety", "member");
    const nvc = (b: CanvasResourcesPayload) => b.resources.map((x) => x.name).filter((n) => /NVC|Nonviolent/.test(n));
    expect(nvc(learn.body)).toHaveLength(3);
    expect(safety.body.surface).toBe("safety");
    expect(nvc(safety.body)).toEqual([]);
    expect(safety.body.resources.map((x: { name: string }) => x.name)).toContain("Beginning Anew");
  });

  it("lets the canvas pen choose where a resource shows, and hand it back to the platform", async () => {
    const before = await call("GET", "/api/canvas/resources?block=power", "pen");
    expect(before.body.mayPlace).toBe(true);
    const consent = (before.body as CanvasResourcesPayload).resources.find((x) => x.name === "Consent decision making")!;

    const put = await call("PUT", `/api/canvas/resources/${consent.key}/blocks`, "pen", { blocks: ["learning", "meetings"] });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ key: consent.key, blocks: ["meetings", "learning"], by: "village" });

    const power = await call("GET", "/api/canvas/resources?block=power", "member");
    expect(power.body.resources.map((x: { key: string }) => x.key)).not.toContain(consent.key);
    const learning = (await call("GET", "/api/canvas/resources?block=learning", "member")).body as CanvasResourcesPayload;
    // The village's own placings come first, and say so.
    expect(learning.resources[0].key).toBe(consent.key);
    expect(learning.resources[0].placing).toEqual({ by: "village", keyword: null });

    const back = await call("PUT", `/api/canvas/resources/${consent.key}/blocks`, "pen", { blocks: null });
    expect(back.status).toBe(200);
    const again = await call("GET", "/api/canvas/resources?block=power", "member");
    expect(again.body.resources.map((x: { key: string }) => x.key)).toContain(consent.key);
  });

  it("refuses the placing to anybody but the pen, and refuses a bad list or an unknown resource", async () => {
    await call("GET", "/api/canvas/resources?block=power", "member");
    const [any] = await liveResources(pool);
    const member = await call("PUT", `/api/canvas/resources/${any.resourceKey}/blocks`, "member", { blocks: ["power"] });
    expect(member.status).toBe(403);
    expect(member.body.error).toBe(RESOURCE_PEN_REFUSAL);
    expect((await call("PUT", `/api/canvas/resources/${any.resourceKey}/blocks`, null, { blocks: ["power"] })).status).toBe(401);
    expect((await call("PUT", `/api/canvas/resources/${any.resourceKey}/blocks`, "pen", { blocks: ["weather"] })).status).toBe(400);
    expect((await call("PUT", `/api/canvas/resources/${any.resourceKey}/blocks`, "pen", { blocks: "power" })).status).toBe(400);
    expect((await call("PUT", `/api/canvas/resources/${"0".repeat(40)}/blocks`, "pen", { blocks: [] })).status).toBe(404);
    expect((await call("PUT", "/api/canvas/resources/not-a-key/blocks", "pen", { blocks: [] })).status).toBe(404);
    // Nothing the refusals asked for was written.
    expect((await liveResources(pool)).every((r) => r.tagsLocal === null)).toBe(true);
  });

  it("lets an admin read the shelf, and gives an admin who does not hold the pen no placing", async () => {
    const r = await call("GET", "/api/canvas/resources?block=legal", "admin");
    expect(r.status).toBe(200);
    expect(r.body.resources.length).toBeGreaterThan(0);
    // Before any handover an admin passes story.tell in the real gate; this
    // model hands the admin no role, so the answer is the gate's, not a rule of this route.
    expect(r.body.mayPlace).toBe(capabilityDecision("story.tell", ctxFor(PEOPLE.admin)).allowed);
  });
});
