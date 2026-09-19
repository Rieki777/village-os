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
 *
 * THE ASK IS A ROW, not only a bell. `submissions` type `seat-claim`, through
 * the one repository the admin inbox reads, so a steward has something to work
 * and a second ask for the same seat is refused. `GET /api/org/seat-claims`
 * is what the control in the admin org chart draws; Confirm closes the row as
 * accepted and Decline closes it as declined and touches no seating.
 *
 * THE COLLECTION HERE IS REAL, built over the scratch schema with the same
 * spec `server/index.ts` uses. `dbCollection` names every spec'd column on
 * every INSERT, so a key the route forgets lands as an explicit NULL, and a
 * hand-written fake is exactly the shape that would not notice.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { listOrgAssignments, seatHolder } from "../lib/orgChart";
import { dbCollection } from "../repos/store-db";
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
  /**
   * THE REAL COLLECTION, over the scratch schema's own `submissions` table,
   * spec'd exactly as server/index.ts spec's it. A fake would not exercise the
   * thing most likely to break: `dbCollection` names EVERY column on every
   * INSERT, so a key this route forgets arrives as an explicit NULL.
   */
  let submissionsRepo: ReturnType<typeof dbCollection>;

  /** Whoever the request is signed in as. Set per case. */
  let viewer: { id: string; name: string; email?: string } | null = null;
  /** Whether the actor holds `org.seat`, which is what confirms a claim. */
  let holdsOrgSeat = true;
  const adminAlerts: Array<{ type: string; title: string; dedupeKey: string; link?: string }> = [];
  const told: Array<{ userId: string; type: string; title: string }> = [];

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    submissionsRepo = dbCollection(pool, {
      table: "submissions",
      orderBy: "`submitted_at`, `id`",
      columns: [
        { js: "id", db: "id" },
        { js: "type", db: "type" },
        { js: "status", db: "status" },
        { js: "data", db: "data", kind: "json" },
        { js: "rewarded", db: "rewarded", kind: "bool" },
        { js: "userId", db: "user_id" },
        { js: "userName", db: "user_name" },
        { js: "submittedAt", db: "submitted_at", kind: "time" },
      ],
    });
    await submissionsRepo.load();
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
      submissionsRepo,
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
    // The reload prints "something wrote this table without going through the
    // collection", which is the store correctly noticing this fixture's own
    // DELETE. Expected here, and worth leaving loud everywhere else.
    await pool.query("DELETE FROM `submissions`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await submissionsRepo.load();
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `org_roles` (`id`, `name`, `aim`, `seats`, `represents_circle`) VALUES ('seat-water', 'Water Steward', 'Keep the springs running.', 2, 1)",
    );
  });

  /** Every `seat-claim` row the table holds, straight from the database. */
  const asksInTable = async () => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `id`, `type`, `status`, `data`, `user_id`, `user_name` FROM `submissions` WHERE `type` = 'seat-claim' ORDER BY `submitted_at`, `id`",
    );
    return rows;
  };

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

  it("files exactly one row in the stewards' inbox, carrying what the control draws", async () => {
    const seating = await document("Wren Alder");
    viewer = { id: "u-wren", name: "Wren Alder", email: "wren@example.test" };

    expect((await call(handlers, "POST /api/org/seatings/:id/claim", { params: { id: seating } })).status).toBe(200);
    const rows = await asksInTable();
    expect(rows, "the ask is a row a steward can work, not only a bell").toHaveLength(1);
    expect(rows[0].status).toBe("new");
    expect(rows[0].user_id, "the row names who asked, so Confirm knows who to seat").toBe("u-wren");
    expect(rows[0].user_name).toBe("Wren Alder");
    // `data` is a json column and mysql2 hands it back parsed.
    const data = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
    expect(data).toMatchObject({
      assignmentId: seating,
      roleId: "seat-water",
      roleName: "Water Steward",
      recordedName: "Wren Alder",
      name: "Wren Alder",
      email: "wren@example.test",
    });
  });

  it("refuses a second open ask for the same seat, and says so", async () => {
    const seating = await document("Wren Alder");
    viewer = { id: "u-wren", name: "Wren Alder" };

    expect((await call(handlers, "POST /api/org/seatings/:id/claim", { params: { id: seating } })).status).toBe(200);
    const again = await call(handlers, "POST /api/org/seatings/:id/claim", { params: { id: seating } });
    expect(again.status).toBe(409);
    expect(String(again.body.error)).toContain("already asked");
    expect(await asksInTable(), "a second press files nothing").toHaveLength(1);
  });

  it("shows the open asks to a holder of org.seat, and refuses everybody else", async () => {
    const seating = await document("Wren Alder");
    viewer = { id: "u-wren", name: "Wren Alder" };
    await call(handlers, "POST /api/org/seatings/:id/claim", { params: { id: seating } });

    const queue = await call(handlers, "GET /api/org/seat-claims");
    expect(queue.status).toBe(200);
    expect(queue.body).toHaveLength(1);
    expect(queue.body[0]).toMatchObject({
      assignmentId: seating,
      roleId: "seat-water",
      roleName: "Water Steward",
      recordedName: "Wren Alder",
      userId: "u-wren",
      userName: "Wren Alder",
    });
    expect(queue.body[0].claimId, "the control needs a handle to decline by").toBeTruthy();

    holdsOrgSeat = false;
    const refused = await call(handlers, "GET /api/org/seat-claims");
    expect(refused.status, "the queue names members and is read by the power that answers it").toBe(401);
  });

  it("closes the ask when the seat is confirmed", async () => {
    const seating = await document("Wren Alder");
    viewer = { id: "u-wren", name: "Wren Alder" };
    await call(handlers, "POST /api/org/seatings/:id/claim", { params: { id: seating } });

    expect((await call(handlers, "POST /api/org/seatings/:id/claim/confirm", {
      params: { id: seating }, body: { userId: "u-wren" },
    })).status).toBe(200);

    expect((await asksInTable())[0].status).toBe("accepted");
    expect((await call(handlers, "GET /api/org/seat-claims")).body, "the queue is clear").toEqual([]);
  });

  it("drains every open ask for the seat it just filled, so none is left unanswerable", async () => {
    // The claim route reads the open asks and then inserts, with nothing in
    // between, so two presses close enough together both pass the check and
    // both file. The sibling raise-hand route serialises per member and power
    // for exactly this reason. Reaching the race directly is the cheap way to
    // ask the question that matters: what is the steward left holding.
    const seating = await document("Wren Alder");
    viewer = { id: "u-wren", name: "Wren Alder" };
    await call(handlers, "POST /api/org/seatings/:id/claim", { params: { id: seating } });
    await submissionsRepo.insert({
      id: "twin-of-the-first-press",
      type: "seat-claim",
      status: "new",
      rewarded: false,
      data: { assignmentId: seating, roleId: "seat-water", roleName: "Water Steward", recordedName: "Wren Alder", name: "Wren Alder", email: null },
      userId: "u-wren",
      userName: "Wren Alder",
      submittedAt: new Date().toISOString(),
    } as any);
    expect(await asksInTable(), "the race put two asks in front of the steward").toHaveLength(2);

    expect((await call(handlers, "POST /api/org/seatings/:id/claim/confirm", {
      params: { id: seating }, body: { userId: "u-wren" },
    })).status).toBe(200);

    // The seat has moved, so the twin can never be answered honestly: Confirm
    // would be refused over a seat already filled, and Decline would tell the
    // member no about a seat they are sitting in.
    expect(
      (await call(handlers, "GET /api/org/seat-claims")).body,
      "a queue that keeps an ask nobody can answer is a queue that fills up",
    ).toEqual([]);
  });

  it("closes the ask on a decline and leaves the seating documented", async () => {
    const seating = await document("Wren Alder");
    viewer = { id: "u-wren", name: "Wren Alder" };
    await call(handlers, "POST /api/org/seatings/:id/claim", { params: { id: seating } });
    const claimId = (await call(handlers, "GET /api/org/seat-claims")).body[0].claimId;
    told.length = 0;

    const declined = await call(handlers, "POST /api/org/seat-claims/:id/decline", { params: { id: claimId } });
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);

    const after = await rowOf(seating);
    expect(after.holder_kind, "saying no touches no seating").toBe("documented");
    expect(after.user_id).toBeNull();
    expect((await asksInTable())[0].status).toBe("declined");
    expect((await call(handlers, "GET /api/org/seat-claims")).body).toEqual([]);
    // A no that reaches nobody teaches people to stop asking.
    expect(told.map((t) => t.userId)).toEqual(["u-wren"]);
    expect(told[0].title).toContain("Water Steward");

    const twice = await call(handlers, "POST /api/org/seat-claims/:id/decline", { params: { id: claimId } });
    expect(twice.status, "an ask already answered is answered").toBe(404);
  });

  it("refuses to decline without the org.seat power", async () => {
    const seating = await document("Wren Alder");
    viewer = { id: "u-wren", name: "Wren Alder" };
    await call(handlers, "POST /api/org/seatings/:id/claim", { params: { id: seating } });
    const claimId = (await call(handlers, "GET /api/org/seat-claims")).body[0].claimId;

    holdsOrgSeat = false;
    const refused = await call(handlers, "POST /api/org/seat-claims/:id/decline", { params: { id: claimId } });
    expect(refused.status).toBe(401);
    expect((await asksInTable())[0].status, "nothing moved").toBe("new");
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
