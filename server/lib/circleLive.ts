/**
 * THE CIRCLE CARD'S LIVE PARTS: what Amora reads about a circle itself, never
 * typed. Read once per card, at the member tier (`terms.read`, the tier the
 * player card counts its signs at); below it the card draws none of this.
 *
 *   signs      three counts from the sign catalog (shared/roleSigns.ts), each
 *              with its trend against the moon before: times the circle met,
 *              decisions recorded in its meetings, and its roles with a full
 *              card and a term. The catalog's own counters, handed only this
 *              circle's rows, so the counting rule is the role card's.
 *   last met   the circle's last real meeting, by Live Sessions' own rule
 *              (`lastMeetingInCircle`, server/repos/liveSessions.ts: closed,
 *              and at least two people were in it). The meeting rhythm and
 *              what waits for the next meeting are the Live Sessions lane's
 *              to show, on the same page (`CircleSessions`).
 *   tensions   open tensions on the circle's roles, the count `/api/org`'s
 *              role tiles read (`openTensionCountsFor`), never their words.
 *
 * Nothing here writes, and nothing here names a person.
 */
import type { Pool } from "mysql2/promise";
import type { CycleClock } from "../../shared/cycleClock";
import { cycleWindows, readSign, type SignReading, type SignRows } from "../../shared/roleSigns";
import type { OrgAssignment, OrgRole } from "./orgChart";
import { openTensionCountsFor } from "./roleTensions";
import { readSignTables } from "../repos/playerCard";
import { lastMeetingInCircle } from "../repos/liveSessions";

/** The signs a circle card counts, in the order it shows them. */
export const CIRCLE_SIGN_KEYS = ["circle-met", "decisions-recorded", "roles-with-card-and-term"] as const;

export interface CircleLiveIn {
  signs: SignReading[];
  /** The last real meeting's close, ISO, or null when the circle has not met. */
  lastMetAt: string | null;
  /** Open tensions across the circle's roles. */
  openTensions: number;
}

const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export async function readCircleLive(
  pool: Pool,
  circleId: string,
  roles: readonly OrgRole[],
  assignments: readonly OrgAssignment[],
  ctx: { now: Date; timeZone: string; clock: CycleClock },
): Promise<CircleLiveIn> {
  const windows = cycleWindows(ctx.now, ctx.clock, ctx.timeZone);
  const roleIds = roles.map((r) => r.id);
  const [tables, met, tensions] = await Promise.all([
    readSignTables(pool, new Set(["live_sessions", "live_session_people", "live_session_entries"] as const), windows.previous.from, null),
    lastMeetingInCircle(pool, circleId, 0),
    openTensionCountsFor(pool, roleIds),
  ]);

  const sessions = (tables.rows.live_sessions ?? []).filter((s) => s.circle_id === circleId);
  const ours = new Set(sessions.map((s) => s.id));
  const meetRows: SignRows = { ...tables.rows, circle_id: circleId };
  // Decisions written into this circle's meetings only: the catalog counts what it is handed.
  const decisionRows: SignRows = { live_session_entries: (tables.rows.live_session_entries ?? []).filter((e) => ours.has(e.session_id)) };
  const ids = new Set(roleIds);
  const roleRows: SignRows = {
    org_roles: roles.map((r) => ({ id: r.id, active: r.active, aim: r.aim ?? null, domain: r.domain ?? null, accountabilities: r.accountabilities ?? [], name: r.name })),
    org_role_assignments: assignments
      .filter((a) => ids.has(a.orgRoleId) && !a.isExample)
      .map((a) => ({
        org_role_id: a.orgRoleId,
        user_id: a.userId ?? null,
        started_at: a.startedAt as any,
        ended_at: (a.endedAt ?? null) as any,
        term_ends_at: (a.termEndsAt ?? null) as any,
      })),
  };
  const signs = [
    readSign("circle-met", meetRows, windows),
    readSign("decisions-recorded", decisionRows, windows),
    readSign("roles-with-card-and-term", roleRows, windows),
  ];
  let open = 0;
  tensions.forEach((n) => {
    open += n;
  });
  return { signs, lastMetAt: iso(met[0]?.closed_at), openTensions: open };
}
