/**
 * Every live seating in the village, read with the person columns left behind.
 *
 * ── WHY THIS READ EXISTS SEPARATELY FROM THE OTHER TWO ──────────────────────
 *
 * `org_role_assignments` is read three ways and they are genuinely different
 * questions, which is why none of them can be folded into another:
 *
 *   `seatingsForMember` (server/repos/pathLadders.ts)  ONE MEMBER, live AND
 *     ended, joined to `org_roles` for the flags the ladder rungs need.
 *   `listOrgAssignments` / `orgRoleHistory` (server/lib/orgChart.ts)  the
 *     whole chart, or one seat's history, carrying names and notes because the
 *     admin panel is where a person's name belongs.
 *   this read  THE WHOLE VILLAGE, LIVE ONLY, WITH NO PERSON COLUMNS AT ALL.
 *
 * The caller is `server/routes/holders.ts`, which publishes occupancy to a
 * connected module: a seat, a term, and an opaque reference that resolves to an
 * account only inside this instance. Its own header states the design problem,
 * that it must carry occupancy without carrying identity.
 *
 * ── THE COLUMN LIST IS THE PRIVACY GUARANTEE, NOT A COMMENT ABOUT ONE ───────
 *
 * `display_name`, `holder_key`, `focus` and `note` are deliberately absent.
 * The last two are free text a human typed, and free text a human typed is
 * where a name ends up; the first two ARE a name or a slug made from one. A
 * column that is never selected cannot be leaked by a later edit to the shaping
 * above, so the guarantee is enforced here in the statement rather than trusted
 * to whoever next touches the route. Widening `COLUMNS` is therefore a change
 * to what the village promises an outside module, and not a tidy-up.
 *
 * ── WHY LIVE ONLY, AND WHY EXAMPLES ARE EXCLUDED ────────────────────────────
 *
 * Live only, because the question is who holds a seat now. An ended seating is
 * history, and `seatingsForMember` is where history is read; carrying ended rows
 * here would report a seat as occupied by everybody who ever held it.
 *
 * `is_example = 0` for the reason 0049 gave the column: an example seating is a
 * village's standing demonstration, a real-looking row nobody was ever put in.
 * Publishing one as live occupancy tells a module that a seat changed hands
 * when no person moved, which is exactly the event this surface exists to make
 * noticeable.
 *
 * ── TIMESTAMPS COME BACK AS THE DRIVER MADE THEM ────────────────────────────
 *
 * mysql2 runs with `timezone: "Z"` and no `dateStrings`, so a `timestamp` column
 * arrives as a Date already read as UTC. This module hands that value on
 * untouched. Formatting it here would put a second interpreter beside the
 * route's own, and the failure that produces is not an error: it is a date that
 * moves by a working day because a string got parsed in the app machine's zone.
 * One reader of these values, and it is the caller.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ───────────────────────────────
 *
 * It does not decide what KIND of holder a row is, and it does not resolve a
 * subject reference. The first is the route's vocabulary rather than the
 * table's: the column pair is `holder_kind` plus `is_agent`, and "agent" is a
 * word the published document uses. The second reads `subject_refs`, a
 * different table with its own issuing rules, and a repo function that touched
 * both would stop being the enumerable reader of either.
 *
 * ── INDEX AND SCOPE ─────────────────────────────────────────────────────────
 *
 * `org_role_assignments_role_idx (org_role_id, ended_at)` from 0049 covers both
 * the filter and the leading sort key. The table has no `village_id` column,
 * which is not an omission: 0049 predates the scope retrofit and the whole org
 * plane is single-village, the same note `server/repos/pathLadders.ts` carries.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * One live seating, as the table stores it. The published shape is
 * `SeatHolding` in `server/routes/holders.ts`, which is a different and
 * smaller thing on purpose.
 */
export interface SeatingRow {
  orgRoleId: string;
  /** `member` or `documented`, the enum from 0049, unmapped. */
  holderKind: string;
  /** Null for a documented holder, who has no account to point at. */
  userId: string | null;
  /** The 0142 column. A seat carried by software rather than by a person. */
  isAgent: boolean;
  startedAt: Date | string | null;
  termEndsAt: Date | string | null;
}

const COLUMNS =
  "`org_role_id`, `user_id`, `holder_kind`, `is_agent`, `started_at`, `term_ends_at`";

/** Kept as the driver returned it. The reason is in the header. */
const stamp = (v: unknown): Date | string | null =>
  v == null ? null : v instanceof Date ? v : String(v);

const toRow = (r: RowDataPacket): SeatingRow => ({
  orgRoleId: String(r.org_role_id),
  holderKind: String(r.holder_kind),
  // A documented holder's `user_id` is NULL, and a driver that ever hands back
  // something other than a string for it is not an id either.
  userId: typeof r.user_id === "string" ? r.user_id : null,
  isAgent: Number(r.is_agent) === 1,
  startedAt: stamp(r.started_at),
  termEndsAt: stamp(r.term_ends_at),
});

/**
 * Every seating that has not ended, grouped by seat and oldest first within it.
 *
 * The ordering is the document's ordering: a reader walking the answer sees one
 * seat's holders together, in the order they took the seat, so a list rendered
 * straight from it reads as the chart does. It is stated in the statement and
 * never left to the table's physical order, which is not a promise MySQL makes.
 */
export async function liveSeatings(pool: Pool): Promise<SeatingRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT " +
      COLUMNS +
      " FROM `org_role_assignments` " +
      "WHERE `ended_at` IS NULL AND `is_example` = 0 " +
      "ORDER BY `org_role_id` ASC, `started_at` ASC",
  );
  return rows.map(toRow);
}
