/**
 * `mechanics_proposals`: the two statements that were living in lib files.
 *
 * ── WHY THIS TABLE NEEDS AN ENUMERABLE HOME BEFORE IT NEEDS ANYTHING ELSE ──
 *
 * A row here is the thing a village voted on. 0043 states the property the
 * whole governance loop rests on: `change_set` is append-only in spirit, "a
 * changed mind is a withdrawal and a new proposal, so the record of what was
 * voted on can never drift from what was proposed". A table with that promise
 * is only as good as the list of code that writes it, and until this file
 * existed that list was "grep, and hope the grep was spelled right".
 *
 * `status` is the column that makes it urgent rather than tidy. It is an enum
 * that has been widened three times (0044, 0089, 0172) and it is read as a
 * gate in several places: a proposal that reads `applied` will not be applied
 * again. One forgotten writer of that column is a decision landing twice.
 *
 * ── WHAT IS HERE, AND WHY ONLY THIS MUCH ───────────────────────────────────
 *
 * Two statements, from two different lib files, both of them whole:
 *
 *   `markProposalApplied`     server/lib/changeset.ts, after a change set's
 *                             writes have already happened.
 *   `supersededDecisionClose` server/lib/governanceWindows.ts, the read that
 *                             dates a proposal's grace period.
 *
 * Neither sits inside a transaction the caller opened, neither takes a lock,
 * and both are addressed by primary key. They move as they are.
 *
 * MOST OF THIS TABLE'S TRAFFIC IS STILL ELSEWHERE and pretending otherwise
 * would make this header worse than no header. `server/index.ts` holds the
 * proposal lifecycle (create, sponsor, withdraw, take to a vote) and
 * `server/repos/hypha.ts` reads the table from the Hypha side, which its own
 * header says out loud. Those did not move here because this change is a
 * burn-down of four lib files, and a burn-down that also rewrites the
 * lifecycle is two changes wearing one commit message. What this file gives a
 * reader today is a real beginning: the place the next statement goes, and a
 * name to grep for that is shorter than the table's.
 *
 * ── THE READ REACHES TWO OTHER TABLES AND CANNOT BE SPLIT ──────────────────
 *
 * `supersededDecisionClose` walks `p -> o -> b`: this proposal, the proposal it
 * supersedes, and that proposal's ballot. Splitting it into three round trips
 * against three repo modules would give the caller three answers and nothing
 * saying they describe the same instant, and the fall-back it encodes
 * (`b.closes_at`, else `o.vetoed_at`, else null) only means anything when all
 * three are read together. It lives with `mechanics_proposals` because the row
 * it is addressed by, and both of the rows it walks through, are this table's.
 * `ballots` contributes one column and is named here so a reader of the ballots
 * side can still find this statement.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * The two columns the supersede walk actually reads back.
 *
 * Aliased in the statement rather than named bare because `vetoed_at` exists on
 * BOTH tables the walk touches (0172 added it to `mechanics_proposals` and to
 * `ballots` in the same migration), and a driver handing back two columns of
 * one name is a bug that reads as a null.
 */
const SUPERSEDE_COLUMNS = "b.closes_at AS closes_at, o.vetoed_at AS vetoed_at";

/**
 * When the decision this proposal comes back FROM finished, or null.
 *
 * Three answers, in the order the caller wants them:
 *
 *   the ballot's `closes_at`  the village finished being asked
 *   the original's `vetoed_at`  it never reached a ballot and a steward stopped it
 *   null                      this proposal supersedes nothing, or the row it
 *                             names is gone
 *
 * Both JOINs are LEFT for the same reason: a proposal that supersedes nothing
 * still has to come back with a row, because the caller reads null as "no
 * grace, the ordinary window applies". An INNER join would return no rows at
 * all and the caller could not tell that apart from an id that does not exist.
 *
 * The instant is handed back as a `Date` built from whatever the driver
 * returned, which is what the raw statement did. A column that arrives
 * unreadable becomes an Invalid Date rather than a throw, and the caller's
 * arithmetic then fails the grace check rather than the request.
 */
export async function supersededDecisionClose(pool: Pool, proposalId: string): Promise<Date | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${SUPERSEDE_COLUMNS} FROM mechanics_proposals p ` +
      "LEFT JOIN mechanics_proposals o ON o.id = p.supersedes_proposal_id " +
      "LEFT JOIN ballots b ON b.id = o.ballot_id WHERE p.id = ?",
    [proposalId],
  );
  const row = rows[0];
  const at = row?.closes_at ?? row?.vetoed_at ?? null;
  return at ? new Date(at) : null;
}

/**
 * Stamp a proposal `applied`.
 *
 * Unconditional on the current status, which is what the raw statement did and
 * what the caller needs: the executor calls this only after at least one
 * element has been written or queued, so the row is being told what already
 * happened. Adding `AND status <> 'applied'` here would look like a safety
 * improvement and would be a behaviour change — a retry that re-wrote its
 * elements would stop re-stamping the row, and nothing in the executor reads
 * this function's answer to notice.
 *
 * Returns nothing for the same reason. `affectedRows` from this statement
 * cannot tell "no such proposal" from "already said applied", so returning it
 * would hand the caller a number with two meanings.
 */
export async function markProposalApplied(pool: Pool, proposalId: string): Promise<void> {
  await pool.query("UPDATE mechanics_proposals SET status = 'applied' WHERE id = ?", [proposalId]);
}
