/**
 * THE ONE PLACE MINOR UNITS BECOME THE NUMBER A MEMBER READS.
 *
 * `token_ledger.amount` and `token_balances.balance` are INTs, so a token with
 * decimals stores minor units: Village Voice rides in hundredths, and a
 * member who earned 10 Voice has 1000 on the row. Dividing is not a nicety.
 * A surface that prints the row prints 1000, and a member who is told they
 * hold a thousand of something they earned ten of has been lied to by the
 * one page they came to trust.
 *
 * WHY THIS EXISTS AT ALL, AND WHY IT IS NOT ABOUT ONE TOKEN.
 *
 * Rye ruled the scale on 2026-09-04: two decimals on the tokens a village
 * spends, prices and redeems, whole numbers for everything else, and Village
 * Voice at two. `shared/tokenScale.ts` holds both numbers and the reasoning.
 * Four tokens carry a scale now and three do not, so a surface that prints the
 * row without dividing is wrong by a hundred on more than half of them.
 *
 * A scale-aware payload and ONE conversion helper are what stop a display and
 * an input disagreeing, and they do it at ANY scale. That is why this file is
 * not written against a particular number of decimals: a village that rescales
 * a token, or a fork that ships another one, changes a registry row and nothing
 * here.
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
 * A number that is ALREADY human, to the text a member reads. No division.
 *
 * `formatTokenAmount` is for a payload that carries minor units. Some routes
 * convert before they send (`fromLedgerUnits` in server/routes/redemption.ts,
 * `priceFromStored` in server/lib/stays.ts), and handing their number to
 * `formatTokenAmount` divides a second time: 50 credits held read as 0.5.
 * Handing it over at decimals 0 truncates instead: 12.5 read as 12. Both
 * shipped. This is the formatter for that kind of field.
 *
 * `decimals` only tidies. When the figure at the token's scale is the same
 * number (0.30000000000000004 at 2 is 0.3), that is what prints. When it is
 * not, the figure prints exactly as sent, because a human number is the truth
 * and this function never rounds it to a coarser scale. Omit `decimals` where
 * the payload carries none and the number still prints whole and true.
 *
 * Same formatting rule as `formatTokenAmount`: 10, not 10.00.
 */
export function formatHumanAmount(human: number, decimals?: number): string {
  const n = Number(human);
  if (!Number.isFinite(n)) return "0";
  const d = Math.min(20, Math.max(0, Number(decimals) || 0));
  const atScale = Number(n.toFixed(d));
  // Binary noise is a few ulps. A real fraction the scale cannot hold is not.
  const sameNumber = Math.abs(atScale - n) <= Number.EPSILON * 8 * Math.max(1, Math.abs(n));
  const shown = sameNumber ? atScale : n;
  return String(Object.is(shown, -0) ? 0 : shown);
}

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

/**
 * The decimals for one token out of a payload's `slug -> decimals` map.
 *
 * Absent means zero, which is what every token in the registry carried before
 * Voice and what an unregistered slug honestly means. It never guesses at a
 * token's scale from its name.
 */
export function decimalsOf(map: Record<string, number> | undefined | null, slug: string): number {
  return Number(map?.[slug] ?? 0) || 0;
}
