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
