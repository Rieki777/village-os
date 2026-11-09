import { termEndAfter } from "./cycleClock";
import type { CycleClock } from "./cycleClock";

/** The term a renewal writes: the moon after the one this term ends in. PURE. */
export function nextMoonTermEnd(currentTermEndsAt: Date, clock: CycleClock): Date {
  return termEndAfter(currentTermEndsAt, 1, clock);
}

export const CARRY_ON_QUESTION = "Carry on into the next moon?";
export const CONTRIBUTION_MAX = 1000;
