// @vitest-environment jsdom
/**
 * /role-proposals/new reads the member's proposals first. A member who already
 * has a draft goes to it with no POST at all: the refused prefill was a 409 in
 * the console on every visit (audit M14). CONTROL: no draft, and the prefill is
 * asked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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

function visit(mine: unknown, openForm?: unknown) {
  const posts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(url);
        return json({ proposal: { href: "/role-proposals/new-1" } });
      }
      if (openForm !== undefined && String(url).startsWith("/api/open-proposals/form")) return json(openForm);
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

  /*
   * B7 (verify, 11 Nov 2026): a village taking proposals for this moon offers
   * its open roles at the member door too, beside next season. CONTROL: with
   * the open form taking next season only, nothing is asked and the draft starts.
   */
  const MOON = { open: true, term: { kind: "moon", startsOn: "2026-11-09", endsOn: "2026-12-08" }, roles: [{ id: "r-cook", name: "Cook" }] };

  it("B7: with this moon's roles open, asks which first, and starts no draft until next season is chosen", async () => {
    const { posts, history } = visit({ draftId: null, proposals: [], nextSeason: null, nextSeasonWords: null }, MOON);
    const moon = await waitFor(() => {
      const el = document.querySelector('[data-door="moon"]');
      if (!el) throw new Error("no choice yet");
      return el as HTMLElement;
    });
    expect(moon.textContent).toContain("1 role is open now, from 9 November 2026 to the next new moon on 8 December 2026.");
    expect(moon.querySelector("a")?.getAttribute("href")).toBe("/propose-a-role");
    expect(posts).toEqual([]);
    fireEvent.click(document.querySelector('[data-door="season"]') as HTMLElement);
    await waitFor(() => expect(posts.length).toBe(1));
    await waitFor(() => expect(history.at(-1)).toBe("/role-proposals/new-1"));
  });

  it("B7 CONTROL: with the open form for next season, nothing is asked and the draft starts", async () => {
    const { posts } = visit({ draftId: null, proposals: [], nextSeason: null, nextSeasonWords: null }, { ...MOON, term: null });
    await waitFor(() => expect(posts.length).toBe(1));
    expect(document.querySelector("[data-moon-or-season]")).toBeNull();
  });

  it("signed out: says this moon and opens the form that needs no account, beside the sign-in (final verification)", async () => {
    me.user = null as unknown as { id: string };
    try {
      visit({ draftId: null, proposals: [], nextSeason: null, nextSeasonWords: null });
      await waitFor(() => expect(document.querySelector("[data-open-form-door]")).toBeTruthy());
      const door = document.querySelector("[data-open-form-door]") as HTMLAnchorElement;
      expect(door.getAttribute("href")).toBe("/propose-a-role");
      expect(document.body.textContent).toContain("this moon");
      expect(document.body.textContent).not.toContain("next season");
    } finally {
      me.user = { id: "u1" };
    }
  });
});
