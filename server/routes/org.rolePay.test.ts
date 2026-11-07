/**
 * ROLE PAY HAS A DOOR THAT IS NOT THE ADMIN PANEL (Rye, 2026-11-06, C2).
 *
 * "Role pay is set by the Treasurer AND the valuation algorithm." Until now a
 * role's worth, tokens and cash could be set only through
 * `PUT /api/admin/org/roles/:id`, behind `isAdmin`, so a village with no admin
 * had no way to pay a role at all (constitution 0.3, 0.4). This is the
 * Treasurer's door: `role.pay`, a transferable power the seeded Treasury role
 * holds. What it may write is the role's pay and nothing else.
 *
 *   1. A holder sets a role's worth, tokens and cash, and the role reads them back.
 *   2. Someone the gate refuses gets the gate's refusal, and nothing is written.
 *   3. A holder of the role being paid never sets its pay alone (the conflict
 *      rule): the refusal names the vote path, an org draft put to the village.
 *   4. Only pay is written: a name or a purpose in the body is ignored.
 *   5. The same checks as the admin door: Gratitude is refused by name, an
 *      example role is refused, an unknown role is a 404.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { listOrgRoles, seatHolder } from "../lib/orgChart";
import { register } from "./org";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return { app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") }, handlers };
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

describe.skipIf(!configured)("the Treasurer's door to a role's pay (role.pay)", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let actor = { id: "treasurer-1", name: "A Treasurer" };
  let holdsRolePay = true;
  const asked: string[] = [];

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const { app, handlers: h } = collect();
    register(app, {
      isAdmin: async () => true,
      authedUser: async () => actor,
      guardCapability: async (_req: any, res: any, key: string) => {
        asked.push(key);
        if (key === "role.pay" && !holdsRolePay) {
          res.status(403).json({ error: "capability_required", capability: key });
          return false;
        }
        return true;
      },
      getPool: () => pool,
      members: { all: async () => [] },
      firstName: (n: string) => n,
      capabilityCtx: async () => ({}),
      lapseContext: () => ({}),
      currentPatternId: () => null,
      seasonState: () => null,
      notify: async () => {},
      projectCurrency: () => "CRC",
    } as any);
    handlers = h;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    actor = { id: "treasurer-1", name: "A Treasurer" };
    holdsRolePay = true;
    asked.length = 0;
    await pool.query("DELETE FROM `org_role_assignments`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM `org_roles`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  const makeRole = async (name: string) => {
    const made = await call(handlers, "POST /api/admin/org/roles", { body: { name, seats: 1 } });
    expect(made.status).toBe(200);
    return String(made.body.id);
  };
  const roleOf = async (id: string) => (await listOrgRoles(pool)).find((r) => r.id === id)!;

  it("lets a holder set a role's worth, tokens and cash, asking the gate for role.pay", async () => {
    const id = await makeRole("Garden Steward");
    const out = await call(handlers, "PUT /api/org/roles/:id/pay", {
      params: { id },
      // The scratch schema has no Credits token, so the list is empty: naming one is checked exactly as the admin door checks it.
      body: { valueMinor: 15666800, valueTokens: [], cashMinor: 300000 },
    });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body).toMatchObject({ success: true });
    expect(asked).toContain("role.pay");
    const role: any = await roleOf(id);
    expect(role.valueMinor).toBe(15666800);
    expect(role.valueTokens).toEqual([]);
    expect(role.cashMinor).toBe(300000);
  });

  it("gives the gate's refusal to someone without the power, and writes nothing", async () => {
    const id = await makeRole("Garden Steward");
    holdsRolePay = false;
    const out = await call(handlers, "PUT /api/org/roles/:id/pay", { params: { id }, body: { valueMinor: 500000 } });
    expect(out.status).toBe(403);
    expect(((await roleOf(id)) as any).valueMinor ?? null).toBeNull();
  });

  it("never lets a holder of the role set its pay alone, and names the vote path instead", async () => {
    const id = await makeRole("Treasurer");
    await seatHolder(pool, id, { userId: "treasurer-1" });
    const out = await call(handlers, "PUT /api/org/roles/:id/pay", { params: { id }, body: { valueMinor: 9000000 } });
    expect(out.status).toBe(409);
    expect(out.body.error).toMatch(/your own role/i);
    expect(out.body.proposeInstead).toBe("/api/org/drafts/:id/put-to-village");
    expect(((await roleOf(id)) as any).valueMinor ?? null).toBeNull();
  });

  it("writes only pay: a name or a purpose in the body is ignored", async () => {
    const id = await makeRole("Garden Steward");
    const out = await call(handlers, "PUT /api/org/roles/:id/pay", { params: { id }, body: { name: "Renamed", purpose: "Something else", valueMinor: 100000 } });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const role: any = await roleOf(id);
    expect(role.name).toBe("Garden Steward");
    expect(role.valueMinor).toBe(100000);
  });

  it("refuses Gratitude by name, an unknown role, and nothing-to-write, as the admin door does", async () => {
    const id = await makeRole("Garden Steward");
    const grat = await call(handlers, "PUT /api/org/roles/:id/pay", { params: { id }, body: { valueTokens: [{ token: "hearts", amount: 5 }] } });
    expect(grat.status).toBe(400);
    const missing = await call(handlers, "PUT /api/org/roles/:id/pay", { params: { id: "no-such-role" }, body: { valueMinor: 1 } });
    expect(missing.status).toBe(404);
    const empty = await call(handlers, "PUT /api/org/roles/:id/pay", { params: { id }, body: { name: "only words" } });
    expect(empty.status).toBe(400);
  });
});
