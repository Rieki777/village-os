/**
 * The founder's agent drafts the map: the brief, the gate, and the two calls,
 * over real HTTP against a real scratch schema.
 *
 * What only a database proves here: the draft lands in the holder's own row
 * byte for byte, it forks from the version that is live, nothing at all is
 * written before the yes, and the trail names an agent. The resolver is a
 * stand-in for the agent block's own (`resolveAgent` in server/index.ts), and
 * it records what it was asked, so the scope and the kind each route asks for
 * are asserted and not assumed. The capability gate is the real one.
 *
 * The example draft the brief hands an agent is held to the same gate a real
 * draft passes, outside the database block, so it is checked on every run.
 */
import http from "node:http";
import { createHash } from "node:crypto";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CapabilityCtx } from "../../shared/capabilities";
import { DRAFT_SCENE_VERSION, draftSceneProblems } from "../../shared/mapFromMasterplan";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { keepMasterplan } from "../lib/mapMasterplan";
import { getDraft, publishScene, saveDraft } from "../lib/mapScene";
import { DRAFT_RULES, exampleDraft, register } from "./agentMap";

describe("what the brief hands an agent", () => {
  it("carries an example the gate accepts, at the version the gate wants", () => {
    expect(draftSceneProblems(exampleDraft())).toEqual([]);
    expect((exampleDraft() as any).map_scene.version).toBe(DRAFT_SCENE_VERSION);
  });

  it("says the lines a generator keeps, plainly", () => {
    expect(DRAFT_RULES.join("\n")).toMatch(/Draw only what the masterplan shows/);
    expect(DRAFT_RULES.join("\n")).toMatch(/Nothing you send is live/);
  });
});

const MAP_MAKER: CapabilityCtx = { stageIndex: 0, stageIndexOf: () => 1e9, roleCapabilities: ["map.edit"] };
const MEMBER: CapabilityCtx = { stageIndex: 0, stageIndexOf: () => 1e9, roleCapabilities: [] };

describe.skipIf(!testDbConfigured())("the agent's map routes", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  /** Who the stand-in resolver says holds the token, and with what context. */
  let holder: { id: string } | null = { id: "founder-1" };
  let ctx: CapabilityCtx = MAP_MAKER;
  const resolverAsked: { scope: string; kind: string }[] = [];

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
    const app = express();
    app.use(express.json({ limit: "8mb" }));
    register(app, {
      resolveAgent: async (_req, res, scope, kind) => {
        resolverAsked.push({ scope, kind });
        if (!holder) {
          res.status(401).json({ error: "auth_required" });
          return null;
        }
        return { row: { id: "atk-1", prefix: "vat_abc123" } as any, user: holder };
      },
      capabilityCtx: async () => ctx,
      getPool: () => pool as any,
      confirmSecret: "a-test-secret-that-is-long-enough",
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
    await db?.drop();
  });

  beforeEach(async () => {
    holder = { id: "founder-1" };
    ctx = MAP_MAKER;
    resolverAsked.length = 0;
    await pool.query("DELETE FROM map_scene_revisions");
    await pool.query("DELETE FROM map_scene_drafts");
    await pool.query("DELETE FROM app_config WHERE config_key = 'map-masterplan'");
    await pool.query("DELETE FROM health_events WHERE kind = 'map_draft'");
  });

  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const drafts = async () => {
    const [rows] = await pool.query<any[]>("SELECT user_id, scene, base_version FROM map_scene_drafts");
    return rows;
  };
  const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

  describe("who may", () => {
    it("asks the agent block's resolver for map.draft, as a read and as a write", async () => {
      await call("GET", "/api/agent/v1/map");
      await call("POST", "/api/agent/v1/map/draft", { scene: exampleDraft() });
      expect(resolverAsked).toEqual([{ scope: "map.draft", kind: "read" }, { scope: "map.draft", kind: "write" }]);
    });

    it("answers what the resolver answers when there is no holder", async () => {
      holder = null;
      expect((await call("GET", "/api/agent/v1/map")).status).toBe(401);
      expect((await call("POST", "/api/agent/v1/map/draft", { scene: exampleDraft() })).status).toBe(401);
      expect(await drafts()).toEqual([]);
    });

    it("refuses a holder who may not draft the land, and writes nothing", async () => {
      ctx = MEMBER;
      const brief = await call("GET", "/api/agent/v1/map");
      expect(brief.status).toBe(403);
      expect(brief.body.error).toBe("map_edit_required");
      const sent = await call("POST", "/api/agent/v1/map/draft", { scene: exampleDraft(), confirm: true });
      expect(sent.status).toBe(403);
      expect(await drafts()).toEqual([]);
    });
  });

  describe("the brief", () => {
    it("hands over the method, the schema, the rules and where to send the draft", async () => {
      const { status, body } = await call("GET", "/api/agent/v1/map");
      expect(status).toBe(200);
      expect(body.method).toMatch(/^# /);
      expect(body.rules).toEqual([...DRAFT_RULES]);
      expect(body.schema.version).toBe(DRAFT_SCENE_VERSION);
      expect(body.schema.world).toEqual({ w: 2400, h: 1600 });
      expect(body.schema.archetypes).toContain("greenhouse");
      expect(body.schema.emptyBlocks).toContain("quests");
      expect(body.live).toEqual({ version: 0 });
      expect(body.draft).toBeNull();
      expect(body.masterplan).toBeNull();
      expect(body.ground).toMatchObject({ configured: false, spanM: null, centre: null, seedFrame: false });
      expect(body.submit).toEqual({ method: "POST", url: `${base}/api/agent/v1/map/draft` });
      expect(body.reviewUrl).toBe(`${base}/map`);
    });

    it("hands over the masterplan as a link on this village", async () => {
      await keepMasterplan(pool as any, {
        url: "/api/uploads/masterplan-1790000000000-abcde.pdf", filename: "masterplan-1790000000000-abcde.pdf",
        originalName: "Plan.pdf", kind: "pdf", mimeType: "application/pdf", bytes: 2048, width: null, height: null,
        uploadedBy: "founder-1", uploadedAt: "2026-10-02T10:00:00.000Z",
      });
      const { body } = await call("GET", "/api/agent/v1/map");
      expect(body.masterplan).toMatchObject({ url: `${base}/api/uploads/masterplan-1790000000000-abcde.pdf`, kind: "pdf", originalName: "Plan.pdf" });
      expect(body.masterplan.uploadedBy, "who uploaded it is not the agent's business").toBeUndefined();
    });
  });

  describe("the two calls", () => {
    it("refuses a draft that breaks the rules, says every reason, and writes nothing", async () => {
      const bad = exampleDraft() as any;
      bad.quests = [{ title: "Invented quest" }];
      bad.map_structures[0].origin_story = "Raised in nine days.";
      const { status, body } = await call("POST", "/api/agent/v1/map/draft", { scene: bad, confirm: true });
      expect(status).toBe(400);
      expect(body.error).toBe("draft_refused");
      expect(body.problems).toEqual([
        expect.stringMatching(/origin_story must be empty/),
        expect.stringMatching(/quests must be empty/),
      ]);
      expect(await drafts()).toEqual([]);
    });

    it("echoes first and writes nothing, then keeps the exact text after the yes, forked from live", async () => {
      const text = JSON.stringify(exampleDraft());
      const first = await call("POST", "/api/agent/v1/map/draft", { scene: text });
      expect(first.status).toBe(202);
      expect(first.body.echo).toEqual({ sceneSha256: sha(text), buildings: 1, features: 2, flows: 0, changes: 3, liveVersion: 0, replaces: null });
      expect(await drafts(), "nothing before the yes").toEqual([]);

      const second = await call("POST", "/api/agent/v1/map/draft", {
        scene: text, confirm: true, confirmToken: first.body.confirmToken, echo: first.body.echo,
      });
      expect(second.status).toBe(200);
      expect(second.body.success).toBe(true);
      const kept = await getDraft(pool as any, "founder-1");
      expect(kept?.scene).toBe(text);
      expect(kept?.baseVersion).toBe(0);
      const [trail] = await pool.query<any[]>("SELECT text, actor_kind, audience FROM health_events WHERE kind = 'map_draft'");
      expect(trail).toEqual([{ text: "kept a drafted map from their agent (vat_abc123...): 1 buildings, 2 features", actor_kind: "agent", audience: "admin" }]);
    });

    it("hashes an object the way it hashes its text, so either form confirms", async () => {
      const scene = exampleDraft();
      const asObject = await call("POST", "/api/agent/v1/map/draft", { scene });
      expect(asObject.body.echo.sceneSha256).toBe(sha(JSON.stringify(scene)));
      const done = await call("POST", "/api/agent/v1/map/draft", {
        scene, confirm: true, confirmToken: asObject.body.confirmToken, echo: asObject.body.echo,
      });
      expect(done.status).toBe(200);
    });

    it("refuses a yes carried over to a different scene", async () => {
      const first = await call("POST", "/api/agent/v1/map/draft", { scene: exampleDraft() });
      const other = exampleDraft() as any;
      other.map_structures[0].name = "Another Hall";
      const second = await call("POST", "/api/agent/v1/map/draft", {
        scene: other, confirm: true, confirmToken: first.body.confirmToken, echo: first.body.echo,
      });
      expect(second.status).toBe(409);
      expect(second.body.error).toBe("echo_mismatch");
      expect(await drafts()).toEqual([]);
    });

    it("refuses a yes given by another holder's agent", async () => {
      const first = await call("POST", "/api/agent/v1/map/draft", { scene: exampleDraft() });
      holder = { id: "someone-else" };
      const second = await call("POST", "/api/agent/v1/map/draft", {
        scene: exampleDraft(), confirm: true, confirmToken: first.body.confirmToken, echo: first.body.echo,
      });
      expect(second.status).toBe(409);
      expect(second.body.error).toBe("wrong_holder");
      expect(await drafts()).toEqual([]);
    });

    it("says when it would replace work the founder has in progress, and refuses if that work moved before the yes", async () => {
      const mine = JSON.stringify({ ...exampleDraft(), map_edits: [{ seq: 1, actor: "founder", action: "rename", target: "structure:x", at: "2026-10-01T00:00:00.000Z" }] });
      await saveDraft(pool as any, "founder-1", mine, 0);
      const first = await call("POST", "/api/agent/v1/map/draft", { scene: exampleDraft() });
      expect(first.body.echo.replaces).toMatchObject({ buildings: 1, changes: 1 });
      expect(first.body.message).toMatch(/REPLACES the unpublished draft/);
      // The founder keeps working between the two calls.
      await saveDraft(pool as any, "founder-1", mine.replace("2026-10-01", "2026-10-02"), 0);
      const second = await call("POST", "/api/agent/v1/map/draft", {
        scene: exampleDraft(), confirm: true, confirmToken: first.body.confirmToken, echo: first.body.echo,
      });
      expect(second.status).toBe(409);
      expect((await getDraft(pool as any, "founder-1"))?.scene, "the founder's newer work is untouched").toContain("2026-10-02");
    });

    it("forks from the live version on a village that has published", async () => {
      const live = await publishScene(pool as any, { scene: JSON.stringify(exampleDraft()), baseVersion: 0, actorUserId: "founder-1" });
      expect(live.ok).toBe(true);
      const first = await call("POST", "/api/agent/v1/map/draft", { scene: exampleDraft() });
      expect(first.body.echo.liveVersion).toBe(1);
      const second = await call("POST", "/api/agent/v1/map/draft", {
        scene: exampleDraft(), confirm: true, confirmToken: first.body.confirmToken, echo: first.body.echo,
      });
      expect(second.status).toBe(200);
      expect((await getDraft(pool as any, "founder-1"))?.baseVersion).toBe(1);
    });

    it("refuses a scene that is not JSON, and a missing one, writing nothing", async () => {
      expect((await call("POST", "/api/agent/v1/map/draft", { scene: "{not json" })).body.error).toBe("scene_not_json");
      expect((await call("POST", "/api/agent/v1/map/draft", {})).body.error).toBe("scene_required");
      expect(await drafts()).toEqual([]);
    });
  });
});
