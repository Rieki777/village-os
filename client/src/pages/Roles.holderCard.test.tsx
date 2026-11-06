// @vitest-environment jsdom
/**
 * /roles: EACH HOLDER'S CARD IS ONE TAP AWAY, AND THE PAGE NEVER LOADS IT (PR 3).
 *
 *   - an open row shows the role's health line from its own `/api/org` row and
 *     "See their card" for each member holder with a handle, linking
 *     `/profile/:handle#role-<id>`;
 *   - the page asks `/api/org` and never the card endpoint, however many
 *     holders it shows;
 *   - CONTROL: a holder row with no handle (below the member tier) gets no link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { ROLE_ANCHOR } from "@shared/playerCard";
import { holderCardHref } from "@/components/playerCard/RoleHolderCards";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/SeatClaimCard", () => ({ default: () => null }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-me" }, token: "a-token", loading: false }),
  useIsAdmin: () => false,
}));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authToken: () => "a-token",
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: () => undefined,
  useModuleOn: () => false,
}));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

import Roles from "./Roles";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const HEALTH = {
  facts: [
    { key: "term", words: "Within term, to 31 December 2026", dot: "steady" },
    { key: "review", words: "No review date set", dot: "look" },
  ],
  dot: "look",
  dotWords: "Worth a look",
  openTensions: 2,
};

const holders = (n: number, withHandle = true) =>
  Array.from({ length: n }, (_, i) => ({
    userId: `u-${i}`,
    name: `Holder${i}`,
    kind: "member",
    focus: null,
    lapsed: false,
    isAgent: false,
    note: null,
    ...(withHandle ? { handle: `holder-${i}` } : {}),
  }));

const orgWith = (rows: any[]) => ({
  people: { visible: true, membersOnly: false, signedIn: true },
  village: { decidesBy: "consent" },
  circles: [{ id: "land", name: "Land", purpose: "", decidesBy: null, color: "sage", status: "active" }],
  roles: rows.map((r) => ({
    circleId: "land",
    aim: "Keep it going.",
    domain: null,
    accountabilities: [],
    whyItMatters: null,
    seats: 40,
    holderCount: r.holders.length,
    state: "partial",
    stateSource: "derived",
    criticality: "normal",
    recruiting: false,
    representsCircle: false,
    howChosen: null,
    howChosenGloss: null,
    termEnds: null,
    archetypes: [],
    isExample: false,
    ...r,
  })),
});

let org: any;
const asked: string[] = [];

beforeEach(() => {
  asked.length = 0;
  window.history.replaceState(null, "", "/roles");
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      asked.push(u);
      const body = u === "/api/org" ? org : u === "/api/season" ? { current: null } : u.endsWith("/needs") ? { needs: [] } : [];
      return { ok: true, status: 200, json: async () => body };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = async (name: string) => {
  const btn = (await screen.findByRole("heading", { level: 3, name })).closest("button")!;
  fireEvent.click(btn);
};

describe("See their card on /roles", () => {
  it("links each of 40 holders to their card at this role, with the health line, and never loads a card", async () => {
    org = orgWith([{ id: "water-keeper", name: "Water Keeper", holders: holders(40), health: HEALTH }]);
    render(
      <Router>
        <Roles />
      </Router>,
    );
    await open("Water Keeper");
    const block = document.querySelector("[data-role-holder-cards]") as HTMLElement;
    expect(block).toBeTruthy();
    const links = within(block).getAllByRole("link");
    expect(links).toHaveLength(40);
    expect(links[0].getAttribute("href")).toBe("/profile/holder-0#role-water-keeper");
    expect(links[0].textContent).toBe("See their card");
    expect(links[0].getAttribute("aria-label")).toBe("See the card of Holder0");
    expect(block.textContent).toContain("Worth a look");
    expect(block.textContent).toContain("Within term, to 31 December 2026");
    expect(block.textContent).toContain("2 open tensions");
    // One read of the org, and no card endpoint at all.
    expect(asked.filter((u) => u === "/api/org")).toHaveLength(1);
    expect(asked.some((u) => u.includes("/role-card") || u.endsWith("/card"))).toBe(false);
  });

  it("CONTROL: a holder with no handle gets no link", async () => {
    org = orgWith([{ id: "seed-keeper", name: "Seed Keeper", holders: holders(2, false), health: null }]);
    render(
      <Router>
        <Roles />
      </Router>,
    );
    await open("Seed Keeper");
    expect(document.querySelector("[data-role-holder-cards]")).toBeNull();
    expect(screen.queryByText("See their card")).toBeNull();
  });

  it("the anchor is the card's own role anchor", () => {
    expect(holderCardHref("wren", "r-1")).toBe(`/profile/wren#${ROLE_ANCHOR("r-1")}`);
  });
});
