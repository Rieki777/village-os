/**
 * WHAT A CLASS OPENS, read from the chart and the quest board: the roles
 * tagged for a class, the open roles tagged for nobody, and the open-now
 * count on each class card. Moved here from server/lib/characters.ts (build
 * days S2) so its queries live in a repo; that file re-exports both reads.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface OpenPathRole {
  id: string;
  name: string;
  seats: number;
  recruiting: boolean;
  circleKey: string | null;
  color: string | null;
}

export interface OpenPaths {
  /**
   * Seats tagged for this class.
   *
   * The platform's role cards show "~8h/wk" and `org_roles` has no hours
   * column: that number lives in the platform repo's own role data, not in
   * this schema. Rather than invent one, the card shows what a village
   * actually records about a seat: what it is called, whether it is
   * recruiting, and which circle it belongs to.
   */
  roles: OpenPathRole[];
  /**
   * Seats tagged for NO class (NULL or `[]`) that are open now: recruiting, or
   * with fewer live seatings than places. Shown under the class as "also open
   * in the village", never as a fit, so a village that has tagged nothing
   * still shows every character its open roles (build days S2, D1).
   */
  alsoOpen: OpenPathRole[];
  questCount: number;
}

/**
 * The SQL test for "tagged for nobody": a NULL column, or an empty list. The
 * two have to read the same way, and JSON_CONTAINS alone reads both as
 * "no match", which is how untagged rows vanished from every class.
 */
const UNTAGGED = "(`archetypes` IS NULL OR JSON_LENGTH(`archetypes`) = 0)";
/**
 * Role journey PR-A: an unlisted role is in no list a visitor or member browses
 * (shared/roleListing.ts; NULL reads as listed). The character page a new
 * account lands on still offered them, and its class cards counted them (role
 * audit, 10 Nov 2026).
 */
const LISTED = "(r.`listed` IS NULL OR r.`listed` <> 0)";

/** Live seatings per role, members and documented holders alike, agents excluded. */
const LIVE_SEATINGS =
  "(SELECT COUNT(*) FROM `org_role_assignments` a WHERE a.`org_role_id` = r.`id` AND a.`ended_at` IS NULL AND a.`is_example` = 0 AND a.`is_agent` = 0)";

/** Open now: recruiting, or a place nobody holds. */
const OPEN_NOW = `(r.\`recruiting\` = 1 OR r.\`seats\` > ${LIVE_SEATINGS})`; // voice-ok: `seats` is the org_roles column in SQL, never copy

function toPathRole(r: RowDataPacket): OpenPathRole {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    seats: Number(r.seats ?? 1),
    recruiting: !!r.recruiting,
    circleKey: r.circle_id == null ? null : String(r.circle_id),
    color: r.color == null ? null : String(r.color),
  };
}

/**
 * What this class opens, which is a SUGGESTION and never a restriction.
 *
 * `roles` are the seats tagged for this class: the fit. `alsoOpen` are the
 * open seats tagged for nobody, offered beside the fit and never as one. A
 * row tagged for another class is in neither. (Until build days S2 this
 * comment promised that an untagged row belonged to everyone while the SQL,
 * a bare JSON_CONTAINS, dropped every untagged row: a village that tagged
 * nothing showed every class an empty board.)
 *
 * This feeds the class panel only. The Quest Log, search and every earning
 * surface stay unfiltered, because a class guides what you are shown and never
 * what you may claim.
 */
export async function openPathsFor(
  pool: Pool,
  villageId: string,
  archetypeKey: string,
): Promise<OpenPaths> {
  const tagged = "JSON_CONTAINS(`archetypes`, JSON_QUOTE(?))";
  const [roles] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `name`, `seats`, `recruiting`, `circle_id`, `color` FROM `org_roles` " +
      `WHERE \`active\` = 1 AND \`is_example\` = 0 AND ${LISTED.replace(/r\./g, "")} AND ${tagged} ` +
      "ORDER BY `recruiting` DESC, `sort_order`, `name` LIMIT 12",
    [archetypeKey],
  );
  const [also] = await pool.query<RowDataPacket[]>(
    "SELECT r.`id`, r.`name`, r.`seats`, r.`recruiting`, r.`circle_id`, r.`color` FROM `org_roles` r " +
      `WHERE r.\`active\` = 1 AND r.\`is_example\` = 0 AND ${LISTED} AND ${UNTAGGED.replace(/`archetypes`/g, "r.`archetypes`")} AND ${OPEN_NOW} ` +
      "ORDER BY r.`recruiting` DESC, r.`sort_order`, r.`name` LIMIT 12",
  );
  const [quests] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `quests` " +
      `WHERE \`status\` = 'open' AND \`is_example\` = 0 AND (${tagged} OR ${UNTAGGED})`,
    [archetypeKey],
  );
  return {
    roles: roles.map(toPathRole),
    alsoOpen: also.map(toPathRole),
    questCount: Number(quests[0]?.n ?? 0),
  };
}

/**
 * How many roles are open now for each class, for the class cards: the seats
 * tagged for that class that are recruiting or have a place nobody holds.
 * Untagged open seats are counted once, under `untagged`, because they are
 * open to every class alike and adding them to each card would say five
 * times over what is one fact.
 */
export async function openNowCounts(pool: Pool, keys: readonly string[]): Promise<{ byKey: Record<string, number>; untagged: number }> {
  const byKey: Record<string, number> = {};
  for (const key of keys) {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM `org_roles` r " +
        `WHERE r.\`active\` = 1 AND r.\`is_example\` = 0 AND ${LISTED} AND JSON_CONTAINS(r.\`archetypes\`, JSON_QUOTE(?)) AND ${OPEN_NOW}`,
      [key],
    );
    byKey[key] = Number(rows[0]?.n ?? 0);
  }
  const [u] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `org_roles` r " +
      `WHERE r.\`active\` = 1 AND r.\`is_example\` = 0 AND ${LISTED} AND ${UNTAGGED.replace(/`archetypes`/g, "r.`archetypes`")} AND ${OPEN_NOW}`,
  );
  return { byKey, untagged: Number(u[0]?.n ?? 0) };
}

