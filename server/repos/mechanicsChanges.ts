/**
 * `mechanics_changes`: the amendment ledger's one INSERT.
 *
 * ── WHY THE WRITER IS WORTH A FILE WHEN THE READERS ARE NOT HERE ───────────
 *
 * This table has one writer and several readers. `server/index.ts` lists it for
 * the admin history, `server/lib/ballots.ts` asks which dials a village has
 * ever moved by vote, and `server/lib/mechanics.ts` asks when a given dial last
 * moved. Those three are reads, they are spread across three files, and they
 * did not move here.
 *
 * The WRITER is the one that had to. Every mechanics change lands in this table
 * or it did not happen — an admin edit, a routed legacy field, a platform
 * migration, a passed proposal — so the table's value is entirely a function of
 * there being exactly ONE place a row can be made. A second INSERT written
 * later with a slightly different idea of what `old_value` NULL means would not
 * fail anything; it would just make the history quietly wrong for the rows it
 * wrote, and the readers above have no way to tell which rows those were.
 *
 * ── NULL MEANS "THE PLATFORM DEFAULT AT THE TIME" ──────────────────────────
 *
 * That convention is the reason this file exists rather than the row count.
 * A dial sitting at its default has no `game_variables` row, so recording the
 * default as a literal would say the village had chosen it. The caller resolves
 * the default and hands over null, and that decision stays with the caller
 * because it needs `VARIABLES_BY_KEY` — the platform's own table of defaults,
 * which is a shared concern and not a database one. What is guaranteed HERE is
 * that no other shape of row can be written: there is one insert, and it takes
 * the columns already resolved.
 *
 * ── IT THROWS, AND THE CALLER SWALLOWS ─────────────────────────────────────
 *
 * Deliberately, and the same way `governanceElementLedger.ts` does. This is a
 * trace of a change that has already happened, and a trace that failed must not
 * fail the deed it is a trace OF. The decision to swallow lives at the call
 * site, beside the deed, rather than being hidden in this file where a later
 * caller would inherit it without knowing.
 */
import type { Pool } from "mysql2/promise";

/** The column list, in the order the statement binds them. */
const COLUMNS = "id, config_key, old_value, new_value, actor_user_id, source, proposal_ref, note";

/** Where a change came from. The `source` enum, since 0042. */
export type MechanicsChangeSource = "admin" | "governance" | "platform";

/** One amendment, with every value already resolved by the caller. */
export interface MechanicsChangeRow {
  id: string;
  configKey: string;
  /** NULL means the dial sat at the platform default. See the header. */
  oldValue: string | null;
  /** NULL means the dial now sits at the platform default. */
  newValue: string | null;
  actorUserId: string | null;
  source: MechanicsChangeSource;
  proposalRef: string | null;
  note: string | null;
}

/**
 * Write one amendment.
 *
 * `at` is not a parameter: the column defaults to CURRENT_TIMESTAMP and the
 * readers order on it, so the row is dated by the database that accepted it
 * rather than by a clock in whichever process happened to make the change.
 */
export async function insertMechanicsChange(pool: Pool, row: MechanicsChangeRow): Promise<void> {
  await pool.query(
    `INSERT INTO mechanics_changes (${COLUMNS}) VALUES (?,?,?,?,?,?,?,?)`,
    [
      row.id,
      row.configKey,
      row.oldValue,
      row.newValue,
      row.actorUserId,
      row.source,
      row.proposalRef,
      row.note,
    ],
  );
}
