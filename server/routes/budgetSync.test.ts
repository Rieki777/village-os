/**
 * SYNC BUDGET OVER HTTP, AND THE ON-OPEN READ (server/routes/budgetSync.ts,
 * registered by server/routes/budgets.ts; budgets spec R19, PR 2).
 *
 *   - a door holder's press reads Sera now and is answered the read, recorded
 *     as their role; anybody else is refused by the budget's one door (R21)
 *   - a press that loses the `saberra-budgets` lock hears the budgets sentence
 *   - "Sera does not report budgets yet" is an answer, never an error
 *   - everything Sera-specific sits behind the saberra module
 *   - the member read of the budget queues the on-open read once it has
 *     answered, and a refused read queues nothing (the registration order the
 *     two routes keep is pinned here, where no gate sees it)
 *
 * Driven against a fake Express on a real schema; the service is a fake MCP
 * client and the module gate is a stand-in that answers the way
 * `requireModule` answers an off module.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mod = vi.hoisted(() => ({ lifecycle: "members" }));
vi.mock("../lib/modules", async (orig) => ({
  ...(await orig<typeof import("../lib/modules")>()),
  requireModule: (id: string) => async (_req: any, res: any, next: (err?: unknown) => void) =>
    mod.lifecycle === "off" ? res.status(404).json({ error: "module_disabled", module: id }) : next(),
}));

import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { register as registerBudgets } from "./budgets";
import { adminGateWasConsulted } from "../lib/adminGate";
import { configureBudgets, resetBudgetEnv } from "../lib/budgets";
import { SERA_BUDGETS_BUSY, SERA_BUDGETS_LOCK, SERA_REPORTS_NO_BUDGETS, configureSeraBudgets, resetSeraBudgets } from "../lib/saberraBudgets";
import type { ToolInfo } from "../lib/saberraClient";
import { withNamedLock } from "../repos/namedLock";
import { LUNAR_CLOCK } from "../../shared/cycleClock";
import { moonPeriod } from "../../shared/budgets";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;
const configured = testDbConfigured();
const TZ = "UTC";
const MOON = LUNAR_CLOCK.boundsFor(new Date()).id;
const moon = moonPeriod(MOON, TZ)!;
const STAGES = ["visitor", "guest", "member", "co-creator"];
const USERS: Record<string, any> = {
  "u-sam": { id: "u-sam", name: "Sam Rivers", stage: "member" },
  "u-gil": { id: "u-gil", name: "Gil Guest", stage: "guest" },
  "u-hana": { id: "u-hana", name: "Hana Holder", stage: "member", caps: ["role.pay"] },
};

let db: TestDb;
let pool: mysql.Pool;
let handlers: Map<string, Handler>;

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows as any[];
}

const svc = { offered: true, records: [] as unknown[], calls: 0 };
const tools = (): ToolInfo[] => [{ name: "list_records", inputSchema: { type: "object", properties: { kind: { type: "string", enum: svc.offered ? ["circle", "budget"] : ["circle"] } } } }];
const record = (n: number) => ({
  id: n.toString(16).padStart(32, "0"),
  periodStart: moon.startsOn,
  periodEnd: moon.endsOn,
  circle: null,
  role: null,
  category: "role_pay",
  label: `Line ${n}`,
  currency: "CRC",
  plannedMinor: 100_000,
  spentMinor: null,
  status: "approved",
  changedAt: "2026-11-08T10:00:00Z",
});

function wire() {
  handlers = new Map();
  const record_ = (method: string) => (path: string, h: Handler) => void handlers.set(`${method} ${path}`, h);
  const app = { get: record_("GET"), post: record_("POST"), put: record_("PUT"), patch: record_("PATCH"), delete: record_("DELETE") } as any;
  registerBudgets(app, {
    authedUser: async (req: any) => req.user ?? null,
    capabilityCtx: async (u: any) => ({
      stageIndex: STAGES.indexOf(u.stage),
      stageIndexOf: (id: string) => STAGES.indexOf(id),
      roleCapabilities: u.caps ?? [],
      badgeDenies: [],
      isAdmin: false,
      villageHeld: [],
    }),
    getPool: () => pool,
    overLimit: async () => false,
    liveHoldersOf: async (cap: string) => (cap === "role.pay" ? ["u-hana"] : []),
    seasonState: () => ({ current: null, seasons: [], timezone: TZ }),
    projectCurrency: () => "CRC",
    rolesCarrying: (cap: string) => (cap === "role.pay" ? [{ id: "role-treasury", name: "Treasury" }] : []),
    roleHolders: () => [{ roleId: "role-treasury", userId: "u-hana" }],
    launched: async () => true,
    isFormerMember: async () => false,
    seatedRoleIds: async () => [],
  } as any);
}

async function call(method: string, path: string, user: string | null, params: Record<string, string> = {}) {
  const out: { status: number; body: any; gated: boolean } = { status: 200, body: undefined, gated: false };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(b: any) {
      out.body = b;
      return res;
    },
  };
  const req: any = { user: user ? USERS[user] : null, body: {}, params, query: {}, headers: {}, get: () => undefined };
  const h = handlers.get(`${method} ${path}`);
  if (!h) throw new Error(`no handler for ${method} ${path}`);
  await h(req, res);
  out.gated = adminGateWasConsulted(req);
  return out;
}

const pressAs = (user: string | null, source = "sera") => call("POST", "/api/admin/budgets/sync/:source", user, { source });

describe.skipIf(!configured)("Sync budget and the on-open read", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await q("INSERT INTO circles (id, name, layer) VALUES ('c-village', 'The Village', 'link')");
  }, 180_000);

  afterAll(async () => {
    resetBudgetEnv();
    resetSeraBudgets();
    await pool?.end();
    await db?.drop?.();
  });

  beforeEach(async () => {
    for (const t of ["budget_lines", "budget_syncs", "budget_sources", "health_events"]) await q(`DELETE FROM \`${t}\``);
    resetBudgetEnv();
    resetSeraBudgets();
    mod.lifecycle = "members";
    Object.assign(svc, { offered: true, records: [record(1)], calls: 0 });
    wire();
    configureBudgets({ timezone: () => TZ, currentMoonId: () => MOON });
    configureSeraBudgets({
      lifecycle: () => mod.lifecycle,
      preflight: () => ({ ok: true, client: { baseUrl: "https://sera.example.test/mcp", token: "t0ken", fetchImpl: (async () => new Response("")) as never } }),
      openSession: async () => "s-1",
      listTools: async () => ({ ok: true, tools: tools() }),
      callToolJson: async () => {
        svc.calls += 1;
        return { ok: true, value: { results: svc.records, has_more: false } };
      },
      clock: () => LUNAR_CLOCK,
    });
  });

  it("reads Sera now for a holder of the budget power, through the budget's door, and records the read as their role", async () => {
    const r = await pressAs("u-hana");
    expect(r).toMatchObject({ status: 200, gated: true, body: { state: "whole", landed: true, whole: true, records: 1, added: 1 } });
    expect(await q("SELECT `by`, by_as, ok, whole FROM budget_syncs")).toEqual([{ by: "u-hana", by_as: "Treasury", ok: 1, whole: 1 }]);
    expect(await q("SELECT label, changed_by, changed_as FROM budget_lines")).toEqual([{ label: "Line 1", changed_by: "u-hana", changed_as: "Treasury" }]);
  });

  it("refuses a member who does not hold the budget power, and a stranger, at the door, and reads nothing", async () => {
    const member = await pressAs("u-sam");
    expect(member).toMatchObject({ status: 403, gated: true, body: { code: "holders_only" } });
    expect((await pressAs(null)).status).toBe(401);
    expect(svc.calls).toBe(0);
    expect(await q("SELECT * FROM budget_syncs")).toEqual([]);
  });

  it("answers 409 with the budgets sentence while a budget read runs", async () => {
    const held = await withNamedLock(pool, SERA_BUDGETS_LOCK, () => pressAs("u-hana"));
    expect(held.ran && held.value).toMatchObject({ status: 409, body: { state: "busy", message: SERA_BUDGETS_BUSY } });
    expect(svc.calls).toBe(0);
  });

  it("answers 'Sera does not report budgets yet' as an answer, never an error", async () => {
    svc.offered = false;
    expect(await pressAs("u-hana")).toMatchObject({ status: 200, body: { state: "not_offered", message: SERA_REPORTS_NO_BUDGETS, landed: false } });
  });

  it("stays behind the saberra module, and answers 404 for a source with no puller", async () => {
    mod.lifecycle = "off";
    expect(await pressAs("u-hana")).toMatchObject({ status: 404, body: { error: "module_disabled", module: "saberra" } });
    expect(svc.calls).toBe(0);
    mod.lifecycle = "members";
    expect(await pressAs("u-hana", "upload")).toMatchObject({ status: 404, body: { error: "unknown_source" } });
  });

  it("queues one read for the village once the member read of the budget has answered, by nobody, and a refused read queues none", async () => {
    await q("INSERT INTO budget_sources (source, `on`, mode, schedule, set_by, set_as, set_at) VALUES ('sera', 1, 'auto', 'daily', 'u-hana', 'Treasury', NOW())");
    expect((await call("GET", "/api/budgets", "u-gil")).status).toBe(403);
    await new Promise((r) => setTimeout(r, 300));
    expect(svc.calls, "a guest's refused read queues nothing").toBe(0);
    const read = await call("GET", "/api/budgets", "u-sam");
    expect(read.status).toBe(200);
    await vi.waitFor(async () => expect(await q("SELECT `by`, by_as, ok FROM budget_syncs")).toEqual([{ by: null, by_as: null, ok: 1 }]), { timeout: 5000 });
    expect(svc.calls).toBe(1);
    // A second open a moment later reads nothing more.
    await call("GET", "/api/budgets", "u-sam");
    await new Promise((r) => setTimeout(r, 300));
    expect(svc.calls).toBe(1);
  });
});
