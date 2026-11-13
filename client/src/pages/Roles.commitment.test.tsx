// @vitest-environment jsdom
/**
 * /roles and what a member can give (0383, lane E1). A role marked required
 * at 100% waits behind one door for a member who says they can give less,
 * and the page says how many and offers to show them anyway. A flexible role
 * at 100% stays; a member with no word sees every role. Each absence has its
 * known-positive control beside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

const session = vi.hoisted(() => ({ token: null as string | null, user: null as null | { id: string; role?: string } }));
const catalog = vi.hoisted(() => ({ modules: [] as Array<{ id: string; name: string; lifecycle: string }> }));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/SeatClaimCard", () => ({ default: () => null }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: session.user, token: session.token, loading: false }),
  useIsAdmin: () => session.user?.role === "admin" || session.user?.role === "founder",
}));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authToken: () => session.token,
}));
// The catalog by its real rule: a module is on when the viewer's manifest
// lists it with a lifecycle past off.
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: (id: string) => catalog.modules.find((m) => m.id === id),
  useModuleOn: (id: string) => catalog.modules.some((m) => m.id === id && m.lifecycle !== "off"),
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

const seat = (id: string, name: string, state: string) => ({
  id,
  name,
  circleId: "land",
  aim: `Keep the ${name.toLowerCase()} work going.`,
  domain: null,
  accountabilities: [],
  whyItMatters: null,
  seats: 1,
  holderCount: state === "open" ? 0 : 1,
  state,
  stateSource: "derived",
  criticality: "normal",
  recruiting: state === "open",
  representsCircle: false,
  howChosen: null,
  howChosenGloss: null,
  termEnds: "2027-02-01T12:00:00.000Z",
  archetypes: [],
  isExample: false,
  holders: [],
});

/** `/api/org` at the member tier, in the shape the seat projection serves. */
const ORG = {
  people: { visible: true, membersOnly: false, signedIn: true },
  village: { decidesBy: "consent" },
  circles: [{ id: "land", name: "Land & Water", purpose: "The ground and its water", decidesBy: null, color: "sage", status: "active" }],
  roles: [
    { ...seat("land-steward", "Land Steward", "open"), card: { commitmentPct: 100, commitmentRequired: true } },
    { ...seat("seed-keeper", "Seed Keeper", "open"), card: { commitmentPct: 100, commitmentRequired: false } },
    { ...seat("water-keeper", "Water Keeper", "open"), card: { commitmentPct: 30, commitmentRequired: true } },
  ],
};

let mine: number | null = 50;
let founding: any = { on: false, roleIds: [], sections: {}, showPayRanges: false, villagePay: null };

beforeEach(() => {
  window.history.replaceState(null, "", "/roles");
  session.token = "a-token";
  session.user = { id: "u-me" };
  catalog.modules = [];
  mine = 50;
  founding = { on: false, roleIds: [], sections: {}, showPayRanges: false, villagePay: null };
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
      if (u === "/api/org") return reply(ORG);
      if (u === "/api/org/founding-team") return reply(founding);
      if (u === "/api/me/commitment") return reply({ now: mine === null ? null : { id: 1, pct: mine, fromDate: "2026-11-12", period: "season", note: null, saidAt: null }, history: [] });
      if (u === "/api/season") return reply({ current: { name: "Season of Foundations", endsOn: "2099-03-21" }, daysLeft: 171 });
      if (u.endsWith("/needs")) return reply({ needs: [] });
      return reply([]);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function renderRoles() {
  const view = render(
    <Router>
      <Roles />
    </Router>,
  );
  const seeAll = screen.queryByRole("button", { name: "See all roles" });
  if (seeAll) fireEvent.click(seeAll);
  return view;
}

const name = (n: string) => screen.queryByRole("heading", { level: 3, name: n });

describe("roles that need more time than the member has", () => {
  it("hides a role required at 100% from a member who gives 50, and says so", async () => {
    renderRoles();
    await screen.findByRole("heading", { level: 3, name: "Seed Keeper" });
    await waitFor(() => expect(screen.getByText("1 role needs more time than you have right now.")).toBeTruthy());
    expect(name("Land Steward")).toBeNull();
    // Controls: a flexible role at 100% and a required role within reach both stay.
    expect(name("Seed Keeper")).not.toBeNull();
    expect(name("Water Keeper")).not.toBeNull();
  });

  it("shows them anyway on one press", async () => {
    renderRoles();
    const show = await screen.findByRole("button", { name: "Show them anyway" });
    fireEvent.click(show);
    expect(await screen.findByRole("heading", { level: 3, name: "Land Steward" })).toBeTruthy();
  });

  it("a member who can give all of it sees every role and no line", async () => {
    mine = 100;
    renderRoles();
    expect(await screen.findByRole("heading", { level: 3, name: "Land Steward" })).toBeTruthy();
    expect(screen.queryByText(/need more time than you have/)).toBeNull();
  });

  it("a member who has said nothing sees every role", async () => {
    mine = null;
    renderRoles();
    expect(await screen.findByRole("heading", { level: 3, name: "Land Steward" })).toBeTruthy();
    expect(screen.queryByText(/needs? more time than you have/)).toBeNull();
  });

  it("holds a founding role required at 100% back too, and says so above the founding team", async () => {
    founding = { on: true, roleIds: ["land-steward", "seed-keeper"], sections: {}, showPayRanges: false, villagePay: null };
    render(
      <Router>
        <Roles />
      </Router>,
    );
    await waitFor(() => expect(screen.getByText("1 role needs more time than you have right now.")).toBeTruthy());
    // Control: the flexible founding role at 100% is still featured.
    await waitFor(() => expect(screen.getAllByText("Seed Keeper").length).toBeGreaterThan(0));
    expect(screen.queryAllByText("Land Steward")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Show them anyway" }));
    await waitFor(() => expect(screen.getAllByText("Land Steward").length).toBeGreaterThan(0));
  });
});
