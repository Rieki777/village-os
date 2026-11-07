/**
 * HOW MANY CHANGES ONE PROPOSAL MAY CARRY.
 *
 * Rye, 2026-11-06: the cap rises from 12 to 22, and it is easy to change per
 * village, as a governance dial the village moves by vote ("EVERYTHING can
 * change with the highest village vote"). The default, the floor and the
 * ceiling are written here, once, and both the dial's registry entry
 * (shared/gameVariables.ts) and the validator (server/lib/mechanics.ts) read
 * them, so the bound a village can store and the bound a proposal is checked
 * against can never disagree.
 *
 * The floor is 1 because a proposal changes at least one thing; a village that
 * sets 1 has chosen one change per proposal, which is its call. The ceiling is
 * 50 because a proposal is read before it is voted on, and past that size no
 * member reads the whole of it.
 */
export const CHANGE_SET_CAP_KEY = "governance.change_set_cap";
export const CHANGE_SET_CAP_DEFAULT = 22;
export const CHANGE_SET_CAP_MIN = 1;
export const CHANGE_SET_CAP_MAX = 50;

/**
 * The cap a stored or passed value means, always inside the floor and the
 * ceiling. Anything that is not a number reads as the default, so a damaged
 * row can neither lift the ceiling nor shut every proposal out.
 */
export function changeSetCapFrom(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) return CHANGE_SET_CAP_DEFAULT;
  return Math.min(CHANGE_SET_CAP_MAX, Math.max(CHANGE_SET_CAP_MIN, Math.trunc(n)));
}
