/**
 * THE DEFERRAL, THE PERIOD IT LANDS ON, AND THE FOUR THINGS A ZERO CAN MEAN.
 *
 * Everything here is pure: no database, no clock, no village. What needs those
 * is in server/lib/circleTreasury.test.ts, which posts real ledger rows, and
 * server/circleTreasury.e2e.test.ts, which drives the built server.
 *
 * The rule this file exists for is Rye's: a circle finishes its period on the
 * model it started with. `modeAt` IS that rule, so it is tested at the instant
 * before the boundary, at the boundary, and after it.
 */
import { describe, expect, it } from "vitest";
import {
  BUDGET_MODES,
  isBudgetMode,
  modeAt,
  modeChangeProblem,
  modeChangeSchedule,
  modeChangeSentence,
  treasuryTotalSentence,
  treasuryTotalState,
  type PendingModeChange,
  type PeriodBounds,
  type TreasuryTotal,
} from "./circleTreasury";

const DAY = 86_400_000;
const SEASON_END = Date.UTC(2026, 11, 1);

const SEASON: PeriodBounds = {
  id: "rooting-2026",
  startsAt: new Date(Date.UTC(2026, 8, 1)).toISOString(),
  endsAt: new Date(SEASON_END).toISOString(),
};

const CYCLE: PeriodBounds = {
  id: "lunar-000332",
  startsAt: new Date(Date.UTC(2026, 8, 20)).toISOString(),
  endsAt: new Date(Date.UTC(2026, 9, 20)).toISOString(),
};

const QUEUED: PendingModeChange = {
  mode: "treasury",
  from: SEASON.endsAt,
  by: "usr-steward",
  at: new Date(Date.UTC(2026, 8, 15)).toISOString(),
};

describe("a mode change lands at the boundary and never before it", () => {
  it("changes nothing the instant before the period turns", () => {
    const justBefore = new Date(SEASON_END - 1);
    expect(modeAt("cap", QUEUED, justBefore)).toBe("cap");
    // A whole month before, with the change already queued, is the same answer.
    expect(modeAt("cap", QUEUED, new Date(SEASON_END - 30 * DAY))).toBe("cap");
  });

  it("takes effect AT the boundary, and the boundary instant belongs to the new period", () => {
    expect(modeAt("cap", QUEUED, new Date(SEASON_END))).toBe("treasury");
    expect(modeAt("cap", QUEUED, new Date(SEASON_END + 1))).toBe("treasury");
    expect(modeAt("cap", QUEUED, new Date(SEASON_END + 60 * DAY))).toBe("treasury");
  });

  it("reads the stored mode when nothing is queued", () => {
    expect(modeAt("cap", null, new Date(SEASON_END + DAY))).toBe("cap");
    expect(modeAt("treasury", undefined, new Date(SEASON_END + DAY))).toBe("treasury");
  });

  it("IGNORES A JUNK INSTANT INSTEAD OF LANDING THE CHANGE NOW", () => {
    /*
     * The failure this guards: treating an unparseable `from` as "already
     * passed" applies a change the village scheduled for later, which is the
     * one thing the whole deferral exists to prevent. The stored mode stands.
     */
    const junk: PendingModeChange = { ...QUEUED, from: "the next season" };
    expect(modeAt("cap", junk, new Date(SEASON_END + 365 * DAY))).toBe("cap");
    expect(modeAt("cap", { ...QUEUED, from: "" }, new Date())).toBe("cap");
  });

  it("works in both directions, because leaving a treasury waits too", () => {
    const back: PendingModeChange = { ...QUEUED, mode: "cap" };
    expect(modeAt("treasury", back, new Date(SEASON_END - 1))).toBe("treasury");
    expect(modeAt("treasury", back, new Date(SEASON_END))).toBe("cap");
  });
});

describe("which boundary a change is queued for", () => {
  it("takes the season's end when the village has one", () => {
    const s = modeChangeSchedule(SEASON, CYCLE);
    expect(s.boundary).toBe("season");
    expect(s.from).toBe(SEASON.endsAt);
  });

  it("falls back to the cycle when no season covers the instant, and SAYS SO", () => {
    const s = modeChangeSchedule(null, CYCLE);
    expect(s.boundary).toBe("cycle");
    expect(s.from).toBe(CYCLE.endsAt);
    // The sentence must not promise a season it is not waiting for.
    const said = modeChangeSentence("The Kitchen Circle", "cap", "treasury", s);
    expect(said).toContain("next cycle boundary");
    expect(said).not.toContain("next season");
  });

  it("names the season in the sentence when that is what it waited for", () => {
    const said = modeChangeSentence("The Kitchen Circle", "cap", "treasury", modeChangeSchedule(SEASON, CYCLE));
    expect(said).toContain("start of the next season");
    expect(said).toContain("finishes this period on its spending cap");
    expect(said).toContain("2026-12-01");
  });

  it("ignores a season whose end is unreadable and uses the cycle", () => {
    const broken: PeriodBounds = { ...SEASON, endsAt: "whenever" };
    expect(modeChangeSchedule(broken, CYCLE).boundary).toBe("cycle");
  });
});

describe("what may be queued", () => {
  it("refuses a mode the circle is already running, so no empty schedule is shown", () => {
    expect(modeChangeProblem("cap", "cap")).toContain("already runs on a cap");
    expect(modeChangeProblem("treasury", "cap")).toBeNull();
  });

  it("refuses a word that is neither", () => {
    expect(modeChangeProblem("envelope", "cap")).toContain("neither");
    expect(modeChangeProblem(undefined, "cap")).toContain("neither");
    expect(isBudgetMode("cap")).toBe(true);
    expect(isBudgetMode("Treasury")).toBe(false);
    expect(BUDGET_MODES).toEqual(["cap", "treasury"]);
  });
});

describe("the village-wide figure, and the four things a zero can mean", () => {
  const total = (over: Partial<TreasuryTotal> = {}): TreasuryTotal => ({
    state: "held",
    heldMinor: 12_000,
    accountsHolding: 3,
    budgetsOnTreasury: 4,
    ...over,
  });

  it("separates module-off from every-circle-on-a-cap from every-treasury-empty", () => {
    expect(treasuryTotalState(false, 0, 0)).toBe("module_off");
    expect(treasuryTotalState(true, 0, 0)).toBe("none_on_treasury");
    expect(treasuryTotalState(true, 0, 4)).toBe("all_empty");
    expect(treasuryTotalState(true, 2, 4)).toBe("held");
  });

  it("REPORTS HELD EVEN WHILE THE MODULE IS OFF, because the tokens are real", () => {
    /*
     * A village that turned the resources module off with circles still
     * holding tokens must not be told it has no treasuries. The lifecycle flag
     * does not move a balance, and hiding a real one behind it is the
     * empty-state confusion this whole union exists to prevent.
     */
    expect(treasuryTotalState(false, 2, 0)).toBe("held");
  });

  it("gives four different sentences and never one covering the class", () => {
    const words = (minor: number) => `${minor / 100} credits`;
    const off = treasuryTotalSentence(total({ state: "module_off", heldMinor: null, accountsHolding: 0, budgetsOnTreasury: 0 }), words);
    const none = treasuryTotalSentence(total({ state: "none_on_treasury", heldMinor: 0, accountsHolding: 0, budgetsOnTreasury: 0 }), words);
    const empty = treasuryTotalSentence(total({ state: "all_empty", heldMinor: 0, accountsHolding: 0 }), words);
    const held = treasuryTotalSentence(total(), words);

    expect(new Set([off, none, empty, held]).size).toBe(4);
    expect(off).toContain("not running circle treasuries");
    expect(none).toContain("measured zero");
    expect(empty).toContain("an empty treasury is not a spent one");
    expect(held).toContain("120 credits");
    // The reason the figure exists, in the sentence a founder reads.
    expect(held).toContain("overstates what is loose");
  });
});
