/**
 * Safety on physical quests, through the real routes against a real MySQL
 * (build days S5; spec US5, R2, R3, R10, R12; Rye 2026-11-09: 18, or 16 for
 * light work beside a named adult, never machines or heights).
 *
 *  - a physical quest asks 18 of a member who has not said their band, and
 *    refuses one whose band is younger;
 *  - a member says their band once, and cannot change it alone;
 *  - a quest asking a safety badge refuses until the member holds it,
 *    unexpired, and only an earned or granted badge may gate;
 *  - joining a crew on a physical quest asks the same gate (a crew invite
 *    used to let anyone onto the site);
 *  - changing the rules names the open claims they now refuse.
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
import { forgetAgeBand, ageBandOf, putQuestSafety } from "../repos/questSafety";
import { register as registerQuestRoutes } from "./quests";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[questSafety.routes.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

type Person = { id: string; name: string };
const ADA: Person = { id: "u-ada", name: "Ada Wren" };
const TEO: Person = { id: "u-teo", name: "Teo Lund" };
const SAM: Person = { id: "u-sam", name: "Sam Ortiz" };

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";
let quests: QuestsRepo;
let signedIn: Person = ADA;
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

async function badge(id: string, kind: string) {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned
    "INSERT INTO `badges` (`id`, `name`, `kind`, `capabilities`) VALUES (?,?,?, '[]')",
    [id, `Badge ${id}`, kind],
  );
}

async function award(badgeId: string, userId: string, expiresAt: Date | null = null) {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned
    "INSERT INTO `badge_awards` (`id`, `badge_id`, `user_id`, `expires_at`) VALUES (?,?,?,?)", // module-review-ok: test fixture into the S5 scratch schema, never a production table
    [`aw-${badgeId}-${userId}`, badgeId, userId, expiresAt],
  );
}

describe.skipIf(!configured)("safety on physical quests (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    quests = questsRepo(pool);
    const deps: any = {
      isAdmin: async () => admin,
      authedUser: async () => signedIn,
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
    };
    const app = express();
    app.use(express.json());
    registerQuestRoutes(app, deps);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

    await badge("heights", "granted");
    await badge("saw", "earned");
    await badge("i-like-tools", "self");
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    signedIn = ADA;
    admin = false;
  });

  it("asks 18 of a physical quest's claimer who has not said their band, then lets an adult through", async () => {
    await add("s-floor");
    await putQuestSafety(pool, { questId: "s-floor", physical: true, minAge: null, requiredBadges: [], safetyNote: "Boots on site.", estimateHours: 6 }, "admin");
    const first = await call("POST", "/api/game/quests/s-floor/claim");
    expect(first.status).toBe(403);
    expect(first.body).toMatchObject({ minAge: 18, needsAgeBand: true });

    expect((await call("POST", "/api/me/age-band", { band: "18plus" })).status).toBe(200);
    expect((await call("POST", "/api/game/quests/s-floor/claim")).status).toBe(200);
  });

  it("refuses a member whose band is younger than the quest asks, and the band cannot be changed alone", async () => {
    signedIn = TEO;
    await add("s-roof");
    await putQuestSafety(pool, { questId: "s-roof", physical: true, minAge: null, requiredBadges: [], safetyNote: null, estimateHours: null }, "admin");
    expect((await call("POST", "/api/me/age-band", { band: "16to17" })).status).toBe(200);
    const r = await call("POST", "/api/game/quests/s-roof/claim");
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: "Everyone on this quest is at least 18. The board has other quests open to you.", minAge: 18 });

    const change = await call("POST", "/api/me/age-band", { band: "18plus" });
    expect(change.status, "a member says their band once").toBe(409);
    expect(await ageBandOf(pool, TEO.id)).toBe("16to17");
  });

  it("lets a 16-year-old onto light work that asks 16, and refuses a physical quest set below 16", async () => {
    signedIn = TEO;
    await add("s-light");
    admin = true;
    expect((await call("PUT", "/api/admin/quests/s-light/safety", { physical: true, minAge: 14 })).status).toBe(400);
    expect((await call("PUT", "/api/admin/quests/s-light/safety", { physical: true, minAge: 16 })).status).toBe(200);
    admin = false;
    expect((await call("POST", "/api/game/quests/s-light/claim")).status).toBe(200);
  });

  it("refuses until the member holds every safety badge, unexpired, and names what is missing", async () => {
    signedIn = SAM;
    await call("POST", "/api/me/age-band", { band: "18plus" });
    await add("s-saw");
    await putQuestSafety(pool, { questId: "s-saw", physical: true, minAge: null, requiredBadges: ["saw", "heights"], safetyNote: null, estimateHours: null }, "admin");
    await award("saw", SAM.id);
    await award("heights", SAM.id, new Date(Date.now() - 60_000));
    const r = await call("POST", "/api/game/quests/s-saw/claim");
    expect(r.status).toBe(403);
    expect(r.body.missingBadges, "an expired certificate is no certificate").toEqual(["heights"]);
    expect(r.body.error).toContain("Badge heights");

    await pool.query("UPDATE `badge_awards` SET `expires_at` = NULL WHERE `id` = ?", [`aw-heights-${SAM.id}`]); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned
    expect((await call("POST", "/api/game/quests/s-saw/claim")).status).toBe(200);
  });

  it("lets only an earned or granted badge gate a quest", async () => {
    admin = true;
    await add("s-self");
    const r = await call("PUT", "/api/admin/quests/s-self/safety", { physical: true, requiredBadges: ["i-like-tools"] });
    expect(r.status).toBe(400);
    expect(r.body.refused).toEqual(["i-like-tools"]);
  });

  it("runs the gate when someone joins a crew on a physical quest by its invite", async () => {
    await add("s-crew");
    await putQuestSafety(pool, { questId: "s-crew", physical: true, minAge: null, requiredBadges: [], safetyNote: null, estimateHours: null }, "admin");
    signedIn = ADA; // an adult, band set above
    const formed = await call("POST", "/api/quests/s-crew/crews", { name: "Floor crew" });
    expect(formed.status).toBe(200);

    signedIn = TEO; // sixteen or seventeen
    const joined = await call("POST", `/api/crews/join/${formed.body.inviteCode}`);
    expect(joined.status, "an invite is not a way past the site's age").toBe(403);
    expect(joined.body.minAge).toBe(18);
  });

  it("names the open claims that new rules now refuse", async () => {
    await add("s-change");
    signedIn = TEO;
    expect((await call("POST", "/api/game/quests/s-change/claim")).status).toBe(200);
    admin = true;
    const r = await call("PUT", "/api/admin/quests/s-change/safety", { physical: true });
    expect(r.status).toBe(200);
    expect(r.body.openClaimsNowRefused).toHaveLength(1);
  });

  it("forgets a member's band on erasure", async () => {
    await forgetAgeBand(pool, TEO.id);
    expect(await ageBandOf(pool, TEO.id)).toBeNull();
  });
});
