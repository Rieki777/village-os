/**
 * EVERY PERSON THE VILLAGE HAS ON ITS RECORD, for the secret-society lock
 * (server/lib/peopleLock.ts, readiness finding R097).
 *
 * Two reads: every account that is not an example, and every documented
 * holder (a real person the village wrote down on a role before they had an
 * account, `org_role_assignments.holder_kind = 'documented'`). The lock hides
 * what these return from a stranger, so a person missing here is a person the
 * lock cannot hide. That is why the documented holders are read at all.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface RosterRow {
  id: string | null;
  name: string;
  handle: string | null;
  email: string | null;
}

export async function rosterRows(pool: Pool): Promise<RosterRow[]> {
  const [users] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `name`, `handle`, `email` FROM `users` WHERE `is_example` = 0",
  );
  const [documented] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT `display_name` FROM `org_role_assignments` WHERE `holder_kind` = 'documented' AND `display_name` IS NOT NULL",
  );
  return [
    ...users.map((u) => ({
      id: String(u.id),
      name: String(u.name ?? ""),
      handle: u.handle ? String(u.handle) : null,
      email: u.email ? String(u.email) : null,
    })),
    ...documented.map((d) => ({ id: null, name: String(d.display_name), handle: null, email: null })),
  ];
}
