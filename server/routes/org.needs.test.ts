/**
 * A seat says what need it is held for, and R18 becomes a number.
 *
 * R18, in the founder's own words: "the more needs you're trying to meet the
 * more roles you need in your economy to help meet all the needs". The deck
 * asks for "Roles Filled: 6 of 12", and half of that fraction has been
 * computable since migration 0049, which derives a held seat from live
 * assignments and says so in its own comment. The other half was missing
 * because nothing joined a seat to a need. These are the outcomes of closing
 * that join:
 *
 *   1. `GET /api/org/roles/:id/needs` answers with the tags on one seat, and
 *      refuses a stranger, which is the tier `GET /api/needs/scope` sits at.
 *   2. The coverage read COUNTS THE SEATS a tagged role advertises, and counts
 *      them as filled only once somebody is actually in one. Measured across a
 *      seating, so the number moves for a reason.
 *   3. A seat taken out of the chart stops being counted, without any of its
 *      tags being deleted. There is no delete route for a seat in this tree:
 *      `updateOrgRole` sets `active = 0`, and `needSeatings` joins on
 *      `active = 1`. So the orphan case for a role is a filter and not a
 *      cascade, and this is the test that says so.
 *
 * The seat's own read payload is assembled inside `GET /api/org`, which is in
 * server/index.ts under a ratchet, so the tags could not be added to it. That
 * is why the route under test is a sibling of the seat's history read.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { linkNeed, needSeatings, upsertScopeNeed } from "../lib/needs";
import { seatHolder, updateOrgRole } from "../lib/orgChart";
import { register } from "./org";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") },
    handlers,
  };
}

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

const call = async (handlers: Map<string, Handler>, key: string, req: any = {}) => {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const { res, out } = makeRes();
  await handler({ params: {}, body: {}, query: {}, ...req }, res);
  return out;
};

const configured = testDbConfigured();

describe.skipIf(!configured)("a seat carries the needs it is held for", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let signedIn = true;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const { app, handlers: h } = collect();
    register(app, {
      isAdmin: async () => true,
      authedUser: async () => (signedIn ? { id: "founder-1", name: "A Founder" } : null),
      guardCapability: async () => true,
      getPool: () => pool,
      members: { all: async () => [] },
      firstName: (n: string) => n,
      capabilityCtx: async () => ({}),
      lapseContext: () => ({}),
      currentPatternId: () => null,
      seasonState: () => null,
      notify: async () => {},
    } as any);
    handlers = h;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    signedIn = true;
    await pool.query("DELETE FROM `need_links`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `village_needs`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `org_role_assignments`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `org_roles`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await upsertScopeNeed(pool, { needKey: "vitality" });
  });

  const makeSeat = async (name: string, seats: number) => {
    const made = await call(handlers, "POST /api/admin/org/roles", { body: { name, seats } });
    expect(made.status).toBe(200);
    return String(made.body.id);
  };

  it("answers with the tags on one seat, and refuses a stranger", async () => {
    const id = await makeSeat("Water Steward", 2);
    const empty = await call(handlers, "GET /api/org/roles/:id/needs", { params: { id } });
    expect(empty.body.needs, "an untagged seat answers a real empty list").toEqual([]);

    await linkNeed(pool, {
      needKey: "vitality",
      subjectType: "role",
      subjectRef: id,
      weight: "primary",
    });
    const read = await call(handlers, "GET /api/org/roles/:id/needs", { params: { id } });
    expect(read.status).toBe(200);
    expect(read.body.needs).toHaveLength(1);
    expect(read.body.needs[0].needKey).toBe("vitality");
    expect(read.body.needs[0].weight).toBe("primary");

    signedIn = false;
    const stranger = await call(handlers, "GET /api/org/roles/:id/needs", { params: { id } });
    expect(stranger.status).toBe(401);
  });

  it("counts the seats a tagged role leans on, and counts them held when somebody is in one", async () => {
    const id = await makeSeat("Water Steward", 2);
    await linkNeed(pool, { needKey: "vitality", subjectType: "role", subjectRef: id });

    const before = (await needSeatings(pool)).find((s) => s.needKey === "vitality")!;
    expect(before.seatsNeeded, "two seats are advertised on the tagged role").toBe(2);
    expect(before.seatsFilled, "nobody is in either of them yet").toBe(0);
    expect(before.rolesWithNobodyInThem.map((r) => r.name)).toEqual(["Water Steward"]);

    // Seated through the store's own writer. A hand-built INSERT here missed
    // `holder_key`, which is NOT NULL, so the raw row could never have existed
    // in production either.
    const seated = await seatHolder(pool, id, { userId: "u-1" });
    expect(seated.ok).toBe(true);
    const after = (await needSeatings(pool)).find((s) => s.needKey === "vitality")!;
    expect(after.seatsNeeded).toBe(2);
    expect(after.seatsFilled, "one of the two is now held").toBe(1);
    expect(after.rolesWithNobodyInThem).toEqual([]);
  });

  it("stops counting a seat taken out of the chart, and keeps its tag", async () => {
    const id = await makeSeat("Water Steward", 2);
    await linkNeed(pool, { needKey: "vitality", subjectType: "role", subjectRef: id });
    expect((await needSeatings(pool))[0].seatsNeeded).toBe(2);

    await updateOrgRole(pool, id, { active: false });
    expect(
      (await needSeatings(pool))[0].seatsNeeded,
      "a seat the village retired counts toward nothing",
    ).toBe(0);
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) AS n FROM `need_links` WHERE `subject_type` = 'role' AND `subject_ref` = ?",
      [id],
    );
    expect(Number(rows[0].n), "the tag survives, because the seat was never deleted").toBe(1);
  });
});
