/**
 * The quest feed's two reads and its one bookmark. Quest proposals themselves
 * are written only through `proposeQuest` (server/lib/questProposals.ts).
 */
import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "./memberTasks";

/** Sera ids already held in any status: proposed, accepted, rejected or superseded. A rerun never brings one back. */
export async function seenSeraQuestIds(db: Queryable, moduleId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT \`source_proposal_id\` AS id FROM \`quest_proposals\` WHERE \`module_id\` = ? AND \`source_proposal_id\` IN (${ids.map(() => "?").join(",")})`,
    [moduleId, ...ids],
  );
  return new Set(rows.map((r) => String(r.id)));
}

export async function questFeedSetting(db: Queryable, key: "quest_feed_since" | "quest_feed_last"): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `value` FROM `member_task_bridge` WHERE `setting` = ?", [key]);
  return rows.length ? String(rows[0].value) : null;
}

export async function setQuestFeedSetting(db: Queryable, key: "quest_feed_since" | "quest_feed_last", value: string): Promise<void> {
  await db.query(
    "INSERT INTO `member_task_bridge` (`setting`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
    [key, value.slice(0, 200)],
  );
}

export async function waitingSeraQuests(db: Queryable, moduleId: string): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM `quest_proposals` WHERE `module_id` = ? AND `status` = 'proposed'", [moduleId]);
  return Number(rows[0]?.n ?? 0);
}
