// @vitest-environment jsdom
/**
 * THE PUBLIC PULSE BECOMES THE COMMONS (Phase D, decision 2).
 *
 * The landing used to read `GET /api/game/pulse`, a feed of happenings that
 * named members ("Ana joined the village"), and show it to any visitor. Now
 * it draws this season's goals as the commons and reads nothing but the live
 * season, so no name and no personal count can reach a visitor. The only
 * number on it is the village's own: goals reached of the season's goals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const seasonRef = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/gameApi", async (orig) => ({ ...(await orig<typeof import("@/lib/gameApi")>()), useSeason: () => seasonRef.value }));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

import VillagePulse from "./VillagePulse";

const season = (goals: unknown) => ({
  current: { id: "s1", name: "Season of Roots", startsOn: "2026-09-22", endsOn: "2026-12-21", goals },
  upcoming: null,
});

/** What the old pulse feed carried: a member's name on every line. */
const PULSE = [
  { id: "e1", type: "join", text: "Ana Torres joined the village", at: new Date().toISOString() },
  { id: "e2", type: "quest", text: "Bruno finished 12 quests", at: new Date().toISOString() },
];

const asked: string[] = [];
beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(String(url));
      return new Response(JSON.stringify(String(url).includes("/api/game/pulse") ? PULSE : {}), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  seasonRef.value = null;
});

describe("the commons on the public landing", () => {
  it("draws this season's goals with moss in the ones the village reached, and the village's own count", async () => {
    seasonRef.value = season([
      { id: "a", text: "Clean water all year", done: true },
      { id: "b", text: "Shared meals every week", done: false },
      { id: "c", text: "A seed bank open to all", done: false },
    ]);
    render(<VillagePulse />);
    const block = screen.getByRole("region", { name: "The commons" });
    expect(block.className).toContain("sheet-night");
    expect(within(block).getByText("Season of Roots. 22 September 2026 to 21 December 2026")).toBeTruthy();
    expect(within(block).getByText("We have reached 1 of 3 goals so far.")).toBeTruthy();
    const drawing = within(block).getByRole("img", { name: /This season's 3 goals as circles/ });
    expect(drawing.querySelectorAll("[data-testid=commons-moss]")).toHaveLength(1);
    expect(drawing.querySelectorAll("[data-testid=commons-seed]")).toHaveLength(2);
    const items = within(block).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Clean water all yearReached", "Shared meals every week", "A seed bank open to all"]);
    expect(within(block).getByRole("link", { name: "See the roles that tend these goals" }).getAttribute("href")).toBe("/roles");
  });

  it("never reads the old pulse feed, so a visitor never sees a member's name or a personal count", async () => {
    seasonRef.value = season([{ id: "a", text: "Clean water all year", done: false }]);
    render(<VillagePulse />);
    await new Promise((r) => setTimeout(r, 20));
    expect(asked.some((u) => u.includes("/api/game/pulse"))).toBe(false);
    expect(screen.queryByText(/Ana Torres|Bruno|12 quests/)).toBeNull();
  });

  it("lights a goal's circle when its line is in hand", () => {
    seasonRef.value = season([
      { id: "a", text: "Clean water all year", done: true },
      { id: "b", text: "Shared meals every week", done: false },
    ]);
    render(<VillagePulse />);
    const drawing = screen.getByRole("img", { name: /goals as circles/ });
    fireEvent.pointerEnter(screen.getByText("Shared meals every week").closest("li")!);
    expect(drawing.querySelector('[data-goal="1"]')!.getAttribute("data-active")).toBe("true");
    expect(drawing.querySelector('[data-goal="0"]')!.getAttribute("data-active")).toBeNull();
  });

  it("folds a long list and still draws every goal", () => {
    seasonRef.value = season(Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, text: `Goal number ${i + 1}`, done: i < 2 })));
    render(<VillagePulse />);
    expect(screen.getByRole("img", { name: /This season's 9 goals/ }).querySelectorAll("[data-goal]")).toHaveLength(9);
    expect(screen.queryByText("Goal number 8")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 9 goals" }));
    expect(screen.getByText("Goal number 9")).toBeTruthy();
  });

  it("draws nothing with no season, or a season with no goals", () => {
    seasonRef.value = { current: null, upcoming: null };
    const { container, rerender } = render(<VillagePulse />);
    expect(container.innerHTML).toBe("");
    seasonRef.value = season([]);
    rerender(<VillagePulse />);
    expect(container.innerHTML).toBe("");
  });
});
