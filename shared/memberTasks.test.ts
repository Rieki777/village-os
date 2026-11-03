import { describe, expect, it } from "vitest";
import {
  PRESETS, alwaysShows, clampWeights, countsOf, horizonOf, parseTaskInput, parseTaskPatch, rankTasks, scoreTask,
  tierFromLibrary, type TaskForRank,
} from "./memberTasks";

const TODAY = "2026-11-02";
const t = (id: string, over: Partial<TaskForRank> = {}): TaskForRank => ({
  id, tier: "priority", status: "open", source: "self", dueOn: null, horizon: null, pinned: false, createdOn: TODAY, ...over,
});

describe("horizons in the village's days", () => {
  it("reads today, this week and later from the due date", () => {
    expect(horizonOf(t("a", { dueOn: "2026-11-01" }), TODAY)).toBe("today");
    expect(horizonOf(t("a", { dueOn: TODAY }), TODAY)).toBe("today");
    expect(horizonOf(t("a", { dueOn: "2026-11-08" }), TODAY)).toBe("week");
    expect(horizonOf(t("a", { dueOn: "2026-11-09" }), TODAY)).toBe("later");
    expect(horizonOf(t("a"), TODAY)).toBe("later");
  });
  it("lets a chosen horizon pull a task sooner but never later than its due date", () => {
    expect(horizonOf(t("a", { horizon: "today", dueOn: "2026-12-01" }), TODAY)).toBe("today");
    expect(horizonOf(t("a", { horizon: "later", dueOn: TODAY }), TODAY)).toBe("today");
  });
  it("always shows pinned tasks and tasks due within two days", () => {
    expect(alwaysShows(t("a", { pinned: true }), TODAY)).toBe(true);
    expect(alwaysShows(t("a", { dueOn: "2026-11-04" }), TODAY)).toBe(true);
    expect(alwaysShows(t("a", { dueOn: "2026-11-05" }), TODAY)).toBe(false);
  });
});

describe("the sliders", () => {
  it("clamps every weight to 0..10 and keeps the presets' caps", () => {
    const w = clampWeights({ tier: 99, due: -4, goal: "x", nonsense: 5 });
    expect(w.tier).toBe(10);
    expect(w.due).toBe(0);
    expect(w.goal).toBe(PRESETS.balanced.goal);
    expect("nonsense" in w).toBe(false);
    expect(clampWeights(PRESETS.everything).weekCap).toBeNull();
  });
  it("scores a high-tier task above a not-yet one with the same dates", () => {
    const w = PRESETS.balanced;
    expect(scoreTask(t("a", { tier: "high" }), w, TODAY)).toBeGreaterThan(scoreTask(t("b", { tier: "not_yet" }), w, TODAY));
  });
});

describe("ranking", () => {
  it("orders by horizon, then always-show, then score, stably", () => {
    const ranked = rankTasks(
      [t("later-low", { tier: "not_yet" }), t("later-high", { tier: "high" }), t("today", { dueOn: TODAY }), t("done", { status: "done" })],
      PRESETS.balanced, TODAY,
    );
    expect(ranked.map((r) => r.task.id)).toEqual(["today", "later-high", "later-low"]);
    expect(ranked[0].reasons).toContain("due_soon");
  });
  it("hides past the today cap but never hides an always-show task", () => {
    const many = Array.from({ length: 5 }, (_, i) => t(`h${i}`, { horizon: "today" }));
    const pinned = t("pin", { horizon: "today", pinned: true, tier: "not_yet" });
    const ranked = rankTasks([...many, pinned], { ...PRESETS.balanced, todayCap: 2 }, TODAY);
    expect(ranked.find((r) => r.task.id === "pin")!.shown).toBe(true);
    const c = countsOf(ranked);
    expect(c.today).toBe(3);
    expect(c.hidden).toBe(3);
  });
});

describe("the library's priorities", () => {
  it("maps High, Medium and Low, and flags anything else as priority", () => {
    expect(tierFromLibrary("High")).toEqual({ tier: "high", flagged: false });
    expect(tierFromLibrary("medium")).toEqual({ tier: "priority", flagged: false });
    expect(tierFromLibrary("LOW")).toEqual({ tier: "not_yet", flagged: false });
    expect(tierFromLibrary("urgent")).toEqual({ tier: "priority", flagged: true });
    expect(tierFromLibrary(undefined)).toEqual({ tier: "priority", flagged: true });
  });
});

describe("what a write may carry", () => {
  it("needs a title and trims it to 200 characters", () => {
    expect(parseTaskInput({ title: "  " }).ok).toBe(false);
    const p = parseTaskInput({ title: "x".repeat(300) });
    expect(p.ok && p.value.title.length).toBe(200);
  });
  it("refuses an unknown tier and a malformed date", () => {
    expect(parseTaskPatch({ tier: "urgent" }).ok).toBe(false);
    expect(parseTaskPatch({ dueOn: "next tuesday" }).ok).toBe(false);
    expect(parseTaskPatch({ dueOn: "" })).toEqual({ ok: true, value: { dueOn: null } });
  });
  it("keeps journal text as private detail", () => {
    const p = parseTaskInput({ title: "Call the plumber", privateDetail: "From my morning page: the leak is back." });
    expect(p.ok && p.value.privateDetail).toBe("From my morning page: the leak is back.");
  });
});
