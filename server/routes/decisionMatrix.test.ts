/**
 * THE DECISION MATRIX ROUTE over real HTTP, against a real database
 * (plan 2.3 and 7 item 3).
 *
 * What a person meets: a visitor is asked to sign in, an account the village
 * has not admitted is told whose the canvas is, and a member reads the whole
 * matrix, with every transferable power in it and the village's own holdings
 * behind the powers' rows. A power the village has taken on, written through
 * the same function a carried handover uses, shows its holding role by name.
 *
 * The two holder readers are handed in the way server/index.ts hands them to
 * server/routes/powerHands.ts; here they answer from a map the test sets.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import http from "node:http";
import express from "express";
import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { HANDOVER_SET } from "../../shared/capabilities";
import { VETO_OVERRIDE_NOTE, type DecisionMatrix } from "../../shared/decisionMatrix";
import { moveCapabilityToVillage } from "../lib/capabilityHolding";
import { loadModuleSettings } from "../lib/modules";
import { CANVAS_MEMBERS_ONLY } from "./canvas";
import { MATRIX_UNREADABLE, register } from "./decisionMatrix";

const configured = testDbConfigured();
if (!configured) console.warn("[decisionMatrix.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

/** The people in this village, by the bearer token each one sends. */
const PEOPLE: Record<string, { id: string; name: string; role: string; membershipGranted: boolean }> = {
  member: { id: "dm-member", name: "Ash Brook", role: "member", membershipGranted: true },
  admin: { id: "dm-admin", name: "Moss Fielding", role: "admin", membershipGranted: false },
  stranger: { id: "dm-stranger", name: "Rook Talbot", role: "member", membershipGranted: false },
};

let db: TestDb;
let pool: Pool;
let server: http.Server;
let base = "";
/** Who holds each power live, as `liveHoldersOf` would answer. */
let live: Record<string, string[]> = {};
/** Which roles carry each power, as `rolesCarrying` would answer. */
let carrying: Record<string, Array<{ id: string; name: string }>> = {};
/** Set to make the holdings read fail, the way a lost connection would. */
let breakPool = false;

const who = (req: express.Request) => {
  const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
  return PEOPLE[token] ?? null;
};

async function call(as: keyof typeof PEOPLE | null) {
  const r = await fetch(`${base}/api/canvas/decision-matrix`, { // module-review-ok: the test client dialling its own in-process server on localhost, as every route suite does
    headers: as ? { Authorization: `Bearer ${as}` } : {},
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
}

/** Put the governance module at a lifecycle, or take its row away (off), and reload the cache the route reads. */
async function governanceAt(lifecycle: "members" | null) {
  await pool.query("DELETE FROM module_settings WHERE module_id = 'governance'"); // module-review-ok: fixture SQL against the scratch schema this suite provisioned
  if (lifecycle) {
    await pool.query( // module-review-ok: fixture SQL against the scratch schema this suite provisioned
      "INSERT INTO module_settings (module_id, lifecycle, config) VALUES ('governance', ?, NULL)",
      [lifecycle],
    );
  }
  await loadModuleSettings(pool);
}

const rowOf = (m: DecisionMatrix, key: string) => m.groups.flatMap((g) => g.rows).find((r) => r.key === key);

describe.skipIf(!configured)("GET /api/canvas/decision-matrix", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    for (const p of Object.values(PEOPLE)) {
      await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)",
        [p.id, p.name, `${p.id}@example.invalid`, "x", p.role],
      );
    }
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO roles (id, name, capabilities) VALUES ('dm-keepers','The Dial Keepers',?) " +
        "ON DUPLICATE KEY UPDATE name = VALUES(name), capabilities = VALUES(capabilities)",
      [JSON.stringify(["dial.set"])],
    );

    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async (req) => who(req),
      isAdmin: async (req) => ["admin", "founder"].includes(who(req)?.role ?? ""),
      hasMembership: (user) => !!(user as { membershipGranted?: boolean }).membershipGranted,
      getPool: () =>
        breakPool
          ? ({ query: async () => { throw new Error("connection lost"); } } as unknown as Pool)
          : pool,
      liveHoldersOf: async (cap) => live[cap] ?? [],
      rolesCarrying: (cap) => carrying[cap] ?? [],
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
    live = {};
    carrying = {};
    breakPool = false;
    await pool.query("DELETE FROM capability_holding"); // module-review-ok: each case starts from a village holding nothing, on the scratch schema this suite provisioned
    await governanceAt(null);
  });

  describe("who may read", () => {
    it("asks a visitor with no session to sign in, and says nothing else", async () => {
      const r = await call(null);
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: "auth_required" });
    });

    it("tells a signed-in account the village has not admitted whose the canvas is", async () => {
      const r = await call("stranger");
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ error: CANVAS_MEMBERS_ONLY });
    });

    it("gives an admitted member the whole matrix, and an admin too", async () => {
      for (const as of ["member", "admin"] as const) {
        const r = await call(as);
        expect(r.status, as).toBe(200);
        const m = r.body as DecisionMatrix;
        expect(m.groups.map((g) => g.id)).toEqual(["votes", "moving-power", "powers"]);
        expect(m.groups[2].rows.map((row) => row.key)).toEqual(HANDOVER_SET.map((c) => `power:${c}`));
        expect(m.vetoOverrideAvailable).toBe(false);
        expect(m.sensing.enforced).toBe(false);
        expect(m.notes).toContain(VETO_OVERRIDE_NOTE);
      }
    });
  });

  describe("read from the village as it stands", () => {
    it("a fresh village holds nothing, so every power is the admin panel's, with the roles that carry it named", async () => {
      carrying["dial.set"] = [{ id: "dm-keepers", name: "The Dial Keepers" }];
      const m = (await call("member")).body as DecisionMatrix;
      for (const cap of HANDOVER_SET) expect(rowOf(m, `power:${cap}`)?.approval.who, cap).toBe("admin-panel");
      expect(rowOf(m, "power:dial.set")?.approval.text).toContain("So does anyone seated in The Dial Keepers.");
      // The Powers page's own heading rides along.
      expect(rowOf(m, "power:dial.set")?.detail).toBeTruthy();
    });

    it("a power the village took on shows the role holding it, and who can act comes from the live count", async () => {
      const moved = await moveCapabilityToVillage(pool, { capability: "dial.set", holderRoleId: "dm-keepers" });
      expect(moved).toEqual({ ok: true });

      const empty = (await call("member")).body as DecisionMatrix;
      expect(rowOf(empty, "power:dial.set")?.approval.who).toBe("roll");
      expect(rowOf(empty, "power:dial.set")?.approval.text).toContain("with The Dial Keepers, and nobody is seated there today");

      live["dial.set"] = ["dm-member"];
      const seated = (await call("member")).body as DecisionMatrix;
      expect(rowOf(seated, "power:dial.set")?.approval.who).toBe("holder");
      // A role's name, never a person's.
      expect(JSON.stringify(seated)).not.toContain("Ash Brook");
      expect(rowOf(seated, "power:story.tell")?.approval.who).toBe("admin-panel");
    });

    it("counts the seated stewards from the same live reader, once governance is on for members", async () => {
      await governanceAt("members");
      const none = (await call("member")).body as DecisionMatrix;
      expect(rowOf(none, "vote:mechanics:constitutional")?.stewardStop).toBe("nobody-seated");
      live["steward.veto"] = ["dm-member"];
      const one = (await call("member")).body as DecisionMatrix;
      expect(rowOf(one, "vote:mechanics:constitutional")?.stewardStop).toBe("in-reach");
      expect(rowOf(one, "vote:village_launch")?.approval.who).toBe("roll");
    });

    it("a scratch village has governance off, so its votes cannot be held and its rule changes go to Hypha", async () => {
      const m = (await call("member")).body as DecisionMatrix;
      expect(rowOf(m, "vote:village_launch")?.approval.who).toBe("not-yet");
      expect(rowOf(m, "vote:mechanics:routine")?.approval.who).toBe("hypha");
    });

    it("says so in words when the holdings cannot be read", async () => {
      breakPool = true;
      const r = await call("member");
      expect(r.status).toBe(503);
      expect(r.body).toEqual({ error: MATRIX_UNREADABLE });
    });
  });
});
