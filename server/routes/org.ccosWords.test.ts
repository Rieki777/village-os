/**
 * THE ADMIN ROLE EDIT REFUSES THE ROLE'S CCOS WORDS BY NAME (0274).
 *
 * The seven CCOS words change by consent, through an org chart draft, like the
 * handover words beside them (org.handoverWords.test.ts). `POST
 * /api/admin/org/roles` and `PUT /api/admin/org/roles/:id` refuse a body that
 * carries any of them, in either spelling, with 400 and a sentence, before
 * anything is read or written: the pool here throws on any query.
 */
import { describe, expect, it } from "vitest";
import { CCOS_WORDS_REFUSAL, carriesCcosWords, register } from "./org";
import { ROLE_CCOS_COLUMNS, ROLE_CCOS_FIELDS } from "../../shared/roleCcos";

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

describe("the admin role routes refuse the CCOS words", () => {
  for (const key of ROLE_CCOS_FIELDS) {
    const value = key === "authorities" || key === "responsibilities" ? ["One"] : "Words";
    it(`POST and PUT refuse ${key} with 400 and the sentence, touching nothing`, async () => {
      queries.length = 0;
      const made = await call("POST /api/admin/org/roles", { body: { name: "Water Steward", [key]: value } });
      expect(made).toEqual({ status: 400, body: { error: CCOS_WORDS_REFUSAL } });
      const edited = await call("PUT /api/admin/org/roles/:id", { params: { id: "r1" }, body: { aim: "An aim", [ROLE_CCOS_COLUMNS[key]]: value } });
      expect(edited.status).toBe(400);
      expect(edited.body.error).toBe(CCOS_WORDS_REFUSAL);
      expect(queries).toEqual([]);
    });
  }

  it("leaves the recruitment pack's own authority note to the admin edit (control: the refusal is about the CCOS keys)", async () => {
    queries.length = 0;
    expect(carriesCcosWords({ authority: "May sign small purchases", name: "x", accountabilities: [] })).toBe(false);
    await expect(call("POST /api/admin/org/roles", { body: { name: "Water Steward", authority: "May sign" } })).rejects.toThrow(
      /must not reach the database/,
    );
    expect(queries.length).toBeGreaterThan(0);
  });

  it("says plainly where the words change", () => {
    expect(CCOS_WORDS_REFUSAL).toBe(
      "These role words change by consent: this role exists while, what it can decide on its own, what it does regularly, holding it well, and its time. Propose them through an org chart draft.",
    );
    expect(carriesCcosWords(null)).toBe(false);
  });
});
