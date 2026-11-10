/**
 * The onboarding path against a real schema (0365): adoption opens a merged
 * path, the Trail fact holds only while items are open, a check-in is served
 * to three people and nobody else, and the companion step never shows without
 * consent. Every rule has a control beside it that fails if the rule is removed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { fileCheckin, hasOpenOnboardingItems, openPathFor, servePaths, tick, type OnboardingEnv } from "./lib/onboarding";
import * as repo from "./repos/onboarding";

const configured = testDbConfigured();
const OPENED = new Date("2026-11-01T12:00:00Z");
const DOC = {
  enabled: true,
  title: "Your first 14 days",
  phases: [
    { name: "Arrive", fromDay: 1, toDay: 3, items: [{ key: "welcome", title: "Read the welcome pack", owner: "onboarding", doneWhen: "Sent" }] },
    { name: "Set up", fromDay: 4, toDay: 7, items: [
      { key: "access", kind: "access", title: "Logins and task board", owner: "access" },
      { key: "companion", kind: "companion", title: "Get started with the companion" },
    ] },
    { name: "Play", fromDay: 8, toDay: 14, items: [{ key: "week", title: "Your first full week" }] },
  ],
  circles: { "c-hearth": [{ key: "gathering", title: "Join the gathering", owner: "buddy", phase: "set-up" }] },
  owners: { onboarding: "Welcomers", access: "Keys" },
  checkins: [7],
};

describe.skipIf(!configured)("onboarding against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let consent = false;
  const env = (today = "2026-11-02"): OnboardingEnv => ({ db: pool, today, consented: () => consent });
  const seat = (id: string, roleId: string, user: string, at: string) =>
    pool.query("INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key, started_at) VALUES (?,?,'member',?,?,?)", [id, roleId, user, `member:${user}`, at]); // module-review-ok: a fixture seating on the scratch schema

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    for (const u of ["u-new", "u-buddy", "u-far", "u-ops", "u-keys", "u-stranger"]) {
      await pool.query("INSERT INTO users (id, name, email, handle, password_hash, is_example) VALUES (?,?,?,?,'',0)", [u, `${u.slice(2)} Person`, `${u}@example.test`, u]); // module-review-ok: a fixture member on the scratch schema
    }
    await pool.query("INSERT INTO org_roles (id, circle_id, name, seats, active, represents_circle, first_90_day_outcomes) VALUES ('r-new','c-hearth','Gardener',1,1,0,'- Map the beds\\n- Meet the circle')"); // module-review-ok: fixture roles
    await pool.query("INSERT INTO org_roles (id, circle_id, name, seats, active, represents_circle) VALUES ('r-mate','c-hearth','Cook',1,1,0),('r-away','c-river','Boatwright',1,1,0),('r-ops','c-hub','Welcomers',1,1,0),('r-keys','c-hub','Keys',1,1,0)"); // module-review-ok: fixture roles
    await seat("a-buddy", "r-mate", "u-buddy", "2026-01-01 00:00:00");
    await seat("a-far", "r-away", "u-far", "2025-01-01 00:00:00"); // older, but another circle
    await seat("a-ops", "r-ops", "u-ops", "2026-02-01 00:00:00");
    await seat("a-keys", "r-keys", "u-keys", "2026-02-01 00:00:00");
    await seat("a-new", "r-new", "u-new", "2026-11-01 12:00:00");
    await pool.query("INSERT INTO app_config (config_key, value) VALUES ('onboarding-path', ?)", [JSON.stringify({ ...DOC, enabled: false })]); // module-review-ok: the village's own document on the scratch schema, switched off
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("the path is OFF by default: adoption opens nothing until the village switches it on", async () => {
    expect(await openPathFor(pool, { assignmentId: "a-new", userId: "u-new", orgRoleId: "r-new", now: OPENED })).toBe(false);
    expect(await repo.pathsOfUser(pool, "u-new")).toEqual([]);
    await pool.query("UPDATE app_config SET value = ? WHERE config_key = 'onboarding-path'", [JSON.stringify(DOC)]); // module-review-ok: the village switching it on
  });

  it("adoption opens a merged path with a same-circle buddy", async () => {
    expect(await openPathFor(pool, { assignmentId: "a-new", userId: "u-new", orgRoleId: "r-new", now: OPENED })).toBe(true);
    const [p] = await repo.pathsOfUser(pool, "u-new");
    expect(p).toMatchObject({ circleId: "c-hearth", buddyUserId: "u-buddy", openedOn: "2026-11-01", dueOn: "2026-11-14", title: "Your first 14 days", checkinDays: [7] });
    const keys = (await repo.itemsOfPath(pool, p.id)).map((i) => i.key);
    expect(keys).toEqual(["welcome", "access", "companion", "week", "gathering", "card-1", "card-2"]);
    expect(keys).not.toContain("quest");
  });

  it("control: a seating gets one path, and a role in no circle gets no buddy", async () => {
    expect(await openPathFor(pool, { assignmentId: "a-new", userId: "u-new", orgRoleId: "r-new", now: OPENED })).toBe(false);
    expect(await repo.buddyCandidate(pool, "c-empty", "u-new")).toBeNull();
    expect(await repo.buddyCandidate(pool, "c-hearth", "u-buddy")).toBe("u-new"); // the holder is never their own buddy
    expect(await repo.buddyCandidate(pool, "c-hearth", "u-new")).toBe("u-buddy"); // and another circle's older holder is passed over
  });

  it("the companion step never shows without consent", async () => {
    consent = false;
    const [mine] = await servePaths(env(), "u-new");
    expect(mine.items.some((i) => i.kind === "companion")).toBe(false);
    consent = true;
    const [again] = await servePaths(env(), "u-new");
    expect(again.items.some((i) => i.kind === "companion")).toBe(true);
    consent = false;
  });

  it("the Trail fact holds only while the holder has an open step", async () => {
    const [p] = await repo.pathsOfUser(pool, "u-new");
    expect(await hasOpenOnboardingItems(pool, "u-new", () => false)).toBe(true);
    expect(await hasOpenOnboardingItems(pool, "u-stranger", () => false)).toBe(false); // control: nobody else
    const mineToDo = (await repo.itemsOfPath(pool, p.id)).filter((i) => i.owner === "holder" && i.kind !== "companion");
    expect(mineToDo.length).toBeGreaterThan(0);
    for (const [n, it] of mineToDo.entries()) {
      expect(await hasOpenOnboardingItems(pool, "u-new", () => false), `still open before step ${n + 1}`).toBe(true);
      expect(await tick(env(), "u-new", p.id, it.key)).toEqual({ ok: true });
    }
    expect(await hasOpenOnboardingItems(pool, "u-new", () => false), "all done, companion hidden").toBe(false);
    expect(await hasOpenOnboardingItems(pool, "u-new", () => true), "control: with consent the companion step is still open").toBe(true);
  });

  it("each step is ticked by its owner only", async () => {
    const [p] = await repo.pathsOfUser(pool, "u-new");
    expect(await tick(env(), "u-new", p.id, "access")).toMatchObject({ ok: false, status: 403 });
    expect(await tick(env(), "u-stranger", p.id, "access")).toMatchObject({ ok: false, status: 404 });
    expect(await tick(env(), "u-keys", p.id, "access")).toEqual({ ok: true });
    expect(await tick(env(), "u-buddy", p.id, "gathering")).toEqual({ ok: true });
  });

  it("a check-in is served to the holder, the buddy and the onboarding role, and to nobody else", async () => {
    const [p] = await repo.pathsOfUser(pool, "u-new");
    expect(await fileCheckin(env("2026-11-03"), "u-new", p.id, 7, { clarity: 4, overall: 4 })).toMatchObject({ ok: false, status: 409 });
    expect(await fileCheckin(env("2026-12-01"), "u-new", p.id, 30, { clarity: 4, overall: 4 })).toMatchObject({ ok: false, status: 409 }); // a day this village never set
    const body = { clarity: 4, overall: 5, oneThing: "A quieter first week" };
    expect(await fileCheckin(env("2026-11-08"), "u-buddy", p.id, 7, body)).toMatchObject({ ok: false, status: 404 }); // the buddy reads, never files
    expect(await fileCheckin(env("2026-11-08"), "u-new", p.id, 7, body)).toEqual({ ok: true });
    expect(await fileCheckin(env("2026-11-08"), "u-new", p.id, 7, body)).toMatchObject({ ok: false, status: 409 });
    for (const who of ["u-new", "u-buddy", "u-ops"]) {
      const seen = (await servePaths(env("2026-11-08"), who)).find((s) => s.id === p.id);
      expect(seen?.checkins?.[0]?.answers?.oneThing, `${who} reads it`).toBe("A quieter first week");
    }
    for (const who of ["u-stranger", "u-far", "u-keys"]) {
      expect((await servePaths(env("2026-11-08"), who)).find((s) => s.id === p.id), `${who} is served nothing`).toBeUndefined();
    }
  });

  it("erasing a member removes their path, steps and check-ins, and clears the buddy link", async () => {
    const [p] = await repo.pathsOfUser(pool, "u-new");
    await repo.forgetOnboardingForMember(pool, "u-buddy");
    expect((await repo.pathById(pool, p.id))?.buddyUserId).toBeNull();
    await repo.forgetOnboardingForMember(pool, "u-new");
    expect(await repo.pathById(pool, p.id)).toBeNull();
    expect(await repo.itemsOfPath(pool, p.id)).toEqual([]);
    expect(await repo.checkinsOfPath(pool, p.id)).toEqual([]);
  });
});
