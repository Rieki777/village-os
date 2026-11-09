/**
 * "EDIT THIS ROLE" over real HTTP against a real database (role journey, PR-B).
 *
 * The gate is the REAL `capabilityDecision` (as in orgDraftDecide.test.ts) fed a
 * context this file controls, so what is under test is the editor's reading of
 * the publish door, never a stub that agrees with it by construction.
 *
 * The four things the brief names, each with its control:
 *   1. a holder of `org.decide` who is NOT an admin edits and publishes in one save;
 *   2. a member without the power sees no editor, and every route refuses (the
 *      same request from the holder succeeds);
 *   3. "Use Sera's range" never writes: reading it leaves the terms as they were,
 *      and only a save carrying the group puts it on offer;
 *   4. the history shows the change, and one click puts it back.
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
import { liveParameterKeys } from "../lib/roleParameterColumns";

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
  const [rows]: any = await pool.query("SELECT aim, domain, recruiting, terms_offer, terms_offer_by FROM org_roles WHERE id = ?", [id]);
  return rows[0];
};

describe.skipIf(!configured)("Edit this role", () => {
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

  beforeEach(() => {
    holders = new Set();
  });

  describe("who may edit", () => {
    it("a holder of org.decide who is not an admin edits and publishes in one save", async () => {
      const { id } = await seedRole();
      holders = new Set(["holder-1"]);
      expect((await call("GET", "/api/org/role-edit/access", "holder-1")).json.door).toBe("power");
      const saved = await call("POST", `/api/org/role-edit/${id}`, "holder-1", { words: { aim: "Keep the reading room alive" } });
      expect(saved.status).toBe(200);
      expect(saved.json.changed).toEqual(["Purpose"]);
      expect((await row(id)).aim).toBe("Keep the reading room alive");
      const [[draft]]: any = await pool.query("SELECT d.status, d.source_kind, d.published_by FROM org_drafts d JOIN org_draft_changes c ON c.draft_id = d.id WHERE c.org_role_id = ? AND d.title LIKE 'Edit role:%'", [id]);
      expect([draft.status, draft.source_kind, draft.published_by]).toEqual(["published", "human", "holder-1"]);
    });

    it("a member without the power sees no editor and every route refuses; the holder's same request succeeds", async () => {
      const { id } = await seedRole();
      expect((await call("GET", "/api/org/role-edit/access", "member-1")).json.door).toBeNull();
      expect((await call("GET", "/api/org/role-edit/access", null)).json.door).toBeNull();
      const body = { words: { aim: "A word the member must not be able to write" } };
      for (const [method, route, payload] of [
        ["GET", `/api/org/role-edit/${id}`, undefined],
        ["POST", `/api/org/role-edit/${id}`, body],
        ["GET", `/api/org/role-edit/${id}/history`, undefined],
        ["GET", `/api/org/role-edit/${id}/sera`, undefined],
        ["POST", `/api/org/role-edit/${id}/history/none/revert`, {}],
        ["POST", "/api/org/role-edit/new-from-card", { text: "x" }],
      ] as const) {
        expect((await call(method, route, "member-1", payload)).status, `${method} ${route}`).toBe(403);
        expect((await call(method, route, null, payload)).status, `${method} ${route} signed out`).toBe(401);
      }
      expect((await row(id)).aim).toBe("Old aim");
      // The control: the same request from a holder is the one that works.
      holders = new Set(["holder-1"]);
      expect((await call("POST", `/api/org/role-edit/${id}`, "holder-1", body)).status).toBe(200);
      expect((await row(id)).aim).toBe(body.words.aim);
    });

    it("an admin is let in until the village launches by vote, as for any draft", async () => {
      const { id } = await seedRole();
      expect((await call("GET", "/api/org/role-edit/access", "admin-1")).json.door).toBe("admin");
      expect((await call("POST", `/api/org/role-edit/${id}`, "admin-1", { words: { domain: "Decides the shelves" } })).status).toBe(200);
    });
  });

  describe("what a save writes", () => {
    beforeEach(() => {
      holders = new Set(["holder-1"]);
    });

    it("refuses a save that changes nothing, and writes no draft", async () => {
      const { id } = await seedRole();
      const [[before]]: any = await pool.query("SELECT COUNT(*) AS n FROM org_drafts");
      const r = await call("POST", `/api/org/role-edit/${id}`, "holder-1", { words: { aim: "Old aim" } });
      expect(r.status).toBe(400);
      const [[after]]: any = await pool.query("SELECT COUNT(*) AS n FROM org_drafts");
      expect(after.n).toBe(before.n);
    });

    it("refuses words that look like payment details, in the proposal parser's own sentence", async () => {
      const { id } = await seedRole();
      const r = await call("POST", `/api/org/role-edit/${id}`, "holder-1", { words: { aim: "Pay to account 4111 1111 1111 1111" } });
      expect(r.status).toBe(400);
      expect((await row(id)).aim).toBe("Old aim");
    });

    it("writes the door state", async () => {
      const { id } = await seedRole();
      expect((await row(id)).recruiting).toBe(0);
      const r = await call("POST", `/api/org/role-edit/${id}`, "holder-1", { parameters: { recruiting: true } });
      expect(r.status).toBe(200);
      expect((await row(id)).recruiting).toBe(1);
    });

    it("names the listing details in words when this database has no column for them, and writes the ones it has", async () => {
      const { id } = await seedRole();
      const live = await liveParameterKeys(pool);
      const r = await call("POST", `/api/org/role-edit/${id}`, "holder-1", { parameters: { track: "volunteer" } });
      if (live.includes("track")) expect(r.status).toBe(200);
      else {
        expect(r.status).toBe(409);
        expect(r.json.error).toMatch(/listing details/);
      }
    });

    it("refuses to list a card that has not passed the gate, and says what is missing", async () => {
      const { id } = await seedRole();
      const live = await liveParameterKeys(pool);
      if (!live.includes("listed")) return;
      const r = await call("POST", `/api/org/role-edit/${id}`, "holder-1", { parameters: { listed: true } });
      expect(r.status).toBe(409);
      expect(r.json.fields).toContain("Selection criteria");
    });
  });

  describe("Sera's range", () => {
    beforeEach(() => {
      holders = new Set(["holder-1"]);
    });

    it("reading Sera's version and range writes nothing; only a save carrying the group puts it on offer", async () => {
      const { id } = await seedRole();
      const before = await row(id);
      const sera = await call("GET", `/api/org/role-edit/${id}/sera`, "holder-1");
      expect(sera.status).toBe(200);
      expect(sera.json).toHaveProperty("pay");
      expect(await row(id)).toEqual(before);
      const [[drafts]]: any = await pool.query("SELECT COUNT(*) AS n FROM org_draft_changes WHERE org_role_id = ? AND op = 'update_seat'", [id]);
      expect(drafts.n).toBe(0);
      // The person's save is what writes it.
      const group = { kind: "range", currency: "USD", minMinor: 100000, maxMinor: 150000, per: "month", note: "Funding-dependent" };
      const saved = await call("POST", `/api/org/role-edit/${id}`, "holder-1", { pay: group });
      expect(saved.status).toBe(200);
      const after = await row(id);
      const terms = typeof after.terms_offer === "string" ? JSON.parse(after.terms_offer) : after.terms_offer;
      expect(terms.pay).toMatchObject(group);
      expect(after.terms_offer_by).toBe("holder-1");
    });

    it("refuses a pay group the terms' own parser refuses", async () => {
      const { id } = await seedRole();
      const r = await call("POST", `/api/org/role-edit/${id}`, "holder-1", { pay: { kind: "range", currency: "USD", minMinor: 500, maxMinor: 100, per: "month" } });
      expect(r.status).toBe(400);
      expect((await row(id)).terms_offer).toBeNull();
    });

    it("taking the pay off the terms puts the role back to no terms on offer", async () => {
      const { id } = await seedRole();
      await call("POST", `/api/org/role-edit/${id}`, "holder-1", { pay: { kind: "honorary" } });
      expect((await row(id)).terms_offer).not.toBeNull();
      const r = await call("POST", `/api/org/role-edit/${id}`, "holder-1", { pay: null });
      expect(r.status).toBe(200);
      expect((await row(id)).terms_offer).toBeNull();
    });
  });

  describe("history and revert", () => {
    beforeEach(() => {
      holders = new Set(["holder-1"]);
    });

    it("the history shows who, when and what, and one click puts the change back", async () => {
      const { id } = await seedRole();
      await call("POST", `/api/org/role-edit/${id}`, "holder-1", { words: { aim: "First new aim" } });
      const h = await call("GET", `/api/org/role-edit/${id}/history`, "holder-1");
      const edit = h.json.entries.find((e: any) => e.fromEditor);
      expect(edit).toMatchObject({ status: "published", canRevert: true });
      expect(edit.changes).toEqual([{ field: "aim", label: "Purpose", before: "Old aim", after: "First new aim" }]);
      expect(edit.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const back = await call("POST", `/api/org/role-edit/${id}/history/${edit.draftId}/revert`, "holder-1");
      expect(back.status).toBe(200);
      expect((await row(id)).aim).toBe("Old aim");
      const again = await call("GET", `/api/org/role-edit/${id}/history`, "holder-1");
      expect(again.json.entries.find((e: any) => e.draftId === edit.draftId)).toMatchObject({ status: "reverted", canRevert: false });
    });

    it("only the newest change can be put back; an older one waits, and nothing is lost", async () => {
      const { id } = await seedRole();
      await call("POST", `/api/org/role-edit/${id}`, "holder-1", { words: { aim: "Aim one" } });
      await call("POST", `/api/org/role-edit/${id}`, "holder-1", { words: { domain: "Domain two" } });
      const h = await call("GET", `/api/org/role-edit/${id}/history`, "holder-1");
      const editor = h.json.entries.filter((e: any) => e.fromEditor);
      expect(editor).toHaveLength(2);
      const [newest, older] = editor;
      expect([newest.canRevert, older.canRevert]).toEqual([true, false]);
      const refused = await call("POST", `/api/org/role-edit/${id}/history/${older.draftId}/revert`, "holder-1");
      expect(refused.status).toBe(409);
      expect((await row(id)).aim).toBe("Aim one");
      expect((await call("POST", `/api/org/role-edit/${id}/history/${newest.draftId}/revert`, "holder-1")).status).toBe(200);
      expect((await row(id)).domain).toBe("Old domain");
      expect((await row(id)).aim).toBe("Aim one");
    });

    it("a pay group put on offer is put back with the rest", async () => {
      const { id } = await seedRole();
      await call("POST", `/api/org/role-edit/${id}`, "holder-1", { pay: { kind: "honorary" } });
      const h = await call("GET", `/api/org/role-edit/${id}/history`, "holder-1");
      const edit = h.json.entries.find((e: any) => e.fromEditor);
      expect(edit.changes[0].label).toBe("Pay on offer");
      await call("POST", `/api/org/role-edit/${id}/history/${edit.draftId}/revert`, "holder-1");
      expect((await row(id)).terms_offer).toBeNull();
    });
  });

  describe("bringing in a card", () => {
    beforeEach(() => {
      holders = new Set(["holder-1"]);
    });

    it("reads a card against the role and shows only what changed, writing nothing", async () => {
      const { id } = await seedRole();
      const state = await call("GET", `/api/org/role-edit/${id}`, "holder-1");
      const title = state.json.state.name;
      const card = `Village role card v1\n\n## Role title\n${title}\nRole id: ${id}\n\n### Purpose\nA brand new purpose\n\n### What it looks after\nOld domain\n`;
      const r = await call("POST", `/api/org/role-edit/${id}/import`, "holder-1", { text: card });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ isCard: true, matched: true });
      expect(Object.keys(r.json.words)).toEqual(["aim"]);
      expect(r.json.words.aim).toMatchObject({ before: "Old aim", after: "A brand new purpose", label: "Purpose" });
      expect((await row(id)).aim).toBe("Old aim");
    });

    it("says so when the card is for a different role", async () => {
      const { id } = await seedRole();
      const r = await call("POST", `/api/org/role-edit/${id}/import`, "holder-1", { text: "Village role card v1\n\n## Role title\nSomebody Else Entirely\n\n### Purpose\nWords\n\n### What it looks after\nMore words\n" });
      expect(r.json).toMatchObject({ isCard: true, matched: false });
      expect(r.json.sentence).toMatch(/New role from a card/);
    });

    it("exports the role as a card the import reads back to no change", async () => {
      const { id } = await seedRole();
      const text = (await call("GET", `/api/org/role-edit/${id}/text`, "holder-1")).text;
      expect(text).toMatch(/role card v1/i);
      const r = await call("POST", `/api/org/role-edit/${id}/import`, "holder-1", { text });
      expect(r.json.matched).toBe(true);
      expect(r.json.words).toEqual({});
      expect(r.json.problems.filter((p: any) => p.blocks)).toEqual([]);
    });

    it("makes a new role from a card in the chosen circle, with the door closed", async () => {
      const { circle } = await seedRole();
      const card = "Village role card v1\n\n## Role title\nLantern Keeper\n\n### Purpose\nKeep the lanterns lit\n\n### What it looks after\nThe lantern shelf\n";
      const preview = await call("POST", "/api/org/role-edit/new-from-card", "holder-1", { text: card, circleId: circle });
      expect(preview.status).toBe(200);
      expect(preview.json).toMatchObject({ created: false, title: "Lantern Keeper", circleId: circle });
      expect(preview.json.problems.filter((p: any) => p.blocks)).toEqual([]);
      const made = await call("POST", "/api/org/role-edit/new-from-card", "holder-1", { text: card, circleId: circle, create: true });
      expect(made.status).toBe(200);
      expect(made.json.created).toBe(true);
      const [[created]]: any = await pool.query("SELECT name, circle_id, recruiting, aim FROM org_roles WHERE id = ?", [made.json.roleId]);
      expect(created).toMatchObject({ name: "Lantern Keeper", circle_id: circle, recruiting: 0, aim: "Keep the lanterns lit" });
    });

    it("refuses a new role without a circle, and a card that is not new", async () => {
      const { id } = await seedRole();
      const state = await call("GET", `/api/org/role-edit/${id}`, "holder-1");
      const noCircle = await call("POST", "/api/org/role-edit/new-from-card", "holder-1", { text: "Village role card v1\n\n## Role title\nStray Role\n\n### Purpose\nWords\n\n### What it looks after\nMore\n", create: true });
      expect(noCircle.status).toBe(409);
      const existing = await call("POST", "/api/org/role-edit/new-from-card", "holder-1", { text: `Village role card v1\n\n## Role title\n${state.json.state.name}\nRole id: ${id}\n\n### Purpose\nWords\n`, create: true, circleId: "x" });
      expect(existing.status).toBe(409);
    });
  });
});
