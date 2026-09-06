/**
 * The village's one calendar (0085): every dated thing in one table, behind
 * one read.
 *
 * Round 4, lane L5a. The `events` table (0059) grew from a calendar of
 * gatherings into the calendar of everything: quest windows, the sky, cycle
 * marks, seat terms, loans due, imported calendars. Three doors into it:
 *
 *   calendarUpsert    a module writes its dated fact here, idempotent on
 *                     (source_module, source_id); the fact stays authoritative
 *                     on the module's own row and is MIRRORED, never moved.
 *   calendarRemove    the fact is gone upstream; the row is marked, not
 *                     deleted, so RSVPs and audit rows keep pointing somewhere.
 *   listCalendarItems THE read. It materialises recurrence for the window
 *                     asked, applies layer visibility over status and module
 *                     gating, counts RSVPs per occurrence and hands back one
 *                     shape. The .ics feed, the wheel, the week and month
 *                     views, What's On, and the assistant's reader (L6) all
 *                     call this and nothing else computes its own dates.
 *
 * gatherings.ts keeps the write side people type into (create, update, RSVP,
 * check-in) and its list is a thin call over listCalendarItems.
 *
 * Time is stored in UTC as it always was. Windows and occurrence keys are in
 * the village's zone (SeasonConfig.timezone), passed in by the caller: this
 * module never reads config, so a test can hand it any zone and any clock.
 */
import { createHash } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { tokenDef } from "./ledger";
import {
  AUTHORED_KINDS,
  CALENDAR_KINDS,
  CALENDAR_LAYERS,
  EVENT_STATUSES,
  PUBLIC_STATUSES,
  daysUntil,
  spotsLeft,
  type AttendanceMode,
  type CalendarItem,
  type CalendarKind,
  type CalendarLayer,
  type EventStatus,
  type OccurrenceOverride,
  type Recurrence,
  type RsvpStatus,
} from "../../shared/gatherings";
import {
  civilDateKey,
  civilParts,
  fullMoonsBetween,
  newMoonsBetween,
  seasonInstants,
  zonedTimeToUtc,
} from "../../shared/lunar";
import { activeClock } from "./gratitude-cycles";

// ── Row shape ───────────────────────────────────────────────────────────────

/** JSON columns come back parsed on some driver versions and as text on others. */
function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }
  return raw as T;
}

function parseKeys(raw: unknown): string[] {
  const v = parseJson<unknown>(raw, []);
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
}

/** datetime columns come back as Date; ISO is what every reader wants. */
export const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v ?? "");

const isKind = (v: unknown): v is CalendarKind => CALENDAR_KINDS.includes(v as CalendarKind);
const isLayer = (v: unknown): v is CalendarLayer => CALENDAR_LAYERS.includes(v as CalendarLayer);

/** A recurrence document as stored, or null when it is not one we understand. */
export function cleanRecurrence(raw: unknown): Recurrence | null {
  const r = parseJson<any>(raw, null);
  if (!r || typeof r !== "object" || typeof r.freq !== "string") return null;
  const common = {
    ...(typeof r.until === "string" && !Number.isNaN(new Date(r.until).getTime()) ? { until: new Date(r.until).toISOString() } : {}),
    ...(Array.isArray(r.exceptions) ? { exceptions: r.exceptions.filter((k: unknown) => typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k)) } : {}),
    ...(r.overrides && typeof r.overrides === "object" && !Array.isArray(r.overrides)
      ? {
          overrides: Object.fromEntries(
            Object.entries(r.overrides as Record<string, any>)
              .filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && v && typeof v === "object")
              .map(([k, v]) => [k, {
                ...(v.cancelled ? { cancelled: true } : {}),
                ...(typeof v.startsAt === "string" && !Number.isNaN(new Date(v.startsAt).getTime()) ? { startsAt: new Date(v.startsAt).toISOString() } : {}),
                ...(v.endsAt === null ? { endsAt: null } : typeof v.endsAt === "string" && !Number.isNaN(new Date(v.endsAt).getTime()) ? { endsAt: new Date(v.endsAt).toISOString() } : {}),
                ...(typeof v.title === "string" && v.title.trim() ? { title: v.title.trim().slice(0, 200) } : {}),
              } as OccurrenceOverride]),
          ),
        }
      : {}),
  };
  switch (r.freq) {
    case "weekly": {
      const days = Array.isArray(r.byWeekday) ? r.byWeekday.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
      if (!days.length) return null;
      const interval = Number.isInteger(r.interval) && r.interval >= 1 && r.interval <= 52 ? r.interval : 1;
      return { freq: "weekly", byWeekday: Array.from(new Set<number>(days)).sort(), interval, ...common };
    }
    case "monthly": {
      const d = Number(r.byMonthDay);
      if (!Number.isInteger(d) || d < 1 || d > 31) return null;
      const interval = Number.isInteger(r.interval) && r.interval >= 1 && r.interval <= 12 ? r.interval : 1;
      return { freq: "monthly", byMonthDay: d, interval, ...common };
    }
    case "lunar":
      if (!["new_moon", "full_moon", "cycle_close"].includes(r.on)) return null;
      return { freq: "lunar", on: r.on, ...common };
    case "solar":
      if (!["solstice", "equinox", "either"].includes(r.on)) return null;
      return { freq: "solar", on: r.on, ...common };
    default:
      return null;
  }
}

/** One row of the calendar, before occurrence expansion. */
export interface CalendarRow {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  locationText: string | null;
  structureKeys: string[];
  visitTypeId: string | null;
  capacity: number | null;
  status: EventStatus;
  attendanceMode: AttendanceMode;
  onlineUrl: string | null;
  isExample: boolean;
  kind: CalendarKind;
  layer: CalendarLayer;
  ownerUserId: string | null;
  allDay: boolean;
  sourceModule: string | null;
  sourceId: string | null;
  link: string | null;
  colour: string | null;
  recurrence: Recurrence | null;
  externalSourceId: string | null;
  externalUid: string | null;
  removedAt: Date | null;
  /** When the row last changed; the .ics feed's SEQUENCE comes from it. */
  updatedAt: Date;
  /** 0092: what a place at this gathering costs. 0 means free. */
  seatPrice: number;
  seatToken: string | null;
}

export function rowToCalendarRow(r: RowDataPacket): CalendarRow {
  return {
    id: String(r.id),
    title: String(r.title),
    description: r.description ?? null,
    startsAt: r.starts_at instanceof Date ? r.starts_at : new Date(r.starts_at),
    endsAt: r.ends_at ? (r.ends_at instanceof Date ? r.ends_at : new Date(r.ends_at)) : null,
    locationText: r.location_text ?? null,
    structureKeys: parseKeys(r.structure_keys),
    visitTypeId: r.visit_type_id ?? null,
    capacity: r.capacity === null || r.capacity === undefined ? null : Number(r.capacity),
    status: EVENT_STATUSES.includes(r.status) ? (r.status as EventStatus) : "draft",
    attendanceMode: String(r.attendance_mode ?? "offline") as AttendanceMode,
    onlineUrl: r.online_url ?? null,
    isExample: Boolean(r.is_example),
    kind: isKind(r.kind) ? r.kind : "gathering",
    layer: isLayer(r.layer) ? r.layer : "village",
    ownerUserId: r.owner_user_id ?? null,
    allDay: Boolean(r.all_day),
    sourceModule: r.source_module ?? null,
    sourceId: r.source_id ?? null,
    link: r.link ?? null,
    colour: r.colour ?? null,
    recurrence: cleanRecurrence(r.recurrence),
    externalSourceId: r.external_source_id ?? null,
    externalUid: r.external_uid ?? null,
    removedAt: r.removed_at ? (r.removed_at instanceof Date ? r.removed_at : new Date(r.removed_at)) : null,
    updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at ?? Date.now()),
    seatPrice: Math.max(0, Math.trunc(Number(r.seat_price ?? 0))),
    seatToken: r.seat_token ?? null,
  };
}

/** The columns every calendar read selects. */
export const CALENDAR_COLS = "e.*";

// ── Occurrences ─────────────────────────────────────────────────────────────

export interface Occurrence {
  row: CalendarRow;
  /** Village-time YYYY-MM-DD; "" for a one-off. */
  occurrenceKey: string;
  startsAt: Date;
  endsAt: Date | null;
  title: string;
  cancelled: boolean;
}

/** Whether a start instant lies inside [from, to) once the duration is applied. */
function overlaps(startsAt: Date, endsAt: Date | null, from: Date, to: Date): boolean {
  const end = endsAt ?? startsAt;
  return startsAt.getTime() < to.getTime() && end.getTime() >= from.getTime();
}

/**
 * The instants a recurrence fires on inside [from, to), in village time: a
 * weekly rhythm keeps its wall-clock time across a daylight change, and a
 * lunar or solar rhythm lands on the village date of the sky event at the
 * base row's time of day.
 */
export function expandOccurrences(row: CalendarRow, from: Date, to: Date, timeZone: string): Occurrence[] {
  const durationMs = row.endsAt ? Math.max(0, row.endsAt.getTime() - row.startsAt.getTime()) : null;
  const rec = row.recurrence;
  if (!rec) {
    if (!overlaps(row.startsAt, row.endsAt, from, to)) return [];
    return [{ row, occurrenceKey: "", startsAt: row.startsAt, endsAt: row.endsAt, title: row.title, cancelled: false }];
  }

  const base = civilParts(row.startsAt, timeZone);
  const until = rec.until ? new Date(rec.until) : null;
  const horizon = until && until.getTime() < to.getTime() ? until : to;
  // Never before the base row's own start, never past the horizon.
  const lo = Math.max(from.getTime() - (durationMs ?? 0), row.startsAt.getTime());

  const starts: Date[] = [];
  const atBaseTime = (year: number, month: number, day: number) =>
    zonedTimeToUtc(year, month, day, base.hour, base.minute, timeZone);

  if (rec.freq === "weekly") {
    // Walk village-local days from the base start, taking the days whose
    // weekday matches and whose week index is a multiple of the interval.
    const interval = rec.interval ?? 1;
    const baseDay = Date.UTC(base.year, base.month - 1, base.day);
    // The week index counts from the base's own week (Sunday-start).
    const baseWeekStart = baseDay - base.weekday * 86_400_000;
    const firstDay = Math.max(baseDay, civilDayMs(new Date(lo), timeZone));
    const lastDay = civilDayMs(horizon, timeZone);
    for (let d = firstDay; d <= lastDay && starts.length < 1000; d += 86_400_000) {
      const dt = new Date(d);
      const weekday = dt.getUTCDay();
      if (!rec.byWeekday.includes(weekday)) continue;
      const weekIndex = Math.floor((d - baseWeekStart) / (7 * 86_400_000));
      if (weekIndex % interval !== 0) continue;
      starts.push(atBaseTime(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()));
    }
  } else if (rec.freq === "monthly") {
    const interval = rec.interval ?? 1;
    const first = ymd(new Date(lo), timeZone);
    const last = ymd(horizon, timeZone);
    let y = first[0];
    let m = first[1];
    // Months since the base month must be a multiple of the interval.
    const monthsSinceBase = (yy: number, mm: number) => (yy - base.year) * 12 + (mm - base.month);
    while ((y < last[0] || (y === last[0] && m <= last[1])) && starts.length < 1000) {
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (monthsSinceBase(y, m) >= 0 && monthsSinceBase(y, m) % interval === 0 && rec.byMonthDay <= daysInMonth) {
        starts.push(atBaseTime(y, m, rec.byMonthDay));
      }
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  } else if (rec.freq === "lunar") {
    const winFrom = new Date(lo - 2 * 86_400_000);
    const winTo = new Date(horizon.getTime() + 2 * 86_400_000);
    let instants: Date[];
    if (rec.on === "new_moon") instants = newMoonsBetween(winFrom, winTo);
    else if (rec.on === "full_moon") instants = fullMoonsBetween(winFrom, winTo);
    else {
      // Cycle close: the settlement clock's own boundaries, whichever clock
      // the village keeps. Walked forward from the first boundary after the
      // window opens, so the arithmetic belongs to the clock and this file
      // holds no second copy of it.
      instants = [];
      const clock = activeClock();
      let at = new Date(winFrom.getTime() - 1);
      for (let guard = 0; guard < 100000; guard++) {
        const next = clock.nextBoundaryAfter(at);
        if (next.getTime() >= winTo.getTime()) break;
        instants.push(next);
        at = next;
      }
    }
    for (const inst of instants) {
      const [y, m, d] = ymd(inst, timeZone);
      starts.push(atBaseTime(y, m, d));
    }
  } else if (rec.freq === "solar") {
    const fromYear = civilParts(new Date(lo), timeZone).year - 1;
    const toYear = civilParts(horizon, timeZone).year + 1;
    for (let y = fromYear; y <= toYear; y++) {
      const s = seasonInstants(y);
      if (!s) continue;
      const picks: Date[] = [];
      if (rec.on === "solstice" || rec.on === "either") picks.push(s.junSolstice, s.decSolstice);
      if (rec.on === "equinox" || rec.on === "either") picks.push(s.marEquinox, s.sepEquinox);
      for (const inst of picks) {
        const [yy, mm, dd] = ymd(inst, timeZone);
        starts.push(atBaseTime(yy, mm, dd));
      }
    }
    starts.sort((a, b) => a.getTime() - b.getTime());
  }

  const exceptions = new Set(rec.exceptions ?? []);
  const overrides = rec.overrides ?? {};
  const out: Occurrence[] = [];
  const seen = new Set<string>();
  for (const s of starts) {
    if (s.getTime() < row.startsAt.getTime()) continue;
    if (until && s.getTime() > until.getTime()) continue;
    const key = civilDateKey(s, timeZone);
    if (seen.has(key)) continue;
    seen.add(key);
    if (exceptions.has(key)) continue;
    const ov = overrides[key];
    const startsAt = ov?.startsAt ? new Date(ov.startsAt) : s;
    const endsAt = ov && ov.endsAt !== undefined
      ? (ov.endsAt ? new Date(ov.endsAt) : null)
      : durationMs === null ? null : new Date(startsAt.getTime() + durationMs);
    if (!overlaps(startsAt, endsAt, from, to)) continue;
    out.push({
      row,
      occurrenceKey: key,
      startsAt,
      endsAt,
      title: ov?.title ?? row.title,
      cancelled: Boolean(ov?.cancelled),
    });
  }
  return out;
}

function ymd(d: Date, timeZone: string): [number, number, number] {
  const c = civilParts(d, timeZone);
  return [c.year, c.month, c.day];
}

/** The village civil date of an instant as a UTC-midnight ms value, for day walks. */
function civilDayMs(d: Date, timeZone: string): number {
  const [y, m, day] = ymd(d, timeZone);
  return Date.UTC(y, m - 1, day);
}

// ── Visibility ──────────────────────────────────────────────────────────────

export interface CalendarViewer {
  userId: string | null;
  isAdmin: boolean;
}

/**
 * The layers a viewer reads by right of who they are. `private` is never in
 * this list: a private row reaches its owner only, through ownership, and
 * ownership also reaches an admin-layer row about the owner (a notice end).
 */
export function visibleLayersFor(viewer: CalendarViewer): CalendarLayer[] {
  const layers: CalendarLayer[] = ["public", "village"];
  if (viewer.userId) layers.push("circle", "household");
  if (viewer.isAdmin) layers.push("admin");
  return layers;
}

// ── The read ────────────────────────────────────────────────────────────────

export interface CalendarQuery {
  /** Window, as instants. Occurrences overlapping it are returned. */
  from: Date;
  to: Date;
  viewer: CalendarViewer;
  /** The village's IANA zone: occurrence keys and recurrence expand in it. */
  timezone: string;
  /** Narrow to these layers (intersected with what the viewer may see). */
  layers?: CalendarLayer[];
  kinds?: CalendarKind[];
  /** Include `draft`. Admin surfaces only. */
  includeDrafts?: boolean;
  /** Include rows whose source has gone. Admin surfaces only. */
  includeRemoved?: boolean;
  /** Only rows touching this map structure. */
  structureKey?: string | null;
  /** Only rows imported from this subscription. */
  externalSourceId?: string | null;
  limit?: number;
  /** The clock, for daysUntil. Tests pass one; routes leave it. */
  now?: Date;
}

/**
 * THE read. Stable signature: L6 wraps it as a reader and L7 lists from it,
 * neither touching this file.
 */
export async function listCalendarItems(pool: Pool, q: CalendarQuery): Promise<CalendarItem[]> {
  const now = q.now ?? new Date();
  const rows = await listCalendarRows(pool, q);
  const occurrences: Occurrence[] = [];
  for (const row of rows) {
    for (const occ of expandOccurrences(row, q.from, q.to, q.timezone)) occurrences.push(occ);
  }
  occurrences.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.row.id.localeCompare(b.row.id));

  const asked = Math.floor(Number(q.limit));
  const limit = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), 2000) : 500;
  const kept = occurrences.slice(0, limit);

  const counts = await rsvpCounts(pool, kept.map((o) => o.row.id), q.viewer.userId);
  return kept.map((o) => toItem(o, counts, now, q.viewer));
}

/**
 * The visible BASE rows of a query, before occurrence expansion: what the
 * .ics feed reads so a weekly rhythm can leave as one RRULE. Same
 * visibility, same window rule as listCalendarItems.
 */
export async function listCalendarRows(pool: Pool, q: CalendarQuery): Promise<CalendarRow[]> {
  const params: any[] = [];
  const where: string[] = [];

  const statuses = q.includeDrafts ? EVENT_STATUSES : PUBLIC_STATUSES;
  where.push(`e.status IN (${statuses.map(() => "?").join(",")})`);
  params.push(...statuses);

  if (!q.includeRemoved) where.push("e.removed_at IS NULL");

  // Layer visibility over status: by layer, or by ownership. A row the
  // viewer owns is theirs whatever its layer (a loan due on private, a notice
  // end on admin); a private row nobody owns reaches nobody.
  const visible = visibleLayersFor(q.viewer);
  const clauses: string[] = [`e.layer IN (${visible.map(() => "?").join(",")})`];
  params.push(...visible);
  if (q.viewer.userId) {
    clauses.push("(e.owner_user_id IS NOT NULL AND e.owner_user_id = ?)");
    params.push(q.viewer.userId);
  }
  where.push(`(${clauses.join(" OR ")})`);
  // Then the caller's narrowing, inside what the viewer may see.
  if (q.layers) {
    const asked = q.layers.filter(isLayer);
    if (!asked.length) return [];
    where.push(`e.layer IN (${asked.map(() => "?").join(",")})`);
    params.push(...asked);
  }

  if (q.kinds && q.kinds.length) {
    const kinds = q.kinds.filter(isKind);
    if (!kinds.length) return [];
    where.push(`e.kind IN (${kinds.map(() => "?").join(",")})`);
    params.push(...kinds);
  }

  // The window. A one-off must overlap it; a recurring row must have begun
  // before it ends, and is expanded below.
  where.push(
    "((e.recurrence IS NULL AND e.starts_at < ? AND COALESCE(e.ends_at, e.starts_at) >= ?) " +
      "OR (e.recurrence IS NOT NULL AND e.starts_at < ?))",
  );
  params.push(q.to, q.from, q.to);

  if (q.structureKey) {
    // JSON_QUOTE escapes the needle, which is what keeps a structure key from
    // being SQL at all.
    where.push("JSON_CONTAINS(e.structure_keys, JSON_QUOTE(?))");
    params.push(q.structureKey);
  }
  if (q.externalSourceId) {
    where.push("e.external_source_id = ?");
    params.push(q.externalSourceId);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${CALENDAR_COLS} FROM events e WHERE ${where.join(" AND ")} ORDER BY e.starts_at ASC, e.id ASC LIMIT 2000`,
    params,
  );
  return rows.map(rowToCalendarRow);
}

interface RsvpCount { going: number; mine: RsvpStatus | null }

/** Going counts and the viewer's own answer, per (event, occurrence). One query. */
async function rsvpCounts(pool: Pool, eventIds: string[], userId: string | null): Promise<Map<string, RsvpCount>> {
  const out = new Map<string, RsvpCount>();
  const ids = Array.from(new Set(eventIds));
  if (!ids.length) return out;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT event_id, occurrence_key,
            SUM(status = 'going') AS going,
            MAX(CASE WHEN user_id = ? THEN status ELSE NULL END) AS mine
       FROM event_rsvps
      WHERE event_id IN (${ids.map(() => "?").join(",")})
      GROUP BY event_id, occurrence_key`,
    [userId ?? "", ...ids],
  );
  for (const r of rows) {
    out.set(`${r.event_id}\u0000${r.occurrence_key ?? ""}`, {
      going: Number(r.going ?? 0),
      mine: userId ? ((r.mine ?? null) as RsvpStatus | null) : null,
    });
  }
  return out;
}

function toItem(o: Occurrence, counts: Map<string, RsvpCount>, now: Date, viewer: CalendarViewer): CalendarItem {
  const r = o.row;
  const c = counts.get(`${r.id}\u0000${o.occurrenceKey}`) ?? { going: 0, mine: null };
  const status: EventStatus = o.cancelled ? "cancelled" : r.status;
  return {
    id: r.id,
    title: o.title,
    description: r.description,
    startsAt: o.startsAt.toISOString(),
    endsAt: o.endsAt ? o.endsAt.toISOString() : null,
    locationText: r.locationText,
    structureKeys: r.structureKeys,
    visitTypeId: r.visitTypeId,
    capacity: r.capacity,
    status,
    attendanceMode: r.attendanceMode,
    onlineUrl: r.onlineUrl,
    goingCount: c.going,
    spotsLeft: spotsLeft(r.capacity, c.going),
    daysUntil: daysUntil(o.startsAt, now),
    isExample: r.isExample,
    ...(viewer.userId ? { myRsvp: c.mine } : {}),
    kind: r.kind,
    layer: r.layer,
    allDay: r.allDay,
    sourceModule: r.sourceModule,
    sourceId: r.sourceId,
    link: r.link,
    colour: r.colour,
    recurrence: r.recurrence,
    occurrenceKey: o.occurrenceKey,
    external: r.externalSourceId && r.externalUid ? { sourceId: r.externalSourceId, uid: r.externalUid } : null,
    ...(r.removedAt ? { removed: true } : {}),
    // 0092: the price rides on every read, so a member sees what a place costs
    // on the same card that offers it. The village's own word for the token
    // comes from the registry here rather than at each route, because there
    // are five reads of this shape and five decorations would be four chances
    // to ship a card saying "12 credits" in a village that renamed them.
    seatPrice: r.seatPrice,
    seatToken: r.seatPrice > 0 ? r.seatToken : null,
    seatTokenName: r.seatPrice > 0 && r.seatToken ? (tokenDef(r.seatToken)?.name ?? r.seatToken) : null,
  };
}

/** One row by id, as an item, no occurrence expansion. Null when absent. */
export async function getCalendarRow(pool: Pool, id: string): Promise<CalendarRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${CALENDAR_COLS} FROM events e WHERE e.id = ? LIMIT 1`, [id]);
  return rows.length ? rowToCalendarRow(rows[0]) : null;
}

/**
 * The same rule listCalendarRows applies in SQL, for one row in hand: by
 * layer, or by ownership; a removed row only for an admin. The by-id route
 * runs every read through this so a guessable id (mirrored ids are hashes of
 * their source) is never a way around the layer model.
 */
export function canViewRow(row: Pick<CalendarRow, "layer" | "ownerUserId" | "removedAt" | "status">, viewer: CalendarViewer, opts: { includeDrafts?: boolean } = {}): boolean {
  if (row.removedAt && !viewer.isAdmin) return false;
  if (row.status === "draft" && !opts.includeDrafts) return false;
  if (viewer.userId && row.ownerUserId && row.ownerUserId === viewer.userId) return true;
  return visibleLayersFor(viewer).includes(row.layer);
}

/** One row as an item, or null when absent OR when this viewer may not see it. */
export async function getCalendarItemFor(pool: Pool, id: string, viewer: CalendarViewer, opts: { includeDrafts?: boolean } = {}, now = new Date()): Promise<CalendarItem | null> {
  const row = await getCalendarRow(pool, id);
  if (!row || !canViewRow(row, viewer, opts)) return null;
  const counts = await rsvpCounts(pool, [row.id], viewer.userId);
  return toItem(
    { row, occurrenceKey: "", startsAt: row.startsAt, endsAt: row.endsAt, title: row.title, cancelled: false },
    counts, now, viewer,
  );
}

/** The base row as an item (occurrenceKey ""), with the viewer's counts. No visibility check: admin surfaces. */
export async function getCalendarItem(pool: Pool, id: string, viewer: CalendarViewer, now = new Date()): Promise<CalendarItem | null> {
  const row = await getCalendarRow(pool, id);
  if (!row) return null;
  const counts = await rsvpCounts(pool, [row.id], viewer.userId);
  return toItem(
    { row, occurrenceKey: "", startsAt: row.startsAt, endsAt: row.endsAt, title: row.title, cancelled: false },
    counts, now, viewer,
  );
}

// ── The write doors ─────────────────────────────────────────────────────────

export interface SourceRef {
  sourceModule: string;
  sourceId: string;
}

export interface CalendarUpsertInput extends SourceRef {
  kind: CalendarKind;
  title: string;
  description?: string | null;
  startsAt: Date | string;
  endsAt?: Date | string | null;
  allDay?: boolean;
  layer?: CalendarLayer;
  /** The one person a private-layer row belongs to. */
  ownerUserId?: string | null;
  link?: string | null;
  colour?: string | null;
  locationText?: string | null;
  status?: Extract<EventStatus, "scheduled" | "cancelled">;
  isExample?: boolean;
  externalSourceId?: string | null;
  externalUid?: string | null;
  recurrence?: Recurrence | null;
}

/** A stable id from the source, so a mirrored fact keeps its link forever. */
export function calendarIdFor(ref: SourceRef): string {
  const h = createHash("sha1").update(`${ref.sourceModule}\u0000${ref.sourceId}`).digest("hex").slice(0, 20);
  const mod = ref.sourceModule.replace(/[^a-z0-9]/gi, "").slice(0, 16).toLowerCase();
  return `ev-${mod}-${h}`;
}

const asDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

/**
 * A module writes its dated fact into the calendar. Idempotent on
 * (source_module, source_id): the second call updates the first row, and a
 * fact that had been removed comes back.
 */
export async function calendarUpsert(pool: Pool, input: CalendarUpsertInput): Promise<string> {
  const startsAt = asDate(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw new Error("calendarUpsert: startsAt is not a date");
  const endsAt = input.endsAt ? asDate(input.endsAt) : null;
  if (endsAt && Number.isNaN(endsAt.getTime())) throw new Error("calendarUpsert: endsAt is not a date");
  const kind: CalendarKind = isKind(input.kind) ? input.kind : "gathering";
  const layer: CalendarLayer = isLayer(input.layer) ? input.layer : "village";
  const id = calendarIdFor(input);
  await pool.query(
    `INSERT INTO events
       (id, title, description, starts_at, ends_at, location_text, structure_keys, status, attendance_mode,
        kind, source_module, source_id, layer, owner_user_id, all_day, link, colour, recurrence,
        external_source_id, external_uid, is_example, removed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title), description = VALUES(description), starts_at = VALUES(starts_at),
       ends_at = VALUES(ends_at), location_text = VALUES(location_text), status = VALUES(status),
       kind = VALUES(kind), layer = VALUES(layer), owner_user_id = VALUES(owner_user_id),
       all_day = VALUES(all_day), link = VALUES(link), colour = VALUES(colour), recurrence = VALUES(recurrence),
       external_source_id = VALUES(external_source_id), external_uid = VALUES(external_uid),
       is_example = VALUES(is_example), removed_at = NULL`,
    [
      id,
      String(input.title).slice(0, 200),
      input.description ?? null,
      startsAt,
      endsAt,
      input.locationText ?? null,
      JSON.stringify([]),
      input.status === "cancelled" ? "cancelled" : "scheduled",
      "offline",
      kind,
      input.sourceModule,
      input.sourceId,
      layer,
      input.ownerUserId ?? null,
      input.allDay ? 1 : 0,
      input.link ?? null,
      input.colour ?? null,
      input.recurrence ? JSON.stringify(cleanRecurrence(input.recurrence)) : null,
      input.externalSourceId ?? null,
      input.externalUid ?? null,
      input.isExample ? 1 : 0,
    ],
  );
  return id;
}

/** The fact is gone upstream: mark the row, keep it. True when a row changed. */
export async function calendarRemove(pool: Pool, ref: SourceRef): Promise<boolean> {
  const [res] = await pool.query<any>(
    "UPDATE events SET removed_at = UTC_TIMESTAMP() WHERE source_module = ? AND source_id = ? AND removed_at IS NULL",
    [ref.sourceModule, ref.sourceId],
  );
  return Number(res?.affectedRows ?? 0) > 0;
}

/**
 * Reconcile one module's mirror: every live row of the module whose source id
 * is not in `keep` is marked removed. Returns how many were. `keep` empty
 * removes them all, which is the honest answer when the source has nothing.
 */
export async function calendarRemoveMissing(pool: Pool, sourceModule: string, keep: string[]): Promise<number> {
  const params: any[] = [sourceModule];
  let sql = "UPDATE events SET removed_at = UTC_TIMESTAMP() WHERE source_module = ? AND removed_at IS NULL";
  if (keep.length) {
    sql += ` AND source_id NOT IN (${keep.map(() => "?").join(",")})`;
    params.push(...keep);
  }
  const [res] = await pool.query<any>(sql, params);
  return Number(res?.affectedRows ?? 0);
}

/** Live source ids of one module, for a reconciler that wants to diff. */
export async function calendarSourceIds(pool: Pool, sourceModule: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT source_id FROM events WHERE source_module = ? AND removed_at IS NULL",
    [sourceModule],
  );
  return rows.map((r) => String(r.source_id));
}

/** Kinds a person may set by hand. Everything else belongs to a module. */
export function isAuthoredKind(v: unknown): v is CalendarKind {
  return AUTHORED_KINDS.includes(v as CalendarKind);
}
