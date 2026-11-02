/**
 * One set of path names: the menu, Home's path cards and the membership
 * letter's path choices show the village's path words (Admin, Paths & Stages)
 * wherever it has not written its own words for that box (shared/pageContent/pathNames.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../gameConfig";
import { resolveVillagePathWords, servedPaths, type ServedPath } from "../villagePaths";
import { HOME_PAGE } from "./home";
import { LOVE_LETTER_PAGE } from "./loveLetter";
import { SITE_PAGE } from "./site";
import { adoptedDocument, resolvePage, resolvePageRaw } from "./resolve";
import { pageVarsFrom } from "./vars";
import { PATH_NAME_SPOTS, pathOfPageRow, withPathNames } from "./pathNames";
import type { PageSpec } from "./types";

type Doc = Record<string, any>;
const VARS = pageVarsFrom({ project: { name: "Willowbrook", commitmentName: "Pact" } });
const SPECS: PageSpec[] = [SITE_PAGE, HOME_PAGE, LOVE_LETTER_PAGE];

/** The paths as /api/game/config serves them, from a stored village-paths document. */
const pathsOf = (doc: unknown): ServedPath[] => servedPaths(resolveVillagePathWords(doc), VARS);
const PLATFORM = pathsOf(null);
const RENAMED = pathsOf({
  paths: {
    investor: { label: "Backer", role: "Seed Partner" },
    resident: { label: "Neighbour", role: "Lives in {village}" },
  },
});

const show = (spec: PageSpec, stored: unknown, paths: ServedPath[]) => withPathNames(spec, stored, resolvePage(spec, stored, VARS), paths);
const row = (page: Doc, spec: PageSpec, id: string) => {
  const spot = PATH_NAME_SPOTS[spec.id]!;
  return page[spot.section].lists[spot.list].find((r: Doc) => r.id === id);
};
const menu = (stored: unknown, paths: ServedPath[], id: string) => row(show(SITE_PAGE, stored, paths), SITE_PAGE, id);
const card = (stored: unknown, paths: ServedPath[], id: string) => row(show(HOME_PAGE, stored, paths), HOME_PAGE, id);
const choice = (stored: unknown, paths: ServedPath[], id: string) => row(show(LOVE_LETTER_PAGE, stored, paths), LOVE_LETTER_PAGE, id);

describe("which page rows name a path", () => {
  it("the journey page's address or its last part, and nothing else", () => {
    expect(["/investor", "steward", "/resident", "prosperity"].map(pathOfPageRow)).toEqual(["investor", "steward", "resident", "prosperity-creator"]);
    expect(["/visit", "/love-letter", "team", ""].map(pathOfPageRow)).toEqual([null, null, null, null]);
  });

  it("every spot's path boxes default to words with no {word} in them, so a path's filled words drop straight in", () => {
    for (const spec of SPECS) {
      const spot = PATH_NAME_SPOTS[spec.id]!;
      const rows = resolvePageRaw(spec, null)[spot.section].lists[spot.list].filter((r) => pathOfPageRow(r.id ?? ""));
      expect(rows.length, spec.id).toBe(GAME_CONFIG.paths.length);
      for (const r of rows) for (const box of spot.boxes) expect(r[box], `${spec.id} ${r.id} ${box}`).not.toMatch(/\{/);
    }
  });
});

describe("a village that never renamed a path", () => {
  it("reads every page exactly as before, saved or not", () => {
    for (const spec of SPECS) {
      expect(show(spec, null, PLATFORM), spec.id).toEqual(resolvePage(spec, null, VARS));
      const saved = adoptedDocument(spec, null);
      expect(show(spec, saved, PLATFORM), `${spec.id}, every box saved`).toEqual(resolvePage(spec, saved, VARS));
    }
  });

  it("the first village's kept pages read exactly as before (its records in server/seeds/amora)", () => {
    const record = (f: string) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "server/seeds/amora/pages", f), "utf8")); // brand-ok: the first village's own records
    for (const [spec, file] of [[SITE_PAGE, "page-site.json"], [HOME_PAGE, "page-home.json"], [LOVE_LETTER_PAGE, "page-love-letter.json"]] as const) {
      const stored = record(file);
      expect(show(spec, stored, PLATFORM), spec.id).toEqual(resolvePage(spec, stored, VARS));
    }
  });

  it("with no path words served (a server too old to send them), nothing moves", () => {
    expect(withPathNames(SITE_PAGE, null, resolvePage(SITE_PAGE, null, VARS), null)).toEqual(resolvePage(SITE_PAGE, null, VARS));
  });
});

describe("a path rename where the village saved nothing", () => {
  it("reaches the menu: the name and its second line", () => {
    expect(menu(null, RENAMED, "/investor")).toMatchObject({ label: "Backer", subtitle: "Seed Partner" });
    expect(menu(null, RENAMED, "/resident")).toMatchObject({ label: "Neighbour", subtitle: "Lives in Willowbrook" });
    expect(menu(null, RENAMED, "/steward"), "a path it did not rename").toMatchObject({ label: "Village Steward", subtitle: "Co-Creator" });
    expect(menu(null, RENAMED, "/visit"), "a row that names no path").toMatchObject({ label: "Plan a Visit" });
  });

  it("reaches Home's path cards, and the card's own sentence stays the card's", () => {
    const investor = card(null, RENAMED, "investor");
    expect(investor).toMatchObject({ title: "Backer", subtitle: "Seed Partner" });
    expect(investor.description).toBe(resolvePage(HOME_PAGE, null, VARS).paths.lists.cards[0].description);
  });

  it("reaches the letter's path choices, keeping the rest of each choice's words", () => {
    expect(choice(null, RENAMED, "investor").label).toBe("Backer / Seed Partner");
    expect(choice(null, RENAMED, "resident").label, "its own second line, which never was the path's").toBe("Neighbour / Future Villager");
    expect(choice(null, RENAMED, "steward").label).toBe("Village Steward / Co-Creator");
  });
});

describe("a box the village wrote its own words in", () => {
  it("CONTROL: a saved menu name stays after a path rename", () => {
    const stored = { menu: { pages: [{ id: "/investor", label: "Our Funders", subtitle: "Patrons" }] } };
    expect(menu(stored, RENAMED, "/investor")).toMatchObject({ label: "Our Funders", subtitle: "Patrons" });
  });

  it("a second line cleared on purpose stays clear", () => {
    const stored = { menu: { pages: [{ id: "/investor", label: "Investor", subtitle: "" }] } };
    expect(menu(stored, RENAMED, "/investor")).toMatchObject({ label: "Backer", subtitle: "" });
  });

  it("a village that saved only some spots keeps those, and the rename reaches the rest", () => {
    // The Pages editor writes a whole list when one row changes: here Housing
    // was renamed, so every other row was written as the platform's word.
    const rows = resolvePageRaw(SITE_PAGE, null).menu.lists.pages.map((r) => (r.id === "/housing" ? { ...r, label: "Homes" } : { ...r }));
    const site = { menu: { pages: rows } };
    expect(menu(site, RENAMED, "/investor").label).toBe("Backer");
    expect(menu(site, RENAMED, "/housing").label).toBe("Homes");
    const home = { paths: { cards: [{ id: "resident", title: "Settler", subtitle: "Here for good", description: "Ours." }] } };
    expect(card(home, RENAMED, "resident")).toMatchObject({ title: "Settler", subtitle: "Here for good" });
    expect(card(home, RENAMED, "investor")).toMatchObject({ title: "Backer", subtitle: "Seed Partner" });
    const letter = { form: { paths: [{ id: "investor", label: "Funding the land" }] } };
    expect(choice(letter, RENAMED, "investor").label).toBe("Funding the land");
    expect(choice(letter, RENAMED, "resident").label).toBe("Neighbour / Future Villager");
  });
});
