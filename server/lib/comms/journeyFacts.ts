/**
 * THE FACTS AND VALUES THIS LANE PLUGS INTO ITS OWN ENGINE
 * (./journeyRegistry.ts): the `event` facts provider and the `common` vars
 * builder. Registered when this file loads; the engine (./journeys.ts) imports
 * it, so anything that can tick has them.
 *
 * ── THE EVENT PROVIDER ──────────────────────────────────────────────────────
 *
 * For an enrollment on `event:<id>:<occurrence>` it reads the gathering LIVE
 * through server/lib/calendar.ts, every tick, so a moved start or a cancelled
 * evening is seen the moment the enrollment is next looked at:
 *
 *   eventStart, eventEnd  the occurrence's own times, overrides applied
 *   event                 found, removed, status, this evening called off
 *   personKey             the trigger's own when it stored one, else the
 *                         member's user id, else `guest:<contactId>`
 *   attendance            the host's mark for this person, or null
 *
 * An occurrence is found by its village-date key the way the calendar keys it
 * (`civilDateKey` in the village's zone). A key the series no longer produces,
 * because the date was taken out of it or the rhythm changed, counts as
 * removed: there is no evening left to remind anybody about.
 *
 * ── THE COMMON BUILDER ──────────────────────────────────────────────────────
 *
 * The reader's name, for `person.firstName` and `person.name`. The village's
 * own fields and the reader's preferences link are filled by the renderer
 * (server/lib/comms/render.ts), never here.
 */
import { guestPersonKey } from "../../../shared/comms/kinds";
import { civilDateKey } from "../../../shared/lunar";
import { attendanceOf } from "../../repos/commsEventFacts";
import { expandOccurrences, getCalendarRow, type CalendarRow } from "../calendar";
import { registerFactsProvider, registerVarsBuilder, type EventFacts } from "./journeyRegistry";

const DAY = 86_400_000;

/** The gathering and occurrence an `event:<id>:<occ>` subject names, or null. */
export function eventSubject(subjectRef: string): { eventId: string; occurrenceKey: string } | null {
  if (!subjectRef.startsWith("event:")) return null;
  const rest = subjectRef.slice("event:".length);
  const cut = rest.lastIndexOf(":");
  const eventId = cut < 0 ? rest : rest.slice(0, cut);
  const occurrenceKey = cut < 0 ? "" : rest.slice(cut + 1);
  return eventId ? { eventId, occurrenceKey } : null;
}

/**
 * One occurrence of a gathering by its key, or null when the row does not
 * produce it. A one-off answers its own row for the empty key (and for its own
 * date); a series answers the evening its expansion keys with that date, with
 * any override applied.
 */
export function occurrenceOf(
  row: CalendarRow,
  occurrenceKey: string,
  zone: string,
): { startsAt: Date; endsAt: Date | null; cancelled: boolean; title: string } | null {
  const own = { startsAt: row.startsAt, endsAt: row.endsAt, cancelled: false, title: row.title };
  if (!row.recurrence) return occurrenceKey === "" || occurrenceKey === civilDateKey(row.startsAt, zone) ? own : null;
  if (occurrenceKey === "") return own;
  const m = occurrenceKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const centre = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let lo = centre - 2 * DAY;
  let hi = centre + 3 * DAY;
  const moved = row.recurrence.overrides?.[occurrenceKey]?.startsAt;
  const movedAt = moved ? Date.parse(moved) : Number.NaN;
  if (Number.isFinite(movedAt)) {
    lo = Math.min(lo, movedAt - 2 * DAY);
    hi = Math.max(hi, movedAt + 3 * DAY);
  }
  const hit = expandOccurrences(row, new Date(lo), new Date(hi), zone).find((o) => o.occurrenceKey === occurrenceKey);
  return hit ? { startsAt: hit.startsAt, endsAt: hit.endsAt, cancelled: hit.cancelled, title: hit.title } : null;
}

registerFactsProvider(
  "event",
  async (ctx) => {
    const subject = eventSubject(ctx.enrollment.subjectRef);
    const stored = ctx.enrollment.stored;
    const personKey =
      typeof stored.personKey === "string" && stored.personKey
        ? stored.personKey
        : ctx.contact?.userId ?? (ctx.contact ? guestPersonKey(ctx.contact.id) : null);
    if (!subject) return { event: null, personKey };
    const row = await getCalendarRow(ctx.getPool(), subject.eventId);
    const occurrence = row ? occurrenceOf(row, subject.occurrenceKey, ctx.villageZone) : null;
    const event: EventFacts = {
      eventId: subject.eventId,
      occurrenceKey: subject.occurrenceKey,
      found: Boolean(row && occurrence),
      removed: !row || row.removedAt !== null || !occurrence,
      status: row ? row.status : null,
      occurrenceCancelled: occurrence?.cancelled ?? false,
      title: occurrence?.title ?? row?.title ?? null,
      startsAt: occurrence?.startsAt ?? null,
      endsAt: occurrence?.endsAt ?? null,
    };
    const attendance = personKey && event.found ? await attendanceOf(ctx.getPool(), subject.eventId, subject.occurrenceKey, personKey) : null;
    return { event, personKey, eventStart: event.startsAt, eventEnd: event.endsAt, attendance };
  },
  "comms-journeys:event",
);

registerVarsBuilder(
  "common",
  (ctx) => {
    const name = ctx.contact?.name?.trim() ?? "";
    if (!name) return {};
    return { vars: { "person.name": name, "person.firstName": name.split(/\s+/)[0] } };
  },
  "comms-journeys:common",
);
