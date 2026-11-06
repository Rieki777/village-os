/**
 * The season view's pure pieces (shared/sessionTemplates.ts, 0292): which
 * season priority a link may name, the week a date falls in, and telling a
 * tension that comes back from a new one.
 */
import { describe, expect, it } from "vitest";
import { cleanServesGoal, groupTensions, prioritiesTally, resolveGoal, sameTension, stem, tensionWords, weekOf } from "./sessionTemplates";

describe("serving the season", () => {
  const goals = [
    { id: "g000000000a1", text: "Water the land" },
    { id: "g000000000b2", text: "Welcome new members" },
  ];
  it("takes one of the season's goals by id, or none", () => {
    expect(cleanServesGoal({ servesGoalId: "g000000000a1" }, goals)).toEqual({ ok: true, value: goals[0] });
    expect(cleanServesGoal({ servesGoalId: null }, goals)).toEqual({ ok: true, value: null });
    expect(cleanServesGoal({ servesGoalId: "" }, goals)).toEqual({ ok: true, value: null });
    expect(cleanServesGoal({}, goals)).toEqual({ ok: true, value: null });
  });
  it("still takes the goal's words from a client before ids, finding the first goal saying them", () => {
    expect(cleanServesGoal({ servesGoal: "  Welcome new members " }, goals)).toEqual({ ok: true, value: goals[1] });
    expect(cleanServesGoal({ servesGoal: "Rest" }, [...goals, { id: "g1", text: "Rest" }, { id: "g1-2", text: "Rest" }])).toEqual({ ok: true, value: { id: "g1", text: "Rest" } });
  });
  it("refuses anything the season does not hold", () => {
    expect(cleanServesGoal({ servesGoalId: "g999" }, goals).ok).toBe(false);
    expect(cleanServesGoal({ servesGoalId: 3 }, goals).ok).toBe(false);
    expect(cleanServesGoal({ servesGoal: "water the land" }, goals).ok).toBe(false);
    expect(cleanServesGoal({ servesGoalId: "g000000000a1" }, []).ok).toBe(false);
  });
  it("finds a stored link's goal by id, then by words, and none when it is gone", () => {
    expect(resolveGoal(goals, "g000000000a1", "old words")).toEqual(goals[0]);
    expect(resolveGoal(goals, null, "Welcome new members")).toEqual(goals[1]);
    expect(resolveGoal(goals, "g-gone", "Water the land")).toBeNull();
    expect(resolveGoal(goals, null, null)).toBeNull();
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

describe("the same tension in other forms of its words (0298)", () => {
  it("stems plurals, -ing and -ed, and a doubled last letter, and leaves short words alone", () => {
    expect(["waters", "watering", "watered"].map(stem)).toEqual(["water", "water", "water"]);
    expect(["seedlings", "seedling"].map(stem)).toEqual(["seedl", "seedl"]);
    expect(stem("slipping")).toBe("slip");
    expect(["news", "bed", "glass", "red"].map(stem)).toEqual(["new", "bed", "glass", "red"]);
  });
  it("groups a tension said again in other forms of its words", () => {
    const [g] = groupTensions([
      { shareId: 1, text: "Nobody waters the seedlings", sessionId: 1, at: "2026-10-01T10:00:00Z" },
      { shareId: 2, text: "Seedling watering keeps slipping", sessionId: 2, at: "2026-10-08T10:00:00Z" },
    ]);
    expect(g.sessions).toBe(2);
  });
  it("never groups two tensions that share one word", () => {
    const groups = groupTensions([
      { shareId: 1, text: "The kitchen rota feels unfair", sessionId: 1, at: "2026-10-01T10:00:00Z" },
      { shareId: 2, text: "The kitchen garden needs compost", sessionId: 2, at: "2026-10-08T10:00:00Z" },
    ]);
    expect(groups).toHaveLength(2);
  });
  it("joins what people said is the same, and keeps apart what they said stands alone", () => {
    const groups = groupTensions([
      { shareId: 1, text: "Meetings run too long", sessionId: 1, at: "2026-10-01T10:00:00Z" },
      { shareId: 2, text: "Our meeting ran over time again", sessionId: 2, at: "2026-10-08T10:00:00Z", sameAsId: 1 },
      { shareId: 3, text: "Nobody waters the seedlings", sessionId: 1, at: "2026-10-01T10:05:00Z" },
      { shareId: 4, text: "Seedling watering keeps slipping", sessionId: 2, at: "2026-10-08T10:05:00Z", standsAlone: true },
    ]);
    const of = (id: number) => groups.find((g) => g.members?.some((m) => m.shareId === id));
    expect(of(1)).toBe(of(2));
    expect(of(1)?.sessions).toBe(2);
    expect(of(3)).not.toBe(of(4));
    expect(of(4)?.members?.[0].standsAlone).toBe(true);
  });
  it('lets a "same as" reach a tension that stands alone', () => {
    const groups = groupTensions([
      { shareId: 1, text: "A", sessionId: 1, at: "2026-10-01T10:00:00Z", standsAlone: true },
      { shareId: 2, text: "B", sessionId: 2, at: "2026-10-08T10:00:00Z", sameAsId: 1 },
    ]);
    expect(groups).toHaveLength(1);
  });
});

describe("a goal's priorities, counted", () => {
  it("counts set against each mark, unmarked as open", () => {
    const item = (outcome: any) => ({ text: "x", outcome, sessionId: 1, sessionTitle: "Monday", at: "2026-10-01T00:00:00Z" });
    expect(prioritiesTally([item("done"), item("done"), item("partly"), item("carried"), item(null)])).toEqual({ set: 5, done: 2, partly: 1, carried: 1, open: 1 });
  });
});
