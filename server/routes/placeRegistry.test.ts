/**
 * LIVING PLACES ROUTES (S2): the registry's index, card, import and orphan
 * report.
 *
 * The first two blocks need no database: every door answers a stranger, the
 * holder doors ask the one gate for `place.tend`, and the index's tiers are
 * built by a pure function, so what a visitor may never read is tested
 * directly. The third block runs against a real scratch schema: the import is
 * refused whole on a bad seed, writes the first village's seed, keeps a holder's edit on a
 * second import and links a steward role by its title; the index answers 304
 * to its own ETag; the card resolves an alias and sends holder names only on
 * the viewPeople tier.
 *
 * Every person and every place outside the first village's seed block is invented.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import type { PlacesSeed } from "../../shared/places";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { loadModuleSettings, setModuleLifecycle } from "../lib/modules";
import type { MapOrgRole } from "../lib/mapOrg";
import { createOrgRole, seatHolder } from "../lib/orgChart";
import {
  anchorsFromScene, buildOrphanReport, buildPlaceIndex, getPlaceStewardship, stewardshipOf,
  type IndexInput, type MemberPlace,
} from "../lib/places";
import type { PlaceRow } from "../repos/places";
import { register } from "./placeRegistry";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const ROUTES = [
  "GET /api/place-registry",
  "GET /api/place-registry/orphans",
  "GET /api/place-registry/:key",
  "POST /api/place-registry/import",
];
const HOLDER_ROUTES = ["GET /api/place-registry/orphans", "POST /api/place-registry/import"];

function collect() {
  const handlers = new Map<string, Handler>();
  const mounts: string[] = [];
  const record = (method: string) => (p: string, handler: Handler) => handlers.set(`${method} ${p}`, handler);
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE"), use: (p: string) => mounts.push(p) } as any,
    handlers,
    mounts,
  };
}

function makeRes() {
  const out: { status: number; body: any; headers: Record<string, string>; ended: boolean } = { status: 200, body: undefined, headers: {}, ended: false };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
    setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = v; },
    end() { out.ended = true; return res; },
  };
  return { res, out };
}

const call = async (handlers: Map<string, Handler>, key: string, req: any = {}) => {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const { res, out } = makeRes();
  await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
  return out;
};

interface Fake { id: string; name: string }

function deps(pool: any, who: () => string | null, opts: { tenders: Set<string>; admins?: Set<string>; people?: () => Fake[]; asked?: string[] }) {
  return {
    authedUser: async () => (who() ? { id: who() } : null),
    isAdmin: async () => Boolean(who() && opts.admins?.has(who() as string)),
    // No stage reaches map.viewPeople here: names come only from the admin tier.
    capabilityCtx: async () => ({ stageIndex: -1, stageIndexOf: () => 0, roleCapabilities: [] }),
    guardCapability: async (_req: any, res: any, cap: string) => {
      opts.asked?.push(cap);
      if (who() && opts.tenders.has(who() as string)) return true;
      res.status(403).json({ error: "not_yours" });
      return false;
    },
    getPool: () => pool,
    overLimit: async () => false,
    members: { all: async () => opts.people?.() ?? [], count: async () => opts.people?.().length ?? 0 },
    firstName: (n: string) => String(n).split(" ")[0],
    lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
    circlesRepo: { all: () => [] },
  } as any;
}

describe("place registry doors, no database", () => {
  it("registers every door behind the module", () => {
    const c = collect();
    register(c.app, deps(null, () => null, { tenders: new Set() }));
    expect([...c.handlers.keys()].sort()).toEqual([...ROUTES].sort());
    expect(c.mounts).toEqual(["/api/place-registry"]);
  });

  it("answers 401 to a stranger at the card, the import and the orphan report", async () => {
    const c = collect();
    register(c.app, deps(null, () => null, { tenders: new Set() }));
    for (const key of ROUTES.filter((r) => r !== "GET /api/place-registry")) {
      expect((await call(c.handlers, key, { params: { key: "hall" } })).status, key).toBe(401);
    }
  });

  it("asks the one gate for place.tend at every holder door", async () => {
    const asked: string[] = [];
    const c = collect();
    register(c.app, deps(null, () => "m-someone", { tenders: new Set(), asked }));
    for (const key of HOLDER_ROUTES) expect((await call(c.handlers, key)).status, key).toBe(403);
    expect(asked).toEqual(["place.tend", "place.tend"]);
  });
});

// ── The index's tiers, pure ─────────────────────────────────────────────────

function row(p: Partial<PlaceRow> & { key: string }): PlaceRow {
  return {
    name: p.key, zone: null, kind: "building", stage: "idea", readinessPct: null, confirmed: true, disputes: [], aliases: [],
    units: null, positionText: "", description: null, phase: null, isTemporary: false, temporarySuccessor: null,
    setAsideReason: null, retiredAt: null, inPreserve: "unknown", inRiparian: "unknown", footprintM2: null, childSafe: false,
    hoursWindow: null, isHome: false, showcase: false, stewardRoleId: null, stewardHold: null, claimWindowEndsAt: null,
    targetDate: null, createdBy: "m-seed", ...p,
  };
}

function role(p: Partial<MapOrgRole> & { id: string }): MapOrgRole {
  return { name: p.id, circleId: null, seats: 1, holderCount: 0, state: "open", archetypes: [], description: "", holders: [], structureKey: null, ...p };
}

const SCENE = JSON.stringify({ map_structures: [{ key: "hall", anchor: { x: 10, y: 20 } }, { key: "school", anchor: { x: 30, y: 40 } }] });

function input(tier: IndexInput["tier"], over: Partial<IndexInput> = {}): IndexInput {
  return {
    tier,
    places: [
      row({ key: "hall", name: "The Hall", stewardRoleId: "hall-steward" }),
      row({ key: "school", name: "The School", childSafe: true, stage: "in_use" }),
      row({ key: "cottage", name: "A cottage", kind: "homes", isHome: true, units: { homes: 2 }, stage: "built" }),
      row({ key: "maybe-barn", name: "A barn", confirmed: false, disputes: [{ kind: "exists", topic: "Is there a barn", sources: ["plan"], toSettle: "ask" }] }),
      row({ key: "gone", retiredAt: "2026-01-01T00:00:00.000Z" }),
    ],
    zones: [],
    anchors: anchorsFromScene(SCENE),
    roles: [
      role({ id: "hall-steward", name: "Hall Steward", structureKey: "hall", state: "filled", holderCount: 1, holders: [{ name: "Fern", lapsed: false, isAgent: false }] }),
      role({ id: "school-cook", name: "School Cook", structureKey: "school" }),
    ],
    quests: [{ id: "q-1", title: "Paint the hall", structureKey: "hall" }],
    events: [{ id: "e-1", title: "Story hour", startsAt: "2026-11-10T15:00:00.000Z", structureKeys: ["school"] }],
    queued: new Map([["hall", 1]]),
    claims: new Map([["school", 2]]),
    photos: new Map([["hall", 3]]),
    homesTarget: { homes: 10, apartments: 0, selfBuildLots: 0, casitas: 0 },
    day: "2026-11-09",
    ...over,
  };
}

const MEMBER_ONLY = ["childSafeZone", "showcase", "steward", "invitationOpen", "openRoles", "openClaims", "openStageProposals", "eventsSoon", "photos"];

describe("the index's tiers", () => {
  it("sends a visitor structure only: no roles, claims, events, steward, photos or child-safe flag", () => {
    const idx = buildPlaceIndex(input("public"));
    expect(idx.tier).toBe("public");
    for (const p of idx.places) for (const k of MEMBER_ONLY) expect(p, `${p.key}.${k}`).not.toHaveProperty(k);
    const text = JSON.stringify(idx);
    expect(text).not.toContain("Story hour");
    expect(text).not.toContain("Fern");
    expect(text).not.toContain("2026-11-10");
  });

  it("gives members the roles, claims, events, queued changes and photos at each place", () => {
    const idx = buildPlaceIndex(input("members"));
    const hall = idx.places.find((p) => p.key === "hall") as MemberPlace;
    const school = idx.places.find((p) => p.key === "school") as MemberPlace;
    expect(hall).toMatchObject({ steward: "filled", invitationOpen: false, openStageProposals: 1, photos: 3, openQuests: 1, anchor: { x: 10, y: 20 } });
    expect(hall.openRoles).toEqual([]);
    expect(school).toMatchObject({ childSafeZone: true, openClaims: 2, eventsSoon: { count: 1, nextStartsAt: "2026-11-10T15:00:00.000Z" } });
    expect(school.openRoles).toEqual([{ roleId: "school-cook", title: "School Cook", state: "open", seats: 1, holderCount: 0 }]);
    expect(JSON.stringify(idx)).not.toContain("Fern");
  });

  it("never draws a place the published scene does not, and lists it anyway", () => {
    const idx = buildPlaceIndex(input("public"));
    expect(idx.places.find((p) => p.key === "cottage")?.anchor).toBeNull();
    expect(buildPlaceIndex(input("public", { anchors: anchorsFromScene("not json") })).places.every((p) => p.anchor === null)).toBe(true);
  });

  it("shows a place in doubt as unconfirmed, leaves retired places out, and counts homes built", () => {
    const idx = buildPlaceIndex(input("public"));
    expect(idx.places.find((p) => p.key === "maybe-barn")?.confirmed).toBe(false);
    expect(idx.places.map((p) => p.key)).not.toContain("gone");
    expect(idx.homes.built.homes).toBe(2);
    expect(idx.homes.target?.homes).toBe(10);
  });

  it("opens an invitation when the steward position is open, and never for a feature", () => {
    const idx = buildPlaceIndex(input("members", { places: [row({ key: "orchard" }), row({ key: "rock", kind: "feature", stage: null })] }));
    expect(idx.places.find((p) => p.key === "orchard")).toMatchObject({ steward: "open", invitationOpen: true });
    expect(idx.places.find((p) => p.key === "rock")).toMatchObject({ steward: null, invitationOpen: false });
  });

  it("versions each tier and each day apart", () => {
    const a = buildPlaceIndex(input("public")).version;
    expect(buildPlaceIndex(input("public")).version).toBe(a);
    expect(buildPlaceIndex(input("members")).version).not.toBe(a);
    expect(buildPlaceIndex(input("public", { day: "2026-11-10" })).version).not.toBe(a);
  });

  it("names a place's roles by title only in its stewardship, never a holder", () => {
    const s = stewardshipOf(row({ key: "hall", stewardRoleId: "hall-steward" }), input("members").roles);
    expect(s.steward).toMatchObject({ state: "filled", roleId: "hall-steward", roleTitle: "Hall Steward", claimPath: null });
    expect(s.roles).toEqual([{ roleId: "hall-steward", title: "Hall Steward", circleId: null, state: "filled", applyPath: "/api/governance/role-applications" }]);
    expect(JSON.stringify(s)).not.toContain("Fern");
  });

  it("reports what names a place the registry does not hold, and the reverse", () => {
    const i = input("members");
    const r = buildOrphanReport({
      places: i.places,
      anchors: anchorsFromScene(JSON.stringify({ map_structures: [{ key: "hall", anchor: { x: 1, y: 1 } }, { key: "shed", anchor: { x: 2, y: 2 } }] })),
      roles: [...i.roles, role({ id: "lost", structureKey: "nowhere" })],
      quests: [{ id: "q-2", title: "Fix it", structureKey: "nowhere" }],
      events: [{ id: "e-2", title: "Meet", startsAt: "", structureKeys: ["hall", "elsewhere"] }],
    });
    expect(r.mapKeysNotRegistered).toEqual(["shed"]);
    expect(r.registeredNotOnMap).toEqual(["cottage", "maybe-barn", "school"]);
    expect(r.rolesAtUnknownPlaces).toEqual([{ roleId: "lost", title: "lost", key: "nowhere" }]);
    expect(r.questsAtUnknownPlaces).toEqual([{ questId: "q-2", key: "nowhere" }]);
    expect(r.eventsAtUnknownPlaces).toEqual([{ eventId: "e-2", key: "elsewhere" }]);
  });
});

// ── The first village's seed, as the index would send it ────────────────────

const FIRST: PlacesSeed = JSON.parse(readFileSync(path.join(__dirname, "../seeds/amora/places-seed.json"), "utf8")); // brand-ok: the first village's own seed is its declared home

describe("the first village's seed through the index", () => {
  const rows = FIRST.places.map((p) => row({
    key: p.key, name: p.name, zone: p.zone, kind: p.kind, stage: p.stage, confirmed: p.confirmed, disputes: p.disputes ?? [],
    aliases: p.aliases ?? [], units: p.units ?? null, positionText: p.positionText, description: p.description, childSafe: Boolean(p.childSafeZone),
  }));

  /*
   * The spec's 20 KB is what crosses the wire, and the server compresses every
   * answer (`compression()` in server/index.ts). Measured on 9 Nov: 66 places
   * are 29.8 KB raw and 2.2 KB compressed on the members' tier. The raw ceiling
   * is here to catch growth, a field added to every place, early.
   */
  it("stays under 20 KB on the wire for the members' tier, and under 32 KB raw", () => {
    const idx = buildPlaceIndex(input("members", { places: rows, anchors: new Map(), roles: [], quests: [], events: [] }));
    expect(idx.places.length).toBeGreaterThanOrEqual(60);
    const text = JSON.stringify(idx);
    expect(gzipSync(text).length).toBeLessThan(20_000);
    expect(text.length).toBeLessThan(32_000);
  });
});

// ── Against a real schema ───────────────────────────────────────────────────

const configured = testDbConfigured();

describe.skipIf(!configured)("the place registry against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let whoami: string | null = null;
  let handlers: Map<string, Handler>;
  const as = (id: string | null) => { whoami = id; };
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await loadModuleSettings(pool);
    await setModuleLifecycle("places", "members", null, { sharedPasswordPosture: () => false });
    const c = collect();
    register(c.app, deps(pool, () => whoami, { tenders: new Set(["m-tend"]), admins: new Set(["m-admin"]), people: () => [{ id: "m-fern", name: "Fern Example" }] }));
    handlers = c.handlers;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("refuses a bad seed whole, naming every problem, and writes nothing", async () => {
    as("m-tend");
    const bad = structuredClone(FIRST);
    bad.places.push({ ...bad.places[1], key: "Gate" });
    bad.places[2] = { ...bad.places[2], stage: "built", confirmed: false, disputes: [] };
    const out = await call(handlers, "POST /api/place-registry/import", { body: { seed: bad } });
    expect(out.status).toBe(400);
    expect(out.body.problems.join("\n")).toContain("only by case");
    expect(out.body.problems.join("\n")).toContain("on an unconfirmed place");
    expect((await q("SELECT COUNT(*) AS n FROM places"))[0].n).toBe(0);
    expect((await call(handlers, "POST /api/place-registry/import", { body: { seed: { places: "no" } } })).status).toBe(400);
  });

  it("is a holder's act: anyone else is sent to the gate", async () => {
    as("m-fern");
    expect((await call(handlers, "POST /api/place-registry/import", { body: { seed: FIRST } })).status).toBe(403);
    expect((await q("SELECT COUNT(*) AS n FROM places"))[0].n).toBe(0);
  });

  it("writes the first village's seed, linking a steward role by its title", async () => {
    const title = FIRST.places.find((p) => p.stewardRoleTitle)!.stewardRoleTitle!;
    const roleId = await createOrgRole(pool, { name: title, seats: 1 });
    as("m-tend");
    const out = await call(handlers, "POST /api/place-registry/import", { body: { seed: FIRST } });
    expect(out.status).toBe(201);
    expect(out.body.addedPlaces).toHaveLength(FIRST.places.length);
    expect(out.body.checkedAgainstMap).toBe(false);
    expect(out.body.unlinkedStewardTitles.join("\n")).not.toContain(title);
    expect((await q("SELECT COUNT(*) AS n FROM place_zones"))[0].n).toBe(FIRST.zones.length);
    expect((await q("SELECT COUNT(*) AS n FROM place_permits"))[0].n).toBe(FIRST.permits.length);
    const linked = await q("SELECT `key` FROM places WHERE steward_role_id = ?", [roleId]);
    expect(linked.length).toBeGreaterThan(0);
  });

  it("keeps a holder's edit when the seed is imported again", async () => {
    await q("UPDATE places SET name = 'The Gate, renamed' WHERE `key` = 'gate'");
    as("m-tend");
    const out = await call(handlers, "POST /api/place-registry/import", { body: { seed: FIRST } });
    expect(out.status).toBe(201);
    expect(out.body.addedPlaces).toEqual([]);
    expect(out.body.keptPlaces).toBe(FIRST.places.length);
    expect((await q("SELECT name FROM places WHERE `key` = 'gate'"))[0].name).toBe("The Gate, renamed");
  });

  it("answers a member's index, and 304 to its own ETag", async () => {
    as("m-fern");
    const first = await call(handlers, "GET /api/place-registry");
    expect(first.status).toBe(200);
    expect(first.body.tier).toBe("members");
    expect(first.body.places.length).toBe(FIRST.places.length);
    expect(first.headers["cache-control"]).toBe("private, no-cache");
    const again = await call(handlers, "GET /api/place-registry", { headers: { "if-none-match": `W/${first.headers.etag}` } });
    expect(again.status).toBe(304);
    expect(again.ended).toBe(true);
  });

  it("finds a place by its alias, and names holders only on the viewPeople tier", async () => {
    const caretakers = FIRST.places.find((p) => (p.aliases ?? []).length > 0)!;
    const roleId = await createOrgRole(pool, { name: "House keeper", seats: 1 });
    await q("UPDATE org_roles SET structure_key = ? WHERE id = ?", [caretakers.key, roleId]);
    await seatHolder(pool, roleId, { userId: "m-fern" });
    as("m-fern");
    const card = await call(handlers, "GET /api/place-registry/:key", { params: { key: caretakers.aliases![0] } });
    expect(card.status).toBe(200);
    expect(card.body.place.key).toBe(caretakers.key);
    expect(card.body.stewardship.roles.map((r: any) => r.title)).toContain("House keeper");
    expect(card.body.holders).toBeNull();
    expect(JSON.stringify(card.body)).not.toContain("Fern");
    as("m-admin");
    const named = await call(handlers, "GET /api/place-registry/:key", { params: { key: caretakers.key } });
    expect(named.body.holders[roleId]).toEqual(["Fern"]);
    expect((await call(handlers, "GET /api/place-registry/:key", { params: { key: "no-such-place" } })).status).toBe(404);
  });

  it("tells the build days lane who stewards a place, and null for a key it does not hold", async () => {
    const roles = async () => [];
    expect(await getPlaceStewardship(pool, "local", "no-such-place", roles)).toBeNull();
    const gate = await getPlaceStewardship(pool, "local", "gate", roles);
    expect(gate?.steward.claimPath).toBeNull();
  });

  it("reports the live keys' places the published map does not draw, for a holder", async () => {
    as("m-tend");
    const out = await call(handlers, "GET /api/place-registry/orphans");
    expect(out.status).toBe(200);
    expect(out.body.mapKeysNotRegistered).toEqual([]);
    expect(out.body.registeredNotOnMap.length).toBe(FIRST.places.length);
  });
});
