/**
 * The Events module's data access: the village's calendar (0059), now the
 * write side people type into and a thin list over the one calendar read.
 *
 * NAMED `gatherings` DELIBERATELY. `server/lib/events.ts` is the platform's
 * event SPINE (recordEvent, the one way into health_events). The module id is
 * `events` and the tables are `events` and `event_rsvps`, and this file is
 * where those live, but an import called `events` already means something
 * else in this codebase and would be wrong exactly when somebody is tired.
 *
 * Since 0085 the `events` table is the village's ONE calendar (see
 * server/lib/calendar.ts): quest windows, the sky, cycle marks and imported
 * calendars live beside the gatherings. This file keeps what a person does
 * with a gathering (create, edit, delete, RSVP, check who is coming) and
 * `listGatherings` is a thin call over `listCalendarItems`, so the flat list,
 * the map and the wheel can never disagree about what is on.
 *
 * Every read returns the same `CalendarItem` shape from shared/gatherings.ts
 * (a superset of `Gathering`), so the client, the map and the JSON-LD emitter
 * all agree on what a gathering is. `daysUntil` is computed there and never in
 * SQL: the map needs it too, and one implementation cannot drift from itself.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  ATTENDANCE_MODES,
  AUTHORED_KINDS,
  CALENDAR_LAYERS,
  EVENT_STATUSES,
  RSVP_STATUSES,
  daysUntil,
  isFull,
  type AttendanceMode,
  type CalendarItem,
  type CalendarKind,
  type CalendarLayer,
  type EventStatus,
  type Recurrence,
  type RsvpStatus,
} from "../../shared/gatherings";
import {
  cleanRecurrence,
  getCalendarItem,
  iso,
  listCalendarItems,
  type CalendarViewer,
} from "./calendar";
import { firePromotionSink, promoteForCapacityChange, promoteWaitlist } from "./calendarCommunity";
import { chargeForPlace, heldSeatValue, refundAllPlaces, refundPlace } from "./eventSeats";

const newId = () => `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export interface GatheringInput {
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt?: string | null;
  locationText?: string | null;
  structureKeys?: string[];
  visitTypeId?: string | null;
  capacity?: number | null;
  status?: EventStatus;
  attendanceMode?: AttendanceMode;
  onlineUrl?: string | null;
  /** 0085: `gathering` or `festival`; anything else belongs to a module. */
  kind?: CalendarKind;
  layer?: CalendarLayer;
  allDay?: boolean;
  recurrence?: Recurrence | null;
  link?: string | null;
  colour?: string | null;
  /**
   * 0088: the one person a private-layer row belongs to. The member
   * post-to-my-layer route sets it to the author; admin surfaces leave it.
   */
  ownerUserId?: string | null;
  /**
   * 0092: what a place costs, and in what. 0 is free and is the default for
   * everything, so a village that never prices a gathering sees no change.
   */
  seatPrice?: number | null;
  seatToken?: string | null;
}

export interface ListOptions {
  /** Signed-in viewer, for their own RSVP. */
  userId?: string | null;
  /** Include `draft`. Admin surfaces only. */
  includeDrafts?: boolean;
  /** The viewer is an admin: the admin layer opens. Defaults to includeDrafts. */
  isAdmin?: boolean;
  /** How far ahead to look. */
  upcomingDays: number;
  /** How long a finished gathering stays listed. */
  pastVisibleDays: number;
  /** Only gatherings touching this map structure. */
  structureKey?: string | null;
  /** The village's zone, for occurrence keys. UTC when the caller has none. */
  timezone?: string;
  /** Which kinds. Defaults to the authored kinds: gathering and festival. */
  kinds?: CalendarKind[];
  limit?: number;
}

/**
 * The calendar, soonest-first within the visible window.
 *
 * The window is two-sided on purpose. An events page that drops a gathering
 * the moment it starts tells someone standing outside the greenhouse that
 * nothing is happening, so `pastVisibleDays` keeps it listed after the fact.
 *
 * A thin call over listCalendarItems (0085): the same read the wheel, the
 * .ics feed and the assistant use, narrowed to the kinds asked for.
 */
export async function listGatherings(pool: Pool, opts: ListOptions): Promise<CalendarItem[]> {
  const now = new Date();
  const day = 86_400_000;
  return listCalendarItems(pool, {
    from: new Date(now.getTime() - Math.max(0, opts.pastVisibleDays) * day),
    to: new Date(now.getTime() + Math.max(0, opts.upcomingDays) * day),
    viewer: { userId: opts.userId ?? null, isAdmin: opts.isAdmin ?? Boolean(opts.includeDrafts) },
    timezone: opts.timezone ?? "UTC",
    kinds: opts.kinds ?? AUTHORED_KINDS,
    includeDrafts: Boolean(opts.includeDrafts),
    structureKey: opts.structureKey ?? null,
    limit: opts.limit,
    now,
  });
}

export async function getGathering(
  pool: Pool,
  id: string,
  userId?: string | null,
): Promise<CalendarItem | null> {
  const viewer: CalendarViewer = { userId: userId ?? null, isAdmin: false };
  return getCalendarItem(pool, id, viewer);
}

/** Reject anything the enum columns would silently coerce. */
function cleanStatus(v: unknown, fallback: EventStatus): EventStatus {
  return EVENT_STATUSES.includes(v as EventStatus) ? (v as EventStatus) : fallback;
}
function cleanMode(v: unknown): AttendanceMode {
  return ATTENDANCE_MODES.includes(v as AttendanceMode) ? (v as AttendanceMode) : "offline";
}

/**
 * Capacity as stored: null for uncapped, and a floor of 0 so a negative
 * cannot be written. 0 is a real value meaning nobody, distinct from null.
 */
function cleanCapacity(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}
/** A person may author a gathering or a festival; every other kind is a module's. */
function cleanKind(v: unknown): CalendarKind {
  return AUTHORED_KINDS.includes(v as CalendarKind) ? (v as CalendarKind) : "gathering";
}
function cleanLayer(v: unknown): CalendarLayer {
  return CALENDAR_LAYERS.includes(v as CalendarLayer) ? (v as CalendarLayer) : "village";
}
/**
 * An https link or a site-relative path; anything else is dropped. Control
 * characters are refused outright: `new URL()` strips CR and LF before it
 * parses, so a link that "validates" could still carry a line break into the
 * .ics feed, where a line break is a new property.
 */
const cleanUrl = (v: unknown): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = v.trim().slice(0, 500);
  if (/[\u0000-\u001f\u007f\s]/.test(t)) return null;
  if (t.startsWith("/") && !t.startsWith("//")) return t;
  try { return new URL(t).protocol === "https:" ? t : null; } catch { return null; }
};
/**
 * 0092: a seat price is an amount AND a token, or it is nothing.
 *
 * Either half alone is a gathering that looks priced and charges nobody, or
 * charges an amount of something unnamed. Collapsing to free is the honest
 * reading of an incomplete form, and the route validator refuses the
 * half-filled version out loud before it gets here, so this is the second
 * line rather than the only one.
 */
function cleanSeat(price: unknown, token: unknown): { price: number; token: string | null } {
  const amount = Math.max(0, Math.trunc(Number(price) || 0));
  const slug = typeof token === "string" ? token.trim() : "";
  if (amount <= 0 || !slug) return { price: 0, token: null };
  return { price: amount, token: slug.slice(0, 32) };
}

const cleanColour = (v: unknown): string | null =>
  typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : null;

export async function createGathering(
  pool: Pool,
  input: GatheringInput,
  createdBy: string | null,
): Promise<CalendarItem> {
  const id = newId();
  const recurrence = input.recurrence ? cleanRecurrence(input.recurrence) : null;
  const seat = cleanSeat(input.seatPrice, input.seatToken);
  await pool.query(
    `INSERT INTO events
      (id, title, description, starts_at, ends_at, location_text, structure_keys,
       visit_type_id, capacity, status, attendance_mode, online_url, created_by,
       kind, layer, all_day, recurrence, link, colour, owner_user_id,
       seat_price, seat_token)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.title,
      input.description ?? null,
      new Date(input.startsAt),
      input.endsAt ? new Date(input.endsAt) : null,
      input.locationText ?? null,
      JSON.stringify(input.structureKeys ?? []),
      input.visitTypeId ?? null,
      cleanCapacity(input.capacity),
      // Ships as a draft unless the caller says otherwise. Publishing is a
      // deliberate act, the same posture as a module's lifecycle.
      cleanStatus(input.status, "draft"),
      cleanMode(input.attendanceMode),
      input.onlineUrl ?? null,
      createdBy,
      cleanKind(input.kind),
      cleanLayer(input.layer),
      input.allDay ? 1 : 0,
      recurrence ? JSON.stringify(recurrence) : null,
      cleanUrl(input.link),
      cleanColour(input.colour),
      input.ownerUserId ?? null,
      seat.price,
      seat.token,
    ],
  );
  return (await getGathering(pool, id))!;
}

/**
 * Patch a gathering. Only keys actually present are written, so a caller
 * sending `{status}` cannot blank a description it never loaded.
 */
export async function updateGathering(
  pool: Pool,
  id: string,
  patch: Partial<GatheringInput>,
): Promise<CalendarItem | null> {
  const sets: string[] = [];
  const params: any[] = [];
  const put = (col: string, value: any) => { sets.push(`${col} = ?`); params.push(value); };

  if (patch.title !== undefined) put("title", patch.title);
  if (patch.description !== undefined) put("description", patch.description ?? null);
  if (patch.startsAt !== undefined) put("starts_at", new Date(patch.startsAt));
  if (patch.endsAt !== undefined) put("ends_at", patch.endsAt ? new Date(patch.endsAt) : null);
  if (patch.locationText !== undefined) put("location_text", patch.locationText ?? null);
  if (patch.structureKeys !== undefined) put("structure_keys", JSON.stringify(patch.structureKeys ?? []));
  if (patch.visitTypeId !== undefined) put("visit_type_id", patch.visitTypeId ?? null);
  if (patch.capacity !== undefined) put("capacity", cleanCapacity(patch.capacity));
  if (patch.status !== undefined) put("status", cleanStatus(patch.status, "draft"));
  if (patch.attendanceMode !== undefined) put("attendance_mode", cleanMode(patch.attendanceMode));
  if (patch.onlineUrl !== undefined) put("online_url", patch.onlineUrl ?? null);
  if (patch.kind !== undefined) put("kind", cleanKind(patch.kind));
  if (patch.layer !== undefined) put("layer", cleanLayer(patch.layer));
  if (patch.allDay !== undefined) put("all_day", patch.allDay ? 1 : 0);
  if (patch.recurrence !== undefined) {
    const rec = patch.recurrence ? cleanRecurrence(patch.recurrence) : null;
    put("recurrence", rec ? JSON.stringify(rec) : null);
  }
  if (patch.link !== undefined) put("link", cleanUrl(patch.link));
  if (patch.colour !== undefined) put("colour", cleanColour(patch.colour));
  /*
   * 0092: price and token move TOGETHER or not at all. Writing one without the
   * other is how a gathering ends up with an amount and no token (free, per
   * `seatPriceFor`) or a token and no amount, and a half-set price is a
   * refusal a host would never see. `cleanSeat` collapses both to zero when
   * either is missing.
   *
   * Re-pricing never re-rates anybody: `event_seat_charges` snapshots the
   * amount at the moment a place is taken, so a raised fee applies to the next
   * person through the door and to nobody already inside.
   */
  if (patch.seatPrice !== undefined || patch.seatToken !== undefined) {
    const seat = cleanSeat(patch.seatPrice, patch.seatToken);
    put("seat_price", seat.price);
    put("seat_token", seat.token);
  }

  if (!sets.length) return getGathering(pool, id);
  params.push(id);
  await pool.query(`UPDATE events SET ${sets.join(", ")} WHERE id = ?`, params);
  /*
   * 0092: A GATHERING THAT STOPS HAPPENING GIVES THE SEAT FEES BACK.
   *
   * Cancelling never touched `event_rsvps` and sent nothing, which was fine
   * while an answer was only an answer. Once a seat costs credits, the same
   * edit leaves members paid for a room that will not open, and nothing else
   * in the system would ever have looked at it again: `settleFinishedSeats`
   * skips anything not scheduled or postponed, so the money would have rested
   * in escrow permanently.
   *
   * `draft` counts too. Un-publishing takes the gathering off the calendar as
   * completely as cancelling it, and a member cannot answer a draft, so
   * holding their fee against it would be holding it against nothing.
   *
   * Idempotent: a second save re-reads an empty set of held charges and posts
   * nothing.
   */
  if (patch.status !== undefined) {
    const next = cleanStatus(patch.status, "draft");
    if (next === "cancelled" || next === "draft") {
      const reason = next === "cancelled" ? "The gathering was cancelled" : "The gathering was taken off the calendar";
      try {
        await refundAllPlaces(pool, id, reason);
      } catch (e) {
        console.error("[seats] refund on status change failed (edit saved)", e);
      }
    }
  }
  // 0088: a raised (or removed) capacity means seats exist that the queue is
  // owed. The promotion takes its own transaction and the same events-row
  // lock as every other seat path; a lowered capacity promotes nobody
  // because promoteWaitlist checks `going < capacity` before each seat.
  if (patch.capacity !== undefined) {
    try {
      await firePromotionSink(await promoteForCapacityChange(pool, id));
    } catch (e) {
      console.error("[waitlist] capacity-change promotion failed (edit saved)", e);
    }
  }
  return getGathering(pool, id);
}

export async function deleteGathering(pool: Pool, id: string): Promise<boolean> {
  /*
   * 0092: REFUND BEFORE ANYTHING IS DELETED.
   *
   * This function used to say "there is no ledger value here to preserve", and
   * that was true right up until a seat cost credits. Deleting the rows first
   * would destroy the only record of who was owed what, and the ledger legs
   * would sit in escrow pointing at an event id that no longer resolves.
   *
   * The refund runs first and the charge rows go last, so a crash anywhere in
   * between leaves rows that a retry can still refund from.
   */
  await refundAllPlaces(pool, id, "The gathering was deleted");
  // RSVPs go with it. They are answers to a question that no longer exists.
  // The queue and the slots (0088) are answers of the same kind and go the
  // same way, and the seat charges follow now that they are settled: the
  // ledger keeps the history of what moved, which is the book that matters.
  await pool.query("DELETE FROM event_rsvps WHERE event_id = ?", [id]);
  await pool.query("DELETE FROM event_seat_charges WHERE event_id = ?", [id]); // module-review-ok: event_seat_charges' one enumerable home (the ballots.ts pattern; no cache sits above it)
  await pool.query("DELETE FROM event_waitlist WHERE event_id = ?", [id]);
  await pool.query("DELETE ss FROM event_slot_signups ss JOIN event_slots s ON s.id = ss.slot_id WHERE s.event_id = ?", [id]);
  await pool.query("DELETE FROM event_slots WHERE event_id = ?", [id]);
  const [res] = await pool.query<any>("DELETE FROM events WHERE id = ?", [id]);
  return Number(res?.affectedRows ?? 0) > 0;
}

export type RsvpOutcome =
  | { ok: true; status: RsvpStatus; goingCount: number; duplicate: boolean; charged?: number; tokenType?: string | null }
  /**
   * `unpaid` carries its own sentence because only the ledger knows what the
   * fee was and what the balance is, and "409" tells a member nothing they can
   * act on.
   */
  | { ok: false; reason: "not_found" | "not_open" | "full" | "unpaid"; message?: string };

/**
 * Answer a gathering.
 *
 * The capacity check runs INSIDE the transaction, after `SELECT ... FOR
 * UPDATE` on the gathering row. Reading a count, deciding, and then inserting
 * is check-then-act: two people answering the last seat at the same moment
 * both read 9 of 10 and both get in. The row lock serialises answers per
 * gathering, which is the smallest lock that makes the cap true. This exact
 * bug has been found twice in this codebase already, in swap caps and in the
 * per-cycle mint cap.
 *
 * Changing an answer UPDATEs the single row the unique key permits, so
 * going -> declined frees the seat and never appends a second row.
 */
export async function rsvp(
  pool: Pool,
  eventId: string,
  userId: string,
  status: RsvpStatus,
  idempotencyKey?: string,
  /**
   * Which evening of a recurring gathering (village-time YYYY-MM-DD). Ignored,
   * and stored as "", for a one-off: one gathering, one answer (0085, §8 27).
   */
  occurrenceKey?: string,
): Promise<RsvpOutcome> {
  const wanted: RsvpStatus = RSVP_STATUSES.includes(status) ? status : "going";
  /**
   * Filled by the seat transaction and acted on AFTER it closes. The fee has
   * to post through `postTransfer`, which opens its own transaction and takes
   * its own locks; running it while this connection still holds the events row
   * would nest one under the other.
   */
  let seated: { occ: string; takingSeat: boolean; freedSeat: boolean; goingCount: number; duplicate: boolean } | null = null;
  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[event]] = await conn.query<any[]>(
      "SELECT id, capacity, status, recurrence, removed_at FROM events WHERE id = ? FOR UPDATE",
      [eventId],
    );
    if (!event || event.removed_at) { await conn.rollback(); return { ok: false, reason: "not_found" }; }
    // A cancelled gathering stays visible so people learn it is off; it stops
    // taking answers. A draft is not public, so it cannot be answered either.
    if (event.status !== "scheduled" && event.status !== "postponed") {
      await conn.rollback();
      return { ok: false, reason: "not_open" };
    }
    // The occurrence identity. A recurring row needs a well-formed key so two
    // evenings never share one answer; a one-off has exactly one evening.
    const recurring = Boolean(cleanRecurrence(event.recurrence));
    const occ = recurring && typeof occurrenceKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(occurrenceKey)
      ? occurrenceKey
      : "";
    if (recurring && !occ) { await conn.rollback(); return { ok: false, reason: "not_found" }; }

    const [[prior]] = await conn.query<any[]>(
      "SELECT id, status FROM event_rsvps WHERE event_id = ? AND user_id = ? AND occurrence_key = ?",
      [eventId, userId, occ],
    );
    const [[counts]] = await conn.query<any[]>(
      "SELECT COUNT(*) AS going FROM event_rsvps WHERE event_id = ? AND status = 'going' AND occurrence_key = ?",
      [eventId, occ],
    );
    const going = Number(counts.going ?? 0);
    const capacity = event.capacity === null ? null : Number(event.capacity);

    // Only a NEW `going` consumes a seat. Someone already counted who
    // re-confirms is not a second body in the room.
    const takingSeat = wanted === "going" && prior?.status !== "going";
    if (takingSeat && isFull(capacity, going)) {
      await conn.rollback();
      return { ok: false, reason: "full" };
    }

    const key = idempotencyKey || `rsvp:${eventId}:${userId}${occ ? `:${occ}` : ""}`;
    if (prior) {
      await conn.query(
        "UPDATE event_rsvps SET status = ?, idempotency_key = ? WHERE id = ?",
        [wanted, key, prior.id],
      );
    } else {
      await conn.query(
        "INSERT INTO event_rsvps (id, event_id, user_id, status, idempotency_key, occurrence_key) VALUES (?,?,?,?,?,?)",
        [`rs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, eventId, userId, wanted, key, occ],
      );
    }

    // 0088: an answer moving OFF `going` frees a seat, and the waitlist is
    // served inside this same transaction, under the row lock taken above,
    // so the freed seat cannot also be handed to a walk-up.
    const freedSeat = prior?.status === "going" && wanted !== "going";
    const promoted = freedSeat ? await promoteWaitlist(conn, eventId, occ) : [];

    const nextGoing = going + (takingSeat ? 1 : 0) - (freedSeat ? 1 : 0) + promoted.length;
    await conn.commit();
    // Notify only once the promotion is real. Never throws.
    await firePromotionSink(promoted);
    seated = { occ, takingSeat, freedSeat, goingCount: nextGoing, duplicate: prior?.status === wanted };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // Unreachable: every path out of the block above either returns or fills
  // this in. Stated rather than asserted away, because a `!` here would be the
  // one line that hides a future edit dropping the assignment.
  if (!seated) throw new Error("rsvp: the seat transaction closed without a result");
  const { occ, takingSeat, freedSeat, goingCount, duplicate } = seated;

  /*
   * 0092: THE SEAT FIRST, THEN THE FEE.
   *
   * This follows the library's borrow path exactly: claim the thing, then take
   * the money, and COMPENSATE if the money refuses.
   *
   * The ordering avoids the expensive failure. Charging first and seating
   * second means a crash in between leaves a member paid for a seat they do
   * not have, with nothing pointing at the money. Seating first means a crash
   * leaves a free seat, which is a discrepancy somebody can see and fix, and
   * which nobody is out of pocket for.
   *
   * A member already holding a paid place (they queued, then were promoted)
   * charges nothing here: the fee is held against the PLACE, and they have
   * been holding one all along.
   */
  if (takingSeat) {
    const charge = await chargeForPlace(
      pool, eventId, userId, occ,
      `Seat: ${eventId}${occ ? ` (${occ})` : ""}`,
    );
    if (!charge.ok) {
      // Hand the seat straight back. Compensating, never a rollback: the
      // transaction above is committed and the queue may already have been
      // told. withdrawRsvp takes the same lock and serves the queue again.
      await withdrawRsvp(pool, eventId, userId, occ);
      return { ok: false, reason: "unpaid", message: charge.error };
    }
    return {
      ok: true, status: wanted, goingCount, duplicate,
      charged: charge.duplicate ? 0 : charge.charged, tokenType: charge.tokenType,
    };
  }
  /*
   * An answer moving OFF `going` gave the place up, so the fee comes back.
   * Idempotent at both layers, so a double tap refunds once and a retry of a
   * crashed refund finishes it.
   */
  if (freedSeat) {
    await refundPlace(pool, eventId, userId, occ, "You changed your answer");
  }
  return { ok: true, status: wanted, goingCount, duplicate };
}

export interface RsvpRow {
  userId: string;
  name: string | null;
  status: RsvpStatus;
  at: string;
  /** Which evening, for a recurring gathering; "" for a one-off. */
  occurrenceKey: string;
}

/**
 * Who answered, for the organiser.
 *
 * A LEFT JOIN, so an answer from a member who has since deleted their account
 * still counts toward the room rather than vanishing from a headcount the
 * organiser is catering against. Their name comes back null, which is what
 * the tombstone means.
 *
 * Emails are deliberately absent. An organiser needs to know who is coming;
 * a downloadable address list is a different feature with its own consent
 * question.
 */
export async function listRsvps(pool: Pool, eventId: string, occurrenceKey?: string): Promise<RsvpRow[]> {
  const params: any[] = [eventId];
  let occ = "";
  if (occurrenceKey !== undefined) { occ = " AND r.occurrence_key = ?"; params.push(occurrenceKey); }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.user_id, r.status, r.created_at, r.occurrence_key, u.name
       FROM event_rsvps r
       LEFT JOIN users u ON u.id = r.user_id
      WHERE r.event_id = ?${occ}
      ORDER BY r.occurrence_key, FIELD(r.status,'going','maybe','declined'), u.name IS NULL, u.name`,
    params,
  );
  return rows.map((r) => ({
    userId: String(r.user_id),
    name: r.name ?? null,
    status: String(r.status) as RsvpStatus,
    at: iso(r.created_at),
    occurrenceKey: String(r.occurrence_key ?? ""),
  }));
}

/**
 * Take an answer back.
 *
 * Since 0088 this runs in a transaction under the SAME events-row lock
 * `rsvp()` takes, because a withdrawn `going` frees a seat and the waitlist
 * must be served before anyone else can read the count. The bare DELETE this
 * used to be would have freed seats the queue never heard about.
 */
export async function withdrawRsvp(pool: Pool, eventId: string, userId: string, occurrenceKey = ""): Promise<boolean> {
  let gaveUpPlace = false;
  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Lock order matches rsvp(): events row first, then answer rows.
    const [[event]] = await conn.query<any[]>("SELECT id FROM events WHERE id = ? FOR UPDATE", [eventId]);
    const [[prior]] = await conn.query<any[]>(
      "SELECT id, status FROM event_rsvps WHERE event_id = ? AND user_id = ? AND occurrence_key = ?",
      [eventId, userId, occurrenceKey],
    );
    if (!prior) {
      await conn.rollback();
      return false;
    }
    await conn.query("DELETE FROM event_rsvps WHERE id = ?", [prior.id]);
    const promoted = event && prior.status === "going" ? await promoteWaitlist(conn, eventId, occurrenceKey) : [];
    gaveUpPlace = prior.status === "going";
    await conn.commit();
    await firePromotionSink(promoted);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  /*
   * 0092: the seat is gone, so the fee comes back. OUTSIDE the transaction for
   * the same reason the charge is: `postTransfer` opens its own.
   *
   * `refundPlace` is safe on a free gathering, on a place that was never
   * charged, and on one already refunded, so this call needs no condition of
   * its own beyond "they were holding a seat". That is what makes the retry
   * story true: pressing cancel twice refunds exactly once, because the second
   * press loses the atomic claim and re-posts a ledger key that already
   * landed.
   */
  if (gaveUpPlace) {
    await refundPlace(pool, eventId, userId, occurrenceKey, "You took your answer back");
  }
  return true;
}

/**
 * What the map needs, and nothing else.
 *
 * The Living Map brightens a building by how soon the next gathering there
 * is, so it wants one row per structure key with the soonest start. Returning
 * the whole calendar and letting the map reduce it would ship every
 * description and every capacity to a page that draws lanterns.
 */
export async function upcomingByStructure(
  pool: Pool,
  withinDays: number,
): Promise<Record<string, { eventId: string; title: string; startsAt: string; daysUntil: number }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, title, starts_at, structure_keys
       FROM events
      WHERE status = 'scheduled'
        AND removed_at IS NULL
        AND kind IN ('gathering','festival')
        AND layer IN ('public','village')
        AND starts_at >= UTC_TIMESTAMP()
        AND starts_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)
      ORDER BY starts_at ASC`,
    [withinDays],
  );
  const now = new Date();
  const out: Record<string, { eventId: string; title: string; startsAt: string; daysUntil: number }> = {};
  const parseKeys = (raw: unknown): string[] => {
    if (Array.isArray(raw)) return raw.filter((k): k is string => typeof k === "string");
    if (typeof raw === "string") {
      try { const p = JSON.parse(raw); return Array.isArray(p) ? p.filter((k): k is string => typeof k === "string") : []; } catch { return []; }
    }
    return [];
  };
  for (const r of rows) {
    for (const key of parseKeys(r.structure_keys)) {
      // Ascending start order means the first write per key is the soonest.
      if (out[key]) continue;
      out[key] = {
        eventId: String(r.id),
        title: String(r.title),
        startsAt: iso(r.starts_at),
        daysUntil: daysUntil(iso(r.starts_at), now),
      };
    }
  }
  return out;
}

/**
 * Open state for the module gate: gatherings still to come.
 *
 * Turning the module off unmounts the page people were told to check, so a
 * village with a harvest festival on the calendar is asked to deal with it
 * first. This is guidance, not value at risk: nothing here holds tokens.
 */
export async function eventsOpenState(pool: Pool): Promise<{ count: number; description: string }> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM events WHERE status = 'scheduled' AND removed_at IS NULL AND kind IN ('gathering','festival') AND starts_at >= UTC_TIMESTAMP()",
  );
  const count = Number(row?.n ?? 0);
  /*
   * 0092: held seat fees are open ECONOMIC state, which is the kind
   * `openStateCheck` exists for. Switching the calendar off with members'
   * credits inside the escrow account would strand them behind a 404, and
   * "settle first" is the rule the invariant states.
   */
  const held = await heldSeatValue(pool);
  const parts: string[] = [];
  if (count) {
    parts.push(
      count === 1
        ? "1 gathering is still on the calendar. Cancel it or let it pass before turning events off."
        : `${count} gatherings are still on the calendar. Cancel them or let them pass before turning events off.`,
    );
  }
  if (held.count) {
    parts.push(
      `${held.count} seat fee(s) worth ${held.byToken.map((b) => `${b.amount} ${b.tokenType}`).join(", ")} are still held in escrow. Cancel those gatherings to refund them, or let them happen.`,
    );
  }
  return {
    count: count + held.count,
    description: parts.join(" ") || "Nothing is outstanding.",
  };
}
