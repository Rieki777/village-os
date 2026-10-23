/**
 * What a village calls its admission criteria, kept in ONE field.
 *
 * The audit of 2026-10-22 found the same document named five ways across the
 * guide pages (Criteria, Principles, Document, Membership Covenant, Good
 * Neighbor). The name now lives once, as the headline field at the top of the
 * Good Neighbor page (`page-good-neighbor`, section `hero`, field `name`), and
 * every page that names the criteria writes `{good-neighbor}` instead.
 *
 * This file is tiny on purpose: the Co-Creators Guide needs the NAME, and
 * importing the whole Good Neighbor spec would carry that page's words in the
 * guide's bundle.
 */
export const GOOD_NEIGHBOR_NAME_DEFAULT = "Good Neighbor Criteria";

/** The Good Neighbor page's spec id; its words are stored as `page-good-neighbor`. */
export const GOOD_NEIGHBOR_PAGE_ID = "good-neighbor";

/** The `{word}` a field writes to name the criteria. */
export const GOOD_NEIGHBOR_WORD = "good-neighbor";

/** The name a stored Good Neighbor page carries, or the default. Blank is not a name. */
export function goodNeighborNameFrom(stored: unknown): string {
  const hero =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>).hero
      : null;
  const name =
    hero && typeof hero === "object" && !Array.isArray(hero) ? (hero as Record<string, unknown>).name : null;
  return typeof name === "string" && name.trim() ? name : GOOD_NEIGHBOR_NAME_DEFAULT;
}
