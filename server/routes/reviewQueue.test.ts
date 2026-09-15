/**
 * The review queue's gate: either key opens it, and each key opens its own half.
 *
 * `GET /api/review/queue` asked `intake.moderate` alone, while accepting and
 * rejecting a proposed quest asked `quest.approve` (finding 11 of the quests
 * contract review). A village that handed somebody `quest.approve` had handed
 * them a key to accept proposals they could not list. The governance lane's
 * reading, 2026-09-14: `intake.moderate` keeps both halves, because reading is
 * exactly what that key grants and reading a quest proposal creates no
 * obligation; `quest.approve` alone reads the quest half.
 *
 * NO DATABASE, on purpose. What is under test is which reads happen for which
 * key, so the queue's readers become counters and the real handler runs behind
 * a real Express app. The proposal half is four reads: the proposal queue, the
 * drop count, and the drafts and preview context the stuck-draft cards need.
 * The quest half is one. The `guardCapability` stub refuses the way the real one
 * does, so this file can also be pointed at the handler as it stood before.
 */
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "./review";

const reads = vi.hoisted(() => ({ proposals: 0, quests: 0, drops: 0, drafts: 0, previews: 0 }));

/** Nothing read at all. */
const NONE_READ = { proposals: 0, quests: 0, drops: 0, drafts: 0, previews: 0 };

vi.mock("../lib/externalProposals", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    proposalQueue: async () => {
      reads.proposals += 1;
      return [
        {
          id: "p-1",
          batchId: "b-1",
          moduleId: "vendor",
          kind: "role.proposed",
          payload: { name: "Water steward" },
          quote: null,
          sourceRef: null,
          sourceOccurredAt: null,
          evidence: "absent",
          audience: "steward",
          trustTier: "t1",
          confidence: null,
          significance: null,
          subjectRef: null,
          receivedAt: "2026-09-14T00:00:00.000Z",
          correlationId: null,
        },
      ];
    },
    recentDrops: async () => {
      reads.drops += 1;
      return [{ moduleId: "vendor", reason: "contained_an_email", dropped: 2, lastAt: null }];
    },
  };
});

vi.mock("../lib/questProposals", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    questProposalQueue: async () => {
      reads.quests += 1;
      return [
        {
          id: "qp-1",
          batchId: "b-2",
          moduleId: "assistant",
          prose: { title: "Tend the swale" },
          rationale: null,
          quote: null,
          sourceRef: null,
          proposedByKind: "assistant",
          receivedAt: "2026-09-14T00:00:00.000Z",
        },
      ];
    },
  };
});

vi.mock("../lib/orgDrafts", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    listDrafts: async () => {
      reads.drafts += 1;
      return [];
    },
    loadPreviewContext: async () => {
      reads.previews += 1;
      return {};
    },
    stuckQueueDrafts: () => [],
  };
});

let server: http.Server;
let base = "";
/** The keys the caller holds, as the gates would answer them. */
let keys = new Set<string>();

const queue = async () => {
  const r = await fetch(`${base}/api/review/queue`); // module-review-ok: the suite's own in-process server on 127.0.0.1, never an outbound call, so there is no correlation id to carry
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};

describe("the review queue answers either key, each for its own half (finding 11)", () => {
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    register(app, {
      isAdmin: async () => false,
      authedUser: async () => ({ id: "u-steward", name: "Mara Voss" }),
      guardCapability: async (_req: any, res: any, cap: string) => {
        if (keys.has(cap)) return true;
        res.status(401).json({ error: "auth_required" });
        return false;
      },
      mayAct: async (_req: any, cap: string) => ({ ok: keys.has(cap) }),
      mayStillSee: async (_req: any, cap: string) => keys.has(cap),
      adminActor: () => null,
      getPool: () => ({}),
      members: { all: async () => [] },
      questsRepo: {},
      circlesRepo: {},
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  beforeEach(() => {
    keys = new Set();
    Object.assign(reads, NONE_READ);
  });

  it("intake.moderate reads both halves, as it always has", async () => {
    keys = new Set(["intake.moderate"]);
    const r = await queue();
    expect(r.status).toBe(200);
    expect(r.body.scope).toEqual({ proposals: true, quests: true });
    expect(r.body.batches).toHaveLength(1);
    expect(r.body.quests).toHaveLength(1);
    expect(r.body.drops).toHaveLength(1);
    expect(r.body.stuckDrafts).toEqual([]);
    expect(r.body.counts).toEqual({ proposals: 1, quests: 1 });
    expect(reads).toEqual({ proposals: 1, quests: 1, drops: 1, drafts: 1, previews: 1 });
  });

  it("quest.approve alone reads the quest half, and the proposal half is never read", async () => {
    keys = new Set(["quest.approve"]);
    const r = await queue();
    expect(r.status).toBe(200);
    expect(r.body.scope).toEqual({ proposals: false, quests: true });
    expect(r.body.quests).toHaveLength(1);
    expect(r.body.batches).toEqual([]);
    expect(r.body.drops).toEqual([]);
    expect(r.body.stuckDrafts).toEqual([]);
    expect(reads).toEqual({ ...NONE_READ, quests: 1 });
  });

  it("neither key is refused the way the page already reads a refusal, and nothing is read", async () => {
    const r = await queue();
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "auth_required" });
    expect(reads).toEqual(NONE_READ);
  });
});
