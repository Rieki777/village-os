/**
 * The two marks an export authorised by the village leaves (server/lib/
 * exportVotes.ts), as `app_config` rows keyed by the ballot that carried it:
 *
 *   village-export-grant:<ballotId>       written when the carried vote lands,
 *                                         naming the one steward it is for;
 *   village-export-delivered:<ballotId>   written when that steward's download
 *                                         starts, which is what makes it ONCE.
 *
 * Both are INSERT IGNORE on the primary key, so the first writer wins and a
 * second gets `false` back, with no read-then-write race between them.
 */
import type { Pool } from "mysql2/promise";

const grantKey = (ballotId: string) => `village-export-grant:${ballotId}`;
const deliveredKey = (ballotId: string) => `village-export-delivered:${ballotId}`;

export interface ExportGrant {
  ballotId: string;
  stewardUserId: string;
  grantedAt: string;
}

/** Record the grant. True when this call wrote it, false when it was already there. */
export async function recordExportGrant(pool: Pool, grant: ExportGrant): Promise<boolean> {
  const [r] = await pool.query<any>("INSERT IGNORE INTO app_config (config_key, value) VALUES (?, ?)", [grantKey(grant.ballotId), JSON.stringify(grant)]);
  return Number(r?.affectedRows ?? 0) === 1;
}

export async function readExportGrant(pool: Pool, ballotId: string): Promise<ExportGrant | null> {
  const [rows] = await pool.query<any[]>("SELECT value FROM app_config WHERE config_key = ?", [grantKey(ballotId)]);
  if (!rows.length) return null;
  const v = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
  return v?.stewardUserId ? (v as ExportGrant) : null;
}

export interface ExportDelivery {
  at: string;
  byUserId: string;
}

/** Claim the one delivery. True for the caller who wins it; false when it is already claimed. */
export async function claimExportDelivery(pool: Pool, ballotId: string, delivery: ExportDelivery): Promise<boolean> {
  const [r] = await pool.query<any>("INSERT IGNORE INTO app_config (config_key, value) VALUES (?, ?)", [deliveredKey(ballotId), JSON.stringify(delivery)]);
  return Number(r?.affectedRows ?? 0) === 1;
}

export async function readExportDelivery(pool: Pool, ballotId: string): Promise<ExportDelivery | null> {
  const [rows] = await pool.query<any[]>("SELECT value FROM app_config WHERE config_key = ?", [deliveredKey(ballotId)]);
  if (!rows.length) return null;
  return typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
}

/** Give the claim back: only for a download that failed before a single byte left. */
export async function releaseExportDelivery(pool: Pool, ballotId: string): Promise<void> {
  await pool.query("DELETE FROM app_config WHERE config_key = ?", [deliveredKey(ballotId)]);
}
