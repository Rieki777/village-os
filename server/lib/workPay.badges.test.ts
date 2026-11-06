/**
 * A badge that multiplies a piece of work's pay is named on its card (Rye,
 * 2026-10-30: every quest and role shows its full pay before you take it on).
 * What is proved here is that the card never names a multiplier the payment
 * would not apply: only the work's own lines, only a factor above 1, never
 * Gratitude, and never past the ceiling a badge may carry.
 */
import { describe, expect, it } from "vitest";
import type { WorkPay } from "../../shared/workValue";
import { withPayBadges } from "./workPay";

const pay = (over: Partial<WorkPay> = {}): WorkPay => ({
  value: null,
  lines: [
    { token: "village-voice", name: "Village Voice", amount: 5, voice: true },
    { token: "village-credit", name: "Village Credits", amount: 40 },
  ],
  source: "own",
  cadence: "once",
  ...over,
});

describe("withPayBadges", () => {
  it("names each badge beside the line it multiplies", () => {
    const out = withPayBadges(pay(), [{ name: "Builder", multipliers: { "village-voice": 2 } }]);
    expect(out.badges).toEqual([{ badge: "Builder", token: "village-voice", name: "Village Voice", factor: 2 }]);
  });

  it("leaves off a token the work does not pay, a factor of 1, and Gratitude", () => {
    const out = withPayBadges(pay(), [
      { name: "Gardener", multipliers: { "stay-credit": 2 } },
      { name: "Plain", multipliers: { "village-credit": 1 } },
      { name: "Thanks", multipliers: { gratitude: 3 } },
    ]);
    expect(out.badges).toEqual([]);
  });

  it("never reads a factor past the ceiling a badge may carry", () => {
    const out = withPayBadges(pay(), [{ name: "Loud", multipliers: { "village-credit": 9 } }]);
    expect(out.badges?.[0]?.factor).toBe(3);
  });

  it("answers [] for work that pays no tokens, so absent and none stay different", () => {
    const out = withPayBadges(pay({ lines: [] }), [{ name: "Builder", multipliers: { "village-voice": 2 } }]);
    expect(out.badges).toEqual([]);
    expect(pay().badges).toBeUndefined();
  });
});
