/**
 * The map's lights (Phase D, D2), against a real database: a light is an
 * opted-in present member who joined a circle's session today, a hearth shows
 * none below the floor, the doors answer members only and name nobody, the
 * choice is the member's own, and an erasure puts the light out.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { presenceTest } from "./lib/memberPresence";
import { hearthsToday, villageDay } from "./lib/mapLight";
import { register as registerMapLightRoutes } from "./routes/mapLight";
import { usersRepo } from "./repos/users";
import { anonymizeMember, type ErasureDeps } from "./lib/erasure";
import { clearMemberDrivers } from "./lib/memberDrivers";
import { villageKey } from "../shared/sessionRhythm";

const configured = testDbConfigured();
if (!configured) console.warn("[mapLight.db] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir: string;

const isPresent = presenceTest("map-light-db-test-secret");
const ZONE = "UTC";
const CIRCLES = [{ id: "c-garden" }, { id: "c-kitchen" }, { id: "c-water" }, { id: "c-quiet" }];
const NAMES: Record<string, string> = {
  "u-ana": "Ana Lucero",
  "u-ben": "Ben Okafor",
  "u-cy": "Cy Moreno",
  "u-dee": "Dee Ward",
  "u-eli": "Eli Shore",
};

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned
  return rows;
}

const prefsOf = (on: boolean) => JSON.stringify(on ? { mapLight: true } : {});

async function seedPerson(id: string, on: boolean, no: number): Promise<void> {
  await q("INSERT INTO users (id, name, email, password_hash, prefs) VALUES (?,?,?,?,?)", [
    id, NAMES[id], `${id}@example.test`, "hash", prefsOf(on),
  ]);
  await q("INSERT INTO live_session_members (no, user_id) VALUES (?,?)", [no, id]);
}

async function seedSession(id: number, circleId: string | null, at: Date): Promise<void> {
  await q(
    "INSERT INTO live_sessions (id, title, circle_id, status, facilitator_no, created_by_no, duration_min, state, stamp, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, `Session ${id}`, circleId, "open", 1, 1, 60, "{}", "{}", at],
  );
}

const join = (sessionId: number, no: number, at: Date) =>
  q("INSERT INTO live_session_people (session_id, member_no, joined_at) VALUES (?,?,?)", [sessionId, no, at]);

const deps = () => ({
  circles: () => CIRCLES,
  memberById: (id: string) => usersRepo(pool).byId(id),
  isPresent,
  zone: ZONE,
});

/** The handlers `register` mounts, called with a plain request. */
function routes(asker: () => Promise<any>) {
  const table = new Map<string, (req: any, res: any) => Promise<unknown>>();
  const app = {
    get: (p: string, h: any) => table.set(`GET ${p}`, h),
    put: (p: string, h: any) => table.set(`PUT ${p}`, h),
  } as any;
  registerMapLightRoutes(app, {
    authedUser: asker as any,
    getPool: () => pool as any,
    members: usersRepo(pool),
    circles: () => CIRCLES,
    isPresent,
  });
  return async (key: string, body: Record<string, unknown> = {}) => {
    const out: { status: number; body: any; headers: Record<string, string> } = { status: 200, body: null, headers: {} };
    const res: any = {
      status: (s: number) => ((out.status = s), res),
      json: (b: any) => ((out.body = b), res),
      setHeader: (k: string, v: string) => void (out.headers[k] = v),
    };
    await table.get(key)!({ body, headers: {} }, res);
    return out;
  };
}

const now = new Date();
const { from } = villageDay(now, ZONE);
const yesterday = new Date(from.getTime() - 3 * 3_600_000);

describe.skipIf(!configured)("the map's lights", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, as every DB suite holds
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-map-light-"));
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  beforeEach(async () => {
    clearMemberDrivers();
    for (const t of ["live_session_people", "live_sessions", "live_session_members", "live_session_rhythms", "member_erasures"]) {
      await q(`DELETE FROM ${t}`);
    }
    await q("DELETE FROM users WHERE id LIKE 'u-%'");
    // Ana, Ben and Dee chose their light; Cy and Eli did not.
    await seedPerson("u-ana", true, 1);
    await seedPerson("u-ben", true, 2);
    await seedPerson("u-cy", false, 3);
    await seedPerson("u-dee", true, 4);
    await seedPerson("u-eli", false, 5);
  });

  it("lights only opted-in members who joined today, and shows none below the floor", async () => {
    await seedSession(10, "c-garden", now);
    for (const no of [1, 2, 3]) await join(10, no, now); // Ana, Ben (on) and Cy (off)
    await seedSession(11, "c-kitchen", now);
    await join(11, 4, now); // Dee alone: one light is below the floor
    await join(11, 5, now); // Eli is off
    await seedSession(12, "c-water", yesterday);
    for (const no of [1, 2, 4]) await join(12, no, yesterday); // yesterday counts for nothing
    await seedSession(13, null, now);
    for (const no of [1, 2, 4]) await join(13, no, now); // no circle, no hearth

    const { day, hearths } = await hearthsToday(pool, deps(), now);
    expect(day).toBe(villageKey(now, ZONE));
    expect(hearths).toEqual([
      { circleId: "c-garden", meetsToday: true, lights: 2 },
      { circleId: "c-kitchen", meetsToday: true, lights: 0 },
    ]);
  });

  it("knows a circle meets today from its rhythm, with no session opened yet", async () => {
    await q(
      "INSERT INTO live_session_rhythms (circle_id, kind, recurrence, starts_on, time_of_day, duration_min, set_by_no) VALUES (?,?,?,?,?,?,?)",
      ["c-quiet", "once", null, villageKey(now, ZONE), "23:59", 30, 1],
    );
    const { hearths } = await hearthsToday(pool, deps(), now);
    expect(hearths).toEqual([{ circleId: "c-quiet", meetsToday: true, lights: 0 }]);
  });

  it("answers a visitor 401 and a member with numbers that name nobody", async () => {
    await seedSession(10, "c-garden", now);
    for (const no of [1, 2, 4]) await join(10, no, now);

    const visitor = await routes(async () => null)("GET /api/map/hearths");
    expect(visitor.status).toBe(401);
    expect(visitor.body.hearths).toBeUndefined();

    const cy = await usersRepo(pool).byId("u-cy");
    const seen = await routes(async () => cy)("GET /api/map/hearths");
    expect(seen.status).toBe(200);
    expect(seen.body.hearths).toEqual([{ circleId: "c-garden", meetsToday: true, lights: 3 }]);
    expect(seen.body.myLight).toBe(false);
    expect(seen.headers["Cache-Control"]).toBe("private, no-store");
    const wire = JSON.stringify(seen.body);
    for (const [id, name] of Object.entries(NAMES)) {
      expect(wire).not.toContain(id);
      expect(wire).not.toContain(name.split(" ")[0]);
    }
  });

  it("keeps the choice the member's own: off by default, on and off again, junk refused", async () => {
    const cy = () => usersRepo(pool).byId("u-cy");
    const call = routes(cy);
    expect((await call("GET /api/map/my-light")).body).toEqual({ on: false });

    const on = await call("PUT /api/map/my-light", { on: true });
    expect(on.body).toEqual({ on: true });
    expect((await cy())!.prefs.mapLight).toBe(true);

    for (const junk of ["true", 1, null, undefined]) {
      const refused = await call("PUT /api/map/my-light", { on: junk });
      expect(refused.status).toBe(400);
    }
    expect((await cy())!.prefs.mapLight).toBe(true);

    const off = await call("PUT /api/map/my-light", { on: false });
    expect(off.body).toEqual({ on: false });
    expect("mapLight" in (await cy())!.prefs).toBe(false);

    const visitor = await routes(async () => null)("PUT /api/map/my-light", { on: true });
    expect(visitor.status).toBe(401);
  });

  it("puts a member's light out when they are erased", async () => {
    await seedSession(10, "c-garden", now);
    for (const no of [1, 2]) await join(10, no, now); // Ana and Ben: exactly the floor
    expect((await hearthsToday(pool, deps(), now)).hearths).toEqual([{ circleId: "c-garden", meetsToday: true, lights: 2 }]);

    const real = usersRepo(pool);
    const erasureDeps: ErasureDeps = {
      members: { byId: (id: string) => real.byId(id), update: (id: string, fn: any, opts?: any) => (real.update as any)(id, fn, opts) },
      submissionsRepo: { all: () => [], replaceAll: async () => undefined },
      roleHoldersRepo: { remove: async () => undefined },
      withRoleHolderLock: (fn) => fn(),
      loadRoleHolders: () => [],
      uploadsDir,
    } as ErasureDeps;
    await anonymizeMember(pool, await real.byId("u-ben"), null, erasureDeps);

    const ben = await real.byId("u-ben");
    expect(ben!.prefs?.mapLight).toBeUndefined();
    // Ana alone is below the floor, so the hearth still meets and shows no light.
    expect((await hearthsToday(pool, deps(), now)).hearths).toEqual([{ circleId: "c-garden", meetsToday: true, lights: 0 }]);
  });
});
