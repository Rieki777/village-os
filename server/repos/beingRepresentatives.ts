/**
 * `role_holders`, asked one question: who holds these roles?
 *
 * ── WHY A SEPARATE FILE FROM `beingRoles.ts` ───────────────────────────────
 *
 * Different table. `roles` says which seats speak for a being;
 * `role_holders` says who is sitting in them. Folding both into one module
 * would give `role_holders` a home under a name nobody grepping for that table
 * would open, and the enumerability this whole exercise buys is exactly the
 * ability to open one file per table and read every statement in it.
 *
 * ── THIS FILE IS NOT THAT TABLE'S HOME YET, AND SAYS SO ────────────────────
 *
 * `role_holders` is read and written in `server/index.ts` (the whole permission
 * plane, behind a cache and a serialising lock) and in
 * `server/lib/stewardship.ts` (seating, unseating, term ends, the vacancy
 * surface). Those are the bulk of the traffic and they did not move here: this
 * change is a burn-down of four lib files and rewriting the seating machinery
 * inside it would be a second change wearing the same commit message.
 *
 * Writing that down matters more than it looks. A reader who finds a file
 * named for a table and assumes it exhaustive is worse off than one who greps,
 * which is the rule `server/repos/subjectRefs.ts` states for its own missing
 * reader. So: one statement lives here, the others are named above, and the
 * next statement to move has a place to go.
 *
 * ── THE CACHE ABOVE THIS TABLE IS DELIBERATELY BYPASSED ────────────────────
 *
 * `server/index.ts` keeps the roles plane in memory for permission checks and
 * serialises every snapshot→mutate→replaceAll cycle against it. This read does
 * not use it, and that is the same choice `beingRoles.ts` makes for the same
 * reason: the caller is settling a ballot's quorum, which is arithmetic about
 * the roll as the database holds it at that instant. A quorum computed from a
 * cache one write behind is a decision made against a village that no longer
 * exists.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * The distinct members holding any of these roles.
 *
 * DISTINCT because one member may hold several of the roles handed in — a
 * village that names the river and the forest may well ask one person to speak
 * for both — and the caller wants a set of members, not a set of seatings.
 * `role_holders` carries UNIQUE (role_id, user_id) since 0002, so the
 * duplicates DISTINCT removes are across roles and never within one.
 *
 * An empty `roleIds` returns an empty list WITHOUT a round trip. That is not
 * an optimisation: `IN ()` is a syntax error in MySQL, so the placeholder list
 * this statement builds has to have at least one entry, and the caller's own
 * guard is not something this function may assume was written.
 *
 * The placeholders are built from the array's LENGTH and every id travels as a
 * parameter, which is the only shape in which a caller-supplied list may enter
 * a statement.
 *
 * The parameter is `readonly` so a caller can hand over a list it means to keep
 * and know this function did not sort or splice it; the copy on the way into
 * the driver is what the driver's own signature requires, not a defence.
 */
export async function holdersOfRoles(pool: Pool, roleIds: readonly string[]): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT user_id FROM role_holders WHERE role_id IN (${roleIds.map(() => "?").join(",")})`,
    [...roleIds],
  );
  return rows.map((r) => String(r.user_id));
}
