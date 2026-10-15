/**
 * The task doors over real HTTP, with no database: the module gate, the
 * members-only gate, the refusals that come before any work, the send
 * button's limit, and that no door of the board is swallowed by the room's.
 *
 * Both route modules are registered on a bare Express app, in the order
 * server/index.ts registers them (the room's first), and served on port 0, so
 * a request meets the same gates and the same path matching a browser's does.
 * The pool is a stand-in that answers each SELECT by the table it reads.
 *
 * A whole story against a real schema is server/sessionTasks.db.test.ts, and
 * the emails are server/sessionTaskMail.db.test.ts.
 */
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadModuleSettings, wireModuleAuth } from "../lib/modules";
import { SESSION_REFUSALS } from "../../shared/sessions";
import { TASK_LIMITS, TASK_REFUSALS } from "../../shared/sessionTasks";
import { register as registerRoom } from "./liveSessions";
import { register as registerTasks } from "./sessionTasks";

const PEOPLE: Record<string, any> = {
  "m-ana": { id: "m-ana", name: "Ana Reyes", handle: "ana", membershipGranted: true },
  "m-ben": { id: "m-ben", name: "Ben Ortiz", handle: "ben", membershipGranted: true },
  "m-guest": { id: "m-guest", name: "Gil Guest", handle: "gil" },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin" },
};
/** Each member's number in the stub's `live_session_members`. Ana facilitates session 12. */
const NUMBERS: Record<string, number> = { "m-ana": 1, "m-ben": 2, "m-founder": 3 };

/** What the stub answers: who is asking, and whether session 12 is open or closed. */
const world = { me: null as string | null, status: "open" as "open" | "closed" };

const sessionRow = () => ({
  id: 12,
  title: "Garden circle, week 2",
  circle_id: null,
  status: world.status,
  facilitator_no: 1,
  secretary_no: null,
  created_by_no: 1,
  duration_min: 60,
  state: null,
  version: 4,
  stamp: null,
  summary: null,
  created_at: new Date(Date.now() - 60_000),
  closed_at: world.status === "closed" ? new Date() : null,
});

/** A pool that answers a SELECT by the table after its FROM, and a write with one affected row. */
function stubPool() {
  const query = async (sql: string) => {
    if (!/^\s*SELECT/i.test(sql)) return [{ affectedRows: 1, insertId: 1 }, []];
    const table = /FROM `([a-z_]+)`/.exec(sql)?.[1] ?? "";
    switch (table) {
      case "live_session_members":
        if (sql.includes("`user_id` = ?")) return [world.me && NUMBERS[world.me] ? [{ no: NUMBERS[world.me] }] : [], []];
        return [Object.entries(NUMBERS).map(([user_id, no]) => ({ no, user_id })), []];
      case "live_sessions":
        return [[sessionRow()], []];
      case "live_session_people":
        return [world.me === "m-ana" || world.me === "m-ben" ? [{ member_no: NUMBERS[world.me] }] : [], []];
      default:
        return [[], []];
    }
  };
  const conn = { query, beginTransaction: async () => undefined, commit: async () => undefined, rollback: async () => undefined, release: () => undefined };
  return { query, getConnection: async () => conn } as any;
}

/** A limiter that counts, the way the real one does: over once a key passes its limit in the window. */
const hits = new Map<string, number>();
const overLimit = async (key: string, max: number) => {
  const n = (hits.get(key) ?? 0) + 1;
  hits.set(key, n);
  return n > max;
};

let server: http.Server;
let base = "";

beforeAll(async () => {
  const pool = stubPool();
  const deps = {
    authedUser: async () => (world.me ? PEOPLE[world.me] : null),
    isAdmin: async () => world.me === "m-founder",
    getPool: () => pool,
    overLimit,
    members: { byId: async (id: string) => PEOPLE[id] ?? null },
    notify: async () => ({ fresh: true }),
    notifyAdmins: async () => undefined,
    notifyDeps: { memberById: async (id: string) => PEOPLE[id] ?? null, isPresent: () => true },
    commsPostOffice: { getPool: () => pool },
    circlesRepo: { all: () => [] },
    lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
    deploymentOrigin: () => "https://village.example.test",
    projectName: () => "Test Village",
  } as any;
  // The module gate reads who is signed in the way server/index.ts wires it.
  // No meter: nothing here is about who used the module.
  wireModuleAuth({ isAdmin: async () => world.me === "m-founder", isAuthed: async () => world.me != null, meterUserId: () => null });
  const app = express();
  app.use(express.json());
  registerRoom(app, deps);
  registerTasks(app, deps);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  hits.clear();
  world.status = "open";
});

/** One request as `who`, answered as status and JSON. */
async function call(who: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  world.me = who;
  const res = await fetch(`${base}${path}`, { // module-review-ok: a test calling its own local server, never an outside host
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** The four doors, each with a body it would accept. */
const DOORS: [string, string, unknown?][] = [
  ["GET", "/api/sessions/tasks/mine"],
  ["PATCH", "/api/sessions/tasks/7", { op: "done", version: 1 }],
  ["GET", "/api/sessions/12/task-record"],
  ["POST", "/api/sessions/12/task-emails", {}],
];

/** The module's stored lifecycle, loaded the way the server loads it at boot. */
const lifecycle = async (value: string | null) =>
  loadModuleSettings({ query: async () => [value ? [{ module_id: "sessions", lifecycle: value, config: null, updated_at: null }] : [], []] } as any);

describe("with the sessions module off", () => {
  it("hides all four doors, the way the room's doors are hidden", async () => {
    await lifecycle(null);
    for (const [method, path, body] of DOORS) {
      expect(await call("m-ana", method, path, body), `${method} ${path}`).toEqual({ status: 404, body: { error: "module_disabled", module: "sessions" } });
    }
  });
});

describe("with the sessions module on", () => {
  beforeAll(async () => {
    await lifecycle("members");
  });

  it("refuses a guest at every door with the room's one sentence", async () => {
    for (const [method, path, body] of DOORS) {
      expect(await call("m-guest", method, path, body), `${method} ${path}`).toEqual({ status: 403, body: { error: SESSION_REFUSALS.membersOnly } });
    }
  });

  it("asks somebody signed out to sign in, at the module gate", async () => {
    for (const [method, path, body] of DOORS) {
      expect(await call(null, method, path, body), `${method} ${path}`).toEqual({ status: 401, body: { error: "auth_required", module: "sessions" } });
    }
  });

  it("serves the board at /tasks/mine, never the room's /:id", async () => {
    const out = await call("m-ana", "GET", "/api/sessions/tasks/mine");
    expect(out.status).toBe(200);
    expect(Object.keys(out.body).sort()).toEqual(["earlierCount", "finished", "holding", "seatsHold", "today"]);
    // And the room's own door still answers one segment, with its own refusal.
    expect(await call("m-ana", "GET", "/api/sessions/tasks")).toEqual({ status: 404, body: { error: SESSION_REFUSALS.notFound } });
  });

  it("answers a task id that is not a number with the task's own 404, before any work", async () => {
    expect(await call("m-ana", "PATCH", "/api/sessions/tasks/seed", { op: "done", version: 1 })).toEqual({ status: 404, body: { error: TASK_REFUSALS.notFound } });
    // A number the state layer does not hold is the same answer from the lib.
    expect(await call("m-ana", "PATCH", "/api/sessions/tasks/7", { op: "done", version: 1 })).toEqual({ status: 404, body: { error: TASK_REFUSALS.notFound } });
    // An answer of the wrong shape never reaches the state layer.
    expect(await call("m-ana", "PATCH", "/api/sessions/tasks/7", { op: "maybe", version: 1 })).toEqual({ status: 400, body: { error: TASK_REFUSALS.answerShape } });
  });

  it("bounds the answers each person gives in an hour", async () => {
    // This hour's answers are already spent.
    hits.set("sessions-task-answer:m-ana", TASK_LIMITS.answersPerHour);
    expect(await call("m-ana", "PATCH", "/api/sessions/tasks/7", { op: "done", version: 1 })).toEqual({ status: 429, body: { error: TASK_REFUSALS.tooMany } });
  });

  it("refuses the task emails while the session is open, and to anybody who does not run it", async () => {
    expect(await call("m-ana", "POST", "/api/sessions/12/task-emails", {})).toEqual({ status: 409, body: { error: TASK_REFUSALS.stillOpen } });
    world.status = "closed";
    expect(await call("m-ben", "POST", "/api/sessions/12/task-emails", {})).toEqual({ status: 403, body: { error: SESSION_REFUSALS.facilitatorOnly } });
    expect(await call("m-ana", "POST", "/api/sessions/abc/task-emails", {})).toEqual({ status: 404, body: { error: SESSION_REFUSALS.notFound } });
  });

  it("lets the facilitator press three times in an hour, and answers the fourth press 429", async () => {
    world.status = "closed";
    for (let press = 1; press <= TASK_LIMITS.sendsPerHour; press++) {
      const out = await call("m-ana", "POST", "/api/sessions/12/task-emails", {});
      expect(out.status, `press ${press}`).toBe(200);
      expect(out.body).toMatchObject({ people: 0, queued: 0, skipped: {} });
    }
    expect(await call("m-ana", "POST", "/api/sessions/12/task-emails", {})).toEqual({ status: 429, body: { error: TASK_REFUSALS.sendsTooMany } });
    // An admin who did not facilitate may press too.
    expect((await call("m-founder", "POST", "/api/sessions/12/task-emails", {})).status).toBe(200);
  });

  it("serves a closed session's tasks to the people who were in it, and the send button to its facilitator", async () => {
    world.status = "closed";
    expect(await call("m-ana", "GET", "/api/sessions/12/task-record")).toEqual({ status: 200, body: { tasks: [], mail: { canSend: true, lastSend: null } } });
    expect((await call("m-ben", "GET", "/api/sessions/12/task-record")).body.mail.canSend).toBe(false);
  });
});
