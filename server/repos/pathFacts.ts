/**
 * The three small reads the path conductor needs that no other repo already
 * gives in one piece (server/lib/pathFacts.ts): a member's own seatings with
 * their start day, whether a leaving is open, and whether a moon recap was
 * ever sent. Reads only, one member at a time.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface OwnSeating {
  roleId: string;
  role: string;
  startedAt: Date;
  termEndsAt: Date | null;
}

/** The member's live seatings, a term run out included (a lapsed seating is still a row with no end). */
export async function ownSeatings(pool: Pool, userId: string): Promise<OwnSeating[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT a.org_role_id, a.started_at, a.term_ends_at, r.name AS role_name FROM org_role_assignments a LEFT JOIN org_roles r ON r.id = a.org_role_id " +
      "WHERE a.user_id = ? AND a.holder_kind = 'member' AND a.ended_at IS NULL ORDER BY a.started_at ASC LIMIT 50",
    [userId],
  );
  return (rows as any[]).map((r) => ({
    roleId: String(r.org_role_id),
    role: String(r.role_name ?? ""),
    startedAt: new Date(r.started_at),
    termEndsAt: r.term_ends_at ? new Date(r.term_ends_at) : null,
  }));
}

/** The member's leaving, while it is open or settling. */
export async function openExitOf(pool: Pool, userId: string): Promise<"open" | "settling" | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT status FROM exits WHERE user_id = ? AND status IN ('open', 'settling') LIMIT 1", [userId]);
  const s = (rows as any[])[0]?.status;
  return s === "open" || s === "settling" ? s : null;
}

/** True once any recap of the member's left Draft. */
export async function recapEverSent(pool: Pool, userId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT 1 FROM `moon_recaps` WHERE `user_id` = ? AND `status` <> 'draft' LIMIT 1", [userId]);
  return (rows as any[]).length > 0;
}
