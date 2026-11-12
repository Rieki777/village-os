import { describe, expect, it } from "vitest";
import { checkThread, goalOf, openQuestsPerGoal, readThreads, withThread } from "./questThreads";

const GOALS = [
  { id: "gwater", text: "Clean water all year", done: false },
  { id: "gfood", text: "Feed ourselves from the land", done: false },
  { id: "gdone", text: "Name our circles", done: true },
];

describe("readThreads", () => {
  it("keeps a goal and a place per quest, and drops junk without throwing", () => {
    expect(
      readThreads({
        v: 1,
        quests: {
          a: { goalId: "gwater", place: "land" },
          b: { goalId: "has spaces", place: "moon" },
          c: { place: "remote" },
          d: "nonsense",
        },
      }),
    ).toEqual({ a: { goalId: "gwater", place: "land" }, c: { goalId: null, place: "remote" } });
    expect(readThreads(null)).toEqual({});
    expect(readThreads({ quests: [] })).toEqual({});
  });
});

describe("checkThread", () => {
  const ids = GOALS.map((g) => g.id);

  it("accepts a goal on this season and one of the three places", () => {
    expect(checkThread({ goalId: "gwater", place: "both" }, ids)).toEqual({ ok: true, thread: { goalId: "gwater", place: "both" } });
  });

  it("clears either half with null or an empty value", () => {
    expect(checkThread({ goalId: "", place: null }, ids)).toEqual({ ok: true, thread: { goalId: null, place: null } });
  });

  it("refuses a goal this season does not hold, and a place that is not one of the three", () => {
    expect(checkThread({ goalId: "gold" }, ids)).toMatchObject({ ok: false, field: "goalId" });
    expect(checkThread({ place: "everywhere" }, ids)).toMatchObject({ ok: false, field: "place" });
  });
});

describe("withThread", () => {
  it("sets one quest's thread and leaves the others", () => {
    const doc = withThread({ v: 1, quests: { a: { goalId: "gwater", place: null } } }, "b", { goalId: "gfood", place: "land" });
    expect(doc).toEqual({ v: 1, quests: { a: { goalId: "gwater", place: null }, b: { goalId: "gfood", place: "land" } } });
  });

  it("removes a quest whose thread is emptied", () => {
    expect(withThread({ v: 1, quests: { a: { goalId: "gwater", place: null } } }, "a", { goalId: null, place: null })).toEqual({ v: 1, quests: {} });
  });
});

describe("openQuestsPerGoal: the village's count, never a person's", () => {
  const quests = [
    { id: "q1", status: "Open" },
    { id: "q2", status: "Seasonal" },
    { id: "q3", status: "Closed" },
    { id: "q4", status: "Open", isExample: true },
    { id: "q5", status: "Open" },
  ];
  const threads = {
    q1: { goalId: "gwater", place: null },
    q2: { goalId: "gwater", place: "land" as const },
    q3: { goalId: "gwater", place: null },
    q4: { goalId: "gwater", place: null },
    q5: { goalId: "gfood", place: null },
  };

  it("counts each goal's open quests, never a closed one or a standing example", () => {
    expect(openQuestsPerGoal(quests, threads, GOALS)).toEqual([
      { id: "gwater", text: "Clean water all year", done: false, openQuests: 2 },
      { id: "gfood", text: "Feed ourselves from the land", done: false, openQuests: 1 },
      { id: "gdone", text: "Name our circles", done: true, openQuests: 0 },
    ]);
  });

  it("a thread naming a goal the season no longer holds counts nowhere", () => {
    const out = openQuestsPerGoal([{ id: "q9", status: "Open" }], { q9: { goalId: "gremoved", place: null } }, GOALS);
    expect(out.every((g) => g.openQuests === 0)).toBe(true);
  });
});

describe("goalOf", () => {
  it("finds the goal a quest grows, or null when the season no longer holds it", () => {
    expect(goalOf("gfood", GOALS)?.text).toBe("Feed ourselves from the land");
    expect(goalOf("gremoved", GOALS)).toBeNull();
    expect(goalOf(null, GOALS)).toBeNull();
  });
});
