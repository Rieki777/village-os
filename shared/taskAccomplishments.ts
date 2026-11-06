/**
 * ACCOMPLISHED: the tasks whose work was accepted, read off the task events.
 *
 * A task is an accomplishment when its latest `done` is followed by an
 * `accepted` (shared/sessionTasks.ts, `acceptRefusal` says who may give it).
 * The accept carries the date and an optional note. A later `reopened` takes
 * the task out of the list again; the events keep every step, so the history
 * still shows it was once accepted. A `let_go` does the same.
 *
 * A task done in the room itself has no `done` event: the close seeded it as
 * done (drizzle/0255). An `accepted` with no `done` before it in the list
 * therefore counts, with no done date, and the accept's own date stands in
 * for it when the list is grouped.
 *
 * GROUPED BY MOON, the village's work clock (shared/cycleClock.ts), by the
 * moon the work was done in. Moons are dated, never named. The newest moon
 * comes first, and in each moon the newest accept.
 *
 * PURE AND PERSON-FREE. A person here is a `live_session_members` number, the
 * same as on the events, and no name or user id is ever read. The server
 * reads the events (`accomplishmentsOf` in server/lib/sessionTasks.ts) and a
 * player card turns these moons into its Accomplished section
 * (`buildPlayerCard`, shared/playerCard.ts).
 */
import { LUNAR_CLOCK, type CycleClock } from "./cycleClock";

/** One row of `live_session_task_events`, as this reads it, oldest first per task. */
export interface AccomplishmentEvent {
  entryId: number;
  kind: string;
  /** Who gave this answer. 0 is a member who has since left. */
  byNo: number;
  /** The holders after this answer. */
  ownerNo: number | null;
  ownerSeatId: string | null;
  note: string | null;
  /** The instant the answer was written, ISO. */
  at: string;
  /** The task's words, when the reader joined them in. */
  text?: string;
}

export interface Accomplishment {
  entryId: number;
  /** The task's words as said in the call, or empty when the reader left them out. */
  text: string;
  /** The person holding it when it was accepted, or null. */
  ownerNo: number | null;
  /** The role holding it when it was accepted, `org_roles.id`, or null. */
  roleId: string | null;
  /** Who marked it done, or null when the room's close did. */
  doneByNo: number | null;
  /** When it was marked done, or null when the room's close did. */
  doneAt: string | null;
  acceptedAt: string;
  /** The accept's own line, if one was given. */
  note: string | null;
}

export interface AccomplishmentMoon {
  /** The moon's cycle id, from the clock. */
  id: string;
  startsAt: string;
  endsAt: string;
  items: Accomplishment[];
}

const ms = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : Number.NaN;
};

/**
 * Every task accepted and not opened again since, one per task, newest accept
 * first. Events are read per task in the order given, which is the order the
 * store wrote them.
 */
export function currentAccomplishments(events: readonly AccomplishmentEvent[]): Accomplishment[] {
  const byTask = new Map<number, { done: AccomplishmentEvent | null; now: Accomplishment | null }>();
  for (const ev of events) {
    if (!Number.isFinite(ev.entryId)) continue;
    const t = byTask.get(ev.entryId) ?? { done: null, now: null };
    byTask.set(ev.entryId, t);
    if (ev.kind === "done") {
      t.done = ev;
      t.now = null;
    } else if (ev.kind === "accepted") {
      if (!Number.isFinite(ms(ev.at))) continue;
      t.now = {
        entryId: ev.entryId,
        text: typeof ev.text === "string" ? ev.text : "",
        ownerNo: ev.ownerNo != null && ev.ownerNo > 0 ? ev.ownerNo : null,
        roleId: ev.ownerSeatId ? ev.ownerSeatId : null,
        doneByNo: t.done && t.done.byNo > 0 ? t.done.byNo : null,
        doneAt: t.done ? t.done.at : null,
        acceptedAt: ev.at,
        note: typeof ev.note === "string" && ev.note.trim() ? ev.note.trim() : null,
      };
    } else {
      // Opened again, let go, or any answer an open task takes: no longer done.
      t.done = null;
      t.now = null;
    }
  }
  const out: Accomplishment[] = [];
  for (const t of Array.from(byTask.values())) if (t.now) out.push(t.now);
  return out.sort((a, b) => ms(b.acceptedAt) - ms(a.acceptedAt) || b.entryId - a.entryId);
}

/** The instant an accomplishment is filed under: the moon its work was done in. */
export function accomplishedIn(a: Pick<Accomplishment, "doneAt" | "acceptedAt">): Date {
  const done = ms(a.doneAt);
  return new Date(Number.isFinite(done) ? done : ms(a.acceptedAt));
}

/** The accomplishments in these events, grouped by the moon the work was done in, newest moon first. */
export function accomplishmentsFor(events: readonly AccomplishmentEvent[], clock: CycleClock = LUNAR_CLOCK): AccomplishmentMoon[] {
  return groupByMoon(currentAccomplishments(events), clock);
}

/** Accomplishments already read, grouped by the moon the work was done in, newest moon first. */
export function groupByMoon(items: readonly Accomplishment[], clock: CycleClock = LUNAR_CLOCK): AccomplishmentMoon[] {
  const moons = new Map<string, AccomplishmentMoon>();
  const sorted = items.slice().sort((a, b) => ms(b.acceptedAt) - ms(a.acceptedAt) || b.entryId - a.entryId);
  for (const a of sorted) {
    const b = clock.boundsFor(accomplishedIn(a));
    const moon = moons.get(b.id) ?? { id: b.id, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), items: [] };
    moons.set(b.id, moon);
    moon.items.push(a);
  }
  return Array.from(moons.values()).sort((x, y) => ms(y.startsAt) - ms(x.startsAt));
}
