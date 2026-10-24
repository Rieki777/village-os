/**
 * Live Sessions: circle meetings on a calendar. The store is
 * server/repos/sessionCalendar.ts; the doors are server/routes/sessionCalendar.ts;
 * the shapes, rules and words are shared/sessionCalendar.ts. The meetings
 * themselves are the circles' rhythms (server/lib/sessionRhythm.ts).
 *
 * ── WHAT LIVES HERE ──────────────────────────────────────────────────────
 *
 *   mirrorRhythms   every circle's rhythm into the one village calendar
 *   followFor       the live circles, and which of them a member follows
 *   setFollow       follow some circles, every circle, or none
 *   makeAddress     a new private calendar address (the key shown once)
 *   stopAddress     the address answers nothing any more
 *   feedFor         what a calendar app reads at that address
 *
 * ── ONE CALENDAR ─────────────────────────────────────────────────────────
 *
 * A circle's rhythm is written into the village calendar with `calendarUpsert`
 * (source `sessions`, the circle's id, layer `circle`, kind `call`), so the
 * Events calendar and its own feeds carry circle meetings with no second copy
 * of the arithmetic: the calendar expands the same `Recurrence` the rhythm
 * keeps, weekly weeks counted from the first meeting's week, skipped dates by
 * village date, a moon meeting on the moon's village date. Mirrored on every
 * change and hourly, so a renamed circle or a new village zone follows. While
 * the module is off or in preview every mirrored row is retired: a meeting a
 * member cannot open has no place on their calendar.
 *
 * ── THE FEED ─────────────────────────────────────────────────────────────
 *
 * Built at each read from what the member follows at that moment, through the
 * calendar's own writer (`buildIcs`, server/lib/icsFeed.ts), so a weekly
 * rhythm leaves as one RRULE that keeps its wall-clock time and a moon rhythm
 * as its meetings one by one. A row's id is the mirrored row's id, so a
 * meeting keeps one UID wherever it is read. The meetings of a followed
 * circle's own calendar travel with it, as the village calendar imported them
 * (server/lib/circleOwnCalendar.ts).
 */
import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import * as store from "../repos/sessionCalendar";
import * as rhythms from "../repos/sessionRhythm";
import * as room from "../repos/liveSessions";
import { ensureMemberNo, memberNo, type Outcome, type Refusal } from "./liveSessions";
import { mapRhythm } from "./sessionRhythm";
import { exportOwnCalendarsFor, importedRowsFor, ownCalendars, retireGoneCircleCalendars } from "./circleOwnCalendar";
import { calendarIdFor, calendarRemoveMissing, calendarUpsert, type CalendarRow, type CalendarUpsertInput } from "./calendar";
import { buildIcs } from "./icsFeed";
import { listMonthNames, namesForHemisphere } from "./lunarTable";
import { moonOneCycle } from "./villageMoon";
import { stringVar } from "./variables";
import { villageTimezone } from "./villageReaders";
import { effectiveLifecycle } from "./modules";
import { isAdmitted } from "./admission";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { LIFECYCLE_RANK, type ModuleLifecycle } from "../../shared/modules";
import { civilParts, type YearAnchor } from "../../shared/lunar";
import { addDays, comingLink, meetingAt, nextMeetings, rhythmWords, type StoredRhythm } from "../../shared/sessionRhythm";
import {
  CALENDAR_COPY,
  EVERY_CIRCLE,
  MIRROR_SOURCE,
  cleanFollow,
  feedUrl,
  looksLikeFeedKey,
  meetingTitle,
  type FollowPayload,
} from "../../shared/sessionCalendar";

const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error });
const done = <T>(value: T): Outcome<T> => ({ ok: true, value });

const toIso = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

const DAY_MS = 86_400_000;

const hashKey = (raw: string): string => createHash("sha256").update(raw).digest("hex");

/** The rate bucket of one address: named by a piece of its hash, never by the key. */
export function feedKeyBucket(raw: string): string {
  return `sessions-feed-key:${hashKey(raw).slice(0, 16)}`;
}

/** What the rules need: the live circles, and for a test the module's lifecycle. */
export interface CalendarDeps {
  circles: () => { id: string; name: string }[];
  lifecycle?: () => string;
}

/** What the feed needs besides: who a member is, and what the village is called. */
export interface FeedDeps extends CalendarDeps {
  member(userId: string): Promise<{ role?: unknown; email?: unknown; [k: string]: unknown } | null>;
  villageName(): string;
  origin(): string;
}

/** Open to members: in preview the room is the admins' own, and off is off. */
export function openToMembers(deps: CalendarDeps): boolean {
  const lifecycle = deps.lifecycle ?? (() => effectiveLifecycle("sessions"));
  return (LIFECYCLE_RANK[lifecycle() as ModuleLifecycle] ?? 0) >= LIFECYCLE_RANK.members;
}

// ── One calendar ────────────────────────────────────────────────────────────

/** Does this village date have the rhythm's wall-clock time at all? Not in the hour the clocks skip. */
const wallTimeHolds = (key: string, time: string, zone: string): boolean => {
  const p = civilParts(meetingAt(key, time, zone), zone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` === time;
};

/**
 * The first meeting the village calendar counts from. The calendar reads
 * every meeting's time of day from this one instant, so it must be a date
 * where the rhythm's wall-clock time exists: a first meeting in the hour the
 * clocks skip would set every meeting an hour off. Such a date is stepped
 * past, by whole rhythms (a weekly one keeps its week), so only that one
 * meeting moves, the way it moves in Coming up.
 */
function mirrorBase(r: StoredRhythm, zone: string): string {
  if (!r.recurrence || wallTimeHolds(r.startsOn, r.time, zone)) return r.startsOn;
  if (r.recurrence.freq === "weekly") {
    const step = 7 * Math.max(1, r.recurrence.interval ?? 1);
    for (let k = 1, day = addDays(r.startsOn, step); k <= 60; k += 1, day = addDays(day, step)) if (wallTimeHolds(day, r.time, zone)) return day;
    return r.startsOn;
  }
  const from = meetingAt(r.startsOn, "00:00", zone);
  const held = nextMeetings({ ...r, recurrence: { ...r.recurrence, exceptions: [] } }, from, zone, 12).find((m) => wallTimeHolds(m.key, r.time, zone));
  return held?.key ?? r.startsOn;
}

/** A circle's rhythm as the village calendar holds it. */
export function mirrorInput(r: StoredRhythm, circleName: string, zone: string): Omit<CalendarUpsertInput, "sourceModule"> {
  const startsAt = meetingAt(mirrorBase(r, zone), r.time, zone);
  return {
    sourceId: r.circleId,
    kind: "call",
    layer: "circle",
    title: meetingTitle(circleName),
    description: CALENDAR_COPY.feedDescription,
    startsAt,
    endsAt: new Date(startsAt.getTime() + r.durationMin * 60_000),
    link: comingLink(r.circleId),
    recurrence: r.recurrence,
  };
}

/** A circle's rhythm as a calendar row, the shape the feed's writer and the calendar's expansion read. */
export function calendarRowFor(r: StoredRhythm, circleName: string, zone: string, updatedAt: Date): CalendarRow {
  return asCalendarRow(mirrorInput(r, circleName, zone), updatedAt);
}

function asCalendarRow(input: Omit<CalendarUpsertInput, "sourceModule">, updatedAt: Date): CalendarRow {
  return {
    id: calendarIdFor({ sourceModule: MIRROR_SOURCE, sourceId: input.sourceId }),
    title: input.title,
    description: input.description ?? null,
    startsAt: new Date(input.startsAt),
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    locationText: null,
    structureKeys: [],
    visitTypeId: null,
    capacity: null,
    status: "scheduled",
    attendanceMode: "offline",
    onlineUrl: null,
    isExample: false,
    kind: input.kind,
    layer: input.layer ?? "circle",
    ownerUserId: null,
    allDay: false,
    sourceModule: MIRROR_SOURCE,
    sourceId: input.sourceId,
    link: input.link ?? null,
    colour: null,
    recurrence: input.recurrence ?? null,
    externalSourceId: null,
    externalUid: null,
    removedAt: null,
    updatedAt,
    seatPrice: 0,
    seatToken: null,
  };
}

/**
 * One mirror at a time. A mirror reads every rhythm, writes each, then retires
 * the rest, in separate statements; two at once could retire a rhythm the
 * other had just written, or write an older one back over it. So each run
 * waits for the one before, in this process, which is the only one a village
 * runs.
 */
let mirrorQueue: Promise<unknown> = Promise.resolve();

/**
 * Every live circle's rhythm into the village calendar, and every mirrored
 * row whose rhythm or circle has gone retired. Nothing stays mirrored while
 * the module is off or in preview. Idempotent, safe every hour and after
 * every change, and never two at once.
 */
export function mirrorRhythms(pool: Pool, deps: CalendarDeps): Promise<{ written: number; retired: number }> {
  const run = mirrorQueue.then(() => mirrorOnce(pool, deps));
  mirrorQueue = run.catch(() => undefined);
  return run;
}

async function mirrorOnce(pool: Pool, deps: CalendarDeps): Promise<{ written: number; retired: number }> {
  // A circle no longer live keeps no calendar of its own: nobody is left to detach it.
  await retireGoneCircleCalendars(pool, new Set(deps.circles().map((c) => c.id)));
  if (!openToMembers(deps)) return { written: 0, retired: await calendarRemoveMissing(pool, MIRROR_SOURCE, []) };
  const zone = villageTimezone();
  const live = new Map(deps.circles().map((c) => [c.id, c]));
  const keep: string[] = [];
  for (const row of await rhythms.rhythmRows(pool)) {
    const r = mapRhythm(row);
    const circle = live.get(r.circleId);
    if (!circle) continue;
    await calendarUpsert(pool, { ...mirrorInput(r, circle.name, zone), sourceModule: MIRROR_SOURCE });
    keep.push(r.circleId);
  }
  return { written: keep.length, retired: await calendarRemoveMissing(pool, MIRROR_SOURCE, keep) };
}

// ── Following ───────────────────────────────────────────────────────────────

/** What one member follows: every circle, or these. */
async function followsOf(pool: Pool, no: number | null): Promise<{ all: boolean; ids: Set<string> }> {
  const rows = no == null ? [] : await store.followRows(pool, no);
  const ids = new Set(rows.map((r) => String(r.circle_id)));
  return { all: ids.has(EVERY_CIRCLE), ids };
}

/** The live circles, which of them this member follows, and their address when they hold one. */
export async function followFor(pool: Pool, who: { userId: string }, deps: CalendarDeps): Promise<FollowPayload> {
  const no = await memberNo(pool, who.userId);
  const { all, ids } = await followsOf(pool, no);
  const words = new Map((await rhythms.rhythmRows(pool)).map((row) => {
    const r = mapRhythm(row);
    return [r.circleId, rhythmWords(r)] as const;
  }));
  const [key] = no == null ? [] : await store.keyRow(pool, no);
  return {
    circles: deps.circles().map((c) => ({ id: c.id, name: c.name, followed: all || ids.has(c.id), rhythm: words.get(c.id) ?? null })),
    all,
    address: key ? { madeAt: toIso(key.created_at) ?? "", lastReadAt: toIso(key.last_used_at) } : null,
    serving: openToMembers(deps),
  };
}

/** Follow some circles, every circle (the new ones too), or none. The choice is replaced whole. */
export async function setFollow(pool: Pool, who: { userId: string }, raw: unknown, deps: CalendarDeps, now = new Date()): Promise<Outcome<FollowPayload>> {
  const input = cleanFollow(raw, new Set(deps.circles().map((c) => c.id)));
  if (!input.ok) return refuse(input.status, input.error);
  const no = await ensureMemberNo(pool, who.userId, now);
  await room.inTransaction(pool, async (conn: PoolConnection): Promise<Outcome<null>> => {
    await store.replaceFollows(conn, no, input.value.all ? [EVERY_CIRCLE] : input.value.circleIds, now);
    return done(null);
  });
  return done(await followFor(pool, who, deps));
}

// ── The address ─────────────────────────────────────────────────────────────

/** A new private address, taking the place of the old. The key is in it, and is shown this once. */
export async function makeAddress(pool: Pool, who: { userId: string }, origin: string, now = new Date()): Promise<string> {
  const no = await ensureMemberNo(pool, who.userId, now);
  const raw = randomBytes(32).toString("hex");
  await store.putKey(pool, no, hashKey(raw), now);
  return feedUrl(origin, raw);
}

/** The address answers nothing any more. */
export async function stopAddress(pool: Pool, who: { userId: string }): Promise<void> {
  const no = await memberNo(pool, who.userId);
  if (no != null) await store.deleteKey(pool, no);
}

// ── The feed ────────────────────────────────────────────────────────────────

/**
 * What a calendar app reads at a private address: the meetings of the live
 * circles the key's member follows now. Null, which the door answers as a bare
 * 404, for anything it will not serve: a key that does not read or is not
 * live, the module off or in preview, or a member who has left, been
 * anonymized or is no longer admitted. The key of a member who has gone is
 * stopped on the way out.
 */
export async function feedFor(pool: Pool, rawKey: unknown, deps: FeedDeps, now = new Date()): Promise<string | null> {
  if (!looksLikeFeedKey(rawKey) || !openToMembers(deps)) return null;
  const [owner] = await store.memberForKey(pool, hashKey(rawKey));
  if (!owner) return null;
  const no = Number(owner.member_no);
  const [person] = await room.memberUserIdRows(pool, [no]);
  const user = person?.user_id ? await deps.member(String(person.user_id)) : null;
  if (!user || String(user.email ?? "").endsWith("@anonymized.invalid")) {
    await store.deleteKey(pool, no);
    return null;
  }
  const admin = user.role === "admin" || user.role === "founder";
  if (!admin && !isAdmitted(user as Parameters<typeof isAdmitted>[0], GAME_CONFIG.stages)) return null;
  await store.touchKey(pool, no, now);

  const zone = villageTimezone();
  const { all, ids } = await followsOf(pool, no);
  const live = new Map(deps.circles().map((c) => [c.id, c]));
  const rows: CalendarRow[] = [];
  for (const row of await rhythms.rhythmRows(pool)) {
    const r = mapRhythm(row);
    const circle = live.get(r.circleId);
    if (!circle || !(all || ids.has(r.circleId))) continue;
    rows.push(calendarRowFor(r, circle.name, zone, row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at))));
  }
  const followed = all ? new Set(live.keys()) : new Set(Array.from(ids).filter((id) => live.has(id)));
  const from = new Date(now.getTime() - 60 * DAY_MS);
  const to = new Date(now.getTime() + 400 * DAY_MS);
  rows.push(...(await importedRowsFor(pool, await ownCalendars(pool), followed, from, to)));
  const hemisphere = stringVar("calendar.hemisphere") === "south" ? "south" : "north";
  const origin = deps.origin().replace(/\/$/, "");
  return buildIcs(rows, {
    calendarName: CALENDAR_COPY.feedName(deps.villageName()),
    timezone: zone,
    anchor: stringVar("calendar.year_anchor") as YearAnchor,
    hemisphere,
    names: namesForHemisphere(await listMonthNames(pool), hemisphere),
    moonOneCycle: await moonOneCycle(pool),
    host: (() => {
      try {
        return new URL(origin).host;
      } catch {
        return "village";
      }
    })(),
    siteUrl: origin || null,
    from,
    to,
    now,
  });
}

// ── The member's own ────────────────────────────────────────────────────────

/** What a member follows, their address without its key, and the circles whose own calendar they attached, for the export. */
export async function exportFollowsFor(
  pool: Pool,
  no: number,
): Promise<{ circlesFollowed: Record<string, unknown>[]; calendarAddress: Record<string, unknown>[]; ownCalendarsAttached: Record<string, unknown>[] }> {
  const circlesFollowed = (await store.followRows(pool, no)).map((r) => ({ circleId: String(r.circle_id), since: toIso(r.created_at) }));
  const calendarAddress = (await store.keyRow(pool, no)).map((r) => ({ madeAt: toIso(r.created_at), lastReadAt: toIso(r.last_used_at) }));
  return { circlesFollowed, calendarAddress, ownCalendarsAttached: await exportOwnCalendarsFor(pool, no) };
}

/** The member leaves, inside the erasure's transaction. */
export async function forgetFollowsFor(conn: PoolConnection, no: number): Promise<void> {
  await store.forgetMember(conn, no);
}
