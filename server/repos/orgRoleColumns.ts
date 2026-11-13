/** Which of some `org_roles` columns this database has: the one question the role editor asks of the schema. */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export async function presentOrgRoleColumns(db: Pool | PoolConnection, columns: readonly string[]): Promise<Set<string>> {
  if (!columns.length) return new Set();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_roles' AND COLUMN_NAME IN (?)",
    [columns],
  );
  return new Set(rows.map((r) => String(r.c)));
}

/** Who a role's card says may hold it (`org_roles.held_by`, 0374): null when the card has not said, or the role is gone. */
export async function roleHeldBy(db: Pool | PoolConnection, orgRoleId: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT held_by FROM org_roles WHERE id = ? LIMIT 1", [orgRoleId]);
  return rows?.[0]?.held_by ?? null;
}
