/**
 * THE ONE PLACE MINOR UNITS BECOME THE NUMBER A MEMBER READS.
 *
 * `token_ledger.amount` and `token_balances.balance` are INTs, so a token with
 * decimals stores minor units: Village Voice rides in thousandths, and a
 * member who earned 10 Voice has 10000 on the row. Dividing is not a nicety.
 * A surface that prints the row prints 10000, and a member who is told they
 * hold ten thousand of something they earned ten of has been lied to by the
 * one page they came to trust.
 *
 * WHY THIS EXISTS BEFORE THE SCALE MOVES, AND NOT AS PART OF IT.
 *
 * This file was written under a ruling that every token would move to 4
 * decimals. That was CANCELLED on 2026-09-04 and replaced with a narrower one:
 * Village Credits goes from 0 to 2, and nothing else moves (docs/ECONOMICS.md
 * section 11). The argument survives the change intact and gets sharper, so it
 * is corrected here rather than deleted.
 *
 * Today exactly one token carries a scale, Village Voice at 3, so exactly one
 * number on one screen was wrong and it was wrong by 1000x. `credits` is the
 * token a room is priced in, the token members send each other and the token
 * the cycle pool pays out: the day it moves, most of the surfaces in the
 * product are wrong at once, with no single broken screen to point at. So the
 * dividing goes in first, on every surface, while there is still one token to
 * check it against. The ruling says the same thing in the other direction: the
 * display pass comes BEFORE the column change. Moving a token's scale after
 * that is a registry row and nothing else.
 *
 * A surface that renders a token amount calls `formatTokenAmount`. It does not
 * write its own division: two spellings of the same rule is how the profile
 * chip and the wallet came to disagree in the first place.
 *
 * `decimals` travels with the amount in the payload, per token, read live from
 * the registry. Nothing on the client hardcodes which token has how many.
 */

/**
 * Minor units to the number a member reads.
 *
 * FORMATTING RULE, one for every surface: a whole amount renders whole, and a
 * fractional one renders to its significant digits and no further. 10, not
 * 10.000. 0.125, not 0.13 and not 0.1250. "10.000 Voice" and "10 Voice" are
 * the same number and not the same sentence: the first reads like a price tag
 * on a thing that is not for sale, and Voice is not for sale.
 *
 * A token with no decimals is passed through untouched, so the gratitude and
 * stay-credit surfaces read exactly as they always have.
 */
export function formatTokenAmount(units: number, decimals: number): string {
  const n = Number(units) || 0;
  const d = Number(decimals) || 0;
  if (d <= 0) return String(Math.trunc(n));
  // toFixed first, then strip: dividing alone leaves binary noise (100 / 1000
  // is 0.1, but 1229 / 10000 is not always what a member would type).
  return (n / 10 ** d)
    .toFixed(d)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

/**
 * The decimals for one token out of a payload's `slug -> decimals` map.
 *
 * Absent means zero, which is what every token in the registry carried before
 * Voice and what an unregistered slug honestly means. It never guesses at a
 * token's scale from its name.
 */
/**
 * The inverse of `formatTokenAmount`: what a member TYPED, into what the ledger
 * stores. Mirrors the server's `toLedgerUnits` in server/lib/economy.ts, and
 * rounds for the same reason it does, because 0.1 * 1000 is not 100 in binary.
 *
 * THIS EXISTS BECAUSE HALF A FIX IS WORSE THAN NONE. The decimals sweep taught
 * the send card to DISPLAY a balance in human units and left its input posting
 * MINOR units to an endpoint that truncates and moves exactly that many. A
 * member holding 10000 saw "You hold 1", typed 1, and moved 0.0001. Before the
 * sweep the card said 10000 and the input took 10000: both wrong, and agreeing,
 * which is survivable in a way that disagreeing is not.
 */
export function toMinorUnits(typed: string | number, decimals: number): number {
  // An empty box is not a zero. `Number("")` is 0 and `Number(" ")` is 0, so a
  // plain finite check would turn a member who typed nothing into a member who
  // asked to send nothing, and this function is one call away from the ledger.
  if (typeof typed === "string" && typed.trim() === "") return NaN;
  const n = Number(typed);
  if (!Number.isFinite(n)) return NaN;
  const d = Number(decimals) || 0;
  return Math.round(n * 10 ** d);
}

/** The smallest amount a token can express, for an input's `min` and `step`. */
export function smallestUnit(decimals: number): number {
  const d = Number(decimals) || 0;
  // Divide by a whole power of ten. Never raise ten to a negative one.
  //
  // `10 ** -4` is 0.0001 on V8 25 and 0.00009999999999999999 on V8 22, because
  // the language only requires exponentiation to be implementation-APPROXIMATED.
  // IEEE 754 division IS correctly rounded, and `10 ** d` is an exact integer
  // for every decimals a token can carry, so this form lands on the same double
  // the literal 0.0001 parses to, on every engine.
  //
  // CI pins Node 22 and the dev boxes here run 25, so the broken form passes
  // locally and fails only in CI. It did. Line 47 above already divides.
  return d <= 0 ? 1 : 1 / 10 ** d;
}

export function decimalsOf(map: Record<string, number> | undefined | null, slug: string): number {
  return Number(map?.[slug] ?? 0) || 0;
}
