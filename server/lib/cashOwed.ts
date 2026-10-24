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
  cashOwedRowsFor,
  insertCashOwedRow,
  markCashOwedPaidRow,
  recentlyPaidCashRows,
  seatsOnCashRoles,
  unpaidCashRows,
} from "../repos/cashOwed";
import { CASH_PAID_NOTE_MAX, type CashOwedEntry, type CashWorkKind } from "../../shared/cashOwed";
import { readWorkValue, readWorkValueInput, type WorkValue } from "../../shared/workValue";

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

/** The treasurer's list: everything unpaid, then the recent payments. */
export async function cashQueue(pool: Pool): Promise<{ unpaid: Array<CashOwedEntry & { userId: string; paidBy: string | null }>; paid: Array<CashOwedEntry & { userId: string; paidBy: string | null }> }> {
  const withOwner = (r: RowDataPacket) => ({ ...rowToCashEntry(r), userId: String(r.user_id), paidBy: r.paid_by ? String(r.paid_by) : null });
  const [unpaid, paid] = await Promise.all([unpaidCashRows(pool, 500), recentlyPaidCashRows(pool, 100)]);
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
