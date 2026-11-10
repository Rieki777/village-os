import { describe, expect, it } from "vitest";
import { GOAL_LIMITS, GOAL_WORDS, goalDateWindow, goalsAsText, goalsNudge, goalsOf, legacyGoals, parseGoals } from "./proposalGoals";
import { goalsOfApplication, parseApplicationAnswers, parseApplicationInput } from "./seatApplications";

const goal = (over: Record<string, unknown> = {}) => ({ title: "Plant the first three beds", doneWhen: "they are planted and watered", moves: "", serves: "", date: "", roleId: "r1", ...over });
const ROLE_GOALS: Record<string, string[]> = { r1: ["Food grows every season", "Two people learn the work"], r2: [] };
const CTX = { roleGoalsOf: (id: string) => ROLE_GOALS[id] ?? [], seasonKeys: new Set(["sg1"]), today: "2026-11-10" };

describe("parseGoals", () => {
  it("takes one to eight goals with a title and a done when, and leaves a wholly blank row out", () => {
    const r = parseGoals([goal(), { title: "", doneWhen: "" }, goal({ title: "Share the plan", doneWhen: "every lead has it", moves: "Food grows every season", serves: "sg1", date: "2026-11-20" })], CTX);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.goals.map((g) => g.title)).toEqual(["Plant the first three beds", "Share the plan"]);
  });

  it("needs at least one goal, and says so in plain words", () => {
    expect(parseGoals([], CTX)).toEqual({ ok: false, error: GOAL_WORDS.needOne });
    expect(parseGoals([{ title: " ", doneWhen: "" }], CTX)).toEqual({ ok: false, error: GOAL_WORDS.needOne });
  });

  it("refuses what is malformed: not a list, a goal with no title or no done when, over-long words", () => {
    expect(parseGoals("plant beds", CTX).ok).toBe(false);
    expect(parseGoals([5], CTX).ok).toBe(false);
    expect(parseGoals([goal({ title: "" , doneWhen: "x"})], CTX)).toEqual({ ok: false, error: GOAL_WORDS.needTitle(1) });
    expect(parseGoals([goal({ doneWhen: "" })], CTX)).toEqual({ ok: false, error: GOAL_WORDS.needDoneWhen(1) });
    expect(parseGoals([goal({ title: "x".repeat(GOAL_LIMITS.title + 1) })], CTX).ok).toBe(false);
    expect(parseGoals([goal({ doneWhen: "x".repeat(GOAL_LIMITS.doneWhen + 1) })], CTX).ok).toBe(false);
  });

  it("holds the cap of eight for each role, and never refuses three, five or six", () => {
    const n = (k: number, roleId = "r1") => Array.from({ length: k }, (_, i) => goal({ title: `g${i}`, roleId }));
    expect(parseGoals(n(8), CTX).ok).toBe(true);
    expect(parseGoals(n(9), CTX).ok).toBe(false);
    expect(parseGoals([...n(8, "r1"), ...n(8, "r2")], CTX).ok).toBe(true);
    for (const k of [1, 2, 6, 7]) expect(parseGoals(n(k), CTX).ok).toBe(true);
  });

  it("holds a goal to the role's own goals, and a role with none keeps it empty", () => {
    expect(parseGoals([goal({ moves: "Something the role never listed" })], CTX)).toEqual({ ok: false, error: GOAL_WORDS.notTheRole(1) });
    expect(parseGoals([goal({ roleId: "r2", moves: "Anything" })], CTX).ok).toBe(false);
    expect(parseGoals([goal({ roleId: "r2" })], CTX).ok).toBe(true);
  });

  it("holds a season goal to the season's, and a date to a moon either side of today", () => {
    expect(parseGoals([goal({ serves: "nope" })], CTX)).toEqual({ ok: false, error: GOAL_WORDS.notASeasonGoal(1) });
    expect(parseGoals([goal({ date: "next friday" })], CTX)).toEqual({ ok: false, error: GOAL_WORDS.badDate(1) });
    expect(parseGoals([goal({ date: "2026-02-30" })], CTX).ok).toBe(false);
    expect(parseGoals([goal({ date: "2027-03-01" })], CTX)).toEqual({ ok: false, error: GOAL_WORDS.dateOutside(1) });
    expect(parseGoals([goal({ date: "2026-12-01" })], CTX).ok).toBe(true);
    expect(goalDateWindow("2026-11-10")).toEqual({ min: "2026-11-09", max: "2026-12-11" });
  });

  it("names no share, percentage or amount anywhere in its words", () => {
    const all = JSON.stringify(GOAL_WORDS) + goalsNudge(1) + goalsNudge(9);
    expect(all).not.toMatch(/%|percent|share|\$|hour/i);
  });
});

describe("goalsNudge", () => {
  it("is gentle outside three to five and silent inside it", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 8].map((n) => goalsNudge(n))).toEqual([null, "few", "few", null, null, null, "many", "many"]);
    expect(goalsNudge(4, 2)).toBe("few");
    expect(goalsNudge(8, 2)).toBeNull();
  });
});

describe("older words and stored lists", () => {
  it("reads an old block of words as one goal, and nothing as none", () => {
    expect(legacyGoals("Plant beds, done when planted.")).toEqual([expect.objectContaining({ title: "Plant beds, done when planted.", doneWhen: "" })]);
    expect(legacyGoals("  ")).toEqual([]);
    expect(goalsOfApplication({ answers: null, deliverables: "Old words" })[0]?.title).toBe("Old words");
  });

  it("shows the list in place of the old words when an application has one", () => {
    const answers = parseApplicationAnswers({ goals: [goal()] });
    expect(goalsOfApplication({ answers, deliverables: "Old words" })).toHaveLength(1);
    expect(goalsOfApplication({ answers, deliverables: "Old words" })[0]?.title).toBe("Plant the first three beds");
  });

  it("reads a stored list back safely and writes the lines older readers show", () => {
    expect(goalsOf("nonsense")).toEqual([]);
    expect(goalsOf([goal(), { title: "" }, null])).toHaveLength(1);
    expect(goalsAsText([goal()] as any)).toBe("- Plant the first three beds, done when they are planted and watered");
  });
});

describe("the application input carries the goals", () => {
  const body = (goals: unknown) => ({ seatIds: ["r1"], seatSettings: { v: 1 }, answers: { aim: "Food grows.", goals } });
  it("keeps a good list in the answers and writes the old words from it", () => {
    const r = parseApplicationInput(body([goal()]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.answers?.goals).toHaveLength(1);
      expect(r.input.deliverables).toContain("Plant the first three beds");
    }
  });
  it("refuses a malformed list on the field `goals`, and an empty one", () => {
    expect(parseApplicationInput(body([goal({ doneWhen: "" })]))).toMatchObject({ ok: false, field: "goals" });
    expect(parseApplicationInput(body([]))).toMatchObject({ ok: false, field: "goals" });
    expect(parseApplicationInput(body("beds"))).toMatchObject({ ok: false, field: "goals" });
    expect(parseApplicationInput(body(Array.from({ length: 9 }, () => goal())))).toMatchObject({ ok: false, field: "goals" });
  });
  it("is unchanged for a body with no goals", () => {
    expect(parseApplicationInput({ seatIds: ["r1"], seatSettings: { v: 1 }, deliverables: "Old words" })).toMatchObject({ ok: true, input: { deliverables: "Old words", answers: null } });
  });
});
