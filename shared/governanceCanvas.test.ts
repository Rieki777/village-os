/**
 * The governance canvas registry, held to its shape (2026-09-24).
 *
 * The compiler already refuses a block keyed by an id the union does not
 * know and a brief section that does not exist. These are the rules it
 * cannot see: the order, the numbering, that all four foundations are used,
 * the week range, the level scale, and the one validator the route and the
 * form share.
 */
import { describe, expect, it } from "vitest";
import {
  CANVAS_BLOCK_IDS,
  CANVAS_BLOCKS,
  CANVAS_CREDIT,
  CANVAS_FOUNDATIONS,
  CANVAS_LEVELS,
  CANVAS_MOMENTS,
  CANVAS_ORDER,
  CANVAS_SENTENCE_MAX,
  FOUNDATION_LABELS,
  LEVEL_MEANINGS,
  LEVEL_WORDS,
  MOMENT_LABELS,
  isCanvasLevel,
  parseCanvasReading,
} from "./governanceCanvas";
import { BRIEF_SECTIONS } from "./villageBrief";

describe("the twelve blocks", () => {
  it("are the twelve canvas blocks, in canvas order", () => {
    expect(CANVAS_ORDER.map((b) => b.id)).toEqual([
      "purpose",
      "team",
      "roles",
      "meetings",
      "stakeholders",
      "coordination",
      "power",
      "conflict",
      "learning",
      "resourcing",
      "legal",
      "impact",
    ]);
    expect(CANVAS_BLOCK_IDS).toHaveLength(12);
  });

  it("number themselves by that order, one to twelve", () => {
    expect(CANVAS_ORDER.map((b) => b.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const id of CANVAS_BLOCK_IDS) expect(CANVAS_BLOCKS[id].id).toBe(id);
  });

  it("each carry a name, a short question, and three to five prompts", () => {
    for (const b of CANVAS_ORDER) {
      expect(b.name.length, b.id).toBeGreaterThan(2);
      expect(b.question.endsWith("?"), b.id).toBe(true);
      expect(b.question.length, `${b.id}: a SHORT question`).toBeLessThanOrEqual(110);
      expect(b.prompts.length, b.id).toBeGreaterThanOrEqual(3);
      expect(b.prompts.length, b.id).toBeLessThanOrEqual(5);
      for (const p of b.prompts) expect(p.trim().length, b.id).toBeGreaterThan(10);
    }
  });

  it("rest on the four foundations, and every foundation carries at least one block", () => {
    expect([...CANVAS_FOUNDATIONS]).toEqual(["legal-framework", "internal-rules", "culture", "personal-leadership"]);
    const used = new Set(CANVAS_ORDER.flatMap((b) => b.foundations));
    expect([...used].sort()).toEqual([...CANVAS_FOUNDATIONS].sort());
    for (const b of CANVAS_ORDER) {
      expect(b.foundations.length, b.id).toBeGreaterThan(0);
      expect(new Set(b.foundations).size, `${b.id} names a foundation twice`).toBe(b.foundations.length);
    }
    for (const f of CANVAS_FOUNDATIONS) expect(FOUNDATION_LABELS[f].length).toBeGreaterThan(3);
  });

  it("map only to brief sections that exist", () => {
    const sections = new Set(BRIEF_SECTIONS.map((s) => s.id));
    for (const b of CANVAS_ORDER) {
      for (const s of b.briefSections) expect(sections.has(s), `${b.id} -> ${s}`).toBe(true);
    }
  });

  it("carry the mapping the lane was briefed with", () => {
    const mapping = Object.fromEntries(CANVAS_ORDER.map((b) => [b.id, [...b.briefSections]]));
    expect(mapping).toEqual({
      purpose: ["aims", "vision", "constraints"],
      team: ["membership", "people"],
      roles: ["work"],
      meetings: ["rhythm"],
      stakeholders: ["stakeholders"],
      coordination: ["tools"],
      power: ["decisions"],
      conflict: [],
      learning: ["learning"],
      resourcing: ["economy"],
      legal: ["legal", "land"],
      impact: ["impact"],
    });
  });

  it("points somewhere else exactly when no brief section holds a block", () => {
    for (const b of CANVAS_ORDER) {
      expect(!!b.elsewhere, b.id).toBe(b.briefSections.length === 0);
    }
    expect(CANVAS_BLOCKS.conflict.elsewhere?.href).toBe("/exit-policy");
  });

  it("keep the three sections the canvas added to the brief admin-only", () => {
    const byId = Object.fromEntries(BRIEF_SECTIONS.map((s) => [s.id, s.audience]));
    expect(byId.stakeholders).toBe("admin");
    expect(byId.learning).toBe("admin");
    expect(byId.impact).toBe("admin");
  });

  it("fall inside the thirteen weeks of Season Two, in order and without repeats", () => {
    for (const b of CANVAS_ORDER) {
      expect(b.seasonWeeks.length, b.id).toBeGreaterThan(0);
      for (const w of b.seasonWeeks) {
        expect(Number.isInteger(w), `${b.id} week ${w}`).toBe(true);
        expect(w, b.id).toBeGreaterThanOrEqual(1);
        expect(w, b.id).toBeLessThanOrEqual(13);
      }
      expect([...b.seasonWeeks], b.id).toEqual([...new Set(b.seasonWeeks)].sort((x, y) => x - y));
    }
    expect(CANVAS_BLOCKS.purpose.seasonWeeks).toEqual([1, 2]);
    expect(CANVAS_BLOCKS.resourcing.seasonWeeks).toEqual([5, 8, 9, 13]);
  });
});

describe("the level scale", () => {
  it("runs one to five, Absent to Thriving, and every level has a meaning", () => {
    expect([...CANVAS_LEVELS]).toEqual([1, 2, 3, 4, 5]);
    expect(CANVAS_LEVELS.map((l) => LEVEL_WORDS[l])).toEqual(["Absent", "Forming", "Emerging", "Growing", "Thriving"]);
    for (const l of CANVAS_LEVELS) expect(LEVEL_MEANINGS[l].length).toBeGreaterThan(10);
  });

  it("takes whole numbers only", () => {
    expect(isCanvasLevel(3)).toBe(true);
    for (const bad of [0, 6, 2.5, -1, "3", null, undefined, Number.NaN]) expect(isCanvasLevel(bad), String(bad)).toBe(false);
  });
});

describe("the moments and the credit", () => {
  it("names the six occasions a reading can be taken on, the baseline first", () => {
    expect([...CANVAS_MOMENTS]).toEqual(["baseline", "canvas-moon", "onboarding", "conflict", "funding", "season"]);
    for (const m of CANVAS_MOMENTS) expect(MOMENT_LABELS[m].length).toBeGreaterThan(3);
  });

  it("credits the canvas's authors and links to where it was published", () => {
    expect(CANVAS_CREDIT.text).toBe(
      "Governance Canvas by the Bioregional Weaving Labs Collective and Commonland (Tijn Tjoelker, Ernestien Idenburg, Noa Lodeizen, Zlatina Tsvetkova)",
    );
    expect(CANVAS_CREDIT.url).toBe("https://tijntjoelker.substack.com/p/governance-canvas");
  });
});

describe("the one validator", () => {
  const good = { blockId: "power", level: 3, sentence: "Two people decide most things and the rest find out later.", moment: "baseline" };

  it("accepts a reading and trims its sentence", () => {
    const r = parseCanvasReading({ ...good, sentence: `  ${good.sentence}  ` });
    expect(r).toEqual({ ok: true, reading: { ...good, level: 3 } });
  });

  it("takes the baseline when no moment is given", () => {
    const r = parseCanvasReading({ blockId: "power", level: 2, sentence: "Nobody has named who holds the budget." });
    expect(r.ok && r.reading.moment).toBe("baseline");
  });

  it("refuses a block the canvas does not have", () => {
    expect(parseCanvasReading({ ...good, blockId: "vibes" })).toEqual({ ok: false, error: "That is not one of the twelve canvas blocks." });
  });

  it("refuses a level outside one to five, or not a whole number", () => {
    for (const level of [0, 6, 3.5, "3", null]) {
      const r = parseCanvasReading({ ...good, level });
      expect(r.ok, String(level)).toBe(false);
      expect(!r.ok && r.error).toMatch(/1 \(Absent\) to 5 \(Thriving\)/);
    }
  });

  it("refuses an empty sentence and one past the limit", () => {
    expect(parseCanvasReading({ ...good, sentence: "   " }).ok).toBe(false);
    expect(parseCanvasReading({ ...good, sentence: "x".repeat(CANVAS_SENTENCE_MAX) }).ok).toBe(true);
    const long = parseCanvasReading({ ...good, sentence: "x".repeat(CANVAS_SENTENCE_MAX + 1) });
    expect(!long.ok && long.error).toBe("Keep the sentence to 500 characters.");
  });

  it("refuses a moment that is not on the list", () => {
    expect(parseCanvasReading({ ...good, moment: "whenever" })).toEqual({
      ok: false,
      error: "That is not a moment a canvas reading can be taken on.",
    });
  });
});
