import { describe, expect, it } from "vitest";
import { MIN_GROUP, evennessOf, voiceSpread } from "./voiceSpread";

const many = (n: number, v: number) => Array.from({ length: n }, () => v);

describe("voiceSpread", () => {
  it("shows the share each top group holds, in whole percents", () => {
    // 20 voters: the top 2 hold 50 each, the next 3 hold 20 each, 15 hold 2 each. Total 190.
    const s = voiceSpread([50, 50, 20, 20, 20, ...many(15, 2)]);
    // Top 10% is 2 voters, under MIN_GROUP: withheld, never shown.
    expect(s.bands).toEqual([
      { topPct: 25, sharePct: Math.round(((100 + 60) / 190) * 100) },
      { topPct: 50, sharePct: Math.round(((100 + 60 + 10) / 190) * 100) },
    ]);
    expect(s.withheld).toBe(true);
    expect(s.voters).toBe(20);
    expect(s.anyVoice).toBe(true);
  });

  it("names nobody: in a village of eight, every group would be one or two people, so nothing is shown", () => {
    const s = voiceSpread([90, 1, 1, 1, 1, 1, 1, 1]);
    // 10% and 25% of 8 are 1 and 2 people; 50% is 4 with 4 outside, which is allowed.
    expect(s.bands.map((b) => b.topPct)).toEqual([50]);
    expect(s.withheld).toBe(true);
  });

  it("shows nothing for a village of one, or of five", () => {
    for (const n of [1, 5]) {
      const s = voiceSpread(many(n, 10));
      expect(s.bands, `n=${n}`).toEqual([]);
      expect(s.evenness, `n=${n}`).toBeNull();
      expect(s.withheld, `n=${n}`).toBe(true);
    }
  });

  it("all Voice in one member reads as concentrated, and that member's share is never a band of one", () => {
    const s = voiceSpread([500, ...many(29, 0)]);
    expect(s.bands.every((b) => b.sharePct === 100)).toBe(true);
    expect(s.bands.map((b) => b.topPct)).toEqual([10, 25, 50]);
    expect(s.evenness).toBe("concentrated");
  });

  it("an equal village reads as even, and each group holds its own size", () => {
    const s = voiceSpread(many(40, 7));
    expect(s.bands).toEqual([
      { topPct: 10, sharePct: 10 },
      { topPct: 25, sharePct: 25 },
      { topPct: 50, sharePct: 50 },
    ]);
    expect(s.evenness).toBe("even");
  });

  it("with no Voice anywhere there is no spread to draw", () => {
    expect(voiceSpread(many(12, 0))).toEqual({ voters: 12, anyVoice: false, bands: [], withheld: false, evenness: null });
    expect(voiceSpread([])).toEqual({ voters: 0, anyVoice: false, bands: [], withheld: false, evenness: null });
  });

  it("reads a negative or unreadable balance as zero", () => {
    const s = voiceSpread([10, 10, 10, -50, Number.NaN, 10, 10, 10]);
    expect(s.voters).toBe(8);
    expect(s.bands).toEqual([{ topPct: 50, sharePct: 67 }]);
  });

  it("every shown group, and the rest, hold at least MIN_GROUP voters", () => {
    for (let n = 1; n <= 60; n += 1) {
      for (const b of voiceSpread(many(n, 1)).bands) {
        const k = Math.max(1, Math.round((n * b.topPct) / 100));
        expect(k, `n=${n} top ${b.topPct}%`).toBeGreaterThanOrEqual(MIN_GROUP);
        expect(n - k, `n=${n} top ${b.topPct}%`).toBeGreaterThanOrEqual(MIN_GROUP);
      }
    }
  });

  it("words the Gini in three steps", () => {
    expect(evennessOf(0)).toBe("even");
    expect(evennessOf(0.34)).toBe("even");
    expect(evennessOf(0.35)).toBe("leaning");
    expect(evennessOf(0.6)).toBe("concentrated");
  });
});
