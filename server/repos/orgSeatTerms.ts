/**
 * `org_role_assignments.term_*` for seats that end with their season (0199).
 *
 * The org chart's seatings carry no powers, and since 0199 every one of them
 * carries a term. A seating whose term is its season's end is marked
 * `term_follows_season = 1`, and when an admin moves that season's end the
 * seating moves with it. The rule that decides WHICH seatings move is
 * `restampsFor` in shared/seatTerms.ts; the caller is
 * `restampSeatsToCalendar` in server/lib/seatTermLanding.ts. This file holds
 * the read that finds candidates and the write that moves one, and nothing
 * else.
 *
 * Live and real only. An ended seating is history, and an admin editing the
 * calendar rewrites what a seat will do, never what it did. An example seating
 * is a standing demonstration with no season of its own to follow.
 *
 * `org_roles` is joined for the display name alone, LEFT so a seating whose
 * seat row is gone still comes back and can still be told its date moved.
 *
 * Timestamps come back as the driver made them (mysql2 under `timezone: "Z"`),
 * the way server/repos/seatHoldings.ts reads the same column.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface FollowingOrgSeating {
  id: string;
  userId: string | null;
  holderKind: string;
  roleName: string;
  seasonId: string | null;
  termEndsAt: Date;
}

export async function followingOrgSeatings(pool: Pool, after: Date): Promise<FollowingOrgSeating[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT a.id, a.user_id, a.holder_kind, a.season_id, a.term_ends_at, r.name AS role_name " +
      "FROM org_role_assignments a LEFT JOIN org_roles r ON r.id = a.org_role_id " +
      "WHERE a.ended_at IS NULL AND a.is_example = 0 AND a.term_follows_season = 1 AND a.term_ends_at > ?",
    [after],
  );
  return rows.map((r) => ({
    id: String(r.id),
    userId: r.user_id ? String(r.user_id) : null,
    holderKind: String(r.holder_kind),
    roleName: String(r.role_name ?? "a seat"),
    seasonId: r.season_id ? String(r.season_id) : null,
    termEndsAt: r.term_ends_at instanceof Date ? r.term_ends_at : new Date(String(r.term_ends_at)),
  }));
}

/** Move a live seating's term end, because its season moved. */
export async function restampOrgSeating(pool: Pool, assignmentId: string, termEndsAt: Date): Promise<void> {
  await pool.query("UPDATE org_role_assignments SET term_ends_at = ? WHERE id = ? AND ended_at IS NULL", [
    termEndsAt,
    assignmentId,
  ]);
}
