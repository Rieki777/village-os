/**
 * The Events module's domain vocabulary, shared by server and client.
 *
 * Named `gatherings` and not `events` on purpose. `server/lib/events.ts` is
 * the platform's event SPINE (recordEvent, the audit history every module
 * appends to). Two files called events, meaning two unrelated things, is a
 * mistake waiting for a tired import. The MODULE is `events`, the TABLES are
 * `events` and `event_rsvps`, and the code that handles them says gatherings.
 *
 * Everything here is pure. The date maths in particular is the map's
 * dependency: it brightens a building by how many days away the next
 * gathering there is, so `daysUntil` has to give the same answer on the
 * server, in the client, and in a test.
 */

/** Stored states. `draft` is ours; the rest are schema.org eventStatus. */
export const EVENT_STATUSES = ["draft", "scheduled", "cancelled", "postponed"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const ATTENDANCE_MODES = ["offline", "online", "mixed"] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

export const RSVP_STATUSES = ["going", "maybe", "declined"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

/** States a visitor may see. `draft` never leaves the admin surface. */
export const PUBLIC_STATUSES: EventStatus[] = ["scheduled", "cancelled", "postponed"];

// ── One calendar (0085): every dated thing, one table, one read ─────────────

/**
 * What sort of dated thing a row is. Append-only, in this order: the column
 * is a MySQL enum and enums are ordinal. `gathering` and `festival` are the
 * two a person types in here; the rest are written by their own module and
 * mirrored into the calendar with the source named.
 */
export const CALENDAR_KINDS = [
  "gathering", "quest-window", "festival", "season", "sky", "cycle-mark", "seat-term",
  "call", "loan-due", "notice-end", "milestone", "external", "meet-me",
] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

/** Kinds a person creates by hand on the calendar. Everything else is mirrored. */
export const AUTHORED_KINDS: CalendarKind[] = ["gathering", "festival"];

/**
 * Who may see a row. `village` and `public` are the calendar everyone reads;
 * `circle` and `household` are the layer work L5b builds on; `private` is one
 * person's own (a loan due, a notice end) and reaches only its owner; `admin`
 * is the founders' desk.
 */
export const CALENDAR_LAYERS = ["village", "circle", "household", "private", "admin", "public"] as const;
export type CalendarLayer = (typeof CALENDAR_LAYERS)[number];

/** A single occurrence of a recurring item, changed or cancelled on its own. */
export interface OccurrenceOverride {
  cancelled?: boolean;
  startsAt?: string;
  endsAt?: string | null;
  title?: string;
}

/**
 * Recurring rhythms as first-class objects. Occurrences are materialised on
 * read for the window asked, never stored as rows. Weekday numbers are
 * 0 = Sunday through 6 = Saturday, in village time. `until` is an ISO instant
 * after which nothing recurs; `exceptions` are occurrence keys (village-time
 * YYYY-MM-DD) that are skipped; `overrides` move or cancel one occurrence.
 */
export type Recurrence =
  | { freq: "weekly"; byWeekday: number[]; interval?: number; until?: string | null; exceptions?: string[]; overrides?: Record<string, OccurrenceOverride> }
  | { freq: "monthly"; byMonthDay: number; interval?: number; until?: string | null; exceptions?: string[]; overrides?: Record<string, OccurrenceOverride> }
  | { freq: "lunar"; on: "new_moon" | "full_moon" | "cycle_close"; until?: string | null; exceptions?: string[]; overrides?: Record<string, OccurrenceOverride> }
  | { freq: "solar"; on: "solstice" | "equinox" | "either"; until?: string | null; exceptions?: string[]; overrides?: Record<string, OccurrenceOverride> };

export const RECURRENCE_FREQS = ["weekly", "monthly", "lunar", "solar"] as const;

export interface Gathering {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  locationText: string | null;
  /** Which painted structures on the map this happens in. */
  structureKeys: string[];
  visitTypeId: string | null;
  capacity: number | null;
  status: EventStatus;
  attendanceMode: AttendanceMode;
  onlineUrl: string | null;
  /** Confirmed attendance, counted from `going` rows. */
  goingCount: number;
  /** NULL capacity means uncapped, so this is null too, never a big number. */
  spotsLeft: number | null;
  /** Whole days from now until it starts. Negative once it has begun. */
  daysUntil: number;
  /** This viewer's own answer, absent when signed out. */
  myRsvp?: RsvpStatus | null;
  isExample?: boolean;
  /** 0088: how many people are queued for a seat, on a full gathering. */
  waitlistCount?: number | null;
  /** 0088: this viewer's place in that queue, 1-based; null when not queued. */
  myWaitlistPosition?: number | null;
  /**
   * 0092: what a place costs, in whole units of `seatToken`. 0 is free, which
   * is what a gathering is unless somebody prices it.
   */
  seatPrice?: number;
  /** The token that price is in, and the village's own word for it. */
  seatToken?: string | null;
  seatTokenName?: string | null;
}

// ── 0088: structured slots — what a gathering asks people to bring or hold ──

/**
 * The slot vocabulary. varchar in the table, validated at write time, so a
 * new kind is a code change and never a live enum widening (0006's rule).
 */
export const SLOT_KINDS = ["dish", "ride", "childcare", "setup", "other"] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

export interface EventSlot {
  id: string;
  eventId: string;
  kind: SlotKind;
  label: string;
  /** How many people the slot needs. Signups past it are refused. */
  needed: number;
  note: string | null;
  sortOrder: number;
  isExample: boolean;
  /** Taken places for the occurrence asked about. */
  takenCount: number;
  /** Whether this viewer holds one of them. */
  mine: boolean;
  /**
   * Who took the places. Present only for a viewer who is going to the
   * gathering, or who may manage events; counts travel to everyone else.
   */
  names?: Array<{ userId: string; name: string | null; note: string | null }>;
}

/**
 * A row of the one calendar, or one occurrence of a recurring row. Every
 * field a Gathering has, plus what the calendar added in 0085. `occurrenceKey`
 * is the village-time date of this occurrence and the empty string for a
 * one-off; RSVPs are keyed by it.
 */
export interface CalendarItem extends Gathering {
  kind: CalendarKind;
  layer: CalendarLayer;
  allDay: boolean;
  /** Which module owns the fact this row mirrors, and its id there. Null for a hand-made row. */
  sourceModule: string | null;
  sourceId: string | null;
  /** Where the item points when tapped. */
  link: string | null;
  colour: string | null;
  recurrence: Recurrence | null;
  occurrenceKey: string;
  /** Set on an imported row: which subscription, which upstream UID. */
  external: { sourceId: string; uid: string } | null;
  /** True once the source no longer has this fact. Admin surfaces only. */
  removed?: boolean;
}

/** The lunar position `/api/events` prints beside its window. */
export interface LunarSummary {
  /** 1-based month in the village's lunar year; 13 is the intercalary moon.
   *  YEAR GEOMETRY, and it is what the moon's NAME is keyed by. It is no
   *  longer what a surface prints as the moon number: that is the village's
   *  own count, taken from `cycleNumber` below against the anchor. */
  monthIndex: number;
  /** The settlement-independent lunation number, which is what the village
   *  moon count is computed from (`shared/villageMoon.ts`). Never printed. */
  cycleNumber: number;
  /** Twelve or thirteen: how many moons this lunar year holds. */
  monthCount: number;
  name: string;
  isExampleName: boolean;
  /** 1-based day of the lunar month in village time. */
  day: number;
  /** Civil days the month spans in village time (29 or 30). */
  length: number;
  monthStartsAt: string;
  monthEndsAt: string;
  phase: number;
  phaseName: string;
}

/**
 * Whole days from `now` until `startsAt`, floored toward the past.
 *
 * Calendar days, not 24-hour blocks: something at 9pm tonight and something
 * at 8am tomorrow are "today" and "tomorrow" to a person, and rounding a
 * 13-hour gap to 0 days would call them the same day. Both arguments are
 * normalised to UTC midnight first, which matches how the server stores and
 * compares these (`timezone: 'Z'` on every connection).
 */
export function daysUntil(startsAt: string | Date, now: Date = new Date()): number {
  const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
  if (Number.isNaN(start.getTime())) return 0;
  const day = 86_400_000;
  const startDay = Math.floor(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()) / day);
  const nowDay = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / day);
  return startDay - nowDay;
}

/**
 * The same count in a named zone: whole civil days from `now` to `startsAt`
 * where the village lives. `daysUntil` above stays UTC because the map's
 * lanterns depend on it; the calendar page prints this one, so "tomorrow" is
 * tomorrow in the village and not tomorrow in Greenwich.
 */
export function daysUntilInZone(startsAt: string | Date, timeZone: string, now: Date = new Date()): number {
  const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
  if (Number.isNaN(start.getTime())) return 0;
  const parts = (d: Date) => {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const n = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(n("year"), n("month") - 1, n("day"));
  };
  return Math.round((parts(start) - parts(now)) / 86_400_000);
}

/** Uncapped stays uncapped; a full gathering reports 0, never a negative. */
export function spotsLeft(capacity: number | null, goingCount: number): number | null {
  if (capacity === null || capacity === undefined) return null;
  return Math.max(0, capacity - goingCount);
}

/** Would one more `going` overflow the cap? Uncapped never does. */
export function isFull(capacity: number | null, goingCount: number): boolean {
  if (capacity === null || capacity === undefined) return false;
  return goingCount >= capacity;
}

/**
 * schema.org/Event as JSON-LD.
 *
 * Emitted so a village's calendar is readable by search engines and portable
 * into any other tool that speaks the vocabulary. `draft` returns null: an
 * unpublished gathering must not be marked up for a crawler.
 *
 * `eventStatus` and `eventAttendanceMode` take the full schema.org URLs
 * because the short forms are not valid outside a context that defines them.
 */
export function toSchemaOrg(
  g: Gathering,
  opts: { siteUrl?: string } = {},
): Record<string, unknown> | null {
  if (g.status === "draft") return null;
  const S = "https://schema.org/";
  const statusUrl: Record<Exclude<EventStatus, "draft">, string> = {
    scheduled: `${S}EventScheduled`,
    cancelled: `${S}EventCancelled`,
    postponed: `${S}EventPostponed`,
  };
  const modeUrl: Record<AttendanceMode, string> = {
    offline: `${S}OfflineEventAttendanceMode`,
    online: `${S}OnlineEventAttendanceMode`,
    mixed: `${S}MixedEventAttendanceMode`,
  };

  const doc: Record<string, unknown> = {
    "@context": S.slice(0, -1),
    "@type": "Event",
    name: g.title,
    startDate: g.startsAt,
    eventStatus: statusUrl[g.status as Exclude<EventStatus, "draft">],
    eventAttendanceMode: modeUrl[g.attendanceMode],
  };
  if (g.description) doc.description = g.description;
  if (g.endsAt) doc.endDate = g.endsAt;
  if (g.capacity !== null) doc.maximumAttendeeCapacity = g.capacity;
  if (g.locationText) doc.location = { "@type": "Place", name: g.locationText };
  // An online gathering's "place" IS its URL, which is what VirtualLocation
  // exists for. A mixed one carries both, so the physical entry above stays.
  if (g.onlineUrl && g.attendanceMode !== "offline") {
    const virtual = { "@type": "VirtualLocation", url: g.onlineUrl };
    doc.location = doc.location ? [doc.location, virtual] : virtual;
  }
  if (opts.siteUrl) doc.url = `${opts.siteUrl.replace(/\/$/, "")}/events/${g.id}`;
  return doc;
}
