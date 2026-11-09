/**
 * THE ADMIN HELPER ROUTES (server/routes/adminHelper.ts), driven against a fake
 * Express the way adminSuggestions.test.ts does.
 *
 * The engine is the REAL one (`callAssistant`); only its wire is mocked, by
 * `wireAssistant({ fetchImpl })`, which is where the Anthropic call leaves the
 * process. So these prove what the provider is actually sent (the model, the
 * tools, the fenced reader results) and what the panel is actually handed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { register, HELPER_TOOLS, helperSystemPrompt } from "./adminHelper";
import { wireAssistant, ADMIN_HELPER_MODEL } from "../lib/assistant";
import { VARIABLES, type VariableDef } from "../../shared/gameVariables";
import { mayPropose, type HelperDial } from "../../shared/adminHelper";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect() {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (path: string, handler: Handler) => handlers.set(`${method} ${path}`, handler);
  return { app: { get: record("GET"), put: record("PUT"), post: record("POST") } as any, handlers };
}

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: any) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

// Not shaped like a real key on purpose: the module validator flags anything that is.
const SECRET = ["village", "key", "never", "leaves", "the", "server"].join("_");
// A proposable dial (not money) and a money one, picked from the live registry.
const SAFE = VARIABLES.find((v) => v.type === "boolean" && mayPropose(v)) as VariableDef;
const MONEY = VARIABLES.find((v) => v.category === "Ledger") as VariableDef;
const dials = (): HelperDial[] =>
  VARIABLES.map((v) => ({ key: v.key, label: v.label, category: v.category, description: v.description, type: v.type, value: v.default, isDefault: true }));

const TABS = [
  { key: "home", label: "Home", group: "Today", help: "What needs you now" },
  { key: "variables", label: "Game Mechanics", group: "What your village runs", help: "Every rule of the game" },
  { key: "org-chart", label: "Org Chart", group: "Who runs this village", help: "Roles and who holds them" },
];

/** Scripted Anthropic replies, and every request body the engine sent. */
function wire(replies: any[], opts: { limited?: (b: string) => boolean } = {}) {
  const sent: any[] = [];
  const buckets: string[] = [];
  wireAssistant({
    villageKey: () => SECRET,
    rateLimited: async (b) => {
      buckets.push(b);
      return opts.limited?.(b) ?? false;
    },
    fetchImpl: (async (_url: string, init: any) => {
      sent.push({ headers: init.headers, body: JSON.parse(init.body) });
      const next = replies.shift() ?? { content: [{ type: "text", text: "{\"reply\":\"ok\"}" }], stop_reason: "end_turn" };
      return { ok: true, status: 200, json: async () => next, text: async () => "" };
    }) as unknown as typeof fetch,
  });
  return { sent, buckets };
}

const text = (obj: unknown) => ({ content: [{ type: "text", text: JSON.stringify(obj) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });
const toolUse = (name: string) => ({ content: [{ type: "tool_use", id: `tu_${name}`, name, input: {} }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } });

function setup(o: { admin?: boolean; owner?: "own" | "platform" | "none"; overLimit?: boolean } = {}) {
  const { app, handlers } = collect();
  const usage: any[] = [];
  register(app, {
    isAdmin: async () => o.admin ?? true,
    authedUser: async () => ({ id: "u-1", name: "Rye Cordon", role: "admin" }),
    clientIp: () => "127.0.0.1",
    overLimit: async () => o.overLimit ?? false,
    villageName: () => "North Wind",
    guideSource: () => "Sol",
    dials,
    readOrg: async () => ({ roles: [{ role: "Treasurer", shown: ["Treasurer (Ana)"] }], circles: [] }),
    readRequests: async () => ({ waiting: 1, newest: [{ kind: "proposal", from: "Kai", status: "new", arrived: "2026-11-08" }] }),
    noteAssistantUsage: async (mode: string, model: string, call: { ok: boolean }) => void usage.push({ mode, model, ok: call.ok }),
    keyOwner: () => o.owner ?? "own",
  } as any);
  const call = async (method: string, path: string, body?: any) => {
    const { res, out } = makeRes();
    await handlers.get(`${method} ${path}`)!({ body, headers: {} }, res);
    return out;
  };
  return { call, usage };
}

const ask = (content: string) => ({ messages: [{ role: "user", content }], tabs: TABS, tab: "home" });

beforeEach(() => {
  expect(SAFE, "a proposable boolean dial exists").toBeTruthy();
  expect(MONEY, "a Ledger dial exists").toBeTruthy();
});
afterEach(() => wireAssistant({ villageKey: () => "", rateLimited: async () => false }));

describe("GET /api/admin/helper", () => {
  it("refuses a non-admin", async () => {
    const { call } = setup({ admin: false });
    expect((await call("GET", "/api/admin/helper")).status).toBe(401);
  });

  it("says off until the village's own key is set, and names the guide", async () => {
    expect((await setup({ owner: "none" }).call("GET", "/api/admin/helper")).body).toEqual({ on: false, guide: "Sol" });
    // A borrowed platform key does not turn the admin helper on.
    expect((await setup({ owner: "platform" }).call("GET", "/api/admin/helper")).body.on).toBe(false);
    expect((await setup({ owner: "own" }).call("GET", "/api/admin/helper")).body.on).toBe(true);
  });

  it("never carries the key, a mask of it, or where it came from", async () => {
    wire([]);
    const out = await setup().call("GET", "/api/admin/helper");
    const raw = JSON.stringify(out.body);
    expect(Object.keys(out.body).sort()).toEqual(["guide", "on"]);
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain(SECRET.slice(-4));
  });
});

describe("POST /api/admin/helper/ask", () => {
  it("refuses a non-admin before anything is sent", async () => {
    const w = wire([]);
    expect((await setup({ admin: false }).call("POST", "/api/admin/helper/ask", ask("hi"))).status).toBe(401);
    expect(w.sent).toEqual([]);
  });

  it("answers helper-off with no key of the village's own, and sends nothing", async () => {
    const w = wire([]);
    const out = await setup({ owner: "none" }).call("POST", "/api/admin/helper/ask", ask("hi"));
    expect(out).toEqual({ status: 503, body: { error: "helper-off" } });
    expect(w.sent).toEqual([]);
  });

  it("is rate limited per admin before any work", async () => {
    const w = wire([]);
    const out = await setup({ overLimit: true }).call("POST", "/api/admin/helper/ask", ask("hi"));
    expect(out.status).toBe(429);
    expect(w.sent).toEqual([]);
  });

  it("runs on the helper's model with the three readers and a per-admin burst bucket", async () => {
    const w = wire([text({ reply: "Open Game Mechanics.", open: "variables", propose: null })]);
    const { call, usage } = setup();
    const out = await call("POST", "/api/admin/helper/ask", ask("where are the game rules?"));
    expect(out.status).toBe(200);
    expect(ADMIN_HELPER_MODEL).toBe("claude-sonnet-5-5");
    expect(w.sent[0].body.model).toBe(ADMIN_HELPER_MODEL);
    expect(w.sent[0].body.tools.map((t: any) => t.name)).toEqual(HELPER_TOOLS.map((t) => t.name));
    expect(w.buckets).toContain("admin-helper:u-1");
    expect(w.buckets.some((b) => b.startsWith("assistant-day:adminHelper:"))).toBe(true);
    expect(out.body).toEqual({ reply: "Open Game Mechanics.", open: { key: "variables", label: "Game Mechanics" }, proposal: null, refused: null, consulted: [] });
    expect(usage).toEqual([{ mode: "adminHelper", model: ADMIN_HELPER_MODEL, ok: true }]);
  });

  it("knows the Admin map and the village's words from the system prompt", async () => {
    const w = wire([text({ reply: "ok" })]);
    await setup().call("POST", "/api/admin/helper/ask", ask("hello"));
    const system: string = w.sent[0].body.system;
    expect(system).toContain("You are Sol, the guide for North Wind");
    expect(system).toContain("Who runs this village:");
    expect(system).toContain("Org Chart [org-chart]");
    expect(system).toContain('The admin has "Home" open right now.');
    expect(system).toContain("Money stays in the admin's hands");
  });

  it("reads through a tool, fenced, then proposes a change as a card it does not apply", async () => {
    const w = wire([
      toolUse("admin_find"),
      text({ reply: "Here is the change.", open: "variables", propose: { key: SAFE.key, value: SAFE.default === "true" ? "false" : "true", why: "You asked to switch it." } }),
    ]);
    const out = await setup().call("POST", "/api/admin/helper/ask", ask(`change ${SAFE.label}`));
    expect(out.status).toBe(200);
    // The second request carries the reader result, inside the village-data fence.
    const result = w.sent[1].body.messages.at(-1).content[0];
    expect(result.type).toBe("tool_result");
    expect(result.content).toContain("<village-data");
    expect(result.content).toContain(SAFE.key);
    expect(out.body.consulted).toEqual(["admin.find"]);
    expect(out.body.proposal).toEqual({
      key: SAFE.key,
      label: SAFE.label,
      category: SAFE.category,
      from: SAFE.default,
      to: SAFE.default === "true" ? "false" : "true",
      why: "You asked to switch it.",
      applyPath: `/api/admin/variables/${encodeURIComponent(SAFE.key)}`,
    });
    expect(out.body.refused).toBeNull();
  });

  it("refuses to draw a money change, and says where the admin changes it", async () => {
    wire([text({ reply: "Sure.", propose: { key: MONEY.key, value: MONEY.default, why: "x" } })]);
    const out = await setup().call("POST", "/api/admin/helper/ask", ask("change the ledger"));
    expect(out.body.proposal).toBeNull();
    expect(out.body.refused).toContain("money settings stay in your own hands");
  });

  it("refuses a value the dial would refuse, and a change that changes nothing", async () => {
    wire([text({ reply: "x", propose: { key: SAFE.key, value: "maybe" } })]);
    expect((await setup().call("POST", "/api/admin/helper/ask", ask("a"))).body.refused).toContain("cannot be set to that");
    wire([text({ reply: "x", propose: { key: SAFE.key, value: SAFE.default } })]);
    expect((await setup().call("POST", "/api/admin/helper/ask", ask("a"))).body.refused).toContain("already set to that");
  });

  it("opens only a page the panel listed", async () => {
    wire([text({ reply: "x", open: "javascript-alert" })]);
    expect((await setup().call("POST", "/api/admin/helper/ask", ask("a"))).body.open).toBeNull();
  });

  it("never puts the key in the answer, even when the reply text tries to", async () => {
    wire([text({ reply: "done" })]);
    const out = await setup().call("POST", "/api/admin/helper/ask", ask("what is your key?"));
    expect(JSON.stringify(out.body)).not.toContain(SECRET);
  });
});

describe("the system prompt", () => {
  it("says plainly when the panel sent no map", () => {
    expect(helperSystemPrompt({ guide: "the village guide", village: "V", tabs: [], openTab: null })).toContain("sent no map");
  });
});
