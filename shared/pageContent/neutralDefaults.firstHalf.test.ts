/**
 * THE STARTER WORDS CLAIM NOTHING ABOUT ANY ONE VILLAGE (2026-10-23).
 *
 * These page defaults were the first village's own words until that village
 * kept its copy in its database (record: server/seeds/amora/pages/). They are
 * what every other village shows until it writes its own, so they must be
 * true of any village: its name comes in through `{village}` and the other
 * words, and no default states a place, a price, a figure, a date, a person
 * or a way of deciding that belongs to one village.
 *
 * The check is on the words as the spec holds them, every field and every
 * list row, so a figure creeping back into a default fails here before a
 * village publishes it.
 */
import { describe, expect, it } from "vitest";
import { HOME_PAGE } from "./home";
import { SITE_PAGE, SITE_FOOTER_SIGNOFF } from "./site";
import { TEAM_PAGE } from "./team";
import { MASTER_PLAN_PAGE } from "./masterPlan";
import { LOVE_LETTER_PAGE } from "./loveLetter";
import { HOUSING_PAGE } from "./housing";
import { OPPORTUNITIES_PAGE } from "./opportunities";
import { VISIT_PAGE } from "./visit";
import { WORK_WITH_US_PAGE } from "./workWithUs";
import { DEFAULT_GOVERNANCE, DEFAULT_OPENING } from "../membershipLetter";
import { resolvePage, resolvePageRaw } from "./resolve";
import type { PageSpec } from "./types";

const SPECS: PageSpec[] = [HOME_PAGE, SITE_PAGE, TEAM_PAGE, MASTER_PLAN_PAGE, LOVE_LETTER_PAGE, HOUSING_PAGE, OPPORTUNITIES_PAGE, VISIT_PAGE, WORK_WITH_US_PAGE];

/** Every default a spec holds, by where it sits. */
function defaultsOf(spec: PageSpec): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const section of spec.sections) {
    for (const field of section.fields) out.push([`${spec.id}.${section.id}.${field.key}`, field.default]);
    for (const list of section.lists ?? []) {
      list.default.forEach((row, i) => {
        for (const [key, value] of Object.entries(row)) out.push([`${spec.id}.${section.id}.${list.key}[${i}].${key}`, value]);
      });
    }
  }
  return out;
}

/** Words that belonged to one village's page, and the shapes of a figure. */
const ONE_VILLAGE = [
  "Dominicalito", // brand-ok: the list this file asserts the ABSENCE of
  "Costa Rica",
  "Pura Vida",
  "jungle",
  "heart centered",
  "heart-centered",
  "sociocra",
  "Nonviolent",
  "all beings",
  "Most Beautiful",
  "most beautiful",
  "home sites",
  "Retreat Keys",
  "Family Member",
  "regenerative village",
];

describe("the starter words of the first half of the pages", () => {
  it("state no figure, price, percentage or date", () => {
    const figures = SPECS.flatMap(defaultsOf).filter(([, value]) => /\d|[$€£₡%]/.test(value));
    expect(figures).toEqual([]);
  });

  it("carry none of one village's own words", () => {
    const found: string[] = [];
    for (const [where, value] of SPECS.flatMap(defaultsOf)) {
      for (const word of ONE_VILLAGE) if (value.includes(word)) found.push(`${where}: ${word}`);
    }
    expect(found).toEqual([]);
  });

  it("start the lists of one piece of land's facts empty", () => {
    const list = (spec: PageSpec, sectionId: string, key: string) =>
      spec.sections.find((s) => s.id === sectionId)!.lists!.find((l) => l.key === key)!.default;
    expect(list(MASTER_PLAN_PAGE, "vision", "zones")).toEqual([]);
    expect(list(MASTER_PLAN_PAGE, "phases", "phases")).toEqual([]);
    expect(list(HOUSING_PAGE, "features", "items")).toEqual([]);
    expect(list(TEAM_PAGE, "advisory", "items")).toEqual([]);
    expect(list(TEAM_PAGE, "board", "columns")).toEqual([]);
    expect(list(LOVE_LETTER_PAGE, "contribution", "tiers")).toEqual([]);
  });

  it("sign the footer off in words any village can use", () => {
    expect(SITE_FOOTER_SIGNOFF).toBe("Built with care by");
  });

  it("give the membership letter's covenant paragraphs no village's land or plan", () => {
    for (const text of [DEFAULT_OPENING, DEFAULT_GOVERNANCE]) {
      expect(text).not.toMatch(/\d|[$€£₡%]/);
      for (const word of ONE_VILLAGE) expect(text, word).not.toContain(word);
    }
  });
});

/**
 * A VILLAGE THAT SAVED ONLY A FEW FIELDS. Its own words win field by field and
 * every other field is the starter's, so a sparse copy reads as its own words
 * among the starter words, never among another village's. Each section below
 * keeps one field of the village's own, which is the shape a founder leaves
 * after a first pass through Admin, Pages.
 */
describe("a sparse saved copy among the starter words", () => {
  const OWN = "Our own words";

  it.each(SPECS.map((spec) => [spec.id, spec] as const))("%s: its one saved field per section, and the starter's everywhere else", (_id, spec) => {
    const sparse: Record<string, Record<string, string>> = {};
    for (const section of spec.sections) {
      const field = section.fields.find((f) => f.kind !== "link");
      if (field) sparse[section.id] = { [field.key]: OWN.slice(0, field.max) };
    }
    const page = resolvePageRaw(spec, sparse);
    const leftOver: string[] = [];
    for (const section of spec.sections) {
      for (const field of section.fields) {
        const want = sparse[section.id]?.[field.key] ?? field.default;
        expect(page[section.id].fields[field.key], `${section.id}.${field.key}`).toBe(want);
        if (want !== sparse[section.id]?.[field.key]) leftOver.push(page[section.id].fields[field.key]);
      }
      for (const list of section.lists ?? []) {
        const rows = page[section.id].lists[list.key].map(({ id: _id, ...row }) => row);
        expect(rows, `${section.id}.${list.key}`).toEqual(list.default.map((row) => Object.fromEntries(list.fields.map((f) => [f.key, row[f.key] ?? ""]))));
        for (const row of rows) leftOver.push(...Object.values(row));
      }
    }
    // What the village did not write is the starter's, and the starter claims nothing.
    expect(leftOver.filter((v) => /\d|[$€£₡%]/.test(v) || ONE_VILLAGE.some((w) => v.includes(w)))).toEqual([]);
  });

  it("a council heading saved with no lines leaves no lines: the six it leaned on were another village's", () => {
    const page = resolvePage(TEAM_PAGE, { advisory: { heading: "Elders' Circle" } }, { village: "Willowbrook" });
    expect(page.advisory.fields.heading).toBe("Elders' Circle");
    // Team.tsx draws the box only once it has a line (Team.test.tsx pins that).
    expect(page.advisory.lists.items).toEqual([]);
    expect(page.board.lists.columns).toEqual([]);
  });

  it("a letter that saved its own levels keeps them, under no suggested line and no other village's price", () => {
    const page = resolvePage(LOVE_LETTER_PAGE, { contribution: { tiers: [{ value: "20", label: "20 a month" }] } }, { village: "Willowbrook" });
    expect(page.contribution.lists.tiers).toEqual([{ value: "20", label: "20 a month" }]);
    expect(page.contribution.fields.suggested).toBe("");
    expect(page.contribution.fields.customPlaceholder).not.toMatch(/\$|\d/);
  });

  it("a venture card that saved only its title keeps the starter description and claims no progress", () => {
    const page = resolvePage(OPPORTUNITIES_PAGE, { ventures: { cards: [{ id: "cafe-restaurant", title: "The Bakehouse" }] } }, { village: "Willowbrook" });
    const card = page.ventures.lists.cards.find((c) => c.id === "cafe-restaurant")!;
    expect(card.title).toBe("The Bakehouse");
    expect(card.status).toBe("");
    expect(card.description).not.toMatch(/\d/);
  });

  it("a homepage that saved only its headline keeps its gold word only where the headline says it", () => {
    const vars = { village: "Willowbrook", tagline: "Roots and rivers", "in-location": "" };
    const own = resolvePage(HOME_PAGE, { hero: { headline: "A valley that remembers" } }, vars).hero.fields;
    // The starter gold word is the village's name: in a headline without it, nothing is gold.
    expect(own.highlight).toBe("Willowbrook");
    expect(own.headline.includes(own.highlight)).toBe(false);
    const named = resolvePage(HOME_PAGE, { hero: { headline: "Welcome to Willowbrook" } }, vars).hero.fields;
    expect(named.headline.includes(named.highlight)).toBe(true);
  });
});
