/**
 * A member's own Western signs, read in this browser at the step that reads
 * their Gene Keys chart, from the same birth date and town. Only the sign
 * numbers are sent (`PUT /api/gene-keys/me`); the date, time and town never
 * leave the device, as before.
 *
 * `spans` are the minutes after local midnight the birth could fall in: one
 * minute for an exact time, the window the member chose, or each part of the
 * day they named. Each span is read on its own (`natalSigns`), and a sign is
 * kept only when every span agrees on it, so a Moon that changed sign that day
 * is sent as not known rather than guessed.
 *
 * The rising sign changes about every two hours, so it is read only from an
 * exact birth time (one span of one minute) and the birth town's coordinates
 * (the GeoNames town list, CC BY 4.0). Otherwise it is sent as not known.
 */
import { natalSigns, risingSign, zonedToUtc } from "@shared/geneKeysSky";
import type { NatalSigns } from "@shared/geneKeys";

type Day = { year: number; month: number; day: number };

export function signsFor(
  day: Day,
  zone: string,
  spans: readonly (readonly [number, number])[],
  coords?: { lat: number | null; lon: number | null },
): NatalSigns {
  if (!spans.length) return { sun: null, moon: null, rising: null };
  const at = (m: number) => zonedToUtc(day.year, day.month, day.day, Math.floor(m / 60), m % 60, zone);
  const each = spans.map(([from, to]) => natalSigns([at(from), at(to)]));
  const agree = (k: "sun" | "moon") => (each.every((s) => s[k] !== null && s[k] === each[0][k]) ? each[0][k] : null);
  const exact = spans.length === 1 && spans[0][0] === spans[0][1];
  const rising = exact && coords?.lat != null && coords.lon != null ? risingSign(at(spans[0][0]), coords.lat, coords.lon) : null;
  return { sun: agree("sun"), moon: agree("moon"), rising };
}
