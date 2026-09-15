/**
 * THE TWO SCALES, AND THE ONE FLOOR THAT DECIDES WHETHER WANING REACHES ANYBODY.
 *
 * Rye ruled the scale on 2026-09-04: two decimals on the tokens a village
 * spends, prices and redeems, whole numbers for everything else, and Village
 * Voice at two rather than the three it carried. This module is the single home
 * for both numbers so that a display and an input cannot be handed different
 * ones. `server/lib/economy.ts` re-exports `VOICE_DECIMALS` from here, and every
 * client surface reads the same constant through `@shared/tokenScale`.
 *
 * WHY VOICE KEEPS DECIMALS, WHICH IS THE OPPOSITE OF THE INTUITION. Voice is
 * always issued in whole units, so it looks like the token that least needs a
 * scale. It is the only one that WANES. `decayVoice` computes each member's
 * share with `decayUnits` below, which floors, and skips the member entirely
 * when the answer is zero. At whole numbers and the default one percent, a
 * member holding anything under a hundred Voice never wanes at all, and nothing
 * reports it, because skipping is the ordinary path for a member with nothing to
 * lose. The decay ruling would sit in the settings, be displayed, and do
 * nothing. At two decimals one percent works down to a single whole Voice.
 *
 * WHY VOICE DROPS FROM THREE TO TWO. Every money defect this codebase shipped in
 * the last day came from a scale mismatch, and the worst were invisible because
 * Voice was the ONLY token carrying a scale, so a bug that shows on one token
 * keeps shipping. Two distinct scales instead of three is fewer places a display
 * and an input can disagree.
 */

/**
 * Tokens a village spends, prices, redeems or trades. Every one of them is
 * `kind: "credit"`: `isPriceableToken` and `redeemableToken` in
 * `server/lib/spending.ts` and `server/lib/redemption.ts` both narrow to that
 * kind, and `tradingProblem` in `server/lib/exchange.ts` refuses every other
 * kind by name. So "currency-like" is not a judgement call here, it is a column.
 */
export const CURRENCY_DECIMALS = 2;

/**
 * Village Voice. Two, for the waning reason in this file's header, and NOT
 * because Voice is currency-like: it can never be a price, can never be bought
 * or swapped, and is not redeemable.
 */
export const VOICE_DECIMALS = 2;

/** Recognition, and every Hypha-governed mirror. Whole units. */
export const WHOLE_UNITS = 0;

/**
 * ONE WHOLE TOKEN, IN MINOR UNITS.
 *
 * `10 ** decimals` and never `10 ** -decimals`. Node 22 and Node 25 disagree
 * about the negative exponent (CI pins 22 and this machine runs 25), and the
 * disagreement is silent. Divide by this; never multiply by its reciprocal.
 */
export function minorPerWhole(decimals: number): number {
  return 10 ** Math.max(0, Math.trunc(decimals));
}

/**
 * IS THIS HUMAN AMOUNT FINER THAN THE TOKEN CAN HOLD?
 *
 * Converting to minor units rounds, deliberately (0.1 * 1000 is not 100 in
 * binary), so a route that converts and posts would silently move 2 when a
 * person asked for 1.5 at whole units, or 2 when a steward typed 2.5 on a route
 * that truncated first. Converting and converting back is the cheap exact
 * test. True means refuse, in words, and move nothing.
 *
 * ONE CHECK FOR EVERY HUMAN-AMOUNT DOOR. The redemption ask wrote it inline
 * first; the hand-mint route truncated instead and said "Minted". Both read
 * this now, so the two doors cannot disagree about what "too fine" means.
 */
export function finerThanScale(human: number, decimals: number): boolean {
  const n = Number(human);
  if (!Number.isFinite(n)) return true;
  const per = minorPerWhole(decimals);
  return Math.round(n * per) / per !== n;
}

/**
 * THE ENGINE'S OWN FLOOR. `decayVoice` calls this and nothing else, so the
 * sentence a village reads beside the dial and the arithmetic that takes their
 * Voice are the same function and cannot drift apart.
 *
 * Minor units in, minor units out. Zero means this member wanes nothing this
 * cycle, which is the case the whole scale ruling turns on.
 */
export function decayUnits(balanceMinorUnits: number, pct: number): number {
  return Math.floor((balanceMinorUnits * pct) / 100);
}

/**
 * The smallest balance, in MINOR units, that `pct` actually reaches.
 *
 * Solved against `decayUnits` itself and never by rearranging it algebraically.
 * The division inside it is floating point, so an exact solution can land a unit
 * either side of the truth; walking the last step through the real function is
 * what makes the two agree by construction. Returns 0 when nothing wanes at all.
 */
export function decayFloorMinorUnits(pct: number): number {
  if (!(pct > 0)) return 0;
  let units = Math.max(1, Math.ceil(100 / pct));
  while (units > 1 && decayUnits(units - 1, pct) >= 1) units -= 1;
  while (decayUnits(units, pct) < 1) units += 1;
  return units;
}

/**
 * More Voice than a village plausibly holds.
 *
 * Voice accrues a few units per member per moon through seats and quest
 * payouts, so a member reaching a million whole Voice is not a village this
 * dial is being tuned for. Past this line the sentence beside the dial says
 * plainly that the setting reaches nobody, because printing a large number
 * without comment is what lets a village believe a rate is working.
 */
export const IMPLAUSIBLE_WHOLE_VOICE = 1_000_000;

export interface DecayReach {
  /** No waning at all: the rate is zero. */
  none: boolean;
  /** Every member holding any Voice at all wanes something. */
  everyHolder: boolean;
  /** Past what any village plausibly holds, so this rate reaches nobody. */
  implausible: boolean;
  /** The smallest WHOLE number of Voice this rate reaches. */
  wholeTokens: number;
}

/**
 * What a village is entitled to know before it votes a waning rate: the
 * smallest balance the rate it is looking at actually moves.
 *
 * Stated in WHOLE tokens, because a member reading hundredths learns nothing.
 * Computed from the live percentage, so it moves when the dial moves.
 */
export function decayReach(pct: number, decimals: number = VOICE_DECIMALS): DecayReach {
  const floorUnits = decayFloorMinorUnits(pct);
  if (floorUnits === 0) return { none: true, everyHolder: false, implausible: false, wholeTokens: 0 };
  const perWhole = minorPerWhole(decimals);
  const wholeTokens = Math.ceil(floorUnits / perWhole);
  return {
    none: false,
    everyHolder: floorUnits <= 1,
    implausible: wholeTokens > IMPLAUSIBLE_WHOLE_VOICE,
    wholeTokens,
  };
}

/**
 * The sentence itself, so the wording has one home and a test can read it.
 *
 * A statement of fact and never a refusal: the standing ruling is that a warning
 * never blocks, and this is one step below a warning. It is what the number the
 * village is about to vote on actually does.
 */
export function decayReachSentence(pct: number, tokenName: string, decimals: number = VOICE_DECIMALS): string {
  const reach = decayReach(pct, decimals);
  if (reach.none) return `Nothing wanes at 0 percent.`;
  if (reach.implausible) {
    return (
      `At this rate the smallest balance that wanes anything is more ${tokenName} than anyone in this ` +
      `village is likely to hold, so this setting would reach nobody.`
    );
  }
  if (reach.everyHolder) return `At this rate every member holding any ${tokenName} at all wanes something.`;
  if (reach.wholeTokens === 1) return `At this rate a member wanes something once they hold 1 whole ${tokenName}.`;
  return `At this rate a member wanes nothing until they hold ${reach.wholeTokens} whole ${tokenName}.`;
}
