// @vitest-environment jsdom
/**
 * THE COMMONS, drawn: moss only where the village reached a goal, a seed in
 * every goal not reached yet, and nothing a person could be read from.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MOSS_FULL } from "./commonsGeometry";

const motion = vi.hoisted(() => ({ still: false }));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => motion.still,
  prefersReducedMotion: () => motion.still,
}));

import Commons from "./Commons";

const GOALS = [
  { id: "a", done: true },
  { id: "b", done: false },
  { id: "c", done: true },
  { id: "d", done: false },
];

afterEach(() => {
  cleanup();
  motion.still = false;
});

describe("the commons drawing", () => {
  it("spreads moss into each goal the village reached, and a seed into each one it has not", () => {
    render(<Commons goals={GOALS} label="Four goals" />);
    const drawing = screen.getByRole("img", { name: "Four goals" });
    const goal = (i: number) => drawing.querySelector(`[data-goal="${i}"]`)!;
    expect(goal(0).getAttribute("data-state")).toBe("reached");
    expect(goal(0).querySelectorAll("[data-testid=commons-moss] circle")).toHaveLength(MOSS_FULL);
    expect(goal(0).querySelector("[data-testid=commons-flower]")).not.toBeNull();
    // CONTROL: a goal not reached grows no moss and opens no flower; it holds one seed.
    expect(goal(1).getAttribute("data-state")).toBe("seed");
    expect(goal(1).querySelector("[data-testid=commons-moss]")).toBeNull();
    expect(goal(1).querySelector("[data-testid=commons-flower]")).toBeNull();
    expect(goal(1).querySelector("[data-testid=commons-seed]")).not.toBeNull();
    expect(screen.getAllByTestId("commons-moss")).toHaveLength(2);
    expect(screen.getAllByTestId("commons-seed")).toHaveLength(2);
  });

  it("carries no words of its own, so nothing on it can name a person", () => {
    render(<Commons goals={GOALS} label="Four goals" />);
    const drawing = screen.getByRole("img", { name: "Four goals" });
    expect(drawing.textContent).toBe("");
    expect(drawing.querySelector("text, title")).toBeNull();
  });

  it("draws the finished moss, still, under reduced motion", () => {
    motion.still = true;
    const { container } = render(<Commons goals={GOALS} label="Four goals" />);
    expect(container.querySelector(".cm")!.getAttribute("data-motion")).toBe("still");
    expect(screen.getAllByTestId("commons-moss")[0].querySelectorAll("circle")).toHaveLength(MOSS_FULL);
  });

  it("lights the goal in hand and names a hovered one back to the caller", () => {
    const onActive = vi.fn();
    render(<Commons goals={GOALS} label="Four goals" active={2} onActive={onActive} />);
    const drawing = screen.getByRole("img", { name: "Four goals" });
    expect(drawing.querySelector('[data-goal="2"]')!.getAttribute("data-active")).toBe("true");
    expect(drawing.querySelector('[data-goal="1"]')!.getAttribute("data-active")).toBeNull();
    fireEvent.pointerEnter(drawing.querySelector('[data-goal="3"]')!);
    expect(onActive).toHaveBeenLastCalledWith(3);
  });

  it("draws nothing when the season has no goals", () => {
    const { container } = render(<Commons goals={[]} label="None" />);
    expect(container.innerHTML).toBe("");
  });
});
