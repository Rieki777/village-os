// @vitest-environment jsdom
/**
 * The hearths on the circles map (Phase D, D2), rendered: every circle glows,
 * threads join neighbours, fireflies sit only where the server said lights
 * gather, nothing in the layer names a person or can be focused, and reduced
 * motion keeps the same lights, still.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { NestedLayout } from "@shared/mapLayout";
import HearthLens from "./HearthLens";

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

const circleAt = (id: string, x: number, y: number, depth = 1) => ({ id, x, y, r: 60, depth, roles: [], questDots: [], questOverflow: 0 });

const layout: NestedLayout = {
  width: 1000,
  height: 1000,
  village: { x: 500, y: 500, r: 480, roles: [] },
  circles: [
    circleAt("garden", 500, 200),
    circleAt("kitchen", 800, 500),
    circleAt("water", 500, 800),
    circleAt("seeds", 520, 220, 2),
  ],
};
const circles = [
  { id: "garden", parentCircleId: null },
  { id: "kitchen", parentCircleId: null },
  { id: "water", parentCircleId: null },
  { id: "seeds", parentCircleId: "garden" },
];

const draw = (hearths: Parameters<typeof HearthLens>[0]["hearths"], maxDepth?: number) =>
  render(
    <svg>
      <HearthLens layout={layout} circles={circles} relations={[]} hearths={hearths} maxDepth={maxDepth} />
    </svg>,
  ).container;

describe("the circles map's hearths", () => {
  it("glows at every circle and joins the three siblings in a ring", () => {
    motion(false);
    const c = draw(null);
    expect(c.querySelectorAll("[data-hearth]")).toHaveLength(4);
    expect(c.querySelectorAll("[data-thread]")).toHaveLength(3);
    expect(c.querySelectorAll("[data-firefly]")).toHaveLength(0);
  });

  it("lights only the hearths the server named, and warms the ones that meet today", () => {
    motion(false);
    const c = draw([
      { circleId: "garden", meetsToday: true, lights: 3 },
      { circleId: "water", meetsToday: true, lights: 0 },
    ]);
    const garden = c.querySelector('[data-hearth="garden"]')!;
    expect(garden.getAttribute("data-meets-today")).toBe("true");
    expect(garden.querySelectorAll("[data-firefly]")).toHaveLength(3);
    expect(c.querySelector('[data-hearth="water"]')!.getAttribute("data-meets-today")).toBe("true");
    expect(c.querySelector('[data-hearth="water"]')!.querySelectorAll("[data-firefly]")).toHaveLength(0);
    expect(c.querySelector('[data-hearth="kitchen"]')!.getAttribute("data-meets-today")).toBe("false");
    expect(c.querySelectorAll("[data-firefly]")).toHaveLength(3);
  });

  it("is decoration only: hidden from assistive tech, nothing focusable, no words", () => {
    motion(false);
    const c = draw([{ circleId: "garden", meetsToday: true, lights: 8 }]);
    const layer = c.querySelector("[data-hearths]")!;
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.querySelectorAll("[tabindex], a, button, text, title")).toHaveLength(0);
    expect(layer.textContent).toBe("");
  });

  it("draws no hearth deeper than the phone is drawing", () => {
    motion(false);
    const c = draw([{ circleId: "seeds", meetsToday: true, lights: 2 }], 1);
    expect(c.querySelector('[data-hearth="seeds"]')).toBeNull();
    expect(c.querySelectorAll("[data-firefly]")).toHaveLength(0);
  });

  it("keeps the same lights in the same places under reduced motion, still", () => {
    motion(true);
    const still = draw([{ circleId: "garden", meetsToday: true, lights: 5 }]);
    expect(still.querySelector("[data-hearths]")!.getAttribute("data-motion")).toBe("still");
    const spotsStill = Array.from(still.querySelectorAll(".hl-ff-dot")).map((d) => `${d.getAttribute("cx")},${d.getAttribute("cy")}`);
    cleanup();
    motion(false);
    const live = draw([{ circleId: "garden", meetsToday: true, lights: 5 }]);
    expect(live.querySelector("[data-hearths]")!.getAttribute("data-motion")).toBe("live");
    const spotsLive = Array.from(live.querySelectorAll(".hl-ff-dot")).map((d) => `${d.getAttribute("cx")},${d.getAttribute("cy")}`);
    expect(spotsStill).toHaveLength(5);
    expect(spotsStill).toEqual(spotsLive);
  });
});
