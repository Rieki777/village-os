/**
 * P3, REFERENCE CONTRIBUTIONS (Rye's pick, 2026-11-06; spec 3.10).
 *
 * What the village actually set for similar past work, shown beside a
 * suggestion: the median set figure of the same kind and band, the spread, how
 * many settings it comes from and over which dates. It gives the setter a second
 * anchor that is not the engine (research 03, rec 11) and it never moves the
 * suggestion. Records where the setter or signer was paid by the work are left
 * out (QA G6), and below `minPairs` distinct setter and signer pairs it says
 * there are too few to compare, with no figure, so a small sample never reads
 * as the village's view.
 *
 * Pure.
 */
import { CALIBRATION_DEFAULTS, type SettingRecord } from "./valuationSetting";

export interface Reference {
  category: string;
  enough: boolean;
  count: number;
  pairs: number;
  medianMinor: number | null;
  lowMinor: number | null;
  highMinor: number | null;
  from: string | null;
  to: string | null;
  words: string;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export function referenceOf(
  records: readonly SettingRecord[],
  category: string,
  opts: { minPairs?: number; money?: (minor: number) => string } = {},
): Reference {
  const minPairs = opts.minPairs ?? CALIBRATION_DEFAULTS.minPairs;
  const money = opts.money ?? ((m: number) => String(m));
  const rs = records.filter((r) => r.category === category && !r.conflicted);
  const pairs = new Set(rs.map((r) => `${r.setterId}:${r.signerId ?? "-"}`)).size;
  const enough = pairs >= minPairs && rs.length > 0;
  if (!enough) {
    return { category, enough: false, count: rs.length, pairs, medianMinor: null, lowMinor: null, highMinor: null, from: null, to: null, words: "Too few similar settings to compare yet." };
  }
  const figures = rs.map((r) => r.setMinor);
  const dates = rs.map((r) => String(r.at).slice(0, 10)).sort();
  const m = median(figures);
  const from = dates[0];
  const to = dates[dates.length - 1];
  return {
    category,
    enough: true,
    count: rs.length,
    pairs,
    medianMinor: m,
    lowMinor: Math.min(...figures),
    highMinor: Math.max(...figures),
    from,
    to,
    words: `Similar work here was set at a median of ${money(m)} over ${rs.length} settings, ${from} to ${to}.`,
  };
}
