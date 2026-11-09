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
import type { ChangeRequestRow, ChangeRequestStore, NewChangeRequest, ReviewNote, Revision } from "../repos/changeRequests";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

let clockAt = new Date("2026-11-06T12:00:00Z");
const clock = () => clockAt;
const DAY = 24 * 60 * 60 * 1000;

function memoryStore(): ChangeRequestStore & { rows: Map<string, ChangeRequestRow>; notes: ReviewNote[] } {
  const rows = new Map<string, ChangeRequestRow>();
  const notes: ReviewNote[] = [];
  const now = () => new Date().toISOString();
  return {
    rows,
    notes,
    async create(input: NewChangeRequest) {
      rows.set(input.id, {
        id: input.id, authorUserId: input.authorUserId, authorKind: "member", title: input.title, why: input.why,
        state: "gathering", revision: 1, relation: input.relation ?? null, relatesTo: input.relatesTo ?? null,
        proposalId: null, closedReason: null, reviewOpenedAt: null, reviewDaysAtOpen: null, createdAt: now(), updatedAt: now(), changes: input.changes ?? [],
      });
    },
    async byId(id) { const r = rows.get(id); return r ? structuredClone(r) : null; },
    async byAuthor(u) { return [...rows.values()].filter((r) => r.authorUserId === u); },
    async open() { return [...rows.values()].filter((r) => r.state === "in_review" || r.state === "voting"); },
    async countGathering(u) { return [...rows.values()].filter((r) => r.authorUserId === u && r.state === "gathering").length; },
    async revise(id, expected, next: Revision) {
      const r = rows.get(id);
      if (!r || r.revision !== expected || (r.state !== "gathering" && r.state !== "in_review")) return false;
      const restart = r.state === "in_review" && (next.changes !== undefined || next.why !== undefined);
      rows.set(id, {
        ...r, revision: r.revision + 1, title: next.title ?? r.title, why: next.why ?? r.why, changes: next.changes ?? r.changes,
        reviewOpenedAt: restart ? clock().toISOString() : r.reviewOpenedAt,
      });
      return true;
    },
    async openReview(id, expected, days) {
      const r = rows.get(id);
      if (!r || r.revision !== expected || r.state !== "gathering") return false;
      rows.set(id, { ...r, state: "in_review", reviewOpenedAt: clock().toISOString(), reviewDaysAtOpen: days });
      return true;
    },
    async notesOf(id) { return notes.filter((n) => n.changeRequestId === id).map((n) => ({ ...n })); },
    async addNote(n) {
      if (rows.get(n.changeRequestId)?.state !== "in_review") return false;
      notes.push({ position: null, proposedItem: null, answersNoteId: null, ...n, outcome: "open", createdAt: clock().toISOString() } as ReviewNote);
      return true;
    },
    async settleNote(noteId, outcome) {
      const n = notes.find((x) => x.id === noteId);
      if (!n || n.outcome !== "open") return false;
      n.outcome = outcome;
      return true;
    },
    async openedForReviewSince(u) {
      return notes.filter((n) => n.kind === "system" && n.authorUserId === u).length;
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
  "u-steward": { id: "u-steward", name: "Rye Cordon" },
  "u-ana": { id: "u-ana", name: "Ana Lopez" },
  "u-sol": { id: "u-sol", name: "Sol Rivera" },
  "u-guest": { id: "u-guest", name: "Gus Guest" },
  "u-left": { id: "u-left", name: "Lee Left" },
};

function harness(opts: { cap?: number; gathering?: number; reviewDays?: number; ceiling?: number; refuse?: (changes: any[]) => string | null } = {}) {
  const notices: any[] = [];
  clockAt = new Date("2026-11-06T12:00:00Z");
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
    numberVar: (key: string) =>
      key === "governance.change_set_cap" ? opts.cap ?? 22
      : key === "governance.change_requests_gathering_per_member" ? opts.gathering ?? 5
      : key === "governance.change_request_review_days" ? opts.reviewDays ?? 3
      : key === "governance.proposals_per_member_per_cycle" ? opts.ceiling ?? 5
      : 0,
    liveHoldersOf: async (cap: string) => (cap === "dial.set" ? ["u-steward", "u-ana"] : cap === "story.tell" ? ["u-steward", "u-sol", "u-ana"] : []),
    notify: async (n: any) => { notices.push(n); return { ok: true } as any; },
    cycleStart: () => new Date(0),
    proposalsOpenedSince: async () => 0,
    byAgent: (req: any) => req.headers?.agent === "1",
    now: clock,
    newId: () => `cr-${++ids}`,
    rolesOf: async (id: string) => (id === "u-ana" ? ["Gardener"] : []),
    validate: async (changes: any[]) => {
      const problem = opts.refuse?.(changes);
      return problem
        ? { problems: [{ key: "*", problem }], normalized: [] }
        : { problems: [], normalized: changes.map((c: any) => ({ key: String(c.key ?? ""), from: "was" })) };
    },
  } as any);
  const call = async (method: string, path: string, user: string | null, body: any = {}, params: any = {}, query: any = {}, headers: any = {}) => {
    const out: { status: number; body: any } = { status: 200, body: undefined };
    const res: any = { status(c: number) { out.status = c; return res; }, json(b: any) { out.body = b; return res; } };
    await handlers.get(`${method} ${path}`)!({ headers: { user, ...headers }, body, params, query }, res);
    return out;
  };
  return { call, store, notices };
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

  it("refuses edits once a change request is in the vote", async () => {
    const h = harness();
    const id = await started(h);
    h.store.rows.get(id)!.state = "voting";
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

// ── THE REVIEW ROUND ───────────────────────────────────────────────────────

async function inReview(h: ReturnType<typeof harness>) {
  const id = await started(h);
  await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: DIAL, revision: 1 }, { id });
  await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: BRAND, revision: 2 }, { id });
  const r = await h.call("POST", "/api/change-requests/:id/open-review", "u-ana", { revision: 3 }, { id });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return id;
}

describe("opening the review (US3.1, R2)", () => {
  it("needs at least one change, and only the author opens it", async () => {
    const h = harness();
    const id = await started(h);
    expect((await h.call("POST", "/api/change-requests/:id/open-review", "u-ana", { revision: 1 }, { id })).body.error).toBe("no_changes");
    await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: DIAL, revision: 1 }, { id });
    expect((await h.call("POST", "/api/change-requests/:id/open-review", "u-sol", { revision: 2 }, { id })).body.error).toBe("not_yours");
  });

  it("is counted against the village's ceiling on proposals per cycle", async () => {
    const h = harness({ ceiling: 1 });
    await inReview(h);
    const second = await started(h);
    await h.call("POST", "/api/change-requests/:id/changes", "u-ana", { change: DIAL, revision: 1 }, { id: second });
    const r = await h.call("POST", "/api/change-requests/:id/open-review", "u-ana", { revision: 2 }, { id: second });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe("cycle_ceiling");
  });

  it("asks every live holder of a touched power once, never the author, and names no person (US4, III.2)", async () => {
    const h = harness();
    const id = await inReview(h);
    const asked = h.notices.filter((n) => n.type === "change_request_review");
    expect(asked.map((n) => n.userId).sort()).toEqual(["u-sol", "u-steward"]);
    expect(new Set(asked.map((n) => n.dedupeKey)).size).toBe(2);
    expect(asked[0].dedupeKey).toBe(`cr-review:${id}:r3:${asked[0].userId}`);
    for (const n of asked) expect(`${n.title} ${n.body}`).not.toMatch(/Ana|Rye|Sol|Lopez/);
  });

  it("shows the checklist, which waits for the review time", async () => {
    const h = harness();
    const id = await inReview(h);
    const r = await h.call("GET", "/api/change-requests/:id", "u-sol", {}, { id });
    expect(r.body.review.ready).toBe(false);
    expect(r.body.review.checklist.find((l: any) => l.key === "review_time").words).toMatch(/^Waits until/);
    clockAt = new Date(clockAt.getTime() + 3 * DAY + 1000);
    const later = await h.call("GET", "/api/change-requests/:id", "u-sol", {}, { id });
    expect(later.body.review.ready).toBe(true);
  });
});

describe("notes in the review (US3.2, R9, I.22)", () => {
  it("takes a question from any member, tells the author, and names the writer as Role (FirstName) only to readers", async () => {
    const h = harness();
    const id = await inReview(h);
    const r = await h.call("POST", "/api/change-requests/:id/notes", "u-sol", { kind: "question", body: "Why winter?" }, { id });
    expect(r.status).toBe(201);
    expect(r.body.review.notes.at(-1)).toMatchObject({ kind: "question", by: "Sol", body: "Why winter?" });
    const told = h.notices.find((n) => n.userId === "u-ana" && n.type === "change_request");
    expect(told.title).toMatch(/New question/);
  });

  it("holds the vote until every objection has an answer, then lets it go", async () => {
    const h = harness({ reviewDays: 0 });
    const id = await inReview(h);
    const o = await h.call("POST", "/api/change-requests/:id/notes", "u-sol", { kind: "objection", body: "It harms the kitchen." }, { id });
    const objection = o.body.review.notes.find((n: any) => n.kind === "objection");
    expect(o.body.review.ready).toBe(false);
    expect(o.body.review.checklist.find((l: any) => l.key === "objections").words).toMatch(/1 objection/);
    const a = await h.call("POST", "/api/change-requests/:id/notes/:noteId/answer", "u-ana", { body: "Kitchen hours stay.", revision: 3 }, { id, noteId: objection.id });
    expect(a.status).toBe(200);
    expect(a.body.review.ready).toBe(true);
  });

  it("allows one open objection per member per version", async () => {
    const h = harness();
    const id = await inReview(h);
    await h.call("POST", "/api/change-requests/:id/notes", "u-sol", { kind: "objection", body: "One." }, { id });
    const again = await h.call("POST", "/api/change-requests/:id/notes", "u-sol", { kind: "objection", body: "Two." }, { id });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/already/);
  });

  it("never takes consent or an objection from an agent", async () => {
    const h = harness();
    const id = await inReview(h);
    const r = await h.call("POST", "/api/change-requests/:id/notes", "u-sol", { kind: "consent" }, { id }, {}, { agent: "1" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/person/);
  });

  it("counts consent once per member, on the current version only (R3)", async () => {
    const h = harness();
    const id = await inReview(h);
    await h.call("POST", "/api/change-requests/:id/notes", "u-sol", { kind: "consent" }, { id });
    const twice = await h.call("POST", "/api/change-requests/:id/notes", "u-sol", { kind: "consent" }, { id });
    expect(twice.body.review.consents).toBe(1);
    const edited = await h.call("PUT", "/api/change-requests/:id/changes/:position", "u-ana", { change: { ...DIAL, to: "12" }, revision: 3 }, { id, position: "0" });
    expect(edited.body.review.consents).toBe(0);
  });

  it("refuses a note from a member who left, and every note once the vote has opened", async () => {
    const h = harness();
    const id = await inReview(h);
    expect((await h.call("POST", "/api/change-requests/:id/notes", "u-left", { kind: "question", body: "x" }, { id })).body.error).toBe("former_member");
    h.store.rows.get(id)!.state = "voting";
    const late = await h.call("POST", "/api/change-requests/:id/notes", "u-sol", { kind: "question", body: "x" }, { id });
    expect(late.status).toBe(409);
  });
});

describe("editing in review starts it again (R3)", () => {
  it("restarts the clock and asks the reviewers again on the new version", async () => {
    const h = harness();
    const id = await inReview(h);
    clockAt = new Date(clockAt.getTime() + 2 * DAY);
    const before = h.notices.length;
    const r = await h.call("PUT", "/api/change-requests/:id/changes/:position", "u-ana", { change: { ...DIAL, to: "12" }, revision: 3 }, { id, position: "0" });
    expect(r.status).toBe(200);
    expect(new Date(r.body.review.endsAt).getTime()).toBe(clockAt.getTime() + 3 * DAY);
    const again = h.notices.slice(before).filter((n) => n.type === "change_request_review");
    expect(again.map((n) => n.dedupeKey).every((k: string) => k.includes(":r4:"))).toBe(true);
  });
});

describe("suggested edits (US3.3, R40)", () => {
  it("lets any member suggest an edit, checked as the vote would check it, and the author take it in as a new version", async () => {
    const h = harness();
    const id = await inReview(h);
    const s = await h.call("POST", "/api/change-requests/:id/suggestions", "u-sol", { op: "replace", position: 0, change: { ...DIAL, to: "5" }, body: "Five is enough." }, { id });
    expect(s.status).toBe(201);
    const edit = s.body.review.notes.find((n: any) => n.kind === "edit");
    const t = await h.call("POST", "/api/change-requests/:id/suggestions/:noteId/take-in", "u-ana", { revision: 3 }, { id, noteId: edit.id });
    expect(t.status).toBe(200);
    expect(t.body.revision).toBe(4);
    expect(t.body.changes[0].after).toBe("5");
    expect(h.notices.some((n) => n.userId === "u-sol" && /taken in/.test(n.title))).toBe(true);
  });

  it("refuses a suggested edit the vote would refuse", async () => {
    const h = harness({ refuse: (changes) => (changes.some((c) => c.to === "999") ? "Must be at most 30." : null) });
    const id = await inReview(h);
    const s = await h.call("POST", "/api/change-requests/:id/suggestions", "u-sol", { op: "replace", position: 0, change: { ...DIAL, to: "999" } }, { id });
    expect(s.status).toBe(400);
    expect(s.body.message).toContain("at most 30");
  });

  it("needs a one-line reason to turn an edit down, and tells the member who suggested it", async () => {
    const h = harness();
    const id = await inReview(h);
    const s = await h.call("POST", "/api/change-requests/:id/suggestions", "u-sol", { op: "remove", position: 1 }, { id });
    const edit = s.body.review.notes.find((n: any) => n.kind === "edit");
    expect((await h.call("POST", "/api/change-requests/:id/suggestions/:noteId/turn-down", "u-ana", { reason: "", revision: 3 }, { id, noteId: edit.id })).status).toBe(400);
    const d = await h.call("POST", "/api/change-requests/:id/suggestions/:noteId/turn-down", "u-ana", { reason: "The tagline is part of it.", revision: 3 }, { id, noteId: edit.id });
    expect(d.status).toBe(200);
    expect(h.notices.some((n) => n.userId === "u-sol" && /turned down/.test(n.title))).toBe(true);
    expect(d.body.review.notes.find((n: any) => n.id === edit.id).outcome).toBe("turned_down");
  });
});

describe("nobody is told about their own act", () => {
  it("does not notify the author of an objection they posted, or a member of their own edit taken in", async () => {
    const h = harness();
    const id = await inReview(h);
    const before = h.notices.length;
    await h.call("POST", "/api/change-requests/:id/notes", "u-ana", { kind: "objection", body: "My own doubt." }, { id });
    const s = await h.call("POST", "/api/change-requests/:id/suggestions", "u-ana", { op: "replace", position: 0, change: { ...DIAL, to: "4" } }, { id });
    const edit = s.body.review.notes.find((n: any) => n.kind === "edit");
    await h.call("POST", "/api/change-requests/:id/suggestions/:noteId/take-in", "u-ana", { revision: 3 }, { id, noteId: edit.id });
    expect(h.notices.slice(before).filter((n) => n.userId === "u-ana")).toEqual([]);
  });
});
