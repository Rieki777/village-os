/**
 * The amendment history's two reads (server/routes/mechanicsHistory.ts).
 * `mechanics_changes` has one writer, `recordMechanicsChangeRow` in
 * server/lib/changeset.ts, and these are its public readers.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** Every change, or one setting's, newest first. */
export async function amendmentRows(pool: Pool, key: string | null, limit: number): Promise<any[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, config_key, old_value, new_value, actor_user_id, source, proposal_ref, note, at " +
      `FROM mechanics_changes ${key ? "WHERE config_key = ? " : ""}ORDER BY at DESC, id DESC LIMIT ?`,
    key ? [key, limit] : [limit],
  );
  return rows;
}

/** The titles of the proposals that made governed changes. Proposals are public. */
export async function proposalTitles(pool: Pool, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, title FROM mechanics_proposals WHERE id IN (${ids.map(() => "?").join(",")})`,
    [...ids],
  );
  for (const r of rows) out.set(String(r.id), String(r.title ?? ""));
  return out;
}
