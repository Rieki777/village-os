/**
 * THE JOB THAT ASKS, AND THE CLOSER THAT PAYS WHAT THE VILLAGE ANSWERED.
 *
 * shared/moonSettlement.ts holds the rule and the words; this holds the wiring.
 * Two entry points, and the distance between them is the whole design:
 *
 *   `runMoonProposal`      a scheduler tick. Notices a moon ended, freezes what
 *                          it settled to, and OPENS A VOTE. Moves nothing.
 *   `settlementCloser`     the `cycle_settlement` entry in `SUBJECT_CLOSERS`.
 *                          Runs when the village has passed the vote and the
 *                          landing is due, and pays exactly what was frozen.
 *
 * ── WHY A SETTLEMENT IS A GAME CHANGE AND NOT A TOKEN SEND ───────────────────
 *
 * It releases value from the cycle pool, so the obvious reading of
 * `KIND_FOR_SUBJECT` in shared/governanceKinds.ts is that it belongs in there
 * beside `quest_payout`. It is deliberately absent, which makes it a
 * `game_change`, which means it waits inside a steward's veto window instead of
 * executing the moment the vote closes.
 *
 * That map states the trade in its own comment: misclassifying a Game change as
 * a token send "costs the village its window"; misclassifying a token send as a
 * Game change "costs it three days", and "only one of those is irreversible".
 * A settlement is monthly and a village losing three days of it loses nothing.
 * A settlement that nobody can stop after the vote closes is a month of the
 * village's income moving with no hand on the brake. So it waits, and a steward
 * can stop it, which is what a steward is for.
 *
 * The timing is passed as `at_acceptance` all the same, because the OTHER
 * default — `next_moon` — would land each settlement a full cycle after the
 * village voted for it, and a village would spend every moon settling the moon
 * before last.
 */
import type { Pool } from "mysql2/promise";

import {
  CYCLE_SETTLEMENT,
  settlementModeFrom,
  settlementProposalDecision,
  settlementProposalDoc,
  settlementProposalTitle,
  settlementVoteDaysFrom,
  type FrozenShare,
} from "../../shared/moonSettlement";
import type { BallotMethod } from "../../shared/governanceEngine";
import type { WeightMode } from "./governanceWeights";
import {
  freezeCycleSplit,
  poolSettingNow,
  settleDueCycles,
  type SettlementDeps,
} from "./cycleSettlement";
import { dueCycles, unreadableCycleProblem } from "./gratitude-cycles";
import { openBallot, type BallotRow } from "./ballots";
import { tokenDef } from "./ledger";
import { stringVar } from "./variables";
import { cyclePoolProblem } from "./cyclePool";
import { recordEvent } from "./events";
import { settlementAsks } from "../repos/settlementBallots";

/** The dials, roll and weight snapshot a ballot freezes, gathered by the caller. */
export interface BallotSetup {
  method: BallotMethod;
  dials: { unityPct: number; quorumPct: number };
  snapshot: { mode: WeightMode; token?: string | null };
  electorate: Array<{ userId: string; weight: number }>;
  /**
   * Why this village cannot weigh a vote right now, or null.
   *
   * Every role ceremony that uses this same setup answers 409 on it and opens
   * nothing. A settlement must refuse for the same reason and it is easier to
   * get wrong here: a ceremony refuses in front of the person who pressed, and
   * a job refuses in front of nobody, so a dropped `tokenProblem` would have
   * meant a village voting its own money away on weights the engine had already
   * said it could not compute.
   */
  tokenProblem: string | null;
}

export interface MoonProposalDeps extends SettlementDeps {
  /**
   * The village's dials and frozen roll, from the same helper the role
   * ceremonies use. Taken as a function rather than a value because a job runs
   * on a timer and must read the village as it is at the tick, not as it was at
   * boot.
   */
  ballotSetup(): Promise<BallotSetup>;
  /** Display names for the document, so a member reads people and not ids. */
  memberNames(): Promise<Map<string, string>>;
  /** Ring the frozen roll that a vote has opened. */
  tellRoll(ballot: BallotRow, title: string, body: string): Promise<unknown>;
  /**
   * Is the governance module on in this village? Injected rather than imported
   * so this module holds no opinion about how a village turns one on, and so a
   * test can run the whole decision without a module registry.
   */
  governanceOn(): boolean;
}

/**
 * WHO OPENED IT, when nobody did.
 *
 * `ballots.opened_by` is `varchar(64) NOT NULL` with no foreign key, so this is
 * a legal value and not a smuggled member. It is deliberately not a founder's
 * id: attributing a machine's question to a person would put a name on the one
 * act in this feature that has no human behind it, and the whole point of the
 * design is that the human part happens later, in the voting.
 */
export const MOON_PROPOSER = "sys:moon";

export interface ProposalRun {
  posted: boolean;
  why: string;
  ballotId?: string;
  cycleId?: string;
  cycleNumber?: number;
}

/**
 * ONE TICK OF THE MOON PROPOSER.
 *
 * Never throws for an ordinary refusal: a scheduler that throws on "nothing to
 * do" fills a log with failures that are not failures, and `why` is the honest
 * sentence for every path that does not post.
 */
export async function runMoonProposal(deps: MoonProposalDeps): Promise<ProposalRun> {
  const mode = settlementModeFrom(stringVar("cycle.settlement_mode"));

  const cycles = await deps.cyclesRepo.all();
  const entries = await deps.gratitudeRepo.all();
  /*
   * The same refusal the close and the preview make, in the same place: before
   * any total is computed. A moon this build cannot read is a moon whose split
   * would be silently short, and a ballot on a short split is worse than no
   * ballot at all.
   */
  const unreadable = unreadableCycleProblem(entries);
  if (unreadable) return { posted: false, why: unreadable };

  const due = dueCycles(cycles, entries, new Date());
  const asks = await settlementAsks(deps.getPool(), due.map((c) => c.id));
  const decision = settlementProposalDecision({ mode, governanceOn: deps.governanceOn(), due, asks });
  if (!decision.post) return { posted: false, why: decision.why };

  const cycle = due.find((c) => c.id === decision.cycleId);
  if (!cycle) return { posted: false, why: "The moon chosen to propose is no longer due." };

  const pool = poolSettingNow();
  /*
   * A MISCONFIGURED POOL STOPS THE ASK, NOT THE PAYMENT.
   *
   * The close refuses on this sentence too, but refusing there means an admin
   * meets it at the moment they press. Refusing HERE means the village is never
   * shown a ballot whose numbers came out of a broken setting, which is the
   * only place the refusal is worth anything: a member cannot un-read a
   * document that promised them a share of a pool that does not exist.
   */
  const poolProblem = cyclePoolProblem(pool.size, pool.token);
  if (poolProblem) return { posted: false, why: poolProblem };

  const setup = await deps.ballotSetup();
  if (setup.tokenProblem) return { posted: false, why: setup.tokenProblem };

  const eligible = await deps.eligibleSenderIds();
  const reversed = await deps.gratitudeRepo.reversedIds();
  // THE FREEZE. Everything below reads these rows, and so does the payment.
  // Undone gifts are left out here, so the document never shows a share for them.
  const persisted = await freezeCycleSplit(deps, cycle, entries, eligible, reversed, pool);

  const names = await deps.memberNames();
  const shares: FrozenShare[] = persisted
    .map((d) => ({
      name: names.get(String(d.userId)) ?? "A member",
      received: Number(d.received) || 0,
      distinctSenders: Number(d.distinctSenders) || 0,
      credited: Number(d.credited ?? 0),
    }))
    .sort((a, b) => b.credited - a.credited || b.received - a.received);

  const docToken = persisted.find((d) => (d as any).poolToken)?.poolToken ?? pool.token;
  const title = settlementProposalTitle(cycle.cycleNumber);
  const doc = settlementProposalDoc({
    cycleNumber: cycle.cycleNumber,
    startsAt: String(cycle.startsAt),
    endsAt: String(cycle.endsAt),
    poolToken: String(docToken),
    tokenName: tokenDef(String(docToken))?.name ?? String(docToken),
    currencyName: deps.currencyNameLower(),
    shares,
  });

  const opened = await openBallot(deps.getPool(), {
    subjectType: CYCLE_SETTLEMENT,
    subjectRef: cycle.id,
    title,
    docMarkdown: doc,
    method: setup.method,
    weightMode: setup.snapshot.mode,
    weightToken: setup.snapshot.token ?? null,
    unityPct: setup.dials.unityPct,
    quorumPct: setup.dials.quorumPct,
    durationDays: settlementVoteDaysFrom(stringVar("cycle.settlement_vote_days")),
    openedBy: MOON_PROPOSER,
    electorate: setup.electorate,
    // See this file's header: at_acceptance so it lands three days after the
    // vote rather than a whole cycle later, and it stays vetoable.
    timing: "at_acceptance",
  });

  if (!opened.ok) return { posted: false, why: opened.error };

  const credited = shares.reduce((n, s) => n + s.credited, 0);
  await deps.tellRoll(
    opened.ballot,
    title,
    credited > 0
      ? `The moon has ended. Passing this releases ${credited} ${tokenDef(String(docToken))?.name ?? docToken} to the people who were thanked.`
      : "The moon has ended. Passing this settles the record; no value moves either way.",
  );
  await recordEvent(deps.getPool(), {
    kind: "cycle",
    text: `The end of cycle ${cycle.cycleNumber} went to the village as a vote`,
    entityType: "ballot",
    entityRef: opened.ballot.id,
  });

  return {
    posted: true,
    why: `Cycle ${cycle.cycleNumber} went to the village.`,
    ballotId: opened.ballot.id,
    cycleId: cycle.id,
    cycleNumber: cycle.cycleNumber,
  };
}

/**
 * WHAT A PASSED SETTLEMENT DOES, and what every other outcome does.
 *
 * `settle` is the record-keeping half and runs for every outcome. It has
 * nothing to flip: a cycle row's status is `open` until it is `closed`, and a
 * ballot that failed leaves it exactly `open`, which is already true. So it
 * writes the fact into the trail and stops. That is not a stub — it is the
 * honest content of "the village said no to settling this moon": nothing
 * changes, and the reason it did not change is on the record.
 *
 * `execute` is the world-changing half and runs only when a PASSED decision is
 * due, after the steward's window has run. `onlyCycleId` is the promise: a
 * village that voted to settle cycle 330 has voted for that moon and no other.
 */
/*
 * TAKEN AS A FACTORY, NOT AS AN OBJECT.
 *
 * The closer table is built at boot, before `moonDeps` is initialised, so an
 * object handed over here would either be a temporal-dead-zone error or a
 * snapshot of the village as it stood at boot. Every dep is read at the moment
 * a decision lands instead, which is the same rule `landingDeps` holds: a
 * variable may have moved in the landing itself.
 */
export function settlementCloser(deps: () => MoonProposalDeps) {
  return {
    settle: async (b: BallotRow, outcome: string, outcomeNote: string) => {
      if (outcome !== "passed") {
        await recordEvent(deps().getPool(), {
          kind: "cycle",
          text: `The village did not settle ${b.subjectRef}: ${outcome}${outcomeNote ? ` (${outcomeNote})` : ""}`,
          entityType: "cycle",
          entityRef: b.subjectRef,
        });
      }
      return { applied: [], held: null, proposerTold: null };
    },
    execute: async (b: BallotRow) => {
      const result = await settleDueCycles(deps(), { onlyCycleId: b.subjectRef, actorUserId: null });
      if (!result.ok) {
        await deps().notifyAdmins(
          "governance",
          `A settlement the village passed could not land: ${b.title} (${result.error})`,
          `settle:${b.subjectRef}:failed`,
        );
        return { applied: [], held: result.error, proposerTold: null };
      }
      /*
       * A CYCLE THAT WAS ALREADY SETTLED IS NOT AN ERROR.
       *
       * `dueCycles` no longer lists a closed moon, so a founder who pressed
       * Close by hand while the vote was running leaves this with nothing to
       * do. The village's decision was not defeated; it was overtaken. Saying
       * so is better than reporting a landing that applied nothing.
       */
      if (result.report.closed.length === 0) {
        return { applied: [], held: "this moon had already been settled by the time the vote landed", proposerTold: null };
      }
      return {
        applied: [`settled ${b.subjectRef}`, `released ${result.report.poolCredited}`],
        held: null,
        proposerTold: null,
      };
    },
  };
}
