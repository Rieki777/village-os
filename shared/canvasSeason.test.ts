/**
 * THE SEASON FILE, held to its format (2026-09-26).
 *
 * One validator for the route and the form, so every refusal here is a
 * sentence a person loading a file would read. The good file passes whole,
 * each kind of bad file is refused by name, and the Season Two template the
 * platform ships in docs/seasons/ loads through the same door a village's own
 * file would.
 *
 * And the rule the whole feature rests on: a season ORDERS the canvas and
 * never gates it. `orderBlocks` returns all twelve blocks whatever it is
 * handed.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CANVAS_BLOCK_IDS, CANVAS_BLOCKS, CANVAS_FOUNDATIONS } from "./governanceCanvas";
import {
  SEASON_LIMITS,
  isSeasonDate,
  orderBlocks,
  parseCanvasSeason,
  seasonDateLabel,
  seasonFocus,
  seasonMoment,
  todayIn,
  type CanvasSeason,
} from "./canvasSeason";

const week = (over: Record<string, unknown> = {}) => ({
  number: 1,
  date: "2026-10-03",
  title: "Incubator Overview",
  blocks: ["purpose"],
  foundations: ["personal-leadership"],
  tools: ["Canvas baseline"],
  showcaseAsk: "The purpose draft, in words only.",
  actions: ["Take the first reading of all twelve blocks."],
  ...over,
});

const file = (over: Record<string, unknown> = {}) => ({
  id: "a-season",
  name: "A season",
  timezone: "America/Los_Angeles",
  weeks: [
    week(),
    week({ number: 2, date: "2026-10-10", title: "Roles", blocks: ["team", "roles", "meetings"], foundations: ["culture"] }),
    week({ number: 3, date: "2026-10-17", title: "Power", blocks: ["power", "conflict"], foundations: [] }),
  ],
  moons: [{ date: "2026-10-10", blocks: [], note: "The first canvas moon." }],
  ...over,
});

/** The refusals, or a failure that says the file was wrongly accepted. */
const refusals = (input: unknown): string[] => {
  const r = parseCanvasSeason(input);
  if (r.ok) throw new Error(`expected a refusal, and it was accepted: ${JSON.stringify(input).slice(0, 200)}`);
  return r.errors;
};

describe("a good season file", () => {
  it("passes whole, trimmed, with nothing ignored", () => {
    const r = parseCanvasSeason(file({ name: "  A season  ", sessionTime: "11:00", description: "Thirteen Saturdays." }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ignored).toEqual([]);
    expect(r.season).toMatchObject({
      id: "a-season",
      name: "A season",
      timezone: "America/Los_Angeles",
      sessionTime: "11:00",
      description: "Thirteen Saturdays.",
    });
    expect(r.season.weeks.map((w) => [w.number, w.date, w.blocks])).toEqual([
      [1, "2026-10-03", ["purpose"]],
      [2, "2026-10-10", ["team", "roles", "meetings"]],
      [3, "2026-10-17", ["power", "conflict"]],
    ]);
    expect(r.season.moons).toEqual([{ date: "2026-10-10", blocks: [], note: "The first canvas moon." }]);
  });

  it("fills a week's optional lists with empty ones, and leaves out an absent time and description", () => {
    const r = parseCanvasSeason(file({ weeks: [{ number: 1, date: "2026-10-03", title: "Only the essentials" }], moons: undefined }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.season.weeks[0]).toEqual({
      number: 1,
      date: "2026-10-03",
      title: "Only the essentials",
      blocks: [],
      foundations: [],
      tools: [],
      showcaseAsk: "",
      actions: [],
    });
    expect(r.season.moons).toEqual([]);
    expect("sessionTime" in r.season).toBe(false);
    expect("description" in r.season).toBe(false);
  });

  it("keeps a block named twice once, in the order it was first named", () => {
    const r = parseCanvasSeason(file({ weeks: [week({ blocks: ["power", "purpose", "power"] })] }));
    expect(r.ok && r.season.weeks[0].blocks).toEqual(["power", "purpose"]);
  });

  it("leaves out a field the format does not know, and says which", () => {
    const r = parseCanvasSeason({ ...file(), colour: "green", weeks: [{ ...week(), mood: "bright" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ignored).toEqual(["colour", "weeks[0].mood"]);
    expect(JSON.stringify(r.season)).not.toContain("green");
    expect(JSON.stringify(r.season)).not.toContain("bright");
  });

  it("takes exactly sixty weeks", () => {
    const weeks = Array.from({ length: SEASON_LIMITS.weeks }, (_, i) =>
      week({ number: i + 1, date: new Date(Date.UTC(2026, 9, 3 + 7 * i)).toISOString().slice(0, 10) }),
    );
    expect(parseCanvasSeason(file({ weeks })).ok).toBe(true);
  });
});

describe("what a season file is refused for", () => {
  it("anything that is not one object", () => {
    for (const bad of [null, "a season", 42, [file()]]) {
      expect(refusals(bad)[0]).toMatch(/one JSON object/);
    }
  });

  it("a block the canvas does not have, named with the twelve it could be", () => {
    const errors = refusals(file({ weeks: [week({ blocks: ["purpose", "vibes"] })] }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Week 1's blocks: "vibes" is not one of the twelve canvas blocks/);
    expect(errors[0]).toContain(CANVAS_BLOCK_IDS.join(", "));
    expect(refusals(file({ moons: [{ date: "2026-10-10", blocks: ["nope"] }] }))[0]).toMatch(/^Moon entry 1's blocks: "nope"/);
  });

  it("a foundation the canvas does not have", () => {
    expect(refusals(file({ weeks: [week({ foundations: ["F1"] })] }))[0]).toMatch(/"F1" is not a canvas foundation/);
  });

  it("a date that is not a real date written YYYY-MM-DD", () => {
    for (const date of ["2026-02-30", "03/10/2026", "2026-10-3", "", 20261003, null, "1999-12-31"]) {
      expect(refusals(file({ weeks: [week({ date })] }))[0], String(date)).toMatch(/real date written YYYY-MM-DD/);
    }
    expect(refusals(file({ moons: [{ date: "next Tuesday" }] }))[0]).toMatch(/Moon entry 1's date must be a real date/);
  });

  it("weeks that run backwards, or share a number or a date", () => {
    const backwards = file({ weeks: [week({ number: 1, date: "2026-10-10" }), week({ number: 2, date: "2026-10-03" })] });
    expect(refusals(backwards)[0]).toMatch(/Week 2's date \(2026-10-03\) must be after week 1's \(2026-10-10\)/);
    const sameNumber = file({ weeks: [week({ number: 1 }), week({ number: 1, date: "2026-10-10" })] });
    expect(refusals(sameNumber)[0]).toMatch(/its number must be higher/);
    const sameDate = file({ weeks: [week({ number: 1 }), week({ number: 2 })] });
    expect(refusals(sameDate)[0]).toMatch(/must be after/);
  });

  it("more than sixty weeks, and a season with none", () => {
    const weeks = Array.from({ length: SEASON_LIMITS.weeks + 1 }, (_, i) =>
      week({ number: i + 1, date: new Date(Date.UTC(2026, 9, 3 + 7 * i)).toISOString().slice(0, 10) }),
    );
    expect(refusals(file({ weeks }))).toEqual([`A season holds at most ${SEASON_LIMITS.weeks} weeks.`]);
    expect(refusals(file({ weeks: [] }))[0]).toMatch(/at least one week/);
    expect(refusals(file({ weeks: undefined }))[0]).toMatch(/at least one week/);
  });

  it("text past its limit, each named with its limit", () => {
    expect(refusals(file({ name: "n".repeat(SEASON_LIMITS.name + 1) }))[0]).toBe(
      `The season's name is longer than ${SEASON_LIMITS.name} characters.`,
    );
    expect(refusals(file({ weeks: [week({ title: "t".repeat(SEASON_LIMITS.title + 1) })] }))[0]).toBe(
      `Week 1's title is longer than ${SEASON_LIMITS.title} characters.`,
    );
    expect(refusals(file({ weeks: [week({ showcaseAsk: "s".repeat(SEASON_LIMITS.showcaseAsk + 1) })] }))[0]).toMatch(
      /showcaseAsk is longer than 400 characters/,
    );
    expect(refusals(file({ weeks: [week({ actions: ["a".repeat(SEASON_LIMITS.action + 1)] })] }))[0]).toMatch(
      /Week 1's actions, entry 1, is longer than 400 characters/,
    );
    expect(refusals(file({ weeks: [week({ tools: Array(SEASON_LIMITS.tools + 1).fill("a tool") })] }))[0]).toMatch(
      /tools holds more than 8 entries/,
    );
    expect(refusals(file({ moons: [{ date: "2026-10-10", note: "m".repeat(SEASON_LIMITS.note + 1) }] }))[0]).toMatch(
      /Moon entry 1's note is longer than 400 characters/,
    );
  });

  it("a whole file past its size, before anything else is read", () => {
    const huge = file({ padding: "x".repeat(SEASON_LIMITS.fileCharacters) });
    expect(refusals(huge)).toEqual([expect.stringMatching(/kept under 128,000 characters/)]);
  });

  it("a missing or malformed id, name, timezone or time", () => {
    expect(refusals(file({ id: "Season Two!" }))[0]).toMatch(/id must be lowercase letters, digits and hyphens/);
    expect(refusals(file({ id: undefined }))[0]).toMatch(/id must be/);
    expect(refusals(file({ name: "   " }))[0]).toBe("The season's name is empty.");
    expect(refusals(file({ timezone: "Mars/Olympus_Mons" }))[0]).toMatch(/timezone must be a place name/);
    expect(refusals(file({ sessionTime: "11am" }))[0]).toMatch(/HH:MM/);
  });

  it("a week with no title or no number", () => {
    expect(refusals(file({ weeks: [week({ title: "" })] }))[0]).toBe("Week 1's title is empty.");
    expect(refusals(file({ weeks: [week({ number: 1.5 })] }))[0]).toMatch(/whole week number from 0 to 99/);
  });

  it("names every problem it finds, not only the first", () => {
    const errors = refusals(file({ name: "", timezone: "nowhere", weeks: [week({ blocks: ["x"], date: "soon" })] }));
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe("where a date falls in a season", () => {
  const season = parseCanvasSeason(file());
  if (!season.ok) throw new Error("the fixture must be a good season");
  const s = season.season;
  /** Noon in Los Angeles on a date, as an instant. */
  const la = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00-07:00`);

  it("is before the first week, pointing at it", () => {
    const m = seasonMoment(s, la("2026-10-02"));
    expect(m.phase).toBe("before");
    expect(m.next?.number).toBe(1);
    expect(seasonFocus(s, la("2026-10-02"))).toEqual(["purpose"]);
  });

  it("is the last week whose date has come, until the next one's", () => {
    expect(seasonMoment(s, la("2026-10-03")).week?.number).toBe(1);
    expect(seasonMoment(s, la("2026-10-09")).week?.number).toBe(1);
    const m = seasonMoment(s, la("2026-10-10"));
    expect(m.week?.number).toBe(2);
    expect(m.next?.number).toBe(3);
    expect(seasonFocus(s, la("2026-10-12"))).toEqual(["team", "roles", "meetings"]);
  });

  it("keeps the last week for seven days, then the season is over and nothing is in focus", () => {
    expect(seasonMoment(s, la("2026-10-23")).week?.number).toBe(3);
    expect(seasonMoment(s, la("2026-10-24")).phase).toBe("after");
    expect(seasonFocus(s, la("2026-10-24"))).toEqual([]);
    expect(seasonFocus(null)).toEqual([]);
  });

  it("reads the date in the season's timezone, not the reader's", () => {
    // 02:00 UTC on 10 October is still the evening of 9 October in Los Angeles.
    const instant = new Date("2026-10-10T02:00:00Z");
    expect(todayIn("America/Los_Angeles", instant)).toBe("2026-10-09");
    expect(todayIn("Europe/Amsterdam", instant)).toBe("2026-10-10");
    expect(seasonMoment(s, instant).week?.number).toBe(1);
  });
});

describe("the order it puts the blocks in: first, never only", () => {
  it("puts the focus first in its own order, then every other block in canvas order", () => {
    expect(orderBlocks(["power", "conflict"]).map((b) => b.id)).toEqual([
      "power",
      "conflict",
      ...CANVAS_BLOCK_IDS.filter((id) => id !== "power" && id !== "conflict"),
    ]);
  });

  it("returns all twelve blocks, each once, whatever it is handed", () => {
    const inputs: unknown[][] = [[], [...CANVAS_BLOCK_IDS], ["legal", "legal", "vibes", 7, null], [...CANVAS_BLOCK_IDS].reverse()];
    for (const focus of inputs) {
      const ids = orderBlocks(focus).map((b) => b.id);
      expect(ids, JSON.stringify(focus)).toHaveLength(CANVAS_BLOCK_IDS.length);
      expect([...ids].sort(), JSON.stringify(focus)).toEqual([...CANVAS_BLOCK_IDS].sort());
    }
    expect(orderBlocks().map((b) => b.id)).toEqual([...CANVAS_BLOCK_IDS]);
    expect(orderBlocks(["impact"])[0]).toBe(CANVAS_BLOCKS.impact);
  });
});

describe("dates, as the week map shows them", () => {
  it("reads the same everywhere", () => {
    expect(seasonDateLabel("2026-09-26")).toBe("Sat 26 Sep");
    expect(seasonDateLabel("2026-12-19", true)).toBe("Sat 19 Dec 2026");
    expect(isSeasonDate("2028-02-29")).toBe(true);
    expect(isSeasonDate("2026-02-29")).toBe(false);
  });
});

describe("the Season Two template the platform ships", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "seasons", "season-two-2026.json"), "utf8"));
  const parsed = parseCanvasSeason(raw);

  it("loads through the validator whole, with nothing left out", () => {
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    expect(parsed.ok && parsed.ignored).toEqual([]);
  });

  const season = (parsed.ok ? parsed.season : null) as CanvasSeason;

  it("is thirteen Saturdays at 11:00 in Los Angeles, from Selection Day to Crowd Pooling", () => {
    expect(season.timezone).toBe("America/Los_Angeles");
    expect(season.sessionTime).toBe("11:00");
    expect(season.weeks.map((w) => [w.number, w.date, w.title])).toEqual([
      [1, "2026-09-26", "Selection Day"],
      [2, "2026-10-03", "Incubator Overview"],
      [3, "2026-10-10", "Game and Organisation Co-Creation 1"],
      [4, "2026-10-17", "Game and Organisation Co-Creation 2"],
      [5, "2026-10-24", "Game Guides and Economic Systems"],
      [6, "2026-10-31", "Growing Your Village"],
      [7, "2026-11-07", "Ecosystem and the Fund"],
      [8, "2026-11-14", "Tokenomics 1"],
      [9, "2026-11-21", "Tokenomics 2"],
      [10, "2026-11-28", "Legal Structures 1"],
      [11, "2026-12-05", "Legal Structures 2"],
      [12, "2026-12-12", "Coordination and Minimum Viable Economies"],
      [13, "2026-12-19", "Crowd Pooling and Resourcing"],
    ]);
    for (const w of season.weeks) expect(seasonDateLabel(w.date), w.title).toMatch(/^Sat /);
  });

  it("has the three canvas moons, with Before you raise on 8 December", () => {
    expect(season.moons.map((m) => m.date)).toEqual(["2026-10-10", "2026-11-09", "2026-12-08"]);
    expect(season.moons[2].blocks).toEqual(["power", "resourcing", "legal", "impact"]);
    expect(season.moons[2].note).toMatch(/^Before you raise/);
  });

  it("takes the baseline of all twelve blocks in week 2", () => {
    expect([...season.weeks[1].blocks].sort()).toEqual([...CANVAS_BLOCK_IDS].sort());
  });

  it("gives every block and every foundation a week", () => {
    for (const id of CANVAS_BLOCK_IDS) {
      expect(season.weeks.some((w) => w.number !== 2 && w.blocks.includes(id)), id).toBe(true);
    }
    for (const f of CANVAS_FOUNDATIONS) expect(season.weeks.some((w) => w.foundations.includes(f)), f).toBe(true);
  });

  it("agrees with the weeks the canvas registry names for each block", () => {
    // Two copies of one fact: shared/governanceCanvas.ts says in which Season
    // Two weeks each block comes up, and this file says it too. Week 2 reads
    // every block for the baseline, so it is left out of the comparison.
    for (const id of CANVAS_BLOCK_IDS) {
      const inFile = season.weeks.filter((w) => w.number !== 2 && w.blocks.includes(id)).map((w) => w.number);
      const inRegistry = CANVAS_BLOCKS[id].seasonWeeks.filter((n) => n !== 2);
      expect(inFile, id).toEqual([...inRegistry]);
    }
  });

  it("puts this week's blocks first on the canvas on a session day", () => {
    const w4 = new Date("2026-10-17T18:00:00Z"); // 11:00 in Los Angeles
    expect(orderBlocks(seasonFocus(season, w4)).slice(0, 2).map((b) => b.id)).toEqual(["power", "conflict"]);
  });
});
