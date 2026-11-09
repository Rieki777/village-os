/**
 * `exits`: the settling write the admin settle route makes.
 *
 * Moved here from `server/index.ts` with the routes that call them
 * (`server/routes/exits.ts`, 2026-09-27). Each statement is the one that route
 * ran inline, word for word, so a departure moves through the same states it
 * always did. Resolve and cancel write through `server/repos/exitNotes.ts`
 * under the exit hold (main grew that home while this was held, so the two
 * twins this file once had went). The rest of the table's readers and writers
 * (open, enumerate, sweep) live in `server/lib/exit.ts`.
 *
 * No cache sits above this table: every write goes straight to the database.
 */
import type { Pool } from "mysql2/promise";

/** After a balance sweep: the exit is settling, and the sweep's note joins its resolution text. */
export async function markExitSettling(pool: Pool, exitId: string, note: string): Promise<void> {
  await pool.query(
    "UPDATE exits SET status = 'settling', resolution = CONCAT(COALESCE(resolution,''), ?) WHERE id = ?",
    [note, exitId],
  );
}
