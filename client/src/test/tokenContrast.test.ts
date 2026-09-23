// @vitest-environment jsdom
/**
 * The comparator in tokenContrast.ts, at the borderline it exists to catch.
 *
 * It rounded the ratio to two decimals BEFORE comparing it with the floor, so
 * a pair at 4.4999:1 read as 4.50 and passed 4.5. On the Hypha cards that hid
 * one real failure (the amber card under seed #c9a227, style "field", at
 * 4.4994). These pairs sit a hair either side of each floor, measured by
 * shared/brandTokens.ts's contrastRatio, and are painted through the brand
 * overlay (`--tone-brand` is what `bg-teal-deep` resolves to), so the test
 * runs the same path a page does.
 */
import { afterEach, describe, expect, it } from "vitest";
import { contrastRatio } from "@shared/brandTokens";
import { describeFailures, measureText, shownRatio } from "./tokenContrast";

afterEach(() => {
  document.body.innerHTML = "";
});

/** White text with `textClasses` on a ground of `hex`, measured in light. */
function whiteOn(hex: string, textClasses: string) {
  const ground = document.createElement("div");
  ground.setAttribute("class", "bg-teal-deep");
  const p = document.createElement("p");
  p.setAttribute("class", `text-white ${textClasses}`);
  p.textContent = "A line of copy";
  ground.appendChild(p);
  document.body.appendChild(ground);
  const results = measureText(ground, "light", { "--tone-brand": hex });
  expect(results).toHaveLength(1);
  return results;
}

const JUST_UNDER_4_5 = "#297eab";
const JUST_OVER_4_5 = "#df3603";
const JUST_UNDER_3 = "#459cd8";

describe("tokenContrast compares the unrounded ratio with the floor", () => {
  it("the fixtures sit where this file says they do", () => {
    const under = contrastRatio("#ffffff", JUST_UNDER_4_5);
    expect(under).toBeLessThan(4.5);
    expect(under).toBeGreaterThan(4.4999);
    expect(contrastRatio("#ffffff", JUST_OVER_4_5)).toBeGreaterThanOrEqual(4.5);
    const under3 = contrastRatio("#ffffff", JUST_UNDER_3);
    expect(under3).toBeLessThan(3);
    expect(under3).toBeGreaterThan(2.9999);
  });

  it("fails body text at 4.4999:1 against a 4.5 floor", () => {
    const results = whiteOn(JUST_UNDER_4_5, "text-sm");
    expect(results[0].floor).toBe(4.5);
    expect(describeFailures(results)).toHaveLength(1);
  });

  it("fails large text at 2.9999:1 against a 3 floor", () => {
    const results = whiteOn(JUST_UNDER_3, "text-2xl");
    expect(results[0].floor).toBe(3);
    expect(describeFailures(results)).toHaveLength(1);
  });

  it("passes body text at 4.5001:1", () => {
    expect(describeFailures(whiteOn(JUST_OVER_4_5, "text-sm"))).toEqual([]);
  });

  it("never prints a failing ratio as meeting its floor", () => {
    const failures = describeFailures(whiteOn(JUST_UNDER_4_5, "text-sm"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("4.49:1 < 4.5:1");
    expect(shownRatio(4.49999)).toBe("4.49");
    expect(shownRatio(9.29)).toBe("9.29");
    expect(shownRatio(10.37)).toBe("10.37");
  });
});
