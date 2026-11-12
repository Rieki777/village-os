// @vitest-environment jsdom
/**
 * EACH GOAL IN THE COMMONS OPENS ITS OPEN WORK (the "Open work" board with
 * goal threads): a goal with an id links to `/quests?goal=<id>`, and once the
 * village's count is known its line says how many open quests grow it. The
 * count is the village's only; nothing here can carry a person's.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { renderHook } from "@testing-library/react";

vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

import CommonsPanel from "./CommonsPanel";
import { goalWorkHref, openWorkFor, openWorkFromGoals, useGoalOpenWork } from "./goalOpenWork";

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

describe("the count comes from the Open work board's read (GET /api/quests/goals)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("answers null while the read is loading, then the village's count per goal id", async () => {
    let answer: (v: unknown) => void = () => {};
    const seen: string[] = [];
    globalThis.fetch = vi.fn((url: any) => {
      seen.push(String(url));
      return new Promise((r) => (answer = r));
    }) as any;
    const { result } = renderHook(() => useGoalOpenWork());
    expect(result.current).toBeNull();
    answer({
      ok: true,
      json: async () => ({
        goals: [
          { id: "g0123456789a", text: "Clean water all year", done: false, openQuests: 12 },
          { id: "g0123456789b", text: "Shared meals every week", done: true, openQuests: 0 },
        ],
      }),
    });
    await waitFor(() => expect(result.current).toEqual({ g0123456789a: 12, g0123456789b: 0 }));
    expect(seen).toEqual(["/api/quests/goals"]);
  });

  it("shows no count when the read fails, so nothing is guessed", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as any;
    const { result } = renderHook(() => useGoalOpenWork());
    await waitFor(() => expect(result.current).toEqual({}));
    expect(openWorkFor(result.current, "g0123456789a")).toBeNull();
  });

  it("the panel says the board's count once the read lands", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ goals: [{ id: "g0123456789a", text: "Clean water all year", done: false, openQuests: 12 }] }),
    })) as any;
    render(<CommonsPanel goals={GOALS} head={<h2>The commons</h2>} />);
    await waitFor(() => expect(screen.getByText("12 open quests grow Clean water all year")).toBeTruthy());
  });

  it("maps the board's list by goal id and skips anything without one", () => {
    expect(openWorkFromGoals(null)).toBeNull();
    expect(openWorkFromGoals([{ id: "", text: "x", done: false, openQuests: 3 }])).toEqual({});
    expect(openWorkFromGoals([{ id: "ga", text: "x", done: false, openQuests: 3 }])).toEqual({ ga: 3 });
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
