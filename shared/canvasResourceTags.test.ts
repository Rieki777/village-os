/**
 * Which block a resource shows under (shared/canvasResourceTags.ts): the
 * platform's hand-made map held to the shipped snapshot row for row, the
 * keyword suggestions with their reasons, the order of the three layers,
 * and the rule that a safety surface never carries a Nonviolent
 * Communication row.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CANVAS_BLOCK_IDS } from "./governanceCanvas";
import { readCanvasDatabase, type CanvasResourceInput } from "./canvasResources";
import {
  CONFIRMED_BLOCK_TAGS,
  KEYWORD_BLOCKS,
  confirmedBlocksFor,
  parseBlockList,
  placingOf,
  safetyExcluded,
  suggestBlocks,
} from "./canvasResourceTags";

const doc = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server", "seeds", "canvas-resources.json"), "utf8")) as {
  header: string[];
  rows: string[][];
};
const read = readCanvasDatabase([doc.header, ...doc.rows]);
if (!read.ok) throw new Error(read.refusal);
const SNAPSHOT: CanvasResourceInput[] = read.resources;

describe("the platform's map, CONFIRMED_BLOCK_TAGS", () => {
  it("places every row of the snapshot under at least one block", () => {
    const unmapped = SNAPSHOT.filter((r) => !confirmedBlocksFor(r.nameSlug)?.length).map((r) => r.name);
    expect(unmapped).toEqual([]);
  });

  it("names no row the snapshot does not hold, so a stale key cannot hide", () => {
    const slugs = new Set(SNAPSHOT.map((r) => r.nameSlug));
    expect(Object.keys(CONFIRMED_BLOCK_TAGS).filter((k) => !slugs.has(k))).toEqual([]);
  });

  it("uses only real block ids, each once", () => {
    for (const [slug, blocks] of Object.entries(CONFIRMED_BLOCK_TAGS)) {
      expect(blocks.every((b) => (CANVAS_BLOCK_IDS as readonly string[]).includes(b)), slug).toBe(true);
      expect(new Set(blocks).size, slug).toBe(blocks.length);
    }
  });

  it("gives every block something to read", () => {
    for (const block of CANVAS_BLOCK_IDS) {
      expect(SNAPSHOT.some((r) => confirmedBlocksFor(r.nameSlug)?.includes(block)), block).toBe(true);
    }
  });

  it("answers null for a row it does not know, and for inherited object keys", () => {
    expect(confirmedBlocksFor("a-resource-added-next-year")).toBeNull();
    expect(confirmedBlocksFor("constructor")).toBeNull();
    expect(confirmedBlocksFor("__proto__")).toBeNull();
  });
});

describe("suggestions from keywords", () => {
  it("names the keyword that matched, in the row's own spelling, block by block in canvas order", () => {
    expect(suggestBlocks(["Decision making", "NVC", "learning"])).toEqual([
      { block: "power", keyword: "Decision making" },
      { block: "conflict", keyword: "NVC" },
      { block: "learning", keyword: "learning" },
    ]);
  });

  it("matches a whole keyword, never a piece of one", () => {
    expect(suggestBlocks(["empowerment", "powerful teams", "conflicted"])).toEqual([]);
    expect(suggestBlocks([])).toEqual([]);
  });

  it("has a rule for every block, in lower case", () => {
    for (const block of CANVAS_BLOCK_IDS) {
      expect(KEYWORD_BLOCKS[block].length, block).toBeGreaterThan(0);
      for (const term of KEYWORD_BLOCKS[block]) expect(term, block).toBe(term.toLowerCase().trim());
    }
  });

  it("suggests something for every snapshot row that carries keywords", () => {
    const silent = SNAPSHOT.filter((r) => r.keywords.length && !suggestBlocks(r.keywords).length).map((r) => r.name);
    expect(silent).toEqual([]);
  });
});

describe("the three layers, first one present wins", () => {
  const consent = { nameSlug: "consent-decision-making", keywords: ["decision making", "consent", "roles"] };

  it("the platform's map before the keywords", () => {
    expect(placingOf({ ...consent, local: null })).toEqual({ by: "platform", blocks: ["power"], keywords: {} });
  });

  it("the keywords when the map has no entry, with each block's reason", () => {
    const p = placingOf({ nameSlug: "added-upstream-later", keywords: ["consent", "roles"], local: null });
    expect(p.by).toBe("suggested");
    expect(p.blocks).toEqual(["roles", "power"]);
    expect(p.keywords).toEqual({ roles: "roles", power: "consent" });
  });

  it("the village's own placing before both, in canvas order, and an empty placing shows it nowhere", () => {
    expect(placingOf({ ...consent, local: ["learning", "purpose"] })).toEqual({ by: "village", blocks: ["purpose", "learning"], keywords: {} });
    expect(placingOf({ ...consent, local: [] }).blocks).toEqual([]);
    expect(placingOf({ ...consent, local: [] }).by).toBe("village");
  });

  it("a stored placing naming a block that no longer exists drops it", () => {
    expect(placingOf({ ...consent, local: ["power", "gone"] }).blocks).toEqual(["power"]);
  });
});

describe("parseBlockList, what the placing route accepts", () => {
  it("takes known ids, once each, in canvas order", () => {
    expect(parseBlockList(["legal", "power", "power"])).toEqual(["power", "legal"]);
    expect(parseBlockList([])).toEqual([]);
  });

  it("refuses anything else", () => {
    for (const bad of [null, "power", [1], ["power", "gone"], { 0: "power" }]) expect(parseBlockList(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe("a safety surface never carries NVC", () => {
  it("names exactly the three Nonviolent Communication rows of the snapshot", () => {
    expect(SNAPSHOT.filter(safetyExcluded).map((r) => r.name).sort()).toEqual([
      "How You Can Use The NVC Process",
      "Key Facts About Nonviolent Communication (NVC)",
      "Sociocracy and Nonviolent Communication (NVC)",
    ]);
  });

  it("catches a renamed row by its keywords or its description", () => {
    expect(safetyExcluded({ name: "Four steps", description: "", keywords: ["NVC"] })).toBe(true);
    expect(safetyExcluded({ name: "Four steps", description: "Rosenberg's Non-violent Communication, briefly.", keywords: [] })).toBe(true);
    expect(safetyExcluded({ name: "Beginning Anew", description: "Restoring relationships.", keywords: ["conflict navigation"] })).toBe(false);
  });
});
