/**
 * Live Sessions: a circle's rhythm, against `live_session_rhythms`
 * (server/repos/sessionRhythm.ts). The doors are server/routes/sessionRhythm.ts;
 * the list door (server/routes/liveSessions.ts) folds "Coming up" in. The
 * shapes, the rights, the arithmetic and the words are shared/sessionRhythm.ts.
 *
 * ── WHAT LIVES HERE ──────────────────────────────────────────────────────
 *
 *   comingUpFor        every circle's next meeting, as one viewer reads it
 *   setRhythm          set, change or stop a circle's rhythm
 *   skipMeeting        skip one coming meeting
 *   circleSummary      one circle's sessions, for its home page
 *   runComingUpNotes   the day-before notice, from the hourly job
 *   circleMemberUserIds  who a circle's members are, for that notice
 *
 * ── WHO KEEPS IT ─────────────────────────────────────────────────────────
 *
 * The circle's members (standing: its last meeting, or one of its seats now,
 * server/lib/circleStanding.ts) and admins, through `mayKeepRhythm` in the
 * contract. Anybody may read when a circle meets; the count of agenda items
 * waiting for it counts only what the viewer may see (`canSeeBrought`).
 *
 * ── NOTHING HERE OPENS A ROOM ────────────────────────────────────────────
 *
 * A meeting coming up is an invitation. A person opens the room from the
 * start card, the way a person closes it, so a rhythm nobody keeps any more
 * never fills the list with empty rooms.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import * as room from "../repos/liveSessions";
import * as store from "../repos/sessionRhythm";
import * as library from "../repos/sessionLibrary";
import { listOrgAssignments, listOrgRoles, type LapseContext } from "./orgChart";
import { ensureMemberNo, memberNo, type Outcome, type Refusal } from "./liveSessions";
import { keptSeat, standingIn } from "./circleStanding";
import { libraryViewer, mapLibrary } from "./sessionLibrary";
import { villageTimezone } from "./villageReaders";
import { effectiveLifecycle } from "./modules";
import { numberVar } from "./variables";
import { nextInWindow } from "../../shared/comms/quietHours";
import { canSeeBrought, type LibraryViewer } from "../../shared/sessionLibrary";
import { liveHoldersOf, liveSeatIdsFor } from "../../shared/sessionTasks";
import type { Recurrence } from "../../shared/gatherings";
import {
  RHYTHM_LIMITS,
  RHYTHM_NOTICES,
  RHYTHM_REFUSALS,
  cleanRhythm,
  comingLink,
  mayKeepRhythm,
  meetingPhrase,
  meetingWords,
  nextMeetings,
  rhythmAsInput,
  rhythmRecord,
  rhythmWords,
  type CircleSessionsSummary,
  type ComingUpPayload,
  type ComingUpRow,
  type RhythmKind,
  type StoredRhythm,
} from "../../shared/sessionRhythm";

const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error });
const done = <T>(value: T): Outcome<T> => ({ ok: true, value });

const toIso = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

/** What the rules need from the routes: the live circles, whose seat terms still run, and the bell. */
export interface RhythmDeps {
  circles: () => { id: string; name: string }[];
  lapseContext?: () => LapseContext;
}

export interface RhythmNoticeDeps extends RhythmDeps {
  getPool: () => Pool;
  notify(input: { userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }): Promise<unknown>;
  /** For a test: the daytime window. Absent: the village's own quiet hours. */
  window?: () => { start: number; end: number };
  /** For a test: the module's lifecycle. */
  lifecycle?: () => string;
}

export interface RhythmAsker {
  userId: string;
  admin: boolean;
}

export function mapRhythm(r: Record<string, unknown>): StoredRhythm {
  let recurrence: Recurrence | null = null;
  if (r.recurrence != null && r.recurrence !== "") {
    try {
      recurrence = JSON.parse(String(r.recurrence)) as Recurrence;
    } catch {
      recurrence = null;
    }
  }
  const kind = String(r.kind);
  return {
    circleId: String(r.circle_id),
    kind: (kind === "weekly" || kind === "moon" || kind === "once" ? kind : "once") as RhythmKind,
    recurrence,
    startsAt: toIso(r.starts_at) ?? new Date(0).toISOString(),
    durationMin: Number(r.duration_min),
  };
}

// ── The viewer, and what waits for each circle ──────────────────────────────

/**
 * The asker: the library's reading of them (which items they may see; an
 * admin sees all), and the circles they belong to, measured for admins too,
 * so an admin who sits in a circle still finds it first.
 */
async function viewerOf(pool: Pool, who: RhythmAsker, deps: RhythmDeps): Promise<{ no: number | null; lib: LibraryViewer; own: Set<string> }> {
  const no = await memberNo(pool, who.userId);
  const lib = await libraryViewer(pool, { userId: who.userId, no, admin: who.admin }, deps);
  const own = who.admin
    ? await standingIn(pool, { no, liveSeatIds: liveSeatIdsFor(await listOrgAssignments(pool, deps.lapseContext?.()), who.userId) })
    : new Set(lib.standing);
  return { no, lib, own };
}

/** How many waiting agenda items of each circle this viewer may see. */
async function waitingByCircle(pool: Pool, v: { no: number | null; lib: LibraryViewer }): Promise<Map<string, number>> {
  const rows = (await library.liveRows(pool, { admin: v.lib.admin, no: v.no, standing: Array.from(v.lib.standing), limit: 500 })).map(mapLibrary);
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== "waiting" || r.circleId == null || !canSeeBrought(r, v.lib)) continue;
    out.set(r.circleId, (out.get(r.circleId) ?? 0) + 1);
  }
  return out;
}

/** The open room of each circle, the newest when there are several. */
async function openRooms(pool: Pool): Promise<Map<string, { id: number; title: string }>> {
  const out = new Map<string, { id: number; title: string }>();
  for (const r of await room.openSessionRows(pool, 50)) {
    if (r.circle_id == null) continue;
    const circleId = String(r.circle_id);
    if (!out.has(circleId)) out.set(circleId, { id: Number(r.id), title: String(r.title ?? "") });
  }
  return out;
}

function rowFor(
  r: StoredRhythm,
  circle: { id: string; name: string },
  now: Date,
  zone: string,
  ctx: { waiting: Map<string, number>; rooms: Map<string, { id: number; title: string }>; lib: LibraryViewer; own: Set<string> },
): ComingUpRow | null {
  const [next] = nextMeetings(r, now, zone, 1);
  if (!next) return null;
  // An admin is no circle's member by being an admin: their own circles come first only through standing.
  const mine = ctx.own.has(circle.id);
  return {
    circleId: circle.id,
    circleName: circle.name,
    rhythmWords: rhythmWords(r, zone),
    next,
    words: meetingWords(new Date(next.at), now, zone),
    durationMin: r.durationMin,
    waiting: ctx.waiting.get(circle.id) ?? 0,
    openRoom: ctx.rooms.get(circle.id) ?? null,
    mine,
    canKeep: mayKeepRhythm(circle.id, ctx.lib),
    rhythm: rhythmAsInput(r, zone),
  };
}

// ── Coming up ───────────────────────────────────────────────────────────────

/**
 * Every live circle's next meeting, the viewer's own circles first, then by
 * when. A circle whose last single meeting has gone has nothing coming up and
 * is left out until somebody sets it again.
 */
export async function comingUpFor(pool: Pool, who: RhythmAsker, deps: RhythmDeps, now = new Date()): Promise<ComingUpPayload> {
  const zone = villageTimezone();
  const circles = new Map(deps.circles().map((c) => [c.id, c]));
  const v = await viewerOf(pool, who, deps);
  const keepCircleIds = Array.from(circles.keys()).filter((id) => mayKeepRhythm(id, v.lib));
  const rhythms = (await store.rhythmRows(pool)).map(mapRhythm).filter((r) => circles.has(r.circleId));
  if (!rhythms.length) return { rows: [], zone, keepCircleIds };
  const ctx = { waiting: await waitingByCircle(pool, v), rooms: await openRooms(pool), lib: v.lib, own: v.own };
  const rows = rhythms
    .map((r) => rowFor(r, circles.get(r.circleId)!, now, zone, ctx))
    .filter((r): r is ComingUpRow => r != null)
    .sort((a, b) => Number(b.mine) - Number(a.mine) || Date.parse(a.next.at) - Date.parse(b.next.at));
  return { rows, zone, keepCircleIds };
}

/** One circle's row as "Coming up" shows it, or null when nothing is coming. */
async function oneRow(pool: Pool, circleId: string, who: RhythmAsker, deps: RhythmDeps, now: Date): Promise<ComingUpRow | null> {
  const circle = deps.circles().find((c) => c.id === circleId);
  const [row] = await store.rhythmRow(pool, circleId);
  if (!circle || !row) return null;
  const v = await viewerOf(pool, who, deps);
  return rowFor(mapRhythm(row), circle, now, villageTimezone(), { waiting: await waitingByCircle(pool, v), rooms: await openRooms(pool), lib: v.lib, own: v.own });
}

// ── Setting and skipping ────────────────────────────────────────────────────

/**
 * Set a circle's rhythm, change it, or stop it (`{ kind: "none" }`): the
 * circle's members and admins. Refused in this order: a circle that is not a
 * live one (400), a body that does not read (400), a viewer who may not keep
 * it (403), a time already gone (400). A change takes the place of the old
 * rhythm whole, skipped meetings included.
 */
export async function setRhythm(
  pool: Pool,
  who: RhythmAsker,
  circleId: string,
  raw: unknown,
  deps: RhythmDeps,
  now = new Date(),
): Promise<Outcome<{ row: ComingUpRow | null }>> {
  if (!deps.circles().some((c) => c.id === circleId)) return refuse(400, RHYTHM_REFUSALS.circleUnknown);
  const input = cleanRhythm(raw);
  if (!input.ok) return refuse(input.status, input.error);
  const v = await viewerOf(pool, who, deps);
  if (!mayKeepRhythm(circleId, v.lib)) return refuse(403, RHYTHM_REFUSALS.notYours);
  if (input.value.kind === "none") {
    await store.deleteRhythm(pool, circleId);
    return done({ row: null });
  }
  const zone = villageTimezone();
  const record = rhythmRecord(input.value, now, zone);
  if (!record) return refuse(400, RHYTHM_REFUSALS.past);
  const setByNo = v.no ?? (await ensureMemberNo(pool, who.userId, now));
  await store.putRhythm(pool, {
    circleId,
    kind: record.kind,
    recurrence: record.recurrence ? JSON.stringify(record.recurrence) : null,
    startsAt: record.startsAt,
    durationMin: record.durationMin,
    setByNo,
    now,
  });
  return done({ row: await oneRow(pool, circleId, who, deps, now) });
}

/**
 * Skip one coming meeting: the circle's members and admins. The meeting is
 * named by its key (its village date), and must be one of the next few; a
 * single meeting skipped is the rhythm stopped. The row is locked while it is
 * read and written, so two skips at once add two dates and lose neither.
 */
export async function skipMeeting(
  pool: Pool,
  who: RhythmAsker,
  circleId: string,
  raw: unknown,
  deps: RhythmDeps,
  now = new Date(),
): Promise<Outcome<{ row: ComingUpRow | null }>> {
  const key = raw && typeof raw === "object" ? (raw as Record<string, unknown>).key : null;
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return refuse(400, RHYTHM_REFUSALS.skipUnknown);
  const v = await viewerOf(pool, who, deps);
  if (!mayKeepRhythm(circleId, v.lib)) return refuse(403, RHYTHM_REFUSALS.notYours);
  const zone = villageTimezone();
  const setByNo = v.no ?? (await ensureMemberNo(pool, who.userId, now));
  const out = await room.inTransaction(pool, async (conn: PoolConnection): Promise<Outcome<null>> => {
    const [row] = await store.rhythmRow(conn, circleId, true);
    if (!row) return refuse(404, RHYTHM_REFUSALS.noRhythm);
    const r = mapRhythm(row);
    if (!nextMeetings(r, now, zone, RHYTHM_LIMITS.skipAhead).some((m) => m.key === key)) return refuse(409, RHYTHM_REFUSALS.skipUnknown);
    if (!r.recurrence) {
      await store.deleteRhythm(conn, circleId);
      return done(null);
    }
    const exceptions = Array.from(new Set([...(r.recurrence.exceptions ?? []), key])).sort();
    await store.writeRecurrence(conn, circleId, JSON.stringify({ ...r.recurrence, exceptions }), setByNo, now);
    return done(null);
  });
  if (!out.ok) return out;
  return done({ row: await oneRow(pool, circleId, who, deps, now) });
}

// ── One circle's sessions ───────────────────────────────────────────────────

/**
 * One circle's sessions, for its home page: its rhythm in words, its next
 * meeting, when it last met, what waits for it as this viewer may see it,
 * and its open room. A circle that is not a live one answers null.
 */
export async function circleSummary(pool: Pool, circleId: string, who: RhythmAsker, deps: RhythmDeps, now = new Date()): Promise<CircleSessionsSummary | null> {
  if (!deps.circles().some((c) => c.id === circleId)) return null;
  const zone = villageTimezone();
  const v = await viewerOf(pool, who, deps);
  const [row] = await store.rhythmRow(pool, circleId);
  const r = row ? mapRhythm(row) : null;
  const [next] = r ? nextMeetings(r, now, zone, 1) : [];
  const [last] = await room.lastMeetingPerCircle(pool, { circleIds: [circleId] });
  const [closed] = last ? await store.closedAtRows(pool, [Number(last.id)]) : [];
  return {
    circleId,
    rhythm: r ? { words: rhythmWords(r, zone), kind: r.kind } : null,
    next: next ? { ...next, words: meetingWords(new Date(next.at), now, zone) } : null,
    lastMetAt: closed ? toIso(closed.closed_at) : null,
    waiting: (await waitingByCircle(pool, v)).get(circleId) ?? 0,
    openRoom: (await openRooms(pool)).get(circleId) ?? null,
    canKeep: mayKeepRhythm(circleId, v.lib),
  };
}

// ── The day before ──────────────────────────────────────────────────────────

/**
 * A circle's members, as user ids: whoever sits in one of its kept seats now
 * (live and not lapsed), and whoever was in its last meeting. The same two
 * halves standing reads, from the circle's side.
 */
export async function circleMemberUserIds(pool: Pool, circleId: string, lapseContext?: () => LapseContext): Promise<string[]> {
  const out = new Set<string>();
  const seatings = await listOrgAssignments(pool, lapseContext?.());
  for (const role of await listOrgRoles(pool)) {
    if (role.circleId !== circleId || !keptSeat(role)) continue;
    for (const userId of liveHoldersOf(seatings, role.id)) out.add(userId);
  }
  const [last] = await room.lastMeetingPerCircle(pool, { circleIds: [circleId] });
  if (last) {
    const nos = (await store.peopleOfRows(pool, [Number(last.id)])).map((r) => Number(r.member_no));
    for (const r of await room.memberUserIdRows(pool, nos)) out.add(String(r.user_id));
  }
  return Array.from(out);
}

/** The job's name and pace: hourly, so each meeting's notice goes in the village's daytime the day before. */
export const COMING_UP_JOB = "session-coming-up";
export const COMING_UP_EVERY_MS = 60 * 60 * 1000;

/**
 * The day before a circle meets, each of its members hears when, with what is
 * on the agenda: in the bell, no email (no preference a member has set covers
 * a meeting reminder). Once per meeting per person: the key is
 * `session-coming:<circle>:<date>:<user>`, so the job can run every hour of
 * the day and a skipped or moved meeting is a new key. Nothing runs while the
 * module is off or outside the village's daytime window.
 */
export async function runComingUpNotes(deps: RhythmNoticeDeps, now = new Date()): Promise<string> {
  const lifecycle = deps.lifecycle ?? (() => effectiveLifecycle("sessions"));
  if (lifecycle() === "off") return "the sessions module is off";
  const zone = villageTimezone();
  const hours = deps.window?.() ?? { start: numberVar("comms.quiet_start_hour"), end: numberVar("comms.quiet_end_hour") };
  if (nextInWindow(now, zone, hours.start, hours.end).getTime() !== now.getTime()) return "outside the village's daytime window";
  const pool = deps.getPool();
  const circles = new Map(deps.circles().map((c) => [c.id, c]));
  const soon = (await store.rhythmRows(pool))
    .map(mapRhythm)
    .filter((r) => circles.has(r.circleId))
    .map((r) => ({ r, next: nextMeetings(r, now, zone, 1)[0] }))
    .filter((x) => x.next && Date.parse(x.next.at) > now.getTime() && Date.parse(x.next.at) - now.getTime() <= RHYTHM_LIMITS.remindHours * 3_600_000);
  if (!soon.length) return "no circle meets in the next day";
  // Everything waiting, read once: a circle's members may read its own items and those for no circle.
  const waiting = (await library.liveRows(pool, { admin: true, no: null, standing: [], limit: 500 })).map(mapLibrary).filter((r) => r.status === "waiting");
  let sent = 0;
  for (const { r, next } of soon) {
    const circle = circles.get(r.circleId)!;
    const titles = waiting.filter((i) => i.circleId === r.circleId).map((i) => i.title);
    const title = RHYTHM_NOTICES.comingUp(circle.name, meetingPhrase(new Date(next!.at), now, zone));
    const body = RHYTHM_NOTICES.agenda(titles.slice(0, 3), Math.max(0, titles.length - 3));
    for (const userId of await circleMemberUserIds(pool, r.circleId, deps.lapseContext)) {
      try {
        const fresh = await deps.notify({
          userId,
          type: "session_coming_up",
          title,
          body,
          link: comingLink(r.circleId),
          dedupeKey: `session-coming:${r.circleId}:${next!.key}:${userId}`,
        });
        if ((fresh as { fresh?: boolean } | null)?.fresh !== false) sent += 1;
      } catch (e) {
        console.error(`[sessions] a coming-up notice for ${r.circleId} did not go`, e);
      }
    }
  }
  return `${sent} coming-up notice(s) for ${soon.length} meeting(s)`;
}

// ── The member's own ────────────────────────────────────────────────────────

/** The rhythms a member set last, for the export. */
export async function exportRhythmsFor(pool: Pool, no: number): Promise<Record<string, unknown>[]> {
  return (await store.memberRows(pool, no)).map((r) => ({ circleId: String(r.circle_id), setAt: toIso(r.updated_at) }));
}

/** The member leaves, inside the erasure's transaction. */
export async function forgetRhythmsFor(conn: PoolConnection, no: number): Promise<void> {
  await store.forgetMember(conn, no);
}
