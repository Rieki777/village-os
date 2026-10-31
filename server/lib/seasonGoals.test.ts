/**
 * A season goal keeps its name (0298): every goal carries an id, so a weekly
 * priority or a win that serves it stays linked when the goal is reworded.
 *
 * A goal written before ids existed is given one DERIVED from its words, the
 * same function the migration's backfill computes in SQL for the links that
 * named it, so a link and its goal agree before anybody saves the season again.
 */
import { describe, expect, it } from "vitest";
import { assignGoalIds, goalIdFor } from "./seasonGoals";
import { normalizeSeasonConfig } from "./seasonCalendar";

describe("a goal's id", () => {
  it("is derived from its words, the same every time", () => {
    expect(goalIdFor("Water the land")).toBe(goalIdFor("Water the land"));
    expect(goalIdFor("Water the land")).toMatch(/^g[0-9a-f]{11}$/);
    expect(goalIdFor("Water the land")).not.toBe(goalIdFor("Welcome new members"));
    // Trimmed, so a stray space does not make a different goal.
    expect(goalIdFor("  Water the land ")).toBe(goalIdFor("Water the land"));
  });

  it("keeps an id the goal already has, through a rewording", () => {
    const [g] = assignGoalIds([{ id: goalIdFor("Water the land"), text: "Irrigate the land", done: false }]);
    expect(g).toEqual({ id: goalIdFor("Water the land"), text: "Irrigate the land", done: false });
  });

  it("gives a goal without one the id its words derive", () => {
    expect(assignGoalIds([{ text: "Rest and repair", done: true }])).toEqual([{ id: goalIdFor("Rest and repair"), text: "Rest and repair", done: true }]);
  });

  it("keeps two goals with the same words apart", () => {
    const [a, b] = assignGoalIds([
      { text: "Rest", done: false },
      { text: "Rest", done: false },
    ]);
    expect(a.id).toBe(goalIdFor("Rest"));
    expect(b.id).toBe(`${goalIdFor("Rest")}-2`);
  });

  it("lets a stored id claim its place before a new goal derives the same one", () => {
    // "Water the land" was renamed (keeping its id), then a NEW goal was added with the old words.
    const [renamed, added] = assignGoalIds([
      { text: "Water the land", done: false },
      { id: goalIdFor("Water the land"), text: "Irrigate the land", done: false },
    ]).sort((x, y) => x.text.localeCompare(y.text));
    expect(renamed).toEqual({ id: goalIdFor("Water the land"), text: "Irrigate the land", done: false });
    expect(added.id).toBe(`${goalIdFor("Water the land")}-2`);
  });

  it("refuses an id that is not one, and derives instead", () => {
    expect(assignGoalIds([{ id: "<script>", text: "Rest", done: false }])[0].id).toBe(goalIdFor("Rest"));
    expect(assignGoalIds([{ id: 42, text: "Rest", done: false }])[0].id).toBe(goalIdFor("Rest"));
  });
});

describe("the season document carries goal ids", () => {
  it("on read, for a document saved before ids existed", () => {
    const cfg = normalizeSeasonConfig({
      seasons: [{ id: "s1", name: "Autumn", startsOn: "2026-09-22", endsOn: "", goals: [{ text: "Water the land", done: false }] }],
      cadence: "custom",
      timezone: "UTC",
    });
    expect(cfg.seasons[0].goals).toEqual([{ id: goalIdFor("Water the land"), text: "Water the land", done: false }]);
  });

  it("and keeps an id the editor sent back with new words", () => {
    const cfg = normalizeSeasonConfig({
      seasons: [{ id: "s1", name: "Autumn", startsOn: "2026-09-22", endsOn: "", goals: [{ id: goalIdFor("Water the land"), text: "Irrigate", done: true }] }],
      cadence: "custom",
      timezone: "UTC",
    });
    expect(cfg.seasons[0].goals[0]).toEqual({ id: goalIdFor("Water the land"), text: "Irrigate", done: true });
  });
});
