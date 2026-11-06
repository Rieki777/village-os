/**
 * A player's own words on their season plan (player role card PR 6): the
 * parsers' limits, the refusals they share with seat terms, and how a plan the
 * previous release wrote reads.
 */
import { describe, expect, it } from "vitest";
import { SEASONAL_GOALS_MAX } from "./playerCard";
import { parsePlanInput } from "./seasonPlans";
import {
  CARD_WORD_KEYS,
  CARD_WORD_MAX,
  DONE_WHEN_MAX,
  HOW_IT_HELPS_MAX,
  parseCardWords,
  parseMoonLoad,
  parseSeasonalGoals,
  parseServesGoals,
  SEASONAL_GOALS_LIMIT,
  SEASONAL_TITLE_MAX,
  servedGoalsOf,
} from "./seasonPlanWords";
import { PAYMENT_DETAIL_MESSAGE } from "./seatSettings";

const GOALS = ["Plant the north orchard", "Open the guest kitchen"];
const CARD_NUMBER = "pay me at 4111 1111 1111 1111";

describe("goals served, each with how it helps", () => {
  it("reads every ticked goal with its line, and an empty list as none", () => {
    const r = parseServesGoals([{ goal: "Open the guest kitchen", howItHelps: " Meals for every gathering. " }, { goal: GOALS[0] }], GOALS);
    expect(r).toEqual({ ok: true, value: [{ goal: "Open the guest kitchen", howItHelps: "Meals for every gathering." }, { goal: GOALS[0], howItHelps: null }] });
    expect(parseServesGoals([], GOALS)).toEqual({ ok: true, value: null });
    expect(parseServesGoals(null, GOALS)).toEqual({ ok: true, value: null });
    expect(parseServesGoals(undefined, GOALS)).toEqual({ ok: true, value: undefined });
  });

  it("holds the line to 200 characters, and 200 exactly is taken (control)", () => {
    expect(HOW_IT_HELPS_MAX).toBe(200);
    expect(parseServesGoals([{ goal: GOALS[0], howItHelps: "a".repeat(200) }], GOALS).ok).toBe(true);
    const r = parseServesGoals([{ goal: GOALS[0], howItHelps: "a".repeat(201) }], GOALS);
    expect(r).toMatchObject({ ok: false, field: "servesGoals.0.howItHelps" });
  });

  it("takes only the season's goals, each once, and never more than the season holds", () => {
    expect(parseServesGoals([{ goal: "Build a rocket" }], GOALS)).toMatchObject({ ok: false, field: "servesGoals.0.goal" });
    expect(parseServesGoals([{ goal: GOALS[0] }, { goal: GOALS[0] }], GOALS)).toMatchObject({ ok: false, field: "servesGoals.1.goal" });
    expect(parseServesGoals([{ goal: GOALS[0] }, { goal: GOALS[1] }, { goal: GOALS[0] }], GOALS)).toMatchObject({ ok: false, field: "servesGoals" });
    expect(parseServesGoals([{ goal: GOALS[0] }], [])).toMatchObject({ ok: false, field: "servesGoals" });
    expect(parseServesGoals([{ goal: GOALS[0], why: "x" }], GOALS)).toMatchObject({ ok: false, field: "servesGoals.0.why" });
  });

  it("refuses payment details in a line", () => {
    expect(parseServesGoals([{ goal: GOALS[0], howItHelps: CARD_NUMBER }], GOALS)).toEqual({ ok: false, field: "servesGoals.0.howItHelps", error: PAYMENT_DETAIL_MESSAGE });
  });
});

describe("seasonal goals", () => {
  it("are zero to three, the same three the player card reads", () => {
    expect(SEASONAL_GOALS_LIMIT).toBe(SEASONAL_GOALS_MAX);
    const three = [1, 2, 3].map((n) => ({ title: `Goal ${n}`, doneWhen: null }));
    expect(parseSeasonalGoals(three)).toEqual({ ok: true, value: three });
    expect(parseSeasonalGoals([...three, { title: "Goal 4" }])).toMatchObject({ ok: false, field: "seasonalGoals" });
    expect(parseSeasonalGoals([])).toEqual({ ok: true, value: null });
  });

  it("hold a title to 120 and done when to 300, with the limits themselves taken (control)", () => {
    expect([SEASONAL_TITLE_MAX, DONE_WHEN_MAX]).toEqual([120, 300]);
    expect(parseSeasonalGoals([{ title: "t".repeat(120), doneWhen: "d".repeat(300) }]).ok).toBe(true);
    expect(parseSeasonalGoals([{ title: "t".repeat(121) }])).toMatchObject({ ok: false, field: "seasonalGoals.0.title" });
    expect(parseSeasonalGoals([{ title: "t", doneWhen: "d".repeat(301) }])).toMatchObject({ ok: false, field: "seasonalGoals.0.doneWhen" });
  });

  it("drop a blank row, and refuse a done when with no title", () => {
    expect(parseSeasonalGoals([{ title: " ", doneWhen: "" }, { title: "Run the cider press", doneWhen: " Every apple pressed. " }])).toEqual({
      ok: true,
      value: [{ title: "Run the cider press", doneWhen: "Every apple pressed." }],
    });
    expect(parseSeasonalGoals([{ title: "", doneWhen: "Every apple pressed." }])).toMatchObject({ ok: false, field: "seasonalGoals.0.title" });
  });

  it("measure the work and never rank people, and carry no payment details", () => {
    expect(parseSeasonalGoals([{ title: "Top the leaderboard" }])).toMatchObject({ ok: false, field: "seasonalGoals.0.title" });
    expect(parseSeasonalGoals([{ title: "Press cider", doneWhen: "I am ranked first" }])).toMatchObject({ ok: false, field: "seasonalGoals.0.doneWhen" });
    expect(parseSeasonalGoals([{ title: CARD_NUMBER }])).toEqual({ ok: false, field: "seasonalGoals.0.title", error: PAYMENT_DETAIL_MESSAGE });
  });
});

describe("card words", () => {
  it("read the six answers, each to 300 characters, and drop blanks", () => {
    expect(CARD_WORD_KEYS).toEqual(["howIHold", "findMe", "decisions", "feedback", "growingEdge", "nextHolder"]);
    expect(CARD_WORD_MAX).toBe(300);
    const r = parseCardWords({ findMe: " Mondays. ", decisions: "By consent.", feedback: "", growingEdge: "x".repeat(300) });
    expect(r).toEqual({ ok: true, value: { findMe: "Mondays.", decisions: "By consent.", growingEdge: "x".repeat(300) } });
    expect(parseCardWords({ nextHolder: "x".repeat(301) })).toMatchObject({ ok: false, field: "cardWords.nextHolder" });
    expect(parseCardWords({ findMe: "  " })).toEqual({ ok: true, value: null });
  });

  it("refuse a question the card does not ask, words that are not words, and payment details", () => {
    expect(parseCardWords({ salary: "lots" })).toMatchObject({ ok: false, field: "cardWords.salary" });
    expect(parseCardWords({ findMe: 7 })).toMatchObject({ ok: false, field: "cardWords.findMe" });
    expect(parseCardWords(["findMe"])).toMatchObject({ ok: false, field: "cardWords" });
    expect(parseCardWords({ feedback: CARD_NUMBER })).toEqual({ ok: false, field: "cardWords.feedback", error: PAYMENT_DETAIL_MESSAGE });
  });
});

describe("this moon's load", () => {
  it("is a whole number from 1 (Healthy) to 5 (Heavy)", () => {
    for (const n of [1, 3, 5]) expect(parseMoonLoad(n)).toEqual({ ok: true, value: n });
    for (const bad of [0, 6, 2.5, "3", null, undefined]) expect(parseMoonLoad(bad), String(bad)).toMatchObject({ ok: false, field: "level" });
  });
});

describe("the plan body", () => {
  const base = { aim: "Plant it", commitments: {}, handingBack: [] };

  it("serves the first goal ticked as `servesGoal`, so the previous release reads it", () => {
    const r = parsePlanInput({ ...base, servesGoals: [{ goal: GOALS[1], howItHelps: "Meals." }, { goal: GOALS[0] }] }, { goals: GOALS });
    expect(r.ok && r.plan.servesGoal).toBe(GOALS[1]);
    expect(r.ok && r.plan.servesGoals).toHaveLength(2);
  });

  it("reads the previous page's one `servesGoal` as one goal served with no line yet", () => {
    const r = parsePlanInput({ ...base, servesGoal: GOALS[0] }, { goals: GOALS });
    expect(r.ok && r.plan.servesGoals).toEqual([{ goal: GOALS[0], howItHelps: null }]);
    // A group left out is not sent on: the route keeps what the newest version holds.
    expect(r.ok && "seasonalGoals" in r.plan).toBe(false);
    expect(r.ok && "cardWords" in r.plan).toBe(false);
  });

  it("refuses a bad group by its field", () => {
    expect(parsePlanInput({ ...base, seasonalGoals: [{ title: "x".repeat(121) }] }, { goals: GOALS })).toMatchObject({ ok: false, field: "seasonalGoals.0.title" });
    expect(parsePlanInput({ ...base, cardWords: { pay: "x" } }, { goals: GOALS })).toMatchObject({ ok: false, field: "cardWords.pay" });
    expect(parsePlanInput({ ...base, servesGoals: [{ goal: "nope" }] }, { goals: GOALS })).toMatchObject({ ok: false, field: "servesGoals.0.goal" });
  });
});

describe("a plan the previous release wrote", () => {
  it("serves its one `serves_goal`, with no line yet", () => {
    expect(servedGoalsOf(null, "Plant the north orchard")).toEqual([{ goal: "Plant the north orchard", howItHelps: null }]);
    expect(servedGoalsOf(null, null)).toEqual([]);
    // Control: a stored list wins over the column.
    expect(servedGoalsOf([{ goal: "B", howItHelps: "x" }], "A")).toEqual([{ goal: "B", howItHelps: "x" }]);
  });
});
