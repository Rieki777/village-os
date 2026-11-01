/**
 * A VILLAGE THAT KEPT ITS WORDS READS THEM, WHATEVER THE DEFAULTS SAY.
 *
 * The first village adopted every page section before the defaults became
 * neutral starter text (2026-10-23), and its record of what it holds is in
 * server/seeds/amora/pages/. A page resolves stored words field by field and
 * falls back to the default only where nothing usable is stored: a missing
 * key, a blank required field, a missing fixed row. So the defaults can move
 * under a kept copy only if the copy has such a gap.
 *
 * What is held here, for every one of the 18 sections: the record is a
 * document the save route accepts, and resolving it gives back exactly the
 * record. Nothing in it falls back, so no starter word can appear on that
 * village's pages.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adoptedDocument, pageDocumentProblems, pageSectionKey, PAGE_SPECS } from "./index";

const RECORD_DIR = path.resolve(import.meta.dirname, "..", "..", "server", "seeds", "amora", "pages"); // brand-ok: the first village's own record, read to prove the defaults cannot reach it

describe("the first village's kept copy of its pages", () => {
  it("covers every page section", () => {
    const files = fs.readdirSync(RECORD_DIR).filter((f) => f.endsWith(".json")).sort();
    expect(files).toEqual(PAGE_SPECS.map((spec) => `${pageSectionKey(spec)}.json`).sort());
  });

  it.each(PAGE_SPECS.map((spec) => [pageSectionKey(spec), spec] as const))("%s resolves to its own words, with no default filling a gap", (section, spec) => {
    const record = JSON.parse(fs.readFileSync(path.join(RECORD_DIR, `${section}.json`), "utf8"));
    expect(pageDocumentProblems(spec, record)).toEqual([]);
    expect(adoptedDocument(spec, record)).toEqual(record);
  });
});
