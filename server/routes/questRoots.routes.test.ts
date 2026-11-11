/**
 * The roots a quest grows from, through the real routes against a real MySQL
 * (the five archetypes as roots, 11 Nov 2026):
 *
 *  - an admin sets one to three of the village's roots, and the public board
 *    carries them on the quest;
 *  - a fourth root, or a key the village's cast does not hold, is refused by
 *    name and nothing is written;
 *  - a person's word clears the boot seed's "suggested" flag;
 *  - an ordinary quest save that does not mention roots leaves them alone;
 *  - a root never gates a claim.
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
import { crewsRepo as makeCrewsRepo } from "../lib/crews";
import { seedEconomy } from "../lib/economySeed";
import { villageId } from "../lib/economy";
import { register as registerQuestRoutes } from "./quests";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[questRoots.routes.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";
let quests: QuestsRepo;
let admin = false;

const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { // module-review-ok: the suite's own in-process server on 127.0.0.1, never an outbound call, so there is no correlation id to carry
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};

const add = (id: string) => quests.add({ id, title: `Quest ${id}`, gratitude: "10", status: "Open", tags: [], order: 1 } as any);
const onBoard = async (id: string) => ((await call("GET", "/api/quests")).body as any[]).find((q) => q.id === id);

describe.skipIf(!configured)("the roots a quest grows from (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    quests = questsRepo(pool);
    await seedEconomy(pool, villageId());
    const deps: any = {
      isAdmin: async () => admin,
      authedUser: async () => ({ id: "u-ada", name: "Ada Wren" }),
      adminActor: () => (admin ? { id: "admin" } : null),
      getPool: () => pool,
      uploadsDir: os.tmpdir(),
      members: { all: async () => [], byId: async () => null, update: async () => null },
      questsRepo: quests,
      claimsRepo: claimsRepo(pool),
      crewsRepo: makeCrewsRepo(pool),
      firstName: (n: string) => String(n).split(" ")[0],
      notify: async () => {},
      stageOf: async () => "member",
      loadRoles: () => [],
      roleIdsFor: () => [],
      currentPatternId: () => null,
      questConsentRecipients: async () => [],
      overLimit: async () => false,
      clientIp: () => "127.0.0.1",
      projectCurrency: () => "USD",
      limitState: async () => "ok",
      questNextStep: async () => null,
      minimumAgesOn: () => false,
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
    admin = true;
  });

  it("sets one to three roots and the public board carries them", async () => {
    await add("r-books");
    const r = await call("PUT", "/api/admin/quests/r-books/roots", { roots: ["researching", "catalyzing", "building"] });
    expect(r.status).toBe(200);
    expect(r.body.roots).toEqual(["researching", "catalyzing", "building"]);
    const q = await onBoard("r-books");
    expect(q.archetypes).toEqual(["researching", "catalyzing", "building"]);
    expect(q.archetypesSuggested).toBe(false);
  });

  it("refuses a fourth root and writes nothing", async () => {
    await add("r-four");
    await call("PUT", "/api/admin/quests/r-four/roots", { roots: ["building"] });
    const r = await call("PUT", "/api/admin/quests/r-four/roots", { roots: ["building", "researching", "facilitating", "storytelling"] });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("up to 3");
    expect((await onBoard("r-four")).archetypes).toEqual(["building"]);
  });

  it("refuses a key the village's cast does not hold, naming it", async () => {
    await add("r-wizard");
    const r = await call("PUT", "/api/admin/quests/r-wizard/roots", { roots: ["wizard"] });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("wizard");
  });

  it("is an admin's door only", async () => {
    await add("r-closed");
    admin = false;
    expect((await call("PUT", "/api/admin/quests/r-closed/roots", { roots: ["building"] })).status).toBe(401);
  });

  it("clears the seed's guess flag, and an ordinary save leaves the roots alone", async () => {
    await add("r-guess");
    await pool.query("UPDATE `quests` SET `archetypes` = '[\"storytelling\"]', `archetypes_suggested` = 1 WHERE `id` = 'r-guess'"); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned
    expect((await onBoard("r-guess")).archetypesSuggested).toBe(true);
    await call("PUT", "/api/admin/quests/r-guess/roots", { roots: ["storytelling", "facilitating"] });
    expect((await onBoard("r-guess")).archetypesSuggested).toBe(false);
    const save = await call("PUT", "/api/admin/quests/r-guess", { title: "A new title" });
    expect(save.status).toBe(200);
    const q = await onBoard("r-guess");
    expect(q.title).toBe("A new title");
    expect(q.archetypes).toEqual(["storytelling", "facilitating"]);
  });

  it("never gates a claim: a quest with roots is open to a member who plays none of them", async () => {
    await add("r-open");
    await call("PUT", "/api/admin/quests/r-open/roots", { roots: ["building"] });
    admin = false;
    expect((await call("POST", "/api/game/quests/r-open/claim")).status).toBe(200);
  });
});
