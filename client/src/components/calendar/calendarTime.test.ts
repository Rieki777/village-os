/**
 * A GATHERING'S DOT IS THE NIGHT WORLD'S GOLD (batch 157, C3 Q4), the same
 * `notice` token the moon spiral rings a gathering day with, and a colour a
 * row brings with it still wins.
 */
import { describe, expect, it } from "vitest";
import { GATHERING_DOT, kindColour } from "./calendarTime";

/** WCAG relative luminance of a #rrggbb colour. */
function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("the gathering dot", () => {
  it("takes the notice token, the gold the spiral rings a gathering with", () => {
    expect(kindColour({ kind: "gathering", colour: null } as never)).toBe(GATHERING_DOT);
    expect(GATHERING_DOT).toMatch(/^var\(--color-notice, #[0-9a-f]{6}\)$/);
  });

  it("reads on the night ground and the night panel, as a mark wants (3:1)", () => {
    const fallback = /#[0-9a-f]{6}/.exec(GATHERING_DOT)![0];
    expect(contrast(fallback, "#0d1411")).toBeGreaterThanOrEqual(3);
    expect(contrast(fallback, "#16221c")).toBeGreaterThanOrEqual(3);
  });

  it("keeps a row's own colour", () => {
    expect(kindColour({ kind: "gathering", colour: "#123456" } as never)).toBe("#123456");
  });
});
