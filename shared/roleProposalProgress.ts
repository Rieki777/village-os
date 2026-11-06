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

/**
 * Where a draft opens when this browser has no place stored for it: the first
 * part not yet written, in the order the page asks for them (your own words,
 * then roles, then your season). Null when nothing is written, so a fresh
 * draft keeps its welcome. Derived from the saved draft, so a new tab agrees.
 */
export function resumeAt(input: {
  roleCount: number;
  love?: string | null;
  offer?: string | null;
  why?: string | null;
  aim?: string | null;
  goalCount: number;
}): { front: "yours" | "steps"; step: "roles" | "season" | "terms" } | null {
  const fill = draftFill(input);
  if (fill.done === 0) return null;
  const words = [input.love, input.offer, input.why].some((s) => String(s ?? "").trim().length > 0);
  const season = String(input.aim ?? "").trim().length > 0 || input.goalCount > 0;
  if (!words) return { front: "yours", step: "roles" };
  if (input.roleCount === 0) return { front: "steps", step: "roles" };
  if (!season) return { front: "steps", step: "season" };
  return { front: "steps", step: "terms" };
}
