/**
 * `quest_proposals`, the one statement erasure needs.
 *
 * server/lib/questProposals.ts is the table's home and holds every other read
 * and write. This statement lives under server/repos because the raw-SQL
 * register outside it may only shrink (scripts/module-sql-pending.json), and
 * erasure's step for this table would otherwise have added a call site to a
 * file whose count may not grow.
 *
 * WHAT ERASURE DOES HERE, AND WHY NOT MORE. A member's quest idea keeps its
 * words and loses its author, the rule the erasure sweep already applies to the
 * submission the idea came from ("the proposal content itself stays part of the
 * village record", server/lib/erasure.ts). The idea carries no contact details
 * to scrub: the email screen refuses a proposal with an address in it, and name
 * and email never leave the submission (server/lib/publicForms.ts).
 */
import type { Pool } from "mysql2/promise";

/** Clear a departing member from every quest idea they proposed. Returns how many rows changed. */
export async function forgetProposer(pool: Pool, userId: string): Promise<number> {
  const [res]: any = await pool.query("UPDATE quest_proposals SET proposed_by = NULL WHERE proposed_by = ?", [userId]);
  return Number(res?.affectedRows ?? 0);
}
