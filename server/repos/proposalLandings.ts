/**
 * `mechanics_proposals` AS THE LANDING PATH ASKS ABOUT IT: the instant mirrored
 * onto the proposal a member actually reads, and the three columns the landing
 * rules are derived from.
 *
 * ── WHY THIS IS SCOPED TO THE LANDING PATH AND NOT TO THE TABLE ────────────
 *
 * `mechanics_proposals` is the busiest table in governance. Six production
 * files outside this one touch it — `server/index.ts`, `server/lib/changeset.ts`,
 * `server/lib/governanceWindows.ts`, `server/lib/mechanics.ts`,
 * `server/lib/stewardship.ts` and `server/lib/hypha/outcomes.ts` — and three of
 * those are being burned down by neighbouring lanes in the same wave this file
 * was written in. A module here claiming the whole table would be a claim only
 * one of those lanes can actually keep, and the loser would quietly become the
 * table's second home, which is the exact harm the register exists to prevent.
 *
 * So this file claims what it can honestly hold: every statement
 * `server/lib/applyDue.ts` made against the table, and no others. The house
 * precedent is `server/repos/pathLadders.ts` and `server/repos/seatHoldings.ts`,
 * two modules over `org_role_assignments`, each named for the question it
 * answers. When the wave settles and one module can hold the whole table, these
 * five functions move into it whole; until then this is the enumerable home for
 * the landing path's half, and the paragraph above is the list of where the
 * other half is.
 *
 * ── WHY THE PROPOSAL CARRIES THE INSTANT AT ALL ────────────────────────────
 *
 * The vote is on `ballots` and the landing columns live there. The proposal is
 * the page a member opens, and a countdown that exists on the ballot and not on
 * the proposal is a countdown most members never see. So the two instant
 * columns are MIRRORED here, written in the same breath as the ballot's, by
 * every path that stamps or restamps them.
 *
 * THE VETO IS NOT MIRRORED THE SAME WAY, and the asymmetry is deliberate. A
 * veto answers a BALLOT: this vote, at this bar, on this text. The landing
 * path's own header records what happened when the veto columns were kept on
 * the proposal too and nobody cleared them: a village that answered its
 * steward's objection, passed the same proposal again and watched it carry then
 * found it unlandable forever, because every landing predicate reads
 * `vetoed_at IS NULL`. `stampProposalVeto` below is the ONE remaining writer of
 * those columns from this path, and it runs only on the steward's no at the
 * close; the display a surface renders is derived from the ballot instead, by
 * `newestBallotVeto` in `server/repos/ballotLandings.ts`.
 *
 * ── THE CHANGE SET COMES BACK RAW, ON PURPOSE ──────────────────────────────
 *
 * `change_set` is a `json` column, which arrives parsed on some connections and
 * as text on others. `rawChangeSet` hands back exactly what the driver gave it
 * and parses nothing. Four callers in the landing path read this column and
 * each does something different with an unreadable or absent value: one answers
 * false, one answers undefined, one answers the empty list. Parsing here would
 * pick one of those three for all of them and quietly change what a broken row
 * does on three paths at once.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ─────────────────────────────────────────
 *
 * Nothing to invalidate, and the reads below go to the database each time they
 * are asked. That is what the landing gate depends on: a proposal's change set
 * decides whether the decision may land mid-cycle, and a stale copy of it would
 * move a ceiling under a member already spending against it.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { sqlInstant } from "./ballotLandings";

/**
 * Mirror the landing instant onto the proposal.
 *
 * Both columns take the same value, and both take NULL together when there is
 * no instant: a proposal with one set and the other clear is a countdown
 * nobody can read. Every path that writes the ballot's pair writes this pair in
 * the same breath — the first stamp at close, the window handed back after a
 * stall, and the restamp of a row that was read late.
 */
export async function stampProposalLanding(pool: Pool, proposalId: string, landsAt: Date | null): Promise<void> {
  const at = landsAt ? sqlInstant(landsAt) : null;
  await pool.query("UPDATE mechanics_proposals SET lands_at = ?, veto_closes_at = ? WHERE id = ?", [at, at, proposalId]);
}

/**
 * Give a stopped proposal back to its proposer with its backers standing.
 *
 * The three statuses in the IN are the three a passed proposal can be sitting
 * in when a steward stops it; anything else is a proposal this veto is not
 * about and the statement matches nothing. This is the same road a missed
 * quorum takes, which is the point: a decision that did not take effect is not
 * a decision the author has to write again.
 */
export async function returnProposalToProposer(pool: Pool, proposalId: string): Promise<void> {
  await pool.query(
    "UPDATE mechanics_proposals SET status = 'open' WHERE id = ? AND status IN ('passed_onsite','passed_verified','onsite_vote')",
    [proposalId],
  );
}

/**
 * Stamp the steward's block onto the proposal, at the close.
 *
 * Read the module header before adding a second caller. These columns are never
 * cleared, so a path that writes them on a ballot the village can bring back
 * leaves the proposal unlandable forever.
 */
export async function stampProposalVeto(
  pool: Pool,
  input: { proposalId: string; at: Date; stewardId: string; reason: string },
): Promise<void> {
  await pool.query("UPDATE mechanics_proposals SET vetoed_at = ?, vetoed_by = ?, veto_reason = ? WHERE id = ?", [
    sqlInstant(input.at),
    input.stewardId,
    input.reason,
    input.proposalId,
  ]);
}

/**
 * The stored change set, exactly as the driver hands it over.
 *
 * `undefined` when there is no such proposal AND when the column is null, which
 * the callers read as one answer: a proposal with no elements behind it and a
 * proposal that is not there both carry no elements. Every caller tests it with
 * a plain falsy check, so an empty string reads the same way, which is what an
 * unwritten `json` column looks like on some connections.
 */
export async function rawChangeSet(pool: Pool, proposalId: string): Promise<unknown> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT change_set FROM mechanics_proposals WHERE id = ?", [
    proposalId,
  ]);
  return rows[0]?.change_set;
}

/** What this proposal points at, and what it claims the relation is. */
export interface SupersedesLink {
  /** `supersedes_proposal_id`, raw. Three different writers set it and only one of them is an override. */
  sup: unknown;
  /** `supersedes_relation`, raw. The explicit word is what tells the three apart. */
  rel: unknown;
}

/**
 * The proposal this one supersedes, and the relation it claims.
 *
 * Both columns come back raw because the caller's test is the whole rule and it
 * is written where it can be read beside its argument: the id ALONE conferred
 * steward-proof landing on anything pointing at a vetoed row, and three
 * different writers set that column — an override, a renewal of an expiring
 * setting, and the withdraw-and-rewrite clone. Two of the three were never the
 * village answering a veto at its highest bar. Narrowing either value here
 * would put half of that rule in this file and half in the other.
 */
export async function supersedesLink(pool: Pool, proposalId: string): Promise<SupersedesLink | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT p.supersedes_proposal_id AS sup, p.supersedes_relation AS rel FROM mechanics_proposals p WHERE p.id = ?",
    [proposalId],
  );
  const r = rows[0];
  return r ? { sup: r.sup, rel: r.rel } : null;
}
