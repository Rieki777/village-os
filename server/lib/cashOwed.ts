/**
 * THE CASH A VILLAGE OWES, AND THE RECORD OF PAYING IT (0285).
 *
 * Rye, 2026-10-23: "roles and quests and more can be paid in cash, tokens
 * (equity, credits, etc), and voice (governance)", and: "The Game wouldn't pay
 * cash, but it would say what they are owed and they can claim it when they're
 * paid out so that the treasurer has a record to check when sending or giving
 * cash payments."
 *
 * So nothing here moves money and nothing here touches the ledger. Fiat flows
 * in only. What this file does is write down, at the moment a piece of work is
 * paid in tokens, the cash the village now owes for it, and then carry that
 * row through the member's claim and the treasurer's "paid".
 *
 * THE THREE MOMENTS CASH BECOMES OWED, each the same moment the work's tokens
 * are paid, and each keyed so a retry writes nothing new:
 *
 *   a quest      at consent, on the consent's own connection, inside the
 *                commit that flips the claim (server/routes/questClaims.ts),
 *                keyed on the claim
 *   a role       when a cycle settles (`runSettlement`, server/lib/economy.ts),
 *                to every live seat on a role that states cash, keyed on the
 *                cycle, the seat and the member, the same three things the
 *                role's token key carries
 *   a proposal   when a Work With Us proposal is accepted and its payment goes
 *                through (`applyAcceptReward`, server/index.ts), at the amount
 *                the steward typed on accepting it, keyed on the submission
 *
 * A badge multiplier never touches cash. The ruling attaches a multiplier to a
 * token (2026-10-23), and cash is not one.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  claimCashOwedRow,
  cashOwedIdForOccurrence,
  cashOwedRowById,
  cashOwedRowsByIds,
  cashOwedRowsFor,
  allCashRows,
  payCashRowsTogether,
  insertCashOwedRow,
  markCashOwedPaidRow,
  recentlyPaidCashRows,
  seatsOnCashRoles,
  unpaidCashRows,
} from "../repos/cashOwed";
import {
  CASH_PAID_NOTE_MAX,
  CASH_REFERENCE_MAX,
  CASH_TRANSFER_MAX_LINES,
  cashTotalsByCurrency,
  cashTransferNote,
  type CashOwedEntry,
  type CashQueueEntry,
  type CashWorkKind,
} from "../../shared/cashOwed";
import { readWorkValue, readWorkValueInput, type WorkValue } from "../../shared/workValue";
import { exponentOf } from "../../shared/money";

const newId = () => `cash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/*
 * Each segment is encoded, so an id that carries a colon can never move the
 * boundary between two segments and collide with another occurrence. That
 * defect shipped once in the ledger's own keys (docs/ECONOMICS.md, 10.16).
 */
const seg = (s: string) => encodeURIComponent(String(s));

export const cashKeys = {
  quest: (claimId: string) => `quest:${seg(claimId)}`,
  role: (cycleKey: string, seatId: string, userId: string) => `role:${seg(cycleKey)}:${seg(seatId)}:${seg(userId)}`,
  proposal: (submissionId: string) => `proposal:${seg(submissionId)}`,
};

interface OweInput {
  occurrenceKey: string;
  userId: string;
  workKind: CashWorkKind;
  workRef: string;
  workTitle: string;
  cash: WorkValue | null;
}

/**
 * Write down one owed amount. Returns true when this call recorded it, false
 * when there was nothing to owe or the occurrence was already recorded.
 */
async function owe(db: Pool | PoolConnection, p: OweInput): Promise<boolean> {
  const cash = p.cash ? readWorkValue(p.cash.minor, p.cash.currency) : null;
  if (!cash || cash.minor <= 0) return false;
  const id = newId();
  await insertCashOwedRow(db, {
    id,
    occurrenceKey: p.occurrenceKey,
    userId: p.userId,
    workKind: p.workKind,
    workRef: p.workRef,
    workTitle: (String(p.workTitle ?? "").trim() || p.workRef).slice(0, 255),
    amountMinor: cash.minor,
    currency: cash.currency,
  });
  // Whether THIS call wrote it: the id that holds the occurrence is ours.
  return (await cashOwedIdForOccurrence(db, p.occurrenceKey)) === id;
}

/** A consented quest owes its cash to the claimant, once per claim. */
export async function oweQuestCash(
  db: Pool | PoolConnection,
  p: { claimId: string; userId: string; questId: string; questTitle: string; cash: WorkValue | null },
): Promise<boolean> {
  return owe(db, {
    occurrenceKey: cashKeys.quest(p.claimId),
    userId: p.userId,
    workKind: "quest",
    workRef: p.questId,
    workTitle: p.questTitle,
    cash: p.cash,
  });
}

/**
 * A settled cycle owes each live seat on a cash-paying role its cash, once per
 * cycle, seat and member. Runs before the token rules are read, because a
 * village with no `role.cycle` rule at all can still pay its roles in cash.
 * Returns how many new rows it wrote.
 */
export async function oweRoleCycleCash(pool: Pool, cycleKey: string): Promise<number> {
  let written = 0;
  for (const seat of await seatsOnCashRoles(pool)) {
    const recorded = await owe(pool, {
      occurrenceKey: cashKeys.role(cycleKey, String(seat.seat_id), String(seat.user_id)),
      userId: String(seat.user_id),
      workKind: "role",
      workRef: String(seat.role_id),
      workTitle: `${String(seat.role_name ?? seat.role_id)}, ${cycleKey}`,
      cash: readWorkValue(seat.cash_minor, seat.cash_currency),
    });
    if (recorded) written++;
  }
  return written;
}

/**
 * The cash a steward typed on accepting a proposal, checked the way a quest's
 * cash is (`readWorkValueInput`) and stamped with the village's currency.
 * Absent, empty or zero is no cash.
 */
export function statedProposalCash(raw: unknown, currency: string): { ok: true; cash: WorkValue | null } | { ok: false; error: string } {
  const read = readWorkValueInput({ cashMinor: raw === undefined ? null : raw }, () => null);
  if (!read.ok) return { ok: false, error: read.error };
  return { ok: true, cash: read.cashMinor ? { minor: read.cashMinor, currency } : null };
}

/** An accepted proposal owes the cash the steward stated when accepting it. */
export async function oweProposalCash(
  pool: Pool,
  p: { submissionId: string; userId: string; title: string; cash: WorkValue | null },
): Promise<boolean> {
  return owe(pool, {
    occurrenceKey: cashKeys.proposal(p.submissionId),
    userId: p.userId,
    workKind: "proposal",
    workRef: p.submissionId,
    workTitle: p.title,
    cash: p.cash,
  });
}

const iso = (v: unknown): string | null => (v ? new Date(v as any).toISOString() : null);

export function rowToCashEntry(r: RowDataPacket): CashOwedEntry {
  return {
    id: String(r.id),
    workKind: r.work_kind,
    workRef: String(r.work_ref),
    workTitle: String(r.work_title),
    amountMinor: Number(r.amount_minor),
    currency: String(r.currency),
    state: r.state,
    owedAt: iso(r.owed_at)!,
    claimedAt: iso(r.claimed_at),
    paidAt: iso(r.paid_at),
    paidNote: r.paid_note ?? null,
  };
}

/** What one member is or was owed, newest first. */
export async function cashOwedFor(pool: Pool, userId: string): Promise<CashOwedEntry[]> {
  return (await cashOwedRowsFor(pool, userId, 200)).map(rowToCashEntry);
}

export type CashStep = { ok: true } | { ok: false; status: number; error: string };

/** A member claims their own owed row, saying they are ready to be paid. */
export async function claimCash(pool: Pool, userId: string, id: string): Promise<CashStep> {
  const res = await claimCashOwedRow(pool, id, userId);
  if (res.affectedRows === 1) return { ok: true };
  const row = await cashOwedRowById(pool, id);
  // Somebody else's row reads exactly like a row that does not exist.
  if (!row || String(row.user_id) !== userId) return { ok: false, status: 404, error: "No cash owed to you with that id." };
  return {
    ok: false,
    status: 409,
    error: row.state === "paid" ? "This has already been paid." : "This is already claimed, and waiting to be paid.",
  };
}

const withOwner = (r: RowDataPacket) => ({ ...rowToCashEntry(r), userId: String(r.user_id), paidBy: r.paid_by ? String(r.paid_by) : null });

/** The treasurer's list: everything unpaid, then the recent payments (100, or more for the Admin history). */
export async function cashQueue(pool: Pool, paidLimit = 100): Promise<{ unpaid: Array<CashOwedEntry & { userId: string; paidBy: string | null }>; paid: Array<CashOwedEntry & { userId: string; paidBy: string | null }> }> {
  const [unpaid, paid] = await Promise.all([unpaidCashRows(pool, 500), recentlyPaidCashRows(pool, paidLimit)]);
  return { unpaid: unpaid.map(withOwner), paid: paid.map(withOwner) };
}

/**
 * Mark a row paid, with how it was paid. The note is required: a payment with
 * no stated method is not a record anybody can check, which is `closeBallot`'s
 * rule for an outcome note and redemption's rule for a confirmation.
 */
export async function markCashPaid(
  pool: Pool,
  id: string,
  byUserId: string,
  rawNote: unknown,
): Promise<{ ok: true; entry: CashOwedEntry & { userId: string } } | { ok: false; status: number; error: string }> {
  const note = String(rawNote ?? "").trim();
  if (!note) return { ok: false, status: 400, error: "Say how it was paid, so the record can be checked later." };
  if (note.length > CASH_PAID_NOTE_MAX) {
    return { ok: false, status: 400, error: `A payment note is at most ${CASH_PAID_NOTE_MAX} characters.` };
  }
  const row = await cashOwedRowById(pool, id);
  if (!row) return { ok: false, status: 404, error: "No cash owed with that id." };
  // The witness rule `canConfirm` holds for consent, held here too: the
  // record is only worth checking if the person it pays did not write it.
  if (String(row.user_id) === byUserId) {
    return { ok: false, status: 409, error: "Someone else marks your own cash paid. Ask another holder." };
  }
  const res = await markCashOwedPaidRow(pool, id, byUserId, note);
  if (res.affectedRows !== 1) return { ok: false, status: 409, error: "This has already been paid." };
  const paid = await cashOwedRowById(pool, id);
  return { ok: true, entry: { ...rowToCashEntry(paid!), userId: String(paid!.user_id) } };
}

export type CashTransferResult =
  | { ok: true; userId: string; entries: CashOwedEntry[]; note: string }
  | { ok: false; status: number; error: string; code?: "already_paid" | "raced" };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * RECORD ONE BANK TRANSFER to one member: some or all of their unpaid lines
 * become paid together, with the transfer date and reference in the note
 * (Rye, 2026-10-30). The amounts are the amounts on the rows. Nothing here
 * takes an amount from the request, so a transfer can never edit one.
 *
 * PAYING A LINE TWICE IS IMPOSSIBLE, at two levels. Before writing, a line
 * that is already paid refuses the whole transfer by name (409
 * `already_paid`), so a second press of Confirm is a clear refusal that pays
 * nothing. And the write itself is one compare-and-set transaction
 * (`payCashRowsTogether`): when two holders submit at once, the second
 * matches fewer rows than it asked for, rolls back, and is refused (409
 * `raced`).
 */
export async function recordCashTransfer(
  pool: Pool,
  byUserId: string,
  body: unknown,
  now: Date = new Date(),
): Promise<CashTransferResult> {
  const b = (body ?? {}) as Record<string, unknown>;
  const userId = typeof b.userId === "string" ? b.userId.trim() : "";
  if (!userId) return { ok: false, status: 400, error: "Say which member this transfer paid." };
  const rawIds = Array.isArray(b.ids) ? b.ids : [];
  const ids = Array.from(new Set(rawIds.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())));
  if (ids.length === 0 || ids.length !== rawIds.length) {
    return { ok: false, status: 400, error: "Pick at least one line, each once, for this transfer." };
  }
  if (ids.length > CASH_TRANSFER_MAX_LINES) {
    return { ok: false, status: 400, error: `One transfer pays at most ${CASH_TRANSFER_MAX_LINES} lines.` };
  }
  const transferDate = typeof b.transferDate === "string" ? b.transferDate.trim() : "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(transferDate) ? new Date(`${transferDate}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== transferDate) {
    return { ok: false, status: 400, error: "Give the day the transfer went out, as a date." };
  }
  // A day of slack for time zones ahead of the server's.
  if (parsed.getTime() > now.getTime() + DAY_MS) {
    return { ok: false, status: 400, error: "A transfer is recorded once it has gone out, so its date cannot be in the future." };
  }
  const reference = typeof b.reference === "string" ? b.reference.trim() : "";
  if (!reference) return { ok: false, status: 400, error: "Give the bank reference, or a note on how it was paid, so the record can be checked later." };
  if (reference.length > CASH_REFERENCE_MAX) {
    return { ok: false, status: 400, error: `A reference is at most ${CASH_REFERENCE_MAX} characters.` };
  }
  // The witness rule `markCashPaid` holds: the person paid never writes the record.
  if (userId === byUserId) {
    return { ok: false, status: 409, error: "Someone else records a transfer to you. Ask another holder." };
  }

  const rows = await cashOwedRowsByIds(pool, ids);
  if (rows.length !== ids.length || rows.some((r) => String(r.user_id) !== userId)) {
    return { ok: false, status: 400, error: "Every line in one transfer must be owed to that one member. Reload the list and pick again." };
  }
  const paidAlready = rows.filter((r) => r.state === "paid");
  if (paidAlready.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "already_paid",
      error: paidAlready.length === ids.length
        ? "These lines are already recorded as paid. Nothing was paid twice."
        : `${paidAlready.length} of these lines ${paidAlready.length === 1 ? "is" : "are"} already paid. Nothing was recorded. Reload and pick the rest.`,
    };
  }

  const note = cashTransferNote(transferDate, reference);
  if (note.length > CASH_PAID_NOTE_MAX) return { ok: false, status: 400, error: "That reference is too long to record." };
  const paid = await payCashRowsTogether(pool, ids, userId, byUserId, note);
  if (paid !== ids.length) {
    return {
      ok: false,
      status: 409,
      code: "raced",
      error: "Another holder recorded some of these lines a moment ago. Nothing was recorded. Reload the list.",
    };
  }
  const after = await cashOwedRowsByIds(pool, ids);
  return { ok: true, userId, entries: after.map(rowToCashEntry), note };
}

const CSV_COLUMNS = [
  "member", "member_id", "work_kind", "work", "amount", "amount_minor", "currency",
  "state", "owed_at", "claimed_at", "paid_recorded_at", "paid_by", "payment_note", "line_id",
] as const;

/** One CSV cell. Quoted always, and a leading formula character is defused for spreadsheets. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Major units as a plain decimal, so the accounts can sum the column. */
function majorAmount(minor: number, currency: string): string {
  const exp = exponentOf(currency);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  if (exp === 0) return `${sign}${abs}`;
  const unit = 10 ** exp;
  return `${sign}${Math.floor(abs / unit)}.${String(abs % unit).padStart(exp, "0")}`;
}

/** The accounts' export: every line, paid and unpaid, one row each. */
export function cashCsv(rows: ReadonlyArray<CashQueueEntry>): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push([
      r.memberName, r.userId, r.workKind, r.workTitle, majorAmount(r.amountMinor, r.currency), r.amountMinor, r.currency,
      r.state, r.owedAt, r.claimedAt, r.paidAt, r.paidByName, r.paidNote, r.id,
    ].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/*
 * A MEMBER'S OWN YEAR, FOR THEIR TAXES OR BOOKS (Rye, 2026-10-30: "a year
 * export of cash received, with dates and bank references").
 *
 * Paid lines only, filed under the year the payment was RECORDED (`paid_at`).
 * The day the money went out is the treasurer's word inside the note, and
 * nothing reads a date out of the note (the rule in shared/cashOwed.ts), so a
 * transfer sent on 30 December and recorded on 2 January files under the new
 * year with its real date printed beside it. A total per currency closes the
 * file; amounts in two currencies are never added together.
 */
const YEAR_COLUMNS = ["paid_recorded_on", "payment_note", "work_kind", "work", "amount", "amount_minor", "currency", "line_id"] as const;

/** One member's paid cash for one calendar year, oldest first, with a total row per currency. */
export function memberCashYearCsv(entries: ReadonlyArray<CashOwedEntry>, year: number): string {
  const paid = entries
    .filter((e) => e.state === "paid" && e.paidAt && new Date(e.paidAt).getUTCFullYear() === year)
    .sort((a, b) => String(a.paidAt).localeCompare(String(b.paidAt)) || a.id.localeCompare(b.id));
  const lines = [YEAR_COLUMNS.join(",")];
  for (const e of paid) {
    lines.push([
      String(e.paidAt).slice(0, 10), e.paidNote, e.workKind, e.workTitle,
      majorAmount(e.amountMinor, e.currency), e.amountMinor, e.currency, e.id,
    ].map(csvCell).join(","));
  }
  for (const t of cashTotalsByCurrency(paid)) {
    lines.push(["", `Total received in ${year}`, "", "", majorAmount(t.minor, t.currency), t.minor, t.currency, ""].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Every paid line a member has, for the year export. Not capped at the profile's 200. */
export async function paidCashFor(pool: Pool, userId: string): Promise<CashOwedEntry[]> {
  return (await cashOwedRowsFor(pool, userId, 10000)).map(rowToCashEntry).filter((e) => e.state === "paid");
}

/** Every line for the export, with the owner and payer ids still raw. */
export async function cashExportRows(pool: Pool, limit = 10000): Promise<Array<CashOwedEntry & { userId: string; paidBy: string | null }>> {
  return (await allCashRows(pool, limit)).map(withOwner);
}
