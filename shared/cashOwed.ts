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
  owed: "Owed",
  claimed: "Claimed, waiting to be paid",
  paid: "Paid",
};

export const CASH_WORK_WORDS: Record<CashWorkKind, string> = {
  quest: "Quest",
  role: "Role",
  proposal: "Proposal",
};

/*
 * CASH ON THE WAY OUT (round 4, finding R4-4), to Rye's ruling of 2026-10-23:
 * "a if b hasn't already happened". A leaver the village still owes cash stays
 * on as a former member who can claim later, exactly as one holding tokens
 * does, and deleting the account gives the cash up. The words below are what
 * the member reads before either door, and what the exit desk reads.
 *
 * Always a COUNT, never the amount or the work: the exit desk is read by
 * admins who may not hold `cash.pay`, and the line a resolve writes onto the
 * exit is kept after an erasure.
 */

/** Whether a row in this state is cash the village still owes. */
export function isUnpaidCash(state: CashOwedState): boolean {
  return state === "owed" || state === "claimed";
}

/** The count, as the member and the exit desk read it. */
export function cashStillOwedWords(count: number): string {
  return `${count} cash payment(s) the village still owes you`;
}

/** What leaving does with it, a sentence with no full stop so a list can add one: the departure keeps the account on, so the cash can still be paid. */
export const CASH_ON_DEPARTURE =
  "Leaving keeps you on as a former member, so you can still claim it and be paid";

/** What deleting does with it. */
export const CASH_ON_DELETION =
  "Deleting your account gives them up: once the account is gone there is nobody for the treasurer to pay";

/** The tick the delete panel shows, and the body field that carries it. Only an explicit true counts. */
export const CASH_GIVE_UP_FIELD = "giveUpCash";
export const CASH_GIVE_UP_LABEL = "I give up the cash the village still owes me.";
