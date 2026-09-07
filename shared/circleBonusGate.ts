/**
 * WHETHER A CIRCLE'S PERIOD CAN BE JUDGED AT ALL, AND BY WHOM.
 *
 * A founder ruling: a circle earns a bonus when two things are both true. It
 * finished under its cap, which `shared/circleBurn.ts` already measures, and
 * THE VILLAGE VOTED THAT ITS WORK WAS COMPLETED. The second half is a human
 * answer to a yes-or-no question, and it is what keeps a bonus off any formula
 * a circle could optimise.
 *
 * ── THIS FILE PAYS NOTHING, AND THAT IS THE DESIGN AND NOT A GAP ────────────
 *
 * There is no amount here, no percentage, no share of unspent room, and no
 * field a caller can read as "yes, pay them". The one aggregate this file
 * produces is `blocking`, a list of REASONS A BONUS CANNOT BE CONSIDERED YET.
 * A refusal list can only ever say no, so an empty one is the absence of an
 * objection and never an authorisation. Whoever decides reads the three
 * components and decides.
 *
 * A composite score would have destroyed the information as well as inviting
 * the optimisation: a circle that delivered a great deal cheaply and one that
 * delivered little expensively can land on the same number. The three parts
 * stay apart and each carries its own state.
 *
 * ── THE THREE COMPONENTS, AND WHY THE FIRST ONE IS FIRST ───────────────────
 *
 *   COMMITMENT  what this circle said it would do in this period, written down
 *               while the period could still be shaped.
 *   VOTE        what the village answered when it was asked whether that was
 *               completed.
 *   SPEND       where the circle's issuance landed against its cap, from
 *               `burnFor`.
 *
 * The commitment is first because the vote is meaningless without it. "Did
 * this circle complete its work" is unanswerable unless the work was recorded
 * at the start; otherwise the question is a mood, and a village a few seasons
 * in votes on a memory. That is why `CommitmentState` separates `retrospective`
 * from `recorded`: a statement written after the period ended describes what
 * somebody remembers, and it is a weaker thing than a promise.
 *
 * ── WHY THE VOTE POINTS AT THE RECORD AND NOT AT THE CIRCLE ────────────────
 *
 * `ballots.subject_ref` is varchar(64), `circles.id` is varchar(64) and
 * `circle_budgets.season_id` is varchar(64), all three measured on a migrated
 * schema. A key naming a circle AND a period is 129 characters before any
 * prefix, so no encoding of the pair fits and shortening a prefix is not a
 * fix. `server/lib/circleBurn.ts` hit the same wall one column over and
 * resolved it by deriving the period from the instant, which works for a
 * ledger row and does not work here: a completion vote about a season opens
 * AFTER that season has ended, so its own instant falls in the next one.
 *
 * So the ballot's subject is the COMMITMENT RECORD, which has an id of its
 * own. That is what every other ballot subject already does: a mechanics
 * ballot points at a proposal, a seating ballot points at a role. It also
 * makes one thing plain that is easy to read as two problems. A village with
 * no written commitment has nothing for the ballot to point AT, so the missing
 * record and the missing vote are one gap and not two.
 *
 * ── WHO VOTES IS NOT DECIDED HERE, AND THE ELECTORATE IS A PARAMETER ───────
 *
 * A circle voting yes on its own completion to release its own bonus has the
 * same shape as a circle voting itself a bigger budget, and that was ruled a
 * village decision. This file therefore reports the roll a vote ACTUALLY used,
 * read off the frozen ballot, and chooses nothing. `circleRollProblem` carries
 * the reason the circle-scoped option cannot be selected today, in the words
 * of the migration that removed it.
 *
 * ── WHAT THIS READING CANNOT SEE ───────────────────────────────────────────
 *
 * `BLIND_SPOT` rides on every reading, and it is on the surface and not only
 * in a report. A circle whose work is care, mediation or hosting leaves almost
 * nothing behind that any of these three components counts, and a reader who
 * takes a thin record as evidence of a thin season would be doing that circle
 * an injustice. It is a constant, so no branch can drop it.
 */

import type { CircleBurnReading } from "./circleBurn";

// ── The commitment ──────────────────────────────────────────────────────────

/**
 * What a circle said it would do in one period, as the village wrote it down.
 *
 * `id` IS THE POINT OF THIS SHAPE. It is what a completion ballot names as its
 * subject, which is how the period travels with the vote without composing a
 * key that does not fit. See the header.
 */
export interface CommitmentRecord {
  id: string;
  circleId: string;
  /** The period this covers, in whatever the village keys periods by. */
  periodId: string;
  /** The period's own bounds, as instants. */
  startsAt: string;
  endsAt: string;
  /** What was written, in the village's own words. Never summarised here. */
  statement: string;
  /** When it was recorded. A record written late is a different fact. */
  recordedAt: string;
}

export type CommitmentState =
  /** Nothing was written down for this circle and this period. */
  | "none"
  /**
   * Written after the period had ended.
   *
   * It is a real record and it is not a promise. A statement composed once the
   * season is over describes what somebody remembers, and a vote on it asks
   * the village to agree with a memory. Reported apart so a surface cannot
   * render it with the sentence that renders a commitment made in advance.
   */
  | "retrospective"
  /** Written while the period could still be shaped by it. */
  | "recorded";

export interface CommitmentComponent {
  state: CommitmentState;
  /** The record's id, which is the ballot's subject. Null when there is none. */
  recordId: string | null;
  periodId: string | null;
  statement: string | null;
  recordedAt: string | null;
}

// ── The vote ────────────────────────────────────────────────────────────────

/**
 * WHICH ROLL A COMPLETION VOTE WAS PUT TO.
 *
 * A parameter and never a default. This build can only produce `village`,
 * because a circle has no roll to scope one from; `circleRollProblem` says why
 * in the words of the migration that removed the column.
 */
export type CompletionElectorate = "village" | "circle";

export type VoteState =
  /** There is a record and nobody has been asked about it. */
  | "never_asked"
  /** A vote is running now. An answer exists later, and does not exist yet. */
  | "open"
  /** Asked and taken back before it closed. No answer was ever produced. */
  | "withdrawn"
  /**
   * Asked, closed, and too few of the roll took part for the answer to stand.
   *
   * A separate state from `said_no` on purpose. Silence is not a refusal, and
   * a surface that renders the two the same tells a circle the village judged
   * its work when the village did not turn up.
   */
  | "no_quorum"
  /** Asked and answered: the work was not completed. */
  | "said_no"
  /** Asked and answered: the work was completed. */
  | "said_yes";

export interface VoteComponent {
  state: VoteState;
  ballotId: string | null;
  /** Heads on the roll the ballot FROZE at open, never a live count. */
  onTheRoll: number | null;
  /** The sum of that roll's weights, which is what quorum is measured against. */
  rollWeight: number | null;
  closedAt: string | null;
  /** The stated outcome the closer wrote. A human sentence, kept verbatim. */
  outcomeNote: string | null;
  /**
   * How many times this record has been put to a vote.
   *
   * A circle asked once and a circle asked three times are different facts,
   * and the second one is invisible if only the latest answer is reported.
   */
  attempts: number;
  /**
   * Which roll answered. Read off the ballot, chosen by nobody here.
   *
   * Null when no vote exists. See `ELECTORATE_UNDECIDED` for the ruling this
   * reading is deliberately not making.
   */
  judgedBy: CompletionElectorate | null;
}

/**
 * The ruling this reading refuses to make, said once so every surface can
 * print the same sentence.
 */
export const ELECTORATE_UNDECIDED =
  "Who votes on a circle's completion has not been decided. This reading names the roll a vote actually used and chooses nothing about which roll it should be.";

/**
 * Why a completion vote cannot be put to the circle alone today, or null when
 * it can.
 *
 * The reason is the codebase's own and it is quoted from `drizzle/0095`, which
 * removed `ballots.circle_id` for exactly this: circles are pointed AT by two
 * separate planes, permission groups from 0018 and org seats from 0049, and
 * neither of them is a roll. Freezing a village-wide electorate onto a ballot
 * labelled with a circle would be a wrong electorate wearing a right label,
 * and the snapshot law would then hold that wrongness forever.
 */
export function circleRollProblem(electorate: CompletionElectorate): string | null {
  if (electorate !== "circle") return null;
  return (
    "This village has no membership of a circle to build a roll from. Circles are pointed at by " +
    "permission groups and by org seats, and neither of those is a list of who votes. A circle " +
    "roll has to be defined before a vote can be put to one."
  );
}

// ── The spend ───────────────────────────────────────────────────────────────

export type SpendState =
  /** The resources module is off, so no circle has a cap at all. */
  | "module_off"
  /**
   * No envelope exists for this circle.
   *
   * Its own state, for the reason `shared/circleBurn.ts` gives: rendered as a
   * zero it reads as reassuring and it means the opposite. Nothing caps what
   * this circle may issue, so there is no cap it could have finished under.
   */
  | "ungoverned"
  /** A real cap this meter cannot count against, so no claim is made. */
  | "unmeasurable"
  /** An envelope with no cap in the scope asked about. */
  | "no_cap"
  /** Spend stayed below the cap. */
  | "under_cap"
  /**
   * Spend reached the cap.
   *
   * NOT A FAILURE AND NOT A JUDGEMENT. A circle that spent its whole envelope
   * and finished its work has done nothing wrong. It is reported because it is
   * one of the two facts the ruling names, and because a bonus taken out of
   * unspent room would have no room to come out of.
   */
  | "at_cap"
  /**
   * THIS CIRCLE RUNS ON A TREASURY AND HAS NO CAP AT ALL (0181).
   *
   * Its own state, and it arrived because `TreasuryReading` joining
   * `CircleBurnReading` broke this file at compile time. That is the gate
   * working: without it, `burn.binds` and `burn.cycle` would have been read off
   * a reading that carries neither, and a village would have been shown a
   * ceiling that does not exist.
   *
   * A treasury circle DOES have an unspent balance, and it is deliberately not
   * reported through `remainingMinor`. Room under a cap and tokens a circle
   * owns are different facts: the first vanishes when the period turns and the
   * second does not, so a bonus taken "out of unspent room" means something
   * else here. Whether a bonus may come out of a treasury at all is a ruling
   * nobody has made, so this blocks and says so.
   */
  | "treasury";

export interface SpendComponent {
  state: SpendState;
  /** Which cap this answers about. Null when no cap applied. */
  scope: "cycle" | "season" | null;
  capMinor: number | null;
  spentMinor: number | null;
  remainingMinor: number | null;
  unit: string | null;
}

// ── The reading ─────────────────────────────────────────────────────────────

/**
 * THE SENTENCE THAT RIDES EVERY READING.
 *
 * A constant, so no branch can drop it and no surface can decide it does not
 * apply this time. The first village to use this will have a circle whose work
 * is care, and a reading that showed that circle as thin would be unjust and
 * not merely incomplete.
 */
export const BLIND_SPOT =
  "This reading counts what the village wrote down. A circle whose work is care, mediation or " +
  "hosting can leave almost nothing here and still have carried the village through the season. " +
  "A thin record is not evidence of a thin season, and whoever votes has to weigh what they saw.";

export interface BonusGateReading {
  circleId: string;
  /** The period asked about, when the record names one. */
  periodId: string | null;
  /** The instant this answers for. For a finished period, its end. */
  takenAt: string;
  commitment: CommitmentComponent;
  vote: VoteComponent;
  spend: SpendComponent;
  /**
   * EVERY REASON A BONUS CANNOT BE CONSIDERED YET, in words, cheapest first.
   *
   * IT IS NOT AN AUTHORISATION AND AN EMPTY LIST IS NOT A YES. It is the
   * absence of a stated objection, and the decision stays with whoever votes.
   * There is deliberately no `eligible` field and no amount anywhere in this
   * shape.
   */
  blocking: string[];
  /** Always `BLIND_SPOT`. Carried on the reading so a surface cannot omit it. */
  blindSpot: string;
}

// ── Composing the three ─────────────────────────────────────────────────────

/** The spend component, read out of the burn reading and never recomputed. */
export function spendComponent(burn: CircleBurnReading): SpendComponent {
  const blank = { scope: null, capMinor: null, spentMinor: null, remainingMinor: null, unit: null };
  if (burn.kind === "module_off") return { state: "module_off", ...blank };
  if (burn.kind === "ungoverned") return { state: "ungoverned", ...blank, unit: burn.unit || null };
  /*
   * A TREASURY CARRIES NO CAP FIELD, so every figure below stays null. The
   * balance is real and it is read from `TreasuryReading`, never from here:
   * putting it in `remainingMinor` would let a surface print tokens a circle
   * owns as room it has left in a window.
   */
  if (burn.kind === "treasury") return { state: "treasury", ...blank, unit: burn.unit || null };

  /*
   * WHICHEVER CAP BINDS IS THE ONE A BONUS QUESTION IS ABOUT. `binds` already
   * answers "which one runs out first", and re-deriving it here would be a
   * second copy of an arithmetic that has one home.
   */
  const bound = burn.binds === "cycle" ? burn.cycle : burn.binds === "season" ? burn.season : null;
  if (!bound) {
    const unmeasured = [burn.cycle, burn.season].some((c) => c.state === "unmeasurable");
    return {
      state: unmeasured ? "unmeasurable" : "no_cap",
      ...blank,
      unit: burn.unit || null,
    };
  }
  if (bound.state === "unmeasurable") {
    return { state: "unmeasurable", scope: bound.scope, capMinor: bound.capMinor, spentMinor: null, remainingMinor: null, unit: burn.unit || null };
  }
  if (bound.state === "no_cap" || bound.state === "no_window") {
    return { state: "no_cap", scope: bound.scope, capMinor: null, spentMinor: null, remainingMinor: null, unit: burn.unit || null };
  }
  return {
    state: bound.state === "exhausted" ? "at_cap" : "under_cap",
    scope: bound.scope,
    capMinor: bound.capMinor,
    spentMinor: bound.spentMinor,
    remainingMinor: bound.remainingMinor,
    unit: burn.unit || null,
  };
}

/** The commitment component, and the one comparison that dates it. */
export function commitmentComponent(record: CommitmentRecord | null): CommitmentComponent {
  if (!record) {
    return { state: "none", recordId: null, periodId: null, statement: null, recordedAt: null };
  }
  const recorded = Date.parse(record.recordedAt);
  const ends = Date.parse(record.endsAt);
  /*
   * AN UNPARSEABLE INSTANT IS TREATED AS LATE, on purpose. The two states
   * differ in how much a vote on the record is worth, so the direction to fail
   * in is the one that claims less.
   */
  const late = !Number.isFinite(recorded) || !Number.isFinite(ends) || recorded >= ends;
  return {
    state: late ? "retrospective" : "recorded",
    recordId: record.id,
    periodId: record.periodId,
    statement: record.statement,
    recordedAt: record.recordedAt,
  };
}

export interface GateInput {
  circleId: string;
  takenAt: string;
  record: CommitmentRecord | null;
  vote: VoteComponent;
  burn: CircleBurnReading;
}

/**
 * The three components side by side, plus the reasons a decision cannot rest
 * on them yet.
 *
 * ORDER MATTERS IN `blocking` AND THE ORDER IS CAUSAL. A missing record is
 * why there is no vote, so it is named first and the vote's own absence is not
 * repeated underneath it. A reader who fixes the first line gets a different
 * second line, which is what makes the list actionable.
 */
export function bonusGate(input: GateInput): BonusGateReading {
  const commitment = commitmentComponent(input.record);
  const spend = spendComponent(input.burn);
  const blocking: string[] = [];

  if (commitment.state === "none") {
    blocking.push(
      "Nothing records what this circle took on for this period, so there is nothing for a " +
        "completion vote to be about. Write the commitment down while the period is still ahead.",
    );
  } else if (commitment.state === "retrospective") {
    blocking.push(
      "What this circle took on was written down after the period had ended, so a vote on it " +
        "asks the village to agree with a memory.",
    );
  }

  if (commitment.state !== "none") {
    if (input.vote.state === "never_asked") {
      blocking.push("The village has not been asked whether this circle completed its work.");
    } else if (input.vote.state === "open") {
      blocking.push("The completion vote is still running, so there is no answer yet.");
    } else if (input.vote.state === "withdrawn") {
      blocking.push("The completion vote was withdrawn before it closed, so it produced no answer.");
    } else if (input.vote.state === "no_quorum") {
      blocking.push(
        "Too few of the roll took part for the completion vote to stand. Silence is not a refusal, " +
          "and the village has not answered.",
      );
    } else if (input.vote.state === "said_no") {
      blocking.push("The village voted that this circle did not complete its work.");
    }
  }

  if (spend.state === "module_off") {
    blocking.push(
      "This village keeps no circle budgets, so there is no cap this circle could have finished under.",
    );
  } else if (spend.state === "ungoverned") {
    blocking.push(
      "No envelope has been set for this circle. Nothing caps what it may issue, so " +
        "\"finished under its cap\" has nothing to measure against.",
    );
  } else if (spend.state === "unmeasurable") {
    blocking.push(
      "This circle's cap is in a unit this meter does not read, so what it spent is unknown here " +
        "and a zero would be a claim nobody checked.",
    );
  } else if (spend.state === "no_cap") {
    blocking.push(
      "This circle has an envelope with no cap over this window, so there is no ceiling it could " +
        "have stayed under.",
    );
  } else if (spend.state === "treasury") {
    blocking.push(
      "This circle runs on a treasury, so it holds tokens instead of a cap and there is no " +
        "ceiling it could have finished under. What it did not spend it still has, and whether " +
        "a bonus may come out of that is a question the village has not answered.",
    );
  }

  return {
    circleId: input.circleId,
    periodId: commitment.periodId,
    takenAt: input.takenAt,
    commitment,
    vote: input.vote,
    spend,
    blocking,
    blindSpot: BLIND_SPOT,
  };
}

// ── The sentences ───────────────────────────────────────────────────────────

/** How a surface names a circle and spells an amount. Injected, as elsewhere. */
export interface GateWords {
  circleName: (circleId: string) => string;
  amount: (minor: number, unit: string) => string;
}

/**
 * ONE SENTENCE PER COMPONENT, AND THEY ARE WRITTEN APART.
 *
 * Five member-facing pages in this repository have already shipped with one
 * sentence covering a class of different facts, so nothing here shares a
 * branch with anything else. Each of these answers exactly one state.
 */
export function commitmentSentence(c: CommitmentComponent, words: GateWords, circleId: string): string {
  const name = words.circleName(circleId);
  if (c.state === "none") {
    return (
      `Nothing on record says what ${name} took on for this period. A completion vote needs ` +
      "something written down at the start, and this village has not written one."
    );
  }
  if (c.state === "retrospective") {
    return `What ${name} took on was written down after the period had ended, so it is a record of a memory.`;
  }
  return `${name} wrote down what it was taking on before the period ended, and that is what a completion vote answers about.`;
}

export function voteSentence(v: VoteComponent, words: GateWords, circleId: string): string {
  const name = words.circleName(circleId);
  if (v.state === "never_asked") return `Nobody has been asked whether ${name} completed what it took on.`;
  if (v.state === "open") return `The village is being asked now whether ${name} completed what it took on.`;
  if (v.state === "withdrawn") return `The vote on ${name}'s work was withdrawn before it closed, so no answer came of it.`;
  if (v.state === "no_quorum") {
    const roll = v.onTheRoll === null ? "the roll" : `the ${v.onTheRoll} on the roll`;
    return `Too few of ${roll} answered for the vote on ${name}'s work to stand. The village has not said either way.`;
  }
  if (v.state === "said_no") return `The village voted that ${name} did not complete what it took on.`;
  return `The village voted that ${name} completed what it took on.`;
}

export function spendSentence(s: SpendComponent, words: GateWords, circleId: string): string {
  const name = words.circleName(circleId);
  const unit = s.unit ?? "";
  if (s.state === "module_off") return "This village is not keeping circle budgets, so no circle has a cap.";
  if (s.state === "ungoverned") return `No envelope has been set for ${name}, so nothing caps what it may issue.`;
  if (s.state === "unmeasurable") {
    return `${name} has a cap in ${unit}, and this meter reads the token ledger, so what it spent is not counted here.`;
  }
  if (s.state === "no_cap") return `${name} has no cap over this window.`;
  const spent = words.amount(s.spentMinor ?? 0, unit);
  const cap = words.amount(s.capMinor ?? 0, unit);
  if (s.state === "at_cap") {
    return `${name} issued all ${cap} of its ${s.scope} room. There is none of that room left over.`;
  }
  const room = words.amount(s.remainingMinor ?? 0, unit);
  return `${name} issued ${spent} of its ${cap} ${s.scope} room, with ${room} unspent.`;
}
