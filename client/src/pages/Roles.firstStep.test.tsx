// @vitest-environment jsdom
/**
 * /roles, first step. Season goals are drawn from the live season, the roles
 * list waits behind the archetype step, "See all roles" opens it, and an
 * archetype card carries its pick to /roles/select.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactNode } from "react";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/contexts/AuthContext")>("@/contexts/AuthContext");
  return { ...actual, useIsAdmin: () => false, useAuth: () => ({ user: null }) };
});
const seasonRef = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/gameApi", async (orig) => ({ ...(await orig<typeof import("@/lib/gameApi")>()), useSeason: () => seasonRef.value }));

import Roles from "./Roles";
import { seasonView } from "@shared/seasonGoalsView";
import { ARCHETYPES } from "@shared/archetypes";

const ORG = {
  people: null,
  circles: [{ id: "land", name: "Land Circle", purpose: "Tend the ground." }],
  roles: [{ id: "garden", name: "Gardener", circleId: "land", seats: 1, holderCount: 0, state: "open", archetypes: ["building"], holders: [] }],
};

const season = (goals: unknown, name = "Season of Foundations") => ({
  current: { name, startsOn: "2026-09-22", endsOn: "2026-12-21", goals },
  upcoming: null,
});

beforeEach(() => {
  window.history.replaceState(null, "", "/roles");
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body });
      if (url === "/api/org") return json(ORG);
      if (url === "/api/archetypes") return json(ARCHETYPES);
      if (url === "/api/exit-policy") return json({ policy: { placeholder: false, restorative: { intakeContactRole: "", steps: [] } }, configured: true, platformWording: [] });
      return json({}, false);
    }),
  );
});
afterEach(() => {
  cleanup();
  seasonRef.value = null;
  vi.unstubAllGlobals();
});

function renderRoles() {
  const loc = memoryLocation({ path: "/roles", record: true });
  const view = render(
    <Router hook={loc.hook}>
      <Roles />
    </Router>,
  );
  return { ...view, loc };
}

describe("season goals on /roles", () => {
  it("draws the season's name, dates and goals from the live season, with a door to the fuller view", () => {
    seasonRef.value = season([{ id: "a", text: "Water system running" }, { id: "b", text: "First harvest shared", done: true }]);
    renderRoles();
    const block = screen.getByRole("region", { name: "Season of Foundations" });
    expect(within(block).getByText("22 September 2026 to 21 December 2026")).toBeTruthy();
    expect(within(block).getByText("Water system running")).toBeTruthy();
    expect(within(block).getByText("First harvest shared")).toBeTruthy();
    expect(within(block).getByText("Done")).toBeTruthy();
    expect(within(block).getByRole("link", { name: "Explore the goals" }).getAttribute("href")).toBe("/roles/select#sel-season");
  });

  it("changes with the season and holds no goals of its own", () => {
    seasonRef.value = season([{ text: "Seed bank open" }], "Season of Roots");
    renderRoles();
    expect(screen.getByRole("region", { name: "Season of Roots" })).toBeTruthy();
    expect(screen.getByText("Seed bank open")).toBeTruthy();
    expect(screen.queryByText("Water system running")).toBeNull();
  });

  it("draws nothing when no season is set", () => {
    seasonRef.value = { current: null, upcoming: null };
    renderRoles();
    expect(screen.queryByText("This season's goals")).toBeNull();
  });

  it("says so when the season has no goals, and still opens the door", () => {
    seasonRef.value = season([]);
    renderRoles();
    expect(screen.getByText("No goals are set for this season yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Explore the goals" })).toBeTruthy();
  });

  it("folds a long list behind one button", () => {
    seasonRef.value = season(Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, text: `Goal number ${i + 1}` })));
    renderRoles();
    expect(screen.queryByText("Goal number 7")).toBeNull();
    const more = screen.getByRole("button", { name: "Show all 9 goals" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(screen.getByText("Goal number 9")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show fewer goals" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("reads a bare season entry and skips empty goals", () => {
    expect(seasonView({ name: "S", goals: [{ text: "  " }, { text: "Real" }, null] })?.goals.map((g) => g.text)).toEqual(["Real"]);
    expect(seasonView(null)).toBeNull();
    expect(seasonView({ current: null })).toBeNull();
  });
});

describe("step one: the archetype", () => {
  it("hides the roles until a choice, then reveals them with See all roles", async () => {
    renderRoles();
    expect(screen.getByRole("heading", { name: "Select your archetype to help you find your role" })).toBeTruthy();
    // Wait for the archetypes, which prove the page has had time to load the chart too.
    await screen.findByText("The Builder");
    expect(screen.queryByText("Gardener")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Land Circle" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See all roles" }));
    expect(await screen.findByRole("heading", { name: "Land Circle" })).toBeTruthy();
    expect(screen.getByText("Gardener")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "See all roles" })).toBeNull();
    // Focus moves to the new section so a keyboard or screen reader user lands on it.
    expect(document.activeElement?.textContent).toBe("All roles and circles");
  });

  it("opens the roles for a link to one seat", async () => {
    window.history.replaceState(null, "", "/roles?seat=garden");
    renderRoles();
    expect(await screen.findByRole("heading", { name: "Land Circle" })).toBeTruthy();
  });

  it("explains each archetype from the village's own cast, with a line on who would pick it", async () => {
    renderRoles();
    for (const a of ARCHETYPES) {
      const link = (await screen.findByText(a.name)).closest("a") as HTMLElement;
      expect(link.textContent).toContain(a.blurb);
      expect(link.textContent).toContain("You might pick this if you are drawn to");
      expect(link.getAttribute("href")).toBe(`/roles/select?archetype=${a.key}`);
    }
    expect(screen.getByText(/you may choose all five/)).toBeTruthy();
  });

  it("carries the pick to the selection page", async () => {
    const { loc } = renderRoles();
    fireEvent.click((await screen.findByText("The Storyteller")).closest("a") as HTMLElement);
    await waitFor(() => expect(loc.history?.at(-1)).toContain("/roles/select"));
    expect(loc.history?.at(-1)).toContain("archetype=storytelling");
  });
});
