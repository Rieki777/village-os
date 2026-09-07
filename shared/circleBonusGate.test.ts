/**
 * THE FOUR ABSENCES, AND THE ONE THING THIS SHAPE MUST NEVER GROW.
 *
 * What is under test, in the order the questions were asked:
 *   1. no record, a record nobody voted on, a vote still running and a vote
 *      that said no are four different facts and produce four different
 *      readings;
 *   2. a real zero and an absence stay apart: a circle that spent nothing
 *      under a real cap is not the circle whose module is off, and neither is
 *      the circle with no envelope;
 *   3. quorum missed is never reported as a refusal;
 *   4. the sentence about what the reading cannot see rides EVERY reading,
 *      including the one with nothing blocking;
 *   5. there is no eligibility flag and no amount anywhere in the shape, which
 *      is asserted over the serialised reading so a later field cannot slip in;
 *   6. `blocking` empties only when all three components hold.
 */
import { describe, expect, it } from "vitest";
import {
  BLIND_SPOT,
  bonusGate,
  circleRollProblem,
  commitmentComponent,
  commitmentSentence,
  spendComponent,
  spendSentence,
  voteSentence,
  type CommitmentRecord,
  type GateWords,
  type VoteComponent,
} from "./circleBonusGate";
import type { CapReading, CircleBurnReading, MeteredReading } from "./circleBurn";

const WORDS: GateWords = {
  circleName: (id) => (id === "kitchen" ? "The Kitchen" : id),
  amount: (minor, unit) => `${minor} ${unit}`,
};

const PERIOD_START = "2026-06-01T00:00:00.000Z";
const PERIOD_END = "2026-09-01T00:00:00.000Z";

function record(over: Partial<CommitmentRecord> = {}): CommitmentRecord {
  return {
    id: "cm-1",
    circleId: "kitchen",
    periodId: "rooting-2026",
    startsAt: PERIOD_START,
    endsAt: PERIOD_END,
    statement: "Cook three feast days and keep the pantry stocked.",
    recordedAt: "2026-06-02T00:00:00.000Z",
    ...over,
  };
}

function vote(over: Partial<VoteComponent> = {}): VoteComponent {
  return {
    state: "said_yes",
    ballotId: "bal-1",
    onTheRoll: 12,
    rollWeight: 12,
    closedAt: "2026-09-05T00:00:00.000Z",
    outcomeNote: "The feasts happened and the pantry held.",
    attempts: 1,
    judgedBy: "village",
    ...over,
  };
}

function cap(over: Partial<CapReading> = {}): CapReading {
  return {
    scope: "season",
    state: "burning",
    window: { id: "rooting-2026", startsAt: PERIOD_START, endsAt: PERIOD_END },
    capMinor: 10_000,
    spentMinor: 4_000,
    remainingMinor: 6_000,
    perDayMinor: 44,
    projectedMinor: 4_000,
    exhaustsAt: null,
    askFits: true,
    askShare: 0.4,
    ...over,
  };
}

function metered(over: Partial<MeteredReading> = {}): CircleBurnReading {
  return {
    kind: "metered",
    circleId: "kitchen",
    unit: "token:credits",
    takenAt: PERIOD_END,
    askMinor: 0,
    cycle: cap({ scope: "cycle", state: "no_cap", capMinor: null, spentMinor: null, remainingMinor: null, askFits: null, askShare: null }),
    season: cap(),
    binds: "season",
    fits: true,
    ...over,
  };
}

const CLEAR = { circleId: "kitchen", takenAt: PERIOD_END, record: record(), vote: vote(), burn: metered() };

describe("the four absences are four readings", () => {
  it("tells nothing recorded apart from recorded and never asked", () => {
    const nothing = bonusGate({ ...CLEAR, record: null, vote: vote({ state: "never_asked", ballotId: null, attempts: 0, judgedBy: null }) });
    const unasked = bonusGate({ ...CLEAR, vote: vote({ state: "never_asked", ballotId: null, onTheRoll: null, rollWeight: null, closedAt: null, outcomeNote: null, attempts: 0, judgedBy: null }) });

    expect(nothing.commitment.state).toBe("none");
    expect(unasked.commitment.state).toBe("recorded");
    expect(nothing.blocking[0]).toContain("Nothing records what this circle took on");
    expect(unasked.blocking[0]).toContain("has not been asked");
    expect(nothing.blocking).not.toEqual(unasked.blocking);
  });

  it("does not repeat the vote's absence underneath the record's", () => {
    const nothing = bonusGate({ ...CLEAR, record: null, vote: vote({ state: "never_asked", ballotId: null, attempts: 0, judgedBy: null }) });
    expect(nothing.blocking).toHaveLength(1);
  });

  it("tells a running vote apart from a vote that said no", () => {
    const running = bonusGate({ ...CLEAR, vote: vote({ state: "open", closedAt: null, outcomeNote: null }) });
    const refused = bonusGate({ ...CLEAR, vote: vote({ state: "said_no" }) });
    expect(running.blocking[0]).toContain("still running");
    expect(refused.blocking[0]).toContain("did not complete");
    expect(voteSentence(running.vote, WORDS, "kitchen")).not.toBe(voteSentence(refused.vote, WORDS, "kitchen"));
  });

  it("never reports a missed quorum as a refusal", () => {
    const quiet = bonusGate({ ...CLEAR, vote: vote({ state: "no_quorum" }) });
    expect(quiet.blocking[0]).toContain("Silence is not a refusal");
    expect(quiet.blocking[0]).not.toContain("voted that");
    expect(voteSentence(quiet.vote, WORDS, "kitchen")).toContain("has not said either way");
  });

  it("keeps a withdrawn vote out of both answers", () => {
    const gone = bonusGate({ ...CLEAR, vote: vote({ state: "withdrawn" }) });
    expect(gone.blocking[0]).toContain("withdrawn");
    expect(gone.blocking[0]).not.toContain("did not complete");
  });
});

describe("a record written late is a weaker record", () => {
  it("separates a commitment made in advance from one composed afterwards", () => {
    const late = bonusGate({ ...CLEAR, record: record({ recordedAt: "2026-09-20T00:00:00.000Z" }) });
    expect(late.commitment.state).toBe("retrospective");
    expect(late.blocking[0]).toContain("after the period had ended");
    expect(commitmentSentence(late.commitment, WORDS, "kitchen")).toContain("a memory");
  });

  it("treats an unreadable instant as late, because that claims less", () => {
    const junk = commitmentComponent(record({ recordedAt: "not an instant" }));
    expect(junk.state).toBe("retrospective");
  });

  it("accepts a record written on the period's first day", () => {
    expect(commitmentComponent(record({ recordedAt: PERIOD_START })).state).toBe("recorded");
  });
});

describe("a real zero, an absence and an unmeasurable cap are three facts", () => {
  it("does not render a circle with no envelope as a circle that spent nothing", () => {
    const ungoverned = spendComponent({ kind: "ungoverned", circleId: "kitchen", unit: "token:credits", takenAt: PERIOD_END });
    const unspent = spendComponent(metered({ season: cap({ state: "unspent", spentMinor: 0, remainingMinor: 10_000, perDayMinor: null, projectedMinor: null, askShare: 0 }) }));
    expect(ungoverned.state).toBe("ungoverned");
    expect(ungoverned.spentMinor).toBeNull();
    expect(unspent.state).toBe("under_cap");
    expect(unspent.spentMinor).toBe(0);
  });

  it("keeps the module being off apart from both of those", () => {
    const off = spendComponent({ kind: "module_off" });
    expect(off.state).toBe("module_off");
    expect(spendSentence(off, WORDS, "kitchen")).not.toBe(
      spendSentence(spendComponent({ kind: "ungoverned", circleId: "kitchen", unit: "u", takenAt: PERIOD_END }), WORDS, "kitchen"),
    );
  });

  it("refuses to call an unmeasurable cap a zero", () => {
    const unmeasurable = spendComponent(
      metered({
        cycle: cap({ scope: "cycle", state: "no_cap", capMinor: null, spentMinor: null, remainingMinor: null, askFits: null, askShare: null }),
        season: cap({ state: "unmeasurable", spentMinor: null, remainingMinor: null, perDayMinor: null, projectedMinor: null, askFits: null, askShare: null }),
        binds: null,
      }),
    );
    expect(unmeasurable.state).toBe("unmeasurable");
    expect(unmeasurable.spentMinor).toBeNull();
    const reading = bonusGate({ ...CLEAR, burn: metered({ season: cap({ state: "unmeasurable", spentMinor: null, remainingMinor: null, perDayMinor: null, projectedMinor: null, askFits: null, askShare: null }), binds: null }) });
    expect(reading.blocking.join(" ")).toContain("a zero would be a claim nobody checked");
  });

  it("reports spend that reached the cap without calling it a failure", () => {
    const full = bonusGate({ ...CLEAR, burn: metered({ season: cap({ state: "exhausted", spentMinor: 10_000, remainingMinor: 0, askFits: false, askShare: 1 }) }) });
    expect(full.spend.state).toBe("at_cap");
    expect(full.blocking).toEqual([]);
    expect(spendSentence(full.spend, WORDS, "kitchen")).toContain("none of that room left over");
  });
});

describe("the shape refuses to become a payout", () => {
  it("carries no eligibility flag and no amount, over the whole serialised reading", () => {
    const json = JSON.parse(JSON.stringify(bonusGate(CLEAR)));
    for (const key of ["eligible", "earned", "bonus", "bonusMinor", "payout", "award", "score", "share"]) {
      expect(Object.keys(json)).not.toContain(key);
    }
    expect(JSON.stringify(json)).not.toMatch(/"(eligible|payout|bonusMinor|score)"/);
  });

  it("empties `blocking` only when all three components hold", () => {
    expect(bonusGate(CLEAR).blocking).toEqual([]);
    expect(bonusGate({ ...CLEAR, record: null }).blocking.length).toBeGreaterThan(0);
    expect(bonusGate({ ...CLEAR, vote: vote({ state: "said_no" }) }).blocking.length).toBeGreaterThan(0);
    expect(bonusGate({ ...CLEAR, burn: { kind: "module_off" } }).blocking.length).toBeGreaterThan(0);
  });

  it("names every failing component and not only the first", () => {
    const bad = bonusGate({ ...CLEAR, record: null, burn: { kind: "module_off" } });
    expect(bad.blocking).toHaveLength(2);
    expect(bad.blocking.join(" ")).toContain("Nothing records");
    expect(bad.blocking.join(" ")).toContain("keeps no circle budgets");
  });
});

describe("what the reading cannot see is on the reading", () => {
  it("rides every branch, including the one with nothing blocking", () => {
    const readings = [
      bonusGate(CLEAR),
      bonusGate({ ...CLEAR, record: null }),
      bonusGate({ ...CLEAR, burn: { kind: "module_off" } }),
      bonusGate({ ...CLEAR, vote: vote({ state: "no_quorum" }) }),
    ];
    for (const r of readings) expect(r.blindSpot).toBe(BLIND_SPOT);
  });

  it("says a thin record is not evidence of a thin season", () => {
    expect(BLIND_SPOT).toContain("care, mediation or hosting");
    expect(BLIND_SPOT).toContain("not evidence of a thin season");
  });
});

describe("who votes is a parameter and one option is not available", () => {
  it("reports the roll a vote used and chooses nothing", () => {
    expect(bonusGate(CLEAR).vote.judgedBy).toBe("village");
    expect(bonusGate({ ...CLEAR, record: null, vote: vote({ state: "never_asked", judgedBy: null }) }).vote.judgedBy).toBeNull();
  });

  it("refuses a circle-scoped roll with the reason there is none", () => {
    expect(circleRollProblem("village")).toBeNull();
    expect(circleRollProblem("circle")).toContain("no membership of a circle to build a roll from");
  });
});
