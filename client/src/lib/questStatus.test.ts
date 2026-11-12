import { describe, expect, it } from "vitest";
import { cycleBoundsFor } from "@shared/lunar";
import { claimStatus, statusFor } from "./questStatus";
import { filterBoard, fitsRoots, groupByCircle, leadQuestFor, nextQuestFor, type BoardQuest } from "./questBoard";

const quest = (over: Partial<BoardQuest> & { id: string }): BoardQuest => ({
  title: over.id,
  gratitude: "",
  status: "Open",
  ...over,
});

describe("statusFor: the mark describes the work", () => {
  it("an open quest nobody carries is a seed, and so is one with no signs at all", () => {
    expect(statusFor({ active: 0, done: 0, moon: 0 })).toBe("seed");
    expect(statusFor(undefined)).toBe("seed");
    expect(statusFor(null)).toBe("seed");
  });

  it("a quest somebody carries is a sprout", () => {
    expect(statusFor({ active: 1, done: 0, moon: 0 })).toBe("sprout");
  });

  it("a quest done this moon is a flower; done in an earlier moon it is a seed again", () => {
    expect(statusFor({ active: 0, done: 3, moon: 1 })).toBe("flower");
    expect(statusFor({ active: 0, done: 3, moon: 0 })).toBe("seed");
  });

  it("an older server with no moon count never draws a flower", () => {
    expect(statusFor({ active: 0, done: 5 })).toBe("seed");
  });

  it("carried again after flowering, it reads as underway: a hand can join it now", () => {
    expect(statusFor({ active: 2, done: 1, moon: 1 })).toBe("sprout");
  });
});

describe("claimStatus: a member's own work on the profile", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");
  const moonStart = cycleBoundsFor(now).startsAt;
  const after = new Date(moonStart.getTime() + 3_600_000).toISOString();
  const before = new Date(moonStart.getTime() - 3_600_000).toISOString();

  it("work in hand is a sprout", () => {
    expect(claimStatus({ status: "claimed" }, now)).toBe("sprout");
    expect(claimStatus({ status: "submitted" }, now)).toBe("sprout");
  });

  it("consented since this moon's new moon is a flower", () => {
    expect(claimStatus({ status: "consented", resolvedAt: after }, now)).toBe("flower");
  });

  it("consented in an earlier moon, declined, or with no date has no mark", () => {
    expect(claimStatus({ status: "consented", resolvedAt: before }, now)).toBeNull();
    expect(claimStatus({ status: "consented", resolvedAt: null }, now)).toBeNull();
    expect(claimStatus({ status: "consented", resolvedAt: "not a date" }, now)).toBeNull();
    expect(claimStatus({ status: "declined", resolvedAt: after }, now)).toBeNull();
  });
});

describe("leadQuestFor: the one card that fits you", () => {
  const board = [
    quest({ id: "gentle", difficulty: "Beginner", order: 1, archetypes: ["weaver"] }),
    quest({ id: "mine", difficulty: "Advanced", order: 2, archetypes: ["healer", "builder"] }),
    quest({ id: "untagged", difficulty: "Beginner", order: 0 }),
    quest({ id: "gated-mine", difficulty: "Beginner", order: 0, archetypes: ["healer"], minStage: "member" }),
    quest({ id: "example-mine", difficulty: "Beginner", order: 0, archetypes: ["healer"], isExample: true }),
  ];

  it("a tagged quest carrying one of my roots leads, over a gentler one that does not", () => {
    expect(leadQuestFor(board, [], ["healer"])).toMatchObject({ quest: { id: "mine" }, reason: "begin", fits: true });
  });

  it("an untagged quest never claims to fit", () => {
    expect(fitsRoots(quest({ id: "u" }), ["healer"])).toBe(false);
    expect(fitsRoots(quest({ id: "t", archetypes: ["healer"] }), [])).toBe(false);
  });

  it("with no roots picked, the gentlest open quest leads, as before", () => {
    expect(leadQuestFor(board, [])).toMatchObject({ quest: { id: "untagged" }, fits: false, needed: false });
  });

  it("this season's need comes next: a quest growing an open goal leads among equals", () => {
    const needy = [
      quest({ id: "a", difficulty: "Beginner", order: 1 }),
      quest({ id: "b", difficulty: "Intermediate", order: 2, goalId: "gwater" }),
      quest({ id: "c", difficulty: "Beginner", order: 3, goalId: "gdone" }),
    ];
    expect(leadQuestFor(needy, [], [], ["gwater"])).toMatchObject({ quest: { id: "b" }, needed: true });
    // A goal already done is no longer a need.
    expect(leadQuestFor(needy, [], [], [])?.quest.id).toBe("a");
  });

  it("roots outrank the season's need", () => {
    const both = [
      quest({ id: "need", difficulty: "Beginner", goalId: "gwater" }),
      quest({ id: "root", difficulty: "Advanced", archetypes: ["healer"] }),
    ];
    expect(leadQuestFor(both, [], ["healer"], ["gwater"])?.quest.id).toBe("root");
  });

  it("roots never open a gated quest or an example", () => {
    const lead = leadQuestFor(board, [{ questId: "mine", status: "consented" }], ["healer"]);
    expect(lead?.quest.id).toBe("untagged");
  });

  it("finishing still beats starting on the board's own suggestion", () => {
    const s = nextQuestFor(board, [{ questId: "gentle", status: "claimed" }], ["healer"]);
    expect(s).toMatchObject({ quest: { id: "gentle" }, reason: "continue", fits: false });
  });
});

describe("filterBoard and groupByCircle: the open work list", () => {
  const board = [
    quest({ id: "a", circle: "Hearth", difficulty: "Beginner", goalId: "gwater", place: "land" }),
    quest({ id: "b", circle: "Land", difficulty: "Advanced", goalId: "gfood", place: "remote" }),
    quest({ id: "c", circle: " Hearth ", difficulty: "Beginner", place: "both" }),
    quest({ id: "d", difficulty: "Beginner", goalId: "gwater" }),
  ];
  const all = { circle: "All", difficulty: "All", goal: "All", place: "All" };

  it("narrows by season goal, the filter a goal's link opens", () => {
    expect(filterBoard(board, { ...all, goal: "gwater" }).map((q) => q.id)).toEqual(["a", "d"]);
  });

  it("a quest that happens in both places matches the land and the remote filter", () => {
    expect(filterBoard(board, { ...all, place: "land" }).map((q) => q.id)).toEqual(["a", "c"]);
    expect(filterBoard(board, { ...all, place: "remote" }).map((q) => q.id)).toEqual(["b", "c"]);
  });

  it("filters combine, and the board's order stands", () => {
    expect(filterBoard(board, { ...all, difficulty: "Beginner", goal: "gwater" }).map((q) => q.id)).toEqual(["a", "d"]);
    expect(filterBoard(board, all).map((q) => q.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("groups by circle in board order, the circle-less together at the end", () => {
    expect(groupByCircle(board).map((g) => [g.circle, g.quests.map((q) => q.id)])).toEqual([
      ["Hearth", ["a", "c"]],
      ["Land", ["b"]],
      [null, ["d"]],
    ]);
  });
});
