/**
 * Seat fees: a gathering that asks for the village's credits, and the refund
 * discipline that makes asking honest.
 *
 * A gathering carries `seat_price` and `seat_token` (0092). Zero means free,
 * which is what every gathering was before this existed and what most will
 * stay. When a price is set, taking a PLACE takes the fee into escrow and
 * giving the place up returns it.
 *
 * ── PAYING FOR A QUEUE POSITION IS DELIBERATE ────────────────────────────────
 *
 * `promoteWaitlist` writes a `going` answer with nobody present. If the fee
 * were taken at the moment a seat is granted, the queue would silently bill
 * people when their turn came, from inside a transaction that cannot post to
 * the ledger anyway. So a PLACE is charged, and a place is either a seat or a
 * position in the queue. You pay when you take your place, promotion moves no
 * money because the money is already held, and you get it back whole if the
 * place never becomes a seat.
 *
 * ── THE REFUND IS THE FEATURE ────────────────────────────────────────────────
 *
 * Every exit refunds: withdrawing, answering something other than `going`,
 * leaving the queue, the gathering being cancelled, the gathering being
 * deleted. Each one is idempotent twice over, and both layers are load-bearing:
 *
 *   1. AN ATOMIC CLAIM on the charge row decides the terminal exactly once
 *      (`WHERE id = ? AND status = 'held'`). A second caller loses the claim
 *      and repairs from what is stored instead of deciding again. This is the
 *      shape `settleLoan` uses in the library, for the same reason.
 *   2. A KEYED LEDGER LEG. The claim winner still has to post, and a crash
 *      between claim and post leaves money in escrow with a row that says
 *      released. The repair path re-posts the identical key, which the UNIQUE
 *      index turns into a no-op when it already landed and into the missing
 *      refund when it did not.
 *
 * So a retry never pays twice, and never keeps money for a seat nobody got.
 *
 * ── WHERE THE MONEY SITS ─────────────────────────────────────────────────────
 *
 *   take a place   mem:guest        → sys:event-escrow   (event_seat_fee)
 *   give it up     sys:event-escrow → mem:guest          (event_seat_refund)
 *   it happened    sys:event-escrow → sys:treasury       (event_seat_kept)
 *
 * `sys:event-escrow` is NOT a faucet, so it can only ever pay out what
 * somebody paid in. A refund that would drive it negative is refused by the
 * ledger, which is the property that makes "provably funded" true instead of
 * asserted.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { TREASURY, memberAccount, postTransfer, tokenDef } from "./ledger";
import { EVENT_ESCROW } from "./spending";

export interface SeatPrice {
  tokenType: string;
  amount: number;
}

export interface SeatChargeRow {
  id: string;
  eventId: string;
  userId: string;
  occurrenceKey: string;
  tokenType: string;
  amount: number;
  status: "held" | "released" | "kept";
  chargeSeq: number;
}

const newId = () => `sc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Ledger keys for one attempt on one place. Derived, never typed twice: the
 * failed-actions report imports this to ask whether a kept fee's transfer
 * landed, so the key format keeps one home.
 */
export function keysFor(row: { eventId: string; occurrenceKey: string; userId: string; chargeSeq: number }) {
  const place = `seat:${row.eventId}:${row.occurrenceKey || "-"}:${row.userId}:${row.chargeSeq}`;
  return { pay: `${place}:pay`, refund: `${place}:refund`, keep: `${place}:keep` };
}

function toRow(r: RowDataPacket): SeatChargeRow {
  return {
    id: String(r.id),
    eventId: String(r.event_id),
    userId: String(r.user_id),
    occurrenceKey: String(r.occurrence_key ?? ""),
    tokenType: String(r.token_type),
    amount: Number(r.amount),
    status: r.status,
    chargeSeq: Number(r.charge_seq ?? 1),
  };
}

/**
 * What this gathering asks for a place, or null when it is free.
 *
 * A price with no token, or a token that has since been retired from the
 * registry, reads as FREE. Refusing every RSVP because an admin half-filled a
 * form would close a calendar over a typo, and an unregistered token cannot be
 * posted anyway.
 */
export async function seatPriceFor(pool: Pool | PoolConnection, eventId: string): Promise<SeatPrice | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT seat_price, seat_token FROM events WHERE id = ?",
    [eventId],
  );
  if (!rows[0]) return null;
  const amount = Math.max(0, Math.trunc(Number(rows[0].seat_price ?? 0)));
  const tokenType = String(rows[0].seat_token ?? "");
  if (amount <= 0 || !tokenType) return null;
  if (!tokenDef(tokenType)) return null;
  return { tokenType, amount };
}

export async function seatChargeFor(
  pool: Pool,
  eventId: string,
  userId: string,
  occurrenceKey: string,
): Promise<SeatChargeRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM event_seat_charges WHERE event_id = ? AND user_id = ? AND occurrence_key = ?",
    [eventId, userId, occurrenceKey],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export type ChargeResult =
  | { ok: true; charged: number; tokenType: string | null; duplicate: boolean }
  | { ok: false; error: string };

/**
 * Take the fee for a place, or do nothing when the gathering is free.
 *
 * Returns `ok` with `charged: 0` for a free gathering and for a place that is
 * already paid for, so every caller can treat it the same way.
 *
 * On a refused post NOTHING is left behind: a row born for this attempt is
 * deleted and a reused row is put back exactly as it was. A charge row that
 * survives is a charge that provably landed, which is what lets the escrow
 * reconciliation compare the two sides and mean something.
 */
export async function chargeForPlace(
  pool: Pool,
  eventId: string,
  userId: string,
  occurrenceKey: string,
  description: string,
): Promise<ChargeResult> {
  const price = await seatPriceFor(pool, eventId);
  if (!price) return { ok: true, charged: 0, tokenType: null, duplicate: false };

  // Claim the place's charge row under a row lock, so two taps cannot both
  // decide they are the first attempt and both spend a sequence number.
  const conn = await pool.getConnection();
  let claimed: SeatChargeRow;
  let wasNew = false;
  let previous: SeatChargeRow | null = null;
  try {
    await conn.beginTransaction();
    const [existingRows] = await conn.query<RowDataPacket[]>(
      "SELECT * FROM event_seat_charges WHERE event_id = ? AND user_id = ? AND occurrence_key = ? FOR UPDATE",
      [eventId, userId, occurrenceKey],
    );
    const existing = existingRows[0] ? toRow(existingRows[0]) : null;
    if (existing?.status === "held") {
      await conn.commit();
      return { ok: true, charged: existing.amount, tokenType: existing.tokenType, duplicate: true };
    }
    if (existing) {
      previous = existing;
      const seq = existing.chargeSeq + 1;
      await conn.query( // module-review-ok: event_seat_charges' one enumerable home (the ballots.ts pattern; no cache sits above it)
        "UPDATE event_seat_charges SET status = 'held', charge_seq = ?, token_type = ?, amount = ?, settled_at = NULL WHERE id = ?",
        [seq, price.tokenType, price.amount, existing.id],
      );
      claimed = { ...existing, status: "held", chargeSeq: seq, tokenType: price.tokenType, amount: price.amount };
    } else {
      const id = newId();
      await conn.query( // module-review-ok: event_seat_charges' one enumerable home (the ballots.ts pattern; no cache sits above it)
        "INSERT INTO event_seat_charges (id, event_id, user_id, occurrence_key, token_type, amount, status, charge_seq) " +
          "VALUES (?,?,?,?,?,?, 'held', 1)",
        [id, eventId, userId, occurrenceKey, price.tokenType, price.amount],
      );
      wasNew = true;
      claimed = {
        id, eventId, userId, occurrenceKey,
        tokenType: price.tokenType, amount: price.amount, status: "held", chargeSeq: 1,
      };
    }
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch { /* already gone */ }
    throw e;
  } finally {
    conn.release();
  }

  const undo = async () => {
    if (wasNew) {
      await pool.query("DELETE FROM event_seat_charges WHERE id = ? AND status = 'held'", [claimed.id]); // module-review-ok: event_seat_charges' one enumerable home (the ballots.ts pattern; no cache sits above it)
    } else if (previous) {
      await pool.query( // module-review-ok: event_seat_charges' one enumerable home (the ballots.ts pattern; no cache sits above it)
        "UPDATE event_seat_charges SET status = ?, charge_seq = ?, token_type = ?, amount = ?, settled_at = ? WHERE id = ? AND status = 'held'",
        [previous.status, previous.chargeSeq, previous.tokenType, previous.amount, new Date(), claimed.id],
      );
    }
  };

  let result;
  try {
    result = await postTransfer(pool, {
      from: memberAccount(userId),
      to: EVENT_ESCROW,
      tokenType: claimed.tokenType,
      amount: claimed.amount,
      source: "event_seat_fee",
      sourceRef: eventId,
      description: description.slice(0, 255),
      idempotencyKey: keysFor(claimed).pay,
    });
  } catch (e) {
    // A THROWN post (deadlock, dropped connection) took nothing, so it gets
    // the same compensation a refused one gets. Rethrow after, because the
    // compensation must never swallow the reason.
    await undo();
    throw e;
  }
  if (!result.ok) {
    await undo();
    const name = tokenDef(claimed.tokenType)?.name ?? claimed.tokenType;
    return { ok: false, error: `This one asks for ${claimed.amount} ${name} and your balance does not cover it` };
  }
  return { ok: true, charged: claimed.amount, tokenType: claimed.tokenType, duplicate: result.duplicate };
}

export interface RefundResult {
  refunded: number;
  tokenType: string | null;
  /** True when this call lost the claim and only repaired. */
  alreadySettled: boolean;
}

/**
 * Give a place's fee back. Safe to call when nothing was ever taken.
 *
 * The claim decides once; the keyed leg posts whether or not this caller won
 * it, because the loser's job is to finish a winner that may have crashed
 * between the two. The UNIQUE index makes the second post a no-op.
 */
export async function refundPlace(
  pool: Pool,
  eventId: string,
  userId: string,
  occurrenceKey: string,
  reason: string,
): Promise<RefundResult> {
  const existing = await seatChargeFor(pool, eventId, userId, occurrenceKey);
  if (!existing) return { refunded: 0, tokenType: null, alreadySettled: false };
  if (existing.status === "kept") {
    // The gathering already happened and the village has it. Withdrawing an
    // answer afterwards is bookkeeping, never a claw-back out of the treasury.
    return { refunded: 0, tokenType: existing.tokenType, alreadySettled: true };
  }

  const [claim] = await pool.query<any>(
    "UPDATE event_seat_charges SET status = 'released', settled_at = NOW() WHERE id = ? AND status = 'held'",
    [existing.id],
  );
  const won = Number((claim as any)?.affectedRows ?? 0) > 0;

  const r = await postTransfer(pool, {
    from: EVENT_ESCROW,
    to: memberAccount(userId),
    tokenType: existing.tokenType,
    amount: existing.amount,
    source: "event_seat_refund",
    sourceRef: eventId,
    description: reason.slice(0, 255),
    idempotencyKey: keysFor(existing).refund,
  });
  if (!r.ok) {
    // Escrow cannot pay what it never received. That is the crash window the
    // charge path compensates for, so it should be unreachable; if it is
    // reached, say so loudly and leave the row claimed rather than inventing
    // money out of a non-faucet account.
    console.error(`[seats] refund refused for ${existing.id}: ${r.error}`);
    return { refunded: 0, tokenType: existing.tokenType, alreadySettled: !won };
  }
  return { refunded: r.duplicate ? 0 : existing.amount, tokenType: existing.tokenType, alreadySettled: !won };
}

/**
 * Refund every place still holding a fee on this gathering, optionally on one
 * evening only. The cancel and delete paths both come through here.
 */
export async function refundAllPlaces(
  pool: Pool,
  eventId: string,
  reason: string,
  occurrenceKey?: string,
): Promise<{ refunded: number; people: number }> {
  const params: any[] = [eventId];
  let occ = "";
  if (occurrenceKey !== undefined) { occ = " AND occurrence_key = ?"; params.push(occurrenceKey); }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM event_seat_charges WHERE event_id = ? AND status = 'held'${occ}`,
    params,
  );
  let refunded = 0;
  let people = 0;
  for (const raw of rows) {
    const row = toRow(raw);
    const r = await refundPlace(pool, row.eventId, row.userId, row.occurrenceKey, reason);
    if (r.refunded > 0) { refunded += r.refunded; people += 1; }
  }
  return { refunded, people };
}

/**
 * The gathering happened, so the village keeps the fees.
 *
 * Without this the escrow only ever grows and a host is never paid, which is a
 * dead end of its own shape. A gathering is over when its end time has passed
 * (or its start, when nobody set an end), and only a gathering that was still
 * on can have happened: a cancelled one refunded at the moment it was
 * cancelled.
 *
 * The grace hours exist so a host who cancels an hour late still cancels into
 * a refund instead of into a treasury transfer.
 */
export async function settleFinishedSeats(
  pool: Pool,
  opts: { now?: Date; graceHours?: number } = {},
): Promise<{ settled: number; amount: number }> {
  const grace = Math.max(0, Math.floor(opts.graceHours ?? 24));
  const now = opts.now ?? new Date();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT c.* FROM event_seat_charges c JOIN events e ON e.id = c.event_id " +
      "WHERE c.status = 'held' AND e.removed_at IS NULL AND e.status IN ('scheduled','postponed') " +
      "AND COALESCE(e.ends_at, e.starts_at) < (? - INTERVAL ? HOUR)",
    [now, grace],
  );
  let settled = 0;
  let amount = 0;
  for (const raw of rows) {
    const row = toRow(raw);
    const [claim] = await pool.query<any>(
      "UPDATE event_seat_charges SET status = 'kept', settled_at = NOW() WHERE id = ? AND status = 'held'",
      [row.id],
    );
    const r = await postTransfer(pool, {
      from: EVENT_ESCROW,
      to: TREASURY,
      tokenType: row.tokenType,
      amount: row.amount,
      source: "event_seat_kept",
      sourceRef: row.eventId,
      description: "Seat fee, gathering held",
      idempotencyKey: keysFor(row).keep,
    });
    if (r.ok && !r.duplicate && Number((claim as any)?.affectedRows ?? 0) > 0) {
      settled += 1;
      amount += row.amount;
    }
  }
  return { settled, amount };
}

/**
 * Value the events module is holding on members' behalf. `openStateCheck`
 * refuses to switch a module off while this is above zero, which is the rule
 * that stops a village turning the calendar off with everyone's credits inside
 * it.
 */
export async function heldSeatValue(pool: Pool): Promise<{ count: number; amount: number }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM event_seat_charges WHERE status = 'held'",
  );
  return { count: Number(rows[0]?.n ?? 0), amount: Number(rows[0]?.total ?? 0) };
}

/**
 * Does the escrow account hold exactly what the open charges say it should,
 * per token? The library proves the same thing about its own escrow, and it is
 * the one check that catches a posting path which skipped the discipline.
 */
export async function seatEscrowDrift(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT c.token_type, COALESCE(SUM(c.amount), 0) AS expected, COALESCE(b.balance, 0) AS actual " +
      "FROM event_seat_charges c LEFT JOIN token_balances b " +
      "ON b.account_id = ? AND b.token_type = c.token_type " +
      "WHERE c.status = 'held' GROUP BY c.token_type, b.balance",
    [EVENT_ESCROW],
  );
  const problems: string[] = [];
  for (const r of rows) {
    if (Number(r.expected) !== Number(r.actual)) {
      problems.push(
        `seat escrow drift for "${r.token_type}": held charges total ${r.expected}, ${EVENT_ESCROW} holds ${r.actual}`,
      );
    }
  }
  return problems;
}
