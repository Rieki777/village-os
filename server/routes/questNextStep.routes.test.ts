/**
 * The next-step box after a claim, driven through the real claim route and the
 * real resolver against a real MySQL: the claim answers with `next`, the box
 * can be read again later, the claimer gets one bell, and the talk-to role is
 * named with its LIVE holders only (a lapsed or documented holder is nobody to
 * talk to).
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
import { createOrgRole, seatHolder } from "../lib/orgChart";
import { makeQuestNextStep } from "../lib/questNextStep";
import { register as registerQuestRoutes } from "./quests";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[questNextStep.routes.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

type Person = { id: string; name: string };
const ADA: Person = { id: "u-ada", name: "Ada Wren" };
const RICK: Person = { id: "u-rick", name: "Rick Moss" };

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";
let quests: QuestsRepo;
let signedIn: Person = ADA;
let rung: Array<{ userId: string; type: string; title: string; dedupeKey: string; link: string }> = [];
let circles: Array<{ id: string; name: string; aliases?: string[]; leadRoleId: string | null }> = [];
let failResolver = false;

const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { // module-review-ok: the suite's own in-process server on 127.0.0.1, never an outbound call, so there is no correlation id to carry
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};

describe.skipIf(!configured)("the next-step box after a claim (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    quests = questsRepo(pool);
    const crews = makeCrewsRepo(pool);
    const names = new Map([ADA, RICK].map((p) => [p.id, p.name]));
    const resolver = makeQuestNextStep({
      getPool: () => pool,
      circles: () => circles,
      crewsForQuest: (id) => crews.forQuest(id),
      lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
      memberName: async (id) => names.get(id) ?? null,
    });
    const deps: any = {
      isAdmin: async () => false,
      authedUser: async () => signedIn,
      adminActor: () => null,
      getPool: () => pool,
      uploadsDir: os.tmpdir(),
      members: { all: async () => [], byId: async () => null, update: async () => null },
      questsRepo: quests,
      claimsRepo: claimsRepo(pool),
      crewsRepo: crews,
      firstName: (n: string) => String(n).split(" ")[0],
      notify: async (n: any) => {
        rung.push({ userId: n.userId, type: n.type, title: n.title, dedupeKey: n.dedupeKey, link: n.link });
      },
      stageOf: async () => "member",
      loadRoles: () => [],
      roleIdsFor: () => [],
      currentPatternId: () => null,
      questConsentRecipients: async () => [],
      overLimit: async () => false,
      clientIp: () => "127.0.0.1",
      projectCurrency: () => "USD",
      limitState: async () => "ok",
      questNextStep: async (q: any, u: string) => {
        if (failResolver) throw new Error("the roster is unreachable");
        return resolver(q, u);
      },
    };
    const app = express();
    app.use(express.json());
    registerQuestRoutes(app, deps);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

    await createOrgRole(pool, { id: "build-steward", name: "Build Steward", seats: 1 });
    await seatHolder(pool, "build-steward", { userId: RICK.id });
    await createOrgRole(pool, { id: "liaison", name: "Liaison", seats: 1 });
    await seatHolder(pool, "liaison", { displayName: "Someone without an account" });
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    rung = [];
    signedIn = ADA;
    failResolver = false;
    circles = [{ id: "dev", name: "Development", aliases: ["Build"], leadRoleId: "build-steward" }];
  });

  it("answers a claim with the box: the circle lead role and its live holder, the first step, a crew to start, the date", async () => {
    await quests.add({
      id: "q-floor", title: "Lay the earth floor", gratitude: "50", status: "Open", tags: [], order: 1,
      circle: "Build", firstStep: "Walk the site with the steward", steps: ["Mix the clay"], startsAt: "2027-01-10T14:00:00.000Z",
    } as any);
    const r = await call("POST", "/api/game/quests/q-floor/claim");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("claimed");
    expect(r.body.next.talkTo).toMatchObject({ kind: "role", roleId: "build-steward", circleId: "dev", source: "circle", vacant: false });
    expect(r.body.next.talkToLive).toEqual({ roleName: "Build Steward", circleName: "Development", holders: ["Rick"] });
    expect(r.body.next.firstTask).toEqual({ kind: "step", text: "Walk the site with the steward" });
    expect(r.body.next.crew).toEqual({ kind: "start", questId: "q-floor" });
    expect(r.body.next.when).toEqual({ kind: "date", at: "2027-01-10T14:00:00.000Z", source: "starts" });
  });

  it("rings the claimer once, naming the quest and no person, and the box reads again later", async () => {
    await quests.add({ id: "q-bell", title: "Seal the floor", gratitude: "10", status: "Open", tags: [], order: 2, circle: "Development" } as any);
    const r = await call("POST", "/api/game/quests/q-bell/claim");
    expect(r.status).toBe(200);
    expect(rung).toEqual([
      { userId: ADA.id, type: "quest_claimed", title: "You took on Seal the floor", dedupeKey: `quest_claimed:${r.body.id}`, link: "/quests/q-bell" },
    ]);
    expect(rung[0].title).not.toContain("Rick");

    const again = await call("GET", "/api/game/quests/q-bell/next");
    expect(again.status).toBe(200);
    expect(again.body.claimId).toBe(r.body.id);
    expect(again.body.next.talkToLive.holders).toEqual(["Rick"]);

    signedIn = RICK;
    expect((await call("GET", "/api/game/quests/q-bell/next")).status, "only the member holding a claim reads its box").toBe(404);
  });

  it("calls a role whose only holder has no account vacant, so the box offers the role and never a person", async () => {
    circles = [{ id: "dev", name: "Development", leadRoleId: "liaison" }];
    await quests.add({ id: "q-liaison", title: "Meet the neighbours", gratitude: "10", status: "Open", tags: [], order: 3, circle: "Development" } as any);
    const r = await call("POST", "/api/game/quests/q-liaison/claim");
    expect(r.body.next.talkTo).toMatchObject({ kind: "role", roleId: "liaison", vacant: true });
    expect(r.body.next.talkToLive.holders).toEqual([]);
  });

  it("gives a crew member the crew's own invite path", async () => {
    await quests.add({ id: "q-crew", title: "Raise the tent", gratitude: "10", status: "Open", tags: [], order: 4 } as any);
    const crew = await makeCrewsRepo(pool).create({ id: "crew-1", questId: "q-crew", name: "Tent crew", creatorId: ADA.id, maxSize: 6 });
    const r = await call("POST", "/api/game/quests/q-crew/claim");
    expect(r.body.next.crew).toEqual({ kind: "invite", crewId: "crew-1", path: `/quests/q-crew?crew=${crew.inviteCode}`, size: 1 });
    expect(r.body.next.talkTo).toEqual({ kind: "none" });
  });

  it("keeps a made claim when the box cannot be gathered: the claim stands and next is null", async () => {
    failResolver = true;
    await quests.add({ id: "q-fail", title: "Carry the stones", gratitude: "10", status: "Open", tags: [], order: 5 } as any);
    const r = await call("POST", "/api/game/quests/q-fail/claim");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("claimed");
    expect(r.body.next).toBeNull();
    expect((await call("GET", "/api/game/quests/q-fail/next")).status).toBe(503);
  });
});
