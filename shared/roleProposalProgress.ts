/**
 * How far a role-proposal draft has got, for the card on a member's profile.
 *
 * Three parts, in the order a person meets them: a role, their own words,
 * and a season. Terms can stay open on purpose, so they are not a part.
 * Pure: no clock, no pool.
 */

export const DRAFT_PARTS = 3;

export interface DraftFill {
  done: number;
  total: number;
  /** The sentence under the gold bar. */
  line: string;
}

export function draftFill(input: {
  roleCount: number;
  love?: string | null;
  offer?: string | null;
  why?: string | null;
  aim?: string | null;
  goalCount: number;
}): DraftFill {
  const roles = input.roleCount > 0;
  const words = [input.love, input.offer, input.why].some((s) => String(s ?? "").trim().length > 0);
  const season = String(input.aim ?? "").trim().length > 0 || input.goalCount > 0;
  const done = [roles, words, season].filter(Boolean).length;
  const line =
    done === 0
      ? "Nothing written yet"
      : done === DRAFT_PARTS
        ? "Roles, your words and your season are written"
        : `${done} of ${DRAFT_PARTS} parts written`;
  return { done, total: DRAFT_PARTS, line };
}
