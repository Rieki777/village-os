/**
 * Every refusal of the one claim gate, through the board's real claim route
 * against a real MySQL: the same statuses and sentences the route always gave,
 * now decided by shared/questClaimGate.ts. The map's door maps the same typed
 * refusals through MAP_REASON_FOR (shared/questClaimGate.test.ts).
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and the suite skips loudly.
 */
import http from "node:http";
import os from "node:os";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { claimsRepo, questsRepo, type QuestsRepo } from "../repos/quests";
import { register as registerQuestRoutes } from "./quests";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[questClaimGate.routes.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

const ADA = { id: "u-ada", name: "Ada Wren" };

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";
let quests: QuestsRepo;
let stage = "guest";
let roles: string[] = [];

const claim = async (id: string) => {
  const r = await fetch(`${base}/api/game/quests/${id}/claim`, { method: "POST" }); // module-review-ok: the suite's own in-process server on 127.0.0.1, never an outbound call, so there is no correlation id to carry
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};

const add = (id: string, extra: Record<string, unknown> = {}) =>
  quests.add({ id, title: `Quest ${id}`, gratitude: "10", status: "Open", tags: [], order: 1, ...extra } as any);

describe.skipIf(!configured)("the one claim gate, through the board's door (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    quests = questsRepo(pool);
    const deps: any = {
      isAdmin: async () => false,
      authedUser: async () => ADA,
      adminActor: () => null,
      getPool: () => pool,
      uploadsDir: os.tmpdir(),
      members: { all: async () => [], byId: async () => null, update: async () => null },
      questsRepo: quests,
      claimsRepo: claimsRepo(pool),
      crewsRepo: { forQuest: async () => [] },
      firstName: (n: string) => String(n).split(" ")[0],
      notify: async () => {},
      stageOf: async () => stage,
      loadRoles: () => [{ id: "builders", name: "Builders" }],
      roleIdsFor: () => roles,
      currentPatternId: () => null,
      questConsentRecipients: async () => [],
      overLimit: async () => false,
      clientIp: () => "127.0.0.1",
      projectCurrency: () => "USD",
      limitState: async () => "ok",
      questNextStep: async () => null,
    };
    const app = express();
    app.use(express.json());
    registerQuestRoutes(app, deps);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    stage = "guest";
    roles = [];
  });

  it("refuses a closed quest with 409 and its status", async () => {
    await add("g-closed", { status: "Closed" });
    const r = await claim("g-closed");
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: "This quest is closed, so it is not taking new claims. The board has others open.", status: "Closed" });
  });

  it("refuses below the stage floor with 403 naming it, and lets the member through once they reach it", async () => {
    await add("g-stage", { minStage: "member" });
    const r = await claim("g-stage");
    expect(r.status).toBe(403);
    expect(r.body.minStage).toBe("member");
    expect(r.body.error).toMatch(/^This quest opens at the .+ stage\. Keep walking the path and it will unlock\.$/);
    stage = "member";
    expect((await claim("g-stage")).status).toBe(200);
  });

  it("refuses a quest reserved for a role the member lacks with 403 naming the role", async () => {
    await add("g-role", { requiresRole: "builders" });
    const r = await claim("g-role");
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: "This quest is reserved for Builders. Ask a founder about joining.", requiresRole: "builders" });
    roles = ["builders"];
    expect((await claim("g-role")).status).toBe(200);
  });

  it("lets an open quest with no asks through", async () => {
    await add("g-open");
    const r = await claim("g-open");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("claimed");
  });
});
