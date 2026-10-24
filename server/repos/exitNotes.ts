/**
 * `exits.resolution`, for the erasure's exit step: a home being started, with
 * two statements in it.
 *
 * server/lib/exit.ts still creates, reads and settles exits where it always
 * did, and the settle and resolve routes in server/index.ts still write this
 * column. What lives here is the erasure's read and write (lane E2), called
 * from `forgetOwnExitNotes` in exit.ts, which decides what the note becomes.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** Every departure a member opened themselves that carries any text. */
export async function ownExitResolutions(pool: Pool, userId: string): Promise<Array<{ id: string; resolution: string }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, resolution FROM exits WHERE user_id = ? AND opened_by = ? AND resolution IS NOT NULL",
    [userId, userId],
  );
  return rows.map((r) => ({ id: String(r.id), resolution: String(r.resolution) }));
}

/** Write one exit's resolution text, or NULL when nothing is left of it. */
export async function setExitResolution(pool: Pool, exitId: string, resolution: string | null): Promise<void> {
  await pool.query("UPDATE exits SET resolution = ? WHERE id = ?", [resolution, exitId]);
}
