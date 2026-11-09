/**
 * THE DIAL (server/routes/suggestionRoutes.ts): where suggestions on each
 * power go, turned by holders of `power.assign`, driven against a fake Express
 * the way adminSuggestions.test.ts does.
 *
 * The gate is the REAL one: `makePowerAssignGate` asks `holderOnlyDecision`,
 * which asks the capability gate with the admin short-circuit taken out. The
 * suggestion doors are real too, so "the dial moves a suggestion" is proven by
 * a suggestion on the paths words opening a ballot once the dial says so, read
 * through the same cache the dial writes.
 *
 * Controls, each a refusal that stores nothing: a guest reading, a plain admin
 * turning it while somebody holds `power.assign`, the village holding
 * `power.assign`, the steward's veto sent to holders, an unknown power, and a
 * save on a table that moved.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";

const opened: any[] = [];
vi.mock("../lib/ballots", () => ({
  openBallot: async (_pool: unknown, input: any) => {
    opened.push(input);
    return { ok: true, ballot: { id: `bal-${opened.length}`, closesAt: new Date("2026-11-20T00:00:00Z"), title: input.title, openedBy: input.openedBy, subjectRef: input.subjectRef } };
  },
}));
const events: any[] = [];
vi.mock("../lib/events", () => ({ recordEvent: async (_pool: unknown, e: any) => void events.push(e) }));

import { register as registerDial } from "./suggestionRoutes";
import { register as registerSuggestions } from "./adminSuggestions";
import { register as registerVillagePaths } from "./villagePaths";
import { loadSuggestionRoutes, storedSuggestionRoutes, villageSuggestionRoutes } from "../lib/suggestionRoutes";
import { loadVillagePaths } from "../lib/villagePaths";
import { contentVersion } from "../../shared/pageContent/resolve";
import { SUGGESTION_ROUTE } from "../../shared/suggestions";
import { ADMIN_EDIT } from "../../shared/ballotSubjects";
import type { SuggestionRow, SuggestionStatus, SuggestionStore } from "../repos/adminSuggestions";
import type { SubjectCloser } from "../lib/applyDue";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const STAGES = ["visitor", "guest", "member", "co-creator"];
const USERS: Record<string, any> = {
  "u-sam": { id: "u-sam", name: "Sam Rivers", stage: "member" },
  "u-gil": { id: "u-gil", name: "Gil Guest", stage: "guest" },
  "u-fay": { id: "u-fay", name: "Fay Former", stage: "member", former: true },
  "u-olu": { id: "u-olu", name: "Olu Ops", stage: "member" },
  "u-tess": { id: "u-tess", name: "Tess Teller", stage: "member" },
  "u-ada": { id: "u-ada", name: "Ada Admin", stage: "member", role: "admin" },
};

/** Who holds what through a role, the admin short-circuit excluded. */
let held: Record<string, string[]>;
let villageHeld: string[];
let handlers: Map<string, Handler>;
let closers: Record<string, SubjectCloser>;
let store: SuggestionStore & { rows: SuggestionRow[] };

const liveHoldersOf = async (cap: string) => Object.keys(held).filter((u) => held[u].includes(cap));

function memoryStore(): SuggestionStore & { rows: SuggestionRow[] } {
  const rows: SuggestionRow[] = [];
  let n = 0;
  return {
    rows,
    async create(input) {
      const row: SuggestionRow = {
        id: `sugg-${++n}`, edit: input.edit, why: input.why, suggestedBy: input.suggestedBy, suggestedAt: new Date("2026-11-08T12:00:00Z"),
        status: "proposed", decidedBy: null, decidedAt: null, note: null, ballotId: null,
      };
      rows.push(row);
      return { ...row };
    },
    async byId(id) {
      const r = rows.find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    async withStatus(status) {
      return rows.filter((r) => r.status === status).map((r) => ({ ...r }));
    },
    async bySuggester(userId) {
      return rows.filter((r) => r.suggestedBy === userId).map((r) => ({ ...r }));
    },
    async move(id, from: SuggestionStatus, to: SuggestionStatus, fields) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.status !== from) return false;
      r.status = to;
      r.decidedBy = fields.decidedBy ?? null;
      r.note = fields.note ?? null;
      r.ballotId = fields.ballotId ?? null;
      return true;
    },
  };
}

async function wire() {
  const pool = {
    query: async (sql: string) => (/^\s*SELECT/i.test(sql) ? [[]] : [{ affectedRows: 1 }]),
  } as unknown as Pool;
  await loadSuggestionRoutes(pool);
  await loadVillagePaths(pool);
  const map = new Map<string, Handler>();
  const record = (method: string) => (path: string, h: Handler) => map.set(`${method} ${path}`, h);
  const app = { get: record("GET"), put: record("PUT"), post: record("POST") } as any;
  const capabilityCtx = async (u: any) => ({
    stageIndex: STAGES.indexOf(u.stage),
    stageIndexOf: (id: string) => STAGES.indexOf(id),
    roleCapabilities: held[u.id] ?? [],
    isAdmin: u.role === "admin",
    villageHeld,
  });
  const authedUser = async (req: any) => req.user ?? null;
  const isFormerMember = async (u: any) => !!u.former;
  registerDial(app, { authedUser, capabilityCtx, liveHoldersOf, getPool: () => pool, isFormerMember } as any);
  const guardCapability = async (req: any, res: any, key: string) => {
    const ok = !!req.user && ((held[req.user.id] ?? []).includes(key) || (req.user.role === "admin" && !villageHeld.includes(key)));
    if (!ok) res.status(403).json({ error: "forbidden" });
    return ok;
  };
  registerVillagePaths(app, { isAdmin: async () => true, guardCapability, config: () => ({ project: { name: "Riverbend" } }), valueTokenName: () => "Seeds" } as any);
  store = memoryStore();
  closers = {};
  registerSuggestions(app, {
    authedUser,
    capabilityCtx,
    guardCapability,
    getPool: () => pool,
    overLimit: async () => false,
    notify: async () => undefined,
    members: { byId: async (id: string) => USERS[id] ?? null },
    firstName: (name: string) => name.split(/\s+/)[0],
    liveHoldersOf,
    ballotSetup: async () => ({
      method: "majority",
      dials: { unityPct: 50, quorumPct: 30 },
      snapshot: { mode: "equal", token: null },
      tokenProblem: null,
      electorate: [{ userId: "u-sam", weight: 1 }],
      durationDays: 7,
    }),
    notifyRoll: async () => 1,
    governanceOn: () => true,
    closers,
    store,
    isFormerMember,
  } as any);
  handlers = map;
}

async function call(method: string, path: string, user: string | null, body: unknown = {}, headers: Record<string, string> = {}) {
  const out: { status: number; body: any } = { status: 200, body: undefined };
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
  const req: any = { user: user ? USERS[user] : null, body, params: {}, get: (h: string) => headers[h.toLowerCase()] };
  await handlers.get(`${method} ${path}`)!(req, res);
  return out;
}

const read = (user: string | null) => call("GET", "/api/admin/suggestion-routes", user);
const turn = (user: string | null, routes: Record<string, string>, was?: string) =>
  call("PUT", "/api/admin/suggestion-routes", user, { routes }, was ? { "x-content-was": was } : {});

beforeEach(async () => {
  held = { "u-olu": ["power.assign"], "u-tess": ["story.tell"] };
  villageHeld = [];
  opened.length = 0;
  events.length = 0;
  // A fresh fake pool reads an empty document, so every test starts on the platform default.
  await wire();
});

describe("reading the dial", () => {
  it("shows a member the whole table, the default, and what the village stored", async () => {
    const out = await read("u-sam");
    expect(out.status).toBe(200);
    expect(out.body.routes).toEqual(SUGGESTION_ROUTE);
    expect(out.body.defaults).toEqual(SUGGESTION_ROUTE);
    expect(out.body.version).toBe(contentVersion(storedSuggestionRoutes()));
  });

  it("refuses somebody signed out, a guest and a former member", async () => {
    expect((await read(null)).status).toBe(401);
    expect((await read("u-gil")).body.error).toBe("members_only");
    expect((await read("u-fay")).body.error).toBe("former_member");
  });
});

describe("who may turn it", () => {
  it("lets a holder of power.assign send one power's suggestions to a vote, and stores only that entry", async () => {
    const out = await turn("u-olu", { "library.keep": "ballot", "story.tell": "holders" });
    expect(out.status).toBe(200);
    expect(out.body.routes["library.keep"]).toBe("ballot");
    expect(storedSuggestionRoutes()).toEqual({ routes: { "library.keep": "ballot" } });
    expect(events).toEqual([expect.objectContaining({ kind: "audit", text: "suggestion_routes:library.keep=ballot:holder", actorUserId: "u-olu", audience: "admin" })]);
  });

  it("refuses a plain admin while somebody holds power.assign, and stores nothing", async () => {
    const out = await turn("u-ada", { "library.keep": "ballot" });
    expect(out.status).toBe(403);
    expect(out.body.code).toBe("holders_only");
    expect(out.body.holders).toEqual(["u-olu"]);
    expect(villageSuggestionRoutes()["library.keep"]).toBe("holders");
  });

  it("refuses a member who does not hold power.assign", async () => {
    expect((await turn("u-tess", { "library.keep": "ballot" })).status).toBe(403);
    expect(villageSuggestionRoutes()["library.keep"]).toBe("holders");
  });

  it("lets an admin act as the operator while nobody holds power.assign", async () => {
    held = { "u-tess": ["story.tell"] };
    const out = await turn("u-ada", { "library.keep": "ballot" });
    expect(out.status).toBe(200);
    expect(events[0].text).toBe("suggestion_routes:library.keep=ballot:fallback");
  });

  it("refuses everybody when the village holds power.assign, and points at the suggestion that becomes a vote", async () => {
    villageHeld = ["power.assign"];
    held = {};
    const out = await turn("u-ada", { "library.keep": "ballot" });
    expect(out.status).toBe(409);
    expect(out.body.code).toBe("village_holds_it");
    expect(out.body.suggestInstead).toBe("suggestion_routes");
    expect(villageSuggestionRoutes()["library.keep"]).toBe("holders");
  });
});

describe("what it refuses", () => {
  it("never sends the steward's veto to holders", async () => {
    const out = await turn("u-olu", { "steward.veto": "holders" });
    expect(out.status).toBe(400);
    expect(villageSuggestionRoutes()["steward.veto"]).toBe("ballot");
  });

  it("refuses a power nobody knows and a word that is not a route", async () => {
    expect((await turn("u-olu", { "made.up": "ballot" })).status).toBe(400);
    expect((await turn("u-olu", { "library.keep": "admins" })).status).toBe(400);
    expect(storedSuggestionRoutes()).toEqual({});
  });

  it("refuses a save on a table that moved since it was opened", async () => {
    const was = (await read("u-sam")).body.version;
    expect((await turn("u-olu", { "library.keep": "ballot" }, was)).status).toBe(200);
    const stale = await turn("u-olu", { "event.manage": "ballot" }, was);
    expect(stale.status).toBe(409);
    expect(villageSuggestionRoutes()["event.manage"]).toBe("holders");
  });
});

describe("what it moves", () => {
  const suggestPaths = () =>
    call("POST", "/api/admin/suggestions", "u-sam", { control: "village_paths", payload: { ladder: { title: "The Spiral" } }, why: "Our own words" });

  it("a suggestion on a power a role holds goes to its holders by default, and to a vote once the dial says so", async () => {
    const before = await suggestPaths();
    expect(before.body.route).toBe("holders");
    expect(opened).toHaveLength(0);
    expect((await turn("u-olu", { "story.tell": "ballot" })).status).toBe(200);
    const after = await suggestPaths();
    expect(after.body.route).toBe("ballot");
    expect(opened).toHaveLength(1);
    expect(opened[0].subjectType).toBe(ADMIN_EDIT);
  });

  it("with the village holding power.assign, a member's suggestion on the dial is a ballot, and the carried vote turns it", async () => {
    villageHeld = ["power.assign"];
    held = {};
    const made = await call("POST", "/api/admin/suggestions", "u-sam", {
      control: "suggestion_routes",
      payload: { routes: { "library.keep": "ballot" } },
      why: "The library is everyone's",
    });
    expect(made.status).toBe(201);
    expect(made.body.route).toBe("ballot");
    expect(opened).toHaveLength(1);
    expect(villageSuggestionRoutes()["library.keep"]).toBe("holders");
    const id = store.rows[0].id;
    const r = await closers[ADMIN_EDIT].execute!({ id: "bal-1", subjectRef: id, title: "A suggested change", openedBy: "u-sam" } as any, "system");
    expect(r.applied).toEqual([`admin_edit:${id}`]);
    expect(villageSuggestionRoutes()["library.keep"]).toBe("ballot");
  });
});
