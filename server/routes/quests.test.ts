/**
 * The claim gate, exercised as a handler against stub deps.
 *
 * WHAT THIS IS FOR. `POST /api/game/quests/:id/claim` checked `is_example`,
 * `min_stage`, `requires_role` and the member's own claims, and never
 * `quest.status`. Nothing on the client covered for it: `Quests.tsx` filters
 * the board by circle and difficulty only, and `QuestDetail.tsx` renders
 * `QuestActions` unconditionally, so a quest an admin closed kept rendering on
 * the board with a live claim button and the whole chain behind it stayed
 * open. Consent on a claimed quest mints recognition, releases stay credits
 * and moves a stage, so the claim is where that chain is closed.
 *
 * NO DATABASE, on purpose, and the same reasoning `land.test.ts` gives: what
 * is worth testing here is a decision, and the decision needs no rows. The
 * `openClaim` write path this route now calls has its own suite with a real
 * MySQL and real concurrency (`server/repos/questClaimConcurrency.test.ts`),
 * because THAT question cannot be answered without one.
 *
 * `register` runs against a fake Express that records handlers by method and
 * path, so what runs is the real registration and the real handler body.
 */
import { describe, expect, it } from "vitest";
import { register } from "./quests";
import { questClosed } from "../repos/quests";

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
    type: () => res,
    set: () => res,
    send: () => res,
  };
  return { res, out };
}

const OPEN_QUEST = {
  id: "q-swale",
  title: "Tend the swale",
  gratitude: "50-100",
  status: "Open",
  tags: [],
  order: 1,
};

/**
 * Deps enough for the claim route. `is_example` answers 0, because the example
 * guard is a different door and is already covered; what is under test is the
 * one that was missing.
 */
function mount(quest: any) {
  const { app, handlers } = collect();
  const opened: any[] = [];
  const pool: any = { async query() { return [[{ is_example: 0 }], []]; } };
  register(app, {
    isAdmin: async () => false,
    authedUser: async () => ({ id: "u-ada", name: "Ada Wren" }),
    adminActor: () => null,
    getPool: () => pool,
    uploadsDir: "/tmp/not-used-here",
    members: { byId: async () => null },
    questsRepo: { byId: async () => quest, all: async () => (quest ? [quest] : []) },
    claimsRepo: {
      forUser: async () => [],
      openClaim: async (c: any) => { opened.push(c); return { ok: true, claim: c }; },
    },
    crewsRepo: {},
    firstName: (n: string) => String(n).split(" ")[0],
    notify: async () => {},
    stageOf: async () => "member",
    loadRoles: () => [],
    roleIdsFor: () => [],
    currentPatternId: () => null,
    questConsentRecipients: async () => [],
    overLimit: async () => false,
    clientIp: () => "127.0.0.1",
  } as any);
  return { handlers, opened };
}

const call = async (handlers: Map<string, Handler>, key: string, req: any = {}) => {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const { res, out } = makeRes();
  await handler(req, res);
  return out;
};

const CLAIM = "POST /api/game/quests/:id/claim";

describe("questClosed reads the status the board actually stores", () => {
  it("refuses only Closed, in whatever casing the board wrote it", () => {
    expect(questClosed("Closed")).toBe(true);
    expect(questClosed("closed")).toBe(true);
    expect(questClosed("  CLOSED  ")).toBe(true);
  });

  it("leaves every other status claimable", () => {
    // A DENY-LIST, not an allow-list. Admin offers Open and Closed;
    // `server/seeds/quests-seed.json` ships a Seasonal quest and
    // `server/seeds/examples-seed.json` writes lowercase open, and the column
    // is a free varchar a village can type its own word into. "open" as an
    // allow-list would have refused the seeded seasonal quest outright.
    expect(questClosed("Open")).toBe(false);
    expect(questClosed("open")).toBe(false);
    expect(questClosed("Seasonal")).toBe(false);
    expect(questClosed("Ongoing")).toBe(false);
    expect(questClosed(null)).toBe(false);
    expect(questClosed(undefined)).toBe(false);
    expect(questClosed("")).toBe(false);
  });
});

describe("the claim route and a closed quest", () => {
  it("refuses a claim on a closed quest, and writes nothing", async () => {
    const { handlers, opened } = mount({ ...OPEN_QUEST, status: "Closed" });
    const r = await call(handlers, CLAIM, { params: { id: "q-swale" }, body: {} });
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toContain("closed");
    expect(r.body.status).toBe("Closed");
    // The whole chain: no claim row means no submission and no consent, and
    // consent is what mints.
    expect(opened).toHaveLength(0);
  });

  it("refuses whatever casing the board stored", async () => {
    const { handlers } = mount({ ...OPEN_QUEST, status: "closed" });
    expect((await call(handlers, CLAIM, { params: { id: "q-swale" }, body: {} })).status).toBe(409);
  });

  it("still opens a claim on an open quest", async () => {
    const { handlers, opened } = mount(OPEN_QUEST);
    const r = await call(handlers, CLAIM, { params: { id: "q-swale" }, body: {} });
    expect(r.status).toBe(200);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ questId: "q-swale", userId: "u-ada", status: "claimed" });
  });

  it("still opens a claim on a seasonal quest", async () => {
    // The case an allow-list would have broken, and the seeds ship one.
    const { handlers, opened } = mount({ ...OPEN_QUEST, status: "Seasonal" });
    expect((await call(handlers, CLAIM, { params: { id: "q-swale" }, body: {} })).status).toBe(200);
    expect(opened).toHaveLength(1);
  });

  it("hands the repo's refusals back as the route's own answers", async () => {
    const { app, handlers } = collect();
    const pool: any = { async query() { return [[{ is_example: 0 }], []]; } };
    const existing = { id: "claim-old", questId: "q-swale", status: "submitted" };
    register(app, {
      isAdmin: async () => false,
      authedUser: async () => ({ id: "u-ada", name: "Ada Wren" }),
      adminActor: () => null,
      getPool: () => pool,
      uploadsDir: "/tmp/not-used-here",
      members: { byId: async () => null },
      questsRepo: { byId: async () => OPEN_QUEST, all: async () => [OPEN_QUEST] },
      claimsRepo: { openClaim: async () => ({ ok: false, reason: "already", existing }) },
      crewsRepo: {},
      firstName: (n: string) => String(n).split(" ")[0],
      notify: async () => {},
      stageOf: async () => "member",
      loadRoles: () => [],
      roleIdsFor: () => [],
      currentPatternId: () => null,
      questConsentRecipients: async () => [],
      overLimit: async () => false,
      clientIp: () => "127.0.0.1",
    } as any);
    const r = await call(handlers, CLAIM, { params: { id: "q-swale" }, body: {} });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: "Already claimed", claim: existing });
  });
});
