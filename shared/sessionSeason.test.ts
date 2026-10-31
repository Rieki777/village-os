/**
 * The season view's pure pieces (shared/sessionTemplates.ts, 0292): which
 * season priority a link may name, the week a date falls in, and telling a
 * tension that comes back from a new one.
 */
import { describe, expect, it } from "vitest";
import { cleanServesGoal, groupTensions, prioritiesTally, sameTension, tensionWords, weekOf } from "./sessionTemplates";

describe("serving the season", () => {
  const goals = ["Water the land", "Welcome new members"];
  it("takes one of the season's goals as written, or none", () => {
    expect(cleanServesGoal("Water the land", goals)).toEqual({ ok: true, value: "Water the land" });
    expect(cleanServesGoal("  Welcome new members ", goals)).toEqual({ ok: true, value: "Welcome new members" });
    expect(cleanServesGoal(null, goals)).toEqual({ ok: true, value: null });
    expect(cleanServesGoal("", goals)).toEqual({ ok: true, value: null });
  });
  it("refuses words the season does not hold", () => {
    expect(cleanServesGoal("water the land", goals).ok).toBe(false);
    expect(cleanServesGoal("Something else", goals).ok).toBe(false);
    expect(cleanServesGoal(3, goals).ok).toBe(false);
    expect(cleanServesGoal("Water the land", []).ok).toBe(false);
  });
});

describe("the week a date belongs to", () => {
  it("is the Monday it falls in", () => {
    expect(weekOf("2026-10-30T15:00:00Z")).toBe("2026-10-26"); // a Friday
    expect(weekOf("2026-10-26T00:00:00Z")).toBe("2026-10-26"); // the Monday itself
    expect(weekOf("2026-11-01T23:00:00Z")).toBe("2026-10-26"); // the Sunday after
    expect(weekOf("nonsense")).toBe("");
  });
});

describe("tensions that keep coming up", () => {
  it("knows the same tension in other words", () => {
    const a = tensionWords("Nobody knows who waters the nursery on weekends");
    const b = tensionWords("Weekend watering of the nursery keeps falling through");
    expect(sameTension(a, b)).toBe(true);
  });
  it("keeps different tensions apart", () => {
    const a = tensionWords("Nobody knows who waters the nursery on weekends");
    const b = tensionWords("The kitchen rota feels unfair to the night shift");
    expect(sameTension(a, b)).toBe(false);
  });
  it("groups by the tension, counts the Heart shares, and orders by when it last came up, never by size", () => {
    const groups = groupTensions([
      { text: "Nobody knows who waters the nursery on weekends", sessionId: 1, at: "2026-10-01T10:00:00Z" },
      { text: "The kitchen rota feels unfair to the night shift", sessionId: 1, at: "2026-10-01T10:05:00Z" },
      { text: "Weekend watering of the nursery keeps falling through", sessionId: 2, at: "2026-10-08T10:00:00Z" },
      { text: "Still unclear who waters the nursery at weekends", sessionId: 3, at: "2026-10-15T10:00:00Z" },
      { text: "Our meetings run long", sessionId: 3, at: "2026-10-20T10:00:00Z" },
    ]);
    expect(groups.map((g) => [g.sessions, g.text])).toEqual([
      [1, "Our meetings run long"],
      [3, "Still unclear who waters the nursery at weekends"],
      [1, "The kitchen rota feels unfair to the night shift"],
    ]);
    expect(groups[1].firstAt).toBe("2026-10-01T10:00:00Z");
    expect(groups[1].sessionIds).toEqual([1, 2, 3]);
  });
});

describe("a goal's priorities, counted", () => {
  it("counts set against each mark, unmarked as open", () => {
    const item = (outcome: any) => ({ text: "x", outcome, sessionId: 1, sessionTitle: "Monday", at: "2026-10-01T00:00:00Z" });
    expect(prioritiesTally([item("done"), item("done"), item("partly"), item("carried"), item(null)])).toEqual({ set: 5, done: 2, partly: 1, carried: 1, open: 1 });
  });
});
