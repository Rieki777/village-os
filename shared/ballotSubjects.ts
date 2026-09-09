/**
 * WHAT A SUBJECT ASKS OF THE VILLAGE, per `ballots.subject_type` (R68).
 *
 * Until this file, every village-wide ballot resolved through ONE pair of
 * dials whatever it was about: a quest payout and a change to the Game itself
 * both landed on `governance.unity_pct` and `governance.quorum_pct`. The
 * founder's ruling is that they should not, and his stated reason is awareness
 * over caution: a big change should need enough people paying attention that
 * it cannot pass on a quiet week.
 *
 * ── THE SHAPE, AND WHY IT IS FLOORS ─────────────────────────────────────────
 *
 * A subject declares MINIMUMS. The village's own dials still decide, and the
 * ballot freezes whichever number is higher. Three reasons this is a floor and
 * never an override:
 *
 *  1. R56 says a village sets its own dials, including a 1% quorum. A registry
 *     that OVERRODE would quietly lower a village that had chosen 100 for
 *     everything, which is the platform overruling a decision the village
 *     made about itself.
 *  2. R68's own words are "significantly MORE % of overall voice". More is a
 *     floor. A fixed pair is a different instruction.
 *  3. A floor composes. A later subject can raise one dial and leave the other
 *     where the village put it, and the two settings never fight.
 *
 * ── WHY A SUBJECT MAY ALSO FIX THE METHOD ───────────────────────────────────
 *
 * `evaluateBallot` reads `unity_pct` for `custom` alone. `majority` compares
 * against a hard 50 and ignores the column; `consensus` reads the tallies;
 * `consent` conducts no unity at all. So a floor of 100 stamped on a ballot
 * running `majority` would sit in the row, render on the decision page, and
 * decide nothing. Every member reading that vote would be told it needed
 * everyone when it needed half.
 *
 * A stamped dial the evaluator never reads is a lie with a number on it. So a
 * subject whose ruling is expressed AS NUMBERS names the one method that
 * conducts numbers, the same way `dialsForMethod` already lets a method fix
 * what its own sentence fixes.
 *
 * ── HOW TO ADD ONE ──────────────────────────────────────────────────────────
 *
 * One entry here, keyed by the `subject_type` the route passes to `openBallot`.
 * A subject absent from this registry keeps today's behaviour exactly: the
 * village's dials, the village's method, no floor on the roll. Absence is the
 * safe direction, so a subject type a later lane adds cannot inherit a
 * threshold nobody chose for it.
 */
import {
  CRITICALITIES,
  DEFAULT_QUORUM_POLICY,
  dialsForMethod,
  highestCriticality,
  peopleAndWeightFor,
  raiseDials,
  reachableQuorumWarning,
  stalemateWarning,
  thresholdSentence,
  TIER_FLOORS,
  wholeRollWarning,
  type AbstainPolicy,
  type BallotMethod,
  type Criticality,
  type MethodDials,
  type PeopleAndWeight,
  type QuorumPolicy,
  type VoteChoice,
  type WeighedSeat,
} from "./governanceEngine";

export interface SubjectThresholds {
  /**
   * The least unity this subject may be decided on, 0 to 100. The ballot
   * freezes `max(this, the village's own)`.
   */
  minUnityPct: number;
  /** The least quorum, same rule. */
  minQuorumPct: number;
  /**
   * How many people must hold a voice before this kind of ballot may open at
   * all. 0 means the engine's own rule stands, which is that an electorate of
   * one is enough.
   */
  minElectorate: number;
  /**
   * Whether every member on the roll must carry weight above zero before this
   * subject may be asked. See the block above `weightFloorProblem` for why a
   * head count alone is not enough on a subject whose ruling is 100 and 100.
   */
  everySeatWeighs?: boolean;
  /**
   * The method this subject conducts, when its ruling is expressed as numbers
   * and only the dial-reading method can carry them. Absent means the village
   * decides the method the way it decides every other ballot's.
   */
  method?: BallotMethod;
  /**
   * How critical this subject is. The tier's floor is applied on top of the
   * explicit numbers above, so a subject can say "constitutional" and inherit
   * whatever the village has set that tier to without repeating a number.
   */
  criticality?: Criticality;
  /**
   * What an abstention is on this subject. Absent = the Hypha rule, which is
   * that it counts toward quorum and takes no side on unity.
   */
  abstainPolicy?: AbstainPolicy;
  /**
   * How many people must vote yes, counted as HEADS. `"all"` means every seat
   * on the frozen roll. Absent means the subject asks nothing of heads.
   */
  minYesHeads?: number | "all";
  /**
   * The fact a member reads on the surface that opens this. A fact, never an
   * argument: it says what the numbers are and stops there.
   */
  why: string;
}

/** A subject's floors expressed as a tier, so a number lives in one place. */
export function tierFloors(criticality: Criticality): { minUnityPct: number; minQuorumPct: number } {
  const t = TIER_FLOORS[criticality];
  return { minUnityPct: t.unityPct, minQuorumPct: t.quorumPct };
}

/**
 * ── THE ONE ENTRY TODAY: STARTING THE GAME ──────────────────────────────────
 *
 * R74, in the founder's words: the button that marked a village launched
 * "actually generates the first proposal that requires 100% unity and 100%
 * quorum to launch and a minimum of 3 people."
 *
 * R67 is why the numbers are these numbers. A founder builds the whole Game
 * alone: modules, dials, quests, seasons, every requirement on the launch
 * journey. Starting it is the one act that is not theirs, because starting it
 * turns on token issuance, and a token issued is a claim on everybody. So the
 * first vote a village ever holds asks for everyone.
 *
 * THE FLOOR OF THREE is R67's other half. A Game needs three people to play.
 * Below three, the surface says how many hold a voice and offers nothing to
 * press.
 *
 * THE FLOOR OF THREE COUNTS HEADS, AND THE ENGINE COUNTS WEIGHT. That gap is
 * what `everySeatWeighs` closes, and the block above `weightFloorProblem` is
 * the whole of why.
 *
 * `custom` for the reason in this file's header: the ruling is a pair of
 * numbers, and `custom` is the only method that decides by the numbers a
 * ballot freezes.
 */
export const VILLAGE_LAUNCH = "village_launch";

/**
 * THE ONE `subject_ref` A LAUNCH BALLOT EVER CARRIES, and it is a constant
 * because that is what makes the vote RE-RUNNABLE without any machinery.
 *
 * `ballots.open_key` is `${subject_type}:${subject_ref}` and it is UNIQUE, so
 * while a launch vote is running no second one can open, race-free, on the
 * index instead of on an application check. Closing rewrites the key to carry
 * the ballot's own id, which frees it immediately. A launch vote that missed
 * its participation can therefore be closed and asked again the same hour, and
 * the ballot that missed stays closed and immutable with its own frozen roll.
 *
 * The constant is also the query. `ballotsFor(VILLAGE_LAUNCH, LAUNCH_SUBJECT_REF)`
 * is every time a village has ever asked itself this question, in order, with
 * no join and no extra column.
 */
export const LAUNCH_SUBJECT_REF = "start";

/**
 * ── THE SECOND ENTRY: CHANGING WHAT THE VILLAGE MINTS ───────────────────────
 *
 * R81, in the founder's words: "all minting of tokens go through the
 * governance process." R84 says which reading that is: the village votes on
 * the RULES, and issuance then runs under rules the village already set.
 *
 * A proposal whose change set names a minting rule opens under this subject
 * instead of `mechanics`. Everything else about it is a mechanics proposal:
 * the same row, the same support threshold, the same document, the same
 * executor. The subject type is what carries the threshold, so it is what has
 * to differ.
 *
 * ── WHY THE QUORUM RISES AND THE UNITY DOES NOT ─────────────────────────────
 *
 * R68 gives the reason thresholds are tiered at all, and it is a specific
 * reason: "so people have to become aware of the changes and be wanting them
 * (for them to vote on them)". AWARENESS is the word. Quorum is the dial that
 * measures awareness, because quorum is how much of the roll turned up. Unity
 * measures agreement among whoever did. So the ruling's own stated reason
 * lands on quorum, and raising unity would be answering a question nobody
 * asked.
 *
 * There is a second reason, and it is the one that decides the METHOD field.
 * `evaluateBallot` reads `quorumPct` FIRST, for every method, before it looks
 * at anything else. It reads `unityPct` for `custom` alone. So a quorum floor
 * is a true statement under all four methods, and a unity floor would be a
 * number sitting in the row deciding nothing on three of them, which is the
 * lie with a number on it this file's header refuses. A quorum floor therefore
 * does not have to seize the village's choice of method, and it does not.
 *
 * ── WHERE 50 COMES FROM, AND WHERE IT DOES NOT ──────────────────────────────
 *
 * The founder has not named a number for this one. 50 is not invented for it
 * either: it is already this engine's own constant, the hard 50 `majority`
 * compares against in `evaluateBallot` and the unity `dialsForMethod` stamps
 * for it. Said as a sentence, it is "more than half the village's voting
 * weight was in the room when this was decided", which is the smallest claim
 * that answers R68's awareness test.
 *
 * It also sits inside the range R74 opened. Launch is 100 and 100 because
 * starting a Game is irreversible. A mint rule change is not: it takes effect
 * at the next moon at the earliest, and the next vote can move it back. So it
 * belongs above the ordinary default of 20 and below launch, and 50 is the one
 * number in that range this codebase already uses for something.
 *
 * THE FLOOR NEVER LOWERS ANYONE. A village that set its quorum to 80 keeps 80
 * here, because `dialsForSubject` takes the higher of the two.
 *
 * ── WHY THERE IS NO ELECTORATE FLOOR ────────────────────────────────────────
 *
 * Three was considered and refused. A launched village already cleared three
 * at launch, so the floor would only ever bite a village that has SHRUNK, and
 * the effect would be to take the mint back off a small village and leave it
 * with the admin panel. R54's test is whether a thing moves a power toward the
 * village or entrenches the scaffolding, and that fails it. A village of two
 * governing itself is still governing itself.
 */
export const MINT_RULE = "mint_rule";

/**
 * ── THE THIRD ENTRY: HOW VOTES ARE COUNTED AT ALL ───────────────────────────
 *
 * The founder's ruling of 2026-09-02 (Q8): `governance.weight_mode` leaves
 * the founder ring and becomes something the village votes on, in either
 * direction, with holdings untouched by the switch. It gets its OWN subject
 * type rather than riding an ordinary dial change, for two reasons.
 *
 * First, the price. Switching between one person one vote and one token one
 * vote changes what every future vote in the village means. That is the
 * constitutional tier by any reading, and a change set full of ordinary dials
 * must never be able to carry it under the ordinary bar.
 *
 * Second, the door. `validateChangeSet` refuses every founder-ring key inside
 * an ordinary dial item and goes on refusing it. A `mode_switch` item is the
 * only way the key travels, so there is exactly one path and it is the
 * expensive one.
 *
 * The executor is the dispatcher lane's; this file prices it.
 */
export const GOVERNANCE_MODE = "governance_mode";

export const SUBJECT_THRESHOLDS: Readonly<Record<string, SubjectThresholds>> = {
  [VILLAGE_LAUNCH]: {
    minUnityPct: 100,
    minQuorumPct: 100,
    minElectorate: 3,
    everySeatWeighs: true,
    method: "custom",
    /*
     * THE BIRTHING IS THE ONE VOTE THAT ASKS FOR A YES FROM EVERYBODY.
     *
     * The founder's words, 2026-09-02 (Q3): "we need 100% saying yes as a
     * collective 'Birthing' moment". Until this pair of fields, the engine
     * read that sentence as "everybody answers and nobody objects", so one
     * yes and two abstentions carried a launch at 100 and 100, and
     * `ballotSubjects.test.ts` pinned it as a documented decision. It is now
     * the wrong rule and the test is rewritten to this one.
     *
     * `no_answer` is the kinder half. An abstention on the Birthing is not a
     * refusal, it is a question nobody has answered yet, so it leaves quorum
     * short and the ballot closes `no_quorum` rather than `failed`. A missed
     * quorum returns the subject and the vote can be asked again the same
     * hour on a fresh freeze; a failure is terminal. The village that has not
     * finished deciding is not a village that said no.
     *
     * `minYesHeads: "all"` is the founder's sentence said in heads, which is
     * the unit he said it in. On today's floors it is also provable from the
     * weights (100% quorum over a roll where every seat weighs something is
     * every seat present, and 100% unity is nobody against), so it decides
     * nothing today that the arithmetic did not already decide. It is here
     * because the arithmetic proves it only while all three of those floors
     * hold, and the rule is meant to outlive them.
     */
    abstainPolicy: "no_answer",
    minYesHeads: "all",
    why: "Starting the Game asks every member on the roll to vote yes. An abstention is not a yes, and a vote nobody cast is not a yes either.",
  },
  [MINT_RULE]: {
    minUnityPct: 0,
    minQuorumPct: 50,
    minElectorate: 0,
    why: "This one changes what the village mints, so it asks for more than half the village's voting weight to take part. How much of that has to agree is the village's own setting.",
  },
  [GOVERNANCE_MODE]: {
    ...tierFloors("constitutional"),
    minElectorate: 0,
    criticality: "constitutional",
    /*
     * `custom` for this file's header reason: the ruling is a pair of numbers
     * and `custom` is the only method that decides by the numbers a ballot
     * freezes. A 97 stamped on a `majority` ballot would be read by nobody.
     */
    method: "custom",
    why: "This one changes how every vote in the village is counted, so it asks the constitutional bar: almost everybody present, and almost everybody in favour.",
  },
};

/** What this subject asks, or null when it asks nothing of its own. */
export function thresholdsForSubject(subjectType: string): SubjectThresholds | null {
  return SUBJECT_THRESHOLDS[subjectType] ?? null;
}

/**
 * The method a ballot on this subject conducts.
 *
 * `villageMethod` is what `villageBallotMethod(governance.default_method)`
 * answered, and it can be the string "hypha", which is not a ballot method at
 * all. A subject that fixes its own method answers over both, which is what
 * lets a village that decides its rule changes on Hypha still start its own
 * Game here: there is no chain leg for "this village began".
 */
export function methodForSubject(
  subjectType: string,
  villageMethod: BallotMethod | "hypha",
): BallotMethod | "hypha" {
  return thresholdsForSubject(subjectType)?.method ?? villageMethod;
}

/**
 * -- THE FLOORS ARE SETTINGS NOW, AND THE REGISTRY IS THE FLOOR UNDER THEM ---
 *
 * Section 7A's rule is that a governance number must be changeable without a
 * deploy, and section 13.2 counted every number in this file as code. So each
 * tier and each named subject reads a pair of `game_variables` keys, and the
 * numbers written above stay as the floor beneath the setting: a village
 * RAISES its bar and can never lower it below what this platform ships.
 *
 * Two reasons it is raise-only rather than free.
 *
 *  1. A village that can lower the bar for changing the bar has no bar. The
 *     tier dials are themselves constitutional, so a simple majority on a
 *     quiet week could otherwise walk the constitutional tier down to 10 and
 *     then walk everything else through it.
 *  2. R56 gives a village its own dials, and it keeps them: the village dials
 *     are `governance.unity_pct` and `governance.quorum_pct` and nothing here
 *     touches them. These keys move a FLOOR, and a floor that could move down
 *     is not one.
 *
 * The Birthing has no keys at all. It is 100 and 100 by rule (Q11: the
 * Birthing stays at 100 and 100 because it is the one vote where everyone is
 * present by definition), and a setting that could only ever hold the one
 * value it already has is a control that does nothing.
 */
export const TIER_SETTING_KEYS: Readonly<Record<Criticality, { unity: string; quorum: string }>> = {
  routine: {
    unity: "governance.tier_routine_unity_pct",
    quorum: "governance.tier_routine_quorum_pct",
  },
  structural: {
    unity: "governance.tier_structural_unity_pct",
    quorum: "governance.tier_structural_quorum_pct",
  },
  constitutional: {
    unity: "governance.tier_constitutional_unity_pct",
    quorum: "governance.tier_constitutional_quorum_pct",
  },
};

export const SUBJECT_SETTING_KEYS: Readonly<Record<string, { unity: string; quorum: string }>> = {
  [MINT_RULE]: {
    unity: "governance.subject_mint_rule_unity_pct",
    quorum: "governance.subject_mint_rule_quorum_pct",
  },
};

/**
 * THE VILLAGE'S HIGHEST SET TIER (19E).
 *
 * The founder's words of 2026-09-03: "We can have a veto override if it goes
 * up to the highest tier they have set as a village (this is also a setting
 * that can change at the highest tier set)." So a vetoed proposal brought
 * back and passed again at THIS tier lands whatever a steward does, and the
 * setting naming that tier is priced at itself, which is what stops a village
 * cheapening its own override with an ordinary vote.
 */
export const HIGHEST_TIER_KEY = "governance.highest_tier";

/** Every key whose value is a governance threshold percentage. */
export const THRESHOLD_PERCENT_KEYS: readonly string[] = [
  ...Object.values(TIER_SETTING_KEYS).flatMap((k) => [k.unity, k.quorum]),
  ...Object.values(SUBJECT_SETTING_KEYS).flatMap((k) => [k.unity, k.quorum]),
  "governance.unity_pct",
  "governance.quorum_pct",
];

/** A village's own floors, already raised to the registry's. */
export interface ThresholdSettings {
  tiers: Readonly<Record<Criticality, MethodDials>>;
  subjects: Readonly<Record<string, MethodDials>>;
  /** The tier a veto override must be passed at (19E). */
  highest: Criticality;
}

const CRITICALITY_LIST: readonly Criticality[] = ["routine", "structural", "constitutional"];

/**
 * Read the village's threshold settings through one function, applying the
 * registry floor as it goes, so no caller can hold a lowered number even for
 * a line. `read` is whatever the caller already has for reading a percentage
 * variable; the shared layer never touches a database.
 */
export function thresholdSettingsFrom(
  read: (key: string) => number,
  readText?: (key: string) => string,
): ThresholdSettings {
  const pair = (keys: { unity: string; quorum: string }, floor: MethodDials): MethodDials =>
    raiseDials({ unityPct: Number(read(keys.unity)) || 0, quorumPct: Number(read(keys.quorum)) || 0 }, floor);
  const tiers = {} as Record<Criticality, MethodDials>;
  for (const c of CRITICALITY_LIST) tiers[c] = pair(TIER_SETTING_KEYS[c], TIER_FLOORS[c]);
  const subjects: Record<string, MethodDials> = {};
  for (const [subject, keys] of Object.entries(SUBJECT_SETTING_KEYS)) {
    const registry = SUBJECT_THRESHOLDS[subject];
    subjects[subject] = pair(keys, {
      unityPct: registry?.minUnityPct ?? 0,
      quorumPct: registry?.minQuorumPct ?? 0,
    });
  }
  return { tiers, subjects, highest: highestTierFrom(readText) };
}

/**
 * THE HIGHEST TIER THIS VILLAGE HAS SET, for the veto override (19E).
 *
 * `readText` absent means no village settings were supplied at all, which is
 * the registry posture, and the registry's answer is the top of the ladder:
 * an override that could be reached at a lower bar than the platform's own
 * hardest tier would be an override the platform quietly discounted. A value
 * this file does not recognise gets the same answer for the same reason.
 */
export function highestTierFrom(readText?: (key: string) => string): Criticality {
  const top = CRITICALITIES[CRITICALITIES.length - 1];
  if (!readText) return top;
  const raw = String(readText(HIGHEST_TIER_KEY) ?? "").trim();
  return (CRITICALITIES as readonly string[]).includes(raw) ? (raw as Criticality) : top;
}

/** The tier a veto override is passed at, from settings already read. */
export function highestTier(settings?: ThresholdSettings): Criticality {
  return (settings ?? registryThresholdSettings()).highest;
}

/** The bar a veto override must clear: the highest set tier's own dials. */
export function overrideDials(settings?: ThresholdSettings): MethodDials {
  const s = settings ?? registryThresholdSettings();
  return floorForCriticality(s.highest, s);
}

/** The registry's own floors, used when no village settings are supplied. */
export function registryThresholdSettings(): ThresholdSettings {
  return thresholdSettingsFrom(() => 0);
}

/** One subject's effective floor: the registry, its tier, and the settings. */
export function floorForSubject(subjectType: string, settings?: ThresholdSettings): MethodDials {
  const t = thresholdsForSubject(subjectType);
  let floor: MethodDials = { unityPct: t?.minUnityPct ?? 0, quorumPct: t?.minQuorumPct ?? 0 };
  const s = settings ?? registryThresholdSettings();
  if (t?.criticality) floor = raiseDials(floor, s.tiers[t.criticality]);
  const own = s.subjects[subjectType];
  if (own) floor = raiseDials(floor, own);
  return floor;
}

/** One criticality tier's effective floor. */
export function floorForCriticality(criticality: Criticality, settings?: ThresholdSettings): MethodDials {
  return (settings ?? registryThresholdSettings()).tiers[criticality];
}

/**
 * The dials a ballot on this subject freezes: the method's own answer, raised
 * to the subject's floor. Both halves are pure, so the surface that previews a
 * threshold and the route that stamps it are the same arithmetic.
 *
 * A LIST takes the highest floor among its elements (Q9): a bundle is as hard
 * to pass as its hardest part, so nobody can smuggle a big change under a
 * small one. The two dials are raised SEPARATELY, which is the same rule
 * `raiseDials` already applies between a village and a floor: a set holding a
 * mint rule (quorum 50, unity nothing) and a mode switch (97 and 97) asks for
 * 97 and 97, and a set holding the mint rule alone still leaves unity where
 * the village put it.
 */
export function dialsForSubject(
  subjectType: string | readonly string[],
  method: BallotMethod,
  village: MethodDials,
  settings?: ThresholdSettings,
): MethodDials {
  const subjects = typeof subjectType === "string" ? [subjectType] : subjectType;
  let out = dialsForMethod(method, village);
  for (const subject of subjects) out = raiseDials(out, floorForSubject(subject, settings));
  return out;
}

/**
 * The method a ballot over a LIST of subjects conducts.
 *
 * A subject that fixes its method fixes it for the whole set, and two subjects
 * that fix two different methods cannot ride one ballot, so the caller is told
 * rather than having one of the two silently win. `null` means the village's
 * own method stands.
 */
export function methodForSubjects(
  subjects: readonly string[],
): { method: BallotMethod | null; conflict: string | null } {
  const fixed = Array.from(
    new Set(subjects.map((s) => thresholdsForSubject(s)?.method).filter((m): m is BallotMethod => !!m)),
  );
  if (fixed.length === 0) return { method: null, conflict: null };
  if (fixed.length === 1) return { method: fixed[0], conflict: null };
  return {
    method: null,
    conflict: `This asks the village two questions that are decided two different ways (${fixed.join(" and ")}). They go up as two decisions.`,
  };
}

/**
 * What a change of this kind asks of the village, from either of the two ways
 * a caller can name it: a list of subject types, or a criticality tier.
 *
 * ONE helper, because the control that shows "changing this needs 97 of 100
 * to show up and 97 to agree" before anybody proposes, the route that stamps
 * the dials at open, and the page that explains the vote afterwards all have
 * to say the same numbers, and three copies of this lookup would not.
 */
export interface ThresholdTarget {
  /** A subject type, or several for a bundle. */
  subjects?: readonly string[];
  /** A criticality tier, for a settings key that has no subject of its own. */
  criticality?: Criticality;
}

export interface EffectiveThresholds extends MethodDials {
  /** The method these numbers are conducted by, or null for the village's. */
  method: BallotMethod | null;
  /** Set when two subjects in the list fix two different methods. */
  conflict: string | null;
  /** The warning to render beside a bar set above the recommended ceiling. */
  warning: string | null;
}

export function thresholdsFor(
  target: ThresholdTarget,
  method: BallotMethod,
  village: MethodDials,
  settings?: ThresholdSettings,
): EffectiveThresholds {
  const subjects = target.subjects ?? [];
  const { method: fixed, conflict } = methodForSubjects(subjects);
  const conducts = fixed ?? method;
  let dials = dialsForSubject(subjects, conducts, village, settings);
  if (target.criticality) dials = raiseDials(dials, floorForCriticality(target.criticality, settings));
  /*
   * The Birthing is exempt from the warning by rule (Q11). It is the one vote
   * where everybody is present by definition: the village has not started, so
   * nobody has joined it and drifted away again, and the whole point of the
   * vote is that every catalyst is in the room.
   */
  const exempt = subjects.includes(VILLAGE_LAUNCH);
  return {
    ...dials,
    method: fixed,
    conflict,
    warning: exempt ? null : stalemateWarning(Math.max(dials.unityPct, dials.quorumPct)),
  };
}

/**
 * The warning shown where a threshold dial is EDITED, given the key and the
 * value being typed. Null for any other key, and for a value at or under the
 * recommended ceiling.
 */
export function stalemateWarningFor(key: string, value: string | number): string | null {
  if (!THRESHOLD_PERCENT_KEYS.includes(key)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? stalemateWarning(n) : null;
}

/**
 * How a ballot on this subject counts an abstention, and how many yes heads
 * it asks for. A list takes the strictest answer among its elements, the same
 * way the dials take the highest floor.
 */
export function evaluationRulesFor(
  subjectType: string | readonly string[],
): { abstainPolicy: AbstainPolicy; minYesHeads: number | "all" | undefined } {
  const subjects = typeof subjectType === "string" ? [subjectType] : subjectType;
  let abstainPolicy: AbstainPolicy = "counts_toward_quorum";
  let minYesHeads: number | "all" | undefined;
  for (const subject of subjects) {
    const t = thresholdsForSubject(subject);
    if (!t) continue;
    if (t.abstainPolicy === "no_answer") abstainPolicy = "no_answer";
    if (t.minYesHeads === "all") minYesHeads = "all";
    else if (typeof t.minYesHeads === "number" && minYesHeads !== "all") {
      minYesHeads = Math.max(typeof minYesHeads === "number" ? minYesHeads : 0, t.minYesHeads);
    }
  }
  return { abstainPolicy, minYesHeads };
}

/**
 * -- THE TYPED ITEMS A CHANGE SET IS MADE OF (Q9) ----------------------------
 *
 * A proposal is a LIST of changes voted as one, and the founder's own example
 * mixes kinds: switch the vote mode AND distribute Voice, because they might
 * be connected. Until this union a change set held a `{ key, to }` pair and
 * one vocabulary, and the two vocabularies it did have were told apart by a
 * string prefix on the key.
 *
 * The kinds are named for what a member is deciding, not for the table that
 * gets written:
 *
 *   dial              a game variable moves within its bounds.
 *   mint_rule         a minting rule changes what the village pays for what.
 *   weight_allocation the custom allocation table gives somebody weight.
 *   mode_switch       how votes are counted changes.
 *   module_lifecycle  a part of the Game is turned on, opened or closed.
 *   brand_field       a name, a word or an image the village calls itself by.
 *   role              a role is declared, seated or handed back.
 *
 * Each kind names the subject that prices it, so a bundle is priced at the
 * highest floor among its elements with no second table to keep in step.
 * Execution belongs to the dispatcher lane; this file prices, and
 * `server/lib/mechanics.ts` validates.
 */
export const CHANGE_ITEM_KINDS = [
  "dial",
  "mint_rule",
  "weight_allocation",
  "mode_switch",
  "module_lifecycle",
  "brand_field",
  "role",
] as const;
export type ChangeItemKind = (typeof CHANGE_ITEM_KINDS)[number];

/**
 * Which subject prices each kind. `mechanics` sets no floor of its own, so a
 * dial is priced by its own criticality tier instead (`criticalityOf` in
 * `shared/gameVariables.ts`), which is what makes "everything can be voted,
 * and the critical things cost more" true key by key rather than kind by kind.
 */
export const SUBJECT_FOR_ITEM_KIND: Readonly<Record<ChangeItemKind, string>> = {
  dial: "mechanics",
  mint_rule: MINT_RULE,
  weight_allocation: "mechanics",
  mode_switch: GOVERNANCE_MODE,
  module_lifecycle: "mechanics",
  brand_field: "mechanics",
  role: "mechanics",
};

/**
 * The tier each kind carries when its subject sets no floor of its own. A
 * dial is absent because a dial's tier is a property of the dial, not of the
 * kind: moving the sensing window and moving how votes are counted are both
 * dials and are not the same size of decision.
 */
export const CRITICALITY_FOR_ITEM_KIND: Readonly<Record<Exclude<ChangeItemKind, "dial">, Criticality>> = {
  mint_rule: "structural",
  weight_allocation: "structural",
  mode_switch: "constitutional",
  module_lifecycle: "structural",
  brand_field: "routine",
  role: "structural",
};

/** The tier of a bundle: its most critical element, `routine` when empty. */
export function criticalityOfItems(tiers: readonly Criticality[]): Criticality {
  return highestCriticality(tiers);
}

/**
 * Whether the roll is big enough for this subject, said as a fact.
 *
 * R55 and R56 both land on this sentence, so it counts and stops. A village of
 * two is young. It is not behind, it is not failing, and nothing here tells it
 * what to want. `null` means the floor is met.
 */
export function electorateFloorProblem(subjectType: string, onTheRoll: number): string | null {
  const floor = thresholdsForSubject(subjectType);
  if (!floor || floor.minElectorate <= 0) return null;
  if (onTheRoll >= floor.minElectorate) return null;
  const short = floor.minElectorate - onTheRoll;
  const people = onTheRoll === 1 ? "One member holds a voice" : `${onTheRoll} members hold a voice`;
  const more = short === 1 ? "One more member" : `${short} more members`;
  return `${people} in this village today. ${more} and the village can vote to start its Game.`;
}

/** One seat on a frozen roll: who was asked, and what their answer weighs. */
export interface RollSeat {
  weight: number;
}

/**
 * ── WHY A HEAD COUNT IS NOT ENOUGH ON A 100/100 SUBJECT ─────────────────────
 *
 * `electorateFloorProblem` counts HEADS and `governanceEngine` counts WEIGHT,
 * and until this function existed nothing joined the two. Measured against the
 * built server on 2026-08-30, that gap was a complete bypass of R67:
 *
 *   `governance.weight_mode` is a founder dial. In `custom` mode a member with
 *   no row in `governance_weights` resolves to weight 0 (fail closed, and
 *   right on its own terms). A founder allocates 1 to themselves and nothing
 *   to anybody else. Three members are on the roll, so the floor of three is
 *   met. `openBallot` accepts it, because the roll is not empty and the total
 *   weight is 1. The founder votes yes. Quorum is 1 of 1, unity is 1 of 1, and
 *   the engine reports 100 and 100 on one vote out of three. The frozen
 *   document tells the village that 3 people held a voice and that it carried
 *   on 100% participation and 100% agreement. Token issuance then opens, and
 *   issuance does not come back.
 *
 * `token` mode has the same shape for a different reason: weight is a balance,
 * and a balance of zero is a seat that weighs nothing. So the rule is written
 * over RESOLVED WEIGHTS and not over a mode, and it holds for every mode the
 * engine has now or later.
 *
 * ── WHY THIS SHAPE AND NOT A SECOND QUORUM ──────────────────────────────────
 *
 * The other candidate was to count quorum over people as well as weight, and
 * require both to reach 100. This is equivalent and cheaper. With every seat
 * above zero, weight quorum of 100% is reached only when the weights of the
 * voters sum to the whole roll, and a sum of strictly positive numbers reaches
 * its total only when every term is present. So "every seat weighs something"
 * plus the 100% the subject already declares IS a 100% count of people, proved
 * rather than tracked, with no second column on `ballots`, no second number in
 * the frozen snapshot, and no change to the engine every other subject shares.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 *
 * It does not flatten weights. A village whose allocation table reads 100, 5
 * and 1 still opens its launch vote, and still needs all three to answer and
 * none to object, because unity of 100 means zero weight voted no whatever the
 * weights are. Refusing skew would be the platform overruling R56, and skew is
 * not the hole. Zero is the hole.
 *
 * It does not read `weight_mode`. A rule written against a mode is a rule a
 * future fourth mode inherits by accident or escapes by accident.
 *
 * It says nothing about abstention. A launch can still carry on one yes and
 * two abstentions, because that is R74 plus the engine's stated abstain rule,
 * and it takes three people choosing to answer. That is a documented decision,
 * not this gap.
 */
export function weightFloorProblem(subjectType: string, roll: readonly RollSeat[]): string | null {
  const floor = thresholdsForSubject(subjectType);
  if (!floor?.everySeatWeighs) return null;
  const silent = roll.filter((seat) => !(Number(seat.weight) > 0)).length;
  if (silent === 0) return null;
  const who =
    silent === 1
      ? `One of the ${roll.length} members on the roll carries no voting weight today`
      : `${silent} of the ${roll.length} members on the roll carry no voting weight today`;
  return `${who}. This vote asks every one of them, so it opens once each of them carries some weight.`;
}

/**
 * Everything wrong with the roll for this subject, cheapest first, or null.
 *
 * One function because there is one question a surface asks ("may this village
 * be asked this?") and one place a route refuses. Two separate calls at each of
 * the two call sites is how the second check gets added to one of them.
 */
export function rollProblem(subjectType: string, roll: readonly RollSeat[]): string | null {
  return electorateFloorProblem(subjectType, roll.length) ?? weightFloorProblem(subjectType, roll);
}

/**
 * ── THRESHOLDS FOR THRESHOLDS (19B) ─────────────────────────────────────────
 *
 * The founder's words of 2026-09-02: "they also can be changed by reaching
 * the same amount they are set at can change their threshold again." So a bar
 * set at 97 and 97 costs 97 and 97 to move, in either direction, and a
 * village cannot walk its constitutional tier down on a quiet week and then
 * walk everything else through the gap.
 *
 * Before the Birthing this function has nothing to price: catalysts edit
 * every one of these directly, which is his other ruling in the same message
 * ("these are all editable from the start by catalysts to set the initial
 * amounts"). Pricing begins the first time a change to one of them goes to a
 * ballot, which is the first time there is a village to ask.
 *
 * IT IS A RAISE, NEVER A REPLACEMENT. The tier a setting declares in the
 * registry stays underneath, so this rule can only ever make a threshold
 * change harder than the registry already made it. Two layers refusing to go
 * under one number is the same posture `thresholdSettingsFrom` already holds.
 *
 * Which keys carry their own bar:
 *
 *   a tier's unity or quorum     the tier's own current dials.
 *   a subject's unity or quorum  that subject's own current floor.
 *   the highest set tier         itself, which is 19E's sentence in code.
 *   the village's own dials      the structural tier, because those two are
 *                                how the village decides and the registry
 *                                already prices them there.
 *
 * Anything else answers null, which means "this key sets no bar of its own"
 * and never "this key is free".
 */
export function thresholdChangePrice(key: string, settings?: ThresholdSettings): MethodDials | null {
  const s = settings ?? registryThresholdSettings();
  if (key === HIGHEST_TIER_KEY) return floorForCriticality(s.highest, s);
  for (const c of CRITICALITY_LIST) {
    const keys = TIER_SETTING_KEYS[c];
    if (key === keys.unity || key === keys.quorum) return s.tiers[c];
  }
  for (const [subject, keys] of Object.entries(SUBJECT_SETTING_KEYS)) {
    if (key === keys.unity || key === keys.quorum) return floorForSubject(subject, s);
  }
  if (key === "governance.unity_pct" || key === "governance.quorum_pct") return s.tiers.structural;
  return null;
}

/** Every settings key priced at its own current bar. */
export const SELF_PRICED_THRESHOLD_KEYS: readonly string[] = [
  ...THRESHOLD_PERCENT_KEYS,
  HIGHEST_TIER_KEY,
];

/**
 * ── THE DIALS THAT PRICE EVERY OTHER DECISION (audit 2, risk 1) ─────────────
 *
 * Section 21.2 lets a village TRY a setting for one moon at one tier below its
 * natural bar. The exclusion list it shipped with named the Birthing rule, the
 * highest tier, the veto hours, the council setting, the veto map and anything
 * already routine. It left out quorum, unity and every tier dial, which are
 * the settings that decide what everything else costs.
 *
 * The attack the second audit wrote out: one cheap proposal trials
 * `governance.quorum_pct` down to 5 for a moon, permanent changes are bought
 * at a bar the village never agreed to, and the trial's own reversion then
 * tidies away the only evidence that the bar moved. It also contradicts 19B in
 * the founder's own words, which is that a threshold moves at its own current
 * bar.
 *
 * So there is a class, and its rule is one word: never. A META_SETTING is any
 * dial that decides how a decision is priced, who counts toward the count, how
 * long a steward has, what a steward may reach, or when a proposal may open.
 *
 * ── HOW THE LIST STAYS RIGHT AS LANES ADD DIALS ────────────────────────────
 *
 * By PREFIX as well as by name. The windows lane has not landed its per-kind
 * window settings yet, and a list of exact keys written today would silently
 * miss them. `governance.window_` catches every one of them the moment it
 * exists, and a lane that has to think about whether its new key is meta is a
 * lane that will sometimes decide wrong. The fail-safe direction here is to
 * refuse a trial that might have been allowed, because the cost of that is one
 * proposal at its ordinary bar.
 */
export const META_SETTING_KEYS: readonly string[] = [
  ...SELF_PRICED_THRESHOLD_KEYS,
  // The veto map and the steward's own limits (20.11, constitutional).
  "governance.steward_subjects",
  "governance.auto_execute_subjects",
  "governance.veto_hours",
  "governance.steward_council",
  // The trial guard itself. A trial that could cheapen its own cooldown is a
  // trial with no cooldown.
  "governance.trial_cooldown_cycles",
  // Who counts toward the count (19G). These move a denominator, which is the
  // same power as moving the bar.
  "governance.nonhuman_in_quorum",
  "governance.absent_cycles",
];

/** Any key under one of these is a META_SETTING, whichever lane adds it. */
export const META_SETTING_PREFIXES: readonly string[] = ["governance.window_", "governance.tier_"];

/** Whether this setting prices, gates or counts other decisions. */
export function isMetaSetting(key: string): boolean {
  const k = String(key ?? "");
  if (META_SETTING_KEYS.includes(k)) return true;
  return META_SETTING_PREFIXES.some((p) => k.startsWith(p));
}

/**
 * The refusal a trial of a pricing dial reads, or null when the setting may be
 * trialled. Phase 2's trial path calls this and prints the sentence; it is
 * here so the wizard that offers "try it for one moon" and the route that
 * refuses one say the same words.
 */
export function metaSettingTrialRefusal(keys: string | readonly string[]): string | null {
  const list = typeof keys === "string" ? [keys] : keys;
  const blocked = list.map(String).filter(isMetaSetting);
  if (blocked.length === 0) return null;
  const named = blocked.length === 1 ? blocked[0] : blocked.join(", ");
  return (
    `${named} decides what every other decision in this village costs, so it is never tried for a moon at a lower bar. ` +
    "Move it at its own current bar, which is the rule a threshold has always followed here."
  );
}

/**
 * ── A TIER, READ IN PEOPLE (19F) ────────────────────────────────────────────
 *
 * What the control beside a criticality tier says before anybody proposes:
 * the bar in weight, the same bar in people on today's roll, and both
 * warnings. The founder's above-97 warning stays exactly as he set it, and
 * the whole-roll warning fires whenever the arithmetic makes a tier unanimity
 * whatever number is written on it.
 *
 * Neither warning refuses anything. He ruled that a village may go above 97
 * and be warned, and the audit's proposal to refuse outright is not his rule.
 */
export interface TierReading extends PeopleAndWeight {
  criticality: Criticality;
  /** The bar in weight and in people, as one sentence. */
  sentence: string;
  /** Fired when the bar rounds to the whole roll. */
  rollWarning: string | null;
  /** Fired when the bar is above the number the founder recommends. */
  ceilingWarning: string | null;
  /**
   * Fired when the weight that can vote cannot add up to the bar (19G). It is
   * computed against this roll and never against a static number, which is the
   * failure the second audit found in the two warnings above.
   */
  reachWarning: string | null;
}

export function tierInPeople(
  criticality: Criticality,
  roll: readonly WeighedSeat[],
  settings?: ThresholdSettings,
  policy: QuorumPolicy = DEFAULT_QUORUM_POLICY,
): TierReading {
  const dials = floorForCriticality(criticality, settings);
  return {
    ...peopleAndWeightFor(dials, roll, policy),
    criticality,
    sentence: thresholdSentence(dials, roll, policy),
    rollWarning: wholeRollWarning(dials, roll, policy),
    ceilingWarning: stalemateWarning(Math.max(dials.unityPct, dials.quorumPct)),
    reachWarning: reachableQuorumWarning(dials, roll, policy),
  };
}

/** The same reading for one subject's effective floor. */
export interface SubjectReading extends PeopleAndWeight {
  subjectType: string;
  sentence: string;
  rollWarning: string | null;
  ceilingWarning: string | null;
  reachWarning: string | null;
}

export function subjectInPeople(
  subjectType: string,
  roll: readonly WeighedSeat[],
  settings?: ThresholdSettings,
  policy: QuorumPolicy = DEFAULT_QUORUM_POLICY,
): SubjectReading {
  const dials = floorForSubject(subjectType, settings);
  /*
   * The Birthing is exempt from both warnings for the reason `thresholdsFor`
   * already gives: it is the one vote where everybody is present by
   * definition, so "every seat must answer" is the rule and not a hazard.
   */
  const exempt = subjectType === VILLAGE_LAUNCH;
  return {
    ...peopleAndWeightFor(dials, roll, policy),
    subjectType,
    sentence: thresholdSentence(dials, roll, policy),
    rollWarning: exempt ? null : wholeRollWarning(dials, roll, policy),
    ceilingWarning: exempt ? null : stalemateWarning(Math.max(dials.unityPct, dials.quorumPct)),
    reachWarning: exempt ? null : reachableQuorumWarning(dials, roll, policy),
  };
}

/**
 * ── A DELEGATED ROW DOES NOT COUNT WHERE EVERYONE MUST AGREE ────────────────
 *
 * A ballot conducted at 100 unity asks every member who takes a side to
 * agree, and the Birthing asks every seat on the roll to say yes. A row
 * derived from somebody else's choice is not that member saying yes. It is a
 * copy of a neighbour's answer, and counting it would let three delegations
 * to one person carry the vote the founder wrote as "at LEAST 3 but could be
 * many more people who then activate a new game".
 *
 * So on any subject asking 100 unity, the Birthing included, a delegated row
 * counts toward neither the weighted tally nor the head count. The member is
 * counted as not having voted, which is what they are: they have not answered
 * this question themselves, and this question insists on being answered in
 * person.
 *
 * The rule is written against the BAR, so a village that raises an ordinary
 * subject to 100 gets it too and a later subject asking for everyone inherits
 * it with no entry anywhere. `village_launch` is named as well, so the rule
 * survives a day when its floors are read from settings.
 */
export function delegatedRowsCountOn(input: { subjectType?: string; unityPct: number }): boolean {
  if (input.subjectType === VILLAGE_LAUNCH) return false;
  return !(Number(input.unityPct) >= 100);
}

/** Why a delegated row was not counted, for the page that shows the member. */
export function delegationRefusalSentence(): string {
  return (
    "This vote asks every member who takes a side to agree in person, so a choice cast by someone you follow " +
    "does not count on it. Cast your own vote to be counted here."
  );
}

/**
 * ── THREE CYCLES WITHOUT QUORUM, WITH A COUNTER AND A DOOR (19F, 20.11) ─────
 *
 * The founder's words of 2026-09-03: "No if there is 3 cycles without quorum
 * it just doesn't pass." 19F withdrew the tier fallback the audit had adopted,
 * and left the sentence with nothing behind it: no counter, no warning, no
 * terminal state and no copy, so a proposer who missed quorum nine times read
 * the same page she read after the first miss.
 *
 * The mechanism is three lines of arithmetic and one door.
 *
 *  1. A per-subject counter of CONSECUTIVE no-quorum closes. Consecutive, so a
 *     decision that reaches quorum once starts from zero again: the counter
 *     measures a bar nobody can reach, and one that was reached is reachable.
 *  2. The SECOND miss warns, names the tier as the obstacle, and says the next
 *     one ends it. The obstacle is named because the proposer's own instinct
 *     is to rewrite the proposal, and the proposal is fine: the bar is what it
 *     keeps missing.
 *  3. The THIRD closes it in a named terminal state with exactly one door,
 *     withdraw and rewrite, carrying every backer forward so the village does
 *     not pay again for support it already gave.
 *
 * THE TERMINAL STATE IS DERIVED AND NAMED, never a fourth value on the ballot
 * status column. The three closes are already on the record as `no_quorum`
 * rows, so the state is a reading of them and nothing has to be written for it
 * to be true. Any surface that wants the word reads `NO_QUORUM_ENDED` here.
 *
 * THE BIRTHING IS EXEMPT for the reason `rerunOffer` already gives: it is
 * asked again on a fresh roll whenever it misses, so a terminal state on it
 * would end a village that had not started.
 */
export const QUORUM_MISS_LIMIT = 3;

/** The named terminal state, so every surface says one word for it. */
export const NO_QUORUM_ENDED = "no_quorum_ended";

export type QuorumMissState = "clear" | "warned" | "ended";

export interface QuorumMissInput {
  subjectType: string;
  /** Consecutive no-quorum closes on this subject, this one included. */
  misses: number;
  /** The quorum bar the ballots froze, for naming the obstacle. */
  quorumPct: number;
  /** The tier that set the bar, when the caller knows it. */
  criticality?: Criticality;
  /** How many backers carry into a rewrite. */
  backers?: number;
}

export interface QuorumMissReading {
  state: QuorumMissState;
  /** The consecutive count this reading was made from. */
  misses: number;
  /** Misses left before the subject ends, 0 once it has. */
  remaining: number;
  /** The name to show and to store beside the closed row, or null. */
  terminalState: string | null;
  /** The sentence a member reads, or null while there is nothing to say. */
  sentence: string | null;
  /** The one door out of the terminal state, or null before it. */
  door: string | null;
}

export function quorumMissReading(input: QuorumMissInput): QuorumMissReading {
  const misses = Math.max(0, Math.trunc(Number(input.misses) || 0));
  const clear: QuorumMissReading = {
    state: "clear",
    misses,
    remaining: Math.max(0, QUORUM_MISS_LIMIT - misses),
    terminalState: null,
    sentence: null,
    door: null,
  };
  if (input.subjectType === VILLAGE_LAUNCH) return clear;
  const bar = `${Math.round((Number(input.quorumPct) || 0) * 100) / 100}% of the weight`;
  const tier = input.criticality
    ? `the ${input.criticality} tier, which asks for ${bar}`
    : `a bar of ${bar}`;
  if (misses === QUORUM_MISS_LIMIT - 1) {
    return {
      ...clear,
      state: "warned",
      sentence:
        `This has now closed twice in a row without enough of the village showing up. The obstacle is ${tier}, ` +
        "and the votes cast said nothing about the question. A third close without quorum ends this one for good.",
    };
  }
  if (misses >= QUORUM_MISS_LIMIT) {
    /*
     * The backer count is OPTIONAL, and the sentence stays true without it.
     * The close path knows a ballot and not a proposal's backers, and a door
     * that guessed a number would be the surface promising something the
     * proposal plane never said.
     */
    const backers = input.backers === undefined ? null : Math.max(0, Math.trunc(Number(input.backers) || 0));
    const carried =
      backers === null
        ? "Everyone backing it comes with it"
        : backers === 0
          ? "Nobody is backing it today, so a rewrite starts fresh"
          : backers === 1
            ? "Its one backer comes with it"
            : `All ${backers} of its backers come with it`;
    return {
      ...clear,
      state: "ended",
      remaining: 0,
      terminalState: NO_QUORUM_ENDED,
      sentence:
        `This closed three times in a row without enough of the village showing up, so it ends here. The obstacle was ${tier}. ` +
        "Nothing was decided against it: it was never counted.",
      door: `Withdraw it and write it again. ${carried}.`,
    };
  }
  return clear;
}

/**
 * The consecutive no-quorum count, from closed rows NEWEST FIRST.
 *
 * It stops at the first close that was not a missed quorum, which is what
 * makes the count consecutive. An open row is skipped, because a vote still
 * running has said nothing yet, and skipping is the honest treatment: it is
 * neither a miss nor a reset.
 */
export function consecutiveNoQuorum(closes: readonly { status: string }[]): number {
  let n = 0;
  for (const row of closes) {
    const status = String(row.status ?? "");
    if (status === "open") continue;
    if (status !== "no_quorum") break;
    n += 1;
  }
  return n;
}

/**
 * ── THE STALEMATE RE-RUN (19B, with his abuse guard) ────────────────────────
 *
 * His words: "I think so on the stalemate protections but we have to do this
 * in a way where they can't be abused by people who don't like the outcome of
 * a vote."
 *
 * So the offer is narrow on purpose, and every condition below is one of the
 * doors he asked to keep shut:
 *
 *  1. ONLY WHILE THE BALLOT IS OPEN. A closed ballot is a decided one, and
 *     re-running a decided ballot is the abuse.
 *  2. ONLY WHEN QUORUM IS MATHEMATICALLY OUT OF REACH. Not "looks unlikely"
 *     and not "the proposer is impatient": the weight still able to answer
 *     cannot add up to the bar the ballot froze, even if every seat left
 *     answered today.
 *  3. ONLY WHEN A FROZEN SEAT PROVABLY LEFT, evidenced by a membership change
 *     on the ledger. The caller hands in the evidence, and a seat that
 *     arrives without it is ignored, so a self-declared absence opens nothing.
 *  4. NEVER WHEN A DEPARTED SEAT ALREADY VOTED AGAINST. If the seat that left
 *     had cast a no, dropping it from the roll turns a departure into a way
 *     of deleting an objection, which is the abuse wearing the fix's clothes.
 *  5. THE BIRTHING IS EXEMPT. Its re-runnability is designed: a missed quorum
 *     returns the subject and the village asks again on a fresh freeze the
 *     same hour, so it needs no second door.
 *
 * A re-run CARRIES FORWARD every vote from a member still on the new roll.
 * They answered already, and asking them again because a neighbour left would
 * charge the village for turning up.
 *
 * This function decides and says why. Freezing the new roll and linking the
 * two ballots is the surfaces lane's, and it reads this answer.
 */
export interface DepartedSeat {
  userId: string;
  /** The seat's frozen weight: the weight that can no longer answer. */
  weight: number;
  /** The membership record proving the departure. Absent means unproven. */
  ledgerRef?: string | null;
  /** What this seat voted before it left, if anything. */
  choice?: VoteChoice | null;
}

/**
 * A seat on the frozen roll whose weight provably cannot answer, and which
 * nobody has left (audit 2, risks 11 and 90).
 *
 * The re-run was written for one cause, a member who left the village, and the
 * second audit found the likelier one: a seat speaking for a being whose
 * representative seat is empty, or who has answered nothing for
 * `governance.absent_cycles` cycles. Twenty-five percent of the Voice across
 * four such seats puts every constitutional decision out of reach, and until
 * this field the offer could not see it, because nobody had left.
 */
export interface UnvotableSeat {
  userId: string;
  /** The seat's frozen weight: the weight that cannot answer. */
  weight: number;
  /** Why, in one machine word, for a caller that branches. */
  reason: "no_representative" | "silent";
  /** What this seat voted before it went quiet, if anything. */
  choice?: VoteChoice | null;
}

export interface RerunInput {
  subjectType: string;
  /** The ballot's status right now. Anything but `open` refuses. */
  status: string;
  /** The quorum bar frozen at open. */
  quorumPct: number;
  /**
   * The weight this ballot's quorum is judged against: the frozen total on an
   * ordinary ballot, and the quorum BASE on one where part of the roll is
   * outside the count (19G). A seat already outside that base must not also
   * appear in `unvotable`, or its weight is subtracted twice.
   */
  totalWeight: number;
  /** Seats frozen at open that have left the village. */
  departed: readonly DepartedSeat[];
  /** Seats still on the roll whose weight cannot answer (19G). */
  unvotable?: readonly UnvotableSeat[];
  /** Members on the frozen roll who have already voted, for the carry list. */
  votedUserIds?: readonly string[];
}

export type RerunOffer =
  | { offered: true; carryForward: string[]; sentence: string }
  | { offered: false; reason: string; sentence: string };

/** Every reason a re-run is not offered, so a caller can branch on a word. */
export const RERUN_REFUSALS = [
  "exempt",
  "closed",
  "nobody_left",
  "departed_voted_against",
  "no_weight",
  "quorum_still_reachable",
] as const;
export type RerunRefusal = (typeof RERUN_REFUSALS)[number];

export function rerunOffer(input: RerunInput): RerunOffer {
  const no = (reason: RerunRefusal, sentence: string): RerunOffer => ({ offered: false, reason, sentence });
  if (input.subjectType === VILLAGE_LAUNCH) {
    return no(
      "exempt",
      "Starting the Game is asked again on a fresh roll whenever it misses quorum, so it needs no re-run of its own.",
    );
  }
  if (String(input.status) !== "open") {
    return no("closed", "This vote has closed. A closed decision is never re-run.");
  }
  const proven = input.departed.filter((seat) => String(seat.ledgerRef ?? "").trim() !== "");
  const unvotable = (input.unvotable ?? []).filter((seat) => String(seat.userId ?? "").trim() !== "");
  if (proven.length === 0 && unvotable.length === 0) {
    return no(
      "nobody_left",
      "Nothing on the membership record shows that a seat on this roll has left the village, and every seat on it can still answer, so there is no re-run to offer.",
    );
  }
  /*
   * The same abuse guard, over both causes. A seat that already voted against
   * this is weight that answered, and dropping it from the roll would turn a
   * departure or a silence into a way of deleting an objection.
   */
  if (proven.some((seat) => seat.choice === "no") || unvotable.some((seat) => seat.choice === "no")) {
    return no(
      "departed_voted_against",
      "A seat that can no longer answer already voted against this. A re-run would erase that vote, so it is not offered here.",
    );
  }
  const total = Math.max(0, Number(input.totalWeight) || 0);
  if (!(total > 0)) {
    return no("no_weight", "This roll carries no weight, so the Game cannot tell whether quorum is still reachable.");
  }
  /*
   * THE ARITHMETIC, AND WHY IT IS ONE LINE. Every departed seat that never
   * voted is weight that can never answer. The most this ballot could still
   * reach is therefore the frozen total minus that weight, expressed as a
   * share of the frozen total, and it is compared against the bar the ballot
   * froze. A seat that left AFTER voting is not stranded weight: its answer
   * is already on the record and already counts toward quorum.
   */
  const weightOf = (seats: readonly { weight: number; choice?: VoteChoice | null }[]): number =>
    seats
      .filter((seat) => !seat.choice)
      .reduce((sum, seat) => sum + Math.max(0, Number(seat.weight) || 0), 0);
  const stranded = weightOf(proven) + weightOf(unvotable);
  const reachablePct = ((total - stranded) / total) * 100;
  if (reachablePct >= Number(input.quorumPct)) {
    return no(
      "quorum_still_reachable",
      "This vote can still reach quorum with the members who are here, so it runs on.",
    );
  }
  const goneIds = new Set([
    ...proven.map((seat) => String(seat.userId)),
    ...unvotable.map((seat) => String(seat.userId)),
  ]);
  const carryForward = Array.from(new Set((input.votedUserIds ?? []).map(String))).filter(
    (id) => !goneIds.has(id),
  );
  const left = proven.length === 0 ? "" : `${proven.length === 1 ? "One member" : `${proven.length} members`} on this roll has left the village`;
  const silent =
    unvotable.length === 0
      ? ""
      : `${unvotable.length === 1 ? "One seat" : `${unvotable.length} seats`} on this roll holds weight that cannot answer`;
  const who = [left, silent].filter(Boolean).join(", and ");
  const carried =
    carryForward.length === 0
      ? "No vote has been cast yet, so the new ballot starts empty"
      : carryForward.length === 1
        ? "The one vote already cast is carried over"
        : `All ${carryForward.length} votes already cast are carried over`;
  return {
    offered: true,
    carryForward,
    sentence:
      `${who}, and the weight left behind can no longer reach the quorum this ` +
      `vote froze. Asking it again on today's roll is offered while the vote is still open. ${carried}.`,
  };
}
