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

/** Tensions raised to these roles and not yet answered, counted in SQL; null when the table cannot be read here. */
export async function openTensionCounts(pool: Pool, roleIds: readonly string[]): Promise<Map<string, number> | null> {
  if (!roleIds.length) return new Map();
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT owner_seat_id, COUNT(*) AS n FROM live_session_entries " +
        `WHERE kind = 'tension' AND status <> 'done' AND owner_seat_id IN (${marks(roleIds.length)}) GROUP BY owner_seat_id`,
      [...roleIds],
    );
    return new Map(rows.map((r) => [String(r.owner_seat_id), Number(r.n)]));
  } catch (e: any) {
    if (e?.code === "ER_NO_SUCH_TABLE" || e?.code === "ER_BAD_FIELD_ERROR") return null;
    throw e;
  }
}
