/**
 * The `roles` statements the steward's seat needs, and the cache warning that
 * has to travel with every one of them.
 *
 * ── THE CACHE IS THE REASON THIS FILE EXISTS ────────────────────────────────
 *
 * The burn-down rule states two reasons for moving a query into a repo: the
 * caches above it stay correct, and a table's readers stay enumerable. For
 * `roles` the first one is not theoretical.
 *
 * `rolesRepo` in `server/index.ts` is a `dbCollection<RoleDef>` built at boot
 * and served from memory, and THE CAPABILITY GATE READS THAT CACHE. Every
 * write below goes to SQL underneath it. A caller that inserts the steward
 * role, or adds `steward.veto` to a role, and does not then call
 * `rolesRepo.load()` will serve the old capability list until the process
 * restarts — which means a seat the village just created that nothing lets
 * through the gate. That is not a stale display; it is a power that does not
 * exist yet while every record says it does.
 *
 * So the obligation is written here, on the file that holds the writes, as
 * well as on `seatCatalystsAsStewards` in `server/lib/stewardship.ts` which is
 * the only caller today. A repo function is where the next caller looks.
 *
 * ── THIS FILE IS NOT THE WHOLE OF THE ROLES TABLE, AND SAYS SO ──────────────
 *
 * `roles` has other readers with other questions, and none of them moved here:
 * `server/lib/capabilityHolding.ts` reads one role's capabilities for the
 * break-glass door, `server/lib/nonHumanSeats.ts` reads the roles that
 * represent a being, `server/lib/villageReaders.ts` reads the chart for the
 * village document, and `rolesRepo` above serves the whole table. A reader who
 * found this file and believed it exhaustive would be worse off than one who
 * grepped, so they are named — the same posture `server/repos/seatHoldings.ts`
 * takes toward the table it does not own.
 *
 * ── WHY `capabilities` COMES BACK RAW ───────────────────────────────────────
 *
 * `capabilities` is a `json` column and mysql2 hands it over as a parsed value
 * on one driver version and as a string on another. This module does NOT pick
 * one. `roleCapabilityList` in `server/lib/stewardship.ts` is the single
 * tolerant reader of that value, and it has one property that matters more
 * than tidiness: a role whose capabilities fail to parse reads as EMPTY rather
 * than throwing, because a boot that dies on one malformed row takes the whole
 * village down over a permission list. Parsing here would put a second opinion
 * beside it and would be the one that throws.
 *
 * `name` comes back null-preserved for a narrower reason: the caller writes
 * `String(name ?? id)`, so a role with no name falls back to its own id.
 * Coercing null to the string "null" here would print that word on the vacancy
 * surface where a seat's name belongs.
 *
 * ── THE SLUG IS FROZEN AND THE NAME IS NOT ──────────────────────────────────
 *
 * `insertStewardRoleIfAbsent` takes both, and `setRoleCapabilities` touches
 * neither. That asymmetry is the rule from `STEWARD_ROLE_ID`: a slug is
 * history's identity, pointed at by `role_holders` rows, audit lines and every
 * ballot that seated somebody, and the name a member reads is a column a
 * village may change. Nothing here ever overwrites a name.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * The three columns every read here takes.
 *
 * Narrow on purpose. The table carries `description`, `min_stage`, `circle_id`,
 * `seats`, `sort_order` and `is_example` as well, and none of them is any of
 * this lane's business: the question asked of this table is only ever "which
 * roles carry the veto, and what are they called". A column that is never
 * selected cannot be leaked, or depended on, by a later edit to the shaping
 * above.
 */
const COLUMNS = "id, name, capabilities";

/**
 * One role, with its capability list exactly as the driver produced it.
 *
 * `capabilities` is `unknown` on purpose and it is not laziness; the header
 * says why. `name` is null-preserved for the caller's `?? id` fallback.
 */
export interface RoleCapabilityRow {
  id: string;
  name: string | null;
  /** Parsed JSON on one driver, a string on another. The caller tolerates both. */
  capabilities: unknown;
}

const toRow = (r: RowDataPacket): RoleCapabilityRow => ({
  id: String(r.id),
  name: r.name === null || r.name === undefined ? null : String(r.name),
  capabilities: r.capabilities,
});

/**
 * Every role and its capabilities, unfiltered and unordered.
 *
 * NOT filtered in SQL, and the reason is in the caller's own header: the two
 * engines this platform runs on spell JSON containment differently, and the
 * roles table is a handful of rows. So the whole table comes back and
 * `rolesCarryingVeto` decides in JS which of them carry `steward.veto`.
 *
 * That matters more than it looks. The seat is not always the role slugged
 * `steward`: a village may grant the veto to a role it named itself, and every
 * guard in the stewardship lane has to see that role or it leaves the real
 * seat unprotected. A predicate here that named the slug would be the defect.
 *
 * Example rows are included, because the capability gate does not exclude them
 * either: a role that carries the veto carries it whatever the flag says, and
 * a guard that could not see one would be a guard with a hole in it.
 */
export async function allRoleCapabilities(pool: Pool): Promise<RoleCapabilityRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM roles`);
  return rows.map(toRow);
}

/**
 * One role by its slug, or null when the village does not have it yet.
 *
 * Addressed by the primary key, so at most one row can match. Null is the
 * answer that makes the seating path create the role, and it has to stay
 * distinguishable from a role that exists with an empty capability list: the
 * first means "make it", the second means "grant into it and leave its name
 * alone".
 */
export async function roleCapabilityRow(pool: Pool, roleId: string): Promise<RoleCapabilityRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM roles WHERE id = ?`,
    [roleId],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * Create a role, and lose quietly to whoever created it first.
 *
 * `ON DUPLICATE KEY UPDATE id = id` rather than a real upsert, because a
 * losing race must not overwrite the winner's row — and in particular must not
 * overwrite a NAME the village chose for itself. The caller has already read
 * and found nothing; this is the second, cheaper guard for the case where two
 * closes of one launch ballot run at the same time.
 *
 * `capabilitiesJson` arrives already serialized. Serializing here would put
 * the encoding in one file and the tolerant decoding of it
 * (`roleCapabilityList`) in another, and those two have to be read together.
 *
 * THE CALLER MUST RELOAD `rolesRepo`. See the header.
 */
export async function insertRoleIfAbsent(
  pool: Pool,
  input: { id: string; name: string; description: string; capabilitiesJson: string; sortOrder: number },
): Promise<void> {
  await pool.query(
    "INSERT INTO roles (id, name, description, capabilities, sort_order) VALUES (?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE id = id",
    [input.id, input.name, input.description, input.capabilitiesJson, input.sortOrder],
  );
}

/**
 * Replace one role's capability list wholesale.
 *
 * A REPLACEMENT AND NOT A UNION, which is why the caller reads the existing
 * list first and hands over the union it computed. Doing the union in SQL
 * would need JSON functions the two engines spell differently — the same
 * reason `allRoleCapabilities` filters in JS — and doing it here from a single
 * capability would make this function silently additive, so a caller that
 * meant to REMOVE a power could not use it.
 *
 * Touches `capabilities` and nothing else: not the name, not the sort order.
 *
 * THE CALLER MUST RELOAD `rolesRepo`. The capability gate reads that cache,
 * so until it reloads this grant has been recorded and does not work.
 */
export async function setRoleCapabilities(pool: Pool, roleId: string, capabilitiesJson: string): Promise<void> {
  await pool.query("UPDATE roles SET capabilities = ? WHERE id = ?", [capabilitiesJson, roleId]);
}
