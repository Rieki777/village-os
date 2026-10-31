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
 * RECORDING ONE BANK TRANSFER (Rye, 2026-10-30): "when a bank transfer is sent
 * to pay out that role we redeem their cash credits." The treasurer picks some
 * or all of one member's unpaid lines, says when the transfer went out and its
 * reference, and every picked line becomes paid together or none does.
 *
 * NO NEW COLUMN. The transfer date and the reference are written into the
 * existing free-text `paid_note` (0285, varchar 500) in one fixed sentence,
 * and `paid_at` stays the moment the record was made. So the record says both
 * when the money went out (the treasurer's word) and when it was written down
 * (the server's clock), and nothing reads a date out of the note.
 */

/** The longest reference a transfer may carry, leaving room in the note for the sentence around it. */
export const CASH_REFERENCE_MAX = 400;

/** The most lines one transfer may pay. */
export const CASH_TRANSFER_MAX_LINES = 200;

/** What the client sends to record one transfer to one member. */
export interface CashTransferInput {
  userId: string;
  ids: string[];
  /** YYYY-MM-DD, the day the money went out. */
  transferDate: string;
  /** The bank reference, or a note saying how it was paid. */
  reference: string;
}

/** The note a recorded transfer writes on every line it pays. */
export function cashTransferNote(transferDate: string, reference: string): string {
  return `Bank transfer on ${transferDate}. Reference: ${reference}`;
}

/** The calendar years a member has any paid line in, newest first. */
export function cashYearsPaid(entries: ReadonlyArray<CashOwedEntry>): number[] {
  const years = new Set<number>();
  for (const e of entries) if (e.state === "paid" && e.paidAt) years.add(new Date(e.paidAt).getUTCFullYear());
  return Array.from(years).sort((a, b) => b - a);
}

/** Sum amounts per currency. Amounts in two currencies are never added together. */
export function cashTotalsByCurrency(rows: ReadonlyArray<{ amountMinor: number; currency: string }>): Array<{ currency: string; minor: number }> {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.currency, (sums.get(r.currency) ?? 0) + Number(r.amountMinor));
  return Array.from(sums.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([currency, minor]) => ({ currency, minor }));
}
