/**
 * The focus and note on a LIVE seating, and nothing else about it.
 *
 * The holder, the term and the start never move here, and an ended seating is
 * history, so it is not found. An omitted key keeps its column; null clears it.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { seatingsChanged } from "../lib/orgChart";

type Db = Pool | PoolConnection;

/** The seat's id when a live seating was found (and changed), or null. */
export async function updateSeatingText(
  db: Db,
  assignmentId: string,
  text: { focus?: string | null; note?: string | null },
): Promise<{ orgRoleId: string } | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT org_role_id FROM org_role_assignments WHERE id = ? AND ended_at IS NULL",
    [assignmentId],
  );
  if (!rows[0]) return null;
  const sets: string[] = [];
  const args: Array<string | null> = [];
  if (text.focus !== undefined) { sets.push("focus = ?"); args.push(text.focus); }
  if (text.note !== undefined) { sets.push("note = ?"); args.push(text.note); }
  if (sets.length) {
    await db.query(`UPDATE org_role_assignments SET ${sets.join(", ")} WHERE id = ? AND ended_at IS NULL`, [...args, assignmentId]);
    seatingsChanged();
  }
  return { orgRoleId: String(rows[0].org_role_id) };
}
