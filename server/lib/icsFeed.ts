/**
 * The village calendar as an .ics feed (0085, §5 item 10): RFC 5545 written
 * by hand, so the one dependency (ical.js) is the PARSER we test ourselves
 * against and never the writer of what we ship.
 *
 * Every VEVENT carries UID, DTSTAMP, DTSTART, SEQUENCE and a SUMMARY; the
 * DESCRIPTION names the lunar month ("Moon 8, Sturgeon Moon, day 5 of 29")
 * because that is what makes this feed the village's and not any calendar's.
 * A weekly or monthly rhythm leaves as one RRULE in the village's zone, with
 * a VTIMEZONE built from the zone's real transitions so a subscriber's
 * calendar keeps the wall-clock time across a daylight change; a lunar or
 * solar rhythm leaves as expanded instances, since no RRULE can say "every
 * full moon". Lines are CRLF, folded at 75 octets, escaped per the RFC.
 *
 * Nothing here reads a database or a clock it was not handed. The route
 * gathers rows through the one calendar read and passes them in.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { CalendarItem, CalendarKind } from "../../shared/gatherings";
import { civilParts, zonedTimeToUtc, type YearAnchor } from "../../shared/lunar";
import { expandOccurrences, type CalendarRow } from "./calendar";
import { lunarSummaryFor, type MonthName } from "./lunarTable";
import { moonCountLabel } from "../../shared/villageMoon";

export interface IcsOptions {
  /** X-WR-CALNAME: what a subscriber's app shows. */
  calendarName: string;
  /** The village's IANA zone. RRULEs and all-day dates live in it. */
  timezone: string;
  anchor: YearAnchor;
  hemisphere: "north" | "south";
  names: MonthName[];
  /** The lunation this village calls Moon 1, or null while it has not set one.
   *  REQUIRED rather than optional: a subscriber's calendar would otherwise
   *  silently lose every moon number the day a caller forgot to pass it. */
  moonOneCycle: number | null;
  /** UIDs are `<row id>@<host>`; the host is the village's. */
  host: string;
  /** Where an item's page lives, for URL. */
  siteUrl?: string | null;
  /** The window instances are expanded for. */
  from: Date;
  to: Date;
  now?: Date;
}

const CRLF = "\r\n";

/** RFC 5545 §3.3.11 TEXT escaping. */
export function icsEscape(v: string): string {
  return String(v)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n?|\n/g, "\\n")
    // Any other control character has no place in a TEXT value and could
    // only be there to break the line grammar.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/** A URL value: one that could end the line or start another is dropped whole. */
const hasControlOrSpace = (t: string): boolean =>
  Array.from(t).some((ch) => { const c = ch.charCodeAt(0); return c < 32 || c === 127 || /\s/.test(ch); });

const icsUrl = (v: string): string | null => {
  const t = String(v);
  if (!t || hasControlOrSpace(t)) return null;
  return /^https:\/\//.test(t) || t.startsWith("/") ? t : null;
};

/** RFC 5545 §3.1: lines fold at 75 octets, continuation lines begin with a space. */
export function icsFold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  let first = true;
  while (i < bytes.length) {
    const limit = first ? 75 : 74;
    let end = Math.min(bytes.length, i + limit);
    // Never split a multi-byte character: back off to a boundary.
    while (end < bytes.length && end > i && (bytes[end] & 0xc0) === 0x80) end -= 1;
    out.push((first ? "" : " ") + bytes.subarray(i, end).toString("utf8"));
    i = end;
    first = false;
  }
  return out.join(CRLF);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 20260818T190000Z */
export function icsUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** 20260818T190000 in the zone (a floating-form value for a TZID property). */
export function icsLocal(d: Date, timeZone: string): string {
  const c = civilParts(d, timeZone);
  return `${c.year}${pad(c.month)}${pad(c.day)}T${pad(c.hour)}${pad(c.minute)}00`;
}

/** 20260818 in the zone. */
export function icsDate(d: Date, timeZone: string): string {
  const c = civilParts(d, timeZone);
  return `${c.year}${pad(c.month)}${pad(c.day)}`;
}

const WEEKDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// ── VTIMEZONE from the zone's real transitions ──────────────────────────────

const offsetAt = (ms: number, timeZone: string): number => {
  const c = civilParts(new Date(ms), timeZone);
  return Math.round((Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute) - ms) / 60_000);
};

const fmtOffset = (minutes: number): string => {
  const sign = minutes < 0 ? "-" : "+";
  const a = Math.abs(minutes);
  return `${sign}${pad(Math.floor(a / 60))}${pad(a % 60)}`;
};

/**
 * A VTIMEZONE for an IANA zone, from observed offsets: transitions are
 * found by scanning day by day across the window and bisecting to the
 * minute, then listed as RDATEs under one STANDARD and one DAYLIGHT block.
 * A zone with no change in the window is one STANDARD block. Enough for
 * every subscriber to place a wall-clock RRULE correctly.
 */
export function icsTimezone(timeZone: string, from: Date, to: Date): string[] {
  const start = from.getTime() - 366 * 86_400_000;
  const end = to.getTime() + 366 * 86_400_000;
  const DAY = 86_400_000;
  const transitions: Array<{ at: number; fromOffset: number; toOffset: number }> = [];
  let prev = offsetAt(start, timeZone);
  for (let t = start + DAY; t <= end; t += DAY) {
    const cur = offsetAt(t, timeZone);
    if (cur === prev) continue;
    // Bisect the day to the minute.
    let lo = t - DAY;
    let hi = t;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 2 / 60_000) * 60_000;
      if (offsetAt(mid, timeZone) === prev) lo = mid; else hi = mid;
    }
    transitions.push({ at: hi, fromOffset: prev, toOffset: cur });
    prev = cur;
  }
  const lines = ["BEGIN:VTIMEZONE", `TZID:${timeZone}`];
  if (!transitions.length) {
    const off = fmtOffset(offsetAt(start, timeZone));
    lines.push("BEGIN:STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${off}`, `TZOFFSETTO:${off}`, "END:STANDARD");
  } else {
    // Group by direction: an offset increase is DAYLIGHT, a decrease STANDARD.
    for (const kind of ["STANDARD", "DAYLIGHT"] as const) {
      const mine = transitions.filter((tr) => (kind === "DAYLIGHT") === tr.toOffset > tr.fromOffset);
      if (!mine.length) continue;
      const first = mine[0];
      // DTSTART and RDATE are the LOCAL wall time before the change.
      const local = (tr: { at: number; fromOffset: number }) => {
        const l = new Date(tr.at + tr.fromOffset * 60_000);
        return `${l.getUTCFullYear()}${pad(l.getUTCMonth() + 1)}${pad(l.getUTCDate())}T${pad(l.getUTCHours())}${pad(l.getUTCMinutes())}00`;
      };
      lines.push(`BEGIN:${kind}`, `DTSTART:${local(first)}`, `TZOFFSETFROM:${fmtOffset(first.fromOffset)}`, `TZOFFSETTO:${fmtOffset(first.toOffset)}`);
      lines.push(`RDATE:${mine.map(local).join(",")}`);
      lines.push(`END:${kind}`);
    }
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

// ── The events ──────────────────────────────────────────────────────────────

function statusOf(status: string): string {
  if (status === "cancelled") return "CANCELLED";
  if (status === "postponed") return "TENTATIVE";
  return "CONFIRMED";
}

function categoryOf(kind: CalendarKind): string {
  return kind.replace(/-/g, " ");
}

interface EventLines {
  uid: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  summary: string;
  description: string;
  location: string | null;
  url: string | null;
  status: string;
  category: string;
  sequence: number;
  rrule?: string;
  exdates?: Date[];
  recurrenceId?: Date;
  colour?: string | null;
}

/*
 * ONE MOON NUMBER, the village's own count, and no "of twelve" behind it.
 *
 * This read "Moon 8 of 12, Sturgeon Moon, day 11 of 29." The 8 was the moon's
 * place in the lunar year and it reset every year, so two lines a year apart
 * in a subscriber's calendar carried the same number for different moons. The
 * count since founding does not reset, which makes "of 12" meaningless beside
 * it: a lunar year still holds twelve or thirteen moons, and that is year
 * geometry rather than a coordinate anybody dates a gathering by.
 *
 * A village with no first moon set prints the name and the day and no number,
 * which is `moonCountLabel` returning an empty string.
 */
function moonLine(at: Date, opts: IcsOptions): string {
  const s = lunarSummaryFor(at, { anchor: opts.anchor, timezone: opts.timezone, hemisphere: opts.hemisphere, names: opts.names });
  if (!s) return "";
  const head = [moonCountLabel(s.cycleNumber, opts.moonOneCycle), s.name].filter(Boolean).join(", ");
  return `${head ? `${head}, ` : ""}day ${s.day} of ${s.length}.`;
}

function vevent(e: EventLines, opts: IcsOptions, stamp: string): string[] {
  const tz = opts.timezone;
  const lines: string[] = ["BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`, `SEQUENCE:${e.sequence}`];
  if (e.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(e.start, tz)}`);
    if (e.end) lines.push(`DTEND;VALUE=DATE:${icsDate(e.end, tz)}`);
  } else if (e.rrule) {
    // A wall-clock rhythm: local form with TZID, so the VTIMEZONE places it.
    lines.push(`DTSTART;TZID=${tz}:${icsLocal(e.start, tz)}`);
    if (e.end) lines.push(`DTEND;TZID=${tz}:${icsLocal(e.end, tz)}`);
    lines.push(`RRULE:${e.rrule}`);
    if (e.exdates?.length) lines.push(`EXDATE;TZID=${tz}:${e.exdates.map((d) => icsLocal(d, tz)).join(",")}`);
  } else {
    lines.push(`DTSTART:${icsUtc(e.start)}`);
    if (e.end) lines.push(`DTEND:${icsUtc(e.end)}`);
  }
  if (e.recurrenceId) lines.push(`RECURRENCE-ID;TZID=${tz}:${icsLocal(e.recurrenceId, tz)}`);
  lines.push(`SUMMARY:${icsEscape(e.summary)}`);
  if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
  if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
  const url = e.url ? icsUrl(e.url) : null;
  if (url) lines.push(`URL:${url}`);
  lines.push(`STATUS:${e.status}`, `CATEGORIES:${icsEscape(e.category)}`);
  if (e.colour) lines.push(`COLOR:${icsEscape(e.colour)}`);
  lines.push("END:VEVENT");
  return lines;
}

const sequenceOf = (row: CalendarRow) => Math.max(0, Math.floor(row.updatedAt.getTime() / 60_000));

/** The RRULE for a weekly or monthly recurrence, or null for the others. */
export function rruleFor(row: CalendarRow): string | null {
  const r = row.recurrence;
  if (!r) return null;
  const until = r.until ? `;UNTIL=${icsUtc(new Date(r.until))}` : "";
  if (r.freq === "weekly") {
    const interval = r.interval && r.interval > 1 ? `;INTERVAL=${r.interval}` : "";
    return `FREQ=WEEKLY${interval};BYDAY=${r.byWeekday.map((d) => WEEKDAY[d]).join(",")}${until}`;
  }
  if (r.freq === "monthly") {
    const interval = r.interval && r.interval > 1 ? `;INTERVAL=${r.interval}` : "";
    return `FREQ=MONTHLY${interval};BYMONTHDAY=${r.byMonthDay}${until}`;
  }
  return null;
}

/**
 * The whole calendar as one .ics document. Rows are the visible base rows;
 * one-offs and wall-clock rhythms leave as themselves, sky rhythms as
 * instances inside [from, to).
 */
export function buildIcs(rows: CalendarRow[], opts: IcsOptions): string {
  const now = opts.now ?? new Date();
  const stamp = icsUtc(now);
  const tz = opts.timezone;
  const link = (row: CalendarRow) => {
    if (row.link && /^https:\/\//.test(row.link)) return row.link;
    if (row.link && row.link.startsWith("/") && opts.siteUrl) return `${opts.siteUrl.replace(/\/$/, "")}${row.link}`;
    if (opts.siteUrl && (row.kind === "gathering" || row.kind === "festival")) return `${opts.siteUrl.replace(/\/$/, "")}/events`;
    return null;
  };
  const describe = (row: CalendarRow, at: Date, extra?: string) =>
    [moonLine(at, opts), row.description ?? "", extra ?? ""].filter(Boolean).join("\n");

  const out: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//village calendar//0085//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(opts.calendarName)}`,
    `X-WR-TIMEZONE:${tz}`,
    ...icsTimezone(tz, opts.from, opts.to),
  ];

  for (const row of rows) {
    const uid = `${row.id}@${opts.host}`;
    const rrule = rruleFor(row);
    if (rrule) {
      const rec = row.recurrence!;
      const overrides = rec.overrides ?? {};
      // Exceptions and cancelled or moved occurrences leave the rule as EXDATE.
      const exdates: Date[] = [];
      const moved: EventLines[] = [];
      const base = civilParts(row.startsAt, tz);
      const durationMs = row.endsAt ? row.endsAt.getTime() - row.startsAt.getTime() : null;
      const keys = Array.from(new Set<string>([...(rec.exceptions ?? []), ...Object.keys(overrides)]));
      for (const key of keys) {
        const [y, m, d] = key.split("-").map(Number);
        const original = zonedTimeToUtc(y, m, d, base.hour, base.minute, tz);
        const ov = overrides[key];
        if (!ov || ov.cancelled) { exdates.push(original); continue; }
        // A moved or retitled instance: its own VEVENT bound by RECURRENCE-ID.
        const start = ov.startsAt ? new Date(ov.startsAt) : original;
        const end = ov.endsAt !== undefined ? (ov.endsAt ? new Date(ov.endsAt) : null) : durationMs === null ? null : new Date(start.getTime() + durationMs);
        moved.push({
          uid, start, end, allDay: false, summary: ov.title ?? row.title,
          description: describe(row, start), location: row.locationText, url: link(row),
          status: statusOf(row.status), category: categoryOf(row.kind), sequence: sequenceOf(row) + 1, recurrenceId: original, colour: row.colour,
        });
      }
      out.push(...vevent({
        uid, start: row.startsAt, end: row.endsAt, allDay: false, summary: row.title,
        description: describe(row, row.startsAt, "Repeats."), location: row.locationText, url: link(row),
        status: statusOf(row.status), category: categoryOf(row.kind), sequence: sequenceOf(row), rrule, exdates, colour: row.colour,
      }, opts, stamp));
      for (const m of moved) out.push(...vevent(m, opts, stamp));
      continue;
    }
    if (row.recurrence) {
      // Lunar and solar rhythms: no RRULE can say them, so each instance is its own event.
      for (const occ of expandOccurrences(row, opts.from, opts.to, tz)) {
        out.push(...vevent({
          uid: `${row.id}-${occ.occurrenceKey}@${opts.host}`, start: occ.startsAt, end: occ.endsAt, allDay: row.allDay,
          summary: occ.title, description: describe(row, occ.startsAt), location: row.locationText, url: link(row),
          status: occ.cancelled ? "CANCELLED" : statusOf(row.status), category: categoryOf(row.kind), sequence: sequenceOf(row), colour: row.colour,
        }, opts, stamp));
      }
      continue;
    }
    out.push(...vevent({
      uid, start: row.startsAt, end: row.endsAt, allDay: row.allDay, summary: row.title,
      description: describe(row, row.startsAt), location: row.locationText, url: link(row),
      status: statusOf(row.status), category: categoryOf(row.kind), sequence: sequenceOf(row), colour: row.colour,
    }, opts, stamp));
  }

  out.push("END:VCALENDAR");
  return out.map(icsFold).join(CRLF) + CRLF;
}

/** Items (already expanded) as a plain instance list; used by tests and small feeds. */
export function itemsToRows(items: CalendarItem[]): CalendarRow[] {
  return items.map((i) => ({
    id: i.occurrenceKey ? `${i.id}-${i.occurrenceKey}` : i.id,
    title: i.title,
    description: i.description,
    startsAt: new Date(i.startsAt),
    endsAt: i.endsAt ? new Date(i.endsAt) : null,
    locationText: i.locationText,
    structureKeys: i.structureKeys,
    visitTypeId: i.visitTypeId,
    capacity: i.capacity,
    status: i.status,
    attendanceMode: i.attendanceMode,
    onlineUrl: i.onlineUrl,
    isExample: Boolean(i.isExample),
    kind: i.kind,
    layer: i.layer,
    ownerUserId: null,
    allDay: i.allDay,
    sourceModule: i.sourceModule,
    sourceId: i.sourceId,
    link: i.link,
    colour: i.colour,
    recurrence: null,
    externalSourceId: i.external?.sourceId ?? null,
    externalUid: i.external?.uid ?? null,
    removedAt: null,
    updatedAt: new Date(0),
    // 0092: a seat fee is a fact about the gathering and the .ics feed carries
    // no offers, so it travels as free. Stated rather than defaulted, because
    // a calendar file that quietly implied a price would be worse than one
    // that says nothing.
    seatPrice: 0,
    seatToken: null,
  }));
}

// ── The signed-in feed's key ────────────────────────────────────────────────
//
// 32 random bytes, shown once, stored as a sha256. The public feed needs no
// key; this one adds the layers a member may see. One live key per member:
// minting a new one retires the old, and revoking leaves nothing live. The
// raw token is never logged and never stored; a leaked address is revoked
// here and dies.

const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** True for the shape a minted token has: 64 hex characters. */
export function looksLikeFeedToken(raw: unknown): raw is string {
  return typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw);
}

export async function mintFeedToken(pool: Pool, userId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await pool.query(
    "UPDATE calendar_feed_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL",
    [userId],
  );
  await pool.query(
    "INSERT INTO calendar_feed_tokens (id, user_id, token_hash) VALUES (?,?,?)",
    [`ft-${Date.now()}-${randomBytes(3).toString("hex")}`, userId, hashToken(raw)],
  );
  return raw;
}

export async function revokeFeedTokens(pool: Pool, userId: string): Promise<number> {
  const [res] = await pool.query<any>(
    "UPDATE calendar_feed_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL",
    [userId],
  );
  return Number(res?.affectedRows ?? 0);
}

export async function feedTokenStatus(pool: Pool, userId: string): Promise<{ hasToken: boolean; createdAt: string | null }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT created_at FROM calendar_feed_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [userId],
  );
  if (!rows.length) return { hasToken: false, createdAt: null };
  const c = rows[0].created_at;
  return { hasToken: true, createdAt: c instanceof Date ? c.toISOString() : String(c) };
}

/** The member a live token belongs to, or null. Touches last_used_at. */
export async function resolveFeedToken(pool: Pool, raw: string): Promise<string | null> {
  if (!looksLikeFeedToken(raw)) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, user_id FROM calendar_feed_tokens WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1",
    [hashToken(raw)],
  );
  if (!rows.length) return null;
  await pool.query("UPDATE calendar_feed_tokens SET last_used_at = UTC_TIMESTAMP() WHERE id = ?", [rows[0].id]).catch(() => {});
  return String(rows[0].user_id);
}
