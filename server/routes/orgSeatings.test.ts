/**
 * PATCH /api/admin/org/seatings/:id against a real scratch schema: the focus
 * and note on a live seating change, and nothing else about it does.
 *
 * The need: a member holds a role through their account, a duplicate
 * name-only record of the same person carries the focus note, and the note
 * moves onto the member seating before the duplicate is ended.
 */
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { createOrgRole, endSeating, seatHolder } from "../lib/orgChart";
import { register } from "./orgSeatings";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect() {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, h: Handler) => handlers.set(`${method} ${p}`, h);
  return { app: { get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE") }, handlers };
}

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
  };
  return { res, out };
}

describe.skipIf(!testDbConfigured())("PATCH /api/admin/org/seatings/:id, a live seating's focus and note", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let patch: Handler;
  let hasSeatKey = true;
  let roleId: string;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    const { app, handlers } = collect();
    register(app as any, {
      isAdmin: async () => true,
      authedUser: async () => ({ id: "u-admin", name: "Admin" }) as any,
      guardCapability: async (_req: any, res: any, cap: string) => {
        if (cap === "org.seat" && hasSeatKey) return true;
        res.status(403).json({ error: "forbidden" });
        return false;
      },
      adminActor: () => null,
      getPool: () => pool as any,
    } as any);
    patch = handlers.get("PATCH /api/admin/org/seatings/:id")!;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    hasSeatKey = true;
    await pool.query("DELETE FROM `org_role_assignments`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `org_roles`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    roleId = String((await createOrgRole(pool as any, { name: "Water Steward", circleId: "land-circle", aim: "Keep the springs running.", seats: 3 })) ?? "");
  });

  const call = async (id: string, body: any) => {
    const { res, out } = makeRes();
    await patch({ params: { id }, body }, res);
    return out;
  };
  const row = async (id: string) => {
    const [[r]] = await pool.query<any[]>("SELECT focus, note, display_name, holder_key, term_ends_at, started_at, ended_at FROM org_role_assignments WHERE id = ?", [id]); // module-review-ok: fixture read against the S5 scratch schema, never a production table
    return r;
  };

  it("changes the focus and leaves the holder and the term alone", async () => {
    const termEndsAt = new Date("2027-03-01T00:00:00Z");
    const made = await seatHolder(pool as any, roleId, { displayName: "Ana Ruiz", focus: "old focus", note: "keep me", termEndsAt });
    expect(made.ok, made.reason).toBe(true);
    const id = String(made.assignmentId);
    const before = await row(id);
    const out = await call(id, { focus: "  Spring intake  " });
    expect(out.status).toBe(200);
    const after = await row(id);
    expect(after.focus).toBe("Spring intake");
    expect(after.note).toBe("keep me");
    expect(after.display_name).toBe(before.display_name);
    expect(after.holder_key).toBe(before.holder_key);
    expect(after.term_ends_at).toEqual(before.term_ends_at);
    expect(after.started_at).toEqual(before.started_at);
    expect(after.ended_at).toBeNull();
  });

  it("sets a note, and an empty string clears one", async () => {
    const made = await seatHolder(pool as any, roleId, { displayName: "Ana Ruiz", focus: "f", note: "n" });
    const id = String(made.assignmentId);
    expect((await call(id, { note: "moved from the other record" })).status).toBe(200);
    expect((await row(id)).note).toBe("moved from the other record");
    expect((await call(id, { focus: "", note: "   " })).status).toBe(200);
    expect(await row(id)).toMatchObject({ focus: null, note: null });
  });

  it("answers 404 for an ended seating and for one that never existed, and changes nothing", async () => {
    const made = await seatHolder(pool as any, roleId, { displayName: "Ana Ruiz", focus: "kept" });
    const id = String(made.assignmentId);
    await endSeating(pool as any, id, "test");
    const out = await call(id, { focus: "changed" });
    expect(out.status).toBe(404);
    expect((await row(id)).focus).toBe("kept");
    expect((await call("no-such-seating", { focus: "x" })).status).toBe(404);
  });

  it("is refused without org.seat, and changes nothing", async () => {
    const made = await seatHolder(pool as any, roleId, { displayName: "Ana Ruiz", focus: "kept" });
    const id = String(made.assignmentId);
    hasSeatKey = false;
    expect((await call(id, { focus: "changed" })).status).toBe(403);
    expect((await row(id)).focus).toBe("kept");
  });

  it("refuses a standing example, an empty body, a non-text value and an over-long note", async () => {
    const made = await seatHolder(pool as any, roleId, { displayName: "Ana Ruiz", focus: "kept" });
    const id = String(made.assignmentId);
    expect((await call(id, {})).status).toBe(400);
    expect((await call(id, { focus: 5 })).status).toBe(400);
    expect((await call(id, { note: "x".repeat(1001) })).status).toBe(400);
    await pool.query("UPDATE org_role_assignments SET is_example = 1 WHERE id = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect((await call(id, { focus: "changed" })).status).toBe(409);
    expect((await row(id)).focus).toBe("kept");
  });
});
