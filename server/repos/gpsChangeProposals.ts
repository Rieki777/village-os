/**
 * `gps_change_proposals`: the statement a change ballot is asking the village
 * to adopt, and the enumerable home of every statement against that table.
 *
 * ── WHY THE PAYLOAD IS A ROW AND NOT A PASSAGE OF THE DOCUMENT ─────────────
 *
 * A change ballot's `doc_markdown` holds the proposed statement under a
 * heading, because that is what the village reads before it votes. It is copy,
 * written for people, and somebody will improve its wording. A closer that
 * recovered the new statement by finding a heading in markdown would keep
 * working until the day a copy change moved the heading, and would then write
 * the wrong sentence into the document every later upgrade is judged against,
 * silently, on the one path nobody has ever run.
 *
 * So the payload is a row keyed by its ballot, which is the shape
 * `role_declarations` already uses for exactly this reason (0120).
 *
 * ── WHAT THIS TABLE DOES NOT HOLD ─────────────────────────────────────────
 *
 * The standing statement. That lives in `app_config` under `gps`, and
 * `server/lib/governingPurpose.ts` is its one reader and one writer. This is a
 * proposal, which is a different fact: a village may ask and say no.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface GpsChangeProposal {
  ballotId: string;
  statement: string;
  proposedBy: string;
}

/**
 * Record what a change ballot is asking for.
 *
 * Idempotent on the ballot id, so a retried open writes one row. The ballot's
 * `open_key` already makes a second open impossible while one is running;
 * this makes a second WRITE harmless, which is a different guarantee and the
 * one a caller between a commit and a crash needs.
 */
export async function recordGpsChangeProposal(pool: Pool, input: GpsChangeProposal): Promise<void> {
  await pool.query(
    "INSERT INTO gps_change_proposals (ballot_id, statement, proposed_by) VALUES (?,?,?) " +
      "ON DUPLICATE KEY UPDATE statement = VALUES(statement), proposed_by = VALUES(proposed_by)",
    [input.ballotId, input.statement, input.proposedBy],
  );
}

/** What this ballot is asking for, or null when nothing was recorded. */
export async function gpsChangeProposalFor(pool: Pool, ballotId: string): Promise<GpsChangeProposal | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT ballot_id, statement, proposed_by FROM gps_change_proposals WHERE ballot_id = ?",
    [ballotId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ballotId: String(row.ballot_id),
    statement: String(row.statement),
    proposedBy: String(row.proposed_by),
  };
}
