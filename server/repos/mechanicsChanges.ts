/**
 * `mechanics_changes`: the amendment ledger's one INSERT, and one of its reads.
 *
 * ── WHY THE WRITER WAS WORTH A FILE BEFORE ANY READER WAS ──────────────────
 *
 * This table has one writer and several readers. `server/index.ts` lists it for
 * the admin history, `server/lib/ballots.ts` asked which dials a village has
 * ever moved by vote, and `server/lib/mechanics.ts` asks when a given dial last
 * moved. Those three are reads, they were spread across three files, and none
 * of them moved when this file was written.
 *
 * One of them has now: `amendedKeysFor` at the foot of this file is the ballots
 * read, brought over by the raw-SQL burn-down. The other two are still where
 * they were, and are named here rather than left to be discovered, because a
 * reader who finds this file and believes it exhaustive is worse off than one
 * who greps.
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
import type { Pool, RowDataPacket } from "mysql2/promise";

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

/**
 * WHICH DIALS A BALLOT ACTUALLY MOVED, READ BACK OUT OF THE LEDGER.
 *
 * The apply path stamps every amendment row with `gm:<proposal> bal:<ballot>`
 * (`applyMechanicsProposal`, server/index.ts), so the ballot that decided a
 * change is already written next to the change. Nothing has ever read it in
 * that direction. The outcome card's "What changed" came off the close
 * response instead, which means it existed only in the browser session that
 * closed the vote and was gone by the next morning, on exactly the decisions
 * worth coming back to.
 *
 * This is the permanent answer to the same question. It reports what the
 * ledger holds and never what a proposal asked for: a change the apply pass
 * refused is absent here, correctly, because it did not happen.
 *
 * `LIKE` because the reference is a composite of up to three parts and the
 * ballot marker sits at the end of it. The id is escaped for LIKE's own
 * wildcards before it goes in, so an id is matched as characters and not as
 * a pattern, whatever future ids turn out to contain.
 *
 * A LEADING WILDCARD SCANS, and that is the right trade here rather than an
 * oversight. This table holds one row per dial a village has ever moved, so it
 * is hundreds of rows on an old village and a handful on a young one, and this
 * runs once when somebody opens one decision. The alternative is a column
 * duplicating a fact the reference already carries, which is a second copy of
 * one truth waiting to disagree with the first.
 *
 * `source = 'governance'` and not the marker alone: an admin edit made while a
 * ballot was open carries no ballot reference, and a village that ever writes
 * one by hand must not have it read back as something the village voted for.
 */
export async function amendedKeysFor(pool: Pool, ballotId: string): Promise<string[]> {
  const escaped = ballotId.replace(/([\\%_])/g, "\\$1");
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT config_key FROM mechanics_changes WHERE source = 'governance' AND proposal_ref LIKE ? ORDER BY config_key",
    [`%bal:${escaped}%`],
  );
  return rows.map((r) => String(r.config_key));
}
