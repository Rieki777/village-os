/**
 * CHANGE REQUESTS, GATHERING: the routes (server/routes/changeRequests.ts).
 *
 * Driven through the real `register` against a fake Express, with an
 * in-memory twin of the store (the MySQL store is proven in
 * server/repos/changeRequests.test.ts) and a validator stub that refuses
 * what the test names, so each refusal here is the route's own.
 */
import { describe, expect, it } from "vitest";
import { register } from "./changeRequests";
import type { ChangeRequestRow, ChangeRequestStore, NewChangeRequest, Revision } from "../repos/changeRequests";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function memoryStore(): ChangeRequestStore & { rows: Map<string, ChangeRequestRow> } {
  const rows = new Map<string, ChangeRequestRow>();
  const now = () => new Date().toISOString();
  return {
    rows,
    async create(input: NewChangeRequest) {
      rows.set(input.id, {
        id: input.id, authorUserId: input.authorUserId, authorKind: "member", title: input.title, why: input.why,
        state: "gathering", revision: 1, relation: input.relation ?? null, relatesTo: input.relatesTo ?? null,
        proposalId: null, closedReason: null, createdAt: now(), updatedAt: now(), changes: input.changes ?? [],
      });
    },
    async byId(id) { const r = rows.get(id); return r ? structuredClone(r) : null; },
    async byAuthor(u) { return [...rows.values()].filter((r) => r.authorUserId === u); },
    async open() { return [...rows.values()].filter((r) => r.state === "in_review" || r.state === "voting"); },
    async countGathering(u) { return [...rows.values()].filter((r) => r.authorUserId === u && r.state === "gathering").length; },
    async revise(id, expected, next: Revision) {
      const r = rows.get(id);
      if (!r || r.revision !== expected || r.state !== "gathering") return false;
      rows.set(id, { ...r, revision: r.revision + 1, title: next.title ?? r.title, why: next.why ?? r.why, changes: next.changes ?? r.changes });
      return true;
    },
    async remove(id, expected) {
      const r = rows.get(id);
      if (!r || r.revision !== expected || r.state !== "gathering") return false;
      rows.delete(id);
      return true;
    },
  };
}

const PEOPLE: Record<string, any> = {
  "u-ana": { id: "u-ana", name: "Ana Lopez" },
  "u-sol": { id: "u-sol", name: "Sol Rivera" },
  "u-guest": { id: "u-guest", name: "Gus Guest" },
  "u-left": { id: "u-left", name: "Lee Left" },
};

function harness(opts: { cap?: number; gathering?: number; refuse?: (changes: any[]) => string | null } = {}) {
  const handlers = new Map<string, Handler>();
  const record = (m: string) => (p: string, h: Handler) => void handlers.set(`${m} ${p}`, h);
  const store = memoryStore();
  let ids = 0;
  register({ get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE") } as any, {
    authedUser: async (req: any) => PEOPLE[req.headers?.user] ?? null,
    capabilityCtx: async (user: any) => ({ user, propose: user.id !== "u-guest" }) as any,
    getPool: () => { throw new Error("the pool is not used in these tests"); },
    members: { byId: async (id: string) => PEOPLE[id] ?? null } as any,
    overLimit: async () => false,
    store,
    isFormerMember: async (user: any) => user.id === "u-left",
    numberVar: (key: string) => (key === "governance.change_set_cap" ? opts.cap ?? 22 : key === "governance.change_requests_gathering_per_member" ? opts.gathering ?? 5 : 0),
    newId: () => `cr-${++ids}`,
    rolesOf: async (id: string) => (id === "u-ana" ? ["Gardener"] : []),
    validate: async (changes: any[]) => {
      const problem = opts.refuse?.(changes);
      return problem
        ? { problems: [{ key: "*", problem }], normalized: [] }
        : { problems: [], normalized: changes.map((c: any) => ({ key: String(c.key ?? ""), from: "was" })) };
    },
  } as any);
  const call = async (method: string, path: string, user: string | null, body: any = {}, params: any = {}, query: any = {}) => {
    const out: { status: number; body: any } = { status: 200, body: undefined };
    const res: any = { status(c: number) { out.status = c; return res; }, json(b: any) { out.body = b; return res; } };
    await handlers.get(`${method} ${path}`)!({ headers: { user }, body, params, query }, res);
    return out;
  };
  return { call, store };
}

// The one gate is real: `hasCapability` reads the ctx. The stub ctx above is
// not a real CapabilityCtx, so the gate's answer is pinned through vi.mock.
import { vi } from "vitest";
vi.mock("../../shared/capabilities", async (orig) => {
  const real: any = await orig();
  return { ...real, hasCapability: (cap: string, ctx: any) => (cap === "mechanics.propose" ? !!ctx.propose : real.hasCapability(cap, ctx)) };
});

const DIAL = { kind: "dial", key: "governance.vote_days", to: "9" };
const BRAND = { kind: "brand_field", field: "project.tagline", to: "Hello" };

async function started(h: ReturnType<typeof harness>, user = "u-ana") {
  const r = await h.call("POST", "/api/change-requests", user, { title: "Garden hours", why: "Winter." });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

describe("who may gather (R4)", () => {
  it("refuses somebody signed out, a member who left, and a member below the gate, and stores nothing", async () => {
    const h = harness();
    expect((await h.call("POST", "/api/change-requests", null, { title: "a", why: "b" })).status).toBe(401);
    expect((await h.call("POST", "/api/change-requests", "u-left", { title: "a", why: "b" })).body.error).toBe("former_member");
    expect((await h.call("POST", "/api/change-requests", "u-guest", { title: "a", why: "b" })).body.error).toBe("cannot_propose");
    expect(h.store.rows.size).toBe(0);
  });

  it("lets only the author edit, and never anyone else's", async () => {
    const h = harness();
    const id = await started(h);
    const r = await h.call("POST", "/api/change-requests/:id/changes", "u-sol", { change: DIAL, revision: 1 }, { id });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("not_yours");
  });
});

describe("starting one", () => {
  it("needs a title and a why", async () => {
    const h = harness();
    const r = await h.call("POST", "/api/change-requests", "u-ana", { title: "", why: "x" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/title/);
  });

  it("stops at the gathering limit and names the dial", async () => {
    const h = harness({ gathering: 1 });
    await started(h);
    const r = await h.call("POST", "/api/change-requests", "u-ana", { title: "b", why: "b" });
    expect(r.status).toBe(409);
    expect(r.body.dial).toBe("governance.change_requests_gathering_per_member");
  });
});

describe("adding, editing and removing changes", () => {
  it("adds a change with the value it starts from, and moves the revision", async () => {
    const h = harness();
    const id = await started(h);
    const r = await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: DIAL, revision: 1 }, { id });
    expect(r.status).toBe(200);
    expect(r.body.revision).toBe(2);
    expect(r.body.changes[0]).toMatchObject({ key: "governance.vote_days", before: "was", after: "9", label: "How long a ballot stays open" });
  });

  it("refuses an edit made on a revision that is out of date", async () => {
    const h = harness();
    const id = await started(h);
    await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: DIAL, revision: 1 }, { id });
    const r = await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: BRAND, revision: 1 }, { id });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("out_of_date");
  });

  it("refuses the same setting twice", async () => {
    const h = harness();
    const id = await started(h);
    await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: DIAL, revision: 1 }, { id });
    const r = await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: { key: "governance.vote_days", to: "3" }, revision: 2 }, { id });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/already changes/);
  });

  it("stops at the village's cap with the sentence that names it", async () => {
    const h = harness({ cap: 1 });
    const id = await started(h);
    await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: DIAL, revision: 1 }, { id });
    const r = await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: BRAND, revision: 2 }, { id });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("cap_reached");
    expect(r.body.message).toContain("already carries 1 change,");
  });

  it("checks the WHOLE new list with the vote's validator, and passes its words through", async () => {
    const h = harness({ refuse: (changes) => (changes.length === 2 ? "A dial and a minting rule go up as two proposals" : null) });
    const id = await started(h);
    await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: DIAL, revision: 1 }, { id });
    const r = await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: BRAND, revision: 2 }, { id });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain("two proposals");
    expect((await h.store.byId(id))!.changes).toHaveLength(1);
  });

  it("edits a change in place and removes one", async () => {
    const h = harness();
    const id = await started(h);
    await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: DIAL, revision: 1 }, { id });
    await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: BRAND, revision: 2 }, { id });
    const edited = await h.call("PUT", "/api/change-requests/:id/changes/:position", "u-ana", { change: { ...DIAL, to: "11" }, revision: 3 }, { id, position: "0" });
    expect(edited.body.changes[0].after).toBe("11");
    const removed = await h.call("DELETE", "/api/change-requests/:id/changes/:position", "u-ana", {}, { id, position: "1" }, { revision: "4" });
    expect(removed.body.changes.map((c: any) => c.key)).toEqual(["governance.vote_days"]);
  });

  it("refuses edits once a change request has left gathering", async () => {
    const h = harness();
    const id = await started(h);
    h.store.rows.get(id)!.state = "in_review";
    const r = await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: DIAL, revision: 1 }, { id });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("not_gathering");
  });
});

describe("split into its own change request (US2.3, R23)", () => {
  it("moves the change into a new gathering change request with the same why and a link back", async () => {
    const h = harness();
    const id = await started(h);
    await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: DIAL, revision: 1 }, { id });
    await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: BRAND, revision: 2 }, { id });
    const r = await h.call("POST", "/api/change-requests/:id/changes/:position/split", "u-ana", { revision: 3 }, { id, position: "0" });
    expect(r.status).toBe(201);
    const split = (await h.store.byId(r.body.id))!;
    expect(split).toMatchObject({ relation: "split_from", relatesTo: id, why: "Winter.", state: "gathering" });
    expect(split.changes.map((c) => c.changeKey)).toEqual(["governance.vote_days"]);
    expect((await h.store.byId(id))!.changes.map((c) => c.changeKey)).toEqual(["brand:project.tagline"]);
  });

  it("refuses to split the only change, and refuses past the gathering limit", async () => {
    const h = harness({ gathering: 1 });
    const id = await started(h);
    await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: DIAL, revision: 1 }, { id });
    expect((await h.call("POST", "/api/change-requests/:id/changes/:position/split", "u-ana", { revision: 2 }, { id, position: "0" })).body.error).toBe("last_change");
    await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: BRAND, revision: 2 }, { id });
    expect((await h.call("POST", "/api/change-requests/:id/changes/:position/split", "u-ana", { revision: 3 }, { id, position: "0" })).body.error).toBe("gathering_limit");
  });
});

describe("reading", () => {
  it("is for anyone signed in, and lists mine and everyone's in review", async () => {
    const h = harness();
    const mine = await started(h);
    const theirs = await started(h, "u-sol");
    h.store.rows.get(theirs)!.state = "in_review";
    expect((await h.call("GET", "/api/change-requests/:id", null, {}, { id: mine })).status).toBe(401);
    const list = await h.call("GET", "/api/change-requests", "u-ana");
    expect(list.body.mine.map((c: any) => c.id)).toEqual([mine]);
    expect(list.body.open.map((c: any) => c.id)).toEqual([theirs]);
    expect(list.body.open[0].author).toBe("Sol");
  });

  it("never serves a surname", async () => {
    const h = harness();
    const id = await started(h);
    const r = await h.call("GET", "/api/change-requests/:id", "u-sol", {}, { id });
    expect(JSON.stringify(r.body)).not.toContain("Lopez");
    expect(r.body.author).toBe("Gardener (Ana)");
    expect(r.body.yours).toBe(false);
  });

  it("deletes a gathering change request for its author", async () => {
    const h = harness();
    const id = await started(h);
    const r = await h.call("DELETE", "/api/change-requests/:id", "u-ana", { revision: 1 }, { id });
    expect(r.body.deleted).toBe(true);
    expect(h.store.rows.size).toBe(0);
  });
});
