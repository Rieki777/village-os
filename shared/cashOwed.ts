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

/*
 * WHO PAYS CASH OUT, told to a signed-in member without `cash.pay` (E7,
 * 2026-10-31). The page printed the gate's bare code "auth_required" instead.
 * `keepers` are the roles with somebody live in them, each label already
 * carrying the holders' first names (`roleWithHolders`, Rye 2026-10-30: the
 * role first, the person in parentheses). A vacant role is left out, because
 * writing to it reaches nobody. With no keeper, the sentence points at admin,
 * which is true whether nobody holds the key or only a badge does.
 */

/** The machine code on that refusal. The sentence rides beside it as `message`. */
export const CASH_PAY_REQUIRED = "cash_pay_required";

/** "A", "A or B", "A, B or C". */
const orList = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;

/** The sentence a member without the key reads on the payout list. */
export function cashKeyRefusalWords(keepers: readonly string[]): string {
  const named = keepers.map((k) => k.trim()).filter((k) => k.length > 0);
  return named.length
    ? `Paying cash out is the work of ${orList(named)}. Write to them if you are waiting on a payment.`
    : "Paying cash out is the work of whoever holds the treasurer's key, or an admin. Ask an admin if you are waiting on a payment.";
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
