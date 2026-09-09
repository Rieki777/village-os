/**
 * The decision engine's math, pinned to Hypha 2.0's formulas (harvest section
 * 3): abstain is EXCLUDED from unity and COUNTS toward quorum, evaluation
 * reads only what the caller hands in (the ballot's frozen snapshot), and the
 * zero edges answer 0 instead of dividing by it.
 */
import { describe, expect, it } from "vitest";
import {
  dialsForMethod,
  evaluateBallot,
  highestCriticality,
  methodForDecidesBy,
  raiseDials,
  requiredYesHeads,
  everySeatWeighsAlike,
  fewestHoldersFor,
  participationSentence,
  peopleAndWeightFor,
  stalemateWarning,
  thresholdSentence,
  totalWeightOf,
  villageBallotMethod,
  wholeRollWarning,
  quorumPctOf,
  quorumBaseOf,
  excludedWeightClause,
  reachableQuorumWarning,
  unityPctOf,
  CRITICALITIES,
  RECOMMENDED_CEILING_PCT,
  TIER_FLOORS,
} from "./governanceEngine";

const t = (yesW: number, noW: number, abstainW = 0) => ({ yesW, noW, abstainW });

describe("unity", () => {
  it("is yes over yes plus no, as a percentage", () => {
    expect(unityPctOf(t(8, 2))).toBe(80);
    expect(unityPctOf(t(1, 1))).toBe(50);
    expect(unityPctOf(t(3, 0))).toBe(100);
  });

  it("excludes abstain entirely", () => {
    expect(unityPctOf(t(8, 2, 90))).toBe(80);
  });

  it("answers 0 when nobody took a side, including the all-abstain ballot", () => {
    expect(unityPctOf(t(0, 0))).toBe(0);
    expect(unityPctOf(t(0, 0, 50))).toBe(0);
  });
});

describe("quorum", () => {
  it("counts every vote cast, abstains included, against the frozen supply", () => {
    expect(quorumPctOf(t(1, 1, 2), 20)).toBe(20);
    expect(quorumPctOf(t(5, 0, 0), 10)).toBe(50);
  });

  it("answers 0 for a zero or negative total weight instead of dividing by it", () => {
    expect(quorumPctOf(t(5, 5), 0)).toBe(0);
    expect(quorumPctOf(t(5, 5), -1)).toBe(0);
  });
});

describe("evaluateBallot: the table", () => {
  const custom = { method: "custom" as const, unityPct: 80, quorumPct: 20, totalWeight: 100 };

  it("the Hypha 80/20 surface: both bars met passes", () => {
    expect(evaluateBallot({ ...custom, tallies: t(16, 4) })).toBe("passed"); // unity 80, quorum 20
  });

  it("unity short of the bar fails", () => {
    expect(evaluateBallot({ ...custom, tallies: t(15, 5) })).toBe("failed"); // unity 75
  });

  it("quorum short answers no_quorum, whatever the votes said", () => {
    expect(evaluateBallot({ ...custom, tallies: t(19, 0) })).toBe("no_quorum"); // 19% turnout, unanimous
  });

  it("abstain drags a ballot over quorum without touching unity", () => {
    // 8 yes + 2 no is 10% turnout: dead. 10 abstains double it: alive, and
    // unity is still 80.
    expect(evaluateBallot({ ...custom, tallies: t(8, 2) })).toBe("no_quorum");
    expect(evaluateBallot({ ...custom, tallies: t(8, 2, 10) })).toBe("passed");
  });

  it("majority is strictly more than half", () => {
    const majority = { method: "majority" as const, unityPct: 50, quorumPct: 20, totalWeight: 100 };
    expect(evaluateBallot({ ...majority, tallies: t(11, 10) })).toBe("passed");
    expect(evaluateBallot({ ...majority, tallies: t(10, 10) })).toBe("failed"); // a tie is not a majority
    expect(evaluateBallot({ ...majority, tallies: t(10, 11) })).toBe("failed");
  });

  it("consensus is everyone who took a side, and at least one yes", () => {
    const consensus = { method: "consensus" as const, unityPct: 100, quorumPct: 20, totalWeight: 100 };
    expect(evaluateBallot({ ...consensus, tallies: t(20, 0) })).toBe("passed");
    expect(evaluateBallot({ ...consensus, tallies: t(19, 1) })).toBe("failed");
    expect(evaluateBallot({ ...consensus, tallies: t(0, 0, 25) })).toBe("failed"); // all abstain: quorum met, nobody agreed
  });

  it("consent ignores unity and turns on standing objections", () => {
    const consent = { method: "consent" as const, unityPct: 0, quorumPct: 20, totalWeight: 100 };
    expect(evaluateBallot({ ...consent, tallies: t(1, 19), openObjections: 0 })).toBe("passed");
    expect(evaluateBallot({ ...consent, tallies: t(19, 1), openObjections: 1 })).toBe("failed");
    expect(evaluateBallot({ ...consent, tallies: t(5, 0), openObjections: 0 })).toBe("no_quorum");
  });

  it("the zero edges: an empty ballot is no_quorum, never a crash or a pass", () => {
    expect(evaluateBallot({ ...custom, tallies: t(0, 0) })).toBe("no_quorum");
    expect(evaluateBallot({ ...custom, totalWeight: 0, tallies: t(0, 0) })).toBe("no_quorum");
  });

  it("weighted votes: one heavy voter can carry unity and sink quorum", () => {
    // 90 of the 100 weight sits with one member who stayed home.
    expect(evaluateBallot({ ...custom, tallies: t(10, 0) })).toBe("no_quorum");
    // The heavy member alone IS quorum and unity.
    expect(evaluateBallot({ ...custom, tallies: t(90, 0) })).toBe("passed");
  });
});

describe("decidesBy presets", () => {
  it("maps the conductable methods and routes hypha to the shipped leg", () => {
    expect(methodForDecidesBy("majority")).toBe("majority");
    expect(methodForDecidesBy("consensus")).toBe("consensus");
    expect(methodForDecidesBy("consent")).toBe("consent");
    expect(methodForDecidesBy("custom")).toBe("custom");
    expect(methodForDecidesBy("hypha")).toBe("hypha");
  });

  it("answers null where the named decider records the outcome themselves", () => {
    for (const id of ["lead_decides", "elders_decide", "founder_decides", "do_ocracy", "delegated", "other"]) {
      expect(methodForDecidesBy(id)).toBeNull();
    }
  });

  /*
   * The route that opened the first ballot carried its own inline copy of the
   * method list while this function sat exported and uncalled. Two copies of
   * one rule disagree eventually, and a disagreement about the method is a
   * disagreement about what passing MEANS. These cases pin the one rule that
   * both village-wide open routes now read.
   */
  it("resolves every setting `governance.default_method` can hold", () => {
    expect(villageBallotMethod("majority")).toBe("majority");
    expect(villageBallotMethod("consensus")).toBe("consensus");
    expect(villageBallotMethod("consent")).toBe("consent");
    expect(villageBallotMethod("custom")).toBe("custom");
    expect(villageBallotMethod("hypha")).toBe("hypha");
  });

  it("falls to the village's own dials for anything it does not recognise", () => {
    // The conservative direction: a stored value nobody recognises decides by
    // the numbers the village actually set, never by a preset those numbers
    // were never checked against.
    for (const stored of ["", "lead_decides", "delegated", "other", "MAJORITY", "sortition"]) {
      expect(villageBallotMethod(stored), stored).toBe("custom");
    }
    expect(villageBallotMethod(undefined as unknown as string)).toBe("custom");
  });

  it("presets fix what the method's sentence fixes and take the rest from the village", () => {
    const village = { unityPct: 80, quorumPct: 20 };
    expect(dialsForMethod("majority", village)).toEqual({ unityPct: 50, quorumPct: 20 });
    expect(dialsForMethod("consensus", village)).toEqual({ unityPct: 100, quorumPct: 20 });
    expect(dialsForMethod("consent", village)).toEqual({ unityPct: 0, quorumPct: 20 });
    expect(dialsForMethod("custom", village)).toEqual({ unityPct: 80, quorumPct: 20 });
  });
});

/**
 * WHAT AN ABSTENTION IS, PER SUBJECT (the founder's Q3 ruling, 2026-09-02).
 *
 * The Hypha rule stays the default and every case above still holds under it.
 * A subject whose own sentence is "everybody has to say yes" asks for the
 * other reading, and these cases pin that the two readings are genuinely
 * different arithmetic and not a relabelling.
 */
describe("the abstain policy", () => {
  it("keeps the Hypha rule when nobody asks for anything else", () => {
    expect(quorumPctOf(t(1, 0, 1), 3)).toBeCloseTo(66.667, 2);
    expect(quorumPctOf(t(1, 0, 1), 3, "counts_toward_quorum")).toBeCloseTo(66.667, 2);
  });

  it("leaves an abstention out of quorum entirely under no_answer", () => {
    // The same ballot, read the other way: one yes, one abstention, three
    // seats. Under the Hypha rule two of three took part; under no_answer
    // only one of them answered.
    expect(quorumPctOf(t(1, 0, 1), 3, "no_answer")).toBeCloseTo(33.333, 2);
    // With nobody abstaining the two readings cannot differ.
    expect(quorumPctOf(t(2, 1, 0), 3, "no_answer")).toBe(100);
    expect(quorumPctOf(t(2, 1, 0), 3, "counts_toward_quorum")).toBe(100);
  });

  it("never touches unity, which is yes over yes plus no under either reading", () => {
    expect(unityPctOf(t(2, 0, 5))).toBe(100);
  });

  it("turns a 100/100 ballot with one abstention from passed into no_quorum", () => {
    const dials = { unityPct: 100, quorumPct: 100, totalWeight: 3 } as const;
    const tallies = t(2, 0, 1);
    // The rule as it shipped: everybody answered, nobody objected, it carried.
    expect(evaluateBallot({ method: "custom", ...dials, tallies })).toBe("passed");
    // The rule the founder asked for: an abstention is not an answer, so the
    // village is short of participation and can be asked again.
    expect(evaluateBallot({ method: "custom", ...dials, tallies, abstainPolicy: "no_answer" })).toBe("no_quorum");
  });
});

describe("the yes-head floor", () => {
  it("asks for nothing when the subject asks for nothing", () => {
    expect(requiredYesHeads(undefined, 5)).toBeNull();
    expect(requiredYesHeads(0, 5)).toBeNull();
  });

  it("reads `all` off the frozen roll, and a number as itself", () => {
    expect(requiredYesHeads("all", 7)).toBe(7);
    expect(requiredYesHeads("all", undefined)).toBe(0);
    expect(requiredYesHeads(3, 7)).toBe(3);
  });

  it("fails a ballot that met both dials on weight and is short of yes heads", () => {
    /*
     * The case the weighted arithmetic cannot see: one heavy member and two
     * light ones, quorum and unity both satisfied by two of the three, and a
     * subject that asked for all three to say yes.
     */
    const input = {
      method: "custom" as const,
      unityPct: 80,
      quorumPct: 50,
      totalWeight: 12,
      tallies: t(11, 0, 0),
    };
    expect(evaluateBallot(input)).toBe("passed");
    expect(
      evaluateBallot({
        ...input,
        minYesHeads: "all",
        heads: { yesHeads: 2, noHeads: 0, abstainHeads: 0, electorateCount: 3 },
      }),
    ).toBe("failed");
    expect(
      evaluateBallot({
        ...input,
        minYesHeads: "all",
        heads: { yesHeads: 3, noHeads: 0, abstainHeads: 0, electorateCount: 3 },
      }),
    ).toBe("passed");
  });

  it("fails closed when a subject asks for heads and the caller hands none", () => {
    // Skipping the rule silently would mean a subject whose stated rule is
    // not conducted by the only function that decides.
    expect(
      evaluateBallot({
        method: "custom",
        unityPct: 0,
        quorumPct: 0,
        totalWeight: 3,
        tallies: t(3, 0, 0),
        minYesHeads: "all",
      }),
    ).toBe("failed");
  });

  it("is checked after quorum, so too few people is still no_quorum", () => {
    expect(
      evaluateBallot({
        method: "custom",
        unityPct: 100,
        quorumPct: 100,
        totalWeight: 3,
        tallies: t(1, 0, 0),
        minYesHeads: "all",
        heads: { yesHeads: 1, noHeads: 0, abstainHeads: 0, electorateCount: 3 },
      }),
    ).toBe("no_quorum");
  });
});

describe("criticality tiers", () => {
  it("ladders from routine to constitutional, and the floors only rise with it", () => {
    expect(CRITICALITIES).toEqual(["routine", "structural", "constitutional"]);
    let last = { unityPct: -1, quorumPct: -1 };
    for (const c of CRITICALITIES) {
      expect(TIER_FLOORS[c].unityPct, c).toBeGreaterThanOrEqual(last.unityPct);
      expect(TIER_FLOORS[c].quorumPct, c).toBeGreaterThanOrEqual(last.quorumPct);
      last = TIER_FLOORS[c];
    }
  });

  it("asks nothing of a routine change, so a village keeps its own dials", () => {
    expect(TIER_FLOORS.routine).toEqual({ unityPct: 0, quorumPct: 0 });
    expect(raiseDials({ unityPct: 80, quorumPct: 20 }, TIER_FLOORS.routine)).toEqual({ unityPct: 80, quorumPct: 20 });
  });

  it("asks 97 and 97 of the most critical tier, which is the founder's number", () => {
    expect(TIER_FLOORS.constitutional).toEqual({ unityPct: 97, quorumPct: 97 });
    expect(RECOMMENDED_CEILING_PCT).toBe(97);
  });

  it("raises each dial on its own, so a floor never lowers half a pair", () => {
    expect(raiseDials({ unityPct: 100, quorumPct: 10 }, { unityPct: 80, quorumPct: 50 })).toEqual({
      unityPct: 100,
      quorumPct: 50,
    });
  });

  it("prices a list at its most critical element, and an empty list at routine", () => {
    expect(highestCriticality([])).toBe("routine");
    expect(highestCriticality(["routine", "routine"])).toBe("routine");
    expect(highestCriticality(["routine", "constitutional", "structural"])).toBe("constitutional");
    expect(highestCriticality(["structural", "routine"])).toBe("structural");
  });
});

describe("the stalemate warning above the recommended ceiling", () => {
  it("says nothing at or below 97, which is where the platform recommends stopping", () => {
    expect(stalemateWarning(50)).toBeNull();
    expect(stalemateWarning(96)).toBeNull();
    expect(stalemateWarning(97)).toBeNull();
  });

  it("warns above it, and says why in plain words a player can act on", () => {
    const w = stalemateWarning(100);
    expect(w).toBeTruthy();
    expect(w).toContain("stalemate");
    expect(w).toContain("97");
    // The founder's own reason, in the sentence: somebody leaving can freeze
    // a Game the rest of the village wants to continue.
    expect(w).toContain("freezes a Game");
    expect(stalemateWarning(97.5)).toBeTruthy();
  });

  it("never warns about a number that is not a number", () => {
    expect(stalemateWarning(Number.NaN)).toBeNull();
  });
});

/**
 * PEOPLE BESIDE WEIGHT (19F). The founder ruled that quorum stays pure token
 * weight and that people counts are shown beside it everywhere. These pin the
 * arithmetic and the sentences, including the case the audit raised: a bar
 * that is three people in one village and everybody in another.
 */
describe("people beside weight", () => {
  /** Nine seats. Three of them hold 97 of the 100 weight between them. */
  const concentrated = [
    { weight: 40 },
    { weight: 32 },
    { weight: 25 },
    { weight: 0.5 },
    { weight: 0.5 },
    { weight: 0.5 },
    { weight: 0.5 },
    { weight: 0.5 },
    { weight: 0.5 },
  ];
  /** Nine seats under one person one vote, where every seat weighs one. */
  const equalNine = Array.from({ length: 9 }, () => ({ weight: 1 }));

  it("totals the roll's weight and floors a negative seat, the way openBallot does", () => {
    expect(totalWeightOf(concentrated)).toBe(100);
    expect(totalWeightOf([{ weight: 3 }, { weight: -5 }])).toBe(3);
  });

  it("counts the fewest holders of a share, biggest first", () => {
    expect(fewestHoldersFor(concentrated, 97)).toBe(3);
    expect(fewestHoldersFor(concentrated, 40)).toBe(1);
    expect(fewestHoldersFor(concentrated, 100)).toBe(9);
    expect(fewestHoldersFor(concentrated, 0)).toBe(0);
  });

  it("counts in heads when every seat weighs the same, which is what equal mode is", () => {
    expect(fewestHoldersFor(equalNine, 97)).toBe(9);
    expect(fewestHoldersFor(equalNine, 50)).toBe(5);
    expect(everySeatWeighsAlike(equalNine)).toBe(true);
    expect(everySeatWeighsAlike(concentrated)).toBe(false);
  });

  it("says it could not tell on a roll carrying no weight, and never says nobody", () => {
    expect(fewestHoldersFor([{ weight: 0 }, { weight: 0 }], 50)).toBeNull();
    expect(fewestHoldersFor([], 50)).toBeNull();
  });

  it("a 97/97 tier is satisfied by weight alone, and the sentence says how many people that is today", () => {
    const dials = { unityPct: 97, quorumPct: 97 };
    // The engine's own answer: three seats holding 97 of 100 carry it.
    expect(
      evaluateBallot({
        method: "custom",
        unityPct: 97,
        quorumPct: 97,
        totalWeight: 100,
        tallies: t(97, 0),
      }),
    ).toBe("passed");
    const sentence = thresholdSentence(dials, concentrated);
    expect(sentence).toContain("97% of the weight must show up");
    expect(sentence).toContain("at least 3 of 9 people");
    expect(sentence).toContain("3 people hold 97% of the weight");
  });

  it("under equal mode the same tier reads in heads, and it is the whole roll", () => {
    const dials = { unityPct: 97, quorumPct: 97 };
    const sentence = thresholdSentence(dials, equalNine);
    expect(sentence).toContain("at least 9 of 9 people");
    expect(sentence).toContain("every seat weighs the same");
    expect(peopleAndWeightFor(dials, equalNine).needsEveryone).toBe(true);
    expect(peopleAndWeightFor(dials, concentrated).needsEveryone).toBe(false);
  });

  it("fires the stalemate warning whenever a tier rounds to the whole roll, and stays quiet otherwise", () => {
    const dials = { unityPct: 97, quorumPct: 97 };
    const warning = wholeRollWarning(dials, equalNine);
    /*
     * THRESHOLDS-FIX, 19G. The count in this sentence was "on the roll" and is
     * now "this count reaches", because a roll can carry seats whose weight is
     * outside the quorum arithmetic. On a roll of nine ordinary members the
     * two are the same nine, which is what this line pins.
     */
    expect(warning).toContain("every one of the 9 people this count reaches");
    expect(wholeRollWarning(dials, concentrated)).toBeNull();
  });

  it("keeps the founder's above-97 warning as a warning, on any roll", () => {
    // The audit asked for a refusal above 97. His ruling is a warning, and
    // this pins that nothing here refuses.
    expect(stalemateWarning(98)).toContain("stalemate");
    expect(stalemateWarning(97)).toBeNull();
  });

  it("says a ballot's state in people and in weight", () => {
    expect(
      participationSentence({ peopleVoted: 3, people: 9, weightVoted: 97, totalWeight: 100 }),
    ).toBe("3 of 9 people voted, holding 97% of the weight.");
    expect(
      participationSentence({ peopleVoted: 1, people: 1, weightVoted: 1, totalWeight: 1 }),
    ).toBe("1 of 1 person voted, holding 100% of the weight.");
  });

  it("distinguishes a weightless roll from an empty one, and never prints a share of zero", () => {
    expect(
      participationSentence({ peopleVoted: 2, people: 9, weightVoted: 0, totalWeight: 0 }),
    ).toContain("no weight today");
    expect(thresholdSentence({ unityPct: 80, quorumPct: 20 }, [])).toContain("no roll to count against");
    expect(thresholdSentence({ unityPct: 80, quorumPct: 20 }, [{ weight: 0 }])).toContain(
      "cannot say how many people that is",
    );
  });
});

/**
 * ── VOICE FOR OTHER BEINGS, AND THE QUORUM (19G) ────────────────────────────
 *
 * Red before the arithmetic existed: a village that seats a river holding a
 * quarter of the Voice put that quarter in every quorum denominator, and four
 * such seats froze the top tier with nothing anywhere saying why.
 */
describe("whose weight the quorum counts", () => {
  const river = { weight: 25, nonHuman: true };
  const roll = [{ weight: 25 }, { weight: 25 }, { weight: 25 }, river];

  it("leaves a seat speaking for a being out of both sides of the fraction, by default", () => {
    const base = quorumBaseOf(roll);
    expect(base.totalWeight).toBe(100);
    expect(base.baseWeight).toBe(75);
    expect(base.excludedWeight).toBe(25);
    expect(base.excludedPeople).toBe(1);
    expect(base.speaksForABeing).toBe(1);
    expect(base.votablePeople).toBe(3);
  });

  it("counts it like any member's when the village says so", () => {
    const base = quorumBaseOf(roll, { nonHumanInQuorum: true });
    expect(base.baseWeight).toBe(100);
    expect(base.excludedWeight).toBe(0);
  });

  it("drops weight that provably cannot answer, once such seats are counted", () => {
    const silent = [{ weight: 25 }, { weight: 25 }, { weight: 25 }, { ...river, canVote: false }];
    const base = quorumBaseOf(silent, { nonHumanInQuorum: true });
    expect(base.baseWeight).toBe(75);
    expect(base.cannotVote).toBe(1);
    expect(base.speaksForABeing).toBe(0);
  });

  it("treats an unasked seat as able to answer, so 'we did not look' never reads as 'it cannot'", () => {
    expect(quorumBaseOf([{ weight: 10 }]).baseWeight).toBe(10);
  });

  it("decides an outcome on the reduced base when one is handed in", () => {
    // 75 of 100 answered. Against the whole roll that is 75% and misses a 90%
    // bar; against the base the river is out of, it is everything there is.
    const shared = {
      method: "custom" as const,
      unityPct: 80,
      quorumPct: 90,
      totalWeight: 100,
      tallies: { yesW: 75, noW: 0, abstainW: 0 },
    };
    expect(evaluateBallot(shared)).toBe("no_quorum");
    expect(evaluateBallot({ ...shared, quorum: { answeredWeight: 75, baseWeight: 75 } })).toBe("passed");
  });

  it("reads no quorum when every seat that could carry it is outside the count", () => {
    expect(
      evaluateBallot({
        method: "custom",
        unityPct: 80,
        quorumPct: 20,
        totalWeight: 100,
        tallies: { yesW: 100, noW: 0, abstainW: 0 },
        quorum: { answeredWeight: 0, baseWeight: 0 },
      }),
    ).toBe("no_quorum");
  });

  it("counts the fewest people against the seats the bar can actually reach", () => {
    // Three equal members and a river. 100% of the count is the three of them.
    const r = peopleAndWeightFor({ unityPct: 80, quorumPct: 100 }, roll);
    expect(r.people).toBe(4);
    expect(r.fewestForQuorum).toBe(3);
    expect(r.needsEveryone).toBe(true);
    expect(r.quorumBase.excludedWeight).toBe(25);
  });

  it("says the excluded weight beside the people count, on a bar and on a ballot", () => {
    const sentence = thresholdSentence({ unityPct: 80, quorumPct: 50 }, roll);
    expect(sentence).toContain("of 4 people");
    expect(sentence).toContain("speaks for a being that is not a person");
    expect(sentence).toContain("25% of the weight, and that weight is outside this count");
    const state = participationSentence({
      peopleVoted: 2,
      people: 4,
      weightVoted: 50,
      totalWeight: 75,
      excluded: quorumBaseOf(roll),
    });
    expect(state).toContain("2 of 4 people voted");
    expect(state).toContain("outside this count");
  });

  it("says nothing extra when every seat's weight is in the count", () => {
    expect(thresholdSentence({ unityPct: 80, quorumPct: 50 }, [{ weight: 1 }, { weight: 1 }])).not.toContain(
      "outside this count",
    );
    expect(excludedWeightClause(quorumBaseOf([{ weight: 1 }]))).toBe("");
  });

  it("warns when the weight that votes cannot add up to the bar, computed and never tested against 97", () => {
    // Four beings holding a quarter, a bar of 90, and every dial inside the
    // range the founder recommends. `stalemateWarning` cannot see this.
    const stranded = [
      { weight: 75 },
      { weight: 10, nonHuman: true },
      { weight: 15, nonHuman: true },
    ];
    const dials = { unityPct: 80, quorumPct: 90 };
    expect(stalemateWarning(dials.quorumPct)).toBeNull();
    const warning = reachableQuorumWarning(dials, stranded);
    expect(warning).toContain("75% of the weight");
    expect(warning).toContain("asks for 90%");
    expect(warning).toContain("2 seats hold");
  });

  it("stays quiet when the weight that votes can still reach the bar", () => {
    expect(reachableQuorumWarning({ unityPct: 80, quorumPct: 50 }, [
      { weight: 75 },
      { weight: 25, nonHuman: true },
    ])).toBeNull();
    expect(reachableQuorumWarning({ unityPct: 80, quorumPct: 100 }, [{ weight: 3 }])).toBeNull();
  });

  it("names the seats the whole-roll warning actually asks for", () => {
    const warning = wholeRollWarning({ unityPct: 80, quorumPct: 100 }, roll);
    expect(warning).toContain("every one of the 3 people this count reaches");
  });
});
