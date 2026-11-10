import { termEndAfter } from "./cycleClock";
import type { CycleClock } from "./cycleClock";

/** The term a renewal writes: the moon after the one this term ends in. PURE. */
export function nextMoonTermEnd(currentTermEndsAt: Date, clock: CycleClock): Date {
  return termEndAfter(currentTermEndsAt, 1, clock);
}

export const CARRY_ON_QUESTION = "Carry on into the next moon?";
export const CONTRIBUTION_MAX = 1000;

/**
 * A term this short, from its start to its end, is a moon term (D34). Two
 * cycles are never under 58 days, so 40 days holds one moon on either clock.
 */
export const MOON_TERM_MAX_DAYS = 40;

export function isMoonTerm(startedAt: Date | null | undefined, termEndsAt: Date | null | undefined): boolean {
  if (!startedAt || !termEndsAt) return false;
  return termEndsAt.getTime() - startedAt.getTime() <= MOON_TERM_MAX_DAYS * 86_400_000;
}
