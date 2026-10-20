import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { COMMS_CHANGE } from "../../shared/comms/memberView";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import type { PostOfficeDeps } from "../lib/comms/postOffice";
import { register as registerJourneys } from "./commsJourneys";
import { register } from "./commsMembers";
import { register as registerWords } from "./commsWords";

/**
 * The member's view of the village's email and its "Propose a change" door
 * (the comms build spec 5.13), driven through the handlers against a
 * provisioned schema. The module gate in front of both routes is
 * `requireModule("comms")`, the platform's own and tested where it lives; here
 * the questions are what a member sees, that nothing they can reach changes
 * the email, and where each proposal goes.
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

/** A fake Express that keeps the last handler of each route, skipping the module gate before it. */
function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (path: string, ...fns: Handler[]) => {
    handlers.set(`${method} ${path}`, fns[fns.length - 1]);
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
    json(body: any) {
      out.body = body;
      return res;
    },
    set() {
      return res;
    },
  };
  return { res, out };
}

const MEMBER = { id: "u-ana", name: "Ana Rivera", email: "ana@village.example.test", role: "member" };

function setup(opts: { user?: any; limited?: boolean } = {}) {
  const filed: any[] = [];
  const bells: Array<[string, string, string, string | undefined]> = [];
  const user = opts.user === undefined ? MEMBER : opts.user;
  const { app, handlers } = collect();
  const office: PostOfficeDeps = {
    getPool: () => pool,
    transport: { name: "resend", send: async () => ({ ok: true, providerId: "p" }) },
    sender: () => "Village <hello@village.example.test>",
    hasApiKey: () => true,
    origin: () => "https://village.example.test",
  };
  const deps = {
    authedUser: async () => user,
    getPool: () => pool,
    overLimit: async () => opts.limited ?? false,
    notifyAdmins: async (type: string, title: string, key: string, link?: string) => {
      bells.push([type, title, key, link]);
    },
    submissionsRepo: {
      insert: async (row: any) => {
        filed.push(row);
        return row;
      },
    },
    deploymentOrigin: () => "https://village.example.test",
    // A member holds no comms.manage: every look and every change refuses them.
    mayStillSee: async () => false,
    guardCapability: async (_req: any, res: any, _cap: any, refusal: any) => {
      res.status(refusal.status).json(refusal.body);
      return false;
    },
    commsPostOffice: office,
    members: { all: () => [] },
  } as any;
  register(app, deps);
  registerJourneys(app, deps);
  registerWords(app, deps);
  const call = async (method: string, route: string, req: { params?: Record<string, string>; body?: unknown } = {}) => {
    const handler = handlers.get(`${method} ${route}`);
    if (!handler) throw new Error(`no handler for ${method} ${route}`);
    const { res, out } = makeRes();
    await handler({ params: req.params ?? {}, body: req.body ?? {}, headers: {} }, res);
    return out;
  };
  return { call, filed, bells, handlers };
}

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 4 });
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

describe.skipIf(!configured)("the member's view of the village's email", () => {
  it("registers a read and a door, and no route that changes anything", () => {
    const mine = [...setup().handlers.keys()].filter((k) => k.includes("/api/comms/village"));
    expect(mine.sort()).toEqual(["GET /api/comms/village", "POST /api/comms/village/propose"]);
  });

  it("a member sees every journey with its state, steps, timing and words, and the comms dials", async () => {
    const { call } = setup();
    const got = await call("GET", "/api/comms/village");
    expect(got.status).toBe(200);
    const keys = got.body.journeys.map((j: any) => j.key);
    expect(keys).toEqual(expect.arrayContaining(["gathering.going", "gathering.host", "member.welcome", "joining.request", "path.resident"]));

    const going = got.body.journeys.find((j: any) => j.key === "gathering.going");
    expect(going).toMatchObject({ title: "Saying yes to a gathering", state: "off" });
    expect(going.steps.map((s: any) => [s.key, s.timing])).toEqual([
      ["confirm", "When they say yes"],
      ["day", "1 day before it starts"],
      ["soon", "2 hours before it starts"],
    ]);
    // The words are the ones the village sends, greeting the reader by name with sample facts.
    expect(going.steps[0].email.subject).toBe("You're coming to Community supper");
    expect(going.steps[0].email.text.startsWith("Hi Ana,")).toBe(true);
    expect(going.stops.length).toBeGreaterThan(0);

    const resident = got.body.journeys.find((j: any) => j.key === "path.resident");
    expect(resident.steps.map((s: any) => s.timing)).toEqual([
      "When they start the path", "2 days after they start the path", "5 days after they start the path",
      "10 days after they start the path", "21 days after they start the path",
    ]);
    expect(resident.steps.every((s: any) => s.email && s.email.text.length > 0)).toBe(true);

    expect(got.body.others.map((g: any) => g.title)).toEqual(expect.arrayContaining(["When a gathering changes", "Time votes", "Letters"]));

    const dials = new Map(got.body.dials.map((d: any) => [d.key, d]));
    expect(dials.get("comms.daily_cap")).toMatchObject({ value: "2", defaultValue: "2", isDefault: true, door: "mechanics" });
    expect(dials.get("comms.retention_months")).toMatchObject({ door: "submission" });
    expect([...dials.keys()].every((k) => String(k).startsWith("comms."))).toBe(true);
  });

  it("a member cannot change a journey, a step or an email's words", async () => {
    const { call } = setup();
    const on = await call("POST", "/api/admin/comms/journeys/:key/state", { params: { key: "gathering.going" }, body: { state: "on" } });
    expect(on.status).toBe(403);
    const step = await call("PUT", "/api/admin/comms/journeys/:key/steps/:step", {
      params: { key: "gathering.going", step: "day" },
      body: { offsetMinutes: -60 },
    });
    expect(step.status).toBe(403);
    const words = await call("PUT", "/api/admin/comms/words/:key", { params: { key: "gathering.confirm" }, body: { subject: "Mine now", bodyMd: "x" } });
    expect(words.status).toBe(403);

    const [rows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM comms_journeys"); // module-review-ok: reading back the scratch schema this suite provisioned
    expect(Number(rows[0].n)).toBe(0);
    const [tpl] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM comms_templates"); // module-review-ok: reading back the scratch schema this suite provisioned
    expect(Number(tpl[0].n)).toBe(0);
    const again = await call("GET", "/api/comms/village");
    expect(again.body.journeys.find((j: any) => j.key === "gathering.going").state).toBe("off");
  });

  it("the propose door files a comms-change submission for an email's words, and rings the founders", async () => {
    const { call, filed, bells } = setup();
    const got = await call("POST", "/api/comms/village/propose", {
      body: { target: "words", key: "gathering.confirm", change: "Say what to bring in the confirmation." },
    });
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(got.body.filed).toBe(true);
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({
      type: COMMS_CHANGE,
      status: "new",
      userId: "u-ana",
      data: { target: "words", key: "gathering.confirm", change: "Say what to bring in the confirmation.", email: MEMBER.email },
    });
    expect(bells).toEqual([["submission", expect.stringContaining("Ana proposed a change"), `${COMMS_CHANGE}:${filed[0].id}`, "/admin?tab=submissions"]]);
  });

  it("files a step or a founder-held dial too, and names the journey it is about", async () => {
    const { call, filed } = setup();
    const step = await call("POST", "/api/comms/village/propose", {
      body: { target: "step", key: "path.resident", step: "meet_us", change: "Send the gathering invite a week in." },
    });
    expect(step.status, JSON.stringify(step.body)).toBe(200);
    expect(filed[0].data).toMatchObject({ target: "step", key: "path.resident", step: "meet_us", about: "Resident path" });
    const dial = await call("POST", "/api/comms/village/propose", {
      body: { target: "dial", key: "comms.retention_months", change: "Keep the record for a year only." },
    });
    expect(dial.status, JSON.stringify(dial.body)).toBe(200);
    expect(filed[1].data).toMatchObject({ target: "dial", key: "comms.retention_months" });
  });

  it("sends a dial the village votes on to the Game Mechanics page, and files nothing", async () => {
    const { call, filed, bells } = setup();
    const got = await call("POST", "/api/comms/village/propose", {
      body: { target: "dial", key: "comms.daily_cap", change: "Three emails a day is fine." },
    });
    expect(got.status).toBe(409);
    expect(got.body.link).toBe("/game-mechanics?dial=comms.daily_cap");
    expect(filed).toEqual([]);
    expect(bells).toEqual([]);
  });

  it("refuses a stranger, a key nobody has, a proposal with no words, and a flood", async () => {
    const signedOut = setup({ user: null });
    expect((await signedOut.call("GET", "/api/comms/village")).status).toBe(401);
    expect((await signedOut.call("POST", "/api/comms/village/propose", { body: {} })).status).toBe(401);

    const { call, filed } = setup();
    expect((await call("POST", "/api/comms/village/propose", { body: { target: "words", key: "no.such.email", change: "Change this one please." } })).status).toBe(404);
    expect((await call("POST", "/api/comms/village/propose", { body: { target: "step", key: "gathering.going", step: "nope", change: "Change this one please." } })).status).toBe(404);
    expect((await call("POST", "/api/comms/village/propose", { body: { target: "words", key: "gathering.confirm", change: "short" } })).status).toBe(400);
    expect(filed).toEqual([]);

    const flooded = setup({ limited: true });
    expect((await flooded.call("GET", "/api/comms/village")).status).toBe(429);
    expect((await flooded.call("POST", "/api/comms/village/propose", { body: { target: "words", key: "gathering.confirm", change: "Change this one please." } })).status).toBe(429);
    expect(flooded.filed).toEqual([]);
  });
});
