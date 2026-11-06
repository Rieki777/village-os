/**
 * WHO A MEMBER WORKED WITH IN ONE CYCLE, read from the four places work
 * actually leaves a trace together. The suggestions the gratitude nudge and the
 * send panel show are ranked from these rows (server/lib/gratitudeNudge.ts);
 * nothing here ranks, names or decides.
 *
 *  - `quest`: somebody else claimed a quest this member claimed, and both
 *    claims were alive inside the window.
 *  - `crew`: somebody shares a quest crew with this member that was forming or
 *    active in the window.
 *  - `circle`: somebody holds a live role in a circle where this member holds
 *    a live role. Seatings are live data rather than dated work, so a seating
 *    that ended before the window opened is left out.
 *  - `session`: somebody was in a live session room with this member, in a
 *    session that started inside the window.
 *
 * Examples and documented holders are never people anybody worked with, so
 * every read leaves them out. Each read returns one row per (person, source)
 * with how many times they met, so a weight is a count the caller can see.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export type WorkedWithSource = "quest" | "crew" | "circle" | "session";

export interface WorkedWithRow {
  userId: string;
  source: WorkedWithSource;
  /** How many shared quests, crews, circles or sessions. Always 1 or more. */
  times: number;
}

export interface WorkedWithWindow {
  startsAt: Date;
  endsAt: Date;
}

const rows = (source: WorkedWithSource, r: RowDataPacket[]): WorkedWithRow[] =>
  r.map((x) => ({ userId: String(x.user_id), source, times: Math.max(1, Number(x.times) || 1) }));

/** Other claimants of the quests this member claimed, both claims alive in the window. */
export async function questPartners(pool: Pool, userId: string, w: WorkedWithWindow): Promise<WorkedWithRow[]> {
  const alive =
    "%s.claimed_at < ? AND (%s.status IN ('claimed','submitted') OR COALESCE(%s.consented_at, %s.submitted_at, %s.claimed_at) >= ?)";
  const [r] = await pool.query<RowDataPacket[]>(
    "SELECT o.user_id, COUNT(DISTINCT o.quest_id) AS times FROM quest_claims m " +
      "JOIN quest_claims o ON o.quest_id = m.quest_id AND o.user_id <> m.user_id " +
      "JOIN users u ON u.id = o.user_id AND u.is_example = 0 " +
      `WHERE m.user_id = ? AND ${alive.replace(/%s/g, "m")} AND ${alive.replace(/%s/g, "o")} ` +
      "GROUP BY o.user_id",
    [userId, w.endsAt, w.startsAt, w.endsAt, w.startsAt],
  );
  return rows("quest", r);
}

/** Crewmates in a crew that was forming or active in the window. */
export async function crewPartners(pool: Pool, userId: string, w: WorkedWithWindow): Promise<WorkedWithRow[]> {
  const [r] = await pool.query<RowDataPacket[]>(
    "SELECT o.user_id, COUNT(DISTINCT c.id) AS times FROM quest_crew_members m " +
      "JOIN quest_crews c ON c.id = m.crew_id AND c.status <> 'disbanded' " +
      "JOIN quest_crew_members o ON o.crew_id = m.crew_id AND o.user_id <> m.user_id " +
      "JOIN users u ON u.id = o.user_id AND u.is_example = 0 " +
      "WHERE m.user_id = ? AND m.joined_at < ? AND o.joined_at < ? " +
      "AND (c.status IN ('forming','active') OR c.created_at >= ? OR o.joined_at >= ?) " +
      "GROUP BY o.user_id",
    [userId, w.endsAt, w.endsAt, w.startsAt, w.startsAt],
  );
  return rows("crew", r);
}

/** People holding a live role in a circle where this member holds one. */
export async function circlePartners(pool: Pool, userId: string, w: WorkedWithWindow): Promise<WorkedWithRow[]> {
  const live = "%s.holder_kind = 'member' AND %s.is_example = 0 AND %s.started_at < ? AND (%s.ended_at IS NULL OR %s.ended_at >= ?)";
  const [r] = await pool.query<RowDataPacket[]>(
    "SELECT oa.user_id, COUNT(DISTINCT mr.circle_id) AS times FROM org_role_assignments ma " +
      "JOIN org_roles mr ON mr.id = ma.org_role_id AND mr.active = 1 AND mr.is_example = 0 AND mr.circle_id IS NOT NULL " +
      "JOIN org_roles orr ON orr.circle_id = mr.circle_id AND orr.active = 1 AND orr.is_example = 0 " +
      "JOIN org_role_assignments oa ON oa.org_role_id = orr.id AND oa.user_id IS NOT NULL AND oa.user_id <> ma.user_id " +
      "JOIN users u ON u.id = oa.user_id AND u.is_example = 0 " +
      `WHERE ma.user_id = ? AND ${live.replace(/%s/g, "ma")} AND ${live.replace(/%s/g, "oa")} ` +
      "GROUP BY oa.user_id",
    [userId, w.endsAt, w.startsAt, w.endsAt, w.startsAt],
  );
  return rows("circle", r);
}

/** People in a live session room with this member, sessions started in the window. */
export async function sessionPartners(pool: Pool, userId: string, w: WorkedWithWindow): Promise<WorkedWithRow[]> {
  const [r] = await pool.query<RowDataPacket[]>(
    "SELECT om.user_id, COUNT(DISTINCT s.id) AS times FROM live_session_members mm " +
      "JOIN live_session_people mp ON mp.member_no = mm.no " +
      "JOIN live_sessions s ON s.id = mp.session_id AND s.created_at >= ? AND s.created_at < ? " +
      "JOIN live_session_people op ON op.session_id = s.id AND op.member_no <> mp.member_no " +
      "JOIN live_session_members om ON om.no = op.member_no " +
      "JOIN users u ON u.id = om.user_id AND u.is_example = 0 " +
      "WHERE mm.user_id = ? GROUP BY om.user_id",
    [w.startsAt, w.endsAt, userId],
  );
  return rows("session", r);
}

/**
 * Everybody this member already thanked this cycle, by written gratitude or
 * heart. Keyed on `cycle_id`, the string the allowance spends against and the
 * wall counts hearts by, so the three never disagree about which cycle a gift
 * fell in.
 */
export async function thankedInCycle(pool: Pool, userId: string, cycleId: string): Promise<string[]> {
  const [r] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT to_id FROM gratitude_log WHERE from_id = ? AND cycle_id = ?",
    [userId, cycleId],
  );
  return r.map((x) => String(x.to_id));
}
