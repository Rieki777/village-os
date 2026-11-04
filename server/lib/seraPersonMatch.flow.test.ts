import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = { links: new Map<string, string>(), reviews: new Map<string, string>(), email: "Ana@Example.org" as string | null };
vi.mock("../repos/seraLinkReviews", () => ({
  verifiedEmailOf: async () => store.email,
  hasSeraLink: async (_: unknown, u: string) => [...store.links.values()].includes(u),
  linkedMemberOf: async (_: unknown, o: string) => store.links.get(o) ?? null,
  linkByMatch: async (_: unknown, o: string, u: string) => { store.links.set(o, u); },
  queueReview: async (_: unknown, u: string, outcome: string) => { store.reviews.set(u, outcome); },
  clearReview: async (_: unknown, u: string) => { store.reviews.delete(u); },
  unlinkedVerifiedMembers: async () => ["u1", "u2"],
  reviewsByMember: async () => new Map(),
}));
vi.mock("../repos/seraPersonLinks", () => ({ memberLinks: async () => [] }));

import { backfill, matchMember } from "./seraPersonMatch";

describe("the match flow", () => {
  beforeEach(() => {
    process.env.SABERRA_PERSON_MATCH = "on"; process.env.SABERRA_LINK_SECRET = "k"; process.env.SABERRA_PRIVACY_TOKEN = "t";
    store.links.clear(); store.reviews.clear(); store.email = "Ana@Example.org";
  });
  afterEach(() => { delete process.env.SABERRA_PERSON_MATCH; delete process.env.SABERRA_LINK_SECRET; delete process.env.SABERRA_PRIVACY_TOKEN; });

  it("sends only the hash, and links on one id", async () => {
    const ask = vi.fn(async () => ({ ok: true as const, value: { owner_ids: ["40d0a88e-f36a-8150-9dd6-ec0acc8381fa"] } }));
    expect(await matchMember({} as never, "u1", ask)).toBe("linked");
    const sent = JSON.stringify(ask.mock.calls[0]);
    expect(sent).not.toMatch(/ana|example/i);
    expect(Object.keys((ask.mock.calls[0] as unknown[])[1] as object)).toEqual(["email_hash"]);
  });

  it("queues several for a steward, never picks", async () => {
    const ask = vi.fn(async () => ({ ok: true as const, value: { owner_ids: ["aaaaaaaa-1", "bbbbbbbb-2"] } }));
    expect(await matchMember({} as never, "u1", ask)).toBe("review");
    expect(store.reviews.get("u1")).toBe("several");
    expect(store.links.size).toBe(0);
  });

  it("skips an unverified member and calls nothing", async () => {
    store.email = null;
    const ask = vi.fn();
    expect(await matchMember({} as never, "u1", ask as never)).toBe("skipped");
    expect(ask).not.toHaveBeenCalled();
  });

  it("the dry run counts and calls nothing; off means nothing at all", async () => {
    const ask = vi.fn();
    expect(await backfill({} as never, true, ask as never)).toMatchObject({ dryRun: true, candidates: 2, linked: 0 });
    expect(ask).not.toHaveBeenCalled();
    delete process.env.SABERRA_PERSON_MATCH;
    expect((await backfill({} as never, false, ask as never)).note).toBeTruthy();
    expect(ask).not.toHaveBeenCalled();
  });
});
