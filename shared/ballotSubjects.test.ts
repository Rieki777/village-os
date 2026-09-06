/**
 * The per-subject threshold seam (R68), and the three properties that make it
 * a seam and not a special case for launch:
 *
 *  - a subject the registry does not name behaves exactly as it does today;
 *  - a floor RAISES and never lowers, so a village that asks for more keeps
 *    its own number;
 *  - the stamped dials are the dials the evaluator actually reads, which is
 *    the whole reason a subject may fix its method.
 *
 * The last describe block adds a fourth: a roll of three HEADS is not the same
 * fact as a roll of three VOICES, and on a 100/100 subject only the second one
 * makes the frozen document true.
 */
import { describe, expect, it } from "vitest";
import {
  consecutiveNoQuorum,
  criticalityOfItems,
  delegatedRowsCountOn,
  delegationRefusalSentence,
  dialsForSubject,
  electorateFloorProblem,
  evaluationRulesFor,
  floorForCriticality,
  floorForSubject,
  highestTier,
  highestTierFrom,
  isMetaSetting,
  metaSettingTrialRefusal,
  methodForSubject,
  methodForSubjects,
  overrideDials,
  quorumMissReading,
  rerunOffer,
  rollProblem,
  stalemateWarningFor,
  subjectInPeople,
  thresholdChangePrice,
  thresholdSettingsFrom,
  thresholdsFor,
  thresholdsForSubject,
  tierInPeople,
  weightFloorProblem,
  CHANGE_ITEM_KINDS,
  HIGHEST_TIER_KEY,
  NO_QUORUM_ENDED,
  SELF_PRICED_THRESHOLD_KEYS,
  CRITICALITY_FOR_ITEM_KIND,
  GOVERNANCE_MODE,
  MINT_RULE,
  SUBJECT_FOR_ITEM_KIND,
  SUBJECT_SETTING_KEYS,
  SUBJECT_THRESHOLDS,
  THRESHOLD_PERCENT_KEYS,
  TIER_SETTING_KEYS,
  VILLAGE_LAUNCH,
} from "./ballotSubjects";
import {
  dialsForMethod,
  evaluateBallot,
  quorumPctOf,
  unityPctOf,
  CRITICALITIES,
  TIER_FLOORS,
  type BallotMethod,
} from "./governanceEngine";

const village = { unityPct: 80, quorumPct: 20 };

describe("per-subject thresholds", () => {
  it("leaves an unnamed subject exactly where it is today", () => {
    for (const method of ["custom", "majority", "consensus", "consent"] as BallotMethod[]) {
      expect(dialsForSubject("mechanics", method, village)).toEqual(dialsForMethod(method, village));
      expect(dialsForSubject("advisory", method, village)).toEqual(dialsForMethod(method, village));
    }
    expect(thresholdsForSubject("mechanics")).toBeNull();
    expect(methodForSubject("mechanics", "consent")).toBe("consent");
    expect(methodForSubject("mechanics", "hypha")).toBe("hypha");
    expect(electorateFloorProblem("mechanics", 1)).toBeNull();
  });

  it("raises the launch ballot to 100 and 100", () => {
    expect(dialsForSubject(VILLAGE_LAUNCH, "custom", village)).toEqual({ unityPct: 100, quorumPct: 100 });
  });

  it("never lowers a village that asks for more than the floor", () => {
    // A floor is a minimum. A village at 100/100 on everything keeps its own
    // numbers, and a floor below them changes nothing.
    const strict = { unityPct: 100, quorumPct: 100 };
    expect(dialsForSubject(VILLAGE_LAUNCH, "custom", strict)).toEqual(strict);
    expect(dialsForSubject("mechanics", "custom", strict)).toEqual(strict);
  });

  it("fixes the launch method, so the frozen numbers are the numbers that decide", () => {
    // The defect this exists to stop: a village on `majority` would freeze
    // 100/100 into the row and `evaluateBallot` would carry it at 51%.
    expect(methodForSubject(VILLAGE_LAUNCH, "majority")).toBe("custom");
    expect(methodForSubject(VILLAGE_LAUNCH, "consent")).toBe("custom");
    // A village that decides its rule changes on Hypha still starts its own
    // Game here. There is no chain leg for a village beginning.
    expect(methodForSubject(VILLAGE_LAUNCH, "hypha")).toBe("custom");

    const method = methodForSubject(VILLAGE_LAUNCH, "majority") as BallotMethod;
    const dials = dialsForSubject(VILLAGE_LAUNCH, method, village);
    // Three members, one silent: 2 of 3 weight voted, so quorum is 66.7.
    expect(
      evaluateBallot({
        method,
        ...dials,
        totalWeight: 3,
        tallies: { yesW: 2, noW: 0, abstainW: 0 },
      }),
    ).toBe("no_quorum");
    // Everybody voted, one against.
    expect(
      evaluateBallot({
        method,
        ...dials,
        totalWeight: 3,
        tallies: { yesW: 2, noW: 1, abstainW: 0 },
      }),
    ).toBe("failed");
    // Everybody voted, everybody agreed.
    expect(
      evaluateBallot({
        method,
        ...dials,
        totalWeight: 3,
        tallies: { yesW: 3, noW: 0, abstainW: 0 },
      }),
    ).toBe("passed");
  });

  /*
   * REWRITTEN 2026-09-02. This case used to read "two yes and one abstain
   * carries", and it pinned a documented decision: abstain is defined once in
   * the engine and a subject floor does not get to redefine it, so a launch
   * carried on two yes votes and one abstention.
   *
   * The founder's Q3 ruling makes that the wrong rule for THIS subject: "we
   * need 100% saying yes as a collective Birthing moment". So the subject now
   * carries its own abstain policy and its own yes-head floor, the engine
   * still owns the arithmetic, and the case is rewritten to what the Birthing
   * actually asks. Every other subject is unchanged and the case below proves
   * it on the same numbers.
   */
  it("does NOT carry the Birthing on an abstention, because an abstention is not a yes", () => {
    const method = methodForSubject(VILLAGE_LAUNCH, "custom") as BallotMethod;
    const dials = dialsForSubject(VILLAGE_LAUNCH, method, village);
    const rules = evaluationRulesFor(VILLAGE_LAUNCH);
    // Three on the roll, all three answered, one took no side. It is short of
    // participation, which is a question not yet answered rather than a no,
    // so the village can be asked again on a fresh freeze.
    expect(
      evaluateBallot({
        method,
        ...dials,
        totalWeight: 3,
        tallies: { yesW: 2, noW: 0, abstainW: 1 },
        abstainPolicy: rules.abstainPolicy,
        minYesHeads: rules.minYesHeads,
        heads: { yesHeads: 2, noHeads: 0, abstainHeads: 1, electorateCount: 3 },
      }),
    ).toBe("no_quorum");
    // A vote nobody cast does not carry it either.
    expect(
      evaluateBallot({
        method,
        ...dials,
        totalWeight: 3,
        tallies: { yesW: 2, noW: 0, abstainW: 0 },
        abstainPolicy: rules.abstainPolicy,
        minYesHeads: rules.minYesHeads,
        heads: { yesHeads: 2, noHeads: 0, abstainHeads: 0, electorateCount: 3 },
      }),
    ).toBe("no_quorum");
    // Every seat says yes and it carries, which is the whole of the ruling.
    expect(
      evaluateBallot({
        method,
        ...dials,
        totalWeight: 3,
        tallies: { yesW: 3, noW: 0, abstainW: 0 },
        abstainPolicy: rules.abstainPolicy,
        minYesHeads: rules.minYesHeads,
        heads: { yesHeads: 3, noHeads: 0, abstainHeads: 0, electorateCount: 3 },
      }),
    ).toBe("passed");
  });

  it("leaves the Hypha abstain rule exactly where it is on every other subject", () => {
    // The same numbers on an ordinary rule change: two yes, one abstention,
    // 100% quorum asked for. The abstention carries it to quorum and takes no
    // side, which is what it has always done and still does.
    const strict = { unityPct: 100, quorumPct: 100 };
    const dials = dialsForSubject("mechanics", "custom", strict);
    const rules = evaluationRulesFor("mechanics");
    expect(rules).toEqual({ abstainPolicy: "counts_toward_quorum", minYesHeads: undefined });
    expect(
      evaluateBallot({
        method: "custom",
        ...dials,
        totalWeight: 3,
        tallies: { yesW: 2, noW: 0, abstainW: 1 },
        abstainPolicy: rules.abstainPolicy,
        minYesHeads: rules.minYesHeads,
      }),
    ).toBe("passed");
  });

  it("says how many more members before a launch vote can open", () => {
    expect(electorateFloorProblem(VILLAGE_LAUNCH, 0)).toContain("3 more members");
    expect(electorateFloorProblem(VILLAGE_LAUNCH, 1)).toBe(
      "One member holds a voice in this village today. 2 more members and the village can vote to start its Game.",
    );
    expect(electorateFloorProblem(VILLAGE_LAUNCH, 2)).toContain("One more member");
    expect(electorateFloorProblem(VILLAGE_LAUNCH, 3)).toBeNull();
    expect(electorateFloorProblem(VILLAGE_LAUNCH, 40)).toBeNull();
  });

  it("keeps every registry entry sane, whatever a later lane adds", () => {
    for (const [subject, t] of Object.entries(SUBJECT_THRESHOLDS)) {
      expect(subject.length, subject).toBeLessThanOrEqual(24); // ballots.subject_type is varchar(24)
      expect(t.minUnityPct, subject).toBeGreaterThanOrEqual(0);
      expect(t.minUnityPct, subject).toBeLessThanOrEqual(100);
      expect(t.minQuorumPct, subject).toBeGreaterThanOrEqual(0);
      expect(t.minQuorumPct, subject).toBeLessThanOrEqual(100);
      expect(t.minElectorate, subject).toBeGreaterThanOrEqual(0);
      expect(t.why.trim().length, subject).toBeGreaterThan(0);
      /*
       * A floor above 50 on a subject that has NOT fixed its method is the
       * defect this whole file exists to stop: `majority` and `consent` ignore
       * `unity_pct`, so the number would be frozen, rendered and never read.
       */
      if (t.minUnityPct > 50) expect(t.method, subject).toBe("custom");
      /*
       * A subject that asks for 100% QUORUM and does not also ask every seat
       * to weigh something is asking a question its own answer cannot make
       * true: `quorumPctOf` divides by the frozen total weight, so a roll
       * carrying zero-weight seats reaches 100% without them. The bypass this
       * clause exists to stop is measured directly two describes down.
       */
      if (t.minQuorumPct >= 100) expect(t.everySeatWeighs, subject).toBe(true);
    }
  });
});

describe("a roll of three heads is not a roll of three voices", () => {
  const seats = (...weights: number[]) => weights.map((weight) => ({ weight }));

  it("REPRODUCES the bypass the weight floor closes, in arithmetic", () => {
    /*
     * Measured against the shipped engine on 2026-08-30. Custom weight mode,
     * the founder allocated 1 and nobody else allocated at all. Every guard
     * that existed passes and one person carries the vote.
     */
    const roll = seats(1, 0, 0);
    const totalWeight = roll.reduce((s, e) => s + e.weight, 0);
    expect(electorateFloorProblem(VILLAGE_LAUNCH, roll.length)).toBeNull(); // three heads
    expect(roll.length).toBeGreaterThan(0); // openBallot's roll guard
    expect(totalWeight).toBeGreaterThan(0); // openBallot's weight guard

    const method = methodForSubject(VILLAGE_LAUNCH, "custom") as BallotMethod;
    const dials = dialsForSubject(VILLAGE_LAUNCH, method, { unityPct: 80, quorumPct: 20 });
    const tallies = { yesW: 1, noW: 0, abstainW: 0 }; // the founder alone
    expect(quorumPctOf(tallies, totalWeight)).toBe(100);
    expect(unityPctOf(tallies)).toBe(100);
    expect(evaluateBallot({ method, ...dials, totalWeight, tallies })).toBe("passed");

    // And the one thing that now stands between that roll and this engine.
    expect(rollProblem(VILLAGE_LAUNCH, roll)).toContain("no voting weight");
  });

  it("says how many seats weigh nothing, in words, and counts them right", () => {
    expect(weightFloorProblem(VILLAGE_LAUNCH, seats(1, 0, 0))).toBe(
      "2 of the 3 members on the roll carry no voting weight today. " +
        "This vote asks every one of them, so it opens once each of them carries some weight.",
    );
    expect(weightFloorProblem(VILLAGE_LAUNCH, seats(1, 1, 0))).toContain("One of the 3 members");
    expect(weightFloorProblem(VILLAGE_LAUNCH, seats(1, 1, 1))).toBeNull();
  });

  it("treats a negative or unset weight as no weight, because both are", () => {
    expect(weightFloorProblem(VILLAGE_LAUNCH, seats(1, 1, -3))).toContain("One of the 3");
    expect(weightFloorProblem(VILLAGE_LAUNCH, [{ weight: Number.NaN }, { weight: 1 }, { weight: 1 }])).toContain(
      "One of the 3",
    );
  });

  it("does NOT flatten weight: skew is the village's business, zero is not", () => {
    // R56. An allocation of 100/5/1 opens, because 100% quorum still needs all
    // three to answer and 100% unity still needs none of them to object.
    const roll = seats(100, 5, 1);
    expect(rollProblem(VILLAGE_LAUNCH, roll)).toBeNull();
    const method = methodForSubject(VILLAGE_LAUNCH, "custom") as BallotMethod;
    const dials = dialsForSubject(VILLAGE_LAUNCH, method, { unityPct: 80, quorumPct: 20 });
    const totalWeight = 106;
    // The heaviest member alone: 100 of 106 is not everybody.
    expect(evaluateBallot({ method, ...dials, totalWeight, tallies: { yesW: 100, noW: 0, abstainW: 0 } })).toBe(
      "no_quorum",
    );
    // Everybody answers, the lightest objects: 100/101 is not unanimous.
    expect(evaluateBallot({ method, ...dials, totalWeight, tallies: { yesW: 105, noW: 1, abstainW: 0 } })).toBe(
      "failed",
    );
    expect(evaluateBallot({ method, ...dials, totalWeight, tallies: { yesW: 106, noW: 0, abstainW: 0 } })).toBe(
      "passed",
    );
  });

  it("asks the head count FIRST, so a young village hears the kinder fact", () => {
    // Two members, neither allocated. Both things are true; "one more member"
    // is the one that says what to do next.
    expect(rollProblem(VILLAGE_LAUNCH, seats(0, 0))).toContain("One more member");
  });

  it("asks nothing of a subject that did not ask for it", () => {
    expect(weightFloorProblem("mechanics", seats(0, 0, 0))).toBeNull();
    expect(rollProblem("mechanics", seats(0, 0, 0))).toBeNull();
    // mint_rule raises quorum to 50 and deliberately keeps no roll floor.
    expect(weightFloorProblem("mint_rule", seats(1, 0))).toBeNull();
  });
});


/**
 * THE FLOORS ARE SETTINGS NOW, AND THE REGISTRY IS THE FLOOR UNDER THEM.
 *
 * Section 7A's rule is that a governance number must be changeable without a
 * deploy. These cases pin the half that makes it safe: the setting can only
 * ever raise the platform's own number, in both layers that read it.
 */
describe("threshold settings, with the registry as floors", () => {
  const village = { unityPct: 80, quorumPct: 20 };
  const settingsOf = (values: Record<string, number>) => thresholdSettingsFrom((key) => values[key] ?? 0);

  it("falls back to the registry when a village has set nothing", () => {
    const registry = settingsOf({});
    for (const c of CRITICALITIES) expect(registry.tiers[c], c).toEqual(TIER_FLOORS[c]);
    expect(registry.subjects[MINT_RULE]).toEqual({
      unityPct: SUBJECT_THRESHOLDS[MINT_RULE].minUnityPct,
      quorumPct: SUBJECT_THRESHOLDS[MINT_RULE].minQuorumPct,
    });
  });

  it("REFUSES to be lowered, whatever is stored, on every tier and every subject", () => {
    const sabotaged = settingsOf({
      [TIER_SETTING_KEYS.constitutional.unity]: 10,
      [TIER_SETTING_KEYS.constitutional.quorum]: 10,
      [TIER_SETTING_KEYS.structural.unity]: 0,
      [TIER_SETTING_KEYS.structural.quorum]: 0,
      [SUBJECT_SETTING_KEYS[MINT_RULE].quorum]: 1,
    });
    expect(sabotaged.tiers.constitutional).toEqual(TIER_FLOORS.constitutional);
    expect(sabotaged.tiers.structural).toEqual(TIER_FLOORS.structural);
    expect(sabotaged.subjects[MINT_RULE].quorumPct).toBe(SUBJECT_THRESHOLDS[MINT_RULE].minQuorumPct);
  });

  it("lets a village RAISE a tier, and the raise reaches the ballot", () => {
    const raised = settingsOf({ [TIER_SETTING_KEYS.structural.quorum]: 75 });
    expect(floorForCriticality("structural", raised).quorumPct).toBe(75);
    expect(floorForCriticality("routine", raised)).toEqual(TIER_FLOORS.routine);
  });

  it("lets a village raise ONE subject without moving the tier under it", () => {
    const raised = settingsOf({ [SUBJECT_SETTING_KEYS[MINT_RULE].quorum]: 90 });
    expect(floorForSubject(MINT_RULE, raised).quorumPct).toBe(90);
    expect(floorForCriticality("structural", raised).quorumPct).toBe(TIER_FLOORS.structural.quorumPct);
    // And the ballot freezes it.
    expect(dialsForSubject(MINT_RULE, "custom", village, raised).quorumPct).toBe(90);
  });

  it("prices the Birthing at 100 and 100 with no setting to move it", () => {
    expect(SUBJECT_SETTING_KEYS[VILLAGE_LAUNCH]).toBeUndefined();
    const raised = settingsOf({ [TIER_SETTING_KEYS.constitutional.quorum]: 99 });
    expect(dialsForSubject(VILLAGE_LAUNCH, "custom", village, raised)).toEqual({ unityPct: 100, quorumPct: 100 });
  });

  it("names every threshold key exactly once, so no control edits two things", () => {
    expect(new Set(THRESHOLD_PERCENT_KEYS).size).toBe(THRESHOLD_PERCENT_KEYS.length);
    for (const c of CRITICALITIES) {
      expect(THRESHOLD_PERCENT_KEYS, c).toContain(TIER_SETTING_KEYS[c].unity);
      expect(THRESHOLD_PERCENT_KEYS, c).toContain(TIER_SETTING_KEYS[c].quorum);
    }
  });
});

describe("the constitutional subject: how votes are counted", () => {
  it("asks 97 and 97, which is the tier and not a second copy of the number", () => {
    const t = SUBJECT_THRESHOLDS[GOVERNANCE_MODE];
    expect(t.criticality).toBe("constitutional");
    expect({ unityPct: t.minUnityPct, quorumPct: t.minQuorumPct }).toEqual(TIER_FLOORS.constitutional);
  });

  it("fixes the method, because a 97 nobody reads is a lie with a number on it", () => {
    expect(methodForSubject(GOVERNANCE_MODE, "majority")).toBe("custom");
    expect(methodForSubject(GOVERNANCE_MODE, "hypha")).toBe("custom");
  });

  it("is a subject type the ballots column can hold", () => {
    expect(GOVERNANCE_MODE.length).toBeLessThanOrEqual(24);
  });
});

describe("a bundle is priced at its hardest part", () => {
  const village = { unityPct: 80, quorumPct: 20 };

  it("takes one subject exactly as it always did", () => {
    expect(dialsForSubject([MINT_RULE], "custom", village)).toEqual(dialsForSubject(MINT_RULE, "custom", village));
    expect(dialsForSubject(["mechanics"], "custom", village)).toEqual(dialsForMethod("custom", village));
  });

  it("takes the HIGHEST floor among the elements, each dial on its own", () => {
    // A mint rule asks 50 of quorum and nothing of unity; a mode switch asks
    // 97 of both. The bundle asks 97 and 97.
    expect(dialsForSubject([MINT_RULE, GOVERNANCE_MODE], "custom", village)).toEqual({
      unityPct: 97,
      quorumPct: 97,
    });
    // A mint rule beside an ordinary rule change asks the mint rule's quorum
    // and leaves unity where the village put it.
    expect(dialsForSubject(["mechanics", MINT_RULE], "custom", village)).toEqual({
      unityPct: 80,
      quorumPct: 50,
    });
  });

  it("never lowers the village, whatever the bundle holds", () => {
    const strict = { unityPct: 100, quorumPct: 100 };
    expect(dialsForSubject(["mechanics", MINT_RULE, GOVERNANCE_MODE], "custom", strict)).toEqual(strict);
  });

  it("prices an empty bundle as the village's own dials and refuses to invent a floor", () => {
    expect(dialsForSubject([], "custom", village)).toEqual(dialsForMethod("custom", village));
  });

  it("says so when two elements want two different methods, instead of picking one", () => {
    expect(methodForSubjects(["mechanics"])).toEqual({ method: null, conflict: null });
    expect(methodForSubjects([MINT_RULE, GOVERNANCE_MODE]).method).toBe("custom");
    // Both fixed subjects today conduct `custom`, so there is nothing to
    // collide yet; the shape is pinned so the next subject that fixes a
    // different method is caught rather than silently overruled.
    expect(methodForSubjects([VILLAGE_LAUNCH, GOVERNANCE_MODE]).conflict).toBeNull();
  });

  it("takes the strictest evaluation rules among the elements", () => {
    expect(evaluationRulesFor([VILLAGE_LAUNCH, "mechanics"])).toEqual({
      abstainPolicy: "no_answer",
      minYesHeads: "all",
    });
    expect(evaluationRulesFor(["mechanics", MINT_RULE])).toEqual({
      abstainPolicy: "counts_toward_quorum",
      minYesHeads: undefined,
    });
  });
});

describe("thresholdsFor, the one helper every surface reads", () => {
  const village = { unityPct: 80, quorumPct: 20 };

  it("answers for a subject, a bundle and a bare tier alike", () => {
    expect(thresholdsFor({ subjects: [MINT_RULE] }, "custom", village)).toMatchObject({ quorumPct: 50 });
    expect(thresholdsFor({ criticality: "constitutional" }, "custom", village)).toMatchObject({
      unityPct: 97,
      quorumPct: 97,
    });
    expect(thresholdsFor({ criticality: "routine" }, "custom", village)).toMatchObject(village);
  });

  it("carries the warning when the numbers land above the recommended ceiling", () => {
    expect(thresholdsFor({ criticality: "constitutional" }, "custom", village).warning).toBeNull();
    const strict = thresholdsFor({ subjects: ["mechanics"] }, "custom", { unityPct: 100, quorumPct: 20 });
    expect(strict.warning).toContain("stalemate");
  });

  it("EXEMPTS the Birthing, which is the one vote where everybody is present", () => {
    const launch = thresholdsFor({ subjects: [VILLAGE_LAUNCH] }, "custom", village);
    expect(launch).toMatchObject({ unityPct: 100, quorumPct: 100 });
    expect(launch.warning).toBeNull();
  });

  it("reports the method a subject fixed, so a surface never says the wrong one", () => {
    expect(thresholdsFor({ subjects: [VILLAGE_LAUNCH] }, "majority", village).method).toBe("custom");
    expect(thresholdsFor({ subjects: ["mechanics"] }, "majority", village).method).toBeNull();
  });
});

describe("the warning where a dial is edited", () => {
  it("says nothing about a key that is not a threshold", () => {
    expect(stalemateWarningFor("gratitude.base_budget", "100")).toBeNull();
    expect(stalemateWarningFor("governance.vote_days", "30")).toBeNull();
  });

  it("warns on the village's own dials and on every tier dial, above 97 only", () => {
    expect(stalemateWarningFor("governance.unity_pct", "97")).toBeNull();
    expect(stalemateWarningFor("governance.unity_pct", "98")).toContain("stalemate");
    expect(stalemateWarningFor("governance.quorum_pct", "100")).toContain("stalemate");
    expect(stalemateWarningFor(TIER_SETTING_KEYS.constitutional.quorum, "99")).toContain("stalemate");
  });

  it("says nothing about a value that is not a number yet, which is every half-typed one", () => {
    expect(stalemateWarningFor("governance.unity_pct", "")).toBeNull();
    expect(stalemateWarningFor("governance.unity_pct", "9x")).toBeNull();
  });
});

describe("the typed items a change set is made of", () => {
  it("prices every kind, so a kind cannot arrive without a bar", () => {
    for (const kind of CHANGE_ITEM_KINDS) {
      expect(SUBJECT_FOR_ITEM_KIND[kind], kind).toBeTruthy();
      if (kind !== "dial") {
        expect(CRITICALITY_FOR_ITEM_KIND[kind], kind).toBeTruthy();
        expect(CRITICALITIES, kind).toContain(CRITICALITY_FOR_ITEM_KIND[kind]);
      }
    }
  });

  it("sends a mode switch to the constitutional subject and nowhere else", () => {
    expect(SUBJECT_FOR_ITEM_KIND.mode_switch).toBe(GOVERNANCE_MODE);
    expect(CRITICALITY_FOR_ITEM_KIND.mode_switch).toBe("constitutional");
  });

  it("prices a mixed bundle at its most critical element", () => {
    expect(criticalityOfItems([])).toBe("routine");
    expect(criticalityOfItems(["routine", "structural"])).toBe("structural");
    expect(criticalityOfItems(["routine", "constitutional", "structural"])).toBe("constitutional");
  });
});

/**
 * THE OVERRIDE TIER (19E). A vetoed proposal brought back and passed again at
 * the village's highest set tier lands whatever a steward says, so the
 * setting naming that tier is priced at itself.
 */
describe("the highest set tier, and the veto override", () => {
  const tierOf = (value: string) =>
    thresholdSettingsFrom(
      () => 0,
      (key) => (key === HIGHEST_TIER_KEY ? value : ""),
    );

  it("reads the setting, and the override tier is what it names", () => {
    expect(highestTier(tierOf("structural"))).toBe("structural");
    expect(overrideDials(tierOf("structural"))).toEqual(TIER_FLOORS.structural);
    expect(highestTier(tierOf("constitutional"))).toBe("constitutional");
    expect(overrideDials(tierOf("constitutional"))).toEqual(TIER_FLOORS.constitutional);
  });

  it("answers the top of the ladder when nothing was set or the value is not a tier", () => {
    const top = CRITICALITIES[CRITICALITIES.length - 1];
    expect(highestTierFrom()).toBe(top);
    expect(highestTierFrom(() => "")).toBe(top);
    expect(highestTierFrom(() => "whatever-a-fork-typed")).toBe(top);
    expect(highestTier()).toBe(top);
  });

  it("carries a village's raised tier into the override, so the override is never the cheaper number", () => {
    const raised = thresholdSettingsFrom(
      (key) => (key === TIER_SETTING_KEYS.structural.quorum ? 90 : 0),
      (key) => (key === HIGHEST_TIER_KEY ? "structural" : ""),
    );
    expect(overrideDials(raised)).toEqual({ unityPct: 80, quorumPct: 90 });
  });
});

/**
 * THRESHOLDS FOR THRESHOLDS (19B). "they also can be changed by reaching the
 * same amount they are set at can change their threshold again."
 */
describe("a threshold change is priced at that threshold's current bar", () => {
  it("prices a tier's own dials at that tier", () => {
    const registry = thresholdSettingsFrom(() => 0);
    expect(thresholdChangePrice(TIER_SETTING_KEYS.constitutional.unity, registry)).toEqual(
      TIER_FLOORS.constitutional,
    );
    expect(thresholdChangePrice(TIER_SETTING_KEYS.structural.quorum, registry)).toEqual(
      TIER_FLOORS.structural,
    );
    expect(thresholdChangePrice(TIER_SETTING_KEYS.routine.unity, registry)).toEqual(TIER_FLOORS.routine);
  });

  it("follows the bar a village has actually set, up or down, so 97 costs 97 to move", () => {
    const raised = thresholdSettingsFrom((key) =>
      key === TIER_SETTING_KEYS.structural.unity || key === TIER_SETTING_KEYS.structural.quorum ? 97 : 0,
    );
    expect(thresholdChangePrice(TIER_SETTING_KEYS.structural.unity, raised)).toEqual({
      unityPct: 97,
      quorumPct: 97,
    });
  });

  it("prices the highest-tier setting at itself", () => {
    const structural = thresholdSettingsFrom(
      () => 0,
      (key) => (key === HIGHEST_TIER_KEY ? "structural" : ""),
    );
    expect(thresholdChangePrice(HIGHEST_TIER_KEY, structural)).toEqual(TIER_FLOORS.structural);
    const constitutional = thresholdSettingsFrom(
      () => 0,
      (key) => (key === HIGHEST_TIER_KEY ? "constitutional" : ""),
    );
    expect(thresholdChangePrice(HIGHEST_TIER_KEY, constitutional)).toEqual(TIER_FLOORS.constitutional);
  });

  it("prices a subject's own floor at that subject, and the village dials at the structural tier", () => {
    const registry = thresholdSettingsFrom(() => 0);
    expect(thresholdChangePrice(SUBJECT_SETTING_KEYS[MINT_RULE].quorum, registry)).toEqual(
      floorForSubject(MINT_RULE, registry),
    );
    expect(thresholdChangePrice("governance.unity_pct", registry)).toEqual(TIER_FLOORS.structural);
    expect(thresholdChangePrice("governance.quorum_pct", registry)).toEqual(TIER_FLOORS.structural);
  });

  it("answers null for a key that sets no bar of its own, which is not the same as free", () => {
    expect(thresholdChangePrice("gratitude.base_budget")).toBeNull();
    expect(thresholdChangePrice("governance.vote_days")).toBeNull();
  });

  it("names every self-priced key, so a control can find them without a second list", () => {
    for (const key of SELF_PRICED_THRESHOLD_KEYS) {
      expect(thresholdChangePrice(key), key).not.toBeNull();
    }
    expect(SELF_PRICED_THRESHOLD_KEYS).toContain(HIGHEST_TIER_KEY);
  });
});

/** A tier and a subject, read against a real roll in people as well as weight. */
describe("a tier read in people", () => {
  const concentrated = [
    { weight: 40 },
    { weight: 32 },
    { weight: 25 },
    ...Array.from({ length: 6 }, () => ({ weight: 0.5 })),
  ];
  const equalNine = Array.from({ length: 9 }, () => ({ weight: 1 }));

  it("says the constitutional bar in weight and in people on a concentrated roll", () => {
    const reading = tierInPeople("constitutional", concentrated);
    expect(reading.dials).toEqual(TIER_FLOORS.constitutional);
    expect(reading.fewestForQuorum).toBe(3);
    expect(reading.sentence).toContain("at least 3 of 9 people");
    expect(reading.needsEveryone).toBe(false);
    expect(reading.rollWarning).toBeNull();
    expect(reading.ceilingWarning).toBeNull();
  });

  it("says the same bar in heads on an equal roll, and warns that it is everybody", () => {
    const reading = tierInPeople("constitutional", equalNine);
    expect(reading.equalWeights).toBe(true);
    expect(reading.fewestForQuorum).toBe(9);
    expect(reading.needsEveryone).toBe(true);
    expect(reading.sentence).toContain("at least 9 of 9 people");
    // THRESHOLDS-FIX, 19G: the count in this sentence is now the seats the
    // quorum reaches, which on a roll of nine ordinary members is the nine.
    expect(reading.rollWarning).toContain("every one of the 9 people this count reaches");
  });

  it("warns above 97 without refusing, which is his ruling and not the audit's", () => {
    const above = thresholdSettingsFrom((key) =>
      key === TIER_SETTING_KEYS.constitutional.quorum ? 99 : 0,
    );
    const reading = tierInPeople("constitutional", concentrated, above);
    expect(reading.dials.quorumPct).toBe(99);
    expect(reading.ceilingWarning).toContain("stalemate");
  });

  it("reads a subject the same way, and exempts the Birthing from both warnings", () => {
    const launch = subjectInPeople(VILLAGE_LAUNCH, equalNine);
    expect(launch.dials).toEqual({ unityPct: 100, quorumPct: 100 });
    expect(launch.fewestForQuorum).toBe(9);
    expect(launch.sentence).toContain("at least 9 of 9 people");
    expect(launch.rollWarning).toBeNull();
    expect(launch.ceilingWarning).toBeNull();
  });
});

/** Delegated rows on a vote that asks everyone to agree in person. */
describe("delegated rows at 100 unity", () => {
  it("refuses a delegated row on the Birthing, whatever its stamped bar says", () => {
    expect(delegatedRowsCountOn({ subjectType: VILLAGE_LAUNCH, unityPct: 100 })).toBe(false);
    expect(delegatedRowsCountOn({ subjectType: VILLAGE_LAUNCH, unityPct: 80 })).toBe(false);
  });

  it("refuses a delegated row on any subject conducted at 100 unity", () => {
    expect(delegatedRowsCountOn({ subjectType: "mechanics", unityPct: 100 })).toBe(false);
    expect(delegatedRowsCountOn({ subjectType: GOVERNANCE_MODE, unityPct: 100 })).toBe(false);
  });

  it("counts a delegated row everywhere else, including the constitutional 97", () => {
    expect(delegatedRowsCountOn({ subjectType: "mechanics", unityPct: 80 })).toBe(true);
    expect(delegatedRowsCountOn({ subjectType: GOVERNANCE_MODE, unityPct: 97 })).toBe(true);
    expect(delegatedRowsCountOn({ unityPct: 0 })).toBe(true);
  });

  it("says why, in one sentence the page can render", () => {
    expect(delegationRefusalSentence()).toContain("in person");
  });
});

/**
 * THE STALEMATE RE-RUN, with the founder's abuse guard: "we have to do this in
 * a way where they can't be abused by people who don't like the outcome."
 */
describe("the stalemate re-run", () => {
  const gone = { userId: "u-gone", weight: 60, ledgerRef: "mem-2026-09-03-1" };
  const base = {
    subjectType: "mechanics",
    status: "open",
    quorumPct: 50,
    totalWeight: 100,
    departed: [gone],
    votedUserIds: ["u-a", "u-b"],
  };

  it("is offered when a departed seat makes quorum unreachable, and carries the votes still here", () => {
    const offer = rerunOffer(base);
    expect(offer.offered).toBe(true);
    if (offer.offered) {
      expect(offer.carryForward).toEqual(["u-a", "u-b"]);
      expect(offer.sentence).toContain("left the village");
    }
  });

  it("is never offered after the ballot closes", () => {
    const offer = rerunOffer({ ...base, status: "no_quorum" });
    expect(offer).toMatchObject({ offered: false, reason: "closed" });
  });

  it("needs the membership record, so a self-declared absence opens nothing", () => {
    const offer = rerunOffer({ ...base, departed: [{ userId: "u-gone", weight: 60 }] });
    expect(offer).toMatchObject({ offered: false, reason: "nobody_left" });
  });

  it("is refused when the departed seat already voted against the outcome a re-run would change", () => {
    const offer = rerunOffer({ ...base, departed: [{ ...gone, choice: "no" }] });
    expect(offer).toMatchObject({ offered: false, reason: "departed_voted_against" });
  });

  it("is refused while quorum is still reachable with the members who are here", () => {
    const offer = rerunOffer({ ...base, departed: [{ ...gone, weight: 40 }] });
    expect(offer).toMatchObject({ offered: false, reason: "quorum_still_reachable" });
  });

  it("exempts the Birthing, whose re-runnability is designed", () => {
    const offer = rerunOffer({ ...base, subjectType: VILLAGE_LAUNCH });
    expect(offer).toMatchObject({ offered: false, reason: "exempt" });
  });

  it("drops a departed member from the carry list and keeps the rest", () => {
    const offer = rerunOffer({ ...base, votedUserIds: ["u-a", "u-gone", "u-a"] });
    expect(offer.offered).toBe(true);
    if (offer.offered) expect(offer.carryForward).toEqual(["u-a"]);
  });

  it("says it could not tell on a weightless roll, and never calls that a stalemate", () => {
    const offer = rerunOffer({ ...base, totalWeight: 0 });
    expect(offer).toMatchObject({ offered: false, reason: "no_weight" });
  });
});

/**
 * -- THE DIALS A TRIAL MAY NEVER TOUCH (audit 2, risk 1) ---------------------
 *
 * Red before the class existed: 21.2's exclusion list left out quorum, unity
 * and every tier dial, so one cheap proposal could open a moon in which
 * permanent changes were priced at a bar nobody agreed to.
 */
describe("meta settings", () => {
  it("names quorum, unity and every tier dial", () => {
    expect(isMetaSetting("governance.quorum_pct")).toBe(true);
    expect(isMetaSetting("governance.unity_pct")).toBe(true);
    for (const c of CRITICALITIES) {
      expect(isMetaSetting(TIER_SETTING_KEYS[c].unity), c).toBe(true);
      expect(isMetaSetting(TIER_SETTING_KEYS[c].quorum), c).toBe(true);
    }
    for (const key of THRESHOLD_PERCENT_KEYS) expect(isMetaSetting(key), key).toBe(true);
  });

  it("names the veto map, the window, the cooldown and the two counting dials", () => {
    for (const key of [
      "governance.steward_subjects",
      "governance.auto_execute_subjects",
      "governance.veto_hours",
      "governance.steward_council",
      "governance.highest_tier",
      "governance.trial_cooldown_cycles",
      "governance.nonhuman_in_quorum",
      "governance.absent_cycles",
    ]) {
      expect(isMetaSetting(key), key).toBe(true);
    }
  });

  it("catches a window setting the windows lane has not written yet, by prefix", () => {
    expect(isMetaSetting("governance.window_mechanics")).toBe(true);
    expect(isMetaSetting("governance.window_grace_days")).toBe(true);
  });

  it("leaves an ordinary dial alone", () => {
    expect(isMetaSetting("governance.vote_days")).toBe(false);
    expect(isMetaSetting("gratitude.pool")).toBe(false);
  });

  it("refuses a trial of a pricing dial, naming it and the rule", () => {
    const refusal = metaSettingTrialRefusal("governance.quorum_pct");
    expect(refusal).toContain("governance.quorum_pct");
    expect(refusal).toContain("at its own current bar");
    expect(metaSettingTrialRefusal(TIER_SETTING_KEYS.constitutional.quorum)).toContain(
      TIER_SETTING_KEYS.constitutional.quorum,
    );
  });

  it("refuses a bundle that hides one pricing dial among ordinary ones", () => {
    expect(
      metaSettingTrialRefusal(["governance.vote_days", "governance.unity_pct", "governance.sensing_days"]),
    ).toContain("governance.unity_pct");
  });

  it("allows a trial of a dial that prices nothing", () => {
    expect(metaSettingTrialRefusal(["governance.vote_days"])).toBeNull();
    expect(metaSettingTrialRefusal([])).toBeNull();
  });
});

/**
 * -- THREE CYCLES WITHOUT QUORUM (19F, 20.11) -------------------------------
 *
 * Red before the counter existed: the founder's "3 cycles without quorum it
 * just doesn't pass" had no count, no warning and no terminal state, so a
 * proposer read the same page after the ninth miss as after the first.
 */
describe("three cycles without quorum", () => {
  it("counts consecutive misses and stops at the first decided close", () => {
    expect(consecutiveNoQuorum([])).toBe(0);
    expect(consecutiveNoQuorum([{ status: "no_quorum" }, { status: "no_quorum" }])).toBe(2);
    expect(
      consecutiveNoQuorum([{ status: "no_quorum" }, { status: "failed" }, { status: "no_quorum" }]),
    ).toBe(1);
    expect(consecutiveNoQuorum([{ status: "passed" }])).toBe(0);
  });

  it("skips a ballot still running, which has said nothing either way", () => {
    expect(consecutiveNoQuorum([{ status: "open" }, { status: "no_quorum" }])).toBe(1);
  });

  it("says nothing on the first miss", () => {
    const r = quorumMissReading({ subjectType: "mechanics", misses: 1, quorumPct: 97 });
    expect(r.state).toBe("clear");
    expect(r.sentence).toBeNull();
    expect(r.remaining).toBe(2);
  });

  it("warns on the second, names the tier as the obstacle, and says the next one ends it", () => {
    const r = quorumMissReading({
      subjectType: "mechanics",
      misses: 2,
      quorumPct: 97,
      criticality: "constitutional",
    });
    expect(r.state).toBe("warned");
    expect(r.sentence).toContain("the constitutional tier, which asks for 97% of the weight");
    expect(r.sentence).toContain("ends this one for good");
    expect(r.remaining).toBe(1);
  });

  it("ends it on the third, names the state, and leaves one door", () => {
    const r = quorumMissReading({
      subjectType: "mechanics",
      misses: 3,
      quorumPct: 97,
      criticality: "constitutional",
      backers: 4,
    });
    expect(r.state).toBe("ended");
    expect(r.terminalState).toBe(NO_QUORUM_ENDED);
    expect(r.remaining).toBe(0);
    expect(r.sentence).toContain("three times in a row");
    expect(r.sentence).toContain("it was never counted");
    expect(r.door).toContain("Withdraw it and write it again");
    expect(r.door).toContain("All 4 of its backers come with it");
  });

  it("keeps the door true when nobody handed it a backer count", () => {
    const r = quorumMissReading({ subjectType: "mechanics", misses: 3, quorumPct: 20 });
    expect(r.door).toContain("Everyone backing it comes with it");
  });

  it("exempts the Birthing, which is asked again on a fresh roll every time", () => {
    const r = quorumMissReading({ subjectType: VILLAGE_LAUNCH, misses: 9, quorumPct: 100 });
    expect(r.state).toBe("clear");
    expect(r.terminalState).toBeNull();
  });
});

/**
 * -- THE RE-RUN, FOR A BLOC THAT CANNOT VOTE (audit 2, risks 11 and 90) ------
 *
 * Red before this: the offer only saw a member who had left, and the likelier
 * stalemate arrives from seats that are still on the roll and answer nothing.
 */
describe("a re-run for weight that cannot answer", () => {
  const base = {
    subjectType: "mechanics",
    status: "open",
    quorumPct: 90,
    totalWeight: 100,
    departed: [],
    votedUserIds: ["u-a"],
  };

  it("is offered when an unvotable bloc puts quorum out of reach, with nobody departed", () => {
    const offer = rerunOffer({
      ...base,
      unvotable: [
        { userId: "u-river", weight: 15, reason: "silent" as const },
        { userId: "u-hill", weight: 10, reason: "no_representative" as const },
      ],
    });
    expect(offer.offered).toBe(true);
    if (offer.offered) {
      expect(offer.sentence).toContain("2 seats on this roll holds weight that cannot answer");
      expect(offer.carryForward).toEqual(["u-a"]);
    }
  });

  it("still refuses when the silent seat already voted against", () => {
    const offer = rerunOffer({
      ...base,
      unvotable: [{ userId: "u-river", weight: 40, reason: "silent" as const, choice: "no" as const }],
    });
    expect(offer).toMatchObject({ offered: false, reason: "departed_voted_against" });
  });

  it("says so when every seat can still answer", () => {
    expect(rerunOffer({ ...base, unvotable: [] })).toMatchObject({ offered: false, reason: "nobody_left" });
  });

  it("still refuses while the votable weight can reach the bar", () => {
    const offer = rerunOffer({
      ...base,
      quorumPct: 50,
      unvotable: [{ userId: "u-river", weight: 15, reason: "silent" as const }],
    });
    expect(offer).toMatchObject({ offered: false, reason: "quorum_still_reachable" });
  });
});

describe("a tier read against the weight that votes", () => {
  const roll = [{ weight: 75 }, { weight: 10, nonHuman: true }, { weight: 15, nonHuman: true }];

  it("warns that the bar cannot be reached, without any dial being above 97", () => {
    const reading = tierInPeople("constitutional", roll);
    expect(reading.ceilingWarning).toBeNull();
    expect(reading.reachWarning).toContain("asks for 97%");
    expect(reading.quorumBase.excludedWeight).toBe(25);
    expect(reading.sentence).toContain("outside this count");
  });

  it("stays quiet on a roll every seat of which is in the count", () => {
    const reading = tierInPeople("structural", [{ weight: 1 }, { weight: 1 }]);
    expect(reading.reachWarning).toBeNull();
  });

  it("exempts the Birthing from the reach warning as it does from the other two", () => {
    expect(subjectInPeople(VILLAGE_LAUNCH, roll).reachWarning).toBeNull();
  });
});
