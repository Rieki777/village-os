/**
 * P3, REFERENCE CONTRIBUTIONS (Rye's pick, 2026-11-06; spec 3.10).
 *
 * Beside each suggestion, what the village actually set for similar past work:
 * the median set figure of the same kind and band, how many it is drawn from,
 * and over which dates. It never moves the suggestion. Conflicted records are
 * left out, and below five distinct setter and signer pairs it says plainly
 * that there are too few to compare yet.
 */
import { describe, expect, it } from "vitest";
import type { SettingRecord } from "./valuationSetting";
import { referenceOf } from "./valuationReference";

const rec = (setter: string, signer: string | null, setMinor: number, at: string, extra: Partial<SettingRecord> = {}): SettingRecord =>
  ({ category: "quest:general", suggestedMinor: 100000, setMinor, setterId: setter, signerId: signer, conflicted: false, eeHeld: false, at, ...extra }) as SettingRecord;

const VILLAGE = [
  rec("a", null, 90000, "2026-09-01T00:00:00Z"),
  rec("b", null, 100000, "2026-09-10T00:00:00Z"),
  rec("c", "x", 110000, "2026-09-20T00:00:00Z"),
  rec("d", null, 120000, "2026-10-01T00:00:00Z"),
  rec("e", "y", 130000, "2026-10-15T00:00:00Z"),
  rec("f", null, 400000, "2026-10-20T00:00:00Z", { category: "quest:skilled" }),
];

describe("what the village set for similar work", () => {
  it("gives the median set figure of the same kind and band, how many, and the dates", () => {
    expect(referenceOf(VILLAGE, "quest:general")).toEqual({
      category: "quest:general",
      enough: true,
      count: 5,
      pairs: 5,
      medianMinor: 110000,
      lowMinor: 90000,
      highMinor: 130000,
      from: "2026-09-01",
      to: "2026-10-15",
      words: "Similar work here was set at a median of 110000 over 5 settings, 2026-09-01 to 2026-10-15.",
    });
  });

  it("says there are too few to compare yet below five distinct pairs, and gives no figure", () => {
    const r = referenceOf(VILLAGE.slice(0, 4), "quest:general");
    expect(r.enough).toBe(false);
    expect(r.medianMinor).toBeNull();
    expect(r.words).toBe("Too few similar settings to compare yet.");
  });

  it("leaves out records where the setter or signer was paid by the work", () => {
    const poisoned = [...VILLAGE, rec("g", "h", 9000000, "2026-10-30T00:00:00Z", { conflicted: true })];
    expect(referenceOf(poisoned, "quest:general").medianMinor).toBe(110000);
  });

  it("names its money in the village's currency when a formatter is given", () => {
    const r = referenceOf(VILLAGE, "quest:general", { money: (m) => `₡${(m / 100).toLocaleString("en")}` });
    expect(r.words).toBe("Similar work here was set at a median of ₡1,100 over 5 settings, 2026-09-01 to 2026-10-15.");
  });
});
