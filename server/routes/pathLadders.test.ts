/**
 * The ladder route, exercised as a handler against a stub pool.
 *
 * WHAT IS WORTH TESTING HERE is not the SQL, which has its own suite against a
 * real schema (`server/repos/pathLadders.test.ts`), and not the derivation,
 * which has its own (`server/lib/pathLadders.test.ts`). It is the three
 * decisions this handler makes on its own, and each of them is a decision that
 * fails quietly when it is wrong:
 *
 *  1. IT REFUSES A STRANGER. `housing_reservations` carries a name, an email
 *     and a phone number, and the founder's read of that table sits behind a
 *     capability for exactly that reason.
 *  2. IT SERVES ONLY THE PATHS THE MEMBER WALKS. A ladder is a claim about
 *     somebody's journey, and holding rows is not the same as walking a path.
 *  3. IT READS ONLY THE TABLES IT NEEDS. This runs on every profile load, and a
 *     member who claims nothing must not pay for four queries answering
 *     nothing.
 *
 * `register` is called against a fake Express that records handlers by method
 * and path, so what runs is the real registration and the real handler body.
 * Same shape as `server/routes/land.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { register } from "./pathLadders";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (path: string, handler: Handler) => {
    handlers.set(`${method} ${path}`, handler);
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

/** A pool that answers everything with no rows and remembers what it was asked. */
function stubPool() {
  const asked: string[] = [];
  const pool: any = {
    query: async (sql: string) => {
      asked.push(String(sql));
      return [[], []];
    },
  };
  return { pool, asked };
}

const mounted = (user: any, pool: any) => {
  const { app, handlers } = collect();
  register(app, {
    authedUser: async () => user,
    getPool: () => pool,
    lapseContext: () => ({ currentSeasonId: "s2", cadence: "season_turn" }),
  } as any);
  return handlers.get("GET /api/paths/ladders")!;
};

/** Which tables a run of the handler actually touched. */
const touched = (asked: string[], table: string) => asked.some((s) => s.includes(table));

describe("GET /api/paths/ladders", () => {
  it("refuses a stranger", async () => {
    const { pool, asked } = stubPool();
    const handler = mounted(null, pool);
    const { res, out } = makeRes();
    await handler({}, res);
    expect(out.status).toBe(401);
    expect(out.body).toEqual({ error: "auth_required" });
    // And it opened nothing on the way to saying so.
    expect(asked).toHaveLength(0);
  });

  it("opens no table for a member who walks no path", async () => {
    const { pool, asked } = stubPool();
    const handler = mounted({ id: "u1", paths: [] }, pool);
    const { res, out } = makeRes();
    await handler({}, res);
    expect(out.body).toEqual({ ladders: [] });
    expect(asked).toHaveLength(0);
  });

  it("reads only the tables the walked paths need", async () => {
    const { pool, asked } = stubPool();
    const handler = mounted({ id: "u1", paths: ["resident"] }, pool);
    const { res, out } = makeRes();
    await handler({}, res);
    expect(out.body.ladders.map((l: any) => l.pathId)).toEqual(["resident"]);
    expect(touched(asked, "housing_reservations")).toBe(true);
    expect(touched(asked, "org_role_assignments")).toBe(false);
    expect(touched(asked, "investor_path_facts")).toBe(false);
    expect(touched(asked, "member_ventures")).toBe(false);
  });

  it("serves a ladder for every walked path this build has columns for", async () => {
    const { pool } = stubPool();
    const handler = mounted(
      { id: "u1", paths: ["investor", "steward", "resident", "prosperity-creator", "elder"] },
      pool,
    );
    const { res, out } = makeRes();
    await handler({}, res);
    expect(out.body.ladders.map((l: any) => l.pathId)).toEqual([
      "investor",
      "steward",
      "resident",
      "prosperity-creator",
    ]);
  });

  /*
   * A member with no rows at all gets the empty state on every ladder, which is
   * the mechanic and a door. Never a rung, never a zero standing in for an
   * answer that has not arrived.
   */
  it("hands back the empty state when a walked path has no rows", async () => {
    const { pool } = stubPool();
    const handler = mounted({ id: "u1", paths: ["resident"] }, pool);
    const { res, out } = makeRes();
    await handler({}, res);
    expect(out.body.ladders[0].position).toBe(0);
    expect(out.body.ladders[0].empty.doorHref).toBe("/reserve");
  });

  /* Nothing on the wire may look like a stored position. */
  it("sends no stored rung anywhere on the wire", async () => {
    const { pool } = stubPool();
    const handler = mounted({ id: "u1", paths: ["investor"] }, pool);
    const { res, out } = makeRes();
    await handler({}, res);
    const wire = JSON.stringify(out.body);
    expect(wire).not.toMatch(/"rung"/);
    expect(wire).not.toMatch(/"toRung"/);
    expect(wire).not.toMatch(/cycle_id/);
  });
});
