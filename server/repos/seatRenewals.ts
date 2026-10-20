/**
 * The seats a member already has a renewal adopted for, read by the term
 * watch (server/lib/stewardship.ts) so a member is not told their term ends
 * when the village has already adopted their next one (season plans RC2).
 *
 * On its own and importing nothing from shared/: the term watch sits under
 * every value-moving module, and shared/seatSettings.boundary.test.ts keeps
 * the seat settings model away from all of them. `seat_applications` is the
 * table server/repos/seatApplications.ts owns; this is its one other reader.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** `<userId>@<seatId>` for every seat named by an adopted application that no seating has taken up yet. */
export async function adoptedUnseatedSeats(db: Pool): Promise<Set<string>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT candidate_user_id, seat_ids FROM seat_applications a WHERE status = 'adopted' " +
      "AND NOT EXISTS (SELECT 1 FROM org_role_assignments s WHERE s.application_id = a.id) LIMIT 2000",
  );
  const out = new Set<string>();
  for (const r of rows as any[]) {
    let seats: unknown = r.seat_ids;
    if (typeof seats === "string") {
      try {
        seats = JSON.parse(seats);
      } catch {
        seats = [];
      }
    }
    for (const seat of Array.isArray(seats) ? seats : []) out.add(`${String(r.candidate_user_id)}@${String(seat)}`);
  }
  return out;
}
