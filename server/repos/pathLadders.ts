/**
 * The one read the per-path ladders needed and did not already have.
 *
 * Three of the four ladders were already served by existing reads:
 * `reservationsForMember` (server/lib/housing.ts), `factsForMember`
 * (server/repos/investorPath.ts) and `venturesForMember`
 * (server/repos/ventures.ts). The steward ladder is the exception, because
 * `server/lib/orgChart.ts` reads seatings either LIVE for the whole village
 * (`listOrgAssignments`) or by SEAT for one seat's history (`orgRoleHistory`),
 * and neither of those is "one member, live and ended".
 *
 * ── WHY ENDED SEATINGS ARE IN THE READ ──────────────────────────────────────
 *
 * Because history is the half that does not fall. A ladder derives its position
 * from live rows only, so an ended seating never lifts anybody; what it does is
 * let the panel say the rung WAS reached and why it ended, from `ended_at` and
 * `ended_reason` on the row that is still there. Dropping ended rows from this
 * query would make the steward ladder go blank on the day somebody stood down,
 * with no way to tell that apart from a member who was never seated.
 *
 * ── THE JOIN, AND WHY IT IS A LEFT JOIN ─────────────────────────────────────
 *
 * Two of the three steward rungs are decided by columns on the SEAT rather than
 * on the seating: `expires_each_season` (whether a season turn lapses the
 * mandate) and `represents_circle` (whether the seat carries its circle's pen).
 * Reading them here keeps the whole answer one round trip.
 *
 * LEFT, so a seating whose seat has been deleted still returns. It comes back
 * with the role flags null and false, which `server/lib/pathLadders.ts` reads as
 * "no expiry rule of its own, does not speak for a circle, not active", and an
 * inactive seat cannot light the top rung. An INNER join would drop the row
 * entirely and the member's seat history would silently shorten.
 *
 * ── INDEX ───────────────────────────────────────────────────────────────────
 *
 * `org_role_assignments_user_idx (user_id)` from 0049. This table has no
 * `village_id` column, which is not an omission here: 0049 predates the scope
 * retrofit and the whole org plane is single-village.
 */
import { reservationsForMember } from "./housing";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { SeatingFacts } from "../lib/pathLadders";

const COLUMNS =
  "a.id, a.org_role_id, a.holder_kind, a.user_id, a.season_id, a.term_ends_at, " +
  "a.started_at, a.ended_at, a.ended_reason, a.is_example, " +
  "r.expires_each_season, r.represents_circle, r.active AS role_active, " +
  "r.is_example AS role_is_example";

const toDate = (v: unknown): Date | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
};

const toRow = (r: RowDataPacket): SeatingFacts => ({
  orgRoleId: String(r.org_role_id),
  holderKind: String(r.holder_kind),
  seasonId: r.season_id == null ? null : String(r.season_id),
  termEndsAt: toDate(r.term_ends_at),
  // Kept as the driver returned it. `server/lib/pathLadders.ts` reads it
  // through one `at()` helper that answers NaN for anything unreadable, so a
  // row with a broken timestamp loses its date and keeps its meaning.
  startedAt: toDate(r.started_at) ?? String(r.started_at),
  endedAt: r.ended_at == null ? null : (toDate(r.ended_at) ?? String(r.ended_at)),
  endedReason: r.ended_reason == null ? null : String(r.ended_reason),
  isExample: Number(r.is_example) === 1,
  roleExpiresEachSeason:
    r.expires_each_season == null ? null : Number(r.expires_each_season) === 1,
  roleRepresentsCircle: Number(r.represents_circle) === 1,
  roleActive: Number(r.role_active) === 1,
  roleIsExample: Number(r.role_is_example) === 1,
});

/**
 * One member's seatings, live and ended, each carrying the flags its seat sets.
 *
 * Oldest first, which is the order the ladder wants: the earliest live seating
 * is the one that dates "seated since", and the latest ended one is the one
 * that explains a fall.
 *
 * Scoped to the member in the statement, never by a check the caller is
 * trusted to have made first, so an id from somewhere else matches no row.
 */
export async function seatingsForMember(pool: Pool, userId: string): Promise<SeatingFacts[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM org_role_assignments a ` +
      "LEFT JOIN org_roles r ON r.id = a.org_role_id " +
      "WHERE a.user_id = ? AND a.holder_kind = 'member' " +
      "ORDER BY a.started_at, a.id",
    [userId],
  );
  return rows.map(toRow);
}
