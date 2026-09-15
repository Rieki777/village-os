/**
 * `governance_element_ledger`: the only table that records what a change set
 * actually WROTE, element by element, in the executor's own words.
 *
 * ── WHY THIS TABLE'S READERS AND WRITERS HAVE TO BE ENUMERABLE ─────────────
 *
 * It is the trail. `server/lib/changeset.ts` explains why the executor cannot
 * be one transaction — the writers it drives mutate module state and commit on
 * their own connections — and this table is what stands in for the atomicity
 * that is therefore unavailable: one row per write, ordered by the sequence
 * that puts the hardest-to-undo write last, so a landing that failed halfway
 * can be read back and finished or reversed by hand.
 *
 * A trail is worth exactly what its writers are worth. 0177 records the defect
 * that made this concrete: the table was keyed on an autoincrement id, so a
 * retried landing wrote a SECOND row for the same element and the trail said
 * the dial moved twice, "which is the one thing a ledger must never say". The
 * fix was the composite key and the upsert below. What keeps the fix is that
 * both statements which touch the key live in one file — a second INSERT
 * written elsewhere without `ON DUPLICATE KEY UPDATE` would put the old defect
 * straight back, and nothing at that call site would look wrong.
 *
 * ── THREE STATEMENTS, FROM TWO FILES ───────────────────────────────────────
 *
 *   `upsertElementRow`      server/lib/changeset.ts, between two writes that
 *                           have already happened.
 *   `elementRowsForBallot`  server/lib/changeset.ts, the decision page's trail.
 *   `sentencesAppliedBetween` server/lib/moonDigest.ts, "what landed this moon".
 *
 * The two readers are here TOGETHER on purpose, and their difference is the
 * thing worth seeing in one place: one is scoped to a ballot and ordered by the
 * write sequence, the other is scoped to a window of time and ordered by the
 * clock. Reading them side by side is what makes it obvious that a digest
 * reports the same sentences a decision page does, and that neither invents a
 * summary of its own.
 *
 * ── NO CACHE, AND NO ERROR PATH THAT REACHES THE CALLER ────────────────────
 *
 * Nothing caches this table: every read goes to the database when it is asked,
 * because a trail read from memory is a trail that cannot be trusted after a
 * restart. And `upsertElementRow` deliberately does not own its own failure
 * handling — the caller swallows it — for the reason stated at that call site:
 * a trail that failed must not fail the deed it is a trail OF. That decision
 * stays with the caller, where the deed is, rather than being buried here.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** Everything a decision page shows about one element, in one round trip. */
const BALLOT_TRAIL_COLUMNS =
  "element_index, element_kind, sentence, old_value, new_value, applied_at";

/** One row of the element trail, as the decision page reads it. */
export interface ElementTrailRow {
  index: number;
  kind: string;
  sentence: string;
  oldValue: string | null;
  newValue: string | null;
  appliedAt: string;
}

/** Everything one write puts on the trail. */
export interface ElementRowInput {
  ballotId: string;
  /** The proposal the ballot was held on, so a reversion can join the trail. */
  proposalId: string | null;
  elementIndex: number;
  /** Where this write fell in the executor's own order. See 0177. */
  writeSeq: number;
  elementKind: string;
  /** Already clipped by the caller to the column's 1000 characters. */
  sentence: string;
  wroteTable: string | null;
  wroteId: string | null;
  oldValue: string | null;
  newValue: string | null;
}

/**
 * Record one write, keyed on (ballot, element index) so a RETRY OVERWRITES ITS
 * OWN ROW rather than adding a second one.
 *
 * `old_value` is the one column the upsert does NOT overwrite, and that
 * asymmetry is the whole point of the statement. The first attempt saw the
 * value the dial actually held before the change set touched it; a retry sees
 * whatever the first attempt left, so writing `old_value` again would replace
 * the truth with the consequence, and the trail would say the change started
 * from where it ended. `applied_at` is refreshed because the row is meant to
 * date the write that stands.
 *
 * THROWS. The caller decides what a failed trail means for the deed it is a
 * trail of, and in this platform that decision is always "the deed stands".
 */
export async function upsertElementRow(pool: Pool, input: ElementRowInput): Promise<void> {
  await pool.query(
    "INSERT INTO governance_element_ledger " +
      "(ballot_id, proposal_id, element_index, write_seq, element_kind, sentence, wrote_table, wrote_id, old_value, new_value) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE proposal_id = VALUES(proposal_id), write_seq = VALUES(write_seq), " +
      "element_kind = VALUES(element_kind), sentence = VALUES(sentence), wrote_table = VALUES(wrote_table), " +
      "wrote_id = VALUES(wrote_id), new_value = VALUES(new_value), applied_at = CURRENT_TIMESTAMP",
    [
      input.ballotId,
      input.proposalId,
      input.elementIndex,
      input.writeSeq,
      input.elementKind,
      input.sentence,
      input.wroteTable,
      input.wroteId,
      input.oldValue,
      input.newValue,
    ],
  );
}

/**
 * One decision's trail, IN THE ORDER THE WRITES HAPPENED.
 *
 * `ORDER BY write_seq, element_index` and not by `element_index` alone: those
 * are two different facts (0177 says so in the migration itself), and a reader
 * asking what happened wants the executor's order, which is the order that put
 * the hardest-to-undo write last. `element_index` breaks the tie so rows
 * written before 0177 gave `write_seq` a value — it defaults to 0 — still come
 * back in the order a member read them.
 *
 * `applied_at` is normalised to an ISO string here rather than being handed
 * over raw, because both callers render it and neither wants a value whose
 * type depends on the connection.
 */
export async function elementRowsForBallot(pool: Pool, ballotId: string): Promise<ElementTrailRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${BALLOT_TRAIL_COLUMNS} ` +
      "FROM governance_element_ledger WHERE ballot_id = ? ORDER BY write_seq, element_index",
    [ballotId],
  );
  return rows.map((r) => ({
    index: Number(r.element_index),
    kind: String(r.element_kind),
    sentence: String(r.sentence),
    oldValue: r.old_value === null || r.old_value === undefined ? null : String(r.old_value),
    newValue: r.new_value === null || r.new_value === undefined ? null : String(r.new_value),
    appliedAt: r.applied_at instanceof Date ? r.applied_at.toISOString() : String(r.applied_at),
  }));
}

/**
 * Every sentence written inside a window, oldest first.
 *
 * Half-open on purpose: `>= from` and `< to`. The caller hands in the bounds of
 * a cycle that has just ended, and the next cycle's window starts at exactly
 * `to`, so an inclusive upper bound would put a write that landed on the
 * boundary into two digests.
 *
 * Ordered by `applied_at`, then ballot, then element index, so two decisions
 * that landed in the same second still read back as two decisions rather than
 * interleaved. `applied_at` is a `timestamp` with second resolution, which is
 * exactly why the tiebreak is not decoration.
 *
 * The bounds arrive as strings the caller has already formatted for the
 * connection, and are passed straight through as parameters. Formatting them
 * here would put a second opinion about the session's timezone in the codebase.
 */
export async function sentencesAppliedBetween(pool: Pool, from: string, to: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT sentence FROM governance_element_ledger WHERE applied_at >= ? AND applied_at < ? " +
      "ORDER BY applied_at ASC, ballot_id ASC, element_index ASC",
    [from, to],
  );
  return rows.map((r) => String(r.sentence));
}
