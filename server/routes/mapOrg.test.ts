/**
 * GET /api/map/org against a real scratch schema: what an open map polls.
 *
 * The promise is Rye's (D3): a seat created in the org tools appears on an
 * open map, and one taken away goes. The map can only see that through this
 * route, so these cases drive the real writers the org tools use
 * (`createOrgRole`, `updateOrgRole`, `seatHolder`, `endSeating`) between two
 * polls and read what the second poll says, with the first poll's version in
 * If-None-Match exactly as the shell sends it.
 *
 * The tier cases mirror `/api/map`'s: a visitor gets structure while
 * `map.public_structure` allows it and a 401 when it does not, and names ride
 * only for a reader the capability gate gives `map.viewPeople`.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { createOrgRole, endSeating, seatHolder, updateOrgRole } from "../lib/orgChart";
import { mapOrgEtag } from "../lib/mapOrg";
import { register } from "./mapOrg";

const flags = vi.hoisted(() => ({ publicStructure: true, viewPeople: false }));
vi.mock("../lib/variables", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/variables")>();
  return {
    ...real,
    boolVar: (key: string) => (key === "map.public_structure" ? flags.publicStructure : real.boolVar(key)),
  };
});

/* The gate itself is shared/capabilities.ts and has its own suite. Here it is
   asked one question, and the answer is whatever the case says it is. */
vi.mock("../../shared/capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../shared/capabilities")>();
  return {
    ...real,
    hasCapability: (cap: string, ctx: unknown) => (cap === "map.viewPeople" ? flags.viewPeople : real.hasCapability(cap as any, ctx as any)),
  };
});

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => handlers.set(`${method} ${p}`, handler);
  return { app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") }, handlers };
}

interface Out {
  status: number;
  body: any;
  headers: Record<string, string>;
  ended: boolean;
}

function makeRes() {
  const out: Out = { status: 200, body: undefined, headers: {}, ended: false };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; out.ended = true; return res; },
    end() { out.ended = true; return res; },
    setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = v; },
  };
  return { res, out };
}

const configured = testDbConfigured();

describe.skipIf(!configured)("GET /api/map/org, the live org an open map follows", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handler: Handler;
  let viewer: { id: string; name: string } | null = null;
  let admin = false;
  const circles = [
    { id: "land-circle", name: "Land Circle", order: 1, status: "active", isExample: false },
    { id: "hearth-council", name: "Hearth Council", order: 2, status: "forming", isExample: false },
  ];

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const { app, handlers } = collect();
    register(app, {
      authedUser: async () => viewer,
      isAdmin: async () => admin,
      capabilityCtx: async () => ({}) as any,
      circlesRepo: { all: () => circles } as any,
      members: { all: async () => [{ id: "u-bea", name: "Bea Okafor" }] } as any,
      firstName: (n: string) => String(n).split(/\s+/)[0],
      lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
      getPool: () => pool as any,
    });
    handler = handlers.get("GET /api/map/org")!;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    viewer = { id: "u-viewer", name: "Viewer" };
    admin = true;
    flags.viewPeople = false;
    flags.publicStructure = true;
    await pool.query("DELETE FROM `org_role_assignments`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `org_roles`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await createOrgRole(pool as any, { name: "Water Steward", circleId: "land-circle", aim: "Keep the springs running.", seats: 2 });
  });

  const poll = async (ifNoneMatch?: string) => {
    const { res, out } = makeRes();
    await handler({ params: {}, query: {}, body: {}, headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {} }, res);
    return out;
  };

  it("answers with the circles, the seats and a version the ETag names", async () => {
    const out = await poll();
    expect(out.status).toBe(200);
    expect(out.body.circles.map((c: any) => c.name)).toEqual(["Land Circle", "Hearth Council"]);
    expect(out.body.roles).toEqual([
      expect.objectContaining({ name: "Water Steward", circleId: "land-circle", state: "open", seats: 2, holderCount: 0 }),
    ]);
    expect(out.headers.etag).toBe(mapOrgEtag(out.body.version));
    expect(out.headers["cache-control"]).toBe("private, no-cache");
  });

  it("answers an unchanged village with a 304 and no body", async () => {
    const first = await poll();
    const again = await poll(first.headers.etag);
    expect(again.status).toBe(304);
    expect(again.body).toBeUndefined();
    expect(again.ended).toBe(true);
  });

  it("answers in full once a seat is created in the org tools, and the new seat is in it", async () => {
    const first = await poll();
    await createOrgRole(pool as any, { name: "Seed Keeper", circleId: "hearth-council" });
    const next = await poll(first.headers.etag);
    expect(next.status).toBe(200);
    expect(next.body.version).not.toBe(first.body.version);
    expect(next.body.roles.map((r: any) => r.name)).toEqual(expect.arrayContaining(["Water Steward", "Seed Keeper"]));
  });

  it("drops a seat the org tools retire, and moves a seat whose circle changes", async () => {
    const first = await poll();
    const id = first.body.roles[0].id;
    await updateOrgRole(pool as any, id, { circleId: "hearth-council" });
    const moved = await poll(first.headers.etag);
    expect(moved.status).toBe(200);
    expect(moved.body.roles[0].circleId).toBe("hearth-council");
    await updateOrgRole(pool as any, id, { active: false });
    const gone = await poll(moved.headers.etag);
    expect(gone.status).toBe(200);
    expect(gone.body.roles).toEqual([]);
  });

  it("follows a holder seated and unseated, with the name on the people tier", async () => {
    const first = await poll();
    const id = first.body.roles[0].id;
    const made = await seatHolder(pool as any, id, { displayName: "Ana Ruiz" });
    expect(made.ok, made.reason).toBe(true);
    const held = await poll(first.headers.etag);
    expect(held.status).toBe(200);
    expect(held.body.roles[0]).toMatchObject({ state: "partial", holderCount: 1, holders: [{ name: "Ana Ruiz" }] });
    await endSeating(pool as any, String(made.assignmentId), "test");
    const open = await poll(held.headers.etag);
    expect(open.status).toBe(200);
    expect(open.body.roles[0]).toMatchObject({ state: "open", holderCount: 0, holders: [] });
  });

  it("sends a visitor the shape and no names, under a version of its own", async () => {
    const id = (await poll()).body.roles[0].id;
    await seatHolder(pool as any, id, { displayName: "Ana Ruiz" });
    const people = await poll();
    viewer = null;
    admin = false;
    const shape = await poll();
    expect(shape.status).toBe(200);
    expect(shape.body.viewPeople).toBe(false);
    expect(shape.body.roles[0]).toMatchObject({ holderCount: 1, holders: [] });
    expect(shape.body.version).not.toBe(people.body.version);
    // The people tier's tag cannot turn a visitor's poll into a 304.
    expect((await poll(people.headers.etag)).status).toBe(200);
  });

  it("gives names to a member the gate grants map.viewPeople, and not to one it does not", async () => {
    const id = (await poll()).body.roles[0].id;
    await seatHolder(pool as any, id, { displayName: "Ana Ruiz" });
    admin = false;
    flags.viewPeople = false;
    expect((await poll()).body.roles[0].holders).toEqual([]);
    flags.viewPeople = true;
    expect((await poll()).body.roles[0].holders).toEqual([expect.objectContaining({ name: "Ana Ruiz" })]);
  });

  it("refuses a visitor when the village keeps its map to members", async () => {
    viewer = null;
    admin = false;
    flags.publicStructure = false;
    const out = await poll();
    expect(out.status).toBe(401);
    expect(out.body.error).toBe("auth_required");
  });
});
