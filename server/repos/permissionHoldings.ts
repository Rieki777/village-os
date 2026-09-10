/**
 * `role_holders`: the PERMISSION plane's holdings, read and written for the
 * steward's seat.
 *
 * ── TWO PLANES SHARE A WORD, AND ONLY ONE OF THEM CARRIES POWER ─────────────
 *
 * This repository has two tables that both look like "who holds which seat",
 * and confusing them is the mistake this file is named to prevent:
 *
 *   `org_role_assignments`  the ORG chart. Terms, circles, focus, notes, and
 *                           no capabilities at all. Read by
 *                           `server/repos/seatHoldings.ts` and
 *                           `server/repos/pathLadders.ts`.
 *   `role_holders`          the PERMISSION plane, this file. Capabilities
 *                           come from the role, and a holding here is what
 *                           lets somebody through the gate.
 *
 * `server/lib/stewardship.ts` chose this plane for the steward deliberately: a
 * steward is a POWER, so the seat lives on the plane that carries powers. Both
 * planes have a term watch and they say different things, because a term
 * ending on the org chart takes nothing away and a term ending here really
 * does end the powers.
 *
 * ── THE CACHE IS THE REASON THIS FILE EXISTS ────────────────────────────────
 *
 * `roleHoldersRepo` in `server/index.ts` is a `dbCollection<RoleHolderRow>`
 * built at boot and served from memory, and the capability gate reads it.
 * `insertHoldingIfAbsent` below writes SQL underneath that cache. A caller
 * that seats somebody and does not then call `roleHoldersRepo.load()` will go
 * on serving the old answer until the process restarts: the village's record
 * says this person holds the seat and the gate says they do not. That
 * obligation is written on `seatCatalystsAsStewards`, which is the only caller
 * today, and it is written here as well because a repo function is where the
 * next caller looks.
 *
 * ── A HOLDING LAPSES ON ITS TERM DATE AND ON NOTHING ELSE ───────────────────
 *
 * No read below filters by the term. `holdingsForRoles` returns lapsed rows
 * and leaves the verdict to `holdingHasLapsed`, which is pure and derived on
 * every read. Two reasons, and neither is convenience:
 *
 *  1. The vacancy surface has to be able to say "Wren held this until the 3rd"
 *     rather than showing an empty list that reads as though nobody ever did.
 *  2. `stewardVetoStands` counts a veto by anybody who APPEARS on a
 *     steward-capable seat, lapsed or not, because a term running out ends the
 *     powers going forward and does not un-say something the person said while
 *     they held them. A WHERE clause here would silently discount those.
 *
 * `season_id` is recorded and is NOT a lapse condition. Stripping powers at a
 * season turn would silently disarm every permission role in every existing
 * village the moment 0171's column arrived.
 *
 * ── TIMESTAMPS COME BACK AS THE DRIVER MADE THEM ────────────────────────────
 *
 * mysql2 runs with `timezone: "Z"` and no `dateStrings`, so a `timestamp`
 * column arrives as a Date already read as UTC. This module hands those values
 * on untouched, the way `server/repos/seatHoldings.ts` does. Formatting them
 * here would put a second interpreter beside the caller's, and the failure
 * that produces is not an error: it is a term-end date that moves by a working
 * day because a string got parsed in the app machine's zone. It matters more
 * here than almost anywhere, because that date is the only backstop on a seat
 * that can veto a decision the village carried.
 *
 * ── THIS FILE IS NOT THE WHOLE OF THE TABLE, AND SAYS SO ────────────────────
 *
 * `server/lib/nonHumanSeats.ts` reads the holders of the roles that represent
 * a being, `server/lib/villageReaders.ts` counts distinct holders for the
 * village document, and `roleHoldersRepo` serves the whole table. None of them
 * moved here. Naming them is the point: a reader who believes an incomplete
 * list is exhaustive is worse off than one who greps.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * One holding, with its two timestamps exactly as the driver produced them.
 *
 * `grantedAt` and `termEndsAt` are deliberately not ISO strings and not Dates:
 * they are whatever came back. The caller turns the first into an ISO instant
 * for rendering and hands the second, untouched, to `holdingHasLapsed`, which
 * is the one place that decides what an unreadable term date means (it means
 * "does not lapse", so a broken value can never disarm a seat by accident).
 */
export interface PermissionHoldingRow {
  id: string;
  roleId: string;
  userId: string;
  grantedAt: Date | string | null;
  termEndsAt: Date | string | null;
  seasonId: string | null;
}

/** One holding whose term is due, with its role's display name attached. */
export interface EndingHoldingRow {
  id: string;
  roleId: string;
  userId: string;
  termEndsAt: Date | string | null;
  /** Null when the role row is gone. The caller falls back to the id. */
  roleName: string | null;
}

/** Kept as the driver returned it. The reason is in the header. */
const stamp = (v: unknown): Date | string | null => (v == null ? null : v instanceof Date ? v : String(v));

const nullableId = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const COLUMNS = "id, role_id, user_id, granted_at, term_ends_at, season_id";

/**
 * Every holding on any of these roles, oldest first.
 *
 * THE CALLER MUST NOT PASS AN EMPTY LIST. `IN ()` is a syntax error, so an
 * empty array throws rather than returning nothing. `stewardsSeated` guards
 * before it calls, by returning early when no role carries the veto, and that
 * guard is where it belongs: "no role carries the veto" is a fact about the
 * village that the caller has already computed and would otherwise ask twice.
 * Stated here as a precondition rather than defended against, so that a future
 * caller reads the requirement instead of discovering it.
 *
 * The ordering is the surface's ordering — the order people took the seat —
 * and it is stated in the statement rather than left to the table's physical
 * order, which is not a promise MySQL makes. `id` breaks a tie so two holdings
 * granted in the same second cannot swap places between reads.
 *
 * Every placeholder is generated from the list's own length and every value
 * travels as a parameter, so a role id is never concatenated into SQL.
 */
export async function holdingsForRoles(
  pool: Pool,
  roleIds: readonly string[],
): Promise<PermissionHoldingRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM role_holders ` +
      `WHERE role_id IN (${roleIds.map(() => "?").join(",")}) ORDER BY granted_at, id`,
    roleIds as string[],
  );
  return rows.map((r) => ({
    id: String(r.id),
    roleId: String(r.role_id),
    userId: String(r.user_id),
    grantedAt: stamp(r.granted_at),
    termEndsAt: stamp(r.term_ends_at),
    seasonId: nullableId(r.season_id),
  }));
}

/**
 * Who already holds one role, as bare member ids.
 *
 * The seating path's idempotence check, and ids are all it needs: it is asking
 * "have I already seated this person" and nothing about when or for how long.
 * Lapsed holdings are included, because the unique key `(role_id, user_id)`
 * from 0002 makes a second row impossible whether the first one has run out or
 * not — a lapsed holder who was left out of this answer would be "seated"
 * again by an INSERT that silently did nothing, and reported as freshly
 * seated.
 */
export async function userIdsHolding(pool: Pool, roleId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT user_id FROM role_holders WHERE role_id = ?",
    [roleId],
  );
  return rows.map((r) => String(r.user_id));
}

/**
 * Seat somebody, and do nothing at all if they already hold the role.
 *
 * `ON DUPLICATE KEY UPDATE role_id = role_id` against the `(role_id, user_id)`
 * unique key from 0002. A no-op rather than a real upsert, so a retried close
 * cannot move an existing holder's term or their grantor: the mandate a
 * village already agreed to is not silently extended by a second run of the
 * job that wrote it.
 *
 * `termEndsAt` MUST BE A Date AND NEVER AN ISO STRING. MySQL refuses
 * `2026-12-01T00:00:00.000Z` for a `timestamp` column outright, so passing a
 * string through made every seating throw — inside a launch closer that runs
 * with no transaction around it, which is the worst place for a throw. The
 * type here is what stops that recurring.
 *
 * `grantedBy` is a ballot id when the village put somebody here, which is what
 * makes the holding read back as "the village put them here" rather than as an
 * administrator's hand.
 *
 * THE CALLER MUST RELOAD `roleHoldersRepo`. See the header.
 */
export async function insertHoldingIfAbsent(
  pool: Pool,
  input: {
    id: string;
    roleId: string;
    userId: string;
    grantedBy: string;
    termEndsAt: Date | null;
    seasonId: string | null;
  },
): Promise<void> {
  await pool.query(
    "INSERT INTO role_holders (id, role_id, user_id, granted_by, term_ends_at, season_id) VALUES (?,?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE role_id = role_id",
    [input.id, input.roleId, input.userId, input.grantedBy, input.termEndsAt, input.seasonId],
  );
}

/**
 * Holdings whose term falls on or before `cutoff`, soonest first.
 *
 * ALREADY-ENDED HOLDINGS ARE IN THE ANSWER, and that is the point rather than
 * an accident of the comparison: the daily watch has to tell somebody their
 * term has ENDED, which is a different sentence from telling them it is about
 * to, and a query bounded below would only ever produce the second. The caller
 * computes the cutoff from its own window, so the policy "fourteen days" lives
 * with the job and not in the statement.
 *
 * Holdings with no term at all are excluded by `IS NOT NULL`: a null term
 * never lapses, which is what let 0171 add the column to every existing
 * village without taking a single power away, and a watch that swept those
 * would warn every permanent role holder in the village every day.
 *
 * ── THE JOIN, AND WHY IT IS A LEFT JOIN ─────────────────────────────────────
 *
 * `roles` appears only to fetch a display name, is never written, and is
 * joined here so the whole answer is one round trip. LEFT, so a holding whose
 * role row has been deleted still comes back — with `roleName` null, which the
 * caller renders as the role id. An INNER join would drop the row entirely and
 * the person would simply never be told their term had ended, which is the
 * failure mode a watch exists to prevent.
 */
export async function holdingsEndingBy(pool: Pool, cutoff: Date): Promise<EndingHoldingRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT h.id, h.role_id, h.user_id, h.term_ends_at, r.name AS role_name FROM role_holders h " +
      "LEFT JOIN roles r ON r.id = h.role_id " +
      "WHERE h.term_ends_at IS NOT NULL AND h.term_ends_at <= ? ORDER BY h.term_ends_at, h.id",
    [cutoff],
  );
  return rows.map((r) => ({
    id: String(r.id),
    roleId: String(r.role_id),
    userId: String(r.user_id),
    termEndsAt: stamp(r.term_ends_at),
    roleName: r.role_name === null || r.role_name === undefined ? null : String(r.role_name),
  }));
}
