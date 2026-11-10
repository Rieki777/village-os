/**
 * AGE BANDS, never birth dates (build days S5, spec R10; Rye 2026-11-09).
 *
 * No quest has an age limit unless the village turns minimum ages on (Rye,
 * 2026-11-09; Amora ships with them off). When they are on, a quest may ask 16
 * or 18, and to check it the village needs to know only which side of 16 and
 * 18 a member is on, so that is all it keeps.
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

/**
 * The ages a quest may ask, once the village turns minimum ages on: the two a
 * band can answer. A minimum of 12 could never be checked against "under 16".
 */
export const MINIMUM_AGE_CHOICES = [16, 18] as const;

export function isMinimumAgeChoice(v: unknown): v is (typeof MINIMUM_AGE_CHOICES)[number] {
  return typeof v === "number" && (MINIMUM_AGE_CHOICES as readonly number[]).includes(v);
}

/** The village setting that lets a quest ask a minimum age. Off as shipped. */
export const MINIMUM_AGES_VARIABLE = "quest.minimum_ages";

/**
 * The minimum age a quest actually asks: none while the village has minimum
 * ages off (Rye, 2026-11-09: families are encouraged), else the quest's own
 * minimum, else none. Being hands-on adds no age of its own.
 */
export function effectiveMinAge(safety: { physical: boolean; minAge: number | null } | null, minimumAgesOn: boolean): number | null {
  if (!minimumAgesOn || !safety) return null;
  return isMinimumAgeChoice(safety.minAge) ? safety.minAge : null;
}
