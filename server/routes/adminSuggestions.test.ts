/**
 * SUGGEST-TO-EDIT, THE DOORS (server/routes/adminSuggestions.ts), driven
 * against a fake Express the way villagePaths.test.ts does.
 *
 * The control is the REAL one: server/routes/villagePaths.ts registers the
 * paths-and-stages words, and its cache (server/lib/villagePaths.ts) runs over
 * a fake pool. So "Accept applies the edit" is proven by what the public
 * config serves afterwards, through the same write the direct PUT makes.
 * The suggestion store is a memory copy of server/repos/adminSuggestions.ts,
 * whose SQL has its own suite against MySQL. `openBallot` is the one thing
 * stubbed: the vote engine has suites of its own, and what matters here is
 * that a ballot of the right subject is opened on the right suggestion.
 *
 * The controls the brief names, each one a refusal that writes nothing:
 * a signed-out user, a holder reviewing their own suggestion, a decline with
 * no reason, a stale accept, and an Accept by somebody who does not hold the
 * power (an admin included).
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

import { register as registerSuggestions } from "./adminSuggestions";
import { register as registerVillagePaths } from "./villagePaths";
import { loadVillagePaths, servedPathWords, storedVillagePaths } from "../lib/villagePaths";
import { contentVersion } from "../../shared/pageContent/resolve";
import type { SuggestionRow, SuggestionStatus, SuggestionStore } from "../repos/adminSuggestions";
import type { SubjectCloser } from "../lib/applyDue";
import { ADMIN_EDIT } from "../../shared/ballotSubjects";

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

function memoryStore(): SuggestionStore & { rows: SuggestionRow[] } {
  const rows: SuggestionRow[] = [];
  let n = 0;
  return {
    rows,
    async create(input) {
      const row: SuggestionRow = {
        id: `sugg-${++n}`, edit: input.edit, why: input.why, suggestedBy: input.suggestedBy, suggestedAt: clock.now,
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
      r.decidedAt = to === "proposed" ? null : clock.now;
      return true;
    },
  };
}

const STAGES = ["visitor", "guest", "member", "co-creator"];
const USERS: Record<string, any> = {
  "u-sam": { id: "u-sam", name: "Sam Rivers", stage: "member" },
  "u-gil": { id: "u-gil", name: "Gil Guest", stage: "guest" },
  "u-fay": { id: "u-fay", name: "Fay Former", stage: "member", former: true },
  "u-hana": { id: "u-hana", name: "Hana Holder", stage: "member" },
  "u-hugo": { id: "u-hugo", name: "Hugo Holder", stage: "co-creator" },
  "u-ada": { id: "u-ada", name: "Ada Admin", stage: "member", role: "admin" },
};

const clock = { now: new Date("2026-11-06T12:00:00Z") };
let holders: string[];
let villageHeld: string[];
let governance: boolean;
let asked: Array<{ user: string; key: string }>;
let notices: any[];
let rolls: any[];
let store: ReturnType<typeof memoryStore>;
let closers: Record<string, SubjectCloser>;
let handlers: Map<string, Handler>;

async function wire() {
  const pool = {
    query: async (sql: string, args: unknown[] = []) => {
      if (/^\s*SELECT/i.test(sql)) return [[]];
      return [{ affectedRows: 1, args }];
    },
  } as unknown as Pool;
  await loadVillagePaths(pool);
  const c = collect();
  // The direct door, with its own gate: a holder, or an admin while the village does not hold the key.
  const guardCapability = async (req: any, res: any, key: string) => {
    const u = req.user;
    asked.push({ user: u?.id, key });
    const ok = !!u && (holders.includes(u.id) || (u.role === "admin" && !villageHeld.includes(key)));
    if (!ok) res.status(403).json({ error: "forbidden" });
    return ok;
  };
  registerVillagePaths(c.app, { isAdmin: async () => true, guardCapability, config: () => ({ project: { name: "Riverbend" } }), valueTokenName: () => "Seeds" } as any);
  store = memoryStore();
  closers = {};
  registerSuggestions(c.app, {
    authedUser: async (req: any) => req.user ?? null,
    capabilityCtx: async (u: any) => ({
      stageIndex: STAGES.indexOf(u.stage),
      stageIndexOf: (id: string) => STAGES.indexOf(id),
      roleCapabilities: [],
      isAdmin: u.role === "admin",
      villageHeld,
    }),
    guardCapability,
    getPool: () => pool,
    overLimit: async () => false,
    notify: async (n: any) => void notices.push(n),
    members: { byId: async (id: string) => USERS[id] ?? null },
    firstName: (name: string) => name.split(/\s+/)[0],
    liveHoldersOf: async () => [...holders],
    ballotSetup: async () => ({
      method: "majority",
      dials: { unityPct: 50, quorumPct: 30 },
      snapshot: { mode: "equal", token: null },
      tokenProblem: null,
      electorate: [{ userId: "u-sam", weight: 1 }, { userId: "u-hana", weight: 1 }],
      durationDays: 7,
    }),
    notifyRoll: async (b: any, input: any) => {
      rolls.push({ ballot: b.id, ...input });
      return 1;
    },
    governanceOn: () => governance,
    closers,
    store,
    isFormerMember: async (u: any) => !!u.former,
    now: () => clock.now,
  } as any);
  handlers = c.handlers;
}

async function call(method: string, path: string, user: string | null, body: unknown = {}, params: Record<string, string> = {}) {
  const { res, out } = makeRes();
  const req: any = { user: user ? USERS[user] : null, body, params, get: (h: string) => (req.headers ?? {})[h.toLowerCase()] };
  await handlers.get(`${method} ${path}`)!(req, res);
  return out;
}

const suggest = (user: string | null, payload: unknown = { ladder: { title: "The Spiral" } }, why = "Our own words") =>
  call("POST", "/api/admin/suggestions", user, { control: "village_paths", payload, why });
const review = (verb: string, user: string | null, id: string, body: unknown = {}) =>
  call("POST", `/api/admin/suggestions/:id/${verb}`, user, body, { id });

beforeEach(async () => {
  clock.now = new Date("2026-11-06T12:00:00Z");
  holders = ["u-hana", "u-hugo"];
  villageHeld = [];
  governance = true;
  asked = [];
  notices = [];
  rolls = [];
  opened.length = 0;
  events.length = 0;
  await wire();
});

describe("who may suggest", () => {
  it("refuses somebody signed out, and stores nothing", async () => {
    const out = await suggest(null);
    expect(out.status).toBe(401);
    expect(store.rows).toEqual([]);
  });

  it("refuses a guest below the member rung", async () => {
    const out = await suggest("u-gil");
    expect(out.status).toBe(403);
    expect(out.body.error).toBe("members_only");
    expect(store.rows).toEqual([]);
  });

  it("refuses a former member", async () => {
    const out = await suggest("u-fay");
    expect(out.status).toBe(403);
    expect(out.body.error).toBe("former_member");
    expect(store.rows).toEqual([]);
  });

  it("refuses a control nobody wired, and a payload the control's own check refuses", async () => {
    expect((await call("POST", "/api/admin/suggestions", "u-sam", { control: "secrets", payload: {} })).status).toBe(400);
    expect((await suggest("u-sam", { paths: { pirate: { label: "Pirate" } } })).status).toBe(400);
    expect(store.rows).toEqual([]);
  });

  it("stores a member's suggestion with the control, the power, the version and the payload, and changes nothing", async () => {
    const before = storedVillagePaths();
    const out = await suggest("u-sam");
    expect(out.status).toBe(201);
    expect(out.body.route).toBe("holders");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].edit).toEqual({
      control: "village_paths",
      capability: "story.tell",
      version: contentVersion(before),
      base: before,
      payload: { ladder: { title: "The Spiral" } },
    });
    expect(storedVillagePaths()).toEqual(before);
    expect(servedPathWords().ladder.title).not.toBe("The Spiral");
    // Every live holder is told, and nobody else.
    expect(notices.map((n) => n.userId).sort()).toEqual(["u-hana", "u-hugo"]);
  });
});

describe("where a suggestion goes", () => {
  it("goes to a village ballot when the village holds the power", async () => {
    villageHeld = ["story.tell"];
    const out = await suggest("u-sam");
    expect(out.status).toBe(201);
    expect(out.body.route).toBe("ballot");
    expect(opened).toHaveLength(1);
    expect(opened[0].subjectType).toBe(ADMIN_EDIT);
    expect(opened[0].subjectRef).toBe(store.rows[0].id);
    expect(store.rows[0].status).toBe("superseded");
    expect(store.rows[0].ballotId).toBe("bal-1");
    expect(rolls).toHaveLength(1);
  });

  it("goes to a village ballot when nobody holds the power, an admin notwithstanding", async () => {
    holders = [];
    const out = await suggest("u-sam");
    expect(out.body.route).toBe("ballot");
    expect(opened).toHaveLength(1);
  });

  it("waits when voting is off, and opens nothing", async () => {
    holders = [];
    governance = false;
    const out = await suggest("u-sam");
    expect(out.status).toBe(201);
    expect(out.body.ballot).toBeNull();
    expect(opened).toEqual([]);
    expect(store.rows[0].status).toBe("proposed");
  });
});

describe("the review queue", () => {
  it("lists a waiting suggestion to its holders, never to its suggester or a non-holder", async () => {
    await suggest("u-hana"); // a holder suggesting, which they may
    await suggest("u-sam");
    const hana = await call("GET", "/api/admin/suggestions/queue", "u-hana");
    expect(hana.body.suggestions.map((s: any) => s.suggestedBy)).toEqual(["u-sam"]);
    const hugo = await call("GET", "/api/admin/suggestions/queue", "u-hugo");
    expect(hugo.body.suggestions.map((s: any) => s.suggestedBy).sort()).toEqual(["u-hana", "u-sam"]);
    expect((await call("GET", "/api/admin/suggestions/queue", "u-ada")).body.suggestions).toEqual([]);
    expect((await call("GET", "/api/admin/suggestions/queue", null)).status).toBe(401);
  });
});

describe("accept", () => {
  it("applies the edit as the reviewer, through the direct route's gate and write, and records both names", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    const out = await review("accept", "u-hana", id);
    expect(out.status).toBe(200);
    expect(asked).toEqual([{ user: "u-hana", key: "story.tell" }]);
    expect(servedPathWords().ladder.title).toBe("The Spiral");
    expect(store.rows[0].status).toBe("accepted");
    expect(store.rows[0].decidedBy).toBe("u-hana");
    expect(store.rows[0].note).toBe("Suggested by Sam, accepted by Hana.");
    expect(events.some((e) => e.text.includes("suggested-by:u-sam:accepted-by:u-hana"))).toBe(true);
    expect(notices.at(-1)).toMatchObject({ userId: "u-sam", body: "Suggested by Sam, accepted by Hana." });
  });

  it("refuses somebody signed out", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    expect((await review("accept", null, id)).status).toBe(401);
    expect(store.rows[0].status).toBe("proposed");
  });

  it("refuses a holder reviewing their own suggestion", async () => {
    const id = (await suggest("u-hana")).body.suggestion.id;
    const out = await review("accept", "u-hana", id);
    expect(out.status).toBe(403);
    expect(out.body.error).toBe("own_suggestion");
    expect(store.rows[0].status).toBe("proposed");
    expect(servedPathWords().ladder.title).not.toBe("The Spiral");
  });

  it("refuses a member who does not hold the power, and an admin who does not either", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    for (const who of ["u-gil", "u-ada"]) {
      const out = await review("accept", who, id);
      expect(out.status, who).toBe(403);
      expect(out.body.error, who).toBe("holders_only");
    }
    expect(asked).toEqual([]);
    expect(store.rows[0].status).toBe("proposed");
    expect(servedPathWords().ladder.title).not.toBe("The Spiral");
  });

  it("refuses a stale suggestion, returns the difference, and writes nothing", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    // A holder edits the words directly after the suggestion was made.
    const direct = makeRes();
    await handlers.get("PUT /api/admin/village-paths")!({ user: USERS["u-hugo"], body: { ladder: { title: "Hugo's way" } }, get: () => undefined }, direct.res);
    expect(direct.out.status).toBe(200);
    const out = await review("accept", "u-hana", id);
    expect(out.status).toBe(409);
    expect(out.body.code).toBe("stale");
    expect(out.body.difference.movedSinceSuggested).toEqual([{ path: "ladder.title", from: null, to: "Hugo's way" }]);
    expect(out.body.difference.suggestedChange).toEqual([{ path: "ladder.title", from: "Hugo's way", to: "The Spiral" }]);
    expect(servedPathWords().ladder.title).toBe("Hugo's way");
    expect(store.rows[0].status).toBe("proposed");
  });

  it("refuses once the village has taken the power, which sends it to a vote", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    villageHeld = ["story.tell"];
    const out = await review("accept", "u-hana", id);
    expect(out.status).toBe(409);
    expect(out.body.error).toBe("goes_to_a_vote");
    expect(store.rows[0].status).toBe("proposed");
  });
});

describe("decline", () => {
  it("refuses a decline with no reason, or a reason of more than one line", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    for (const body of [{}, { reason: "  " }, { reason: "one\ntwo" }]) {
      const out = await review("decline", "u-hana", id, body);
      expect(out.status, JSON.stringify(body)).toBe(400);
      expect(out.body.error).toBe("reason_required");
    }
    expect(store.rows[0].status).toBe("proposed");
  });

  it("records the reason and shows it to the suggester", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    const out = await review("decline", "u-hana", id, { reason: "We renamed the ladder last moon." });
    expect(out.status).toBe(200);
    expect(store.rows[0]).toMatchObject({ status: "rejected", decidedBy: "u-hana", note: "We renamed the ladder last moon." });
    expect(notices.at(-1).userId).toBe("u-sam");
    expect(notices.at(-1).body).toContain("We renamed the ladder last moon.");
    const mine = await call("GET", "/api/admin/suggestions/mine", "u-sam");
    expect(mine.body.suggestions[0]).toMatchObject({ status: "rejected", note: "We renamed the ladder last moon." });
  });

  it("refuses a non-holder", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    expect((await review("decline", "u-ada", id, { reason: "No." })).status).toBe(403);
    expect(store.rows[0].status).toBe("proposed");
  });
});

describe("send to a vote", () => {
  it("turns the suggestion into a village ballot", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    const out = await review("send-to-vote", "u-hugo", id);
    expect(out.status).toBe(200);
    expect(out.body.ballot.id).toBe("bal-1");
    expect(opened[0]).toMatchObject({ subjectType: ADMIN_EDIT, subjectRef: id, openedBy: "u-hugo" });
    expect(opened[0].docMarkdown).toContain("ladder.title");
    expect(opened[0].docMarkdown).not.toMatch(/\*\*|^#/m);
    expect(store.rows[0]).toMatchObject({ status: "superseded", ballotId: "bal-1" });
    // Out of the queue the moment it is under a vote.
    expect((await call("GET", "/api/admin/suggestions/queue", "u-hana")).body.suggestions).toEqual([]);
  });

  it("refuses while voting is off, and leaves the suggestion waiting", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    governance = false;
    expect((await review("send-to-vote", "u-hugo", id)).status).toBe(409);
    expect(store.rows[0].status).toBe("proposed");
  });

  it("refuses the suggester, who has their own door", async () => {
    const id = (await suggest("u-hana")).body.suggestion.id;
    expect((await review("send-to-vote", "u-hana", id)).status).toBe(403);
  });
});

describe("the suggester raises it after 14 days", () => {
  it("is refused before the wait, and allowed after it", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    clock.now = new Date("2026-11-19T12:00:00Z");
    const early = await review("raise", "u-sam", id);
    expect(early.status).toBe(409);
    expect(early.body.error).toBe("too_soon");
    expect(early.body.daysLeft).toBe(1);
    expect(opened).toEqual([]);
    clock.now = new Date("2026-11-20T12:00:00Z");
    const late = await review("raise", "u-sam", id);
    expect(late.status).toBe(200);
    expect(opened[0]).toMatchObject({ subjectRef: id, openedBy: "u-sam" });
  });

  it("needs no wait once nobody is left to review it", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    holders = [];
    expect((await review("raise", "u-sam", id)).status).toBe(200);
  });

  it("is only the suggester's door", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    clock.now = new Date("2026-12-01T12:00:00Z");
    expect((await review("raise", "u-hugo", id)).status).toBe(403);
  });
});

describe("the closer", () => {
  const ballot = (id: string, ref: string) => ({ id, subjectRef: ref, title: "A suggested change", openedBy: "u-hugo" }) as any;

  it("applies a carried suggestion through the control's own write, once", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    await review("send-to-vote", "u-hugo", id);
    const closer = closers[ADMIN_EDIT];
    const first = await closer.execute!(ballot("bal-1", id), "system");
    expect(first.applied).toEqual([`admin_edit:${id}`]);
    expect(servedPathWords().ladder.title).toBe("The Spiral");
    expect(store.rows[0]).toMatchObject({ status: "accepted", decidedBy: "village:bal-1" });
    const again = await closer.execute!(ballot("bal-1", id), "system");
    expect(again.applied).toEqual([`admin_edit:${id}`]);
    expect(again.proposerTold).toBeNull();
  });

  it("holds a carried suggestion whose words moved before it landed, and closes it with the reason", async () => {
    const id = (await suggest("u-sam")).body.suggestion.id;
    await review("send-to-vote", "u-hugo", id);
    const direct = makeRes();
    await handlers.get("PUT /api/admin/village-paths")!({ user: USERS["u-hugo"], body: { ladder: { title: "Hugo's way" } }, get: () => undefined }, direct.res);
    const r = await closers[ADMIN_EDIT].execute!(ballot("bal-1", id), "system");
    expect(r.held).toContain("could not be applied");
    expect(servedPathWords().ladder.title).toBe("Hugo's way");
    expect(store.rows[0].status).toBe("rejected");
  });

  it("declines one the village voted down, and puts back one too few voted on", async () => {
    const a = (await suggest("u-sam")).body.suggestion.id;
    await review("send-to-vote", "u-hugo", a);
    await closers[ADMIN_EDIT].settle(ballot("bal-1", a), "failed", "", "system");
    expect(store.rows[0]).toMatchObject({ status: "rejected", decidedBy: "village:bal-1" });

    const b = (await suggest("u-sam", { ladder: { title: "Another" } })).body.suggestion.id;
    await review("send-to-vote", "u-hugo", b);
    await closers[ADMIN_EDIT].settle(ballot("bal-2", b), "no_quorum", "", "system");
    expect(store.rows[1]).toMatchObject({ status: "proposed", ballotId: null });
  });
});
