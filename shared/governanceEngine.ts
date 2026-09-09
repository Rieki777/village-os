/**
 * The decision engine's math (round 5, lane G1). Pure, both ways: the same
 * unity and quorum a ballot page previews are the ones the close route
 * evaluates, because they are one function each, imported by both sides —
 * the shared/power.ts posture applied to arithmetic.
 *
 * The math is Hypha 2.0's exactly (dho-web-client, Apache 2.0, founder-owned;
 * src/utils/proposal-parsing.js voting()/isAccepted(), harvest section 3):
 *
 *   unity  = (pass + fail > 0) ? passW / (passW + failW) : 0
 *   quorum = supply > 0 ? (abstain + pass + fail) / supply : 0
 *   passed = quorum >= quorumThreshold && unity >= unityThreshold
 *
 * Abstain is EXCLUDED from unity and COUNTS toward quorum: a genuine "help it
 * reach quorum without taking sides" instrument.
 *
 * Everything here evaluates against a ballot's own SNAPSHOT columns, never
 * live settings. That is the constitutional rule "A vote is counted against
 * the day it opened", and it is why every function takes the dials as
 * arguments instead of reading a registry.
 */

import type { DecidesById } from "./power";

/** The methods a ballot can conduct. `custom` is the village's own dials. */
export type BallotMethod = "majority" | "custom" | "consensus" | "consent";

export type BallotOutcome = "passed" | "failed" | "no_quorum";

export interface BallotTallies {
  /** Weighted sums read from ballot_votes joined to ballot_electorate. */
  yesW: number;
  noW: number;
  abstainW: number;
}

/** Unity as a percentage, 0-100. Abstain is excluded on purpose. */
export function unityPctOf(t: BallotTallies): number {
  const decided = t.yesW + t.noW;
  return decided > 0 ? (t.yesW / decided) * 100 : 0;
}

/**
 * What an abstention is, per subject (R68 tiering applied to the vote itself).
 *
 *   "counts_toward_quorum"  the Hypha rule, and the default for every subject:
 *                           an abstention says "I am here, I take no side", so
 *                           it helps a ballot reach quorum and is excluded
 *                           from unity.
 *   "no_answer"             the abstention is not an answer at all: it counts
 *                           toward neither quorum nor unity. A subject asks
 *                           for this when its own sentence is "everybody has
 *                           to say yes", because on such a subject the kind
 *                           reading of an abstention is that the question has
 *                           not been answered yet, and a question not yet
 *                           answered is a missed quorum rather than a refusal.
 *
 * The policy is a per-subject FACT, never a village dial, for the same reason
 * a method fixes what its own sentence fixes: the sentence "every seat votes
 * yes" and the sentence "an abstention carries" cannot both be true.
 */
export type AbstainPolicy = "counts_toward_quorum" | "no_answer";

/** Quorum as a percentage of the frozen total weight, 0-100. Abstain counts. */
export function quorumPctOf(
  t: BallotTallies,
  totalWeight: number,
  policy: AbstainPolicy = "counts_toward_quorum",
): number {
  if (!(totalWeight > 0)) return 0;
  const answered = t.yesW + t.noW + (policy === "no_answer" ? 0 : t.abstainW);
  return (answered / totalWeight) * 100;
}

/**
 * QUORUM COUNTED OVER LESS THAN THE WHOLE ROLL (19G).
 *
 * Some of a village's frozen weight sits on seats that are out of the quorum
 * arithmetic: a seat speaking for a being that is not a person, when the
 * village has said such a seat's weight is not part of the count. Both halves
 * of the fraction move together, which is the only shape that keeps the
 * percentage honest: taking weight out of the denominator alone would let a
 * ballot report more than 100% turnout, and taking it out of the numerator
 * alone would ask the votable seats to carry weight nobody could cast.
 *
 * The pair is handed in already worked out, because the seat facts live on the
 * server and the arithmetic lives here.
 */
export interface QuorumArithmetic {
  /** The weight that answered, counting only seats inside the quorum. */
  answeredWeight: number;
  /** The weight the answer is measured against. */
  baseWeight: number;
}

/** The same percentage as `quorumPctOf`, over a base that is not the whole roll. */
export function quorumPctOn(q: QuorumArithmetic): number {
  if (!(q.baseWeight > 0)) return 0;
  return (Math.max(0, q.answeredWeight) / q.baseWeight) * 100;
}

export interface EvaluateInput {
  method: BallotMethod;
  /** Snapshot dials from the ballot row, as percentages 0-100. */
  unityPct: number;
  quorumPct: number;
  /** Snapshot of SUM(electorate weights) at open. */
  totalWeight: number;
  tallies: BallotTallies;
  /** Consent mode: objections still standing `open`. Ignored elsewhere. */
  openObjections?: number;
  /** What an abstention is on this subject. Absent = the Hypha rule. */
  abstainPolicy?: AbstainPolicy;
  /**
   * How many people must vote yes, as HEADS rather than as weight. `"all"`
   * means every seat on the frozen roll. Absent means the subject asks
   * nothing of heads and the weighted arithmetic is the whole rule.
   */
  minYesHeads?: number | "all";
  /** The head counts, required whenever `minYesHeads` is set. */
  heads?: HeadCounts;
  /**
   * The quorum fraction when part of the frozen weight is out of the count
   * (19G). Absent means the whole frozen roll is the base, which is every
   * ballot in a village that has seated nobody for a non-human being.
   */
  quorum?: QuorumArithmetic;
}

/** Heads on a frozen roll: how many answered which way, and how many seats. */
export interface HeadCounts {
  yesHeads: number;
  noHeads: number;
  abstainHeads: number;
  /** `ballots.electorate_count`: the seats frozen at open. */
  electorateCount: number;
}

/**
 * How many yes HEADS this input needs, or null when it asks for none.
 *
 * Exported because the surface that previews a threshold has to say the same
 * number the close will check, and a second copy of this arithmetic on the
 * page is how the page starts promising something the engine does not do.
 */
export function requiredYesHeads(
  minYesHeads: number | "all" | undefined,
  electorateCount: number | undefined,
): number | null {
  if (minYesHeads === undefined) return null;
  if (minYesHeads === "all") return Math.max(0, Math.trunc(electorateCount ?? 0));
  const n = Math.trunc(minYesHeads);
  return n > 0 ? n : null;
}

/**
 * The one evaluation. Quorum is checked first for every method, so a vote
 * too few people showed up for reads as no_quorum instead of a verdict on
 * the question itself.
 *
 *   majority   unity strictly above 50: "More than half carries it."
 *   consensus  unity exactly 100 with at least one yes: everyone who voted
 *              (beyond abstentions) agrees.
 *   custom     unity at or above the snapshot unity_pct (the Hypha 80/20
 *              surface with the village's own numbers).
 *   consent    unity is not evaluated. Participation meets quorum and zero
 *              objections remain open (S3.0: only objections block).
 */
export function evaluateBallot(input: EvaluateInput): BallotOutcome {
  const abstain = input.abstainPolicy ?? "counts_toward_quorum";
  /*
   * The quorum fraction, from the caller's own pair when part of the frozen
   * weight sits outside the count (19G), and from the whole roll otherwise.
   * A base of zero reads as no quorum, which is the fail-closed answer: every
   * seat that could have carried this one is out of the arithmetic.
   */
  const quorum = input.quorum
    ? quorumPctOn(input.quorum)
    : quorumPctOf(input.tallies, input.totalWeight, abstain);
  if (quorum < input.quorumPct) return "no_quorum";
  /*
   * THE HEAD FLOOR, CHECKED IN THE ENGINE AND NOWHERE ELSE.
   *
   * Weight answers "how much of the village", heads answer "how many people",
   * and the founder's Birthing rule is written in people: at least three
   * different parties, and every one of them saying yes. A rule about heads
   * that lived in the route would be a second place a ballot can pass or
   * fail, and two places deciding one thing disagree eventually.
   *
   * A ballot that asks for heads and is handed none FAILS CLOSED rather than
   * quietly skipping the rule, because the alternative is a subject whose
   * stated rule is silently not conducted by the only function that decides.
   */
  const needYes = requiredYesHeads(input.minYesHeads, input.heads?.electorateCount);
  if (needYes !== null) {
    if (!input.heads) return "failed";
    if (input.heads.yesHeads < needYes) return "failed";
  }
  if (input.method === "consent") {
    return (input.openObjections ?? 0) === 0 ? "passed" : "failed";
  }
  const unity = unityPctOf(input.tallies);
  if (input.method === "majority") return unity > 50 ? "passed" : "failed";
  if (input.method === "consensus") {
    return input.tallies.noW === 0 && input.tallies.yesW > 0 ? "passed" : "failed";
  }
  return unity >= input.unityPct ? "passed" : "failed";
}

/**
 * Which ballot method a decides-by conducts, if any (GOV_DESIGN section 2.3).
 *
 *   "hypha"  routes to the existing to_hypha leg, unchanged — that is the
 *            whole degradation story, so it is a named answer, never null.
 *   null     no ballot: the named decider records the outcome themselves
 *            (lead/elders/founder decides, do-ocracy), or the mode is not in
 *            v1 (delegated), or the village wrote its own word (other).
 *
 * `custom` is not a `DecidesById` and is here anyway, because the SETTING this
 * reads from (`governance.default_method`) offers it: a circle says how it
 * decides in the vocabulary of shared/power.ts, and a village says how its
 * village-wide ballots decide in that vocabulary plus "this village's own
 * dials". One function answers both, which is the point of it existing.
 */
export function methodForDecidesBy(id: DecidesById | string): BallotMethod | "hypha" | null {
  switch (id) {
    case "majority":
      return "majority";
    case "consensus":
      return "consensus";
    case "consent":
      return "consent";
    case "custom":
      return "custom";
    case "hypha":
      return "hypha";
    default:
      return null;
  }
}

/**
 * The method a VILLAGE-WIDE ballot conducts, given `governance.default_method`.
 *
 * Every route that opens a village-wide ballot resolves the method through
 * here, so there is one rule and not one per route. The route that opened the
 * first ballot carried its own copy of this list inline, and a second route
 * (advisory) would have carried a third: two copies of one rule disagree
 * eventually, and in governance a disagreement about the method is a
 * disagreement about what passing means.
 *
 * Anything unrecognised falls to `custom`, which is the village's own unity
 * and quorum dials. That is the conservative answer: a stored value nobody
 * recognises should decide by the numbers the village actually set, never by
 * a preset those numbers were never checked against.
 */
export function villageBallotMethod(setting: string): BallotMethod | "hypha" {
  return methodForDecidesBy(String(setting ?? "")) ?? "custom";
}

export interface MethodDials {
  unityPct: number;
  quorumPct: number;
}

/**
 * The dials a method SNAPSHOTS at open, given the village's current settings.
 * Presets fix what the method's own sentence fixes and take the rest from the
 * village: majority is definitionally "more than half" (the stored 50 pairs
 * with evaluateBallot's strict comparison), consensus is definitionally
 * everyone, consent conducts no unity at all so it stores 0 and the evaluator
 * never reads it.
 */
export function dialsForMethod(method: BallotMethod, village: MethodDials): MethodDials {
  switch (method) {
    case "majority":
      return { unityPct: 50, quorumPct: village.quorumPct };
    case "consensus":
      return { unityPct: 100, quorumPct: village.quorumPct };
    case "consent":
      return { unityPct: 0, quorumPct: village.quorumPct };
    default:
      return { unityPct: village.unityPct, quorumPct: village.quorumPct };
  }
}

export const BALLOT_METHODS: readonly BallotMethod[] = ["majority", "custom", "consensus", "consent"];

export const VOTE_CHOICES = ["yes", "no", "abstain"] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

/**
 * ── CRITICALITY: HOW HARD A CHANGE IS TO MAKE, BY WHAT IT CHANGES ───────────
 *
 * The founder's ruling of 2026-09-02 (Q11): nothing is un-votable, and the
 * more critical a thing is the more of the village has to show up and agree
 * before it moves. So every setting carries a tier, and the tier names a pair
 * of dials the change cannot be decided below.
 *
 * Three tiers, and the names say what they mean rather than how they feel:
 *
 *   routine         a number the village tunes while it plays. The floor is
 *                   nothing, so the village's own unity and quorum decide, as
 *                   they always have.
 *   structural      it changes how the village decides or who belongs. 50 is
 *                   this engine's own constant, already the quorum a minting
 *                   rule asks for; 80 is the unity this platform inherited
 *                   from Hypha and ships as the default.
 *   constitutional  it changes the rules for changing the rules. 97 and 97
 *                   are the founder's own numbers, and his stated reason for
 *                   stopping at 97 is `stalemateWarning` below.
 *
 * These are FLOORS on the platform, exactly as `SUBJECT_THRESHOLDS` is: a
 * village raises them by setting its own tier dials higher and can never
 * lower them, because a village able to lower the bar for changing the bar
 * has no bar.
 */
export type Criticality = "routine" | "structural" | "constitutional";

/** Every tier, least demanding first. The order is the ladder. */
export const CRITICALITIES: readonly Criticality[] = ["routine", "structural", "constitutional"];

export const TIER_FLOORS: Readonly<Record<Criticality, MethodDials>> = {
  routine: { unityPct: 0, quorumPct: 0 },
  structural: { unityPct: 80, quorumPct: 50 },
  constitutional: { unityPct: 97, quorumPct: 97 },
};

/**
 * The highest tier in a list, or `routine` for an empty one.
 *
 * A change set is priced by its most critical element (Q9), so this is the
 * one place that answers "which of these is the hardest", and the ladder it
 * reads is `CRITICALITIES`.
 */
export function highestCriticality(tiers: readonly Criticality[]): Criticality {
  let best: Criticality = "routine";
  for (const t of tiers) {
    if (CRITICALITIES.indexOf(t) > CRITICALITIES.indexOf(best)) best = t;
  }
  return best;
}

/** The pair a floor never lowers: the higher of each dial, taken separately. */
export function raiseDials(base: MethodDials, floor: MethodDials): MethodDials {
  return {
    unityPct: Math.max(base.unityPct, floor.unityPct),
    quorumPct: Math.max(base.quorumPct, floor.quorumPct),
  };
}

/**
 * THE RECOMMENDED CEILING, AND WHY IT IS 97 AND NOT 100.
 *
 * The founder's words, 2026-09-02: a village may set its dials above 97, and
 * the Game warns it when it does, because the closer a threshold gets to 100
 * the likelier a stalemate becomes. One player dying suddenly or drifting
 * away can freeze a Game that a massive majority wants to continue, and the
 * frozen roll makes that literal: a member who leaves after a ballot opens
 * stays on the roll and cannot vote, so a 100% quorum is unreachable until
 * the vote is asked again.
 *
 * It is a WARNING and never a refusal. The village decides; the Game says
 * what it has seen.
 */
export const RECOMMENDED_CEILING_PCT = 97;

/**
 * The sentence shown beside a threshold set above the recommended ceiling, or
 * null when the number is at or below it.
 *
 * One sentence, held here, because the admin control that edits the dial and
 * the page that explains a subject both say it, and two copies of a warning
 * disagree about what it warns of.
 */
export function stalemateWarning(pct: number): string | null {
  if (!(Number(pct) > RECOMMENDED_CEILING_PCT)) return null;
  return (
    `Above ${RECOMMENDED_CEILING_PCT} the risk is a stalemate. ` +
    "The closer a threshold gets to 100, the more likely it is that one player who dies, leaves or simply stops playing " +
    "freezes a Game the rest of the village wants to continue, because the roll freezes when a vote opens and a member " +
    `who has gone still counts as a seat that has not answered. ${RECOMMENDED_CEILING_PCT} is the highest number this platform recommends.`
  );
}

/**
 * ── PEOPLE BESIDE WEIGHT, IN EVERY SENTENCE (19F) ───────────────────────────
 *
 * The founder's ruling of 2026-09-03: "Quorum SHOULD be pure token weight
 * (not counting people, unless it's 1-person-1-vote but we STILL SHOW PEOPLE
 * counts, even though the quorum is calculated by village-voice token
 * weight)." So the arithmetic below adds no second quorum and changes no
 * outcome. It answers the question a percentage cannot answer on its own:
 * how many of us is that, today, on this roll.
 *
 * The audit's fourth risk is what these sentences exist to make visible. At
 * 97% of the weight, a village where three people hold 97% of the weight is
 * asking three people; the same 97% on nine equal seats is asking all nine.
 * Both are true, both are consequences of pure weight, and a member reading
 * "97% quorum" learns neither. The village keeps its dials. The Game says
 * what the dials mean today.
 *
 * Everything here is pure and takes the roll as an argument, the same posture
 * the rest of this file holds: the surface that previews a bar and the close
 * that applies it read one arithmetic.
 */

/** One seat on a roll, as the people-and-weight arithmetic needs it. */
export interface WeighedSeat {
  weight: number;
  /**
   * This seat speaks for a being that is not a person (19G): a mountain, a
   * river, the wolves. Its vote is cast by the member or bot that holds the
   * seat. Absent means an ordinary member's seat, which is the safe reading
   * for any caller that has not resolved the roles plane.
   */
  nonHuman?: boolean;
  /**
   * Whether this seat can actually answer. `false` means the weight is
   * provably stranded: a seat speaking for a being with nobody holding it, or
   * one that has cast nothing for `governance.absent_cycles` cycles. Absent
   * means it can, because "we did not look" must never read as "it cannot".
   */
  canVote?: boolean;
}

/** The roll's whole weight, negatives floored at zero the way `openBallot` does. */
export function totalWeightOf(roll: readonly WeighedSeat[]): number {
  return roll.reduce((sum, seat) => sum + Math.max(0, Number(seat.weight) || 0), 0);
}

/**
 * ── WHOSE WEIGHT IS IN THE QUORUM, AND WHOSE IS NOT (19G) ───────────────────
 *
 * The founder brought voice for other beings from day one, and 19F made quorum
 * pure token weight. Put together with no third rule, a river holding a share
 * of the Voice adds its weight to every quorum denominator whether or not
 * anybody ever speaks for it, and four quiet seats holding a quarter of the
 * Voice put the constitutional tier permanently out of reach.
 *
 * `governance.nonhuman_in_quorum` decides which way a village reads it, and it
 * ships OFF, which excludes those seats:
 *
 *   excluded (the default)  a non-human seat's weight is out of the quorum
 *                           numerator AND denominator. Its cast vote still
 *                           counts toward unity, because unity asks what the
 *                           village that spoke decided, and the being spoke.
 *   included                the seat counts like any member's, and only weight
 *                           that provably cannot vote leaves the denominator:
 *                           a seat nobody holds, or one that has answered
 *                           nothing for `governance.absent_cycles` cycles.
 *
 * This is arithmetic telling the truth about a bar. It is not the tier
 * fallback 19F withdrew: no threshold moves, and a village that misses quorum
 * still misses it.
 */
export interface QuorumPolicy {
  /** `governance.nonhuman_in_quorum`. False, the default, excludes those seats. */
  nonHumanInQuorum: boolean;
}

export const DEFAULT_QUORUM_POLICY: QuorumPolicy = { nonHumanInQuorum: false };

/** Why a seat's weight sits outside the quorum, or `null` when it is inside. */
export type ExclusionReason = "speaks_for_a_being" | "cannot_vote";

/** Whether this seat's weight counts toward quorum, and why not when it does not. */
export function exclusionOf(seat: WeighedSeat, policy: QuorumPolicy): ExclusionReason | null {
  if (seat.nonHuman && !policy.nonHumanInQuorum) return "speaks_for_a_being";
  if (seat.canVote === false) return "cannot_vote";
  return null;
}

/** The quorum base for a roll, with the weight left out of it named. */
export interface QuorumBase {
  /** The roll's whole weight, every seat included. */
  totalWeight: number;
  /** The weight the quorum percentage is measured against. */
  baseWeight: number;
  /** The weight outside the quorum arithmetic. */
  excludedWeight: number;
  /** How many seats that weight sits on. */
  excludedPeople: number;
  /** Seats inside the quorum arithmetic. */
  votablePeople: number;
  /** Excluded because they speak for a being, when the village excludes those. */
  speaksForABeing: number;
  /** Excluded because the weight provably cannot answer. */
  cannotVote: number;
}

export function quorumBaseOf(
  roll: readonly WeighedSeat[],
  policy: QuorumPolicy = DEFAULT_QUORUM_POLICY,
): QuorumBase {
  const out: QuorumBase = {
    totalWeight: 0,
    baseWeight: 0,
    excludedWeight: 0,
    excludedPeople: 0,
    votablePeople: 0,
    speaksForABeing: 0,
    cannotVote: 0,
  };
  for (const seat of roll) {
    const w = Math.max(0, Number(seat.weight) || 0);
    out.totalWeight += w;
    const why = exclusionOf(seat, policy);
    if (why === null) {
      out.baseWeight += w;
      out.votablePeople += 1;
      continue;
    }
    out.excludedWeight += w;
    out.excludedPeople += 1;
    if (why === "speaks_for_a_being") out.speaksForABeing += 1;
    else out.cannotVote += 1;
  }
  return out;
}

/** The seats whose weight counts toward quorum, in roll order. */
export function votableSeats(
  roll: readonly WeighedSeat[],
  policy: QuorumPolicy = DEFAULT_QUORUM_POLICY,
): WeighedSeat[] {
  return roll.filter((seat) => exclusionOf(seat, policy) === null);
}

/** Whether every seat on the roll weighs the same, so the bar reads in heads. */
export function everySeatWeighsAlike(roll: readonly WeighedSeat[]): boolean {
  if (roll.length === 0) return false;
  const first = Math.max(0, Number(roll[0].weight) || 0);
  return roll.every((seat) => Math.max(0, Number(seat.weight) || 0) === first);
}

/**
 * The FEWEST people who can hold `pct` of the roll's weight, biggest holders
 * first. Null means the Game could not tell, which today has one cause: a
 * roll carrying no weight at all. Null is never "nobody", and every caller
 * renders the two differently, because "3 of 9" and "we cannot say" are
 * different facts and a page that shows 0 for both is lying about one.
 */
export function fewestHoldersFor(roll: readonly WeighedSeat[], pct: number): number | null {
  const total = totalWeightOf(roll);
  if (!(total > 0)) return null;
  const want = (Math.max(0, Number(pct) || 0) / 100) * total;
  if (want <= 0) return 0;
  const weights = roll
    .map((seat) => Math.max(0, Number(seat.weight) || 0))
    .sort((a, b) => b - a);
  let held = 0;
  for (let i = 0; i < weights.length; i += 1) {
    held += weights[i];
    // A hair of tolerance, because a percentage of a sum of floats lands just
    // under the sum often enough to turn "all nine" into "ten of nine".
    if (held >= want - 1e-9) return i + 1;
  }
  return weights.length;
}

/** What a pair of dials asks of THIS roll, counted in people and in weight. */
export interface PeopleAndWeight {
  /** Seats on the roll. */
  people: number;
  /** The roll's whole weight. */
  totalWeight: number;
  /** The bar these numbers describe. */
  dials: MethodDials;
  /** Fewest people who can meet the quorum bar, or null when it cannot be told. */
  fewestForQuorum: number | null;
  /** True when the quorum bar can only be met by every seat that can vote. */
  needsEveryone: boolean;
  /** True when every seat weighs the same, so weight and heads are one count. */
  equalWeights: boolean;
  /**
   * The quorum base and the weight outside it (19G). Every field is here even
   * when nothing is excluded, so a surface reads one shape and shows the
   * excluded clause only when there is one.
   */
  quorumBase: QuorumBase;
}

export function peopleAndWeightFor(
  dials: MethodDials,
  roll: readonly WeighedSeat[],
  policy: QuorumPolicy = DEFAULT_QUORUM_POLICY,
): PeopleAndWeight {
  const quorumBase = quorumBaseOf(roll, policy);
  /*
   * THE BAR IS MET BY SEATS INSIDE THE QUORUM AND BY NOBODY ELSE, so the
   * fewest-people count is worked out over those seats and over their own
   * share of the weight. Counting the whole roll here would answer a question
   * the arithmetic no longer asks and would name people who cannot help.
   */
  const inQuorum = votableSeats(roll, policy);
  const fewestForQuorum = fewestHoldersFor(inQuorum, dials.quorumPct);
  return {
    people: roll.length,
    totalWeight: quorumBase.totalWeight,
    dials,
    fewestForQuorum,
    needsEveryone:
      fewestForQuorum !== null && inQuorum.length > 0 && fewestForQuorum >= inQuorum.length,
    equalWeights: everySeatWeighsAlike(inQuorum),
    quorumBase,
  };
}

/** A percentage said the way a member reads one: 97, not 97.0000001. */
function pct(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return String(v);
}

const people = (n: number): string => (n === 1 ? "1 person" : `${n} people`);

/**
 * THE HONEST SENTENCE FOR A BAR: what it asks, in weight and in people.
 *
 * The founder's number stays the subject of the sentence, because the bar IS
 * a share of the weight. The people clause is the same fact said in the unit
 * a member lives in.
 */
/**
 * THE EXCLUDED CLAUSE, said beside the people count (19G and audit 2, item 90).
 *
 * Empty when every seat's weight is in the count, so the ordinary sentence is
 * exactly what it was. A village that has seated a being reads how much of the
 * Voice sits outside its own quorum arithmetic, every time it reads a bar.
 */
export function excludedWeightClause(base: QuorumBase): string {
  if (!(base.excludedWeight > 0) || base.excludedPeople === 0) return "";
  const share = base.totalWeight > 0 ? pct((base.excludedWeight / base.totalWeight) * 100) : "0";
  const seats =
    base.speaksForABeing > 0 && base.cannotVote === 0
      ? `${base.excludedPeople === 1 ? "One seat speaks" : `${base.excludedPeople} seats speak`} for a being that is not a person`
      : base.speaksForABeing === 0
        ? `${base.excludedPeople === 1 ? "One seat holds" : `${base.excludedPeople} seats hold`} weight that cannot answer`
        : `${base.excludedPeople} seats speak for beings that are not people or hold weight that cannot answer`;
  return ` ${seats}, holding ${share}% of the weight, and that weight is outside this count.`;
}

export function thresholdSentence(
  dials: MethodDials,
  roll: readonly WeighedSeat[],
  policy: QuorumPolicy = DEFAULT_QUORUM_POLICY,
): string {
  const r = peopleAndWeightFor(dials, roll, policy);
  const aside = excludedWeightClause(r.quorumBase);
  const bar =
    `${pct(dials.quorumPct)}% of the weight must show up and ` +
    `${pct(dials.unityPct)}% of the weight cast must agree`;
  if (r.people === 0) return `${bar}. Nobody holds a voice in this village yet, so there is no roll to count against.`;
  if (r.fewestForQuorum === null) {
    return `${bar}. Nobody on the roll of ${r.people} carries weight this count can reach today, so the Game cannot say how many people that is.${aside}`;
  }
  if (r.equalWeights) {
    return `${bar}. Today that is at least ${r.fewestForQuorum} of ${r.people} people, because every seat weighs the same.${aside}`;
  }
  return (
    `${bar}. Today that is at least ${r.fewestForQuorum} of ${r.people} people, because ` +
    `${people(r.fewestForQuorum)} hold ${pct(dials.quorumPct)}% of the weight.${aside}`
  );
}

/** Where a ballot stands, counted both ways. */
export interface ParticipationCounts {
  /** Rows on the ballot: how many of the roll have voted. */
  peopleVoted: number;
  /** Seats frozen at open (`ballots.electorate_count`). */
  people: number;
  /** The weight those rows carry. */
  weightVoted: number;
  /** The weight frozen at open (`ballots.total_weight`). */
  totalWeight: number;
  /**
   * The weight outside the quorum count (19G), when the ballot has any. Absent
   * means none was excluded, which is every ballot in a village that has
   * seated nobody for a being.
   */
  excluded?: QuorumBase;
}

/**
 * THE HONEST SENTENCE FOR A BALLOT'S STATE. "3 of 9 people voted, holding 97%
 * of the weight." One function, because the card, the decision page, the feed
 * post and the notification all say this and four copies would drift.
 */
export function participationSentence(c: ParticipationCounts): string {
  const votedPeople = Math.max(0, Math.trunc(c.peopleVoted));
  const roll = Math.max(0, Math.trunc(c.people));
  const head = `${votedPeople} of ${roll} ${roll === 1 ? "person" : "people"} voted`;
  const aside = c.excluded ? excludedWeightClause(c.excluded) : "";
  if (!(c.totalWeight > 0)) {
    return `${head}. The roll carries no weight today, so no share of it can be worked out.${aside}`;
  }
  const share = pct((Math.max(0, c.weightVoted) / c.totalWeight) * 100);
  return `${head}, holding ${share}% of the weight.${aside}`;
}

/**
 * THE STALEMATE WARNING THE ROLL FIRES, BESIDE THE ONE THE NUMBER FIRES.
 *
 * `stalemateWarning` above fires above 97 because the founder said 97 is as
 * high as he recommends. This one fires whenever the bar rounds to the whole
 * roll, which is the same danger arriving from the other direction: on nine
 * equal seats, 97% IS unanimity, and a village reading "97, and he said 97 is
 * fine" has been told nothing about its own arithmetic.
 *
 * It warns and never refuses, which is the founder's posture on this dial.
 */
export function wholeRollWarning(
  dials: MethodDials,
  roll: readonly WeighedSeat[],
  policy: QuorumPolicy = DEFAULT_QUORUM_POLICY,
): string | null {
  const r = peopleAndWeightFor(dials, roll, policy);
  if (!r.needsEveryone) return null;
  const asked = r.quorumBase.votablePeople;
  return (
    `At ${pct(dials.quorumPct)}% of the weight, every one of the ${asked} ` +
    `${asked === 1 ? "person" : "people"} this count reaches has to vote before it can pass. ` +
    "One member who dies, leaves or stops playing holds it there until the roll changes."
  );
}

/**
 * ── THE BAR AGAINST THE WEIGHT THAT ACTUALLY VOTES (audit 2, risks 11 and 90) ─
 *
 * `stalemateWarning` tests a number against 97, which is the founder's own
 * ceiling and stays exactly as he set it. It cannot see the failure the second
 * audit found: a village whose dials are all inside the recommended range, and
 * whose constitutional tier is still arithmetically out of reach because a
 * quarter of the Voice sits on seats that answer nothing.
 *
 * So this one computes instead of testing. The most quorum this roll can ever
 * reach is the weight inside the count as a share of the whole roll, and when
 * that maximum is under the bar, no turnout can carry a vote at this tier.
 *
 * It warns and never refuses, the same posture every other warning here holds.
 * The door out is the same one 19F left standing: withdraw and rewrite, or ask
 * again on a roll that has changed. It reintroduces no fallback.
 */
export function reachableQuorumWarning(
  dials: MethodDials,
  roll: readonly WeighedSeat[],
  policy: QuorumPolicy = DEFAULT_QUORUM_POLICY,
): string | null {
  const base = quorumBaseOf(roll, policy);
  if (!(base.totalWeight > 0)) return null;
  if (!(base.excludedWeight > 0)) return null;
  const reachable = (base.baseWeight / base.totalWeight) * 100;
  const bar = Number(dials.quorumPct) || 0;
  if (reachable >= bar) return null;
  return (
    `The most this bar can ever reach today is ${pct(reachable)}% of the weight, and it asks for ${pct(bar)}%. ` +
    `${base.excludedPeople === 1 ? "One seat holds" : `${base.excludedPeople} seats hold`} ` +
    `${pct(100 - reachable)}% of the Voice outside this count, so no turnout carries a decision at this bar. ` +
    "Lower the bar, seat somebody for the weight that is silent, or bring the change back as a new proposal once the roll has moved."
  );
}
