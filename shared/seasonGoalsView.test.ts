import { describe, expect, it } from "vitest";
import { seasonView } from "./seasonGoalsView";

const season = { name: "Season of Roots", startsOn: "2026-06-21", endsOn: "2026-06-30", goals: [{ text: "Seed bank open", done: true }, { text: "Water running" }] };

describe("seasonView: how far into the season today is", () => {
  it("counts today as a day of the season, the first day as 1 and the last day included", () => {
    expect(seasonView(season, new Date("2026-06-21T12:00:00Z"))).toMatchObject({ day: 1, of: 10 });
    expect(seasonView(season, new Date("2026-06-25T23:59:00Z"))).toMatchObject({ day: 5, of: 10 });
    expect(seasonView(season, new Date("2026-06-30T00:00:00Z"))).toMatchObject({ day: 10, of: 10 });
  });

  it("says nothing before the season begins or after it ends", () => {
    expect(seasonView(season, new Date("2026-07-01T00:00:00Z"))).toMatchObject({ day: null, of: 10 });
    expect(seasonView(season, new Date("2026-06-20T00:00:00Z"))).toMatchObject({ day: null, of: 10 });
  });

  it("has no count when either end is missing", () => {
    expect(seasonView({ ...season, endsOn: "" })).toMatchObject({ day: null, of: null });
    expect(seasonView({ name: "S", goals: [{ text: "Real" }] })).toMatchObject({ day: null, of: null });
  });
});
