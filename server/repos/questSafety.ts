/**
 * The three tables 0343 added: what a quest asks of the body, a member's age
 * band, and the pay slot a claim fills. One repo, so every reader of these
 * facts goes through the same SQL and the erasure sweep has one place to call.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { isAgeBand, type AgeBand } from "../../shared/ageBands";

export interface QuestSafety {
  questId: string;
  physical: boolean;
  minAge: number | null;
  requiredBadges: string[];
  safetyNote: string | null;
  estimateHours: number | null;
}

function toList(v: unknown): string[] {
  try {
    const parsed = Array.isArray(v) ? v : JSON.parse(String(v ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter((s) => s.trim() !== "") : [];
  } catch {
    return [];
  }
}

export async function questSafetyOf(pool: Pool, questId: string): Promise<QuestSafety | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `quest_id`, `physical`, `min_age`, `required_badges`, `safety_note`, `estimate_hours` FROM `quest_safety` WHERE `quest_id` = ?",
    [questId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    questId: String(r.quest_id),
    physical: !!r.physical,
    minAge: r.min_age == null ? null : Number(r.min_age),
    requiredBadges: toList(r.required_badges),
    safetyNote: r.safety_note == null ? null : String(r.safety_note),
    estimateHours: r.estimate_hours == null ? null : Number(r.estimate_hours),
  };
}

export async function putQuestSafety(pool: Pool, s: QuestSafety, by: string | null): Promise<void> {
  await pool.query(
    "INSERT INTO `quest_safety` (`quest_id`, `physical`, `min_age`, `required_badges`, `safety_note`, `estimate_hours`, `updated_by`) " +
      "VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE `physical` = VALUES(`physical`), `min_age` = VALUES(`min_age`), " +
      "`required_badges` = VALUES(`required_badges`), `safety_note` = VALUES(`safety_note`), " +
      "`estimate_hours` = VALUES(`estimate_hours`), `updated_by` = VALUES(`updated_by`)",
    [
      s.questId,
      s.physical ? 1 : 0,
      s.minAge,
      s.requiredBadges.length ? JSON.stringify(s.requiredBadges) : null,
      s.safetyNote,
      s.estimateHours,
      by,
    ],
  );
}

/** The ids among `badgeIds` that may gate a quest: earned or granted badges that exist and are active. */
export async function gateableBadgeIds(pool: Pool, badgeIds: readonly string[]): Promise<string[]> {
  if (!badgeIds.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id` FROM `badges` WHERE `id` IN (?) AND `kind` IN ('earned','granted') AND `active` = 1",
    [badgeIds],
  );
  const ok = new Set(rows.map((r) => String(r.id)));
  return badgeIds.filter((b) => ok.has(b));
}

/**
 * The badges a member holds that may pass a safety gate: earned or granted,
 * active, unexpired. A self-declared badge gates nothing (badges.ts), and an
 * expired certificate is no certificate.
 */
export async function safetyBadgesHeld(pool: Pool, userId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT a.`badge_id` FROM `badge_awards` a JOIN `badges` b ON b.`id` = a.`badge_id` " +
      "WHERE a.`user_id` = ? AND b.`kind` IN ('earned','granted') AND b.`active` = 1 " +
      "AND (a.`expires_at` IS NULL OR a.`expires_at` > CURRENT_TIMESTAMP)",
    [userId],
  );
  return rows.map((r) => String(r.badge_id));
}

export async function ageBandOf(pool: Pool, userId: string): Promise<AgeBand | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT `band` FROM `member_age_bands` WHERE `user_id` = ?", [userId]);
  const band = rows[0]?.band;
  return isAgeBand(band) ? band : null;
}

/**
 * Set a member's band. The member sets it once (`changedBy` null); a later
 * change must name who confirmed it. Returns false when the member tries to
 * change a band already set.
 */
export async function setAgeBand(pool: Pool, userId: string, band: AgeBand, changedBy: string | null): Promise<boolean> {
  if (changedBy == null) {
    const [r] = await pool.query<any>("INSERT IGNORE INTO `member_age_bands` (`user_id`, `band`) VALUES (?,?)", [userId, band]);
    return Number(r?.affectedRows ?? 0) === 1;
  }
  await pool.query(
    "INSERT INTO `member_age_bands` (`user_id`, `band`, `changed_by`) VALUES (?,?,?) " +
      "ON DUPLICATE KEY UPDATE `band` = VALUES(`band`), `changed_by` = VALUES(`changed_by`), `set_at` = CURRENT_TIMESTAMP",
    [userId, band, changedBy],
  );
  return true;
}

/** Erasure: a member's band goes with them. */
export async function forgetAgeBand(pool: Pool, userId: string): Promise<void> {
  await pool.query("DELETE FROM `member_age_bands` WHERE `user_id` = ?", [userId]);
}

/** Display names for badge ids, in the order given; an unknown id names itself. */
export async function badgeNames(pool: Pool, badgeIds: readonly string[]): Promise<string[]> {
  if (!badgeIds.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>("SELECT `id`, `name` FROM `badges` WHERE `id` IN (?)", [badgeIds]);
  const byId = new Map(rows.map((r) => [String(r.id), String(r.name)]));
  return badgeIds.map((id) => byId.get(id) ?? id);
}

/** The claims still in flight on a quest, for re-checking them when its safety rules change. */
export async function openClaimsOn(pool: Pool, questId: string): Promise<Array<{ id: string; userId: string }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `user_id` FROM `quest_claims` WHERE `quest_id` = ? AND `status` IN ('claimed','submitted')",
    [questId],
  );
  return rows.map((r) => ({ id: String(r.id), userId: String(r.user_id) }));
}
