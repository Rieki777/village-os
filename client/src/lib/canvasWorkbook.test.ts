/**
 * The workbook as a Markdown file, read line by line (2026-09-25).
 *
 * "Save as Markdown" hands a group the whole workbook to fill in on a screen.
 * This reads what that file DOES carry: the village's name, the credit at
 * both ends, the five levels in the canvas's words, the four foundations,
 * every block's quoted question and description beside our own questions,
 * room to write, a tick list per block, the blank Decision Matrix and the
 * key moments. And what it must not: a number that adds anything up.
 */
import { describe, expect, it } from "vitest";
import { CANVAS_FOUNDATIONS, CANVAS_LEVELS, CANVAS_ORDER } from "@shared/governanceCanvas";
import {
  CANVAS_BLOCK_TEXT,
  CANVAS_CREDIT,
  CANVAS_FOUNDATION_TEXT,
  CANVAS_KEY_MOMENTS,
  CANVAS_SCALE_TEXT,
} from "@shared/governanceCanvasText";
import { MATRIX_BLANK_ROWS, defaultPaper, levelLine, workbookFilename, workbookMarkdown } from "./canvasWorkbook";

const md = workbookMarkdown("Willowbrook");
const lines = md.split("\n");

describe("the Markdown workbook", () => {
  it("is headed with the village's name and credits the canvas at the top and the foot", () => {
    expect(lines[0]).toBe("# Governance Canvas workbook for Willowbrook");
    const credit = `Quoted from the ${CANVAS_CREDIT.text}: ${CANVAS_CREDIT.url}`;
    expect(lines[2]).toBe(credit);
    expect(lines.filter((l) => l === credit)).toHaveLength(2);
    expect(lines.lastIndexOf(credit)).toBeGreaterThan(lines.indexOf("## Key moments"));
  });

  it("lists the five levels in the canvas's words", () => {
    for (const level of CANVAS_LEVELS) {
      expect(lines).toContain(`- ${level} ${CANVAS_SCALE_TEXT[level].word}: ${CANVAS_SCALE_TEXT[level].meaning}`);
    }
    expect(levelLine(5)).toBe("5 Thriving: Working well & alive");
  });

  it("describes the four foundations in the canvas's words", () => {
    for (const f of CANVAS_FOUNDATIONS) {
      expect(lines).toContain(`- **${CANVAS_FOUNDATION_TEXT[f].name}**: ${CANVAS_FOUNDATION_TEXT[f].description}`);
    }
  });

  it("gives every block, in canvas order, its quoted words, our questions, room to write and one tick list", () => {
    const headings = lines.filter((l) => l.startsWith("### "));
    expect(headings).toEqual(CANVAS_ORDER.map((b) => `### Block ${b.number}: ${b.name}`));

    for (const block of CANVAS_ORDER) {
      const start = lines.indexOf(`### Block ${block.number}: ${block.name}`);
      const end = lines.indexOf("---", start);
      const section = lines.slice(start, end);
      expect(section, block.id).toContain(`**The canvas asks:** ${CANVAS_BLOCK_TEXT[block.id].question}`);
      expect(section, block.id).toContain(`> ${CANVAS_BLOCK_TEXT[block.id].description}`);
      expect(section, block.id).toContain(block.question);
      for (const p of block.prompts) expect(section, block.id).toContain(`- ${p}`);
      expect(section, block.id).toContain("**What we say**");
      expect(section, block.id).toContain("**Why, in one sentence:**");
      // One unticked box per level, and nothing ticked in a blank workbook.
      const boxes = section.filter((l) => l.startsWith("- [ ] "));
      expect(boxes, block.id).toEqual(CANVAS_LEVELS.map((l) => `- [ ] ${levelLine(l)}`));
      expect(section.some((l) => l.startsWith("- [x]")), block.id).toBe(false);
    }
  });

  it("carries a blank Decision Matrix with the canvas's five columns", () => {
    const header = lines.indexOf("| Subject / Decision | Approval | Consultation | Information | Method |");
    expect(header).toBeGreaterThan(lines.indexOf("## Decision Matrix"));
    expect(lines[header + 1]).toBe("| --- | --- | --- | --- | --- |");
    const blanks = lines.slice(header + 2, header + 2 + MATRIX_BLANK_ROWS);
    for (const b of blanks) expect(b).toBe("|   |   |   |   |   |");
    expect(lines[header + 2 + MATRIX_BLANK_ROWS]).toBe("");
  });

  it("names the four key moments", () => {
    const at = lines.indexOf("## Key moments");
    for (const m of CANVAS_KEY_MOMENTS) expect(lines.indexOf(`- ${m}`)).toBeGreaterThan(at);
  });

  it("carries no digit but a block's number or a level's numeral", () => {
    // A total comparator: anything else numeric in the file ("7 of 12", a
    // percentage, a count of blocks read) is a number that adds something up.
    let rest = md;
    for (const block of [...CANVAS_ORDER].reverse()) rest = rest.split(`Block ${block.number}:`).join("Block:");
    for (const level of CANVAS_LEVELS) rest = rest.split(levelLine(level)).join("level");
    expect(rest.match(/.{0,30}\d.{0,30}/g)).toBeNull();
  });
});

describe("the file name and the paper", () => {
  it("carries the village's name when it has one, and a plain name when it does not", () => {
    expect(workbookFilename("Willowbrook")).toBe("governance-canvas-workbook-willowbrook.md");
    expect(workbookFilename("Río Claro / Norte")).toBe("governance-canvas-workbook-rio-claro-norte.md");
    expect(workbookFilename("  ")).toBe("governance-canvas-workbook.md");
  });

  it("starts on US Letter where printers default to it, and on A4 everywhere else", () => {
    expect(defaultPaper("en-US")).toBe("letter");
    expect(defaultPaper("es-MX")).toBe("letter");
    expect(defaultPaper("en_CA")).toBe("letter");
    expect(defaultPaper("en-GB")).toBe("a4");
    expect(defaultPaper("nl")).toBe("a4");
    expect(defaultPaper(undefined)).toBe("a4");
  });
});
