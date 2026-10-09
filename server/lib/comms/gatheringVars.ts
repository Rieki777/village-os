/**
 * WHAT A GATHERING EMAIL KNOWS: one occurrence of a gathering read live, and
 * the `gathering.*` merge fields filled from it (the comms build spec 5.5 and
 * 5.7).
 *
 * Every gathering email, sent by a trigger here or by the journey engine's
 * tick, fills its fields through `gatheringValues`, so the confirmation, a
 * reminder and a change all say the same thing about the same gathering:
 *
 *   gathering.title          the occurrence's own title (an evening of a series
 *                            may carry its own)
 *   gathering.when           its start in village time, through `gatheringWhen`
 *   gathering.whenLocal      the same moment in the reader's zone, when known
 *                            and different
 *   gathering.where          the place in words; left out for an online-only one
 *   gathering.joinLink       `/api/events/<id>/join`, which redirects to the
 *                            room the gathering has NOW, so a changed room never
 *                            breaks an old email; only when it meets online
 *   gathering.url            the calendar page
 *   gathering.cantMakeIt     a signed `cant_make_it` link for this reader and
 *                            this evening
 *   gathering.calendarLinks  Google Calendar and Outlook, filled in
 *   gathering.hostName       the host's name
 *   gathering.description    the host's words
 *   gathering.recapLink      where the host writes the recap
 *
 * TIMES GO THROUGH server/lib/calendar.ts. A recurring gathering's evening is
 * found by expanding its rule around the evening's key, with any override the
 * host made to that one evening, never by arithmetic here.
 */
import type { Pool } from "mysql2/promise";
import type { MergeValues } from "../../../shared/comms/mergeFields";
import { gatheringWhen } from "../../../shared/comms/mergeFields";
import { contactIdOfGuestKey } from "../../../shared/comms/kinds";
import type { AttendanceMode, CalendarKind, CalendarLayer, EventStatus } from "../../../shared/gatherings";
import { zonedTimeToUtc } from "../../../shared/lunar";
import { expandOccurrences, getCalendarRow, type CalendarRow, type Occurrence } from "../calendar";
import { usersRepo } from "../../repos/users";
import { contactById } from "../../repos/commsContacts";
import { eventCreatorOf, readEventComms } from "../../repos/eventComms";
import { calendarLinks, type IcsGathering } from "./ics";
import { signLink } from "./links";

const DAY_MS = 86_400_000;

/** When a gathering said nothing about its end, it is taken to last this long. */
export const ASSUMED_LENGTH_MS = 2 * 60 * 60 * 1000;

/** One occurrence of a gathering, read live, as every email about it needs it. */
export interface GatheringSnapshot {
  eventId: string;
  occurrenceKey: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  where: string | null;
  attendanceMode: AttendanceMode;
  onlineUrl: string | null;
  status: EventStatus;
  /** This evening alone was called off by its host. */
  occurrenceCancelled: boolean;
  kind: CalendarKind;
  layer: CalendarLayer;
  removed: boolean;
}

/** A recurring gathering's evening keys look like this; a one-off's is "". */
const OCC_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One evening of a gathering, or null when the gathering has no such evening:
 * a key that is not a date, a date the rule never lands on, or one the host
 * took out of the series. A one-off answers its one occurrence whatever key it
 * is asked for, the way `rsvp()` stores "" for it.
 */
export function occurrenceOf(row: CalendarRow, occurrenceKey: string, timeZone: string): Occurrence | null {
  if (!row.recurrence) {
    return { row, occurrenceKey: "", startsAt: row.startsAt, endsAt: row.endsAt, title: row.title, cancelled: false };
  }
  if (!OCC_KEY.test(occurrenceKey)) return null;
  const [y, m, d] = occurrenceKey.split("-").map(Number);
  // The window holds both the evening's own date and wherever the host moved
  // it to, because the rule is expanded from the date and the override then
  // places it.
  const day = zonedTimeToUtc(y, m, d, 12, 0, timeZone).getTime();
  const moved = row.recurrence.overrides?.[occurrenceKey]?.startsAt;
  const movedAt = moved ? new Date(moved).getTime() : day;
  const from = new Date(Math.min(day, movedAt) - 3 * DAY_MS);
  const to = new Date(Math.max(day, movedAt) + 3 * DAY_MS);
  return expandOccurrences(row, from, to, timeZone).find((o) => o.occurrenceKey === occurrenceKey) ?? null;
}

/** The next evening that has not ended, or null when there is none in the coming year. */
export function nextOccurrence(row: CalendarRow, timeZone: string, now: Date): Occurrence | null {
  if (!row.recurrence) {
    const end = row.endsAt ?? new Date(row.startsAt.getTime() + ASSUMED_LENGTH_MS);
    return end.getTime() > now.getTime()
      ? { row, occurrenceKey: "", startsAt: row.startsAt, endsAt: row.endsAt, title: row.title, cancelled: false }
      : null;
  }
  return (
    expandOccurrences(row, now, new Date(now.getTime() + 400 * DAY_MS), timeZone).find(
      (o) => !o.cancelled && (o.endsAt ?? new Date(o.startsAt.getTime() + ASSUMED_LENGTH_MS)).getTime() > now.getTime(),
    ) ?? null
  );
}

/** The snapshot of one row's evening. */
export function snapshotOf(row: CalendarRow, occ: Occurrence): GatheringSnapshot {
  return {
    eventId: row.id,
    occurrenceKey: occ.occurrenceKey,
    title: occ.title || row.title,
    description: row.description,
    startsAt: occ.startsAt,
    endsAt: occ.endsAt,
    allDay: row.allDay,
    where: row.locationText && row.locationText.trim() ? row.locationText.trim() : null,
    attendanceMode: row.attendanceMode,
    onlineUrl: row.onlineUrl,
    status: row.status,
    occurrenceCancelled: occ.cancelled,
    kind: row.kind,
    layer: row.layer,
    removed: Boolean(row.removedAt),
  };
}

/** One evening of a gathering, read live, or null when the gathering or the evening is gone. */
export async function loadGathering(pool: Pool, eventId: string, occurrenceKey: string, timeZone: string): Promise<GatheringSnapshot | null> {
  const row = await getCalendarRow(pool, eventId);
  if (!row) return null;
  const occ = occurrenceOf(row, occurrenceKey, timeZone);
  return occ ? snapshotOf(row, occ) : null;
}

/** True when an evening has not ended yet. With no end, it lasts `ASSUMED_LENGTH_MS`. */
export function notEnded(g: Pick<GatheringSnapshot, "startsAt" | "endsAt">, now: Date): boolean {
  const end = g.endsAt ?? new Date(g.startsAt.getTime() + ASSUMED_LENGTH_MS);
  return end.getTime() > now.getTime();
}

/** True when it meets online and has a room to go to. */
export const meetsOnline = (g: Pick<GatheringSnapshot, "attendanceMode" | "onlineUrl">): boolean =>
  g.attendanceMode !== "offline" && Boolean(g.onlineUrl && g.onlineUrl.trim());

// ── Links ───────────────────────────────────────────────────────────────────

const bare = (origin: string): string => String(origin ?? "").trim().replace(/\/+$/, "");

/** The page a gathering is shown on. There is one calendar page, and every gathering is on it. */
export function gatheringUrl(origin: string, _eventId: string): string {
  return `${bare(origin)}/events`;
}

/** The link into the online room, which redirects to whatever room the gathering has now. */
export function joinUrl(origin: string, eventId: string): string {
  return `${bare(origin)}/api/events/${encodeURIComponent(eventId)}/join`;
}

/** The longest a "can't make it" link lives, whatever the gathering's date. */
const CANT_MAKE_IT_MAX_DAYS = 400;

/**
 * A signed "can't make it" link for one person and one evening. It lives until
 * a day after the evening ends. Null when a value cannot go in a link (an id of
 * an unexpected shape), because a reminder with no such line is better than
 * one that throws.
 */
export function cantMakeItLink(
  origin: string,
  input: { eventId: string; occurrenceKey: string; personKey: string; endsAt: Date | null; startsAt: Date },
  now: Date,
): string | null {
  const end = input.endsAt ?? new Date(input.startsAt.getTime() + ASSUMED_LENGTH_MS);
  const days = Math.ceil((end.getTime() - now.getTime()) / DAY_MS) + 1;
  const ttl = Math.max(1, Math.min(CANT_MAKE_IT_MAX_DAYS, days));
  try {
    const payload: Record<string, string> = { e: input.eventId, p: input.personKey };
    if (input.occurrenceKey) payload.o = input.occurrenceKey;
    const token = signLink("cant_make_it", payload, ttl, { now: now.getTime() });
    return `${bare(origin)}/email/a?t=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

// ── The host ────────────────────────────────────────────────────────────────

/** The member hosting a gathering: the one named in its email settings, else whoever made it. */
export async function hostUserIdOf(pool: Pool, eventId: string): Promise<string | null> {
  const named = (await readEventComms(pool, eventId)).hostUserId;
  return named ?? (await eventCreatorOf(pool, eventId));
}

/** A member's name, or null for nobody, an example identity or a closed account. */
export async function memberName(pool: Pool, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const guest = contactIdOfGuestKey(userId);
  if (guest) {
    const c = await contactById(pool, guest);
    return c?.name ?? null;
  }
  const m = await usersRepo(pool).byId(userId);
  if (!m || m.isExample || String(m.email ?? "").endsWith("@anonymized.invalid")) return null;
  const name = String(m.name ?? "").trim();
  return name || null;
}

// ── The values ──────────────────────────────────────────────────────────────

/** The first word of a name, for "Hi Sam,". */
export function firstNameOf(name: string | null | undefined): string {
  return String(name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** The reader's own fields: their name. */
export function personValues(name: string | null | undefined): MergeValues {
  const full = String(name ?? "").trim();
  return full ? { "person.name": full, "person.firstName": firstNameOf(full) } : {};
}

/** The snapshot as a calendar file needs it. */
export function icsGatheringOf(g: GatheringSnapshot, origin: string, timeZone: string): IcsGathering {
  return {
    eventId: g.eventId,
    occurrenceKey: g.occurrenceKey,
    title: g.title,
    startsAt: g.startsAt,
    endsAt: g.endsAt,
    allDay: g.allDay,
    timezone: timeZone,
    location: g.where,
    url: gatheringUrl(origin, g.eventId),
    description: g.description,
    joinUrl: meetsOnline(g) ? joinUrl(origin, g.eventId) : null,
  };
}

/**
 * When it meets, written the way the words expect: `gatheringWhen` for a timed
 * gathering, and the day alone for an all-day one, whose clock time means
 * nothing to anybody.
 */
export function whenValues(g: Pick<GatheringSnapshot, "startsAt" | "allDay">, villageZone: string, readerZone: string | null): { when: string; whenLocal: string } {
  const w = gatheringWhen(g.startsAt, villageZone, readerZone);
  if (!g.allDay) return w;
  return { when: w.when.split(" at ")[0] ?? w.when, whenLocal: "" };
}

export interface GatheringValuesInput {
  origin: string;
  villageZone: string;
  /** The reader's own zone, when their device told us. */
  readerZone: string | null;
  /** The reader's person key, for their "can't make it" link. Null leaves the link out. */
  personKey: string | null;
  /** The host's name, already read. Undefined reads it. */
  hostName?: string | null;
  now: Date;
}

/** Every `gathering.*` field for one evening and one reader. */
export async function gatheringValues(pool: Pool, g: GatheringSnapshot, input: GatheringValuesInput): Promise<MergeValues> {
  const { when, whenLocal } = whenValues(g, input.villageZone, input.readerZone);
  const hostName = input.hostName !== undefined ? input.hostName : await memberName(pool, await hostUserIdOf(pool, g.eventId));
  const page = gatheringUrl(input.origin, g.eventId);
  const values: MergeValues = {
    "gathering.title": g.title,
    "gathering.when": when,
    "gathering.whenLocal": whenLocal,
    "gathering.where": g.attendanceMode === "online" ? "" : g.where ?? "",
    "gathering.joinLink": meetsOnline(g) ? joinUrl(input.origin, g.eventId) : "",
    "gathering.url": page,
    "gathering.calendarLinks": { links: calendarLinks(icsGatheringOf(g, input.origin, input.villageZone)) },
    "gathering.hostName": hostName ?? "",
    "gathering.description": g.description && g.description.trim() ? { markdown: g.description } : null,
    "gathering.recapLink": page,
  };
  if (input.personKey) {
    const link = cantMakeItLink(input.origin, { ...g, personKey: input.personKey }, input.now);
    if (link) values["gathering.cantMakeIt"] = link;
  }
  return values;
}
