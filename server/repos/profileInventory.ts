/**
 * The reads behind a member's profile inventory, and the write behind their
 * privacy flags (shared/profileInventory.ts, server/routes/profilePrivacy.ts).
 *
 * Raw SQL lives here because `server/repos` is where it belongs; the lib and
 * the routes call these by name.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { LIVE_LOAN_STATUSES, LIVE_STAY_STATUSES, type Inventory, type LoanStatus, type StayStatus } from "../../shared/profileInventory";
import { reservationStanding } from "../lib/pathLadders";

/**
 * What a member has borrowed, booked and asked to reserve, live only.
 *
 * Three reads by the member's own id. A reservation brings the home type, the
 * place on the map and where it stands, never the name, email, phone or notes
 * typed into the form, so the same shape is safe to hand a stranger once the
 * member turns `showInventory` on. A read that fails is an empty list for that
 * kind, and the other two still answer.
 */
export async function loadInventory(pool: Pool, userId: string): Promise<Inventory> {
  const read = async (sql: string, args: unknown[]): Promise<RowDataPacket[]> => {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(sql, args);
      return rows;
    } catch {
      return [];
    }
  };
  const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");
  const [loans, stays, lots] = await Promise.all([
    read(
      "SELECT l.`id`, l.`status`, DATE_FORMAT(l.`due_on`, '%Y-%m-%d') AS due_on, i.`name` AS item " +
        "FROM `library_loans` l JOIN `library_items` i ON i.`id` = l.`item_id` " +
        `WHERE l.user_id = ? AND l.status IN (${marks(LIVE_LOAN_STATUSES.length)}) ORDER BY l.created_at DESC`,
      [userId, ...LIVE_LOAN_STATUSES],
    ),
    read(
      "SELECT s.`id`, s.`status`, DATE_FORMAT(s.`arrive_on`, '%Y-%m-%d') AS arrive_on, a.`name` AS place " +
        "FROM `stays` s JOIN `accommodations` a ON a.`id` = s.`accommodation_id` " +
        `WHERE s.user_id = ? AND s.status IN (${marks(LIVE_STAY_STATUSES.length)}) ORDER BY s.created_at DESC`,
      [userId, ...LIVE_STAY_STATUSES],
    ),
    read(
      "SELECT `id`, `home_type`, `structure_key`, `status` FROM `housing_reservations` " +
        "WHERE `village_id` = 'local' AND `user_id` = ? AND `status` <> 'withdrawn' ORDER BY `created_at` DESC",
      [userId],
    ),
  ]);
  return {
    loans: loans.map((r) => ({
      id: String(r.id),
      item: String(r.item ?? ""),
      status: String(r.status) as LoanStatus,
      dueOn: r.due_on ? String(r.due_on) : null,
    })),
    stays: stays.map((r) => ({
      id: String(r.id),
      place: String(r.place ?? ""),
      status: String(r.status) as StayStatus,
      arriveOn: r.arrive_on ? String(r.arrive_on) : null,
    })),
    lots: lots.map((r) => ({
      id: String(r.id),
      homeType: String(r.home_type),
      structureKey: r.structure_key == null ? null : String(r.structure_key),
      standing: reservationStanding(String(r.status)),
    })),
  };
}
/** The stored privacy blob as the column holds it (JSON, a string, or null), or undefined for no such member. */
export async function readPrivacyBlob(pool: Pool, userId: string): Promise<unknown | undefined> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT `privacy` FROM `users` WHERE `id` = ? LIMIT 1", [userId]);
  if (!rows[0]) return undefined;
  const raw: unknown = rows[0].privacy;
  if (typeof raw !== "string") return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Write the whole resolved blob. */
export async function writePrivacyBlob(pool: Pool, userId: string, privacy: object): Promise<void> {
  await pool.query("UPDATE `users` SET `privacy` = ? WHERE `id` = ?", [JSON.stringify(privacy), userId]);
}
