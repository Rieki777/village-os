/**
 * Pure-function tests for the settlement math (S27): the channel split and
 * the Sybil eligibility filter. These are the two properties the founders'
 * Hypha report depends on, so they get direct tests rather than riding the
 * loop test alone.
 */
import { describe, expect, it } from "vitest";
import {
  activeClock,
  currentCycle,
  cycleDaysRemaining,
  dueCycles,
  settleCycle,
  unreadableCycleIds,
  unreadableCycleProblem,
  type GratitudeEntryLike,
} from "./gratitude-cycles";

const entry = (over: Partial<GratitudeEntryLike>): GratitudeEntryLike => ({
  id: `g-${Math.abs(JSON.stringify(over).split("").reduce((a, c) => a + c.charCodeAt(0), 0))}`,
  fromId: "sender",
  toId: "recipient",
  amount: 1,
  cycleId: "lunar-000100",
  ...over,
});

describe("settleCycle", () => {
  it("splits hearts from acknowledgments and never blends them", () => {
    const totals = settleCycle(
      [
        entry({ fromId: "a", amount: 5, kind: "gratitude" }),
        entry({ fromId: "b", amount: 1, kind: "heart" }),
        entry({ fromId: "c", amount: 2, kind: "heart" }),
      ],
      "lunar-000100",
    );
    expect(totals).toEqual([
      { userId: "recipient", received: 8, receivedEligible: 8, receivedHearts: 3, receivedAcks: 5, distinctSenders: 3 },
    ]);
  });

  it("treats kind-less legacy rows as acknowledgments", () => {
    const totals = settleCycle([entry({ amount: 4 })], "lunar-000100");
    expect(totals[0].receivedAcks).toBe(4);
    expect(totals[0].receivedHearts).toBe(0);
  });

  it("Sybil rule: an ineligible sender counts toward neither breadth nor the pool", () => {
    const totals = settleCycle(
      [
        entry({ fromId: "member-1", amount: 5 }),
        entry({ fromId: "alt-account", amount: 1, kind: "heart" }),
        entry({ fromId: "alt-account-2", amount: 1, kind: "heart" }),
      ],
      "lunar-000100",
      new Set(["member-1"]),
    );
    // `received` stays the honest record of what was sent — the founders
    // carry that figure and its channel split to Hypha, so it is never
    // rewritten.
    expect(totals[0].received).toBe(7);
    // But the pool splits on `receivedEligible`, and so does breadth.
    //
    // This corrects an earlier reading of the rule, which filtered breadth
    // alone on the grounds that "amounts came from real budgets". The budgets
    // are real; the accounts are not. Eligibility here means having consented
    // on a quest or reached member stage, so a farm of do-nothing alts is
    // exactly what it excludes — and paying out on their sends would have let
    // signing up N times enlarge one member's share of real value while the
    // leaderboard beside it stayed correctly unimpressed.
    expect(totals[0].receivedEligible).toBe(5);
    expect(totals[0].distinctSenders).toBe(1);
  });

  it("with no eligibility set at all, every amount counts (the ungated default)", () => {
    const totals = settleCycle(
      [entry({ fromId: "x", amount: 3 }), entry({ fromId: "y", amount: 4 })],
      "lunar-000100",
    );
    expect(totals[0].received).toBe(7);
    expect(totals[0].receivedEligible).toBe(7);
  });

  it("without an eligibility set, behaves exactly as before", () => {
    const totals = settleCycle(
      [entry({ fromId: "x" }), entry({ fromId: "y" })],
      "lunar-000100",
    );
    expect(totals[0].distinctSenders).toBe(2);
  });
});

/**
 * The half of this that used to be silent.
 *
 * A row whose cycle id nothing can parse is not a row belonging to some other
 * lunation. It is a row nobody knows the lunation of, and the settlement used
 * to leave it out without a word: 30 of 130 units vanished from a real
 * settlement, every recipient under them was told a smaller number than they
 * had earned, and their share of the pool was computed from it.
 */
describe("an id it cannot read", () => {
  it("stops the settlement rather than being left out of it", () => {
    const rows = [entry({ fromId: "a", amount: 5 }), entry({ fromId: "b", amount: 3, cycleId: "moon-100" })];
    expect(() => settleCycle(rows, "lunar-000100")).toThrow(/moon-100/);
  });

  it("stops the due list too, so a lunation cannot go unclosed in silence", () => {
    const rows = [entry({ cycleId: "2026-07" })];
    expect(() => dueCycles([], rows, new Date())).toThrow(/2026-07/);
  });

  it("names every unreadable id once, in plain words", () => {
    const rows = [
      entry({ cycleId: "moon-100" }),
      entry({ cycleId: "moon-100", fromId: "b" }),
      entry({ cycleId: "" }),
    ];
    expect(unreadableCycleIds(rows)).toEqual(["", "moon-100"]);
    const problem = unreadableCycleProblem(rows);
    expect(problem).toContain("3 recognition row(s)");
    expect(problem).toContain("(empty)");
    expect(problem).toContain("moon-100");
  });

  it("says nothing at all when every id is readable", () => {
    const rows = [entry({ fromId: "a" }), entry({ fromId: "b", cycleId: "lunar-000101" })];
    expect(unreadableCycleIds(rows)).toEqual([]);
    expect(unreadableCycleProblem(rows)).toBeNull();
    expect(() => settleCycle(rows, "lunar-000100")).not.toThrow();
  });
});

describe("the countdown every surface shows", () => {
  it("counts to the open cycle's own end under the village's clock", () => {
    const at = new Date("2026-09-03T12:00:00Z");
    const open = currentCycle(at);
    expect(cycleDaysRemaining(at)).toBe(
      Math.ceil((new Date(open.endsAt).getTime() - at.getTime()) / 86_400_000),
    );
  });

  it("defaults to the moon, because that is what a village runs until it votes", () => {
    expect(activeClock().mode).toBe("lunar");
    expect(currentCycle(new Date("2026-09-03T12:00:00Z")).clock).toBe("lunar");
  });

  it("says zero rather than a negative number once the cycle has ended", () => {
    const open = currentCycle(new Date("2026-09-03T12:00:00Z"));
    const past = new Date(new Date(open.endsAt).getTime() + 1000);
    // Asked at an instant past this cycle's end, the OPEN cycle is a later
    // one, so the answer is that cycle's own remainder and never below zero.
    expect(cycleDaysRemaining(past)).toBeGreaterThanOrEqual(0);
  });
});
