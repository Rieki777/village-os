/**
 * WHAT A QUEST CREW STILL HELD FOR A MEMBER WHO HAS LEFT, for the erasure
 * sweep (server/lib/erasure.ts: "quest-crews-after-tombstone").
 *
 * WHY. A crew's roster is `quest_crew_members`, and nothing in the sweep
 * reached it, so the tombstone kept its place in every crew. A full crew
 * answered the next person's invite with "That crew is full", and
 * `GET /api/quests/:id/crews`, open to anyone signed in, listed the tombstone
 * as "A", the first name of "A departed member". A crew the leaver held alone
 * stayed open with nobody in it.
 *
 * WHAT HAPPENS. They leave every crew, the way `crewsRepo.leave` lets one
 * member leave one crew: their rows go, and a crew they leave with nobody in
 * it disbands. Only the crews they were in are looked at, gathered before the
 * delete, so a neighbour's crew that is empty for some other reason is not
 * this sweep's to close. The emptiness test sits inside the UPDATE, so a
 * member joining between the two statements keeps the crew open.
 *
 * THE FOUNDER. `crewsRepo` has no notion of handing a crew to somebody else:
 * a founder who walks out simply leaves, and the roster shows who is still
 * there. So `quest_crews.creator_id` stays as the historical id it is.
 * Nothing renders it.
 *
 * Reads only by the member's id, never by a name or an address, so it runs
 * after the tombstone and a resume may run it any number of times.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function leaveEveryCrewOf(pool: Pool, userId: string): Promise<{ left: number; disbanded: number }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `crew_id` FROM `quest_crew_members` WHERE `user_id` = ?",
    [userId],
  );
  const crewIds = rows.map((r) => String(r.crew_id));
  const [gone] = await pool.query<ResultSetHeader>("DELETE FROM `quest_crew_members` WHERE `user_id` = ?", [userId]);
  if (crewIds.length === 0) return { left: gone.affectedRows, disbanded: 0 };
  const [closed] = await pool.query<ResultSetHeader>(
    `UPDATE \`quest_crews\` SET \`status\` = 'disbanded' WHERE \`id\` IN (${crewIds.map(() => "?").join(",")}) ` +
      "AND `status` <> 'disbanded' " +
      "AND NOT EXISTS (SELECT 1 FROM `quest_crew_members` m WHERE m.`crew_id` = `quest_crews`.`id`)",
    crewIds,
  );
  return { left: gone.affectedRows, disbanded: closed.affectedRows };
}
