/**
 * THE SEAM BETWEEN A COMPLETION VOTE AND A CIRCLE'S MONEY.
 *
 * `shared/circleBonusGate.ts` holds the shape of the answer, the states and
 * the sentences, and its header holds the whole of the reasoning. This file
 * holds the two things that need a database: finding the completion ballot on
 * a commitment record, and turning that ballot into the vote component.
 *
 * NOTHING HERE PAYS ANYTHING. There is no amount, no share and no transfer.
 * The reading composes three facts and a list of refusals, and a village
 * decides. See the shared header for why an automatic payout was refused
 * instead of guarded.
 *
 * ── THE SUBJECT REF, AND THE WIDTH THAT DECIDES ITS SHAPE ──────────────────
 *
 * `ballots.subject_ref` is varchar(64), measured on a migrated schema at
 * `information_schema.COLUMNS`. `circles.id` is varchar(64) and
 * `circle_budgets.season_id` is varchar(64), so a key naming both is 129
 * characters before any prefix and no encoding of the pair fits. MariaDB here
 * runs STRICT_TRANS_TABLES, so an over-width value is a LOST ROW and not a
 * truncated one, which for a ballot would be a vote that silently never
 * opened.
 *
 * `server/lib/circleBurn.ts` met the same wall on `token_ledger.source_ref`
 * and solved it by deriving the period from the row's instant. THAT SOLUTION
 * DOES NOT TRANSFER. A ledger row is written inside the period it belongs to;
 * a completion vote about a season opens AFTER that season has closed, so its
 * own instant falls in the next one and deriving would attribute every vote to
 * the wrong period.
 *
 * So the ballot's subject is the COMMITMENT RECORD, whose id is one varchar(64)
 * and fits with the prefix to spare. That is what a mechanics ballot already
 * does with a proposal id and a seating ballot with a role id.
 *
 * ── THERE IS NO COMMITMENT RECORD IN THIS SCHEMA TODAY ─────────────────────
 *
 * Measured across all 167 tables of a fully migrated schema: `circle_budgets`
 * is the only table carrying both a circle and a period, and what it holds is
 * an amount, a unit and a 500-character note. No table records what a circle
 * took on. So `commitmentFor` is a DEPENDENCY and not a query: the reading
 * works the day a village records one, and until then it refuses by name
 * instead of guessing. `server/routes/circleBonusGate.ts` wires the reader
 * that finds none, and says so in one place.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import { ballotsFor, type BallotRow } from "./ballots";
import {
  bonusGate,
  type BonusGateReading,
  type CommitmentRecord,
  type CompletionElectorate,
  type VoteComponent,
} from "../../shared/circleBonusGate";
import type { CircleBurnReading } from "../../shared/circleBurn";

/** What a completion ballot is filed under. One subject type, one spelling. */
export const COMPLETION_SUBJECT = "circle_completion";

/** The width `ballots.subject_ref` holds, measured on a migrated schema. */
export const MAX_SUBJECT_REF = 64;

/**
 * Why this record cannot carry a completion vote, in words, or null when it
 * can.
 *
 * Called before a ballot is opened, never after. It fires against a record id
 * a fork's own migration invented, which is the case nobody tests and the one
 * strict MySQL turns into a lost row.
 */
export function completionRefProblem(recordId: string): string | null {
  const id = String(recordId ?? "");
  if (!id.trim()) return "a completion vote has to name the record it is about";
  if (id.length > MAX_SUBJECT_REF) {
    return (
      `filing a completion vote on record ${JSON.stringify(id.slice(0, 40))} needs ${id.length} ` +
      `characters of subject_ref and the ballots column holds ${MAX_SUBJECT_REF}. The row would ` +
      `be refused by strict MySQL and the vote would never open`
    );
  }
  return null;
}

/**
 * WHY THE OPEN BALLOT OUTRANKS THE LATEST CLOSED ONE.
 *
 * `ballots.open_key` is unique while a vote runs, so a record can have at most
 * one open ballot and any number of closed ones. When one is running, the
 * village is being asked NOW, and that live question is the answer to "where
 * does this stand", whatever a previous attempt concluded. With none running,
 * the most recent close is the standing answer.
 */
export function pickCompletionBallot(all: readonly BallotRow[]): BallotRow | null {
  const open = all.find((b) => b.status === "open");
  if (open) return open;
  return all[0] ?? null;
}

/**
 * The vote component for one commitment record.
 *
 * EVERY FIGURE COMES OFF THE FROZEN BALLOT. `electorate_count` and
 * `total_weight` are what the roll was at open, which is what quorum was
 * measured against; reading a live member count here would report a number
 * the decision never used. The snapshot law, one file over.
 */
export async function completionVoteFor(
  conn: Pool | PoolConnection,
  recordId: string,
  electorate: CompletionElectorate = "village",
): Promise<VoteComponent> {
  const problem = completionRefProblem(recordId);
  if (problem) throw new Error(problem);

  const all = await ballotsFor(conn as Pool, COMPLETION_SUBJECT, recordId);
  const ballot = pickCompletionBallot(all);
  if (!ballot) {
    return {
      state: "never_asked",
      ballotId: null,
      onTheRoll: null,
      rollWeight: null,
      closedAt: null,
      outcomeNote: null,
      attempts: 0,
      judgedBy: null,
    };
  }
  return {
    state: voteStateOf(ballot.status),
    ballotId: ballot.id,
    onTheRoll: ballot.electorateCount,
    rollWeight: ballot.totalWeight,
    closedAt: ballot.closedAt,
    outcomeNote: ballot.outcomeNote,
    attempts: all.length,
    judgedBy: electorate,
  };
}

/**
 * A ballot status as an answer about completion.
 *
 * `failed` and `no_quorum` stay apart, because the engine already keeps them
 * apart and collapsing them here would tell a circle the village judged its
 * work when the village did not turn up.
 */
function voteStateOf(status: BallotRow["status"]): VoteComponent["state"] {
  if (status === "open") return "open";
  if (status === "withdrawn") return "withdrawn";
  if (status === "no_quorum") return "no_quorum";
  if (status === "passed") return "said_yes";
  return "said_no";
}

export interface GateQuery {
  circleId: string;
  /** The period asked about, in whatever the village keys periods by. */
  periodId: string;
  /**
   * THE INSTANT THIS ANSWERS FOR, and never implicitly now. For a finished
   * period it is the period's end, because that is the instant the spend has
   * to be read at: a burn reading taken later would still be correct, and one
   * taken with the window's END as its upper bound while the window is
   * unfinished counts rows the reading has not reached.
   */
  at: Date;
}

export interface GateDeps {
  conn: Pool | PoolConnection;
  /**
   * What this circle recorded that it was taking on, or null when nothing did.
   *
   * A DEPENDENCY AND NOT A QUERY, because no table in this schema stores one.
   * See the file header.
   */
  commitmentFor(circleId: string, periodId: string): Promise<CommitmentRecord | null>;
  /** The circle's spend against its cap, from `burnFor`. Read, never recomputed. */
  burnFor(circleId: string, at: Date): Promise<CircleBurnReading>;
  /** Which roll a completion vote is put to. Named by the caller, never defaulted here. */
  electorate: CompletionElectorate;
}

/**
 * The whole reading for one circle and one period.
 *
 * A RECORD THAT NAMES A DIFFERENT CIRCLE IS REFUSED AND NOT SILENTLY USED. A
 * commitment reader that returned another circle's row would put one circle's
 * work behind another circle's money, which is the shape that costs somebody
 * their allowance.
 */
export async function bonusGateFor(q: GateQuery, deps: GateDeps): Promise<BonusGateReading> {
  const record = await deps.commitmentFor(q.circleId, q.periodId);
  if (record && record.circleId !== q.circleId) {
    throw new Error(
      `the commitment record ${JSON.stringify(record.id)} belongs to circle ` +
        `${JSON.stringify(record.circleId)} and was asked for as ${JSON.stringify(q.circleId)}`,
    );
  }

  const vote = record
    ? await completionVoteFor(deps.conn, record.id, deps.electorate)
    : ({
        state: "never_asked",
        ballotId: null,
        onTheRoll: null,
        rollWeight: null,
        closedAt: null,
        outcomeNote: null,
        attempts: 0,
        judgedBy: null,
      } as VoteComponent);

  const burn = await deps.burnFor(q.circleId, q.at);
  return bonusGate({
    circleId: q.circleId,
    takenAt: q.at.toISOString(),
    record,
    vote,
    burn,
  });
}
