/**
 * `planting_requests` (migration 0306): every statement on the table, here and
 * nowhere else, so "who writes this row" is one file to read.
 *
 * EVERY CLOCK IS THE DATABASE'S. `applies_at` and `expires_at` are written as
 * `NOW() + INTERVAL ? HOUR` and compared with `NOW()`, and instants come out as
 * epoch seconds through UNIX_TIMESTAMP, for the reason
 * server/repos/commsOverview.ts gives: a test pool does not pin UTC.
 *
 * Every move out of `pending` is claimed with `WHERE status = 'pending'` and
 * wipes the sealed value in the same statement, so a value never outlives its
 * decision and two people pressing at once make one decision.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { Sealed } from "../lib/sealedBox";

export type PlantingMode = "cosign" | "cooling_off";
export type PlantingStatus = "pending" | "planted" | "declined" | "withdrawn" | "expired" | "superseded";

export interface PlantingRequestRow {
  id: string;
  slot: string;
  last4: string;
  requestedBy: string;
  requestedAt: number;
  mode: PlantingMode;
  appliesAt: number | null;
  expiresAt: number;
  status: PlantingStatus;
  decidedBy: string | null;
  decidedAt: number | null;
}

const COLUMNS =
  "id, slot, last4, requested_by, UNIX_TIMESTAMP(requested_at) AS requested_s, mode, UNIX_TIMESTAMP(applies_at) AS applies_s, " +
  "UNIX_TIMESTAMP(expires_at) AS expires_s, status, decided_by, UNIX_TIMESTAMP(decided_at) AS decided_s";

const epoch = (v: unknown): number | null => (v == null ? null : Number(v));

function toRow(r: RowDataPacket): PlantingRequestRow {
  return {
    id: String(r.id),
    slot: String(r.slot),
    last4: String(r.last4),
    requestedBy: String(r.requested_by),
    requestedAt: Number(r.requested_s),
    mode: r.mode === "cooling_off" ? "cooling_off" : "cosign",
    appliesAt: epoch(r.applies_s),
    expiresAt: Number(r.expires_s),
    status: String(r.status) as PlantingStatus,
    decidedBy: r.decided_by == null ? null : String(r.decided_by),
    decidedAt: epoch(r.decided_s),
  };
}

/** A new pending request. Any older pending request for the same slot is superseded first. */
export async function insertPlantingRequest(
  pool: Pool,
  r: { id: string; slot: string; sealed: Sealed; last4: string; requestedBy: string; mode: PlantingMode; coolingHours: number; expiryHours: number },
): Promise<void> {
  await pool.query(
    "UPDATE planting_requests SET status = 'superseded', decided_at = NOW(), ciphertext = NULL, iv = NULL, tag = NULL " +
      "WHERE slot = ? AND status = 'pending'",
    [r.slot],
  );
  await pool.query(
    "INSERT INTO planting_requests (id, slot, ciphertext, iv, tag, last4, requested_by, mode, applies_at, expires_at) " +
      "VALUES (?,?,?,?,?,?,?,?, IF(? = 'cooling_off', NOW() + INTERVAL ? HOUR, NULL), NOW() + INTERVAL ? HOUR)",
    [r.id, r.slot, r.sealed.ciphertext, r.sealed.iv, r.sealed.tag, r.last4, r.requestedBy, r.mode, r.mode, r.coolingHours, r.mode === "cooling_off" ? r.coolingHours : r.expiryHours],
  );
}

export async function plantingRequestById(pool: Pool, id: string): Promise<PlantingRequestRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM planting_requests WHERE id = ?`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

/** The sealed value of a pending request, for the one moment it is planted. */
export async function sealedValueOf(pool: Pool, id: string): Promise<Sealed | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT ciphertext, iv, tag FROM planting_requests WHERE id = ? AND status = 'pending'",
    [id],
  );
  const r = rows[0];
  return r?.ciphertext ? { ciphertext: String(r.ciphertext), iv: String(r.iv), tag: String(r.tag) } : null;
}

export async function pendingPlantingRequests(pool: Pool): Promise<PlantingRequestRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM planting_requests WHERE status = 'pending' ORDER BY requested_at, id LIMIT 50`,
  );
  return rows.map(toRow);
}

/**
 * Move one request out of `pending`, wiping its value. False when somebody
 * else already decided it. `planted` keeps the claim until the save is done,
 * so a failed save can be put back by `reopenPlantingRequest`.
 */
export async function decidePlantingRequest(pool: Pool, id: string, status: Exclude<PlantingStatus, "pending">, by: string): Promise<boolean> {
  const wipe = status === "planted" ? "" : ", ciphertext = NULL, iv = NULL, tag = NULL";
  const [r] = await pool.query<any>(
    `UPDATE planting_requests SET status = ?, decided_by = ?, decided_at = NOW()${wipe} WHERE id = ? AND status = 'pending'`,
    [status, by, id],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

/** The save after a `planted` claim failed: back to pending, so it can be signed again. */
export async function reopenPlantingRequest(pool: Pool, id: string): Promise<void> {
  await pool.query("UPDATE planting_requests SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ? AND status = 'planted'", [id]);
}

/** Wipe a planted request's value once the secrets store holds it. */
export async function wipePlantedValue(pool: Pool, id: string): Promise<void> {
  await pool.query("UPDATE planting_requests SET ciphertext = NULL, iv = NULL, tag = NULL WHERE id = ? AND status = 'planted'", [id]);
}

/** Requests whose time has come, by the database's clock: cooling-offs that land, co-signs that expire. */
export async function duePlantingRequests(pool: Pool): Promise<{ land: string[]; expire: string[] }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, mode FROM planting_requests WHERE status = 'pending' AND " +
      "((mode = 'cooling_off' AND applies_at <= NOW()) OR (mode = 'cosign' AND expires_at <= NOW())) LIMIT 50",
  );
  return {
    land: rows.filter((r) => r.mode === "cooling_off").map((r) => String(r.id)),
    expire: rows.filter((r) => r.mode !== "cooling_off").map((r) => String(r.id)),
  };
}

/** Test and fixture helper: move a request's clock so its time has come. */
export async function backdatePlantingRequest(pool: Pool, id: string, hours: number): Promise<void> {
  await pool.query(
    "UPDATE planting_requests SET applies_at = applies_at - INTERVAL ? HOUR, expires_at = expires_at - INTERVAL ? HOUR WHERE id = ?",
    [hours, hours, id],
  );
}
