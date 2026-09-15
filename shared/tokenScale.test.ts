/**
 * `finerThanScale`, THE ONE "TOO FINE" CHECK EVERY HUMAN-AMOUNT DOOR READS.
 *
 * Pure and DB-free on purpose: the redemption ask and the hand-mint route both
 * call it, and the hand-mint route used to `Math.trunc` instead, so a steward
 * minting 2.5 on a two-decimal token moved 2 and read "Minted". What is pinned
 * here is the arithmetic both doors now agree on.
 */
import { describe, expect, it } from "vitest";
import { finerThanScale } from "./tokenScale";

describe("finerThanScale", () => {
  it("accepts any amount the scale holds exactly", () => {
    expect(finerThanScale(2.5, 2)).toBe(false);
    expect(finerThanScale(0.01, 2)).toBe(false);
    expect(finerThanScale(60, 2)).toBe(false);
    expect(finerThanScale(60, 0)).toBe(false);
    // Binary noise at a real scale is not a finer amount: 0.1 * 100 is 10.000000000000002.
    expect(finerThanScale(0.1, 2)).toBe(false);
    expect(finerThanScale(12.29, 2)).toBe(false);
  });

  it("refuses an amount the scale would have to round", () => {
    expect(finerThanScale(2.5, 0)).toBe(true);
    expect(finerThanScale(0.005, 2)).toBe(true);
    expect(finerThanScale(1.234, 2)).toBe(true);
  });

  it("refuses what is not a number at all", () => {
    expect(finerThanScale(Number.NaN, 2)).toBe(true);
    expect(finerThanScale(Number.POSITIVE_INFINITY, 2)).toBe(true);
  });
});
