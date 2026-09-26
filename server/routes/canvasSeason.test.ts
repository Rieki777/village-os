/**
 * THE CANVAS SEASON ROUTES over real HTTP, against a real database (2026-09-26).
 *
 * What a member meets: the season readable by every member, loadable and
 * removable by the canvas pen alone, a visitor refused before anything is
 * read, a bad file refused in the validator's own words with nothing stored,
 * and a stored document that stopped passing reported rather than rendered.
 *
 * ── THE GATE HERE IS A MODEL, AND THIS FILE SAYS SO ────────────────────────
 *
 * Built exactly as server/routes/canvas.test.ts builds it: `guardCapability`
 * lives inside server/index.ts and cannot be imported, so the gate handed to
 * `register` is the REAL decision, `capabilityDecision`, wrapped the way
 * `guardCapability` wraps it. The order of authority under test is the real
 * one; the wrapper is a copy. server/canvasSeason.routes.e2e.test.ts drives
 * the real wrapper through the built server.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { capabilityDecision, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import { CANVAS_SEASON_KEY } from "../../shared/canvasSeason";
import { deleteConfigDocument, readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { SEASON_PEN_REFUSAL, register } from "./canvasSeason";

const configured = testDbConfigured();
if (!configured) console.warn("[canvasSeason.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

/** The people in this village, by the bearer token each one sends. */
const PEOPLE: Record<string, { id: string; name: string; role: string; roleCapabilities: string[] }> = {
  pen: { id: "season-pen", name: "Wren Halloway", role: "member", roleCapabilities: ["story.tell"] },
  member: { id: "season-member", name: "Ash Brook", role: "member", roleCapabilities: [] },
  admin: { id: "season-admin", name: "Moss Fielding", role: "admin", roleCapabilities: [] },
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

const season = (over: Record<string, unknown> = {}) => ({
  id: "test-season",
  name: "A test season",
  timezone: "Europe/Amsterdam",
  weeks: [
    { number: 1, date: "2026-10-03", title: "Purpose first", blocks: ["purpose"] },
    { number: 2, date: "2026-10-10", title: "Who decides", blocks: ["power", "conflict"], foundations: ["internal-rules"] },
  ],
  moons: [{ date: "2026-10-10", blocks: [], note: "A canvas moon." }],
  ...over,
});

const stored = () => readConfigDocument<any>(pool, CANVAS_SEASON_KEY);

describe.skipIf(!configured)("the canvas season routes", () => {
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
    app.use(express.json({ limit: "1mb" }));
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
    await deleteConfigDocument(pool, CANVAS_SEASON_KEY);
  });

  describe("a visitor with no session", () => {
    it("is refused on every door, and nothing is stored or removed", async () => {
      expect((await call("GET", "/api/canvas/season", null)).status).toBe(401);
      expect((await call("PUT", "/api/canvas/season", null, season())).status).toBe(401);
      expect(await stored()).toBeNull();

      await call("PUT", "/api/canvas/season", "pen", season());
      expect((await call("DELETE", "/api/canvas/season", null)).status).toBe(401);
      expect((await stored())?.season?.id).toBe("test-season");
    });
  });

  describe("a member reads", () => {
    it("an empty answer, in words, when no season is loaded", async () => {
      const r = await call("GET", "/api/canvas/season", "member");
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ season: null, savedBy: null, savedAt: null, problem: null, mayEdit: false });
    });

    it("the season the pen loaded, with who loaded it and when", async () => {
      await call("PUT", "/api/canvas/season", "pen", season());
      const r = await call("GET", "/api/canvas/season", "member");
      expect(r.status).toBe(200);
      expect(r.body.season).toMatchObject({ id: "test-season", name: "A test season", timezone: "Europe/Amsterdam" });
      expect(r.body.season.weeks.map((w: any) => [w.number, w.blocks])).toEqual([
        [1, ["purpose"]],
        [2, ["power", "conflict"]],
      ]);
      expect(r.body.savedBy).toEqual({ id: "season-pen", name: "Wren" });
      expect(Number.isNaN(Date.parse(r.body.savedAt))).toBe(false);
      expect(r.body.mayEdit).toBe(false);
    });

    it("tells the pen and a pre-handover admin they may load one, and a plain member they may not", async () => {
      expect((await call("GET", "/api/canvas/season", "pen")).body.mayEdit).toBe(true);
      expect((await call("GET", "/api/canvas/season", "admin")).body.mayEdit).toBe(true);
      expect((await call("GET", "/api/canvas/season", "member")).body.mayEdit).toBe(false);
    });
  });

  describe("the pen writes", () => {
    it("loads a season, stores exactly what the validator returned, and names what it left out", async () => {
      const r = await call("PUT", "/api/canvas/season", "pen", { ...season({ name: "  A test season  " }), colour: "green" });
      expect(r.status).toBe(200);
      expect(r.body.ignored).toEqual(["colour"]);
      expect(r.body.savedBy).toEqual({ id: "season-pen", name: "Wren" });
      const doc = await stored();
      expect(doc.savedBy).toBe("season-pen");
      expect(doc.season).toEqual(r.body.season);
      expect(doc.season.name).toBe("A test season");
      expect(JSON.stringify(doc)).not.toContain("green");
    });

    it("replaces the season before it, whole", async () => {
      await call("PUT", "/api/canvas/season", "pen", season());
      await call("PUT", "/api/canvas/season", "pen", season({ id: "second", weeks: [{ number: 1, date: "2027-01-09", title: "Again" }] }));
      const doc = await stored();
      expect(doc.season.id).toBe("second");
      expect(doc.season.weeks).toHaveLength(1);
    });

    it("takes the Season Two template the platform ships", async () => {
      const file = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "seasons", "season-two-2026.json"), "utf8"));
      const r = await call("PUT", "/api/canvas/season", "admin", file);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.ignored).toEqual([]);
      expect((await stored()).season.weeks).toHaveLength(13);
    });

    it("removes the season, and a second removal says there was nothing to remove", async () => {
      await call("PUT", "/api/canvas/season", "pen", season());
      const first = await call("DELETE", "/api/canvas/season", "pen");
      expect(first).toEqual({ status: 200, body: { removed: true } });
      expect(await stored()).toBeNull();
      expect((await call("GET", "/api/canvas/season", "member")).body.season).toBeNull();
      expect(await call("DELETE", "/api/canvas/season", "pen")).toEqual({ status: 200, body: { removed: false } });
    });

    it("lets an admin load and remove one before the handover, as for the village's other words", async () => {
      expect((await call("PUT", "/api/canvas/season", "admin", season())).status).toBe(200);
      expect((await call("GET", "/api/canvas/season", "member")).body.savedBy).toEqual({ id: "season-admin", name: "Moss" });
      expect((await call("DELETE", "/api/canvas/season", "admin")).status).toBe(200);
    });

    it("hands an admin the gate's own answer once the village holds the pen, and its holder still writes", async () => {
      villageHeld = ["story.tell"];
      expect((await call("PUT", "/api/canvas/season", "admin", season())).status).toBe(409);
      expect((await call("GET", "/api/canvas/season", "admin")).body.mayEdit).toBe(false);
      expect(await stored()).toBeNull();
      expect((await call("PUT", "/api/canvas/season", "pen", season())).status).toBe(200);
      expect((await call("DELETE", "/api/canvas/season", "admin")).status).toBe(409);
      expect((await stored())?.season?.id).toBe("test-season");
    });
  });

  describe("a member without the pen", () => {
    it("is refused with 403 and the route's own sentence, and cannot load a season", async () => {
      const r = await call("PUT", "/api/canvas/season", "member", season());
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ error: SEASON_PEN_REFUSAL });
      expect(await stored()).toBeNull();
    });

    it("cannot remove one either", async () => {
      await call("PUT", "/api/canvas/season", "pen", season());
      const r = await call("DELETE", "/api/canvas/season", "member");
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ error: SEASON_PEN_REFUSAL });
      expect((await stored())?.season?.id).toBe("test-season");
    });
  });

  describe("a bad file", () => {
    const refused = async (body: unknown) => {
      const r = await call("PUT", "/api/canvas/season", "pen", body);
      expect(r.status, JSON.stringify(body).slice(0, 120)).toBe(400);
      expect(typeof r.body.error).toBe("string");
      expect(r.body.errors[0]).toBe(r.body.error);
      return r.body.error as string;
    };

    it("is refused in the validator's words: an unknown block, a bad date, too many weeks, oversized text", async () => {
      expect(await refused(season({ weeks: [{ number: 1, date: "2026-10-03", title: "x", blocks: ["vibes"] }] }))).toMatch(
        /"vibes" is not one of the twelve canvas blocks/,
      );
      expect(await refused(season({ weeks: [{ number: 1, date: "2026-02-30", title: "x" }] }))).toMatch(/real date written YYYY-MM-DD/);
      const weeks = Array.from({ length: 61 }, (_, i) => ({
        number: i + 1,
        date: new Date(Date.UTC(2026, 9, 3 + 7 * i)).toISOString().slice(0, 10),
        title: `Week ${i + 1}`,
      }));
      expect(await refused(season({ weeks }))).toBe("A season holds at most 60 weeks.");
      expect(await refused(season({ name: "n".repeat(121) }))).toMatch(/longer than 120 characters/);
      expect(await refused(season({ timezone: "Nowhere/Special" }))).toMatch(/timezone/);
    });

    it("stores nothing, and leaves the season before it where it was", async () => {
      await refused(season({ weeks: [] }));
      expect(await stored()).toBeNull();
      await call("PUT", "/api/canvas/season", "pen", season());
      await refused(season({ id: "broken", weeks: [{ number: 1, date: "soon", title: "x" }] }));
      expect((await stored()).season.id).toBe("test-season");
    });
  });

  describe("what was stored", () => {
    it("is checked again on read, and a document that no longer passes is reported, never rendered", async () => {
      await writeConfigDocument(pool, CANVAS_SEASON_KEY, {
        season: { ...season(), weeks: [{ number: 1, date: "2026-10-03", title: "x", blocks: ["retired-block"] }] },
        savedBy: "season-pen",
        savedAt: "2026-10-01T00:00:00.000Z",
      });
      const r = await call("GET", "/api/canvas/season", "member");
      expect(r.status).toBe(200);
      expect(r.body.season).toBeNull();
      expect(r.body.problem).toMatch(/^The stored season could not be read: .*"retired-block" is not one of the twelve canvas blocks/);
    });

    it("names nobody once the account that loaded it is gone", async () => {
      await pool.query( // module-review-ok: a fixture member on the scratch schema this suite provisioned
        "INSERT INTO users (id, name, email, password_hash, role) VALUES ('season-gone','Tamsin Vale','season-gone@example.invalid','x','admin')",
      );
      await writeConfigDocument(pool, CANVAS_SEASON_KEY, { season: season(), savedBy: "season-gone", savedAt: "2026-10-01T00:00:00.000Z" });
      expect((await call("GET", "/api/canvas/season", "member")).body.savedBy).toEqual({ id: "season-gone", name: "Tamsin" });
      await pool.query("DELETE FROM users WHERE id = 'season-gone'"); // module-review-ok: removing the fixture account so the season outlives it
      expect((await call("GET", "/api/canvas/season", "member")).body.savedBy).toEqual({ id: "season-gone", name: "Someone" });
    });
  });
});
