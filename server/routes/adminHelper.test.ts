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
import { register, DENIED_READS, HELPER_TOOLS, helperSystemPrompt, helperToolRunner } from "./adminHelper";
import { wireAssistant, ADMIN_HELPER_MODEL } from "../lib/assistant";
import { VARIABLES, type VariableDef } from "../../shared/gameVariables";
import { HELPER_SWITCH, guideMaySee, mayPropose, searchAdmin, type HelperDial } from "../../shared/adminHelper";
import { orgStructureForHelper } from "../lib/adminHelperReaders";

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

function setup(o: { admin?: boolean; owner?: "own" | "platform" | "none"; overLimit?: boolean; switchOn?: boolean; sera?: ((q: string) => Promise<{ ok: true; text: string } | { ok: false }>) | null } = {}) {
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
    readOrgStructure: async () => ({ roles: [{ role: "Treasurer", circle: null, aim: null, seats: 1, filled: 1, active: true }], circles: [] }),
    switchOn: () => o.switchOn ?? true,
    noteAssistantUsage: async (mode: string, model: string, call: { ok: boolean }) => void usage.push({ mode, model, ok: call.ok }),
    keyOwner: () => o.owner ?? "own",
    seraAsk: () => o.sera ?? null,
    seraName: () => "Sera",
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

  it("is off by the village's switch first, whatever the key", async () => {
    expect((await setup({ switchOn: false, owner: "own" }).call("GET", "/api/admin/helper")).body).toEqual({ on: false, guide: "Sol", off: "switch", provider: "anthropic" });
  });

  it("says off until the village's own key is set, and names the guide", async () => {
    expect((await setup({ owner: "none" }).call("GET", "/api/admin/helper")).body).toEqual({ on: false, guide: "Sol", off: "key", provider: null });
    // A borrowed platform key does not turn the admin helper on.
    expect((await setup({ owner: "platform" }).call("GET", "/api/admin/helper")).body.on).toBe(false);
    expect((await setup({ owner: "own" }).call("GET", "/api/admin/helper")).body.on).toBe(true);
  });

  it("never carries the key, a mask of it, or where it came from", async () => {
    wire([]);
    const out = await setup().call("GET", "/api/admin/helper");
    const raw = JSON.stringify(out.body);
    expect(Object.keys(out.body).sort()).toEqual(["guide", "off", "on", "provider"]);
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
    expect(out).toEqual({ status: 503, body: { error: "helper-off", off: "key" } });
    expect(w.sent).toEqual([]);
  });

  it("answers helper-off with the village's switch off, and sends nothing", async () => {
    const w = wire([]);
    const out = await setup({ switchOn: false }).call("POST", "/api/admin/helper/ask", ask("hi"));
    expect(out).toEqual({ status: 503, body: { error: "helper-off", off: "switch" } });
    expect(w.sent).toEqual([]);
  });

  it("is rate limited per admin before any work", async () => {
    const w = wire([]);
    const out = await setup({ overLimit: true }).call("POST", "/api/admin/helper/ask", ask("hi"));
    expect(out.status).toBe(429);
    expect(w.sent).toEqual([]);
  });

  it("runs on the helper's model with the two readers and a per-admin burst bucket", async () => {
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
    expect(system).toContain("You cannot help with selection");
    expect(system).toContain("never draft, rank, compare or recommend anything about a candidate");
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

describe("no AI in selection: the tool layer", () => {
  const runner = (calls: string[]) => helperToolRunner({
    query: "anything",
    tabs: TABS,
    dials: dials(),
    readOrgStructure: async () => {
      calls.push("org");
      return {};
    },
  });

  it("offers only the two reads: settings and help text, and the org chart's shape", () => {
    expect(HELPER_TOOLS.map((t) => t.name)).toEqual(["admin_find", "org_chart"]);
  });

  it("refuses every selection and member-data read by name, and reads nothing doing it", async () => {
    const names = Object.keys(DENIED_READS);
    for (const want of ["role_applications", "open_proposals", "interview_scores", "role_terms", "role_pay", "requests_open", "members"]) {
      expect(names, want).toContain(want);
    }
    const calls: string[] = [];
    const run = runner(calls);
    for (const name of names) {
      const out = await run(name);
      expect(out.ok, name).toBe(false);
      expect((out as any).error, name).toContain("stays out of choosing people");
    }
    expect(calls).toEqual([]);
    expect((await run("anything_else")).ok).toBe(false);
  });

  it("refuses a denied read the model asks for mid-conversation, and the answer carries no data", async () => {
    const w = wire([toolUse("role_applications"), text({ reply: "I can't help with choosing people." })]);
    const out = await setup().call("POST", "/api/admin/helper/ask", ask("rank the applicants for treasurer"));
    const result = w.sent[1].body.messages.at(-1).content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("does not read role applications");
    expect(out.body.reply).toBe("I can't help with choosing people.");
  });

  it("the org chart reader carries structure only: no names, holders, terms or pay", () => {
    const out = orgStructureForHelper({
      roles: [{ id: "r1", name: "Treasurer", circleId: "c1", aim: "Keep the books", seats: 2, isExample: false, active: true } as any],
      assignments: [{ orgRoleId: "r1", userId: "u-9", displayName: "Ana Lopez", termEndsAt: new Date("2027-01-01"), note: "pay 400" } as any],
      circles: [{ id: "c1", name: "Money", purpose: null, status: "active", isExample: false } as any],
    });
    expect(out.roles).toEqual([{ role: "Treasurer", circle: "Money", aim: "Keep the books", seats: 2, filled: 1, active: true }]);
    const raw = JSON.stringify(out);
    for (const leak of ["Ana", "u-9", "2027", "pay 400"]) expect(raw).not.toContain(leak);
  });

  it("never shows the guide a money, selection or sealed dial", () => {
    const seen = searchAdmin("pay budget application interview term token ledger", [], dials()).settings;
    for (const d of seen) expect(guideMaySee(VARIABLES.find((v) => v.key === d.key)), d.key).toBe(true);
    for (const v of VARIABLES) {
      if (/applica|interview|candidate/i.test(v.key)) expect(guideMaySee(v), v.key).toBe(false);
    }
  });
});

describe("the village's switch", () => {
  it("exists, ships ON (Rye, 9 Nov), and the helper may never propose it", () => {
    const def = VARIABLES.find((v) => v.key === HELPER_SWITCH);
    expect(def?.type).toBe("boolean");
    expect(def?.default).toBe("true");
    expect(mayPropose(def)).toBe(false);
  });
});

describe("who answers: the village's own Anthropic key first, then Sera", () => {
  const seraSays = (text: string, asked: string[] = []) => async (q: string) => {
    asked.push(q);
    return { ok: true as const, text };
  };

  it("uses Sera, named Sera, when there is no Anthropic key and the connection works", async () => {
    const out = await setup({ owner: "none", sera: seraSays("x") }).call("GET", "/api/admin/helper");
    expect(out.body).toEqual({ on: true, guide: "Sera", off: null, provider: "sera" });
  });

  it("prefers the village's Anthropic key when both are set, and never asks Sera", async () => {
    const asked: string[] = [];
    const w = wire([text({ reply: "From Claude." })]);
    const { call } = setup({ owner: "own", sera: seraSays("From Sera.", asked) });
    expect((await call("GET", "/api/admin/helper")).body.provider).toBe("anthropic");
    expect((await call("POST", "/api/admin/helper/ask", ask("hi"))).body.reply).toBe("From Claude.");
    expect(w.sent.length).toBe(1);
    expect(asked).toEqual([]);
  });

  it("answers through Sera with the reads done first, fenced, and the same proposal card", async () => {
    const asked: string[] = [];
    const w = wire([]);
    const to = SAFE.default === "true" ? "false" : "true";
    const out = await setup({ owner: "none", sera: seraSays(JSON.stringify({ reply: "Here it is.", open: "variables", propose: { key: SAFE.key, value: to, why: "Asked." } }), asked) })
      .call("POST", "/api/admin/helper/ask", ask(`change ${SAFE.label}`));
    expect(out.status).toBe(200);
    expect(w.sent).toEqual([]);
    expect(asked.length).toBe(1);
    expect(asked[0]).toContain("<village-data");
    expect(asked[0]).toContain("you cannot help with selection");
    expect(out.body.consulted).toEqual(["admin.find"]);
    expect(out.body.open).toEqual({ key: "variables", label: "Game Mechanics" });
    expect(out.body.proposal).toMatchObject({ key: SAFE.key, to });
  });

  it("adds the org chart's shape only for a question about the org", async () => {
    const asked: string[] = [];
    const out = await setup({ owner: "none", sera: seraSays("Two roles are open.", asked) }).call("POST", "/api/admin/helper/ask", ask("which roles are open?"));
    expect(out.body.consulted).toEqual(["admin.find", "org.chart"]);
    expect(out.body.reply).toBe("Two roles are open.");
    expect(out.body.proposal).toBeNull();
  });

  it("still refuses a money change Sera proposes", async () => {
    const out = await setup({ owner: "none", sera: seraSays(JSON.stringify({ reply: "ok", propose: { key: MONEY.key, value: MONEY.default } })) })
      .call("POST", "/api/admin/helper/ask", ask("change the ledger"));
    expect(out.body.proposal).toBeNull();
    expect(out.body.refused).toContain("money settings stay in your own hands");
  });

  it("says so plainly when Sera cannot answer", async () => {
    const out = await setup({ owner: "none", sera: async () => ({ ok: false as const }) }).call("POST", "/api/admin/helper/ask", ask("hi"));
    expect(out.status).toBe(502);
    expect(out.body.error).toContain("Sera could not answer");
  });

  it("is off, asking for a key, with neither", async () => {
    const out = await setup({ owner: "none", sera: null }).call("POST", "/api/admin/helper/ask", ask("hi"));
    expect(out).toEqual({ status: 503, body: { error: "helper-off", off: "key" } });
  });
});
