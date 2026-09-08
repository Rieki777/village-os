/**
 * WHAT A CIRCLE IS PAID FOR FINISHING UNDER ITS CAP, AND WHY ONLY THAT MODE.
 *
 * Rye, ruling on the two budget modes at once:
 *
 *   "if that was the intention then we can just use the other route where the
 *   circle mints below the capacity they're meant to then N% of what they
 *   didn't mint can still come to them as a bonus"
 *
 * So the bonus belongs to the CAP and never to the treasury, and the reason is
 * the one difference between the two instruments. Under a cap, room a circle
 * did not use EVAPORATES when the period turns, so restraint costs the circle
 * everything it held back and the incentive runs the wrong way. Under a
 * treasury, what a circle did not spend it still has, so restraint has already
 * paid for itself and a bonus on top would pay twice for the same act.
 *
 * `boundaryEffect` in shared/circleTreasury.ts is where that difference lives,
 * and this file asks it instead of asking the mode. There is exactly one place
 * in this codebase that knows what a period boundary does to what a circle
 * has, and a third mode arriving later answers there.
 *
 * ── THIS FILE COMPUTES AN AMOUNT AND PAYS NOTHING ──────────────────────────
 *
 * `server/lib/circleBonus.ts` posts. Everything here is arithmetic over facts
 * somebody else measured, so a surface can show a circle what a bonus WOULD be
 * without anything moving, and so the amount can be tested without a ledger.
 *
 * ── IT SITS BEHIND A VERDICT IT DOES NOT MAKE ──────────────────────────────
 *
 * `shared/circleBonusGate.ts` says whether the village voted the work
 * complete, and its header is emphatic that an empty refusal list is the
 * absence of an objection and never an authorisation. This file honours that
 * by requiring the vote to have said YES out loud, on top of the refusal list
 * being empty. A gate that grew a fourth blocking condition and forgot to push
 * a sentence for it would otherwise pay a bonus through the gap.
 *
 * ── AND A VETO SETS THE WHOLE THING ASIDE ──────────────────────────────────
 *
 * Rye ruled that completion and bonus are ONE vote, and that a steward's veto
 * sets the whole thing aside INCLUDING the completion finding. So a veto is
 * not a second condition beside the vote: it removes the answer the vote gave.
 *
 * THE GATE DOES NOT EXPOSE ONE. `VoteComponent` in shared/circleBonusGate.ts
 * carries `state`, and `voteStateOf` in server/lib/circleBonusGate.ts builds
 * it from `ballots.status` alone, which stays `passed` through a veto. The
 * veto lives one column over, on `ballots.vetoed_at` (drizzle/0172) and in
 * `ballot_vetoes` (read by `vetoesFor` in server/lib/stewardship.ts), and
 * nothing carries it into the reading.
 *
 * So the verdict arrives here as a REQUIRED parameter with three members, and
 * `unknown` REFUSES rather than defaulting to "no veto". A caller that cannot
 * answer it has not proved a veto is absent, and paying on an unproved absence
 * is how a set-aside decision gets paid anyway. The day the gate grows a
 * `vetoed` vote state, this parameter is filled from the reading and no
 * arithmetic here moves.
 */

import { boundaryEffect, type BudgetMode } from "./circleTreasury";
import type { BonusGateReading } from "./circleBonusGate";

/**
 * The dial that holds N.
 *
 * Spelled here so the pure computation, the route and the tests all name one
 * string. `shared/circleBonus.test.ts` asserts the variables registry knows
 * this key, which is what stops a rename in `shared/gameVariables.ts` from
 * turning every bonus into a read that throws.
 */
export const BONUS_PCT_KEY = "resources.circle_cap_bonus_pct";

/**
 * WHETHER A STEWARD SET THE DECISION ASIDE.
 *
 * `unknown` is a member on purpose and it is the fail-closed one. See the
 * header: it says the reader could not answer, which is a different fact from
 * answering that no veto stands.
 */
export type VetoVerdict = "none" | "vetoed" | "unknown";

/** Everything a payer needs about an amount it may pay. */
export interface BonusAward {
  circleId: string;
  periodId: string | null;
  /** The unit the cap was declared in, which is the unit the bonus is paid in. */
  unit: string;
  /** Which cap the circle finished under. The binding one, from the gate. */
  scope: "cycle" | "season";
  capMinor: number;
  spentMinor: number;
  /** What the circle was entitled to issue and did not. The basis. */
  unmintedMinor: number;
  /** The share, as the village's dial holds it. */
  pct: number;
  /** The bonus, minor units, floored. Always above zero on this shape. */
  amountMinor: number;
}

export type BonusOutcome =
  /**
   * This circle runs on a treasury, so its unspent value already carries.
   *
   * Its own member and never a line in `blocked`, because it is the ruling and
   * not an obstacle: nothing a village does to this circle will make a bonus
   * payable while it holds a treasury, and a refusal list reads as a list of
   * things to go and fix.
   */
  | { kind: "carries_over"; reason: string }
  /** A steward set the completion decision aside. Nothing is owed. */
  | { kind: "vetoed"; reason: string }
  /** Whether a veto stands could not be read, so nothing is paid. */
  | { kind: "veto_unknown"; reason: string }
  /** The gate's own refusals, verbatim and in its own order. */
  | { kind: "blocked"; reasons: string[] }
  /** The village set the share to zero, so no bonus is ever paid here. */
  | { kind: "switched_off"; reason: string }
  /** The circle issued its whole cap. Nothing was held back to pay a share of. */
  | { kind: "no_room"; reason: string }
  /**
   * A real share of a real amount that floors to nothing at this precision.
   *
   * Its own member for the reason `decayVoice` counts the same case: a zero
   * posting is refused by the ledger, and folding this into `no_room` would
   * tell a circle that held money back that it held nothing back.
   */
  | { kind: "too_small"; reason: string; unmintedMinor: number }
  /** An amount, and permission from nobody. The payer still has to pay it. */
  | { kind: "payable"; award: BonusAward };

/** The compile-time gate. A seventh outcome fails to compile at the sentence. */
export function assertNoOtherOutcome(o: never): never {
  throw new Error(`unhandled circle bonus outcome: ${JSON.stringify(o)}`);
}

export interface BonusInput {
  /** The whole reading, read and never recomputed. */
  gate: BonusGateReading;
  /** The mode this circle is RUNNING at the instant asked about. */
  mode: BudgetMode;
  /** `resources.circle_cap_bonus_pct`, read by the caller after the stores load. */
  pct: number;
  /** Whether a steward set the decision aside. Required, and never defaulted. */
  veto: VetoVerdict;
}

/**
 * THE AMOUNT, OR THE REASON THERE IS NONE.
 *
 * The order of the refusals is the order of the rulings, and it is not
 * arbitrary. Which instrument this circle runs is decided first, because it
 * decides whether the question is even askable. The veto comes next, because
 * it sets aside the finding the rest of the reading is built on. Only then is
 * the gate's own refusal list read, and only then the arithmetic.
 */
export function bonusFor(input: BonusInput): BonusOutcome {
  const { gate, mode, pct, veto } = input;

  /*
   * THE ONE DIFFERENCE, ASKED ONCE. A treasury carries over, so the value the
   * circle held back is still the circle's and there is nothing to compensate.
   * `gate.spend.state` also reports `treasury` and pushes its own blocking
   * sentence; this branch is ahead of it so the answer is the ruling and never
   * a queue of things to fix.
   */
  if (boundaryEffect(mode) === "carries") {
    return {
      kind: "carries_over",
      reason:
        "This circle runs on a treasury, so what it did not spend it still holds when the " +
        "period turns. A bonus pays back room that disappears at a boundary, and this " +
        "circle's value stays issued and stays its own.",
    };
  }

  if (veto === "vetoed") {
    return {
      kind: "vetoed",
      reason:
        "A steward vetoed the decision that this circle completed its work. The veto sets the " +
        "whole thing aside, the completion finding included, so there is no answer for a bonus " +
        "to stand on.",
    };
  }
  if (veto === "unknown") {
    return {
      kind: "veto_unknown",
      reason:
        "Whether a steward set this decision aside could not be read, and an unread veto is " +
        "not an absent one. Nothing is paid until the veto stands or is shown to be absent.",
    };
  }

  if (gate.blocking.length > 0) {
    return { kind: "blocked", reasons: [...gate.blocking] };
  }

  /*
   * AN EMPTY REFUSAL LIST IS NOT A YES, and the gate's own header says so. The
   * village has to have ANSWERED, out loud, in the affirmative. Without this
   * line a blocking condition somebody forgot to push a sentence for would be
   * an authorisation.
   */
  if (gate.vote.state !== "said_yes") {
    return {
      kind: "blocked",
      reasons: [
        "The village has not voted that this circle completed its work, so there is no answer " +
          "a bonus can be paid on.",
      ],
    };
  }

  if (!(pct > 0)) {
    return {
      kind: "switched_off",
      reason:
        "This village pays no share of unspent room back to a circle. The completion vote " +
        "still stands as the village's answer about the work.",
    };
  }

  const spend = gate.spend;
  /*
   * EVERY OTHER SPEND STATE IS ALREADY IN `blocking`, which the branch above
   * returned on. Reaching here with anything but a measured cap would mean the
   * gate stopped pushing a sentence for a state, so this refuses by name
   * instead of computing over nulls.
   */
  if (spend.state !== "under_cap" && spend.state !== "at_cap") {
    return {
      kind: "blocked",
      reasons: [
        `This circle's spend reads ${JSON.stringify(spend.state)}, which is not a cap a bonus ` +
          "can be measured against.",
      ],
    };
  }
  if (spend.scope === null || spend.capMinor === null || spend.spentMinor === null || spend.remainingMinor === null) {
    return {
      kind: "blocked",
      reasons: [
        "This circle's cap carries no figures to measure a bonus against, so nothing is paid.",
      ],
    };
  }

  const unmintedMinor = Math.max(0, Math.trunc(spend.remainingMinor));
  if (unmintedMinor === 0) {
    return {
      kind: "no_room",
      reason:
        "This circle issued its whole cap. A bonus is a share of what a circle did not mint, " +
        "and there is none of that here. Spending a whole envelope on the work is not a " +
        "failure and this reading is not a judgement.",
    };
  }

  /*
   * FLOOR AND NEVER ROUND, the same decision `decayVoice` records one module
   * over. Rounding up pays MORE than the published share, and issuing above a
   * stated rate is the one direction that must never happen. It also makes
   * "too small to pay" a counted fact instead of a unit quietly invented.
   *
   * AND THE SHARE IS CLAMPED TO 100, WHICH THE REGISTRY CANNOT GUARANTEE.
   * `validateVariable` bounds this dial at 100 on every path an admin or a
   * passed proposal can reach, and a hand-written `game_variables` row reaches
   * none of them. `server/lib/variables.ts` records that a hand-written row is
   * the only way past the write guard, and `decayVoice` fails closed against
   * exactly the same hole. A share above 100 would pay a circle more than it
   * held back, which is a cap turned inside out.
   */
  const share = Math.min(100, pct);
  const amountMinor = Math.floor((unmintedMinor * share) / 100);
  if (amountMinor <= 0) {
    return {
      kind: "too_small",
      reason:
        `A share of ${share}% of what this circle held back floors to nothing at this token's ` +
        "precision, so there is no posting to make. The room was held back and the share of " +
        "it is smaller than the smallest unit this token has.",
      unmintedMinor,
    };
  }

  return {
    kind: "payable",
    award: {
      circleId: gate.circleId,
      periodId: gate.periodId,
      unit: spend.unit ?? "",
      scope: spend.scope,
      capMinor: spend.capMinor,
      spentMinor: spend.spentMinor,
      unmintedMinor,
      pct: share,
      amountMinor,
    },
  };
}

/**
 * ONE SENTENCE PER OUTCOME, WRITTEN APART.
 *
 * Seven facts about a circle's period, and five member-facing pages in this
 * repository have already shipped with one sentence covering a class like
 * this. `words` is injected for the same reason it is everywhere else here: a
 * token a village calls Seeds must never be printed as `token:seeds`.
 */
export interface BonusWords {
  circleName: (circleId: string) => string;
  amount: (minor: number, unit: string) => string;
}

export function bonusSentence(outcome: BonusOutcome, words: BonusWords, circleId: string): string {
  const name = words.circleName(circleId);
  switch (outcome.kind) {
    case "carries_over":
    case "vetoed":
    case "veto_unknown":
    case "switched_off":
    case "no_room":
      return `${name}: ${outcome.reason}`;
    case "too_small":
      return `${name}: ${outcome.reason}`;
    case "blocked":
      return `${name} has ${outcome.reasons.length} thing(s) standing before a bonus: ${outcome.reasons[0]}`;
    case "payable": {
      const a = outcome.award;
      return (
        `${name} issued ${words.amount(a.spentMinor, a.unit)} of its ${words.amount(a.capMinor, a.unit)} ` +
        `${a.scope} room and held back ${words.amount(a.unmintedMinor, a.unit)}. At ${a.pct}% that is ` +
        `a bonus of ${words.amount(a.amountMinor, a.unit)}, which is newly minted and meets this ` +
        "village's issuance cap for the cycle it is paid in."
      );
    }
    default:
      return assertNoOtherOutcome(outcome);
  }
}
