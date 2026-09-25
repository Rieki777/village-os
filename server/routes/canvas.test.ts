/**
 * THE CANVAS ROUTES over real HTTP, against a real database (0222).
 *
 * What a member meets: every block readable, the pen able to write, everybody
 * else refused in words, a bad reading refused before it reaches the table,
 * and a history nobody can rewrite.
 *
 * ── THE GATE HERE IS A MODEL, AND THIS FILE SAYS SO ────────────────────────
 *
 * `guardCapability` lives inside server/index.ts and cannot be imported, so
 * the gate handed to `register` below is built from the REAL decision,
 * `capabilityDecision` from shared/capabilities.ts, wrapped the way
 * `guardCapability` wraps it: allowed carries on, an admin refused on a key
 * the village holds gets the 409 hatch, anyone else gets the route's own
 * refusal. So the order of authority under test is the real one, and the
 * wrapper is a copy. server/canvas.routes.e2e.test.ts drives the real
 * wrapper through the built server.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import http from "node:http";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { capabilityDecision, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import { CANVAS_BLOCK_IDS, CANVAS_SENTENCE_MAX } from "../../shared/governanceCanvas";
import { allCanvasReadings } from "../repos/canvasReadings";
import { CANVAS_PEN_REFUSAL, register } from "./canvas";

const configured = testDbConfigured();
if (!configured) console.warn("[canvas.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

/** The people in this village, by the bearer token each one sends. */
const PEOPLE: Record<string, { id: string; name: string; role: string; roleCapabilities: string[] }> = {
  pen: { id: "canvas-pen", name: "Wren Halloway", role: "member", roleCapabilities: ["story.tell"] },
  member: { id: "canvas-member", name: "Ash Brook", role: "member", roleCapabilities: [] },
  admin: { id: "canvas-admin", name: "Moss Fielding", role: "admin", roleCapabilities: [] },
};

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";
/** What the village holds, read by the gate on every call, as `capability_holding` would be. */
let villageHeld: string[] = [];

const who = (req: express.Request) => {
  const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
  return PEOPLE[token] ?? null;
};

const ctxFor = (user: (typeof PEOPLE)[string]): CapabilityCtx => ({
  stageIndex: 0,
  stageIndexOf: () => -1,
  roleCapabilities: user.roleCapabilities,
  isAdmin: user.role === "admin" || user.role === "founder",
  isFounder: user.role === "founder",
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

const reading = (over: Record<string, unknown> = {}) => ({
  blockId: "power",
  level: 2,
  sentence: "Two people decide most things and the rest of us hear about it afterwards.",
  moment: "baseline",
  ...over,
});

describe.skipIf(!configured)("the canvas routes", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
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
      authedUser: async (req) => who(req),
      capabilityCtx: async (user) => ctxFor(user),
      guardCapability: async (req, res, cap: Capability, refusal) => {
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
      getPool: () => pool,
      firstName: (name: string) => String(name ?? "").trim().split(/\s+/)[0] || "Someone",
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
    villageHeld = [];
    await pool.query("DELETE FROM canvas_readings"); // module-review-ok: each case starts from an empty canvas on the scratch schema this suite provisioned
  });

  describe("who may read", () => {
    it("refuses a visitor with no session, on both doors", async () => {
      expect((await call("GET", "/api/canvas", null)).status).toBe(401);
      const post = await call("POST", "/api/canvas/readings", null, reading());
      expect(post.status).toBe(401);
      expect(await allCanvasReadings(pool)).toEqual([]);
    });

    it("gives any signed-in member all twelve blocks in canvas order, read or not", async () => {
      const r = await call("GET", "/api/canvas", "member");
      expect(r.status).toBe(200);
      expect(r.body.blocks.map((b: any) => b.id)).toEqual([...CANVAS_BLOCK_IDS]);
      for (const b of r.body.blocks) {
        expect(b.latest).toBeNull();
        expect(b.history).toEqual([]);
      }
      expect(r.body.mayRecord).toBe(false);
    });

    it("tells the pen and a pre-handover admin they may record, and a plain member they may not", async () => {
      expect((await call("GET", "/api/canvas", "pen")).body.mayRecord).toBe(true);
      expect((await call("GET", "/api/canvas", "admin")).body.mayRecord).toBe(true);
      expect((await call("GET", "/api/canvas", "member")).body.mayRecord).toBe(false);
    });

    it("carries no number computed across blocks", async () => {
      await call("POST", "/api/canvas/readings", "pen", reading({ blockId: "purpose", level: 4 }));
      await call("POST", "/api/canvas/readings", "pen", reading({ blockId: "team", level: 2 }));
      const r = await call("GET", "/api/canvas", "member");
      expect(Object.keys(r.body).sort()).toEqual(["blocks", "mayRecord"]);
      for (const b of r.body.blocks) expect(Object.keys(b).sort()).toEqual(["history", "id", "latest"]);
    });
  });

  describe("who may write", () => {
    it("records a reading from the pen, and every member then reads it", async () => {
      const post = await call("POST", "/api/canvas/readings", "pen", reading({ level: 3 }));
      expect(post.status).toBe(201);
      expect(post.body.reading).toMatchObject({
        blockId: "power",
        level: 3,
        word: "Emerging",
        moment: "baseline",
        momentLabel: "Baseline",
        recordedBy: { id: "canvas-pen", name: "Wren" },
      });
      expect(Number.isNaN(Date.parse(post.body.reading.recordedAt))).toBe(false);

      const r = await call("GET", "/api/canvas", "member");
      const power = r.body.blocks.find((b: any) => b.id === "power");
      expect(power.latest).toMatchObject({ level: 3, word: "Emerging", sentence: reading().sentence, recordedBy: { name: "Wren" } });
      expect(power.history).toHaveLength(1);
    });

    it("refuses a member who does not hold the pen, in words, and writes nothing", async () => {
      const post = await call("POST", "/api/canvas/readings", "member", reading());
      expect(post.status).toBe(403);
      expect(post.body).toEqual({ error: CANVAS_PEN_REFUSAL });
      expect(await allCanvasReadings(pool)).toEqual([]);
    });

    it("lets an admin record before the handover, as for the village's other words", async () => {
      const post = await call("POST", "/api/canvas/readings", "admin", reading({ blockId: "legal", level: 1 }));
      expect(post.status).toBe(201);
      expect(post.body.reading.recordedBy).toEqual({ id: "canvas-admin", name: "Moss" });
    });

    it("hands an admin the gate's own answer once the village holds the pen, and still lets the holder write", async () => {
      villageHeld = ["story.tell"];
      expect((await call("POST", "/api/canvas/readings", "admin", reading())).status).toBe(409);
      expect((await call("GET", "/api/canvas", "admin")).body.mayRecord).toBe(false);
      expect((await call("POST", "/api/canvas/readings", "pen", reading())).status).toBe(201);
    });
  });

  describe("what a reading must be", () => {
    const refused = async (over: Record<string, unknown>) => {
      const r = await call("POST", "/api/canvas/readings", "pen", reading(over));
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(typeof r.body.error).toBe("string");
      return r.body.error as string;
    };

    it("refuses a level outside one to five, or not a whole number", async () => {
      for (const level of [0, 6, 2.5, "3", null]) expect(await refused({ level })).toMatch(/1 \(Absent\) to 5 \(Thriving\)/);
    });

    it("refuses a block the canvas does not have", async () => {
      expect(await refused({ blockId: "vibes" })).toBe("That is not one of the twelve canvas blocks.");
    });

    it("refuses an empty sentence and one past the limit", async () => {
      expect(await refused({ sentence: "   " })).toMatch(/one sentence/);
      expect(await refused({ sentence: "y".repeat(CANVAS_SENTENCE_MAX + 1) })).toMatch(/500 characters/);
    });

    it("refuses a moment that is not on the list", async () => {
      expect(await refused({ moment: "whenever" })).toMatch(/not a moment/);
    });

    it("wrote none of the refused readings", async () => {
      for (const over of [{ level: 9 }, { blockId: "nope" }, { sentence: "" }, { moment: "x" }]) await refused(over);
      expect(await allCanvasReadings(pool)).toEqual([]);
    });
  });

  describe("the history", () => {
    it("keeps every reading of a block, newest first, and the newest is the block's level", async () => {
      await call("POST", "/api/canvas/readings", "pen", reading({ level: 2, sentence: "Nobody has named who decides." }));
      await call("POST", "/api/canvas/readings", "pen", reading({ level: 4, sentence: "The circle decides and says so.", moment: "canvas-moon" }));
      const power = (await call("GET", "/api/canvas", "member")).body.blocks.find((b: any) => b.id === "power");
      expect(power.history.map((h: any) => [h.level, h.sentence])).toEqual([
        [4, "The circle decides and says so."],
        [2, "Nobody has named who decides."],
      ]);
      expect(power.latest).toMatchObject({ level: 4, word: "Growing", moment: "canvas-moon", momentLabel: "Canvas moon" });
    });

    it("picks the newest reading per block without mixing blocks", async () => {
      await call("POST", "/api/canvas/readings", "pen", reading({ blockId: "purpose", level: 2 }));
      await call("POST", "/api/canvas/readings", "pen", reading({ blockId: "power", level: 3 }));
      await call("POST", "/api/canvas/readings", "pen", reading({ blockId: "purpose", level: 5 }));
      const blocks = (await call("GET", "/api/canvas", "member")).body.blocks;
      const latest = Object.fromEntries(blocks.map((b: any) => [b.id, b.latest?.level ?? null]));
      expect(latest).toMatchObject({ purpose: 5, power: 3, team: null, impact: null });
      expect(blocks.find((b: any) => b.id === "purpose").history.map((h: any) => h.level)).toEqual([5, 2]);
    });

    it("offers no door that changes or removes a reading", async () => {
      const post = await call("POST", "/api/canvas/readings", "pen", reading());
      const id = post.body.reading.id;
      expect((await call("PUT", `/api/canvas/readings/${id}`, "pen", reading({ level: 5 }))).status).toBe(404);
      expect((await call("PATCH", `/api/canvas/readings/${id}`, "pen", { level: 5 })).status).toBe(404);
      expect((await call("DELETE", `/api/canvas/readings/${id}`, "pen")).status).toBe(404);
      const rows = await allCanvasReadings(pool);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id, level: 2 });
    });

    it("keeps a reading whose recorder's account is gone, and names nobody", async () => {
      await pool.query( // module-review-ok: a fixture member on the scratch schema this suite provisioned
        "INSERT INTO users (id, name, email, password_hash, role) VALUES ('canvas-gone','Tamsin Vale','canvas-gone@example.invalid','x','member')",
      );
      await pool.query( // module-review-ok: a reading written underneath the route, so its author can then be removed
        "INSERT INTO canvas_readings (block_id, level, sentence, recorded_by) VALUES ('impact', 3, 'The orchard fed two households this summer.', 'canvas-gone')",
      );
      await pool.query("DELETE FROM users WHERE id = 'canvas-gone'"); // module-review-ok: removing the fixture account so the reading outlives it
      const impact = (await call("GET", "/api/canvas", "member")).body.blocks.find((b: any) => b.id === "impact");
      expect(impact.latest).toMatchObject({ level: 3, moment: "baseline", recordedBy: { id: "canvas-gone", name: "Someone" } });
    });

    it("refuses a level the route never checked, at the table itself", async () => {
      await expect(
        pool.query( // module-review-ok: proving the CHECK constraint on the scratch schema this suite provisioned
          "INSERT INTO canvas_readings (block_id, level, sentence, recorded_by) VALUES ('power', 6, 'x', 'canvas-pen')",
        ),
      ).rejects.toThrow();
    });
  });
});
