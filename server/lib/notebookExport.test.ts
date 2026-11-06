/**
 * The export pack's four files, rendered from a fixed input (plan 5.6).
 *
 * What the database may hand the pack is proved in
 * server/routes/villageDocuments.test.ts, and the fence around the brief in
 * server/lib/villageBrain.test.ts. This file proves what the RENDERER does
 * with what it is handed: the README says what the brief asked it to, a
 * level never becomes a score, headings stay in their place, and the hash
 * that says "changed since your last export" moves with the content and not
 * with the date.
 */
import { describe, expect, it } from "vitest";
import { CANVAS_BLOCK_IDS, type CanvasBlockId } from "../../shared/governanceCanvas";
import type { CanvasMemberAnswer } from "../../shared/canvasPublicLines";
import { CANVAS_CREDIT } from "../../shared/governanceCanvasText";
import { CANVAS_DATABASE_CSV, PACK_FILE_NAMES, demoteHeadings, packHash, renderPack, type PackInput } from "./notebookExport";

const noAnswers = Object.fromEntries(CANVAS_BLOCK_IDS.map((id) => [id, [] as CanvasMemberAnswer[]])) as Record<CanvasBlockId, CanvasMemberAnswer[]>;

const input = (over: Partial<PackInput> = {}): PackInput => ({
  villageName: "Alder Hollow",
  answers: { ...noAnswers, purpose: [{ section: "aims", title: "What this project is for", body: "# Food\n\nWe grow food together." }] },
  readings: [
    { blockId: "power", level: 4, sentence: "Most decisions go through the circle now.", moment: "canvas-moon", recordedAt: "2026-11-01T10:00:00.000Z" },
    { blockId: "power", level: 2, sentence: "Two people decide most things.", moment: "baseline", recordedAt: "2026-10-03T10:00:00.000Z" },
    { blockId: "team", level: 3, sentence: "We know who is in.", moment: "baseline", recordedAt: "2026-10-03T10:00:00.000Z" },
  ],
  shared: [{ title: "Our agreements", kind: "md", body: "## Quiet hours\n\nNine to seven.", createdAt: "2026-09-01T00:00:00.000Z", sharedAt: "2026-09-02T00:00:00.000Z" }],
  mine: [{ title: "Statutes", kind: "pdf", body: null, createdAt: "2026-09-03T00:00:00.000Z", sharedAt: null }],
  villagePicks: [{ key: "governance-canvas", facts: { key: "governance-canvas", name: "Governance Canvas", type: "Canvas", url: "https://example.test/c", withdrawn: false } }],
  myPicks: [{ key: "gone", facts: null }],
  resourcesReadable: true,
  ...over,
});

const EXPORTED = new Date("2026-11-02T08:00:00.000Z");
const files = (i = input()) => Object.fromEntries(renderPack(i, EXPORTED).map((f) => [f.name, f.content]));

describe("the four files", () => {
  it("are README.md, canvas.md, resources.md and our-documents.md, in that order", () => {
    expect(renderPack(input(), EXPORTED).map((f) => f.name)).toEqual([...PACK_FILE_NAMES]);
  });
});

describe("the README", () => {
  const readme = files()["README.md"];
  it("dates the export and says it is a snapshot", () => {
    expect(readme).toContain("Exported on 2026-11-02 (UTC).");
    expect(readme).toContain("snapshot");
  });
  it("links the column-restricted database, and only its five public columns", () => {
    expect(readme).toContain(CANVAS_DATABASE_CSV);
    expect(CANVAS_DATABASE_CSV).toContain("tq=select%20A%2CB%2CC%2CD%2CE");
  });
  it("warns that uploading to Gemini sends the content to Google, and where the private part is", () => {
    expect(readme).toContain("Uploading these files to a Gemini notebook sends everything in them to Google.");
    expect(readme).toContain("our-documents.md");
  });
  it("says what stays in the village, naming the four sections that never leave", () => {
    expect(readme).toContain("people, legal matters, land and red lines never leave");
    expect(readme).toContain("Who recorded each reading");
  });
  it("credits the canvas", () => {
    expect(readme).toContain(CANVAS_CREDIT.text);
    expect(readme).toContain(CANVAS_CREDIT.url);
  });
});

describe("canvas.md", () => {
  const canvas = files()["canvas.md"];
  it("carries every block, the village's own words, and each reading newest first", () => {
    for (const heading of ["## 1. Purpose", "## 7. Power", "## 12. Impact"]) expect(canvas).toContain(heading);
    expect(canvas).toContain("We grow food together.");
    const newer = canvas.indexOf("Most decisions go through the circle now.");
    const older = canvas.indexOf("Two people decide most things.");
    expect(newer).toBeGreaterThan(0);
    expect(newer).toBeLessThan(older);
    expect(canvas).toContain("- 2026-11-01, Canvas moon: Growing (level 4). Most decisions go through the circle now.");
  });

  it("puts a document's own headings below the pack's", () => {
    expect(canvas).toContain("##### Food");
    expect(canvas).not.toMatch(/^# Food$/m);
  });

  it("never turns the levels into a score: no percent, no average, no count across blocks", () => {
    for (const f of Object.values(files())) {
      expect(f).not.toMatch(/%(?!2C|20)/); // a percent sign, outside the database address's own escapes
      expect(f).not.toMatch(/\baverage\b|\bmean\b|\btotal\b|\bscore\b/i);
      expect(f).not.toMatch(/\b\d+\s+of\s+(12|twelve)\b/i);
      expect(f).not.toMatch(/\bout of\b/i);
    }
  });
});

describe("resources.md", () => {
  it("names a pick the database lists, and says so of one it no longer does", () => {
    const r = files()["resources.md"];
    expect(r).toContain("- **Governance Canvas** (Canvas): https://example.test/c");
    expect(r).toContain("- `gone`: this village's copy of the database no longer lists it.");
  });
  it("lists picks by key, and says why, while the resources cannot be read", () => {
    const r = files(input({ resourcesReadable: false, villagePicks: [{ key: "k1", facts: null }] }))["resources.md"];
    expect(r).toContain("could not be read");
    expect(r).toContain("- `k1`");
  });
});

describe("our-documents.md", () => {
  it("carries a shared text document and lists a stored file by title, never its bytes", () => {
    const d = files()["our-documents.md"];
    expect(d).toContain("### Our agreements");
    expect(d).toContain("#####  Quiet hours".replace("  ", " "));
    expect(d).toContain("Nine to seven.");
    expect(d).toContain("### Statutes");
    expect(d).toContain("The file is not in this pack");
  });
});

describe("packHash", () => {
  it("does not move with the date, and moves with the content", () => {
    expect(packHash(input())).toBe(packHash(input()));
    expect(renderPack(input(), new Date("2027-01-01T00:00:00Z"))).not.toEqual(renderPack(input(), EXPORTED));
    expect(packHash(input({ readings: [] }))).not.toBe(packHash(input()));
    expect(packHash(input())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("demoteHeadings", () => {
  it("pushes every heading down, and stops at six", () => {
    expect(demoteHeadings("# A\ntext\n#### B\n##### C", 2)).toBe("### A\ntext\n###### B\n###### C");
    expect(demoteHeadings("not # a heading", 3)).toBe("not # a heading");
  });
});
