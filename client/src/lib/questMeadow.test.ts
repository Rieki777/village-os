import { describe, expect, it } from "vitest";
import { cycleBoundsFor } from "@shared/lunar";
import { bedLayout, claimPlant, meadowBeds, meadowOrder, plantFor, stepThrough } from "./questMeadow";
import { fitsRoots, leadQuestFor, nextQuestFor, type BoardQuest } from "./questBoard";

const quest = (over: Partial<BoardQuest> & { id: string }): BoardQuest => ({
  title: over.id,
  gratitude: "",
  status: "Open",
  ...over,
});

describe("plantFor: a plant describes the work", () => {
  it("an open quest nobody carries is a seed, and so is one with no signs at all", () => {
    expect(plantFor({ active: 0, done: 0, moon: 0 })).toBe("seed");
    expect(plantFor(undefined)).toBe("seed");
    expect(plantFor(null)).toBe("seed");
  });

  it("a quest somebody carries is a bud", () => {
    expect(plantFor({ active: 1, done: 0, moon: 0 })).toBe("bud");
  });

  it("a quest done this moon is a flower; done in an earlier moon it is a seed again", () => {
    expect(plantFor({ active: 0, done: 3, moon: 1 })).toBe("flower");
    expect(plantFor({ active: 0, done: 3, moon: 0 })).toBe("seed");
  });

  it("an older server with no moon count never draws a flower", () => {
    expect(plantFor({ active: 0, done: 5 })).toBe("seed");
  });

  it("carried again after flowering, it reads as a bud: the hand can join it now", () => {
    expect(plantFor({ active: 2, done: 1, moon: 1 })).toBe("bud");
  });
});

describe("meadowBeds: one bed per circle", () => {
  const board = [
    quest({ id: "a", circle: "Hearth" }),
    quest({ id: "b", circle: "Land & Water" }),
    quest({ id: "c", circle: " Hearth " }),
    quest({ id: "d" }),
    quest({ id: "e", circle: "Land & Water" }),
  ];

  it("keeps the board's order of circles, and of quests inside a bed", () => {
    const beds = meadowBeds(board, {});
    expect(beds.map((b) => b.circle)).toEqual(["Hearth", "Land & Water", null]);
    expect(beds[0].plants.map((p) => p.quest.id)).toEqual(["a", "c"]);
    expect(beds[1].plants.map((p) => p.quest.id)).toEqual(["b", "e"]);
  });

  it("quests with no circle share one bed at the end", () => {
    const beds = meadowBeds(board, {});
    expect(beds[beds.length - 1]).toMatchObject({ circle: null, plants: [{ quest: { id: "d" } }] });
  });

  it("each plant takes its state from its own signs", () => {
    const beds = meadowBeds(board, { a: { active: 1, done: 0, moon: 0 }, e: { active: 0, done: 1, moon: 1 } });
    const states = Object.fromEntries(meadowOrder(beds).map((p) => [p.quest.id, p.state]));
    expect(states).toEqual({ a: "bud", c: "seed", b: "seed", e: "flower", d: "seed" });
  });

  it("never reorders a bed by its plants: a flower does not climb over a seed", () => {
    const beds = meadowBeds(
      [quest({ id: "s", circle: "X" }), quest({ id: "f", circle: "X" })],
      { f: { active: 0, done: 9, moon: 4 } },
    );
    expect(beds[0].plants.map((p) => p.quest.id)).toEqual(["s", "f"]);
  });

  it("an empty board has no beds", () => {
    expect(meadowBeds([], null)).toEqual([]);
  });
});

describe("stepThrough: the arrow keys walk the meadow", () => {
  const order = [{ quest: { id: "a" } }, { quest: { id: "b" } }, { quest: { id: "c" } }];

  it("right and down step forward, left and up step back, wrapping at the ends", () => {
    expect(stepThrough(order, "a", "ArrowRight")).toBe("b");
    expect(stepThrough(order, "b", "ArrowDown")).toBe("c");
    expect(stepThrough(order, "c", "ArrowRight")).toBe("a");
    expect(stepThrough(order, "a", "ArrowLeft")).toBe("c");
    expect(stepThrough(order, "b", "ArrowUp")).toBe("a");
  });

  it("starts at the first plant when nothing is chosen, and leaves other keys alone", () => {
    expect(stepThrough(order, null, "ArrowRight")).toBe("a");
    expect(stepThrough(order, "a", "Tab")).toBeNull();
    expect(stepThrough([], "a", "ArrowRight")).toBeNull();
  });
});

describe("bedLayout: the golden-angle bed", () => {
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  it.each([1, 2, 3, 5, 8, 13, 21])("keeps %i plants a full thumb apart and inside the soil", (n) => {
    const gap = 44;
    const { width, height, spots } = bedLayout(n, gap);
    expect(spots).toHaveLength(n);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        expect(dist(spots[i], spots[j])).toBeGreaterThanOrEqual(gap - 0.5);
      }
      // Half a thumb of soil all round every plant.
      expect(spots[i].x).toBeGreaterThanOrEqual(gap / 2);
      expect(spots[i].y).toBeGreaterThanOrEqual(gap / 2);
      expect(spots[i].x).toBeLessThanOrEqual(width - gap / 2);
      expect(spots[i].y).toBeLessThanOrEqual(height - gap / 2);
    }
  });

  it("the first plant stands at the heart of a one-plant bed", () => {
    const { width, height, spots } = bedLayout(1);
    expect(spots[0]).toEqual({ x: width / 2, y: height / 2 });
  });

  it("is the same drawing every time", () => {
    expect(bedLayout(7)).toEqual(bedLayout(7));
  });

  it("a bed grows with what grows in it", () => {
    expect(bedLayout(8).width).toBeGreaterThan(bedLayout(2).width);
  });
});

describe("leadQuestFor: a quest that fits your roots leads", () => {
  const board = [
    quest({ id: "gentle", difficulty: "Beginner", order: 1, archetypes: ["weaver"] }),
    quest({ id: "mine", difficulty: "Advanced", order: 2, archetypes: ["healer", "builder"] }),
    quest({ id: "untagged", difficulty: "Beginner", order: 0 }),
    quest({ id: "gated-mine", difficulty: "Beginner", order: 0, archetypes: ["healer"], minStage: "member" }),
    quest({ id: "example-mine", difficulty: "Beginner", order: 0, archetypes: ["healer"], isExample: true }),
  ];

  it("a tagged quest carrying one of my roots leads, over a gentler one that does not", () => {
    const lead = leadQuestFor(board, [], ["healer"]);
    expect(lead).toMatchObject({ quest: { id: "mine" }, reason: "begin", fits: true });
  });

  it("an untagged quest never claims to fit", () => {
    expect(fitsRoots(quest({ id: "u" }), ["healer"])).toBe(false);
    expect(fitsRoots(quest({ id: "t", archetypes: ["healer"] }), [])).toBe(false);
  });

  it("with no roots picked, the gentlest open quest leads, as before", () => {
    expect(leadQuestFor(board, [])).toMatchObject({ quest: { id: "untagged" }, fits: false });
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

describe("claimPlant: a member's own work on the profile", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");
  const moonStart = cycleBoundsFor(now).startsAt;
  const after = new Date(moonStart.getTime() + 3_600_000).toISOString();
  const before = new Date(moonStart.getTime() - 3_600_000).toISOString();

  it("work in hand is a bud", () => {
    expect(claimPlant({ status: "claimed" }, now)).toBe("bud");
    expect(claimPlant({ status: "submitted" }, now)).toBe("bud");
  });

  it("consented since this moon's new moon is a flower", () => {
    expect(claimPlant({ status: "consented", resolvedAt: after }, now)).toBe("flower");
  });

  it("consented in an earlier moon, declined, or with no date draws no plant", () => {
    expect(claimPlant({ status: "consented", resolvedAt: before }, now)).toBeNull();
    expect(claimPlant({ status: "consented", resolvedAt: null }, now)).toBeNull();
    expect(claimPlant({ status: "consented", resolvedAt: "not a date" }, now)).toBeNull();
    expect(claimPlant({ status: "declined", resolvedAt: after }, now)).toBeNull();
  });
});
