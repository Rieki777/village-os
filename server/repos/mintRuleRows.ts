/**
 * A NEW MINTING RULE, WRITTEN (vote-path gap 8).
 *
 * The two statements `createMintRule` (server/lib/mintRuleCreate.ts) needs:
 * the natural-key read that refuses a rule the village already has, and the
 * insert. Every other read of `mint_rules` stays where it was, in
 * server/lib/economy.ts; these two are new, and new raw SQL lives here.
 *
 * The insert names `effective_from_cycle` and never leaves it to the column
 * default of 0. Zero means "in force since the beginning", which is the one
 * value a rule created by a vote must never carry: a rule voted in during a
 * moon pays from the NEXT moon, the same deferral every edit gets.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** The rule a village already has for this trigger and token, or null. */
export async function mintRuleRowByNaturalKey(
  pool: Pool,
  villageId: string,
  trigger: string,
  tokenSlug: string,
): Promise<RowDataPacket | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `mint_rules` WHERE `village_id` = ? AND `trigger` = ? AND `token_slug` = ? LIMIT 1",
    [villageId, trigger, tokenSlug],
  );
  return rows[0] ?? null;
}

/** A rule by its id, in any village, because the id is the table's primary key. */
export async function mintRuleRowById(pool: Pool, id: string): Promise<RowDataPacket | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM `mint_rules` WHERE `id` = ? LIMIT 1", [id]);
  return rows[0] ?? null;
}

export interface NewMintRuleRow {
  id: string;
  villageId: string;
  trigger: string;
  tokenSlug: string;
  /** Null means "read it from the source". */
  amount: number | null;
  ceiling: number;
  recipient: string;
  effectiveFromCycle: number;
  note: string | null;
}

/**
 * Insert unless the id or the natural key is already taken. True when this call
 * wrote the row, so a race between two landings writes one rule and tells the
 * loser so.
 */
export async function insertMintRuleRow(pool: Pool, row: NewMintRuleRow): Promise<boolean> {
  const [res]: any = await pool.query(
    "INSERT IGNORE INTO `mint_rules` " +
      "(`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`, `note`, `effective_from_cycle`) " +
      "VALUES (?,?,?,?,?,?,?,1,?,?)",
    [row.id, row.villageId, row.trigger, row.tokenSlug, row.amount, row.ceiling, row.recipient, row.note, row.effectiveFromCycle],
  );
  return Number(res?.affectedRows ?? 0) > 0;
}
