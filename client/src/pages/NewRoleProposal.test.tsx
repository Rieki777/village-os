// @vitest-environment jsdom
/**
 * /role-proposals/new reads the member's proposals first. A member who already
 * has a draft goes to it with no POST at all: the refused prefill was a 409 in
 * the console on every visit (audit M14). CONTROL: no draft, and the prefill is
 * asked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, modules: [{ id: "governance", lifecycle: "public" }] }),
  useModule: (id: string) => ({ id, lifecycle: "public" }),
}));
const me = vi.hoisted(() => ({ user: { id: "u1" }, loading: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => me }));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { NewRoleProposal } from "./RoleProposal";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function visit(mine: unknown) {
  const posts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(url);
        return json({ proposal: { href: "/role-proposals/new-1" } });
      }
      return json(mine);
    }),
  );
  const { hook, history } = memoryLocation({ path: "/role-proposals/new", record: true });
  render(
    <Router hook={hook}>
      <NewRoleProposal />
    </Router>,
  );
  return { posts, history };
}

describe("/role-proposals/new", () => {
  it("goes to the draft the member already has, with no prefill request", async () => {
    const { posts, history } = visit({ draftId: "draft-7", proposals: [], nextSeason: null, nextSeasonWords: null });
    await waitFor(() => expect(history.at(-1)).toBe("/role-proposals/draft-7"));
    expect(posts).toEqual([]);
  });

  it("CONTROL: with no draft it asks for the prefill", async () => {
    const { posts, history } = visit({ draftId: null, proposals: [], nextSeason: null, nextSeasonWords: null });
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]).toMatch(/prefill$/);
    await waitFor(() => expect(history.at(-1)).toBe("/role-proposals/new-1"));
  });
});
