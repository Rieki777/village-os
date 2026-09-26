/**
 * The canvas view puts one kind of number on the page, and it is a block's
 * level on the radar (2026-09-24).
 *
 * R55, the founder's ruling: a village's governance is a journey to
 * celebrate and never a scorecard to fail. Rye made ONE exception on
 * 2026-09-24: a canvas-style 1 to 5 radar, for the canvas baseline only. So
 * this file does two jobs at once, and both halves matter:
 *
 *   - it FORBIDS every other shape a number can take here: a percent sign,
 *     "so many of twelve", a progress bar, and anything averaged, summed or
 *     combined across blocks;
 *   - it PERMITS the radar by name, and holds the exception to its scope:
 *     the radar renders in the Baseline view and nowhere else.
 *
 * Read as TEXT, like the Powers page's copy test (powersCopy.test.ts), with
 * every comment stripped first, so a header explaining the rule cannot trip
 * the rule and a rule broken inside the code cannot hide behind a comment.
 * The sentence helpers are pure and exercised directly below.
 *
 * THE PRINTABLE WORKBOOK IS SWEPT TOO (2026-09-25). /canvas/workbook puts a
 * row of five levels under every block for a group to circle by hand, and its
 * "Save as Markdown" file does the same with tick boxes. A circled level is a
 * reading of ONE block, the same thing a point on the radar is, so the
 * workbook's sheet, its page and its Markdown builder are held to every rule
 * here: nothing averaged, summed or counted, no "so many of twelve", no
 * percent. And the radar stays out of it.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CANVAS_ORDER, LEVEL_WORDS, type CanvasBlockId, type CanvasLevel } from "@shared/governanceCanvas";
import { newestLevels, radarDescription, readingDate, recordedLine, weeksPhrase, type CanvasReadingView } from "./canvasCopy";

const SRC = path.join(process.cwd(), "client", "src");
const CANVAS_DIR = path.join(SRC, "components", "canvas");

/** Block and line comments out, strings and markup left in. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const CANVAS_FILES = fs
  .readdirSync(CANVAS_DIR)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ name: f, body: stripComments(fs.readFileSync(path.join(CANVAS_DIR, f), "utf8")) }));

const source = (...parts: string[]) => stripComments(fs.readFileSync(path.join(SRC, ...parts), "utf8"));

/** The workbook's page and its Markdown builder, which live outside the canvas directory. */
const WORKBOOK_FILES = [
  { name: "pages/CanvasWorkbook.tsx", body: source("pages", "CanvasWorkbook.tsx") },
  { name: "canvasWorkbook.ts", body: source("lib", "canvasWorkbook.ts") },
];

/** The components plus the copy modules they speak through, and the workbook. */
const SURFACE = [...CANVAS_FILES, { name: "canvasCopy.ts", body: source("lib", "canvasCopy.ts") }, ...WORKBOOK_FILES];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("the files this test reads", () => {
  it("are the whole canvas view, so a new file cannot slip past", () => {
    // Without this the sweep passes by checking nothing at all.
    expect(CANVAS_FILES.map((f) => f.name).sort()).toEqual(
      ["CanvasBaseline.tsx", "CanvasBlockCard.tsx", "CanvasRadar.tsx", "CanvasWorkbookSheet.tsx", "RecordReadingForm.tsx"].sort(),
    );
    for (const f of SURFACE) expect(f.body.length, f.name).toBeGreaterThan(200);
  });
});

describe("no number on the canvas but a block's level", () => {
  it("carries no percent sign", () => {
    for (const f of SURFACE) expect(f.body, f.name).not.toContain("%");
  });

  it("carries no N of M", () => {
    for (const f of SURFACE) {
      expect(f.body, f.name).not.toMatch(/\b\d+\s+of\s+\d+\b/);
      // `{read} of {n}` in markup and `${read} of ${n}` in a template.
      expect(f.body, f.name).not.toMatch(/\}\s+of\s+\$?\{/);
      expect(f.body, f.name).not.toMatch(/\bof (twelve|12)\b/i);
    }
  });

  it("carries no progress display", () => {
    for (const f of SURFACE) {
      expect(f.body, f.name).not.toMatch(/MoonProgress|ProgressBar|<Progress\b|<progress\b|role="progressbar"|mode="progress"/);
    }
  });

  it("combines nothing across blocks: no average, sum, total, count or composite", () => {
    for (const f of SURFACE) {
      expect(f.body, f.name).not.toMatch(/\.reduce\(/);
      expect(f.body, f.name).not.toMatch(/\b(average|averaged|mean|median|sum|summed|total|composite|overall|score|scorecard)\b/i);
      // The quiet version: "7 blocks read" needs no percent sign at all.
      expect(f.body, f.name).not.toMatch(/\.length\s*\}/);
      expect(f.body, f.name).not.toMatch(/\$\{[^}]*\.length[^}]*\}/);
      // Banned outright, as the Powers test bans `powers.filter`: sifting the
      // blocks is how "7 blocks read" gets counted, and a narrower pattern
      // (`.filter(b => b.latest).length`) missed `.filter((b) => b.latest).length`.
      // The canvas walks every block in canvas order and never needs to sift.
      expect(f.body, f.name).not.toMatch(/\.filter\(/);
      expect(f.body, f.name).not.toMatch(/\.size\b/);
    }
  });

  it("never sorts the blocks by how they read", () => {
    // Canvas order is the only order. Sorting by level draws a league table.
    for (const f of SURFACE) expect(f.body, f.name).not.toMatch(/\.sort\(/);
  });
});

describe("the radar, which R55 permits here and only here", () => {
  it("is drawn by the Baseline view, once", () => {
    const radar = CANVAS_FILES.find((f) => f.name === "CanvasRadar.tsx")!;
    expect(radar.body.match(/data-testid="canvas-radar"/g)).toHaveLength(1);
    expect(radar.body).toMatch(/<polygon/);
    const baseline = CANVAS_FILES.find((f) => f.name === "CanvasBaseline.tsx")!;
    expect(baseline.body.match(/<CanvasRadar\b/g)).toHaveLength(1);
  });

  it("is imported by nothing outside the canvas view", () => {
    const importers = walk(SRC)
      .filter((file) => /from\s+["'][^"']*CanvasRadar["']/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"));
    expect(importers).toEqual(["components/canvas/CanvasBaseline.tsx"]);
  });

  it("puts nothing in its centre", () => {
    // A number in the middle of a radar is the average by another name.
    const radar = CANVAS_FILES.find((f) => f.name === "CanvasRadar.tsx")!;
    expect(radar.body).not.toMatch(/<text[^>]*x=\{CX\}/);
  });
});

describe("the credit", () => {
  it("renders with the radar", () => {
    const baseline = CANVAS_FILES.find((f) => f.name === "CanvasBaseline.tsx")!;
    expect(baseline.body).toContain("CANVAS_CREDIT.text");
    expect(baseline.body).toContain("CANVAS_CREDIT.url");
  });

  it("renders on the workbook, and travels in its Markdown file", () => {
    const sheet = CANVAS_FILES.find((f) => f.name === "CanvasWorkbookSheet.tsx")!;
    expect(sheet.body).toContain("CANVAS_CREDIT.text");
    expect(sheet.body).toContain("CANVAS_CREDIT.url");
    const markdown = WORKBOOK_FILES.find((f) => f.name === "canvasWorkbook.ts")!;
    expect(markdown.body).toContain("CANVAS_CREDIT.text");
    expect(markdown.body).toContain("CANVAS_CREDIT.url");
  });
});

describe("the workbook's circled level, which is not a score", () => {
  it("offers the five levels one block at a time, from the canvas's own scale", () => {
    const sheet = CANVAS_FILES.find((f) => f.name === "CanvasWorkbookSheet.tsx")!;
    // One row of levels inside each block, and the levels only ever beside their words.
    expect(sheet.body).toMatch(/function BlockPage[\s\S]*<CircleOne\b/);
    expect(sheet.body).toContain("CANVAS_SCALE_TEXT[level].word");
  });

  it("has no field a level could be typed into, and no radar", () => {
    // No input takes a level: the workbook is filled in by hand, and a field
    // would invite the page to add the answers up.
    for (const f of [...WORKBOOK_FILES, CANVAS_FILES.find((c) => c.name === "CanvasWorkbookSheet.tsx")!]) {
      expect(f.body, f.name).not.toMatch(/type="number"|<select\b|<textarea\b/);
      expect(f.body, f.name).not.toMatch(/CanvasRadar/);
    }
  });
});

const read = (over: Partial<CanvasReadingView> = {}): CanvasReadingView => ({
  id: 1,
  level: 3,
  word: "Emerging",
  sentence: "Two people decide most things.",
  moment: "baseline",
  momentLabel: "Baseline",
  recordedBy: { id: "u1", name: "Wren" },
  recordedAt: "2026-10-03T10:00:00.000Z",
  ...over,
});

describe("the sentences", () => {
  it("says who recorded a baseline reading and when, without naming the baseline", () => {
    expect(recordedLine(read(), "en-GB")).toBe("Recorded by Wren on 3 October 2026");
  });

  it("names any other occasion", () => {
    expect(recordedLine(read({ moment: "canvas-moon", momentLabel: "Canvas moon" }), "en-GB")).toBe(
      "Recorded by Wren on 3 October 2026, canvas moon",
    );
  });

  it("does not print an invalid date", () => {
    expect(readingDate("not a date")).toBe("an unknown date");
  });

  it("walks the radar block by block, and says which blocks have no reading yet", () => {
    const levels = Object.fromEntries(CANVAS_ORDER.map((b) => [b.id, null])) as Record<CanvasBlockId, CanvasLevel | null>;
    levels.purpose = 4;
    levels.power = 1;
    const text = radarDescription(levels, LEVEL_WORDS);
    expect(text.startsWith("Purpose: Growing. Team: no reading yet.")).toBe(true);
    expect(text).toContain("Power: Absent.");
    expect(text.endsWith("Impact: no reading yet.")).toBe(true);
    expect(text).not.toMatch(/\d/);
  });

  it("reads each block's newest level off the payload, and null where there is none", () => {
    const levels = newestLevels([
      { id: "power", latest: read({ level: 2 }), history: [read({ level: 2 })] },
      { id: "legal", latest: null, history: [] },
    ]);
    expect(Object.keys(levels)).toEqual(CANVAS_ORDER.map((b) => b.id));
    expect(levels.power).toBe(2);
    expect(levels.legal).toBeNull();
    expect(levels.purpose).toBeNull();
  });

  it("phrases the season weeks", () => {
    expect(weeksPhrase([3])).toBe("week 3");
    expect(weeksPhrase([1, 2])).toBe("weeks 1 and 2");
    expect(weeksPhrase([5, 8, 9, 13])).toBe("weeks 5, 8, 9 and 13");
    expect(weeksPhrase([])).toBe("");
  });
});
