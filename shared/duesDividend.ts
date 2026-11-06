/**
 * WHAT A FLAT AMOUNT ON A ROLE RULE DOES, in the words the Mint panel shows
 * (item 13, 2026-11-01).
 *
 * Rye: "if this is turned on again it would be attached to those who are
 * paying members, so that each cycle they're paying membership dues they're
 * getting these tokens minted to them." Paid per member, once a cycle, role
 * or no role (the coordinator's reading of his words), and CARD DUES ONLY for
 * now (his ruling), which Admin says plainly. The engine's half is
 * `payDuesDividend` in server/lib/economy.ts.
 */

/** Said under every role rule on the Mint panel, whatever its amount. */
export const ROLE_FLAT_AMOUNT_EXPLAINED =
  "A flat amount here is paid once each cycle to every member whose membership dues were paid by card in that cycle, " +
  "whether or not they hold a role. Members who have not paid get nothing, and dues paid through Zeffy or by hand are not counted. " +
  "Leave it blank and each role is paid only what its own pay list names.";

/** A set flat amount on a role rule, as the line that states what it pays. */
export function flatRoleAmountLine(amountWords: string, tokenName: string): string {
  return `${amountWords} ${tokenName}, once a cycle, to each member whose dues were paid by card that cycle`;
}
