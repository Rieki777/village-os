// @vitest-environment jsdom
/**
 * A circle's name, its "forming" caption, and what hover adds.
 *
 * These pin WHEN each text is drawn and that each one carries the halo, which
 * is the thing that makes it readable: measured on the live village's shape,
 * names on the map's translucent discs came out at 2.6 to 3.9 against the disc
 * and 5.5 and better against the halo. How readable they actually are is
 * measured in a real browser by scratchpad/map-label-scan.mjs; jsdom computes
 * no colours and could not tell.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CircleLabel, { haloWidth } from "./CircleLabel";
import type { PowerSeat } from "./types";

afterEach(cleanup);

const ROLES = [
  { id: "lead", circleId: "dev", seats: 2, holderCount: 1 },
  { id: "scribe", circleId: "dev", seats: 1, holderCount: 0 },
  { id: "elsewhere", circleId: "care", seats: 1, holderCount: 1 },
] as unknown as PowerSeat[];

function label(over: Partial<Parameters<typeof CircleLabel>[0]> = {}) {
  const props = {
    circleId: "dev",
    x: 100,
    labelTop: 50,
    label: { lines: ["Development", "Circle"], fontSize: 20, lineHeight: 23 },
    show: true,
    hovered: false,
    drop: false,
    forming: false,
    hasChildren: false,
    pxPerWorld: 0.5,
    morph: {},
    roles: ROLES,
    ...over,
  };
  const { container } = render(
    <svg>
      <CircleLabel {...props} />
    </svg>,
  );
  return container;
}

/** Every text this component draws, as the DOM has them. */
const texts = (c: Element) => Array.from(c.querySelectorAll("text"));

describe("a circle's name on the map", () => {
  it("draws the name in lines, and nothing else when nothing else is asked for", () => {
    const c = label();
    expect(texts(c)).toHaveLength(1);
    expect(Array.from(c.querySelectorAll("tspan")).map((t) => t.textContent)).toEqual(["Development", "Circle"]);
  });

  it("carries a halo on every text it draws, under the glyphs", () => {
    const c = label({ forming: true, hovered: true });
    const drawn = texts(c);
    expect(drawn).toHaveLength(3);
    for (const t of drawn) {
      const paintOrder = t.getAttribute("paint-order") ?? t.style.paintOrder;
      const stroke = t.getAttribute("stroke") ?? t.style.stroke;
      const width = parseFloat(t.getAttribute("stroke-width") ?? t.style.strokeWidth ?? "0");
      expect(paintOrder, t.textContent ?? "").toBe("stroke");
      expect(stroke, t.textContent ?? "").toContain("--background");
      expect(width, t.textContent ?? "").toBeGreaterThan(0);
    }
  });

  it("sizes the halo from the text, never a fixed width", () => {
    expect(haloWidth(20)).toBeCloseTo(3.2, 5);
    expect(haloWidth(40)).toBeCloseTo(6.4, 5);
    // A floor, so a tiny caption still has an outline rather than a hairline.
    expect(haloWidth(1)).toBe(1.5);
    // It rises with the text, which is the whole point of not fixing it.
    expect(haloWidth(40)).toBeGreaterThan(haloWidth(20));
  });

  it("says a circle is forming, in the same ink as its name", () => {
    const c = label({ forming: true });
    const caption = texts(c).find((t) => t.textContent === "forming");
    expect(caption).toBeTruthy();
    // Not `fill-muted-foreground`: on a forming circle's faded disc that ink
    // measured 1.6:1 live.
    expect(caption!.getAttribute("class")).toContain("fill-foreground");
  });

  it("adds the counts a reader weighs on hover, and only on hover", () => {
    expect(texts(label()).some((t) => /role/.test(t.textContent ?? ""))).toBe(false);
    const c = label({ hovered: true });
    expect(screen.getByText("2 roles, 2 open")).toBeTruthy();
  });

  it("draws nothing of the circle's own when a promoted label is dropped", () => {
    const c = label({ drop: true, forming: true });
    expect(texts(c)).toHaveLength(0);
    // Hover still answers, because that is the reader asking.
    const h = label({ drop: true, hovered: true });
    expect(texts(h)).toHaveLength(1);
  });

  it("draws the name for a circle the camera is not naming only while hovered", () => {
    expect(texts(label({ show: false }))).toHaveLength(0);
    expect(texts(label({ show: false, hovered: true }))).toHaveLength(2);
  });
});
