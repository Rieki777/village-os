/**
 * A member's places at the village's gatherings, read and given up when they
 * leave: their answers (`event_rsvps`), their queue places (`event_waitlist`),
 * the slots they took (`event_slot_signups`), and the fees on those places
 * that are not settled for good (`event_seat_charges`).
 *
 * "A member" is a person key: a user id, or `guest:<contactId>` for the seats
 * and queue places somebody held as a guest before they joined, which carry
 * no account and leave with the account all the same.
 *
 * The RULES live in server/lib/calendarCommunity.ts (`releasePlacesOf`): which
 * freed seat serves the queue, and which held fee comes back. This file is the
 * statements, so a table's readers stay enumerable in one known directory.
 *
 * Every read here is keyed on the one person, and every write is a DELETE keyed
 * on them, so a second run matches nothing. That is the erasure's idempotency
 * rule (server/lib/erasure.ts), kept by shape.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

/** One answer a member gave, with what decides whether its evening is still ahead. */
export interface HeldAnswer {
  eventId: string;
  occurrenceKey: string;
  status: string;
}

/** The gathering a place belongs to, as far as "is this evening still ahead" needs it. */
export interface PlaceGathering {
  startsAt: Date | null;
  endsAt: Date | null;
  recurrence: unknown;
}

/**
 * A fee on one of the member's places that is not settled for good: still in
 * escrow (`held`), or claimed for a refund (`released`) whose ledger leg may
 * not have landed. `chargeSeq` is what the leg's key is built from.
 */
export interface OpenCharge extends PlaceGathering {
  eventId: string;
  userId: string;
  occurrenceKey: string;
  chargeSeq: number;
  status: "held" | "released";
}

const dateOrNull = (v: unknown): Date | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
};

/** Every answer this member gave, past evenings included. */
export async function answersOf(pool: Pool, userId: string): Promise<HeldAnswer[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT event_id, occurrence_key, status FROM event_rsvps WHERE user_id = ? ORDER BY event_id, occurrence_key",
    [userId],
  );
  return rows.map((r) => ({
    eventId: String(r.event_id),
    occurrenceKey: String(r.occurrence_key ?? ""),
    status: String(r.status),
  }));
}

/**
 * Take the gathering's row lock, the one every seat path takes first
 * (`rsvp`, `withdrawRsvp`, `joinWaitlist`), and say when it is. Null when the
 * gathering is gone.
 */
export async function lockGathering(conn: PoolConnection, eventId: string): Promise<PlaceGathering | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT id, starts_at, ends_at, recurrence FROM events WHERE id = ? FOR UPDATE",
    [eventId],
  );
  const r = rows[0];
  if (!r) return null;
  return { startsAt: dateOrNull(r.starts_at), endsAt: dateOrNull(r.ends_at), recurrence: r.recurrence ?? null };
}

/**
 * Delete one answer, under the gathering lock the caller holds, and say what it
 * was. Null when there was none, which is what a resume meets.
 */
export async function dropAnswer(
  conn: PoolConnection,
  eventId: string,
  userId: string,
  occurrenceKey: string,
): Promise<string | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT id, status FROM event_rsvps WHERE event_id = ? AND user_id = ? AND occurrence_key = ? FOR UPDATE",
    [eventId, userId, occurrenceKey],
  );
  const prior = rows[0];
  if (!prior) return null;
  await conn.query("DELETE FROM event_rsvps WHERE id = ?", [prior.id]);
  return String(prior.status);
}

/** Every queue place this member holds or held. Returns how many went. */
export async function dropQueuePlacesOf(pool: Pool, userId: string): Promise<number> {
  const [r] = await pool.query<any>("DELETE FROM event_waitlist WHERE user_id = ?", [userId]);
  return Number(r?.affectedRows ?? 0);
}

/** Every slot this member took, and the note they left on it. Returns how many went. */
export async function dropSlotSignupsOf(pool: Pool, userId: string): Promise<number> {
  const [r] = await pool.query<any>("DELETE FROM event_slot_signups WHERE user_id = ?", [userId]);
  return Number(r?.affectedRows ?? 0);
}

/**
 * The fees on this member's places that are not settled for good, with their
 * gatherings' dates. A `released` row is read too: `refundPlace` claims the
 * row before it posts the leg, so a death between the two leaves a row that
 * says released over a fee still in escrow, and the only way to finish it is
 * to be handed the row again (server/lib/calendarCommunity.ts decides).
 */
export async function openChargesOf(pool: Pool, userId: string): Promise<OpenCharge[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT c.event_id, c.user_id, c.occurrence_key, c.charge_seq, c.status, e.starts_at, e.ends_at, e.recurrence FROM event_seat_charges c " +
      "JOIN events e ON e.id = c.event_id WHERE c.user_id = ? AND c.status IN ('held', 'released') ORDER BY c.event_id, c.occurrence_key",
    [userId],
  );
  return rows.map((r) => ({
    eventId: String(r.event_id),
    userId: String(r.user_id),
    occurrenceKey: String(r.occurrence_key ?? ""),
    chargeSeq: Number(r.charge_seq ?? 1),
    status: r.status === "released" ? "released" : "held",
    startsAt: dateOrNull(r.starts_at),
    endsAt: dateOrNull(r.ends_at),
    recurrence: r.recurrence ?? null,
  }));
}
