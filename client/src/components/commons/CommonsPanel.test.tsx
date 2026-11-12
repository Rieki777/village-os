// @vitest-environment jsdom
/**
 * EACH GOAL IN THE COMMONS OPENS ITS OPEN WORK (the "Open work" board with
 * goal threads): a goal with an id links to `/quests?goal=<id>`, and once the
 * village's count is known its line says how many open quests grow it. The
 * count is the village's only; nothing here can carry a person's.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { renderHook } from "@testing-library/react";

vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

import CommonsPanel from "./CommonsPanel";
import { goalWorkHref, openWorkFor, useGoalOpenWork } from "./goalOpenWork";

const GOALS = [
  { id: "g1", goalId: "g0123456789a", text: "Clean water all year", done: false },
  { id: "g2", goalId: "g0123456789b", text: "Shared meals every week", done: true },
  { id: "2", goalId: null, text: "A goal saved before ids", done: false },
];

afterEach(cleanup);

describe("a goal's open work", () => {
  it("links each goal with an id to its thread on the Open work board", () => {
    render(<CommonsPanel goals={GOALS} head={<h2>The commons</h2>} openWork={null} />);
    expect(screen.getByRole("link", { name: "Clean water all year" }).getAttribute("href")).toBe("/quests?goal=g0123456789a");
    expect(screen.getByRole("link", { name: "Shared meals every week" }).getAttribute("href")).toBe("/quests?goal=g0123456789b");
    // CONTROL: a goal with no id of its own is never linked by its place in the list.
    expect(screen.queryByRole("link", { name: "A goal saved before ids" })).toBeNull();
    expect(screen.getByText("A goal saved before ids")).toBeTruthy();
  });

  it("says how many open quests grow each goal, the village's count, once it is known", () => {
    render(<CommonsPanel goals={GOALS} head={<h2>The commons</h2>} openWork={{ g0123456789a: 12, g0123456789b: 1 }} />);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("12 open quests grow Clean water all year")).toBeTruthy();
    expect(within(items[1]).getByText("1 open quest grows Shared meals every week")).toBeTruthy();
    expect(items[2].querySelector("[data-open-work]")).toBeNull();
  });

  it("shows no count at all while the read is unknown", () => {
    const { container } = render(<CommonsPanel goals={GOALS} head={<h2>The commons</h2>} openWork={null} />);
    expect(container.querySelector("[data-open-work]")).toBeNull();
  });
});

describe("the slot lane C5 fills", () => {
  it("answers null until C5's per-goal read is wired, so no count is guessed", () => {
    expect(renderHook(() => useGoalOpenWork()).result.current).toBeNull();
  });

  it("reads one goal's count and refuses anything that is not a count", () => {
    expect(openWorkFor({ a: 3 }, "a")).toBe(3);
    expect(openWorkFor({ a: 3 }, "b")).toBeNull();
    expect(openWorkFor({ a: -1 }, "a")).toBeNull();
    expect(openWorkFor({ a: Number.NaN }, "a")).toBeNull();
    expect(openWorkFor(null, "a")).toBeNull();
    expect(openWorkFor({ a: 3 }, null)).toBeNull();
    expect(goalWorkHref("g 1&x")).toBe("/quests?goal=g%201%26x");
  });
});
