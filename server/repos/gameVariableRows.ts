/**
 * `game_variables`, read AS ROWS — deliberately going around the cache above it.
 *
 * ── WHY THIS IS NOT `server/lib/variables.ts` ──────────────────────────────
 *
 * That file is the variables API: it loads every row once, keeps them in a
 * module-level overrides object, and serves `stringVar`/`numberVar` from
 * memory. Almost everything should use it, and this module is not a rival to
 * it.
 *
 * The one caller here needs something the cache cannot give. Before a change
 * set writes a dial, the executor records what the dial held BEFORE, so the
 * amendment ledger and the element trail can say what moved. It has to know
 * two different things at once:
 *
 *   is there a row at all?   a village that has never touched this dial has
 *                            none, and the ledger records that as NULL, meaning
 *                            "the platform default at the time"
 *   what does the row say?   the value the village actually chose
 *
 * `stringVar` collapses those: it answers with the default when there is no
 * row, and the caller could not then tell a village that chose the default
 * from one that never chose. That is the distinction the whole amendment ledger
 * is built on, so this read goes to the table.
 *
 * ── AND IT MUST NOT BE A CACHE READ FOR A SECOND REASON ────────────────────
 *
 * The executor is mid-flight when it asks. `setVariable` writes the row and
 * mutates the in-memory overrides, and a change set applies several elements in
 * sequence. Reading the previous value from the cache would, for the second and
 * later elements of one set, read a cache that this same set has already
 * written to — and the trail would record the dial moving from where the set
 * had just put it. One round trip per element buys a trail that is about the
 * village rather than about the process.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *
 * The writes. `server/lib/variables.ts` owns the DELETE-when-default and the
 * INSERT … ON DUPLICATE KEY UPDATE, and it owns them together with the cache
 * mutation that has to happen in the same breath. Lifting either statement out
 * without the cache write would be lifting half of an act, and the half left
 * behind is the half that decides what the running process serves.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** One column. The caller resolves the default itself when there is no row. */
const COLUMNS = "value";

/**
 * The stored override for one dial, or null when the village has never set it.
 *
 * NULL IS A REAL ANSWER AND NOT AN ERROR. It means "no row", which the caller
 * reads as "this dial sits at the platform default", and that is exactly the
 * distinction this function exists to preserve.
 *
 * A row whose `value` is itself SQL NULL comes back as the string "null",
 * because `String(null)` is what the raw statement did with it. Left as it was
 * on purpose: the column is `NOT NULL` on every migration that has touched it,
 * so changing the handling here would be inventing behaviour for a row that
 * cannot exist, inside a refactor.
 */
export async function storedVariableValue(pool: Pool, configKey: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM game_variables WHERE config_key = ?`,
    [configKey],
  );
  return rows[0] ? String(rows[0].value) : null;
}
