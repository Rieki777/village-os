// @vitest-environment jsdom
/**
 * THE BLOOM that replaced the sparks (game feel wave 2): a choosing opens the
 * Seed of Life once, inside 1.6s, and then it is gone. Nothing of the old
 * sparks or leaf gust is drawn. Under reduced motion the same drawing is
 * there, still.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import Burst, { BLOOM_MS } from "./Burst";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Burst, now a bloom", () => {
  it("draws nothing until it is played", () => {
    const { container } = render(<Burst play={0} />);
    expect(container.innerHTML).toBe("");
  });

  it("opens a Seed of Life with its petals once, never sparks, and is gone within 1.6s", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Burst play={0} />);
    rerender(<Burst play={1} />);
    expect(container.querySelector("[data-bloom]")).toBeTruthy();
    expect(container.querySelector('[data-testid="seed-bloom"]')?.querySelectorAll("path")).toHaveLength(6);
    expect(container.querySelector(".sel-spark")).toBeNull();
    expect(BLOOM_MS).toBeLessThanOrEqual(1600);
    act(() => {
      vi.advanceTimersByTime(BLOOM_MS);
    });
    expect(container.querySelector("[data-bloom]")).toBeNull();
  });
});
