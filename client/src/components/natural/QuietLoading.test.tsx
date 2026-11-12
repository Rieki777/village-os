// @vitest-environment jsdom
/**
 * Waiting is the breathing leaf with words under it (never a spinning ring),
 * announced once as a status, and on a desktop the page's shape appears
 * STILL beside it. A busy button's leaf adds nothing to the button's name.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import QuietLoading from "./QuietLoading";
import BreathingLoader from "./BreathingLoader";

function motion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduce && q.includes("reduce"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("QuietLoading", () => {
  it("is one status that says what is coming, drawn as the breathing leaf", () => {
    motion(false);
    const { container } = render(<QuietLoading label="Gathering your page" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Gathering your page");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.querySelector(".nat-breathe")).not.toBeNull();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("shows the page's shape still, on a desktop only, and hides it from a screen reader", () => {
    motion(false);
    const { container } = render(<QuietLoading />);
    const shape = container.querySelector('[data-quiet="shape"]')!;
    expect(shape.getAttribute("aria-hidden")).toBe("true");
    expect(shape.className).toMatch(/\bhidden\b/);
    expect(shape.className).toMatch(/\blg:flex\b/);
    // still: no shimmer, no pulse, nothing that loops beside where words will be
    expect(shape.outerHTML).not.toMatch(/animate-|shimmer|nat-breathe/);
  });

  it("stands on the night ground when it fills the page, and leaves a page's own ground alone otherwise", () => {
    motion(false);
    const { container, rerender } = render(<QuietLoading world />);
    const box = () => container.querySelector('[data-quiet="loading"]')!;
    expect(box().className).toMatch(/\bsheet-night\b/);
    expect(box().className).toMatch(/\bbg-background\b/);
    rerender(<QuietLoading />);
    expect(box().className).not.toMatch(/\bsheet-night\b/);
  });

  it("can leave the shape out", () => {
    motion(false);
    const { container } = render(<QuietLoading shape={false} />);
    expect(container.querySelector('[data-quiet="shape"]')).toBeNull();
  });

  it("holds the leaf still under reduced motion and still says what it waits for", () => {
    motion(true);
    const { container } = render(<QuietLoading label="Gathering your page" />);
    expect(container.querySelector(".nat-breathe")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Gathering your page");
  });
});

describe("BreathingLoader decorative", () => {
  it("adds nothing to a busy button's name and is no status of its own", () => {
    motion(false);
    render(
      <button type="button" disabled>
        <BreathingLoader decorative size={16} /> Send it
      </button>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button").textContent?.trim()).toBe("Send it");
    expect(screen.getByRole("button", { name: "Send it" })).toBeTruthy();
  });

  it("still announces itself when it stands alone", () => {
    motion(false);
    render(<BreathingLoader label="The guide is reading" />);
    expect(screen.getByRole("status", { name: "The guide is reading" })).toBeTruthy();
  });
});
