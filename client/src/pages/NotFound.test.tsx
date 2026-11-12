// @vitest-environment jsdom
/**
 * The 404 renders without the shell, so it has to be its own main landmark.
 * Before, it was the one page whose landmark list was empty (axe
 * landmark-one-main and region, at both widths), and every route whose module
 * is off lands here.
 *
 * Since Phase B (lane B3) it stands in the night world with one lit door:
 * the scene (a root frayed off the trail, stepping stones, the door) arrives
 * lazily so the nature kit stays out of the first page, while the landmark
 * and the language bar draw at once.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { WORLD } from "@/components/journey/look";

import NotFound from "./NotFound";

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

describe("NotFound landmarks", () => {
  it("is a main landmark holding the heading and the way back", async () => {
    motion(false);
    render(<NotFound />);
    const main = screen.getByRole("main");
    expect(await within(main).findByRole("heading", { level: 1, name: "Off the trail" })).toBeTruthy();
    expect(within(main).getByRole("link", { name: /back to the village/i })).toBeTruthy();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("carries the language selector at once, because it renders without the shell (spec i18n US2)", () => {
    motion(false);
    render(<NotFound />);
    expect(screen.getByRole("button", { name: /^Language: English \(EN\)/ })).toBeTruthy();
  });
});

describe("NotFound in the night world", () => {
  it("stands on the night ground and waits with the breathing leaf, never a ring", () => {
    motion(false);
    const { container } = render(<NotFound />);
    expect(screen.getByRole("main").className).toContain(WORLD);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("offers exactly one door, home, with fireflies on it", async () => {
    motion(false);
    render(<NotFound />);
    const main = screen.getByRole("main");
    const door = await within(main).findByRole("link", { name: "Back to the village" });
    expect(door.getAttribute("href")).toBe("/");
    // one door: the only link or button on the page beside the language picker
    const acts = Array.from(main.querySelectorAll("a, button")).filter((el) => !/^Language:/.test(el.getAttribute("aria-label") ?? el.textContent ?? ""));
    expect(acts).toEqual([door]);
    const lights = door.closest(".nk-ff-host")?.querySelector('[data-testid="fireflies"]');
    expect(lights, "the fireflies gather on the one door").toBeTruthy();
    expect(lights!.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws the trail: a frayed root, stones that lead on, and the door", async () => {
    motion(false);
    const { container } = render(<NotFound />);
    await screen.findByRole("heading", { level: 1 });
    const svg = container.querySelector('svg[data-drawing="off-trail"]')!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelectorAll("[data-fray]").length).toBeGreaterThanOrEqual(2);
    expect(svg.querySelectorAll("[data-stone]").length).toBe(4);
    expect(svg.querySelector("[data-door]")).not.toBeNull();
  });

  it("holds the door's fireflies still under reduced motion, in the same places", async () => {
    motion(true);
    render(<NotFound />);
    const door = await screen.findByRole("link", { name: "Back to the village" });
    const host = door.closest(".nk-ff-host")!;
    expect(host.getAttribute("data-motion")).toBe("still");
    expect(host.querySelector('[data-testid="fireflies"]')).not.toBeNull();
  });
});
