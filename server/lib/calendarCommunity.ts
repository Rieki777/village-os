/**
 * The calendar's community half (round 4, lane L5b, 0088): the waitlist, the
 * slots a gathering declares, "meet me" windows, and the who-is-here band.
 *
 * THE WAITLIST RULE, the one that keeps the cap true: promotion runs INSIDE
 * the transaction that freed the seat, after the `SELECT ... FOR UPDATE` on
 * the events row that `rsvp()` already takes. Every path that frees or adds a
 * seat (an answer moving off `going`, a withdrawn answer, a raised capacity)
 * holds that same row lock first, so a promoted person and a walk-up can
 * never both land the last seat. Reading a count and then inserting without
 * the lock is the check-then-act race this codebase has now met three times.
 *
 * Promotions NOTIFY through a sink the server sets at boot (`setPromotionSink`).
 * The sink fires after the owning transaction commits, never inside it: a
 * rolled-back promotion must not have told somebody they are in. The sink is
 * a no-op until set, so tests and scripts run quiet.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  SLOT_KINDS,
  isFull,
  type EventSlot,
  type SlotKind,
} from "../../shared/gatherings";
import { cleanRecurrence, iso } from "./calendar";
import { chargeForPlace, refundPlace } from "./eventSeats";
// Village Comms: the one door to the email system (server/lib/commsSink.ts).
import { commsSink } from "./commsSink";

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// ── The promotion sink ───────────────────────────────────────────────────────

export interface PromotedEntry {
  eventId: string;
  userId: string;
  occurrenceKey: string;
  title: string;
}

type PromotionSink = (promoted: PromotedEntry[]) => Promise<void> | void;

let promotionSink: PromotionSink | null = null;

/** The server wires notifications here once, in the events block. */
export function setPromotionSink(sink: PromotionSink | null): void {
  promotionSink = sink;
}

/**
 * Called by the owners of the transactions, AFTER commit. Never throws.
 *
 * Comms hears every promotion whether or not the notification sink is set,
 * which is why its line comes before the early return.
 */
export async function firePromotionSink(promoted: PromotedEntry[]): Promise<void> {
  for (const p of promoted) commsSink.fire({ type: "waitlist_promoted", eventId: p.eventId, occurrenceKey: p.occurrenceKey, personKey: p.userId });
  if (!promoted.length || !promotionSink) return;
  try {
    await promotionSink(promoted);
  } catch (e) {
    console.error("[waitlist] promotion sink failed (promotion stands)", e);
  }
}

// ── Promotion ────────────────────────────────────────────────────────────────

/**
 * Seat everyone the freed capacity allows, oldest first, one at a time.
 *
 * MUST be called inside a transaction that already holds `FOR UPDATE` on the
 * events row: that lock is the whole concurrency story. Writes the `going`
 * answer with idempotency key `waitlist:<eventId>:<userId>:<occ>`, stamps
 * `promoted_at` once, and returns who was seated so the caller can notify
 * after commit.
 */
export async function promoteWaitlist(
  conn: PoolConnection,
  eventId: string,
  occurrenceKey: string,
): Promise<PromotedEntry[]> {
  const [[event]] = await conn.query<any[]>(
    "SELECT id, title, capacity, status, removed_at FROM events WHERE id = ?",
    [eventId],
  );
  if (!event || event.removed_at) return [];
  // A cancelled or drafted gathering takes no answers, so it seats nobody.
  if (event.status !== "scheduled" && event.status !== "postponed") return [];
  const capacity = event.capacity === null ? null : Number(event.capacity);

  const promoted: PromotedEntry[] = [];
  // Bounded: one pass can seat at most a room's worth of people.
  for (let guard = 0; guard < 500; guard++) {
    const [[counts]] = await conn.query<any[]>(
      "SELECT COUNT(*) AS going FROM event_rsvps WHERE event_id = ? AND status = 'going' AND occurrence_key = ?",
      [eventId, occurrenceKey],
    );
    const going = Number(counts.going ?? 0);
    if (isFull(capacity, going)) break;

    const [[next]] = await conn.query<any[]>(
      "SELECT id, user_id FROM event_waitlist " +
        "WHERE event_id = ? AND occurrence_key = ? AND promoted_at IS NULL AND left_at IS NULL " +
        "ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE",
      [eventId, occurrenceKey],
    );
    if (!next) break;
    const userId = String(next.user_id);

    const key = `waitlist:${eventId}:${userId}${occurrenceKey ? `:${occurrenceKey}` : ""}`;
    const [[prior]] = await conn.query<any[]>(
      "SELECT id, status FROM event_rsvps WHERE event_id = ? AND user_id = ? AND occurrence_key = ?",
      [eventId, userId, occurrenceKey],
    );
    if (prior && prior.status === "going") {
      // Already seated by their own hand. Their queue place is spent.
      await conn.query("UPDATE event_waitlist SET promoted_at = NOW() WHERE id = ? AND promoted_at IS NULL", [next.id]);
      continue;
    }
    if (prior) {
      await conn.query("UPDATE event_rsvps SET status = 'going', idempotency_key = ? WHERE id = ?", [key, prior.id]);
    } else {
      await conn.query(
        "INSERT INTO event_rsvps (id, event_id, user_id, status, idempotency_key, occurrence_key) VALUES (?,?,?,'going',?,?)",
        [newId("rs"), eventId, userId, key, occurrenceKey],
      );
    }
    await conn.query("UPDATE event_waitlist SET promoted_at = NOW() WHERE id = ? AND promoted_at IS NULL", [next.id]);
    promoted.push({ eventId, userId, occurrenceKey, title: String(event.title ?? "") });
  }
  return promoted;
}

/**
 * The capacity was raised (or removed) on the admin edit path, which runs no
 * transaction of its own. Take the same events-row lock every seat path
 * takes, seat whoever now fits on every evening with a queue, and hand back
 * who was seated. The caller notifies after this returns (the commit is in
 * here).
 */
export async function promoteForCapacityChange(pool: Pool, eventId: string): Promise<PromotedEntry[]> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("SELECT id FROM events WHERE id = ? FOR UPDATE", [eventId]);
    const [occs] = await conn.query<RowDataPacket[]>(
      "SELECT DISTINCT occurrence_key FROM event_waitlist WHERE event_id = ? AND promoted_at IS NULL AND left_at IS NULL",
      [eventId],
    );
    const promoted: PromotedEntry[] = [];
    for (const o of occs) {
      promoted.push(...(await promoteWaitlist(conn, eventId, String(o.occurrence_key ?? ""))));
    }
    await conn.commit();
    return promoted;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── Joining and leaving the queue ────────────────────────────────────────────

export type JoinWaitlistOutcome =
  | { ok: true; position: number; waiting: number; duplicate: boolean; charged?: number; tokenType?: string | null }
  /**
   * 0092: `unpaid` carries a sentence, because a queue that costs credits has
   * to say what it costs and what the balance was.
   */
  | { ok: false; reason: "not_found" | "not_open" | "not_full" | "already_going" | "unpaid"; message?: string };

/**
 * Queue for a seat. Refused unless the gathering is genuinely full right now,
 * measured under the same events-row lock `rsvp()` uses, so "join the
 * waitlist" and "take the last seat" cannot both win. Rejoining after leaving
 * or after a spent promotion moves the person to the back of the queue.
 */
export async function joinWaitlist(
  pool: Pool,
  eventId: string,
  userId: string,
  occurrenceKey?: string,
): Promise<JoinWaitlistOutcome> {
  /** Filled by the queue transaction, acted on once it has closed. */
  let queued: { occ: string; position: number; waiting: number; duplicate: boolean } | null = null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[event]] = await conn.query<any[]>(
      "SELECT id, capacity, status, recurrence, removed_at FROM events WHERE id = ? FOR UPDATE",
      [eventId],
    );
    if (!event || event.removed_at) { await conn.rollback(); return { ok: false, reason: "not_found" }; }
    if (event.status !== "scheduled" && event.status !== "postponed") {
      await conn.rollback();
      return { ok: false, reason: "not_open" };
    }
    // The same occurrence identity rule as rsvp(): a recurring gathering
    // queues per evening, a one-off queues once.
    const recurring = Boolean(cleanRecurrence(event.recurrence));
    const occ = recurring && typeof occurrenceKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(occurrenceKey)
      ? occurrenceKey
      : "";
    if (recurring && !occ) { await conn.rollback(); return { ok: false, reason: "not_found" }; }

    const capacity = event.capacity === null ? null : Number(event.capacity);
    const [[counts]] = await conn.query<any[]>(
      "SELECT COUNT(*) AS going FROM event_rsvps WHERE event_id = ? AND status = 'going' AND occurrence_key = ?",
      [eventId, occ],
    );
    if (!isFull(capacity, Number(counts.going ?? 0))) {
      await conn.rollback();
      return { ok: false, reason: "not_full" };
    }
    const [[mine]] = await conn.query<any[]>(
      "SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ? AND occurrence_key = ?",
      [eventId, userId, occ],
    );
    if (mine?.status === "going") { await conn.rollback(); return { ok: false, reason: "already_going" }; }

    const [[existing]] = await conn.query<any[]>(
      "SELECT id, promoted_at, left_at FROM event_waitlist WHERE event_id = ? AND user_id = ? AND occurrence_key = ?",
      [eventId, userId, occ],
    );
    let duplicate = false;
    if (!existing) {
      await conn.query(
        "INSERT INTO event_waitlist (id, event_id, user_id, occurrence_key) VALUES (?,?,?,?)",
        [newId("wl"), eventId, userId, occ],
      );
    } else if (existing.promoted_at || existing.left_at) {
      // A spent or abandoned place: rejoin at the back.
      await conn.query(
        "UPDATE event_waitlist SET promoted_at = NULL, left_at = NULL, created_at = NOW(3) WHERE id = ?",
        [existing.id],
      );
    } else {
      duplicate = true; // already queued; their place stands
    }

    const [[me]] = await conn.query<any[]>(
      "SELECT created_at, id FROM event_waitlist WHERE event_id = ? AND user_id = ? AND occurrence_key = ?",
      [eventId, userId, occ],
    );
    const [[pos]] = await conn.query<any[]>(
      "SELECT COUNT(*) AS ahead, (SELECT COUNT(*) FROM event_waitlist WHERE event_id = ? AND occurrence_key = ? AND promoted_at IS NULL AND left_at IS NULL) AS waiting " +
        "FROM event_waitlist WHERE event_id = ? AND occurrence_key = ? AND promoted_at IS NULL AND left_at IS NULL " +
        "AND (created_at < ? OR (created_at = ? AND id <= ?))",
      [eventId, occ, eventId, occ, me.created_at, me.created_at, me.id],
    );
    await conn.commit();
    queued = { occ, position: Number(pos.ahead ?? 1), waiting: Number(pos.waiting ?? 1), duplicate };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  if (!queued) throw new Error("joinWaitlist: the queue transaction closed without a result");

  /*
   * 0092: A QUEUE POSITION IS A PLACE, AND A PLACE COSTS WHAT IT COSTS.
   *
   * Charging here rather than at promotion is the whole reason a paid
   * gathering can have a waitlist at all. `promoteWaitlist` writes a `going`
   * answer with nobody present to agree to a charge, and it runs inside a
   * transaction that cannot post to the ledger. Taking the fee when somebody
   * chooses to queue means promotion moves no money, and leaving the queue
   * gives it all back.
   *
   * Same order as the seat: claim the place, then take the money, then
   * compensate. A refused charge steps the person back out of the queue, so
   * nobody holds a position they did not pay for.
   */
  const charge = await chargeForPlace(
    pool, eventId, userId, queued.occ,
    `Queue place: ${eventId}${queued.occ ? ` (${queued.occ})` : ""}`,
  );
  if (!charge.ok) {
    await pool.query( // module-review-ok: event_waitlist's own compensation, in the file that owns the table (the ballots.ts pattern)
      "UPDATE event_waitlist SET left_at = NOW() WHERE event_id = ? AND user_id = ? AND occurrence_key = ? AND promoted_at IS NULL AND left_at IS NULL",
      [eventId, userId, queued.occ],
    );
    return { ok: false, reason: "unpaid", message: charge.error };
  }
  // Fired here and not in the route: only this function knows the evening the
  // place is for, once a one-off's stray occurrence key has been read as "".
  if (!queued.duplicate) commsSink.fire({ type: "waitlist_joined", eventId, occurrenceKey: queued.occ, personKey: userId });
  return {
    ok: true, position: queued.position, waiting: queued.waiting, duplicate: queued.duplicate,
    charged: charge.duplicate ? 0 : charge.charged, tokenType: charge.tokenType,
  };
}

/**
 * Step out of the queue. Frees no seat, so it promotes nobody.
 *
 * 0092: it does return the fee. Standing down from a queue you paid to stand
 * in is the "money for a seat nobody got" case in its purest form, and
 * `refundPlace` is idempotent at the claim and at the ledger key, so pressing
 * it twice refunds once.
 */
export async function leaveWaitlist(pool: Pool, eventId: string, userId: string, occurrenceKey = ""): Promise<boolean> {
  const [res] = await pool.query<any>(
    "UPDATE event_waitlist SET left_at = NOW() WHERE event_id = ? AND user_id = ? AND occurrence_key = ? AND promoted_at IS NULL AND left_at IS NULL",
    [eventId, userId, occurrenceKey],
  );
  const left = Number(res?.affectedRows ?? 0) > 0;
  if (left) await refundPlace(pool, eventId, userId, occurrenceKey, "You left the queue");
  return left;
}

/**
 * Fold queue numbers into calendar items: `waitlistCount` on anything with a
 * live queue, `myWaitlistPosition` for the viewer's own place. One query for
 * the counts, one for the viewer, run only when some item is capped.
 */
export async function attachWaitlistInfo<T extends { id: string; occurrenceKey: string; capacity: number | null; waitlistCount?: number | null; myWaitlistPosition?: number | null }>(
  pool: Pool,
  items: T[],
  userId: string | null,
): Promise<T[]> {
  const capped = items.filter((i) => i.capacity !== null);
  if (!capped.length) return items;
  const ids = Array.from(new Set(capped.map((i) => i.id)));
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT event_id, occurrence_key, user_id, created_at, id FROM event_waitlist
      WHERE event_id IN (${ids.map(() => "?").join(",")}) AND promoted_at IS NULL AND left_at IS NULL
      ORDER BY created_at ASC, id ASC`,
    ids,
  );
  const byOcc = new Map<string, { waiting: number; mine: number | null }>();
  for (const r of rows) {
    const key = `${r.event_id}|${r.occurrence_key ?? ""}`;
    const entry = byOcc.get(key) ?? { waiting: 0, mine: null };
    entry.waiting += 1;
    if (userId && String(r.user_id) === userId && entry.mine === null) entry.mine = entry.waiting;
    byOcc.set(key, entry);
  }
  for (const item of items) {
    const entry = byOcc.get(`${item.id}|${item.occurrenceKey}`);
    if (!entry) continue;
    item.waitlistCount = entry.waiting;
    if (entry.mine !== null) item.myWaitlistPosition = entry.mine;
  }
  return items;
}

// ── Slots ────────────────────────────────────────────────────────────────────

const cleanSlotKind = (v: unknown): SlotKind =>
  SLOT_KINDS.includes(v as SlotKind) ? (v as SlotKind) : "other";

export interface SlotInput {
  kind?: unknown;
  label?: unknown;
  needed?: unknown;
  note?: unknown;
  sortOrder?: unknown;
}

const cleanNeeded = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 1;
};

export async function createSlot(pool: Pool, eventId: string, input: SlotInput): Promise<string> {
  const id = newId("slot");
  await pool.query(
    "INSERT INTO event_slots (id, event_id, kind, label, needed, note, sort_order) VALUES (?,?,?,?,?,?,?)",
    [
      id,
      eventId,
      cleanSlotKind(input.kind),
      String(input.label ?? "").trim().slice(0, 120),
      cleanNeeded(input.needed),
      String(input.note ?? "").trim().slice(0, 400) || null,
      Number.isFinite(Number(input.sortOrder)) ? Math.floor(Number(input.sortOrder)) : 0,
    ],
  );
  return id;
}

export async function updateSlot(pool: Pool, eventId: string, slotId: string, patch: SlotInput): Promise<boolean> {
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.kind !== undefined) { sets.push("kind = ?"); params.push(cleanSlotKind(patch.kind)); }
  if (patch.label !== undefined) { sets.push("label = ?"); params.push(String(patch.label ?? "").trim().slice(0, 120)); }
  if (patch.needed !== undefined) { sets.push("needed = ?"); params.push(cleanNeeded(patch.needed)); }
  if (patch.note !== undefined) { sets.push("note = ?"); params.push(String(patch.note ?? "").trim().slice(0, 400) || null); }
  if (patch.sortOrder !== undefined) { sets.push("sort_order = ?"); params.push(Math.floor(Number(patch.sortOrder)) || 0); }
  if (!sets.length) return true;
  params.push(slotId, eventId);
  const [res] = await pool.query<any>(`UPDATE event_slots SET ${sets.join(", ")} WHERE id = ? AND event_id = ?`, params);
  return Number(res?.affectedRows ?? 0) > 0;
}

/** Signups go with the slot: they are answers to a question that is gone. */
export async function deleteSlot(pool: Pool, eventId: string, slotId: string): Promise<boolean> {
  const [[row]] = await pool.query<any[]>("SELECT id FROM event_slots WHERE id = ? AND event_id = ?", [slotId, eventId]);
  if (!row) return false;
  await pool.query("DELETE FROM event_slot_signups WHERE slot_id = ?", [slotId]);
  await pool.query("DELETE FROM event_slots WHERE id = ?", [slotId]);
  return true;
}

/**
 * The slots of one gathering, with taken counts for the evening asked about.
 * Names ride along ONLY when the caller says this viewer may see them (their
 * own answer is `going`, or they hold event.manage); everyone else gets
 * numbers. The viewer's own signup is always marked, because "you are
 * bringing a dish" is their own fact.
 */
export async function listSlotsFor(
  pool: Pool,
  eventId: string,
  occurrenceKey: string,
  viewer: { userId: string | null; withNames: boolean },
): Promise<EventSlot[]> {
  const [slots] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM event_slots WHERE event_id = ? ORDER BY sort_order, created_at, id",
    [eventId],
  );
  if (!slots.length) return [];
  const slotIds = slots.map((s) => String(s.id));
  const [signups] = await pool.query<RowDataPacket[]>(
    `SELECT ss.slot_id, ss.user_id, ss.note, ss.created_at, u.name
       FROM event_slot_signups ss
       LEFT JOIN users u ON u.id = ss.user_id
      WHERE ss.slot_id IN (${slotIds.map(() => "?").join(",")}) AND ss.occurrence_key = ?
      ORDER BY ss.created_at ASC, ss.id ASC`,
    [...slotIds, occurrenceKey],
  );
  const bySlot = new Map<string, RowDataPacket[]>();
  for (const s of signups) {
    const list = bySlot.get(String(s.slot_id)) ?? [];
    list.push(s);
    bySlot.set(String(s.slot_id), list);
  }
  return slots.map((s) => {
    const taken = bySlot.get(String(s.id)) ?? [];
    const out: EventSlot = {
      id: String(s.id),
      eventId: String(s.event_id),
      kind: cleanSlotKind(s.kind),
      label: String(s.label ?? ""),
      needed: Number(s.needed ?? 1),
      note: s.note ?? null,
      sortOrder: Number(s.sort_order ?? 0),
      isExample: Number(s.is_example ?? 0) === 1,
      takenCount: taken.length,
      mine: Boolean(viewer.userId && taken.some((t) => String(t.user_id) === viewer.userId)),
    };
    if (viewer.withNames) {
      out.names = taken.map((t) => ({
        userId: String(t.user_id),
        // A member who has since left still holds the dish they said they
        // would bring; the tombstone is a null name, spelled out client-side.
        name: t.name ?? null,
        note: t.note ?? null,
      }));
    }
    return out;
  });
}

export type SlotSignupOutcome =
  | { ok: true; duplicate: boolean; takenCount: number }
  | { ok: false; reason: "not_found" | "not_open" | "full" };

/**
 * Take a slot. The count check runs under `FOR UPDATE` on the slot row, the
 * same shape as the seat cap: two people reaching for the last dish at the
 * same moment must not both be told yes.
 */
export async function signupSlot(
  pool: Pool,
  eventId: string,
  slotId: string,
  userId: string,
  occurrenceKey?: string,
  note?: unknown,
): Promise<SlotSignupOutcome> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[slot]] = await conn.query<any[]>(
      "SELECT id, needed FROM event_slots WHERE id = ? AND event_id = ? FOR UPDATE",
      [slotId, eventId],
    );
    if (!slot) { await conn.rollback(); return { ok: false, reason: "not_found" }; }
    const [[event]] = await conn.query<any[]>(
      "SELECT status, recurrence, removed_at FROM events WHERE id = ?",
      [eventId],
    );
    if (!event || event.removed_at) { await conn.rollback(); return { ok: false, reason: "not_found" }; }
    if (event.status !== "scheduled" && event.status !== "postponed") {
      await conn.rollback();
      return { ok: false, reason: "not_open" };
    }
    const recurring = Boolean(cleanRecurrence(event.recurrence));
    const occ = recurring && typeof occurrenceKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(occurrenceKey)
      ? occurrenceKey
      : "";
    if (recurring && !occ) { await conn.rollback(); return { ok: false, reason: "not_found" }; }

    const [[counts]] = await conn.query<any[]>(
      "SELECT COUNT(*) AS taken, SUM(user_id = ?) AS mine FROM event_slot_signups WHERE slot_id = ? AND occurrence_key = ?",
      [userId, slotId, occ],
    );
    const taken = Number(counts.taken ?? 0);
    if (Number(counts.mine ?? 0) > 0) {
      await conn.commit();
      return { ok: true, duplicate: true, takenCount: taken };
    }
    if (taken >= Number(slot.needed ?? 1)) {
      await conn.rollback();
      return { ok: false, reason: "full" };
    }
    await conn.query(
      "INSERT INTO event_slot_signups (id, slot_id, user_id, occurrence_key, note) VALUES (?,?,?,?,?)",
      [newId("ss"), slotId, userId, occ, String(note ?? "").trim().slice(0, 200) || null],
    );
    await conn.commit();
    return { ok: true, duplicate: false, takenCount: taken + 1 };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function withdrawSlotSignup(pool: Pool, eventId: string, slotId: string, userId: string, occurrenceKey = ""): Promise<boolean> {
  const [res] = await pool.query<any>(
    "DELETE ss FROM event_slot_signups ss JOIN event_slots s ON s.id = ss.slot_id " +
      "WHERE ss.slot_id = ? AND s.event_id = ? AND ss.user_id = ? AND ss.occurrence_key = ?",
    [slotId, eventId, userId, occurrenceKey],
  );
  return Number(res?.affectedRows ?? 0) > 0;
}

// ── Meet me (A5) ─────────────────────────────────────────────────────────────

/** Open windows one member may hold at once. The eighth is refused. */
export const MEET_ME_OPEN_CAP = 7;

export type MeetMeOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "bad_time" | "too_many" | "bad_layer" };

/**
 * A member opens a window saying "I am around, come find me". Lands on the
 * calendar as its own kind, on the village layer or their own private one,
 * titled from their first name. L7 reads these through `listCalendarItems`.
 */
export async function createMeetMe(
  pool: Pool,
  input: {
    userId: string;
    firstName: string;
    startsAt: unknown;
    endsAt: unknown;
    place?: unknown;
    note?: unknown;
    layer?: unknown;
  },
): Promise<MeetMeOutcome> {
  const layer = input.layer === "private" ? "private" : input.layer === "village" || input.layer === undefined ? "village" : null;
  if (!layer) return { ok: false, reason: "bad_layer" };
  const starts = new Date(String(input.startsAt ?? ""));
  const ends = new Date(String(input.endsAt ?? ""));
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return { ok: false, reason: "bad_time" };
  if (ends.getTime() <= starts.getTime()) return { ok: false, reason: "bad_time" };
  if (ends.getTime() - starts.getTime() > 24 * 60 * 60 * 1000) return { ok: false, reason: "bad_time" };
  if (starts.getTime() < Date.now() - 60 * 60 * 1000) return { ok: false, reason: "bad_time" };

  const [[open]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM events WHERE kind = 'meet-me' AND created_by = ? AND removed_at IS NULL AND status = 'scheduled' AND (COALESCE(ends_at, starts_at) >= UTC_TIMESTAMP())",
    [input.userId],
  );
  if (Number(open?.n ?? 0) >= MEET_ME_OPEN_CAP) return { ok: false, reason: "too_many" };

  const id = newId("mm");
  const first = String(input.firstName ?? "").trim().split(/\s+/)[0] || "me";
  await pool.query(
    `INSERT INTO events
       (id, title, description, starts_at, ends_at, location_text, structure_keys, status, attendance_mode,
        created_by, kind, layer, owner_user_id, all_day)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
    [
      id,
      `Meet ${first}`.slice(0, 200),
      String(input.note ?? "").trim().slice(0, 300) || null,
      starts,
      ends,
      String(input.place ?? "").trim().slice(0, 200) || null,
      JSON.stringify([]),
      "scheduled",
      "offline",
      input.userId,
      "meet-me",
      layer,
      input.userId,
    ],
  );
  return { ok: true, id };
}

/** The owner closes their window. Nobody else can. */
export async function cancelMeetMe(pool: Pool, id: string, userId: string): Promise<boolean> {
  const [res] = await pool.query<any>(
    "DELETE FROM events WHERE id = ? AND kind = 'meet-me' AND (created_by = ? OR owner_user_id = ?)",
    [id, userId, userId],
  );
  return Number(res?.affectedRows ?? 0) > 0;
}

export interface MeetMeWindow {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  place: string | null;
  note: string | null;
  layer: string;
}

/** A member's own open windows, soonest first, for the manage card. */
export async function listMyMeetMe(pool: Pool, userId: string): Promise<MeetMeWindow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, title, starts_at, ends_at, location_text, description, layer FROM events " +
      "WHERE kind = 'meet-me' AND (created_by = ? OR owner_user_id = ?) AND removed_at IS NULL " +
      "AND COALESCE(ends_at, starts_at) >= (UTC_TIMESTAMP() - INTERVAL 1 DAY) ORDER BY starts_at ASC LIMIT 50",
    [userId, userId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    startsAt: iso(r.starts_at),
    endsAt: r.ends_at ? iso(r.ends_at) : null,
    place: r.location_text ?? null,
    note: r.description ?? null,
    layer: String(r.layer ?? "village"),
  }));
}

// ── Who is here (§5 item 11) ────────────────────────────────────────────────

export interface WhoIsHereDay {
  date: string;
  count: number;
  names?: string[];
}

export interface WhoIsHere {
  here: { count: number; names?: string[] };
  arrivals: WhoIsHereDay[];
  departures: WhoIsHereDay[];
}

const dateKey = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * The stays picture for a window: who is on the land now, who arrives when,
 * and who left. Arrivals come from `arrive_on` with status requested or
 * active; "left" comes from status `ended` and the row's own `updated_at`,
 * never an invented departure date (stays has no departure column, and this
 * module will not pretend one).
 *
 * With `withNames` false the shape carries counts ONLY: no user id, no name,
 * no key that could hold either. That is the tier rule from the map ("anonymous
 * visitors get STRUCTURE only") applied to people.
 */
export async function whoIsHere(
  pool: Pool,
  window: { from: string; to: string },
  withNames: boolean,
): Promise<WhoIsHere> {
  const [hereRows] = await pool.query<RowDataPacket[]>(
    "SELECT s.user_id, u.name FROM stays s LEFT JOIN users u ON u.id = s.user_id WHERE s.status = 'active'",
  );
  const [arriveRows] = await pool.query<RowDataPacket[]>(
    "SELECT s.arrive_on, s.user_id, u.name FROM stays s LEFT JOIN users u ON u.id = s.user_id " +
      "WHERE s.status IN ('requested','active') AND s.arrive_on IS NOT NULL AND s.arrive_on >= ? AND s.arrive_on <= ? " +
      "ORDER BY s.arrive_on ASC",
    [window.from, window.to],
  );
  const [endedRows] = await pool.query<RowDataPacket[]>(
    "SELECT s.updated_at, s.user_id, u.name FROM stays s LEFT JOIN users u ON u.id = s.user_id " +
      "WHERE s.status = 'ended' AND s.updated_at >= ? AND s.updated_at <= DATE_ADD(?, INTERVAL 1 DAY) " +
      "ORDER BY s.updated_at ASC",
    [window.from, window.to],
  );

  const fold = (rows: RowDataPacket[], key: (r: RowDataPacket) => string | null): WhoIsHereDay[] => {
    const byDay = new Map<string, { count: number; names: string[] }>();
    for (const r of rows) {
      const day = key(r);
      if (!day) continue;
      const entry = byDay.get(day) ?? { count: 0, names: [] };
      entry.count += 1;
      entry.names.push(String(r.name ?? "a guest"));
      byDay.set(day, entry);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => (withNames ? { date, count: v.count, names: v.names } : { date, count: v.count }));
  };

  const here: WhoIsHere["here"] = withNames
    ? { count: hereRows.length, names: hereRows.map((r) => String(r.name ?? "a guest")) }
    : { count: hereRows.length };

  return {
    here,
    arrivals: fold(arriveRows, (r) => dateKey(r.arrive_on)),
    departures: fold(endedRows, (r) => dateKey(r.updated_at)),
  };
}
