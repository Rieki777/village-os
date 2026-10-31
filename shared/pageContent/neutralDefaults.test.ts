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
