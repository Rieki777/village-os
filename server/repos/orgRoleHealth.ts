/**
 * THE READS BEHIND `/api/org`'S HEALTH FIELD (server/lib/orgRoleHealth.ts).
 *
 * Each table once, with `IN (...)` over every id the page needs, so a page of
 * forty holders costs what a page of one costs. Nothing here decides who may
 * see what: the caller asks only for what the reader's tier allows.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

/** Handles by user id, for the link to a holder's card. */
export async function handlesOf(pool: Pool, userIds: readonly string[]): Promise<Map<string, string | null>> {
  if (!userIds.length) return new Map();
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT id, handle FROM users WHERE id IN (${marks(userIds.length)})`, [...userIds]);
  return new Map(rows.map((u) => [String(u.id), u.handle ? String(u.handle) : null]));
}

/** The stored terms (`settings_json`, raw) of these applications, by id. */
export async function applicationSettingsOf(pool: Pool, ids: readonly string[]): Promise<Map<string, unknown>> {
  if (!ids.length) return new Map();
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT id, settings_json FROM seat_applications WHERE id IN (${marks(ids.length)})`, [...ids]);
  return new Map(rows.map((a) => [String(a.id), a.settings_json]));
}

// Open tensions per role are counted by `openTensionCountsFor` (server/lib/roleTensions.ts),
// over `role_tensions`, the statement the player card reads.
