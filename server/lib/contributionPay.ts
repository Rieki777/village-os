/**
 * WHICH LEDGER MOVEMENTS COUNT AS THE VILLAGE PAYING SOMEBODY FOR WHAT THEY
 * BROUGHT IT.
 *
 * Contributor is the rung the village pays you onto (Rye, 2026-09-08). Time,
 * money, skills, knowledge and resources all count the same, spending never
 * demotes, and a gift from a neighbour is not a wage.
 *
 * The first version of the rule asked only WHO paid (anybody but a member) and
 * WHAT (anything but recognition), and that was not enough. A guest who bought
 * ten stay credits with a card had been "paid by the village" by that test,
 * became a Contributor, and booked their own room at the member price. The
 * loop test caught it in the stays section. Buying your own night is not
 * bringing the village anything.
 *
 * So the question is also WHY the tokens moved, and the ledger already records
 * that as `source`. This table answers it for every source the server writes.
 *
 * ── AN ALLOWLIST, SO A NEW SOURCE FAILS CLOSED ──────────────────────────────
 *
 * A source missing from this table does not count. A new way of paying people
 * promotes nobody until somebody decides it should, which is the safe direction
 * for a rung that opens `member.vouch`, and a steward can name a contributor by
 * hand in the meantime. `contributionPay.test.ts` scans the server for sources
 * this table has never heard of, so the decision is asked for in review and not
 * discovered later as a membrane nobody can get through.
 *
 * An entry for a source this checkout does not write yet is harmless, which is
 * why the economics branch's sources are already here: it no longer matters
 * which of the two lands first.
 *
 * ── THE JUDGEMENT CALLS, SAID OUT LOUD ──────────────────────────────────────
 *
 * `exchange_purchase` COUNTS: buying a village token with money is investing,
 * and Rye put money on the same footing as every other contribution.
 * `stay_purchase` and `product_grant` DO NOT: they buy the buyer a night or a
 * product. `admin_mint` COUNTS: it is a steward deliberately granting tokens to
 * a person, behind a co-sign threshold. `library_intake` COUNTS: an item brought
 * into the shared library is a resource contributed. `library_manual` DOES NOT:
 * it is a keeper's adjustment, not an award for anything brought.
 * `circle_treasury_spend` COUNTS: a circle paying a member out of its treasury,
 * and the spend refuses unless it names who is paid. The movements that stock,
 * return or sweep a circle's treasury DO NOT, because no person is paid by
 * them; counting the bonus that stocks a treasury as well would count one
 * payment twice.
 */
export const LEDGER_SOURCE_PAYS_A_CONTRIBUTION: Readonly<Record<string, boolean>> = {
  // The village paying for work, a seat, a stake, an idea or a resource.
  quest_consent: true,
  quest_stay_reward: true,
  role_cycle: true,
  gratitude_pool: true,
  proposal_accepted: true,
  library_intake: true,
  exchange_purchase: true,
  admin_mint: true,
  circle_treasury_spend: true,

  // Buying something for yourself.
  stay_purchase: false,
  product_grant: false,
  // Hospitality and corrections.
  stay_comp: false,
  stay_manual_override: false,
  library_manual: false,
  payment_reversal: false,
  reversal: false,
  // Spending, burning, escrow, holds, fees and refunds.
  stay_night: false,
  library_burn: false,
  library_escrow: false,
  library_fee: false,
  library_release: false,
  event_seat_fee: false,
  event_seat_refund: false,
  event_seat_kept: false,
  exit_settlement: false,
  redemption_hold: false,
  redemption_burn: false,
  // Trading what you already hold, and stocking the treasury.
  exchange_swap: false,
  exchange_stock: false,
  // A circle's treasury being stocked, returned or swept. Nobody is paid.
  circle_cap_bonus: false,
  circle_treasury_fund: false,
  circle_treasury_return: false,
  circle_treasury_dormant: false,
  // Between members, and recognition.
  member_send: false,
  gratitude_received: false,
  heart_received: false,
  // Voice on its way to Hypha, or waning.
  voice_claim: false,
  voice_claim_settled: false,
  voice_decay: false,
};

/** The sources that count, for the one query that asks. */
export function contributionSources(): string[] {
  return Object.keys(LEDGER_SOURCE_PAYS_A_CONTRIBUTION).filter((source) => LEDGER_SOURCE_PAYS_A_CONTRIBUTION[source]);
}
