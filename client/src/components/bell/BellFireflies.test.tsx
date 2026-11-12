// @vitest-environment jsdom
/**
 * The light's flight to the bell: once per arrival, never on page load, and
 * never for a member who asked for less motion.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import BellFireflies from "./BellFireflies";

function stubMotion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduce && q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })) as unknown as typeof window.matchMedia;
}

const animate = vi.fn(() => ({ cancel() {} }));

afterEach(() => {
  cleanup();
  animate.mockClear();
});

describe("the flight to the bell", () => {
  it("does not fly for a light that was already there", () => {
    stubMotion(false);
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    render(<BellFireflies arrival={0} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("flies once, within the 1.6s bloom limit, when a waiting notice arrives", () => {
    stubMotion(false);
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    const { rerender } = render(<BellFireflies arrival={0} />);
    rerender(<BellFireflies arrival={1} />);
    expect(animate).toHaveBeenCalledTimes(1);
    const opts = (animate.mock.calls[0] as unknown[])[1] as { duration: number };
    expect(opts.duration).toBeLessThanOrEqual(1600);
  });

  it("stays still under reduced motion: the lights are simply there", () => {
    stubMotion(true);
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    render(<BellFireflies arrival={1} />);
    expect(animate).not.toHaveBeenCalled();
  });
});
