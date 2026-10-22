/**
 * Live Sessions: STANDING IN A CIRCLE, and the circle's LAST TIME. One measure,
 * read by every feature that asks who belongs to a circle's work, so no two of
 * them can drift apart:
 *
 *   the task layer   server/lib/sessionTasks.ts: who reads a circle's task
 *                    cards, takes what came back to it, and hosts its room
 *   the library      server/lib/sessionLibrary.ts: who reads and rewords the
 *                    items waiting for a circle's next call
 *   the room         server/lib/liveSessions.ts and sessionTasks.ts: which
 *                    earlier session "From last time" reads
 *
 * ── STANDING ─────────────────────────────────────────────────────────────
 *
 * A member has standing in a circle when they were in its last MEETING, or
 * they sit in one of its seats now. A meeting is a closed session at least
 * two people were in (`MEETING_MIN_PEOPLE` in server/repos/liveSessions.ts,
 * Rye, 2026-10-21): any member may open a room for any circle and close it
 * alone, and that close must neither hand them the circle's work nor take it
 * from the people who were at its last real meeting. The count is the one the
 * close kept, so a meeting stays a meeting after one of its people leaves the
 * village and their row goes. A seat counts when its seating is live and its
 * term has not lapsed (`liveSeatIdsFor`), in a seat the circle still keeps
 * (`keptSeat`).
 *
 * ── THE CIRCLE'S LAST TIME ───────────────────────────────────────────────
 *
 * An open room carries from the circle's last meeting: its backlog and parked
 * items (`carried`), and the moment the action check groups by (`lastMetAt`).
 * A circle that has never met with two people in the room carries from its
 * last close of any size instead, so a circle of one still carries from one
 * call to the next.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import * as repo from "../repos/liveSessions";
import { listOrgRoles, type OrgRole } from "./orgChart";

/** A seat the circle still keeps: active, and not a standing example. The room's own seat list reads seats the same way. */
export function keptSeat(role: Pick<OrgRole, "active" | "isExample">): boolean {
  return role.active && !role.isExample;
}

/**
 * The circles where one member has standing, among `circleIds`, or among every
 * circle when none are named. `liveSeatIds` are the seats they sit in now
 * (`liveSeatIdsFor`, lapsed terms already left out); `no` is their number in
 * `live_session_members`, or null when they have never touched a session, in
 * which case only their seats count.
 */
export async function standingIn(
  pool: Pool | PoolConnection,
  who: { no: number | null; liveSeatIds: readonly string[] },
  circleIds?: Iterable<string>,
): Promise<Set<string>> {
  const wanted = circleIds ? new Set(circleIds) : null;
  const out = new Set<string>();
  if (wanted && !wanted.size) return out;
  if (who.liveSeatIds.length) {
    for (const role of await listOrgRoles(pool as Pool)) {
      const circleId = role.circleId ? String(role.circleId) : null;
      if (circleId && keptSeat(role) && who.liveSeatIds.includes(role.id) && (!wanted || wanted.has(circleId))) out.add(circleId);
    }
  }
  if (who.no != null && who.no > 0) {
    const last = await repo.lastMeetingPerCircle(pool, wanted ? { circleIds: Array.from(wanted) } : {});
    const circleOf = new Map(last.map((r) => [Number(r.id), String(r.circle_id)]));
    for (const r of await repo.joinedRows(pool, who.no, Array.from(circleOf.keys()))) {
      const circleId = circleOf.get(Number(r.session_id));
      if (circleId) out.add(circleId);
    }
  }
  return out;
}

/**
 * The session an open room of this circle carries from: the circle's last
 * meeting other than `exceptId`, or, when the circle has never met with two
 * people in the room, its last close of any size. Null when it has never
 * closed a session at all.
 */
export async function lastTimeIn(pool: Pool | PoolConnection, circleId: string, exceptId: number): Promise<RowDataPacket | null> {
  const [met] = await repo.lastMeetingInCircle(pool, circleId, exceptId);
  if (met) return met;
  const [closed] = await repo.lastClosedInCircle(pool, circleId, exceptId);
  return closed ?? null;
}
