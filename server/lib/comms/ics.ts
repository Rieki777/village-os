/**
 * ONE GATHERING AS A CALENDAR INVITATION: the `.ics` file a confirmation, a
 * change and a cancellation carry, and the add-to-calendar links beside it
 * (the comms build spec 5.7).
 *
 * WHAT THE FILE SAYS. One VEVENT inside a VCALENDAR whose METHOD is REQUEST
 * (put this in your calendar, or update it) or CANCEL (take it out):
 *
 *   UID        `<eventId>-<occurrenceKey>@<host>`, stable for the life of the
 *              occurrence, so every later file about it replaces the first
 *              entry instead of adding a second. A one-off's occurrence key
 *              is empty, so its UID reads `<eventId>-@<host>`. It never equals
 *              a UID the village's subscribed feed (server/lib/icsFeed.ts)
 *              writes for a one-off or a weekly rhythm, whose SEQUENCE counts
 *              minutes and would make a calendar app read ours as stale.
 *   SEQUENCE   `event_comms.ics_sequence`: bumped on every change of time or
 *              place and on a cancellation, so a calendar app takes the newer
 *              file over the older one.
 *   DTSTART, DTEND  the occurrence's own start and end in UTC. An all-day
 *              gathering is written as dates in the village's zone instead.
 *              A gathering with no end gets no DTEND: the file says nothing
 *              the gathering did not.
 *   SUMMARY, LOCATION, URL, DESCRIPTION  its title, place, page and words,
 *              with the online room's join link added to the description.
 *   ORGANIZER  the village, at its sender address, and ATTENDEE the reader,
 *              already accepted and asked for no reply. Both are what the
 *              invitation standard (RFC 5546) requires of a REQUEST and a
 *              CANCEL, and without them some mail clients refuse the file.
 *
 * The writing rules are the feed's, reused from server/lib/icsFeed.ts: CRLF
 * lines folded at 75 octets, TEXT escaped, control characters dropped, so a
 * title cannot start a new property.
 *
 * Pure: nothing here reads a database or a clock it was not handed.
 */
import type { MergeLink } from "../../../shared/comms/mergeFields";
import { civilParts } from "../../../shared/lunar";
import { icsEscape, icsFold, icsUtc } from "../icsFeed";

export type IcsMethod = "REQUEST" | "CANCEL";

/** One occurrence of a gathering, as a calendar file needs it. */
export interface IcsGathering {
  eventId: string;
  /** The village-time date of one evening of a series, or "" for a one-off. */
  occurrenceKey: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  /** The village's IANA zone: an all-day gathering's dates are read in it. */
  timezone: string;
  location: string | null;
  /** The gathering's page. */
  url: string | null;
  /** The host's words, as plain text. */
  description: string | null;
  /** The link into the online room (`/api/events/<id>/join`), when it meets online. */
  joinUrl?: string | null;
}

export interface IcsInvite {
  method: IcsMethod;
  sequence: number;
  /** The village's host name, for the UID. */
  host: string;
  /** The village, at the address its email leaves from. Left out when there is none. */
  organizer?: { name: string; email: string } | null;
  /** The reader. Left out when unknown. */
  attendee?: { name: string | null; email: string } | null;
  /** DTSTAMP. Tests pin it. */
  now?: Date;
}

const CRLF = "\r\n";
const pad = (n: number) => String(n).padStart(2, "0");

/** The host part of a village's origin, the way the feed derives it. */
export function hostOf(origin: string): string {
  try {
    const host = new URL(String(origin ?? "")).host;
    return host || "village";
  } catch {
    return "village";
  }
}

/** The occurrence's stable UID. */
export function icsUid(eventId: string, occurrenceKey: string, host: string): string {
  return `${eventId}-${occurrenceKey}@${host}`;
}

/** 20261004 for an instant, in the zone. */
function icsDay(d: Date, timeZone: string): string {
  const c = civilParts(d, timeZone);
  return `${c.year}${pad(c.month)}${pad(c.day)}`;
}

/** The day after a YYYYMMDD date, as YYYYMMDD. */
function nextDay(yyyymmdd: string): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
}

/** A parameter value for CN: quoted, with any quote taken out, one line. */
function cn(name: string): string {
  const clean = String(name ?? "").replace(/["\r\n]/g, "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean ? `;CN="${clean.slice(0, 120)}"` : "";
}

/** An address fit for a mailto: value, or null. */
function mailtoOf(email: string | null | undefined): string | null {
  const e = String(email ?? "").trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e) ? `mailto:${e}` : null;
}

/** A URL value: https, or http on a development site. Anything that could break the line grammar is dropped. */
function icsUrlValue(v: string | null | undefined): string | null {
  const t = String(v ?? "").trim();
  if (!t || /[\s\u0000-\u001f\u007f]/.test(t)) return null;
  return /^https?:\/\//.test(t) ? t : null;
}

/** The description the file carries: the host's words, then the online room. */
function descriptionOf(g: IcsGathering): string {
  const parts: string[] = [];
  if (g.description && g.description.trim()) parts.push(g.description.trim());
  const join = icsUrlValue(g.joinUrl);
  if (join) parts.push(`Join online: ${join}`);
  const page = icsUrlValue(g.url);
  if (page) parts.push(page);
  return parts.join("\n\n");
}

/** The calendar file for one occurrence, as text. */
export function buildGatheringIcs(g: IcsGathering, inv: IcsInvite): string {
  const now = inv.now ?? new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//village comms//gathering//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${inv.method}`,
    "BEGIN:VEVENT",
    `UID:${icsUid(g.eventId, g.occurrenceKey, inv.host)}`,
    `DTSTAMP:${icsUtc(now)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(inv.sequence))}`,
  ];
  if (g.allDay) {
    const start = icsDay(g.startsAt, g.timezone);
    // DTEND of an all-day event is the day AFTER the last day it covers.
    const last = g.endsAt ? icsDay(g.endsAt, g.timezone) : start;
    lines.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${nextDay(last < start ? start : last)}`);
  } else {
    lines.push(`DTSTART:${icsUtc(g.startsAt)}`);
    if (g.endsAt && g.endsAt.getTime() > g.startsAt.getTime()) lines.push(`DTEND:${icsUtc(g.endsAt)}`);
  }
  lines.push(`SUMMARY:${icsEscape(g.title)}`);
  if (g.location && g.location.trim()) lines.push(`LOCATION:${icsEscape(g.location.trim())}`);
  const url = icsUrlValue(g.url);
  if (url) lines.push(`URL:${url}`);
  const description = descriptionOf(g);
  if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
  const organizer = inv.organizer ? mailtoOf(inv.organizer.email) : null;
  if (organizer) lines.push(`ORGANIZER${cn(inv.organizer!.name)}:${organizer}`);
  const attendee = inv.attendee ? mailtoOf(inv.attendee.email) : null;
  if (attendee) {
    lines.push(`ATTENDEE${cn(inv.attendee!.name ?? "")};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:${attendee}`);
  }
  lines.push(`STATUS:${inv.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`, "TRANSP:OPAQUE", "END:VEVENT", "END:VCALENDAR");
  return lines.map(icsFold).join(CRLF) + CRLF;
}

/** The file as an email attachment. */
export function icsAttachment(ics: string, method: IcsMethod): { filename: string; contentType: string; contentBase64: string } {
  return {
    filename: method === "CANCEL" ? "cancelled.ics" : "invite.ics",
    contentType: `text/calendar; charset=utf-8; method=${method}`,
    contentBase64: Buffer.from(ics, "utf8").toString("base64"),
  };
}

// ── Add-to-calendar links ───────────────────────────────────────────────────

/** The widest link the merge fields will write (shared/comms/mergeFields.ts refuses longer). */
const MAX_LINK = 1900;

/**
 * A query string with every value percent-encoded. Not URLSearchParams, which
 * writes a space as `+`: Google reads that as a space and Outlook's compose
 * page does not.
 */
function query(pairs: Array<[string, string]>): string {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

/** Words for a link's details, shortened until the link fits. */
function fitted(build: (details: string) => string, details: string): string {
  let text = details;
  for (let i = 0; i < 6; i++) {
    const link = build(text);
    if (link.length <= MAX_LINK) return link;
    text = text.slice(0, Math.floor(text.length / 2)).trimEnd();
  }
  return build("");
}

/** Google Calendar's and Outlook's own "add this event" pages, filled in. */
export function calendarLinks(g: IcsGathering): MergeLink[] {
  const title = g.title.slice(0, 200);
  const location = (g.location ?? "").slice(0, 200);
  const details = descriptionOf(g).slice(0, 600);
  const end = g.endsAt && g.endsAt.getTime() > g.startsAt.getTime() ? g.endsAt : g.startsAt;

  const googleDates = g.allDay
    ? `${icsDay(g.startsAt, g.timezone)}/${nextDay(icsDay(end, g.timezone))}`
    : `${icsUtc(g.startsAt)}/${icsUtc(end)}`;
  const google = fitted((d) => {
    const q: Array<[string, string]> = [["action", "TEMPLATE"], ["text", title], ["dates", googleDates]];
    if (d) q.push(["details", d]);
    if (location) q.push(["location", location]);
    return `https://calendar.google.com/calendar/render?${query(q)}`;
  }, details);

  const outlook = fitted((d) => {
    const q: Array<[string, string]> = [["path", "/calendar/action/compose"], ["rru", "addevent"], ["subject", title]];
    if (g.allDay) {
      const day = (x: Date) => {
        const c = civilParts(x, g.timezone);
        return `${c.year}-${pad(c.month)}-${pad(c.day)}`;
      };
      q.push(["startdt", day(g.startsAt)], ["enddt", day(end)], ["allday", "true"]);
    } else {
      q.push(["startdt", g.startsAt.toISOString()], ["enddt", end.toISOString()]);
    }
    if (d) q.push(["body", d]);
    if (location) q.push(["location", location]);
    return `https://outlook.live.com/calendar/0/deeplink/compose?${query(q)}`;
  }, details);

  return [
    { label: "Google Calendar", href: google },
    { label: "Outlook", href: outlook },
  ];
}
