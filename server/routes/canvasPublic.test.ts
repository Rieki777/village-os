/**
 * THE CANVAS IN PUBLIC over real HTTP, against a real database (2026-09-28).
 *
 * What a person meets: anybody reads every block's public line; the pen
 * writes one, and is refused, in words, a line that names somebody the
 * village has admitted; a line that comes to name somebody after it was
 * written is held back from the read; and anybody reads the Decision Matrix
 * rows the platform generates.
 *
 * ── WHAT IS REAL AND WHAT IS A MODEL ───────────────────────────────────────
 *
 * The `content` document is the real one (`dbDocument` over the scratch
 * schema's app_config), so a write is proved by reading the row back. The
 * roster is a list this file holds, so a member can join or change their name
 * between two reads. The gate is the model server/routes/canvas.test.ts uses:
 * the REAL decision (`capabilityDecision`) in a copy of `guardCapability`'s
 * wrapper. server/canvas.routes.e2e.test.ts drives the real wrapper, and the
 * generic content door's refusal, through the built server.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import http from "node:http";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { capabilityDecision, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import { CANVAS_BLOCK_IDS } from "../../shared/governanceCanvas";
import { CANVAS_PUBLIC_MATRIX_PATH, CANVAS_PUBLIC_PATH, PUBLIC_LINE_WORDS } from "../../shared/canvasPublicLines";
import { dbDocument, type DbDocument } from "../repos/store-db";
import type { UsersRepo } from "../repos/users";
import { nameRefusal } from "../lib/canvasNames";
import { PUBLIC_LINE_PEN_REFUSAL, PUBLIC_LINES_UNREADABLE, register } from "./canvasPublic";

const configured = testDbConfigured();
if (!configured) console.warn("[canvasPublic.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

interface Person {
  id: string;
  name: string;
  email: string;
  role: string;
  roleCapabilities: string[];
  membershipGranted: boolean;
}

/** The people behind the bearer tokens. The admin is deliberately NOT admitted as a member. */
const PEOPLE: Record<string, Person> = {
  pen: { id: "cp-pen", name: "Wren Halloway", email: "wren@example.test", role: "member", roleCapabilities: ["story.tell"], membershipGranted: true },
  member: { id: "cp-member", name: "Ash Brook", email: "ash@example.test", role: "member", roleCapabilities: [], membershipGranted: true },
  admin: { id: "cp-admin", name: "Moss Fielding", email: "moss@example.test", role: "admin", roleCapabilities: [], membershipGranted: false },
  stranger: { id: "cp-stranger", name: "Rook Talbot", email: "rook@example.test", role: "member", roleCapabilities: [], membershipGranted: false },
};

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";
let villageHeld: string[] = [];
/** The roster `members.all()` answers with. A case may add a person or rename one. */
let roster: Person[] = [];
let rosterBroken = false;
const content = { repo: null as DbDocument<any> | null };

const who = (req: express.Request) => {
  const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
  return PEOPLE[token] ?? null;
};

const ctxFor = (user: Person): CapabilityCtx => ({
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
  const text = await r.text();
  let json: any;
  try { json = JSON.parse(text); } catch { /* left undefined; the text is kept */ }
  return { status: r.status, body: json, text };
}

const put = (block: string, line: unknown, as: keyof typeof PEOPLE | null = "pen") =>
  call("PUT", `${CANVAS_PUBLIC_PATH}/${block}`, as, { line });

/** The stored `content` document, read from the table and not from the route's cache. */
async function storedContent(): Promise<Record<string, any>> {
  const fresh = dbDocument<any>(pool, "content", {});
  await fresh.load();
  return fresh.get();
}

describe.skipIf(!configured)("the canvas in public", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    content.repo = dbDocument<any>(pool, "content", {});
    await content.repo.load();

    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async (req) => who(req),
      isAdmin: async (req) => ["admin", "founder"].includes(who(req)?.role ?? ""),
      hasMembership: (user) => !!(user as { membershipGranted?: boolean }).membershipGranted,
      getPool: () => pool,
      liveHoldersOf: async () => [],
      rolesCarrying: () => [],
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
      members: {
        all: async () => {
          if (rosterBroken) throw new Error("connection lost");
          return roster.map((p) => ({ ...p }));
        },
      } as unknown as UsersRepo,
      contentRepo: content.repo,
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
    roster = Object.values(PEOPLE).map((p) => ({ ...p }));
    rosterBroken = false;
    // Another section of the same document, which a canvas write must leave alone.
    await content.repo!.put({ team: [{ name: "The founding circle" }] });
  });

  describe("reading", () => {
    it("answers a visitor with every block in canvas order, nothing written yet", async () => {
      const r = await call("GET", CANVAS_PUBLIC_PATH, null);
      expect(r.status, r.text).toBe(200);
      expect(r.body.blocks.map((b: any) => b.id)).toEqual([...CANVAS_BLOCK_IDS]);
      for (const b of r.body.blocks) expect(b).toEqual({ id: b.id, line: null, withheld: false });
    });

    it("answers a signed-in member exactly as it answers a visitor", async () => {
      expect((await put("purpose", "We restore the watershed together.")).status).toBe(200);
      const visitor = await call("GET", CANVAS_PUBLIC_PATH, null);
      const member = await call("GET", CANVAS_PUBLIC_PATH, "member");
      expect(member.text).toBe(visitor.text);
      expect(visitor.body.blocks[0]).toEqual({ id: "purpose", line: "We restore the watershed together.", withheld: false });
    });

    it("fails closed when the roster cannot be read: 503 and no line", async () => {
      expect((await put("purpose", "We restore the watershed together.")).status).toBe(200);
      rosterBroken = true;
      const r = await call("GET", CANVAS_PUBLIC_PATH, null);
      expect(r.status).toBe(503);
      expect(r.body).toEqual({ error: PUBLIC_LINES_UNREADABLE });
      expect(r.text).not.toContain("watershed");
    });
  });

  describe("who may write", () => {
    it("asks a visitor to sign in", async () => {
      const r = await put("purpose", "We restore the watershed.", null);
      expect(r.status).toBe(401);
      expect((await storedContent()).canvas).toBeUndefined();
    });

    it("refuses a member without the pen, and an account the village has not admitted, in the route's words", async () => {
      for (const as of ["member", "stranger"] as const) {
        const r = await put("purpose", "We restore the watershed.", as);
        expect(r.status, as).toBe(403);
        expect(r.body).toEqual({ error: PUBLIC_LINE_PEN_REFUSAL });
      }
      expect((await storedContent()).canvas).toBeUndefined();
    });

    it("lets the pen write, stores the line under `canvas`, and leaves the rest of the document alone", async () => {
      const r = await put("conflict", "  Our care holder answers within two days.  ");
      expect(r.status, r.text).toBe(200);
      expect(r.body.block).toEqual({ id: "conflict", line: "Our care holder answers within two days.", withheld: false });
      const stored = await storedContent();
      expect(stored.canvas).toEqual({ conflict: "Our care holder answers within two days." });
      expect(stored.team).toEqual([{ name: "The founding circle" }]);
    });

    it("lets an admin write before the handover, and hands them the gate's 409 once the village holds the pen", async () => {
      expect((await put("roles", "Each circle keeps its own list of roles.", "admin")).status).toBe(200);
      villageHeld = ["story.tell"];
      expect((await put("roles", "A changed line.", "admin")).status).toBe(409);
      expect((await storedContent()).canvas).toEqual({ roles: "Each circle keeps its own list of roles." });
    });

    it("takes a block's line down when the pen saves it empty", async () => {
      await put("purpose", "We restore the watershed.");
      await put("impact", "We count the birds each spring.");
      const r = await put("purpose", "   ");
      expect(r.status).toBe(200);
      expect(r.body.block).toEqual({ id: "purpose", line: null, withheld: false });
      expect((await storedContent()).canvas).toEqual({ impact: "We count the birds each spring." });
    });

    it("refuses a block that is not on the canvas, and a line with a break in it", async () => {
      const unknown = await put("people", "Anything.");
      expect(unknown.status).toBe(404);
      expect(unknown.body).toEqual({ error: PUBLIC_LINE_WORDS.notABlock });
      const broken = await put("purpose", "one\ntwo");
      expect(broken.status).toBe(400);
      expect(broken.body).toEqual({ error: PUBLIC_LINE_WORDS.oneLine });
      expect((await storedContent()).canvas).toBeUndefined();
    });
  });

  describe("the name check on the write", () => {
    it("refuses a line holding a member's first name, in any case, and stores nothing", async () => {
      for (const [line, quoted] of [
        ["Ash keeps the keys to the seed store.", "Ash"],
        ["the keys stay with ASH BROOK until spring", "ASH BROOK"],
        ["Ask wren first.", "wren"],
      ]) {
        const r = await put("roles", line);
        expect(r.status, line).toBe(400);
        expect(r.body).toEqual({ error: nameRefusal(quoted) });
      }
      expect((await storedContent()).canvas).toBeUndefined();
    });

    it("refuses an admin's name though the admin was never admitted as a member", async () => {
      const r = await put("power", "Moss signs off the budget.");
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: nameRefusal("Moss") });
    });

    it("keeps a line whose words only contain a name, and one naming nobody the village admitted (controls)", async () => {
      expect((await put("meetings", "We meet by the ashes of the old barn, on Ashford Lane.")).status).toBe(200);
      // Rook registered and was never admitted, so the name is not on the list (server/lib/canvasNames.ts).
      expect((await put("stakeholders", "Rook Talbot, a neighbour, joins the spring walk.")).status).toBe(200);
      expect((await storedContent()).canvas).toEqual({
        meetings: "We meet by the ashes of the old barn, on Ashford Lane.",
        stakeholders: "Rook Talbot, a neighbour, joins the spring walk.",
      });
    });

    it("refuses a name split by an invisible character, because the line is tidied before it is checked", async () => {
      const r = await put("roles", `A${String.fromCharCode(0x200b)}sh keeps the keys.`);
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: nameRefusal("Ash") });
    });

    it("fails closed when the roster cannot be read: 503, nothing stored", async () => {
      rosterBroken = true;
      const r = await put("purpose", "We restore the watershed.");
      expect(r.status).toBe(503);
      expect((await storedContent()).canvas).toBeUndefined();
    });
  });

  describe("the name check on the read", () => {
    it("holds back a line once somebody the village admits carries a name in it, and serves it again when they leave", async () => {
      expect((await put("purpose", "Juniper trees shade the whole of the upper field.")).status).toBe(200);
      // Control: before anybody called Juniper is admitted, the line is served.
      expect((await call("GET", CANVAS_PUBLIC_PATH, null)).body.blocks[0].line).toMatch(/^Juniper trees/);

      roster.push({ id: "cp-juniper", name: "Juniper Vale", email: "juniper@example.test", role: "member", roleCapabilities: [], membershipGranted: true });
      const held = await call("GET", CANVAS_PUBLIC_PATH, null);
      expect(held.body.blocks[0]).toEqual({ id: "purpose", line: null, withheld: true });
      expect(held.text).not.toContain("Juniper");
      // Only that block is held back.
      expect(held.body.blocks[1]).toEqual({ id: "team", line: null, withheld: false });

      roster.pop();
      expect((await call("GET", CANVAS_PUBLIC_PATH, null)).body.blocks[0].withheld).toBe(false);
    });

    it("holds back a line when a member changes their display name to one it holds", async () => {
      expect((await put("impact", "A heron nests by the river each spring, and we count its young.")).status).toBe(200);
      roster.find((p) => p.id === "cp-member")!.name = "Heron Brook";
      const r = await call("GET", CANVAS_PUBLIC_PATH, null);
      expect(r.body.blocks[11]).toEqual({ id: "impact", line: null, withheld: true });
      expect(r.text).not.toContain("nests by the river");
    });
  });

  describe("the Decision Matrix, in public", () => {
    it("answers a visitor and an account the village has not admitted with the generated rows, naming nobody", async () => {
      for (const as of [null, "stranger"] as const) {
        const r = await call("GET", CANVAS_PUBLIC_MATRIX_PATH, as);
        expect(r.status, r.text).toBe(200);
        expect(r.body.groups.map((g: any) => g.id)).toEqual(["votes", "moving-power", "powers"]);
        expect(r.body.groups[0].rows.length).toBeGreaterThan(0);
        for (const person of Object.values(PEOPLE)) {
          expect(r.text).not.toContain(person.name.split(" ")[0]);
          expect(r.text).not.toContain(person.id);
        }
      }
    });
  });

  it("records who wrote a public line, for the admins", async () => {
    await put("learning", "We look back together at every new moon.");
    let found = 0;
    for (let i = 0; i < 20 && !found; i += 1) {
      const [rows] = await pool.query( // module-review-ok: reading back the audit row this suite's write produced, on its own scratch schema
        "SELECT actor_user_id, audience FROM health_events WHERE text = 'canvas:public-line:write:learning'",
      );
      found = (rows as any[]).length;
      if (found) expect((rows as any[])[0]).toMatchObject({ actor_user_id: "cp-pen", audience: "admin" });
      else await new Promise((r) => setTimeout(r, 100));
    }
    expect(found).toBe(1);
  });
});
