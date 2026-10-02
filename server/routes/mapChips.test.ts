/**
 * THE CROWN BAR READS THE VILLAGE'S OWN NUMBERS, AND AN UNSET CHIP STAYS AN EXAMPLE.
 *
 * Rye, deciding F29 (2026-10-02): "Mark them as examples and wire them to
 * admin where we can add in a label and a datasource ... Label as example -
 * this label goes away once set."
 *
 * The three routes in server/routes/mapChips.ts run here against a real
 * scratch schema, registered on a fake Express that keeps each handler by
 * path (the shape server/routes/circleBurn.test.ts uses), so what runs is the
 * real handler, the real counting (server/lib/mapStats.ts) and the real SQL.
 * Each source is checked against rows written through the repositories the
 * rest of the server writes with, examples and departed members among them,
 * because a count that includes a seeded demo is the defect F29 was about.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { loadVariables } from "../lib/variables";
import { loadModuleSettings, setModuleLifecycle } from "../lib/modules";
import { createOrgRole, seatHolder } from "../lib/orgChart";
import { currentCycle } from "../lib/gratitude-cycles";
import { usersRepo } from "../repos/users";
import { claimsRepo, questsRepo } from "../repos/quests";
import { gratitudeLogRepo } from "../repos/gratitude";
import { register } from "./mapChips";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[mapChips.test] TEST_DATABASE_URL not set. The crown bar's routes are UNCHECKED here.");
}

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

let db: TestDb;
let pool: mysql.Pool;
/** Every statement the routes send, so a test can say how often they counted. */
let queries = 0;
const handlers = new Map<string, Handler>();
/** Who the next request is from. */
let asker: { id: string; role: string } | null = null;

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

async function call(method: "get" | "put", path: string, body?: unknown) {
  const { res, out } = makeRes();
  await handlers.get(`${method} ${path}`)!({ body, query: {}, headers: {} }, res);
  return out;
}
const founder = { id: "u-founder", role: "founder" };
const member = { id: "u-ada", role: "member" };

const live = async () => (await call("get", "/api/map/chips")).body.chips as any[];
const save = async (chips: unknown[]) => {
  asker = founder;
  const out = await call("put", "/api/admin/map/chips", { chips });
  asker = null;
  return out;
};
const chip = (id: string, source: string, over: Record<string, unknown> = {}) => ({
  id, label: id, icon: "star", source, unit: "", format: "compact", link: "", manual: null, ...over,
});

describe.skipIf(!configured)("the crown bar's chips (routes, real schema)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool, the ledger.test.ts shape
    await loadVariables(pool);
    await loadModuleSettings(pool);
    const counted = new Proxy(pool, {
      get(target, key) {
        if (key === "query") {
          return (...args: unknown[]) => {
            queries += 1;
            return (target.query as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, key);
      },
    });
    const app: any = {
      get: (p: string, h: Handler) => handlers.set(`get ${p}`, h),
      put: (p: string, h: Handler) => handlers.set(`put ${p}`, h),
    };
    register(app, {
      getPool: () => counted as unknown as mysql.Pool,
      authedUser: async () => asker,
      isAdmin: async () => asker?.role === "founder" || asker?.role === "admin",
      seasonState: () => ({ current: null, seasons: [], timezone: "UTC" }),
      lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
    } as any);

    // People: two real members, a founder, an example and somebody who left.
    const users = usersRepo(pool);
    await users.add({ id: "u-founder", email: "f@example.test", name: "Founder", role: "founder", recognitionBalance: 0 } as any);
    await users.add({ id: "u-ada", email: "ada@example.test", name: "Ada", recognitionBalance: 0 } as any);
    await users.add({ id: "u-bo", email: "bo@example.test", name: "Bo", recognitionBalance: 0 } as any);
    await users.add({ id: "u-demo", email: "demo@example.test", name: "Demo", recognitionBalance: 0, isExample: true } as any);
    await users.add({ id: "u-gone", email: "x1@anonymized.invalid", name: "Former member", recognitionBalance: 0 } as any);

    // Work: two open quests, one closed, one open example.
    const quests = questsRepo(pool);
    const q = (id: string, status: string) => quests.add({ id, title: id, gratitude: "10", status, tags: [], order: 1 });
    await q("q-open-1", "Open");
    await q("q-open-2", "seasonal");
    await q("q-closed", "Closed");
    await q("q-demo", "Open");
    // is_example is not on the repo's write path, so the seeder sets it (server/repos/quests.test.ts does the same).
    await pool.query("UPDATE quests SET is_example = 1 WHERE id = ?", ["q-demo"]); // module-review-ok: marks a fixture row as a standing example in the harness's scratch schema
    const now = new Date().toISOString();
    const claims = claimsRepo(pool);
    const claim = (id: string, questId: string, userId: string, status: any, resolvedAt: string | null) =>
      claims.add({ id, questId, questTitle: questId, userId, userName: userId, status, claimedAt: now, resolvedAt });
    await claim("c-done", "q-open-1", "u-ada", "consented", now);
    await claim("c-old", "q-open-1", "u-bo", "consented", "2020-01-01T00:00:00.000Z");
    await claim("c-demo", "q-demo", "u-ada", "consented", now);
    await claim("c-open", "q-open-2", "u-bo", "claimed", null);

    // Gratitude this cycle: 5 from a real member, 3 from the example.
    const cycle = currentCycle();
    const log = gratitudeLogRepo(pool);
    const give = (id: string, fromId: string, amount: number) =>
      log.add({ id, kind: "gratitude", fromId, fromName: fromId, toId: "u-bo", toName: "Bo", amount, message: "", cycleId: cycle.id, at: now });
    await give("g-1", "u-ada", 5);
    await give("g-2", "u-demo", 3);

    // Seats: a two-seat role with one holder (one place), an empty seat (one
    // place), and a seat that is full.
    const two = await createOrgRole(pool, { name: "Water Stewards", seats: 2 });
    await seatHolder(pool, two, { userId: "u-ada" });
    await createOrgRole(pool, { name: "Treasurer", seats: 1 });
    const full = await createOrgRole(pool, { name: "Cook", seats: 1 });
    await seatHolder(pool, full, { userId: "u-bo" });

    // Circles: active, forming, dormant and an example.
    for (const [id, status, ex] of [["c-a", "active", 0], ["c-f", "forming", 0], ["c-d", "dormant", 0], ["c-x", "active", 1]] as const) {
      await pool.query("INSERT INTO circles (id, name, status, is_example) VALUES (?,?,?,?)", [id, id, status, ex]); // module-review-ok: a fixture row in the harness's scratch schema; circles has no pool-level writer outside the cached collection in server/index.ts
    }
    // The land: 40 trees recorded, 15 withdrawn.
    await pool.query("INSERT INTO regen_entries (id, metric_key, value, unit, note, recorded_by) VALUES ('r-1','trees_planted',40,'trees',NULL,'u-ada')"); // module-review-ok: a fixture row in the harness's scratch schema, the same statement POST /api/admin/health/regen writes
    await pool.query("INSERT INTO regen_entries (id, metric_key, value, unit, note, recorded_by, retracted_at) VALUES ('r-2','trees_planted',15,'trees',NULL,'u-ada',NOW())"); // module-review-ok: a withdrawn reading in the harness's scratch schema
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("draws a village that has set nothing as the five examples, with no number of its own", async () => {
    const chips = await live();
    expect(chips.map((c) => c.id)).toEqual(["people", "food", "water", "canopy", "hearts"]);
    expect(chips.every((c) => c.state === "example" && c.value === null)).toBe(true);
  });

  it("lets only an admin read or replace the chips", async () => {
    for (const who of [null, member]) {
      asker = who;
      expect((await call("get", "/api/admin/map/chips")).status).toBe(401);
      expect((await call("put", "/api/admin/map/chips", { chips: [] })).status).toBe(401);
    }
    asker = null;
  });

  it("reads each source from the village's own rows, examples and departures left out", async () => {
    const out = await save([
      chip("people", "members"),
      chip("work", "quests_open"),
      chip("done", "quests_done_cycle"),
      chip("hearts", "gratitude_cycle"),
      chip("seats", "seats_open"),
      chip("circles", "circles"),
    ]);
    expect(out.status).toBe(200);
    const byId = Object.fromEntries((await live()).map((c) => [c.id, c]));
    expect(byId.people).toMatchObject({ state: "live", value: "3" }); // founder, Ada, Bo
    expect(byId.work.value).toBe("2"); // Open and seasonal; Closed and the example are not
    expect(byId.done.value).toBe("1"); // this cycle, real quest, real member
    expect(byId.hearts.value).toBe("5"); // the example member's 3 left out
    expect(byId.seats.value).toBe("2"); // one place on the pair, the empty treasurer
    expect(byId.circles.value).toBe("2"); // active and forming
    for (const c of Object.values(byId)) expect(c.why, "a visitor is told nothing about what they are not shown").toBeUndefined();
  });

  it("draws a typed number with its date, and keeps a chip with no source an example", async () => {
    await save([
      chip("rain", "manual", { unit: "mm", manual: { value: "1200", asOf: "2026-10-01" } }),
      chip("people", "none"),
    ]);
    const [rain, people] = await live();
    expect(rain).toMatchObject({ state: "manual", value: "1200mm", asOf: "2026-10-01" });
    expect(people).toMatchObject({ state: "example", value: null });
  });

  it("leaves out a chip whose module is off, and tells the founder why", async () => {
    await save([chip("trees", "trees_planted"), chip("people", "members")]);
    expect((await live()).map((c) => c.id)).toEqual(["people"]);
    asker = founder;
    const editor = (await call("get", "/api/admin/map/chips")).body;
    asker = null;
    const trees = editor.preview.find((c: any) => c.id === "trees");
    expect(trees.state).toBe("unavailable");
    expect(trees.why).toMatch(/switched off/);
    expect(editor.sources.find((s: any) => s.key === "trees_planted").hiddenFromVisitors).toMatch(/switched off/);
  });

  it("draws a members-only module's chip for a member and not for a visitor", async () => {
    const set = await setModuleLifecycle("health", "members", null, { sharedPasswordPosture: () => false });
    expect(set.ok).toBe(true);
    await save([chip("trees", "trees_planted")]);
    expect(await live(), "a visitor").toEqual([]);
    asker = member;
    const seen = await live();
    asker = null;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ state: "live", value: "40" }); // the withdrawn 15 left out
    await setModuleLifecycle("health", "off", null, { sharedPasswordPosture: () => false });
  });

  it("keeps a save to what the map can safely draw", async () => {
    const out = await save([
      chip("x", "members", { label: "<b>" + "y".repeat(80), link: "https://elsewhere.example", icon: "dragon" }),
    ]);
    expect(out.status).toBe(200);
    const [stored] = out.body.chips;
    expect(stored.label.length).toBeLessThanOrEqual(24);
    expect(stored.link).toBe("");
    expect(stored.icon).toBe("people");
    asker = founder;
    expect((await call("put", "/api/admin/map/chips", { chips: "all of them" })).status).toBe(400);
    asker = null;
  });

  it("counts a source once for a crowd of open maps, and again after a save", async () => {
    await save([chip("people", "members")]);
    await live(); // counted
    const before = queries;
    for (let i = 0; i < 5; i++) await live();
    expect(queries - before, "five more maps asked, nothing was recounted").toBe(0);
    await usersRepo(pool).add({ id: "u-cy", email: "cy@example.test", name: "Cy", recognitionBalance: 0 } as any);
    expect((await live())[0].value, "held for a moment").toBe("3");
    await save([chip("people", "members")]);
    expect((await live())[0].value, "a founder's save asks again").toBe("4");
  });
});
