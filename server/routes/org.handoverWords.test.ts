/**
 * THE ADMIN ROLE EDIT REFUSES THE ROLE'S HANDOVER WORDS BY NAME.
 *
 * `POST /api/admin/org/roles` and `PUT /api/admin/org/roles/:id` used to
 * answer 200 to a body carrying `bringMe`, `notMine` or `runbook` and drop
 * them, so `/api/org` read them back as null. Those words change by consent,
 * through an org chart draft. Both routes now refuse with 400 and a sentence
 * before anything is read or written: the pool here throws on any query, so a
 * refusal that touched the database would fail the test.
 */
import { describe, expect, it } from "vitest";
import { carriesHandoverWords, HANDOVER_WORDS_REFUSAL, register } from "./org";

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

const queries: string[] = [];
const pool = {
  query: async (sql: string) => {
    queries.push(sql);
    throw new Error("a refused body must not reach the database");
  },
};

const { app, handlers } = collect();
register(app, {
  isAdmin: async () => true,
  authedUser: async () => ({ id: "founder-1", name: "A Founder" }),
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

const call = async (key: string, req: any) => {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const { res, out } = makeRes();
  await handler({ params: {}, body: {}, query: {}, ...req }, res);
  return out;
};

describe("the admin role routes refuse the handover words", () => {
  for (const key of ["bringMe", "notMine", "runbook"]) {
    it(`POST refuses ${key} with 400 and the sentence`, async () => {
      queries.length = 0;
      const out = await call("POST /api/admin/org/roles", { body: { name: "Water Steward", [key]: key === "runbook" ? "Words" : ["One"] } });
      expect(out.status).toBe(400);
      expect(out.body).toEqual({ error: HANDOVER_WORDS_REFUSAL });
      expect(queries).toEqual([]);
    });

    it(`PUT refuses ${key} with 400 and the sentence`, async () => {
      queries.length = 0;
      const out = await call("PUT /api/admin/org/roles/:id", { params: { id: "r1" }, body: { aim: "An aim", [key]: null } });
      expect(out.status).toBe(400);
      expect(out.body.error).toBe("Bring me, Not mine to hold and the runbook change by consent: propose them through an org chart draft.");
      expect(queries).toEqual([]);
    });
  }

  it("a body without them goes on to the database (control: the refusal is about the keys)", async () => {
    queries.length = 0;
    await expect(call("POST /api/admin/org/roles", { body: { name: "Water Steward" } })).rejects.toThrow(/must not reach the database/);
    expect(queries.length).toBeGreaterThan(0);
  });

  it("names exactly the handover keys, in both spellings", () => {
    expect(carriesHandoverWords({ bring_me: [] })).toBe(true);
    expect(carriesHandoverWords({ not_mine: [] })).toBe(true);
    expect(carriesHandoverWords({ name: "x", aim: "y", accountabilities: [] })).toBe(false);
    expect(carriesHandoverWords(null)).toBe(false);
  });
});
