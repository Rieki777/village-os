/**
 * `valuation_models` and `valuation_settings` (0336): every statement against
 * the two tables. One function per statement; every decision stays in
 * server/lib/valuationStore.ts, so this file imports nothing from server/lib.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

type Db = Pool | PoolConnection;

export interface ModelInsert {
  id: string;
  version: number;
  bodyJson: string;
  baseVersion: number | null;
  door: string;
  proposalRef: string | null;
  actorId: string | null;
  note: string | null;
}

export async function insertModelRow(db: Db, r: ModelInsert): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>(
    "INSERT INTO `valuation_models` (`id`, `version`, `body_json`, `base_version`, `door`, `proposal_ref`, `actor_id`, `note`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [r.id, r.version, r.bodyJson, r.baseVersion, r.door, r.proposalRef, r.actorId, r.note],
  );
  return res;
}

/** The newest saved version, or none. */
export async function latestModelRow(db: Db): Promise<RowDataPacket | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `valuation_models` ORDER BY `version` DESC LIMIT 1");
  return rows[0] ?? null;
}

export interface SettingInsert {
  id: string;
  workKind: "quest" | "role" | "proposal";
  workRef: string;
  category: string;
  state: "awaiting_second" | "awaiting_vote" | "set";
  modelVersion: number;
  currency: string;
  suggestedMinor: number;
  rangeLowMinor: number;
  rangeHighMinor: number;
  bandLowMinor: number;
  bandHighMinor: number;
  setMinor: number;
  gapMinor: number;
  inside: boolean;
  needs: "none" | "second" | "vote";
  reason: string | null;
  note: string | null;
  ownNumberFirst: number | null;
  inputsJson: string;
  suggestionJson: string;
  inputChangesJson: string | null;
  payeeIdsJson: string;
  setterId: string;
  conflicted: boolean;
  eeHeld: boolean;
}

export async function insertSettingRow(db: Db, r: SettingInsert): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>(
    "INSERT INTO `valuation_settings` (`id`, `work_kind`, `work_ref`, `category`, `state`, `model_version`, `currency`, `suggested_minor`, `range_low_minor`, `range_high_minor`, " +
      "`band_low_minor`, `band_high_minor`, `set_minor`, `gap_minor`, `inside`, `needs`, `reason`, `note`, `own_number_first`, `inputs_json`, `suggestion_json`, " +
      "`input_changes_json`, `payee_ids_json`, `setter_id`, `conflicted`, `ee_held`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      r.id, r.workKind, r.workRef, r.category, r.state, r.modelVersion, r.currency, r.suggestedMinor, r.rangeLowMinor, r.rangeHighMinor,
      r.bandLowMinor, r.bandHighMinor, r.setMinor, r.gapMinor, r.inside ? 1 : 0, r.needs, r.reason, r.note, r.ownNumberFirst, r.inputsJson, r.suggestionJson,
      r.inputChangesJson, r.payeeIdsJson, r.setterId, r.conflicted ? 1 : 0, r.eeHeld ? 1 : 0,
    ],
  );
  return res;
}

export async function settingRowById(db: Db, id: string): Promise<RowDataPacket | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `valuation_settings` WHERE `id` = ?", [id]);
  return rows[0] ?? null;
}

/** Every record for one piece of work, newest first. */
export async function settingRowsForWork(db: Db, workKind: string, workRef: string): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM `valuation_settings` WHERE `work_kind` = ? AND `work_ref` = ? ORDER BY `created_at` DESC, `id` DESC",
    [workKind, workRef],
  );
  return rows;
}

/** Records that set a figure, in one category, for calibration. */
export async function setRowsInCategory(db: Db, category: string, limit: number): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM `valuation_settings` WHERE `category` = ? AND `state` = 'set' ORDER BY `created_at` DESC LIMIT ?",
    [category, limit],
  );
  return rows;
}

/** What one setter has set since a moment: whose pay they touched (the anti-swap rule). */
export async function setterRowsSince(db: Db, setterId: string, since: Date): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `payee_ids_json` FROM `valuation_settings` WHERE `setter_id` = ? AND `created_at` >= ?",
    [setterId, since],
  );
  return rows;
}

/** The second signer signs: only a row still waiting for one moves (compare-and-set). */
export async function signSettingRow(db: Db, id: string, signerId: string): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `valuation_settings` SET `state` = 'set', `signer_id` = ?, `signed_at` = CURRENT_TIMESTAMP WHERE `id` = ? AND `state` = 'awaiting_second'",
    [signerId, id],
  );
  return res;
}
