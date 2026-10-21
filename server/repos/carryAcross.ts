/**
 * The two reads carrying a person across needs inside its own transaction.
 *
 * Both take the transaction's connection, never a pool, because each is a
 * step in one act: lock the old seating, seat the person in the new seat,
 * end the old seating, commit. A read on the pool would see a snapshot the
 * writes after it never touch.
 */
import type { PoolConnection } from "mysql2/promise";

export interface SeatingRow {
  id: string;
  orgRoleId: string;
  holderKind: "member" | "documented";
  userId: string | null;
  displayName: string | null;
  holderKey: string;
  focus: string | null;
  isAgent: boolean;
  isExample: boolean;
  ended: boolean;
}

/** One seating, locked until the transaction ends. Null when there is no such row. */
export async function lockSeating(conn: PoolConnection, id: string): Promise<SeatingRow | null> {
  const [rows] = await conn.query<any[]>(
    "SELECT id, org_role_id, holder_kind, user_id, display_name, holder_key, focus, is_agent, is_example, ended_at " +
      "FROM org_role_assignments WHERE id = ? FOR UPDATE",
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    orgRoleId: String(r.org_role_id),
    holderKind: r.holder_kind === "documented" ? "documented" : "member",
    userId: r.user_id ? String(r.user_id) : null,
    displayName: r.display_name ? String(r.display_name) : null,
    holderKey: String(r.holder_key),
    focus: r.focus ? String(r.focus) : null,
    isAgent: !!r.is_agent,
    isExample: !!r.is_example,
    ended: r.ended_at !== null && r.ended_at !== undefined,
  };
}

/** The live seating this holder has in this seat, or null. */
export async function liveSeatingIn(conn: PoolConnection, orgRoleId: string, holderKey: string): Promise<string | null> {
  const [rows] = await conn.query<any[]>(
    "SELECT id FROM org_role_assignments WHERE org_role_id = ? AND holder_key = ? AND ended_at IS NULL LIMIT 1",
    [orgRoleId, holderKey],
  );
  return rows[0] ? String(rows[0].id) : null;
}
