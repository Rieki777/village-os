import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Record<string, unknown>[] = [];
const pages: unknown[] = [];
const proposed: unknown[] = [];
const settings = new Map<string, string>();
let seen = new Set<string>();

vi.mock("./saberraSync", () => ({ preflight: () => ({ ok: true, client: {} }) }));
vi.mock("./modules", () => ({ effectiveLifecycle: () => "on" }));
vi.mock("./identity", () => ({ instanceIdentity: () => ({ instanceId: "v-test" }) }));
vi.mock("./saberraClient", () => ({
  openSession: async () => "s",
  listTools: async () => ({ ok: true, tools: [{ name: "list_quest_proposals", inputSchema: null }] }),
  callToolJson: async (_c: unknown, _s: unknown, _t: string, args: Record<string, unknown>) => {
    calls.push(args);
    return { ok: true, value: pages.shift() };
  },
}));
vi.mock("./questProposals", () => ({ proposeQuest: async (_p: unknown, input: unknown) => (proposed.push(input), { ok: true, id: "x", outcome: "stored" }) }));
vi.mock("../repos/seraQuestFeed", () => ({
  seenSeraQuestIds: async (_d: unknown, _m: string, ids: string[]) => new Set(ids.filter((i) => seen.has(i))),
  questFeedSetting: async (_d: unknown, k: string) => settings.get(k) ?? null,
  setQuestFeedSetting: async (_d: unknown, k: string, v: string) => void settings.set(k, v),
}));

import { pageOf, runQuestFeed } from "./seraQuestFeed";

beforeEach(() => {
  calls.length = 0; pages.length = 0; proposed.length = 0; settings.clear(); seen = new Set();
});

describe("Sera's quest feed", () => {
  it("reads pages until has_more is false", () => {
    expect(pageOf({ results: [1], has_more: true, next_cursor: "c2", dropped_for_email: 2 })).toEqual({ results: [1], next: "c2", dropped: 2 });
    expect(pageOf({ results: [], has_more: false, next_cursor: "c3" }).next).toBeNull();
  });

  it("a dry run counts and writes nothing, not even the bookmark", async () => {
    pages.push({ results: [{ id: "a", title: "A" }, { id: "b", title: "B" }], has_more: true, next_cursor: "c2", dropped_for_email: 1 },
      { results: [{ id: "c", title: "C" }, { title: "no id" }], has_more: false, dropped_for_email: 1 });
    seen = new Set(["b"]);
    const r = await runQuestFeed({} as any, { dryRun: true });
    expect(r).toMatchObject({ dryRun: true, read: 4, queued: 2, alreadySeen: 1, droppedForEmail: 2, refusedHere: 1 });
    expect(calls[1]).toMatchObject({ cursor: "c2" });
    expect(proposed).toEqual([]);
    expect(settings.size).toBe(0);
  });

  it("a real run proposes only unseen quests, keyed by Sera id, then reads changed_since", async () => {
    pages.push({ results: [{ id: "a", title: "A" }, { id: "rejected-1", title: "R" }], has_more: false, dropped_for_email: 0 });
    seen = new Set(["rejected-1"]);
    const r = await runQuestFeed({} as any, { dryRun: false });
    expect(r).toMatchObject({ queued: 1, alreadySeen: 1 });
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({ sourceProposalId: "a", moduleId: "saberra", proposedByKind: "agent" });
    expect(calls[0].changed_since).toBeUndefined();
    pages.push({ results: [], has_more: false });
    await runQuestFeed({} as any, { dryRun: true });
    expect(typeof calls[1].changed_since).toBe("string");
  });
});
