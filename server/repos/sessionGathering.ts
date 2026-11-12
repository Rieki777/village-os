/**
 * "I'll be there" for a circle's next meeting (Phase C, the Gathering): the
 * two reads server/lib/sessionGathering.ts makes of the gatherings' own
 * tables, `events` (is the circle's mirrored gathering still on the calendar)
 * and `event_rsvps` (who answered `going` for one evening). Nothing here
 * writes: the answer itself goes through the gatherings' own door.
 *
 * Each function hands back what the driver handed back. Mapping and rights
 * stay in the lib, the split server/repos/liveSessions.ts makes.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "./liveSessions";

/** Which of these gatherings are on the calendar and taking answers. */
export async function liveGatheringRows(q: Queryable, ids: readonly string[]): Promise<RowDataPacket[]> {
  if (!ids.length) return [];
  const [rows] = await q.query<RowDataPacket[]>(
    `SELECT \`id\` FROM \`events\` WHERE \`id\` IN (${ids.map(() => "?").join(",")}) AND \`removed_at\` IS NULL AND \`status\` IN ('scheduled','postponed')`,
    [...ids],
  );
  return rows;
}

/** Every `going` answer for these (gathering, evening) pairs, with the person's name. */
export async function goingRows(q: Queryable, pairs: ReadonlyArray<{ eventId: string; occurrenceKey: string }>): Promise<RowDataPacket[]> {
  if (!pairs.length) return [];
  const [rows] = await q.query<RowDataPacket[]>(
    `SELECT r.\`event_id\`, r.\`occurrence_key\`, r.\`user_id\`, u.\`name\`
       FROM \`event_rsvps\` r
       LEFT JOIN \`users\` u ON u.\`id\` = r.\`user_id\`
      WHERE r.\`status\` = 'going' AND (${pairs.map(() => "(r.`event_id` = ? AND r.`occurrence_key` = ?)").join(" OR ")})`,
    pairs.flatMap((p) => [p.eventId, p.occurrenceKey]),
  );
  return rows;
}
