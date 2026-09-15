/**
 * THE AMOUNT, AND EVERY REASON THERE IS NONE.
 *
 * Pure arithmetic over a reading somebody else measured, so this file needs no
 * database and asserts nothing about a ledger. `server/lib/circleBonus.test.ts`
 * is where the money actually moves.
 *
 * WHAT IS UNDER TEST, in the order Rye's rulings raise it:
 *   1. the ONE difference, as one map: a cap resets and a treasury carries;
 *   2. the bonus is a share of UNMINTED capacity, under the cap mode;
 *   3. it REFUSES under the treasury mode, because that value already carries;
 *   4. it refuses when the village has not voted the work complete;
 *   5. it refuses on a veto, and refuses when a veto cannot be read;
 *   6. the dial exists in the registry and its default is the one this file
 *      reasons about.
 */
import { describe, expect, it } from "vitest";
import { BONUS_PCT_KEY, bonusFor, bonusSentence, type BonusWords } from "./circleBonus";
import { PERIOD_BOUNDARY, boundaryEffect, boundarySentence } from "./circleTreasury";
import { BLIND_SPOT, type BonusGateReading, type SpendComponent, type VoteComponent } from "./circleBonusGate";
import { VARIABLES_BY_KEY } from "./gameVariables";

const WORDS: BonusWords = {
  circleName: (id) => `the ${id} circle`,
  amount: (minor, unit) => `${minor} ${unit}`,
};

const vote = (over: Partial<VoteComponent> = {}): VoteComponent => ({
  state: "said_yes",
  ballotId: "bal-1",
  onTheRoll: 9,
  rollWeight: 9,
  closedAt: "2026-12-02T00:00:00.000Z",
  outcomeNote: "the village agreed",
  attempts: 1,
  judgedBy: "village",
  ...over,
});

const spend = (over: Partial<SpendComponent> = {}): SpendComponent => ({
  state: "under_cap",
  scope: "season",
  capMinor: 1000,
  spentMinor: 400,
  remainingMinor: 600,
  unit: "token:credits",
  ...over,
});

const gate = (over: Partial<BonusGateReading> = {}): BonusGateReading => ({
  circleId: "kitchen",
  periodId: "rooting-2026",
  takenAt: "2026-12-01T00:00:00.000Z",
  commitment: {
    state: "recorded",
    recordId: "rec-1",
    periodId: "rooting-2026",
    statement: "feed the village three days a week",
    recordedAt: "2026-06-02T00:00:00.000Z",
  },
  vote: vote(),
  spend: spend(),
  blocking: [],
  blindSpot: BLIND_SPOT,
  ...over,
});

describe("the one difference between the two modes", () => {
  it("is a single map, and the bonus asks it instead of asking the mode", () => {
    expect(PERIOD_BOUNDARY.cap).toBe("resets");
    expect(PERIOD_BOUNDARY.treasury).toBe("carries");
    expect(boundaryEffect("cap")).toBe("resets");
    expect(boundaryEffect("treasury")).toBe("carries");
  });

  it("says two different things about a boundary, and never one", () => {
    const cap = boundarySentence("cap");
    const treasury = boundarySentence("treasury");
    expect(cap).not.toBe(treasury);
    expect(cap).toContain("resets");
    expect(treasury).toContain("carries over");
    /*
     * THE HALF THAT MATTERS TO A STEWARD READING IT. A treasury sentence that
     * did not say the value stays issued would leave the reader guessing at
     * exactly the ruling this lane exists to carry out.
     */
    expect(treasury).toContain("still holds");
    expect(treasury).toContain("de-issued");
  });
});

describe("the bonus, under a cap", () => {
  it("is a share of what the circle did NOT mint, and it floors", () => {
    const out = bonusFor({ gate: gate(), mode: "cap", pct: 10, veto: "none" });
    expect(out.kind).toBe("payable");
    if (out.kind !== "payable") return;
    // 1000 declared, 400 issued, 600 held back, 10% of that is 60.
    expect(out.award.unmintedMinor).toBe(600);
    expect(out.award.amountMinor).toBe(60);
    expect(out.award.pct).toBe(10);
    expect(out.award.scope).toBe("season");
    expect(out.award.unit).toBe("token:credits");
  });

  it("FLOORS and never rounds, so a bonus can never exceed the published share", () => {
    // 7 held back at 10% is 0.7, and rounding would pay 1.
    const out = bonusFor({
      gate: gate({ spend: spend({ capMinor: 1000, spentMinor: 993, remainingMinor: 7 }) }),
      mode: "cap", pct: 10, veto: "none",
    });
    expect(out.kind, "a share that floors to nothing is its own fact").toBe("too_small");
    if (out.kind !== "too_small") return;
    expect(out.unmintedMinor, "and it still says what was held back").toBe(7);
  });

  it("pays nothing to a circle that issued its whole cap, and says that is no judgement", () => {
    const out = bonusFor({
      gate: gate({ spend: spend({ state: "at_cap", spentMinor: 1000, remainingMinor: 0 }) }),
      mode: "cap", pct: 10, veto: "none",
    });
    expect(out.kind).toBe("no_room");
    if (out.kind !== "no_room") return;
    expect(out.reason).toContain("not a failure");
  });

  it("pays nothing when the village set the share to zero, and says the vote still stands", () => {
    const out = bonusFor({ gate: gate(), mode: "cap", pct: 0, veto: "none" });
    expect(out.kind).toBe("switched_off");
    if (out.kind !== "switched_off") return;
    expect(out.reason).toContain("completion vote");
  });
});

describe("the bonus, under a treasury", () => {
  it("REFUSES, because that value already carries to the next period", () => {
    /*
     * The gate itself also blocks a treasury circle with a sentence of its
     * own, and this branch sits AHEAD of that on purpose: the answer is a
     * ruling and never a queue of things to fix.
     */
    const out = bonusFor({ gate: gate(), mode: "treasury", pct: 10, veto: "none" });
    expect(out.kind).toBe("carries_over");
    if (out.kind !== "carries_over") return;
    expect(out.reason).toContain("still holds");
  });

  it("refuses even when every other condition would have paid", () => {
    // Identical input, one field apart, and the two answers are different.
    const asCap = bonusFor({ gate: gate(), mode: "cap", pct: 10, veto: "none" });
    const asTreasury = bonusFor({ gate: gate(), mode: "treasury", pct: 10, veto: "none" });
    expect(asCap.kind).toBe("payable");
    expect(asTreasury.kind).toBe("carries_over");
  });
});

describe("the verdict this file does not make", () => {
  it("refuses when the gate says the work was not voted complete", () => {
    const out = bonusFor({
      gate: gate({
        vote: vote({ state: "said_no" }),
        blocking: ["The village voted that this circle did not complete its work."],
      }),
      mode: "cap", pct: 10, veto: "none",
    });
    expect(out.kind).toBe("blocked");
    if (out.kind !== "blocked") return;
    expect(out.reasons[0]).toContain("did not complete");
  });

  it("refuses when nobody has been asked, and carries the gate's own words", () => {
    const out = bonusFor({
      gate: gate({
        vote: vote({ state: "never_asked", ballotId: null }),
        blocking: ["The village has not been asked whether this circle completed its work."],
      }),
      mode: "cap", pct: 10, veto: "none",
    });
    expect(out.kind).toBe("blocked");
  });

  it("REQUIRES A YES OUT LOUD, so an empty refusal list is never an authorisation", () => {
    /*
     * The gate's own header says an empty `blocking` is the absence of a
     * stated objection and never a yes. This is that sentence as a test: a
     * gate that grew a blocking condition and forgot to push a line for it
     * would otherwise pay through the gap.
     */
    const out = bonusFor({
      gate: gate({ vote: vote({ state: "no_quorum" }), blocking: [] }),
      mode: "cap", pct: 10, veto: "none",
    });
    expect(out.kind).toBe("blocked");
    if (out.kind !== "blocked") return;
    expect(out.reasons[0]).toContain("has not voted");
  });

  it("refuses on a veto, and says the completion finding went with it", () => {
    const out = bonusFor({ gate: gate(), mode: "cap", pct: 10, veto: "vetoed" });
    expect(out.kind).toBe("vetoed");
    if (out.kind !== "vetoed") return;
    expect(out.reason).toContain("completion finding");
  });

  it("refuses when a veto could not be READ, because an unread veto is not an absent one", () => {
    const out = bonusFor({ gate: gate(), mode: "cap", pct: 10, veto: "unknown" });
    expect(out.kind).toBe("veto_unknown");
  });

  it("REFUSES WHILE THE WINDOW IS STILL OPEN, because no veto yet is not no veto", () => {
    /*
     * Rye's ruling, 2026-09-08: a decision should never pass until the veto
     * window expires or every steward who can stop it has said yes.
     *
     * The dangerous reading is the one this replaces. A ballot that carried and
     * has not been vetoed looks identical, at this instant, to one whose window
     * ran out with nobody objecting. Paying on the first spends the money in
     * exactly the days a steward was promised to stop it in.
     */
    const out = bonusFor({ gate: gate(), mode: "cap", pct: 10, veto: "window_open" });
    expect(out.kind).toBe("veto_window_open");
    if (out.kind !== "veto_window_open") return;
    expect(out.reason).toContain("has not run out yet");
  });

  it("keeps the four verdicts APART, so a wait is never read as a refusal or a go", () => {
    // The defect this guards is one sentence serving two facts. A member told
    // "nothing is paid" wants to know whether to wait three days or to give up.
    const kinds = (["none", "vetoed", "unknown", "window_open"] as const).map(
      (v) => bonusFor({ gate: gate(), mode: "cap", pct: 10, veto: v }).kind,
    );
    expect(new Set(kinds).size, `four verdicts gave ${JSON.stringify(kinds)}`).toBe(4);
    expect(kinds[0]).not.toBe("veto_window_open");
  });
});

describe("the dial", () => {
  it("is in the registry under the key this file names", () => {
    const def = VARIABLES_BY_KEY[BONUS_PCT_KEY];
    expect(def, `${BONUS_PCT_KEY} has to exist or every read of it throws`).toBeTruthy();
    expect(def!.type).toBe("percentage");
  });

  it("defaults to 10, which is the number the header reasons about", () => {
    expect(VARIABLES_BY_KEY[BONUS_PCT_KEY]!.default).toBe("10");
    expect(VARIABLES_BY_KEY[BONUS_PCT_KEY]!.min).toBe(0);
    // 100 would hand back the whole cap, which turns a cap into a treasury.
    expect(VARIABLES_BY_KEY[BONUS_PCT_KEY]!.max).toBe(100);
  });
});

describe("the sentences", () => {
  it("names the figures a steward has to check, on a payable award", () => {
    const out = bonusFor({ gate: gate(), mode: "cap", pct: 10, veto: "none" });
    const said = bonusSentence(out, WORDS, "kitchen");
    expect(said).toContain("the kitchen circle");
    expect(said).toContain("600 token:credits");
    expect(said).toContain("60 token:credits");
    expect(said, "a bonus mints, and the sentence says so").toContain("issuance cap");
  });

  it("writes the refusals apart, so no two outcomes share a sentence", () => {
    const said = new Set(
      [
        bonusFor({ gate: gate(), mode: "treasury", pct: 10, veto: "none" }),
        bonusFor({ gate: gate(), mode: "cap", pct: 10, veto: "vetoed" }),
        bonusFor({ gate: gate(), mode: "cap", pct: 10, veto: "unknown" }),
        bonusFor({ gate: gate(), mode: "cap", pct: 0, veto: "none" }),
        bonusFor({
          gate: gate({ spend: spend({ state: "at_cap", spentMinor: 1000, remainingMinor: 0 }) }),
          mode: "cap", pct: 10, veto: "none",
        }),
      ].map((o) => bonusSentence(o, WORDS, "kitchen")),
    );
    expect(said.size, "five outcomes, five sentences").toBe(5);
  });
});
