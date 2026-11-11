// @vitest-environment jsdom
/**
 * THE TRAIL, STILL AND MOVING (journey kit, game feel lane).
 *
 * Someone who asked for less motion gets the end state at once: the water
 * filled to the stone they stand on, a leaf already on every stone behind
 * them, and nothing that unfurls. The same trail with motion on carries the
 * unfurl. Every stone stays a real button either way.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Trail, { trailFill } from "./Trail";

const LABELS = ["Goals", "Characters", "Scout", "Select", "Propose"];

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

describe("the trail", () => {
  it("fills by the stone you stand on", () => {
    expect(trailFill(0, 5)).toBe(0);
    expect(trailFill(2, 5)).toBe(0.5);
    expect(trailFill(4, 5)).toBe(1);
    expect(trailFill(9, 5)).toBe(1);
    expect(trailFill(0, 1)).toBe(1);
  });

  it("P2: with visited given, a step jumped over is not ticked done", () => {
    motion(true);
    render(<Trail labels={LABELS} step={3} reached={4} onGo={() => {}} barLabel="Progress" visited={new Set([0, 3])} />);
    const state = (i: number) => document.querySelectorAll("button[data-state]")[i].getAttribute("data-state");
    expect([0, 1, 2, 3].map(state)).toEqual(["done", "ahead", "ahead", "here"]);
  });

  it("renders the end state at once under reduced motion", () => {
    motion(true);
    const { container } = render(<Trail labels={LABELS} step={2} reached={4} onGo={() => {}} barLabel="Your progress" />);
    const root = container.querySelector(".jw-trail") as HTMLElement;
    expect(root.getAttribute("data-motion")).toBe("still");
    const fill = container.querySelector(".jw-trail-fill") as HTMLElement;
    expect(fill.style.transform).toBe("scaleX(0.5)");
    // Two stones behind: each already carries its leaf, and no leaf is set to unfurl.
    expect(container.querySelectorAll(".jw-sprout")).toHaveLength(2);
    expect(container.querySelectorAll(".jw-unfurl")).toHaveLength(0);
    expect(screen.getByRole("progressbar", { name: "Your progress" }).getAttribute("aria-valuenow")).toBe("3");
  });

  it("lets the leaves unfurl when motion is welcome", () => {
    motion(false);
    const { container } = render(<Trail labels={LABELS} step={2} reached={4} onGo={() => {}} barLabel="Your progress" />);
    expect((container.querySelector(".jw-trail") as HTMLElement).getAttribute("data-motion")).toBe("live");
    expect(container.querySelectorAll(".jw-sprout.jw-unfurl")).toHaveLength(2);
  });

  it("keeps every stone a named button, and a stone ahead of reach closed", () => {
    motion(true);
    const go = vi.fn();
    render(<Trail labels={LABELS} step={1} reached={2} onGo={go} barLabel="Your progress" />);
    const here = screen.getByRole("button", { name: "Characters" });
    expect(here.getAttribute("aria-current")).toBe("step");
    expect((screen.getByRole("button", { name: "Propose" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Goals" }));
    expect(go).toHaveBeenCalledWith(0);
  });
});
