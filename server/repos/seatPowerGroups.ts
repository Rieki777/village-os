/**
 * The SQL behind "holding a seat grants its Power groups" (0322).
 *
 * Every read and write of `org_role_power_groups`, and the two org-plane reads
 * the bridge needs, live here so server/lib/seatGrants.ts stays pure and the
 * route module stays free of queries. Raw SQL, like the org plane (0049): no
 * `replaceAll`, so a write can only touch the rows it names.
 */
import type { Pool } from "mysql2/promise";
import { ASSIGN_COLS, rowToAssignment, type OrgAssignment } from "../lib/orgChart";

/** One seat-to-group link. */
export interface SeatGroupLink {
  orgRoleId: string;
  roleId: string;
  createdBy?: string | null;
  createdAt?: Date | string | null;
}

/** The org-seat facts the bridge reads. */
export interface SeatFacts {
  id: string;
  active: boolean;
  isExample: boolean;
  expiresEachSeason: boolean | null;
}

/** Every link, every seat. */
export async function listSeatGroupLinks(pool: Pool): Promise<SeatGroupLink[]> {
  const [rows]: any = await pool.query(
    "SELECT org_role_id, role_id, created_by, created_at FROM org_role_power_groups ORDER BY org_role_id, role_id",
  );
  return (rows as any[]).map((r) => ({
    orgRoleId: String(r.org_role_id),
    roleId: String(r.role_id),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at ?? null,
  }));
}

/** The facts the bridge reads about the linked seats. */
export async function seatFactsFor(pool: Pool, seatIds: readonly string[]): Promise<Map<string, SeatFacts>> {
  const out = new Map<string, SeatFacts>();
  if (seatIds.length === 0) return out;
  const [rows]: any = await pool.query("SELECT id, active, is_example, expires_each_season FROM org_roles WHERE id IN (?)", [seatIds]);
  for (const r of rows as any[]) {
    out.set(String(r.id), {
      id: String(r.id),
      active: !!r.active,
      isExample: !!r.is_example,
      expiresEachSeason: r.expires_each_season === null || r.expires_each_season === undefined ? null : !!r.expires_each_season,
    });
  }
  return out;
}

/** The live seatings on the linked seats. */
export async function liveSeatingsOn(pool: Pool, seatIds: readonly string[]): Promise<OrgAssignment[]> {
  if (seatIds.length === 0) return [];
  const [rows]: any = await pool.query(`SELECT ${ASSIGN_COLS} FROM org_role_assignments WHERE ended_at IS NULL AND org_role_id IN (?)`, [seatIds]);
  return (rows as any[]).map(rowToAssignment);
}

/** One seat's id, name and example flag, or null. */
export async function seatHeader(pool: Pool, id: string): Promise<{ id: string; name: string; isExample: boolean } | null> {
  const [rows]: any = await pool.query("SELECT id, name, is_example FROM org_roles WHERE id = ?", [id]);
  const r = (rows as any[])[0];
  return r ? { id: String(r.id), name: String(r.name), isExample: !!r.is_example } : null;
}

/** Replace one seat's links by the difference, in one transaction. */
export async function writeSeatGroupLinks(
  pool: Pool,
  seatId: string,
  change: { added: readonly string[]; removed: readonly string[]; by: string | null },
): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (change.removed.length) {
      await conn.query("DELETE FROM org_role_power_groups WHERE org_role_id = ? AND role_id IN (?)", [seatId, change.removed]);
    }
    for (const id of change.added) {
      await conn.query("INSERT IGNORE INTO org_role_power_groups (org_role_id, role_id, created_by) VALUES (?, ?, ?)", [seatId, id, change.by]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
