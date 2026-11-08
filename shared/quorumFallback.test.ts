/**
 * The quorum fallback's rules, as pure functions (Rye, 2026-11-06).
 *
 * The engine's majority-of-cast mode is proven here beside the rules that
 * decide when it is used, because the two are one ruling: a re-run's second
 * miss is decided by a simple majority of the votes cast, and a tie fails.
 */
import { describe, expect, it } from "vitest";
import {
  QUORUM_FALLBACK_KEY,
  NO_QUORUM_RERUN,
  failsafeRefusal,
  majorityDecisionLine,
  missDecidedByMajority,
  missOpensRerun,
  quorumFallbackOn,
  rerunDurationDays,
  rerunFeedLine,
  rerunQuorumPct,
  statusIsFinal,
  switchFeedLine,
} from "./quorumFallback";
import { evaluateBallot, type EvaluateInput } from "./governanceEngine";
import { consecutiveNoQuorum } from "./ballotSubjects";
import { VARIABLES_BY_KEY, ringOf } from "./gameVariables";

describe("the dial", () => {
  it("is a village-governed choice of off and on, off by default", () => {
    const def = VARIABLES_BY_KEY[QUORUM_FALLBACK_KEY];
    expect(def).toBeDefined();
    expect(def.type).toBe("choice");
    expect(def.default).toBe("off");
    expect(def.choices?.map((c) => c.value)).toEqual(["off", "on"]);
    expect(ringOf(def)).toBe("open");
  });

  it("reads anything but the word on as off, which fails closed", () => {
    expect(quorumFallbackOn("on")).toBe(true);
    expect(quorumFallbackOn(" ON ")).toBe(true);
    for (const v of ["off", "", "true", "1", null, undefined, "yes"]) expect(quorumFallbackOn(v)).toBe(false);
  });
});

describe("who is asked again", () => {
  it("re-runs a first ballot opened with the dial on, and never a re-run", () => {
    expect(missOpensRerun({ subjectType: "mechanics", quorumFallback: true, rerunOf: null })).toBe(true);
    expect(missOpensRerun({ subjectType: "mechanics", quorumFallback: true, rerunOf: "bal-1" })).toBe(false);
    expect(missDecidedByMajority({ subjectType: "mechanics", quorumFallback: true, rerunOf: "bal-1" })).toBe(true);
  });

  it("never re-runs a ballot opened with the dial off: the dial is frozen at open", () => {
    expect(missOpensRerun({ subjectType: "mechanics", quorumFallback: false, rerunOf: null })).toBe(false);
    expect(missDecidedByMajority({ subjectType: "mechanics", quorumFallback: false, rerunOf: null })).toBe(false);
  });

  it("leaves the Birthing to its own fresh-roll ask", () => {
    expect(missOpensRerun({ subjectType: "village_launch", quorumFallback: true, rerunOf: null })).toBe(false);
  });
});

describe("the re-run's dials", () => {
  it("halves the quorum, rounded up, never below one", () => {
    expect(rerunQuorumPct(20)).toBe(10);
    expect(rerunQuorumPct(25)).toBe(13);
    expect(rerunQuorumPct(33.3)).toBe(17);
    expect(rerunQuorumPct(1)).toBe(1);
    expect(rerunQuorumPct(0)).toBe(1);
  });

  it("runs as many days as the first ballot ran", () => {
    expect(rerunDurationDays("2026-11-01T00:00:00.000Z", "2026-11-08T00:00:00.000Z")).toBe(7);
    expect(rerunDurationDays("2026-11-01T00:00:00.000Z", "2026-11-02T00:00:00.000Z")).toBe(1);
    expect(rerunDurationDays("garbage", "garbage")).toBe(1);
  });
});

describe("no_quorum_rerun is never a final outcome", () => {
  it("is not final, and the four real endings are", () => {
    expect(statusIsFinal(NO_QUORUM_RERUN)).toBe(false);
    expect(statusIsFinal("open")).toBe(false);
    for (const s of ["passed", "failed", "no_quorum", "withdrawn"]) expect(statusIsFinal(s)).toBe(true);
  });
});

describe("the engine's majority of the votes cast", () => {
  const base = (over: Partial<EvaluateInput>): EvaluateInput => ({
    method: "custom",
    unityPct: 80,
    quorumPct: 50,
    totalWeight: 10,
    tallies: { yesW: 0, noW: 0, abstainW: 0 },
    ...over,
  });

  it("CONTROL: without the mode, a missed quorum is still no_quorum, exactly as before", () => {
    expect(evaluateBallot(base({ tallies: { yesW: 2, noW: 1, abstainW: 0 } }))).toBe("no_quorum");
  });

  it("carries on more yes than no, below quorum", () => {
    expect(evaluateBallot(base({ majorityOfCast: true, tallies: { yesW: 2, noW: 1, abstainW: 0 } }))).toBe("passed");
  });

  it("fails a tie", () => {
    expect(evaluateBallot(base({ majorityOfCast: true, tallies: { yesW: 1, noW: 1, abstainW: 2 } }))).toBe("failed");
  });

  it("counts no abstention on either side, and fails when nobody took a side", () => {
    expect(evaluateBallot(base({ majorityOfCast: true, tallies: { yesW: 0, noW: 0, abstainW: 4 } }))).toBe("failed");
    expect(evaluateBallot(base({ majorityOfCast: true, tallies: { yesW: 0, noW: 0, abstainW: 0 } }))).toBe("failed");
  });

  it("decides by majority even where the frozen unity bar is higher, because that is the ruling", () => {
    // 2 of 3 is 67%, under the 80 the ballot froze, and still more yes than no.
    expect(evaluateBallot(base({ majorityOfCast: true, tallies: { yesW: 2, noW: 1, abstainW: 0 } }))).toBe("passed");
  });

  it("changes nothing for a ballot that reached quorum", () => {
    const met = base({ majorityOfCast: true, tallies: { yesW: 6, noW: 3, abstainW: 0 } });
    expect(evaluateBallot(met)).toBe(evaluateBallot({ ...met, majorityOfCast: undefined }));
  });

  it("still fails closed on a head floor and on a standing objection", () => {
    expect(
      evaluateBallot(base({
        majorityOfCast: true,
        tallies: { yesW: 2, noW: 0, abstainW: 0 },
        minYesHeads: "all",
        heads: { yesHeads: 2, noHeads: 0, abstainHeads: 0, electorateCount: 10 },
      })),
    ).toBe("failed");
    expect(
      evaluateBallot(base({ method: "consent", majorityOfCast: true, openObjections: 1, tallies: { yesW: 2, noW: 0, abstainW: 0 } })),
    ).toBe("failed");
  });
});

describe("the three-misses count", () => {
  it("counts a ballot and its re-run as one miss", () => {
    // Newest first: an older plain miss, then a first ballot and its re-run.
    // The re-run itself is decided by majority, so a pair that missed twice
    // never reads as two misses; a pair left open reads as nothing yet.
    expect(consecutiveNoQuorum([{ status: "open" }, { status: NO_QUORUM_RERUN }, { status: "no_quorum" }])).toBe(1);
    expect(consecutiveNoQuorum([{ status: NO_QUORUM_RERUN }, { status: "no_quorum" }, { status: "no_quorum" }])).toBe(2);
  });

  it("CONTROL: a village with no re-runs counts exactly as before", () => {
    expect(consecutiveNoQuorum([{ status: "no_quorum" }, { status: "no_quorum" }, { status: "failed" }])).toBe(2);
    expect(consecutiveNoQuorum([{ status: "failed" }, { status: "no_quorum" }])).toBe(0);
  });
});

describe("the failsafe door", () => {
  it("refuses an ordinary member", () => {
    expect(failsafeRefusal({ isAdmin: false, isSteward: false }, "on")).toContain("for a steward or an admin");
  });

  it("lets a steward and an admin switch it on", () => {
    expect(failsafeRefusal({ isAdmin: false, isSteward: true }, "on")).toBeNull();
    expect(failsafeRefusal({ isAdmin: true, isSteward: false }, "on")).toBeNull();
  });

  it("never switches it off, for anybody, and names the village's door", () => {
    for (const actor of [{ isAdmin: true, isSteward: false }, { isAdmin: false, isSteward: true }]) {
      expect(failsafeRefusal(actor, "off")).toContain("village's to decide");
    }
  });
});

describe("what the village reads", () => {
  it("says the re-run line the note asks for", () => {
    expect(rerunFeedLine("the new rota", 7)).toBe(
      "Too few of us voted on the new rota. It is open again for 7 days, and this time half as many voices are enough.",
    );
    expect(rerunFeedLine("x", 1)).toContain("for 1 day,");
  });

  it("says a majority decided it, both ways", () => {
    expect(majorityDecisionLine("passed", 2, 1)).toContain("more said yes than no (2 for, 1 against)");
    expect(majorityDecisionLine("failed", 1, 1)).toContain("did not get them (1 for, 1 against)");
  });

  it("says who switched the dial", () => {
    expect(switchFeedLine(true, "steward")).toMatch(/^A steward switched the quorum fallback on\./);
    expect(switchFeedLine(true, "admin")).toMatch(/^An admin switched the quorum fallback on\./);
    expect(switchFeedLine(false, "village")).toMatch(/^The village switched the quorum fallback off\./);
  });
});
