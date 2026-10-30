/**
 * WHAT LANDED FOR A MEMBER SINCE THEY LAST LOOKED (0289), as both ends read it.
 *
 * Rye, 2026-10-30, earnings idea 1: a reward moment each time something
 * lands. Tokens and Voice paid for work, and cash the village marked paid,
 * gathered into ONE moment however many arrived. Gratitude received is not
 * earnings and never appears here: it moves only by a member's send.
 */

/** One token a piece of work paid, in the ledger's own minor units. */
export interface RewardToken {
  token: string;
  name: string;
  units: number;
  decimals: number;
}

/**
 * One line of the moment: a piece of work and what it brought in.
 *
 * `earned` is tokens and Voice the ledger credited for that work, every token
 * of one payment on one line. `cash_paid` is a `cash_owed` row the village
 * marked paid.
 */
export type RewardLine =
  | { kind: "earned"; work: string; tokens: RewardToken[] }
  | { kind: "cash_paid"; work: string; amountMinor: number; currency: string };

export interface RewardMomentView {
  /** What to hand back to `POST /api/me/reward-moment/seen` once it is shown. */
  keys: string[];
  lines: RewardLine[];
}

/** The work credits a moment reads. Every other ledger source is not pay for work. */
export const REWARD_SOURCES = ["quest_consent", "role_cycle", "proposal_accepted"] as const;
export type RewardSource = (typeof REWARD_SOURCES)[number];

/** The most arrivals one moment gathers. Older ones wait for the next open. */
export const REWARD_MAX_ARRIVALS = 200;
