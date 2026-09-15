/**
 * Reads of the `circles` table for a library that holds only a pool.
 *
 * `circlesRepo` in server/index.ts is the cached collection every route reads.
 * The org-chart backfill runs at boot with a bare pool and writes `circles`
 * directly, so it cannot ask that cache what a circle's status was before it
 * wrote. It asks here, and the query sits under server/repos where the raw-SQL
 * burn-down expects it.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

/**
 * `id`, `name` and `status` for each named circle that exists. A circle that
 * does not exist returns no row, which is how a caller tells a fresh insert
 * from a real change of status. An empty list asks nothing.
 */
export async function circleStatusRows(
  conn: Pool | PoolConnection,
  ids: readonly string[],
): Promise<RowDataPacket[]> {
  if (ids.length === 0) return [];
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id, name, status FROM circles WHERE id IN (${ids.map(() => "?").join(",")})`,
    [...ids],
  );
  return rows;
}
