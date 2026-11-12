// @vitest-environment jsdom
/**
 * YOUR SEASON, IN THE NIGHT WORLD, WITH THE COMMONS (Phase D).
 *
 *   - the page stands in the sheet's night world;
 *   - Your part opens with the commons: the village's goals for the season
 *     being planned, moss in each one the village reached;
 *   - only the live season knows what is reached, so a season still to come
 *     is all seeds, even when the live season reached a goal with the same
 *     words.
 *
 * Every name is made up.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-ana" } }),
  useOptionalAuth: () => ({ user: { id: "u-ana" } }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, modules: [{ id: "governance", lifecycle: "members" }] }),
  useModule: () => ({ id: "governance", lifecycle: "members" }),
}));
vi.mock("@/components/modules/ModuleGate", () => ({
  default: () => <p>Module gate</p>,
  SignInDoors: () => <a href="/login">Sign in</a>,
}));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));
const liveRef = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/gameApi", async (orig) => ({ ...(await orig<typeof import("@/lib/gameApi")>()), useSeason: () => liveRef.value }));

import MySeason, { commonsFor } from "./MySeason";

const GOALS = ["Plant the north orchard", "Open the guest kitchen", "Mend the long fence"];
const MINE = (id: string) => ({
  season: { id, name: "Season of Testing", startsOn: "2027-03-01", endsOn: "2027-06-01", goals: GOALS },
  window: { seasonId: id, seasonName: "Season of Testing", opensOn: "2027-02-01", closesOn: "2027-03-31", state: "open" },
  plan: null,
  filed: null,
  changedSinceFiling: false,
  heldSeats: [],
  applications: [],
  questsThisMoon: { done: 0 },
  mayApply: true,
  suggestions: null,
});
const LIVE = { current: { id: "s-now", goals: [{ text: "Open the guest kitchen", done: true }, { text: "Plant the north orchard", done: false }] } };

let planned = "s-now";
beforeEach(() => {
  planned = "s-now";
  liveRef.value = LIVE;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => new Response(JSON.stringify(String(url).startsWith("/api/season-plans/mine") ? MINE(planned) : {}), { status: 200, headers: { "Content-Type": "application/json" } })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the commons on your season", () => {
  it("opens Your part with the commons, in the night world, moss where the village reached a goal", async () => {
    const { container } = render(<MySeason />);
    await screen.findByText("Your part");
    expect(container.firstElementChild!.className).toContain("sheet-night");
    const commons = screen.getByTestId("commons");
    expect(within(commons).getByText("The commons")).toBeTruthy();
    expect(within(commons).getByText("We have reached 1 of 3 goals so far.")).toBeTruthy();
    const drawing = within(commons).getByRole("img");
    expect(drawing.querySelector('[data-goal="1"]')!.getAttribute("data-state")).toBe("reached");
    expect(drawing.querySelector('[data-goal="0"]')!.getAttribute("data-state")).toBe("seed");
    expect(drawing.querySelector('[data-goal="2"]')!.getAttribute("data-state")).toBe("seed");
  });

  it("draws a season still to come as all seeds", async () => {
    planned = "s-next";
    render(<MySeason />);
    await screen.findByText("Your part");
    expect(within(screen.getByTestId("commons")).getByText("We have reached 0 of 3 goals so far.")).toBeTruthy();
  });
});

describe("commonsFor", () => {
  it("marks a goal reached only when the planned season is the live one", () => {
    const season = { id: "s-now", goals: GOALS };
    expect(commonsFor(season, LIVE).map((g) => g.done)).toEqual([false, true, false]);
    // CONTROL: the same words on another season are not reached.
    expect(commonsFor({ ...season, id: "s-next" }, LIVE).map((g) => g.done)).toEqual([false, false, false]);
    expect(commonsFor(season, null).map((g) => g.done)).toEqual([false, false, false]);
    expect(commonsFor(null, LIVE)).toEqual([]);
  });

  it("carries the live goal's own id, so the goal can open its thread on the Open work board", () => {
    const live = { current: { id: "s-now", goals: [{ id: "g0123456789a", text: "Plant the north orchard", done: false }] } };
    expect(commonsFor({ id: "s-now", goals: GOALS }, live).map((g) => g.goalId)).toEqual(["g0123456789a", null, null]);
    expect(commonsFor({ id: "s-next", goals: GOALS }, live).map((g) => g.goalId)).toEqual([null, null, null]);
  });

  it("skips empty goals and keeps the season's order", () => {
    expect(commonsFor({ id: "x", goals: ["  ", "One", "Two"] }, null).map((g) => g.text)).toEqual(["One", "Two"]);
  });
});
