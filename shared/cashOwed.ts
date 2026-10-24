/**
 * THE CASH A VILLAGE OWES ITS MEMBERS (0285), as both ends read it.
 *
 * Rye, 2026-10-23: "The Game wouldn't pay cash, but it would say what they are
 * owed and they can claim it when they're paid out so that the treasurer has a
 * record to check when sending or giving cash payments."
 *
 * A row moves one way: owed when the work is paid in tokens, claimed by the
 * member when the village pays out, paid when whoever holds `cash.pay` has
 * sent the money and says how. The platform moves no money at any step.
 */

export type CashWorkKind = "quest" | "role" | "proposal";
export type CashOwedState = "owed" | "claimed" | "paid";

/** One owed amount, as the member it is owed to reads it. */
export interface CashOwedEntry {
  id: string;
  workKind: CashWorkKind;
  workRef: string;
  /** The work's title when the cash became owed, so a rename never changes the record. */
  workTitle: string;
  amountMinor: number;
  currency: string;
  state: CashOwedState;
  owedAt: string;
  claimedAt: string | null;
  paidAt: string | null;
  /** How it was paid, in the treasurer's words. */
  paidNote: string | null;
}

/** One row on the treasurer's list, with the names joined at read. */
export interface CashQueueEntry extends CashOwedEntry {
  userId: string;
  memberName: string;
  paidByName: string | null;
}

/** The longest note a payment may carry (varchar 500). */
export const CASH_PAID_NOTE_MAX = 500;

export const CASH_STATE_WORDS: Record<CashOwedState, string> = {
  owed: "Owed to you",
  claimed: "Claimed, waiting to be paid",
  paid: "Paid",
};

export const CASH_WORK_WORDS: Record<CashWorkKind, string> = {
  quest: "Quest",
  role: "Role",
  proposal: "Proposal",
};
