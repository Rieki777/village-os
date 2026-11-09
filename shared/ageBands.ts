/**
 * AGE BANDS, never birth dates (build days S5, spec R10; Rye 2026-11-09).
 *
 * A physical build quest has a minimum age: 18, or 16 for light work beside a
 * named adult, never on machines or heights. To check it the village needs to
 * know only which side of 16 and 18 a member is on, so that is all it keeps.
 * The member says it once; a later change records who confirmed it.
 *
 * Personal data: read only by the member and the claim gate, wiped on
 * erasure, included in the member's own export.
 */

export const AGE_BANDS = ["under16", "16to17", "18plus"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export function isAgeBand(v: unknown): v is AgeBand {
  return typeof v === "string" && (AGE_BANDS as readonly string[]).includes(v);
}

/** The youngest age a band can mean. */
const BAND_FLOOR: Record<AgeBand, number> = { under16: 0, "16to17": 16, "18plus": 18 };

/** Whether a member in this band certainly meets a minimum age. */
export function bandMeets(band: AgeBand, minAge: number): boolean {
  return BAND_FLOOR[band] >= minAge;
}

/** The default minimum age for a physical quest that names none (Rye, 2026-11-09). */
export const PHYSICAL_MIN_AGE = 18;

/** The lowest a physical quest may set, and only for light work beside a named adult. */
export const LIGHT_WORK_MIN_AGE = 16;

/**
 * The minimum age a quest actually asks: its own, else 18 when it is physical,
 * else none. A physical quest can never ask below 16, whatever is stored.
 */
export function effectiveMinAge(safety: { physical: boolean; minAge: number | null } | null): number | null {
  if (!safety) return null;
  if (safety.minAge != null && Number.isFinite(safety.minAge)) {
    return safety.physical ? Math.max(LIGHT_WORK_MIN_AGE, safety.minAge) : safety.minAge;
  }
  return safety.physical ? PHYSICAL_MIN_AGE : null;
}
