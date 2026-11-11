// @vitest-environment jsdom
/**
 * THE ROOT STRIP (the Trail's successor): the reader's one next step under the
 * header, from the path conductor, for a member and for a visitor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { tokenFacts, visitorFacts, yourPathAll, type PathFacts } from "@shared/yourPath";

const useAuthMock = vi.fn();
const fetchGameMeMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("@/lib/gameApi", () => ({ fetchGameMe: () => fetchGameMeMock(), useGameConfig: () => ({ project: { commitmentName: "Love Letter" } }) }));
vi.mock("@/lib/profileRefresh", () => ({ onProfileRefresh: () => () => {} }));

import { isQuietPath } from "./NextStepTrail";
import RootLine from "./path/RootLine";
import { clearPathCache } from "@/lib/usePath";
import { chaptersOf } from "./path/pathView";

const NOW = new Date("2026-11-11T18:00:00Z");
const account = (over: Partial<PathFacts>): PathFacts => ({
  ...visitorFacts(NOW, "UTC"),
  person: { kind: "account", role: "user", founderPowerStands: false, proposals: [] },
  member: { trained: true, joining: null, claims: [{ status: "approved" }], budget: { remaining: 0, total: 100 } },
  ...over,
});
const served = (f: PathFacts) => {
  const all = yourPathAll(f);
  return { path: { ...all[0], today: "2026-11-11", said: { step: "", after: null, whose: "" }, also: all.slice(1), dates: {} } };
};

function at(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <RootLine quiet={isQuietPath} />
    </Router>,
  );
}

beforeEach(() => {
  clearPathCache();
  window.sessionStorage.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  useAuthMock.mockReturnValue({ user: { id: "u1", role: "member" }, loading: false });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the root strip", () => {
  it("says a holder's agreement, never the training, with what comes after and the day", async () => {
    fetchGameMeMock.mockResolvedValue(
      served(
        account({
          member: { trained: false, joining: "unsigned", claims: [], budget: { remaining: 100, total: 100 } },
          applications: [{ id: "a1", roles: ["Land Steward"], status: "adopted", steps: [{ step: "terms", href: "/role-applications/a1" }], firstDay: "2026-12-21" }],
        }),
      ),
    );
    at("/quests");
    const step = await screen.findByRole("link", { name: "Align with your role's terms" });
    expect(step).toHaveAttribute("href", "/role-applications/a1");
    expect(screen.getByText(/Your role as Land Steward starts on 21 December\./)).toBeInTheDocument();
    expect(screen.queryByText(/community training/)).toBeNull();
    expect(document.querySelector("[data-root-line]")?.getAttribute("data-path-state")).toBe("agreements");
  });

  it("gives a phone one target that opens the whole path, and a desktop a door to it", async () => {
    fetchGameMeMock.mockResolvedValue(served(account({})));
    at("/gratitude");
    await screen.findByRole("link", { name: "Find your next quest" });
    const phone = document.querySelector("[data-root-phone]") as HTMLAnchorElement;
    expect(phone.getAttribute("href")).toBe("/path");
    expect(phone.getAttribute("aria-label")).toContain("Find your next quest");
    expect(screen.getByRole("link", { name: "See your whole path" })).toHaveAttribute("href", "/path");
    // The seed draws one circle per milestone, the walked ones closed.
    const seed = document.querySelector("[data-root-desktop] .nk-life")!;
    expect(seed.getAttribute("data-total")).toBe("10");
    expect(seed.getAttribute("data-walked")).toBe("1");
    // No fireflies on the strip: they belong to the one next act on a page.
    expect(screen.queryByTestId("fireflies")).toBeNull();
  });

  it("shows the desktop the chapter stops, with the one being walked marked", async () => {
    fetchGameMeMock.mockResolvedValue(served(account({ seatings: [{ roleId: "r", role: "Land Steward", startedOn: "2026-11-10", termEndsOn: null, warningOpen: false, lapsed: false, renewing: false }] })));
    at("/gratitude");
    await screen.findByText("Taking root");
    const stops = Array.from(document.querySelectorAll("[data-stop]")).map((li) => [li.textContent, li.getAttribute("data-stop")]);
    expect(stops).toEqual([["Arriving", "walked"], ["Being welcomed", "walked"], ["Taking root", "walked"], ["Your first moon", "now"]]);
  });

  it("stays quiet on the step's own page, on the profile and on the whole-path page", async () => {
    fetchGameMeMock.mockResolvedValue(served(account({})));
    for (const p of ["/quests", "/profile", "/path", "/admin/x", "/login"]) {
      clearPathCache();
      const { container, unmount } = at(p);
      await Promise.resolve();
      await Promise.resolve();
      expect(container.querySelector("[data-root-line]"), p).toBeNull();
      unmount();
    }
  });

  it("gives a visitor the front door and the companion's line, with no read of anybody's account", async () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    at("/steward");
    const step = await screen.findByRole("link", { name: "Find where you belong" });
    expect(step).toHaveAttribute("href", "/roles");
    expect(screen.getByText(/Read a few roles slowly/)).toBeInTheDocument();
    expect(fetchGameMeMock).not.toHaveBeenCalled();
  });

  it("the companion stays quiet for a visitor after three screens of one visit", async () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    for (const p of ["/", "/steward", "/resident"]) {
      const { unmount } = at(p);
      await screen.findByText(/Read a few roles slowly/);
      unmount();
    }
    at("/visit");
    await screen.findByRole("link", { name: "Find where you belong" });
    expect(screen.queryByText(/Read a few roles slowly/)).toBeNull();
  });

  it("draws nothing for a member on a server that serves no path", async () => {
    fetchGameMeMock.mockResolvedValue({ nextAction: { id: "x", label: "y", href: "/z" } });
    const { container } = at("/quests");
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector("[data-root-line]")).toBeNull();
  });
});

describe("isQuietPath", () => {
  it("knows the doors, the team's rooms, the status page and a live room", () => {
    expect(isQuietPath("/profile")).toBe(true);
    expect(isQuietPath("/path")).toBe(true);
    expect(isQuietPath("/admin/setup")).toBe(true);
    expect(isQuietPath("/application-status/op-1?token=x")).toBe(true);
    expect(isQuietPath("/sessions/abc")).toBe(true);
    expect(isQuietPath("/sessions")).toBe(false);
    expect(isQuietPath("/quests")).toBe(false);
    expect(isQuietPath("/quests?x=1", "/quests#top")).toBe(true);
    expect(isQuietPath("/profile/characters")).toBe(false);
  });

  it("keeps the founding-team application in its own register: the strip stays away from every door into it", () => {
    expect(isQuietPath("/propose-a-role")).toBe(true);
    expect(isQuietPath("/propose-a-role?role=r-1")).toBe(true);
    expect(isQuietPath("/propose-a-role/abc-token")).toBe(true);
    expect(isQuietPath("/propose-a-role/confirm?token=x")).toBe(true);
    expect(isQuietPath("/proposals")).toBe(false);
  });
});

describe("chaptersOf", () => {
  it("marks one chapter as now: the first that is not wholly walked", () => {
    expect(chaptersOf([]).map((c) => c.state)).toEqual(["now", "ahead", "ahead", "ahead"]);
    const token = yourPathAll(tokenFacts(NOW, "UTC", { ref: "p", statusHref: "/application-status/p", status: "confirmed", step: "interview", by: null, withRole: "Land", termsToAnswer: false, invite: null, ownAccountAtAdoption: false, nextSeason: null }))[0];
    expect(chaptersOf(token.walked).map((c) => c.state)).toEqual(["walked", "now", "ahead", "ahead"]);
  });
});
