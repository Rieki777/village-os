/**
 * The map's lights (Phase D, D2): the two reads server/lib/mapLight.ts makes
 * against the live session tables. Who joined a circle's session inside a
 * window, and which circles opened a session inside it. Mapping, the opt-in
 * and the floor and cap all stay in the lib; this hands back driver rows.
 *
 * Both take the window as two instants. The lib turns the village's own day
 * into them, so nothing here knows a time zone.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "./liveSessions";

const rowsOf = async (q: Queryable, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> => {
  const [rows] = await q.query<RowDataPacket[]>(sql, params);
  return rows;
};

/**
 * Each person who joined a circle's session in [from, to): `circle_id` and
 * `user_id`, one row per circle and person however many sessions they joined.
 * Sessions with no circle draw at no hearth and are left out here.
 */
export async function joinedInWindow(q: Queryable, from: Date, to: Date): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT DISTINCT `s`.`circle_id` AS `circle_id`, `m`.`user_id` AS `user_id` " +
      "FROM `live_session_people` `p` " +
      "JOIN `live_sessions` `s` ON `s`.`id` = `p`.`session_id` " +
      "JOIN `live_session_members` `m` ON `m`.`no` = `p`.`member_no` " +
      "WHERE `s`.`circle_id` IS NOT NULL AND `p`.`joined_at` >= ? AND `p`.`joined_at` < ?",
    [from, to],
  );
}

/** The circles with a session opened in [from, to), once each. */
export async function circlesMetInWindow(q: Queryable, from: Date, to: Date): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT DISTINCT `circle_id` FROM `live_sessions` WHERE `circle_id` IS NOT NULL AND `created_at` >= ? AND `created_at` < ?",
    [from, to],
  );
}
