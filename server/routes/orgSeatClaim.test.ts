/**
 * A TYPED NAME IS NOT A CREDENTIAL, so claiming a seat asks rather than takes.
 *
 * `POST /api/org/seatings/:id/claim` used to seat whoever signed in under a
 * name matching the one an admin had typed on a documented seating. Account
 * names are self-chosen at registration and editable afterwards through
 * `PUT /api/profile`, which writes `u.name` with no uniqueness check, so the
 * whole path was: read a holder's name off the org chart, set your own name to
 * it, press the button. `map.viewPeople` unlocks at the `guest` rung, which
 * every account holds the moment it exists, and the member tier of `/api/org`
 * carries a documented holder's FULL recorded name. The name the claim
 * checked was published to the person doing the checking.
 *
 * WHAT THE SEAT CARRIES, so nobody reads this as a fix for a display label:
 *
 *   - the moon settlement pays live `holder_kind = 'member'` seatings
 *     (`server/lib/economy.ts`, the `role.cycle` rules);
 *   - a seat flagged `represents_circle` opens `mayDeclare` for its circle,
 *     the one bridge from the seat plane to a permission
 *     (docs/ADR_2026-08_REPRESENTS_CIRCLE_DECLARES.md);
 *   - `visibleRules` in server/lib/resources.ts shows a holder the spending
 *     rules kept for holders of that seat and circle;
 *   - `greetersFor` in server/lib/arrival.ts routes every arrival, carrying a
 *     new member's name, to whoever holds the greeter seat.
 *
 * `seatHolder` already says the same thing from the other side: it refuses an
 * agent with a `userId` because that combination "would pass the settlement
 * job's `holder_kind = 'member'` filter and could open the one seat-plane
 * permission door in `mayDeclare`". The claim route built that exact
 * combination out of a string anybody could type.
 *
 * THE FIX KEEPS THE HONEST PATH. The offer still works on a name match, since
 * that is all a backfilled chart has to go on, and the claim now files a
 * request that a holder of `org.seat` confirms. Confirming converts the
 * documented row in place, so the seating keeps its id and its start date and
 * the seat's history does not restart.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { listOrgAssignments, seatHolder } from "../lib/orgChart";
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

describe.skipIf(!configured)("claiming a seat recorded under a name", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;

  /** Whoever the request is signed in as. Set per case. */
  let viewer: { id: string; name: string } | null = null;
  /** Whether the actor holds `org.seat`, which is what confirms a claim. */
  let holdsOrgSeat = true;
  const adminAlerts: Array<{ type: string; title: string; dedupeKey: string; link?: string }> = [];
  const told: Array<{ userId: string; type: string; title: string }> = [];

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const { app, handlers: h } = collect();
    register(app, {
      // FALSE, deliberately. An admin passes every gate, and a route whose
      // only guard is one an admin walks through cannot be tested for the
      // guard. Every case here signs in as an ordinary member.
      isAdmin: async () => false,
      authedUser: async () => viewer,
      guardCapability: async (_req: any, res: any, cap: string) => {
        if (cap === "org.seat" && holdsOrgSeat) return true;
        res.status(401).json({ error: "auth_required" });
        return false;
      },
      getPool: () => pool,
      members: { all: async () => [] },
      firstName: (n: string) => String(n).split(/\s+/)[0],
      capabilityCtx: async () => ({}),
      lapseContext: () => ({}),
      currentPatternId: () => null,
      seasonState: () => ({ seasons: [], current: null, timezone: "UTC" }),
      notify: async (input: any) => {
        told.push({ userId: input.userId, type: input.type, title: input.title });
      },
      notifyAdmins: async (type: string, title: string, dedupeKey: string, link?: string) => {
        adminAlerts.push({ type, title, dedupeKey, link });
      },
    } as any);
    handlers = h;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    viewer = null;
    holdsOrgSeat = true;
    adminAlerts.length = 0;
    told.length = 0;
    await pool.query("DELETE FROM `org_role_assignments`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `org_roles`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `org_roles` (`id`, `name`, `aim`, `seats`, `represents_circle`) VALUES ('seat-water', 'Water Steward', 'Keep the springs running.', 2, 1)",
    );
  });

  /** One documented holder, written through the store's own writer. */
  const document = async (displayName: string) => {
    const made = await seatHolder(pool, "seat-water", { displayName });
    expect(made.ok, made.reason).toBe(true);
    return String(made.assignmentId);
  };

  const rowOf = async (id: string) => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `holder_kind`, `user_id`, `display_name`, `started_at` FROM `org_role_assignments` WHERE `id` = ?",
      [id],
    );
    return rows[0];
  };

  it("does not seat a member whose typed name matches the recorded holder", async () => {
    const seating = await document("Wren Alder");
    // The name is not a secret: the member tier of `/api/org` publishes it,
    // and `PUT /api/profile` writes whatever a member types.
    viewer = { id: "u-impostor", name: "Wren Alder" };

    const offered = await call(handlers, "GET /api/org/my-unclaimed-seats");
    expect(
      (offered.body as any[]).map((o) => o.assignmentId),
      "the offer still stands on a name match, because a backfilled chart has nothing else",
    ).toEqual([seating]);

    const claimed = await call(handlers, "POST /api/org/seatings/:id/claim", {
      params: { id: seating },
    });
    expect(claimed.status).toBe(200);

    // Asserted before the response shape, so a red here reads as the seat
    // having moved and never as a changed payload.
    const after = await rowOf(seating);
    expect(after.holder_kind, "the seating is still the documented one").toBe("documented");
    expect(after.user_id, "no account may reach the seat by typing a name").toBeNull();
    expect(after.display_name).toBe("Wren Alder");
    expect(claimed.body.pending, "the answer says the seat was asked for, not taken").toBe(true);

    // A request nobody hears is the failure mode this repo has paid for twice.
    expect(adminAlerts).toHaveLength(1);
    expect(adminAlerts[0].title).toContain("Wren");
    expect(adminAlerts[0].dedupeKey).toBe(`seat-claim:${seating}:u-impostor`);
  });

  it("seats the member once a holder of org.seat confirms, keeping the seating's identity", async () => {
    const seating = await document("Wren Alder");
    viewer = { id: "u-wren", name: "Wren Alder" };
    const before = await rowOf(seating);

    expect((await call(handlers, "POST /api/org/seatings/:id/claim", { params: { id: seating } })).status).toBe(200);
    const confirmed = await call(handlers, "POST /api/org/seatings/:id/claim/confirm", {
      params: { id: seating },
      body: { userId: "u-wren" },
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);

    const after = await rowOf(seating);
    expect(after.holder_kind).toBe("member");
    expect(after.user_id).toBe("u-wren");
    expect(
      String(after.started_at),
      "the same row becomes a member holding, so the seat's history does not restart",
    ).toBe(String(before.started_at));

    const live = await listOrgAssignments(pool, {} as any);
    expect(live.filter((a) => a.orgRoleId === "seat-water"), "one seating, not two").toHaveLength(1);
    expect(told.map((t) => t.userId), "the member hears that the seat is theirs").toEqual(["u-wren"]);
  });

  it("refuses to confirm without the org.seat power, and writes nothing", async () => {
    const seating = await document("Wren Alder");
    viewer = { id: "u-wren", name: "Wren Alder" };
    await call(handlers, "POST /api/org/seatings/:id/claim", { params: { id: seating } });

    holdsOrgSeat = false;
    const refused = await call(handlers, "POST /api/org/seatings/:id/claim/confirm", {
      params: { id: seating },
      body: { userId: "u-wren" },
    });
    expect(refused.status).toBe(401);
    const after = await rowOf(seating);
    expect(after.holder_kind).toBe("documented");
    expect(after.user_id).toBeNull();
  });

  it("refuses a member the seat was never recorded under, and rings nobody", async () => {
    const seating = await document("Wren Alder");
    viewer = { id: "u-other", name: "Rook Salt" };

    const claimed = await call(handlers, "POST /api/org/seatings/:id/claim", {
      params: { id: seating },
    });
    expect(claimed.status).toBe(403);
    expect(adminAlerts, "a refused claim is not a request").toHaveLength(0);
    expect((await rowOf(seating)).holder_kind).toBe("documented");
  });

  it("refuses to confirm an example seating", async () => {
    const seating = await document("Wren Alder");
    await pool.query("UPDATE `org_role_assignments` SET `is_example` = 1 WHERE `id` = ?", [seating]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    viewer = { id: "u-wren", name: "Wren Alder" };

    const confirmed = await call(handlers, "POST /api/org/seatings/:id/claim/confirm", {
      params: { id: seating },
      body: { userId: "u-wren" },
    });
    expect(confirmed.status).toBe(409);
    const after = await rowOf(seating);
    expect(after.holder_kind, "a demo seating never becomes a real holding").toBe("documented");
    expect(after.user_id).toBeNull();
  });
});
