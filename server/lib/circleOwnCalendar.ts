/**
 * Live Sessions: A CIRCLE'S OWN CALENDAR. A circle that keeps its meetings in
 * Google Calendar, Apple or Outlook attaches that calendar's secret address,
 * and its meetings count as the circle's. The table that says whose calendar
 * is whose is 0277 (server/repos/sessionCalendar.ts); the words and shapes are
 * shared/sessionCalendar.ts.
 *
 *   ownCalendars      every circle's own calendar, as its keepers see it
 *   importedNext      each circle's next meeting from its own calendar
 *   importedRowsFor   those meetings as calendar rows, for a follower's feed
 *   attachOwnCalendar attach or replace one, and read it at once
 *   detachOwnCalendar detach one
 *
 * NOTHING HERE FETCHES, STORES AN ADDRESS OR IMPORTS. A circle's own calendar
 * is one of the village's own external calendar subscriptions
 * (server/lib/externalCalendars.ts): the address sealed in the secrets store
 * and never returned, every fetch through the outbound guard, the events
 * imported onto the circle layer every few hours by the calendar's own job.
 * This file adds the circle to it, and reads back what was imported.
 *
 * RIGHTS LIVE WITH THE CALLER: server/lib/sessionRhythm.ts asks the standing
 * rule (the circle's members and admins) before it attaches or detaches.
 */
import type { Pool } from "mysql2/promise";
import * as store from "../repos/sessionCalendar";
import { addExternalCalendar, getExternalCalendar, listExternalCalendars, pollExternalCalendar, removeExternalCalendar, type ExternalCalendarView } from "./externalCalendars";
import { rowToCalendarRow, type CalendarRow } from "./calendar";
import type { Outcome, Refusal } from "./liveSessions";
import { SESSION_LIMITS } from "../../shared/sessions";
import { RHYTHM_LIMITS, villageKey, type Meeting } from "../../shared/sessionRhythm";
import { OWN_CALENDAR_COPY, OWN_CALENDAR_REFUSALS, type OwnCalendarView } from "../../shared/sessionCalendar";

const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error });
const DAY_MS = 86_400_000;

export interface OwnCalendar {
  circleId: string;
  externalId: string;
  view: OwnCalendarView;
}

/** A meeting from a circle's own calendar: when, what it is called, and how long. */
export interface ImportedMeeting {
  meeting: Meeting;
  title: string;
  durationMin: number;
}

function viewOf(sub: ExternalCalendarView): OwnCalendarView {
  return {
    host: sub.urlHost,
    last4: sub.urlLast4,
    lastReadAt: sub.lastPolledAt,
    status: sub.lastStatus === "ok" ? "ok" : sub.lastStatus === "failed" ? "failed" : "never",
  };
}

/**
 * Every circle's own calendar, by circle. One whose subscription an admin has
 * since removed from the Events page is left out: it reads as no calendar.
 */
export async function ownCalendars(pool: Pool): Promise<Map<string, OwnCalendar>> {
  const rows = await store.ownCalendarRows(pool);
  const out = new Map<string, OwnCalendar>();
  if (!rows.length) return out;
  const subs = new Map((await listExternalCalendars(pool)).map((c) => [c.id, c]));
  for (const row of rows) {
    const sub = subs.get(String(row.external_calendar_id));
    if (sub) out.set(String(row.circle_id), { circleId: String(row.circle_id), externalId: sub.id, view: viewOf(sub) });
  }
  return out;
}

/**
 * Each circle's next meeting from its own calendar that has not ended by
 * `now`, within the days Coming up looks ahead. A cancelled one is passed by.
 */
export async function importedNext(
  pool: Pool,
  own: ReadonlyMap<string, OwnCalendar>,
  now: Date,
  zone: string,
  lookAheadDays: number = RHYTHM_LIMITS.lookAheadDays,
): Promise<Map<string, ImportedMeeting>> {
  const out = new Map<string, ImportedMeeting>();
  if (!own.size) return out;
  const circleOf = new Map(Array.from(own.values()).map((o) => [o.externalId, o.circleId]));
  const rows = (await store.importedRows(pool, Array.from(circleOf.keys()), now, new Date(now.getTime() + lookAheadDays * DAY_MS))).map(rowToCalendarRow);
  for (const r of rows) {
    const circleId = r.externalSourceId ? circleOf.get(r.externalSourceId) : undefined;
    if (!circleId || out.has(circleId) || r.status !== "scheduled") continue;
    const endsAt = r.endsAt ?? new Date(r.startsAt.getTime() + SESSION_LIMITS.durationDefault * 60_000);
    if (endsAt.getTime() <= now.getTime()) continue;
    const minutes = Math.round((endsAt.getTime() - r.startsAt.getTime()) / 60_000);
    out.set(circleId, {
      meeting: { at: r.startsAt.toISOString(), endsAt: endsAt.toISOString(), key: villageKey(r.startsAt, zone) },
      title: r.title,
      durationMin: Math.min(SESSION_LIMITS.durationMax, Math.max(SESSION_LIMITS.durationMin, minutes || SESSION_LIMITS.durationDefault)),
    });
  }
  return out;
}

/** The meetings of these circles' own calendars in a window, as calendar rows, for a follower's feed. */
export async function importedRowsFor(pool: Pool, own: ReadonlyMap<string, OwnCalendar>, circleIds: ReadonlySet<string> | "all", from: Date, to: Date): Promise<CalendarRow[]> {
  const ids = Array.from(own.values())
    .filter((o) => circleIds === "all" || circleIds.has(o.circleId))
    .map((o) => o.externalId);
  return (await store.importedRows(pool, ids, from, to)).map(rowToCalendarRow);
}

/**
 * Attach a circle's own calendar, or a different one in its place, and read
 * it at once so its meetings show now. The address is checked and stored by
 * the subscription itself (https or webcal only, never a private address,
 * sealed, refused while the village has no secrets key), and its sentence is
 * the one this answers. A read that fails still attaches: the calendar's own
 * job tries again in a few hours, and the panel says the first read did not
 * work.
 */
export async function attachOwnCalendar(
  pool: Pool,
  input: { circleId: string; circleName: string; raw: unknown; userId: string; setByNo: number; zone: string; now: Date; fetchText?: (url: string) => Promise<string> },
): Promise<Outcome<{ view: OwnCalendarView; read: boolean }>> {
  const b = input.raw && typeof input.raw === "object" ? (input.raw as Record<string, unknown>) : {};
  const url = typeof b.url === "string" ? b.url.trim() : "";
  if (!url) return refuse(400, OWN_CALENDAR_REFUSALS.urlNeeded);
  const added = await addExternalCalendar(pool, { name: OWN_CALENDAR_COPY.subscriptionName(input.circleName), url, layer: "circle", createdBy: input.userId });
  if (!added.ok) return refuse(400, added.message ?? added.error);
  const [before] = await store.ownCalendarRow(pool, input.circleId);
  await store.putOwnCalendar(pool, { circleId: input.circleId, externalId: added.calendar.id, setByNo: input.setByNo, now: input.now });
  if (before && String(before.external_calendar_id) !== added.calendar.id) {
    await removeExternalCalendar(pool, String(before.external_calendar_id), input.userId);
  }
  const read = await pollExternalCalendar(pool, added.calendar.id, { timezone: input.zone, now: input.now, fetchText: input.fetchText });
  const sub = await getExternalCalendar(pool, added.calendar.id);
  return { ok: true, value: { view: viewOf(sub ?? added.calendar), read: read.ok } };
}

/** Detach a circle's own calendar: its subscription, its address and its imported meetings go. */
export async function detachOwnCalendar(pool: Pool, circleId: string, userId: string): Promise<Outcome<null>> {
  const [row] = await store.ownCalendarRow(pool, circleId);
  if (!row) return refuse(404, OWN_CALENDAR_REFUSALS.noneAttached);
  await removeExternalCalendar(pool, String(row.external_calendar_id), userId);
  await store.deleteOwnCalendar(pool, circleId);
  return { ok: true, value: null };
}

/** The circles whose own calendar a member attached, for the export. */
export async function exportOwnCalendarsFor(pool: Pool, no: number): Promise<Record<string, unknown>[]> {
  return (await store.memberOwnCalendarRows(pool, no)).map((r) => ({
    circleId: String(r.circle_id),
    since: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ""),
  }));
}
