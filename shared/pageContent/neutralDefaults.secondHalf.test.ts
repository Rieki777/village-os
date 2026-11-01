/**
 * THE NEUTRAL STARTER DEFAULTS of the rights, guide and journey pages
 * (Phase C, 2026-10-23), held to what they promise.
 *
 * Every village that has not written its own page reads these words, so they
 * may say only what is true of any village. The founding village keeps its own
 * copy (server/seeds/), which is why nothing here names its place, its
 * businesses, its practices or its numbers. Five claims, each a test:
 *   - no sentence restates that work is paid (Rye, 2026-10-23: the quest and
 *     role cards say it);
 *   - a token may be named, and no sentence says what one does (Rye,
 *     2026-10-22);
 *   - no fact, figure or practice of one village is stated as every village's;
 *   - a village that saved only a little still reads coherently: every
 *     `{word}` is one its page fills, and a name a page cannot follow is never
 *     typed there;
 *   - every page a default sends a visitor to is a mounted route.
 *
 * The village's own name, and the brand guard's banned words, are checked by
 * scripts/check-brand-refs.mjs (shared/ is hard-clean there), so they are not
 * repeated here.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RIGHTS_RESIDENT_PAGE, RIGHTS_STEWARD_PAGE } from "./rights";
import { GOOD_NEIGHBOR_PAGE } from "./goodNeighbor";
import { HOW_WE_CREATE_PAGE } from "./howWeCreate";
import { CO_CREATORS_GUIDE_PAGE } from "./coCreatorsGuide";
import { JOURNEY_PAGES, INVESTOR_JOURNEY } from "./journeys";
import { fillVars, resolvePage } from "./resolve";
import { pageVarsFrom } from "./vars";
import type { FieldKind, PageSpec } from "./types";

const SPECS: readonly PageSpec[] = [
  RIGHTS_RESIDENT_PAGE,
  RIGHTS_STEWARD_PAGE,
  GOOD_NEIGHBOR_PAGE,
  HOW_WE_CREATE_PAGE,
  CO_CREATORS_GUIDE_PAGE,
  ...JOURNEY_PAGES,
];

interface DefaultText {
  spec: PageSpec;
  where: string;
  kind: FieldKind;
  text: string;
}

/** Every default a spec ships, field by field and row by row. */
function defaultsOf(spec: PageSpec): DefaultText[] {
  const out: DefaultText[] = [];
  for (const section of spec.sections) {
    for (const field of section.fields) {
      out.push({ spec, where: `${spec.id}.${section.id}.${field.key}`, kind: field.kind, text: field.default });
    }
    for (const list of section.lists ?? []) {
      list.default.forEach((row, i) => {
        for (const field of list.fields) {
          const text = row[field.key] ?? "";
          out.push({ spec, where: `${spec.id}.${section.id}.${list.key}[${i}].${field.key}`, kind: field.kind, text });
        }
      });
    }
  }
  return out;
}

const ALL = SPECS.flatMap(defaultsOf);
/** The words a visitor reads (a "goes to" box is an address). */
const WORDS = ALL.filter((d) => d.kind !== "link" && d.text.trim() !== "");

const offending = (items: DefaultText[], pattern: RegExp) =>
  items.filter((d) => pattern.test(d.text)).map((d) => `${d.where}: ${d.text}`);

/**
 * The words each page fills itself, after the village's own: named in each
 * spec's help, and filled by the page (or, for {good-neighbor}, from the Good
 * Neighbor page's headline). The values are what a fresh village reads.
 */
const PAGE_WORDS: Record<string, readonly string[]> = {
  "rights-resident": ["transfer"],
  "rights-steward": [],
  "good-neighbor": ["good-neighbor"],
  "how-we-create": [],
  "co-creators-guide": ["good-neighbor"],
  "journey-investor": [],
  "journey-steward": [],
  "journey-resident": ["range", "deposit-summary", "background-note", "transfer-note"],
  "journey-prosperity": ["count", "guide", "acronym", "framework"],
};

/** A fresh village's settings: a name and nothing else. */
const VARS = pageVarsFrom({ project: { name: "Willowbrook" } });

describe("the pay ruling (Rye, 2026-10-23)", () => {
  it("has no default that restates that work is paid", () => {
    const pay =
      /get paid|\bpaid\b|\bearn(s|ed|ing|ings)?\b|compensat|\bwages?\b|salar|\bpays? what\b|what (it|they|each \w+) pays|\bwhat pays\b|claim the tokens|claim your tokens/i;
    expect(offending(WORDS, pay)).toEqual([]);
  });

  it("carries the words the ruling set for the guide's cards, word for word", () => {
    const guide = defaultsOf(CO_CREATORS_GUIDE_PAGE);
    const at = (where: string) => guide.find((d) => d.where === `co-creators-guide.${where}`)!.text;
    expect(at("recognition.cardTitle")).toBe("Open quests and roles");
    expect(at("hypha.actions[1].title")).toBe("Claim Your Contribution");
    expect(at("hypha.actions[1].subtitle")).toBe("After completing a task or season");
    expect(at("hypha.actions[1].description")).toMatch(
      /Detail what you delivered and what \{village\} gained\. This is how the value you create becomes visible\.$/,
    );
    expect(at("ikigai.circles[3].body")).toBe("The roles and quests {village} needs, each on its own card.");
  });
});

describe("the token ruling (Rye, 2026-10-22)", () => {
  it("names a token and never says what one does", () => {
    const aboutTokens = WORDS.filter((d) => /\{token\}|\{value\}|\{tokens\}|\btokens?\b/i.test(d.text));
    expect(aboutTokens.length).toBeGreaterThan(0);
    const does =
      /\b(pay|pays|paid|earn\w*|offset\w*|convert\w*|cash|pool\w*|distribut\w*|redeem\w*|spend\w*|buy\w*|sell\w*|trade\w*|wealth|interest|financial value)\b/i;
    expect(offending(aboutTokens, does)).toEqual([]);
  });
});

describe("no village's own facts, figures or practices", () => {
  it("states no practice, place, business or ritual of the founding village as every village's", () => {
    const theirs =
      /Costa Rica|caf[eé]\b|retreat|sociocra|\bTeal\b|\bNVC\b|Nonviolent|R-Ikigai|Hypha\.earth|Buckminster|Founding Seeder|Fireside|Land Credits|Land Share Agreement|Community Call|Prosperity Packet|Leadership Council|Advisory Council|Development Board|\bARI\b|heart.centered|three days|Every 3 months|Monthly All-Village|Children's Play Day|Infinite Game|co-become|revenue share|co-owned|fully refundable/i;
    expect(offending(WORDS, theirs)).toEqual([]);
  });

  it("invents no figure: no default carries a digit", () => {
    expect(offending(WORDS, /\d/)).toEqual([]);
  });

  it("ships no investor phase and no figure: those are the village's own", () => {
    const phases = INVESTOR_JOURNEY.sections.find((s) => s.id === "phases")!.lists![0];
    expect(phases.default).toEqual([]);
    // The tiles name the figures; their values live in Admin, Settings.
    const tiles = INVESTOR_JOURNEY.sections.find((s) => s.id === "figures")!.lists![0];
    expect(tiles.fields.map((f) => f.key)).toEqual(["title", "detail"]);
  });
});

describe("a village that saved only a little still reads coherently", () => {
  /** Every `{word}` left in a resolved page once the village's settings are filled. */
  const leftover = (spec: PageSpec, stored: unknown): string[] => {
    const page = resolvePage(spec, stored, VARS);
    const words = new Set<string>();
    const take = (v: string) => (v.match(/\{[a-z][a-z-]*\}/g) ?? []).forEach((w) => words.add(w.slice(1, -1)));
    for (const section of Object.values(page)) {
      Object.values(section.fields).forEach(take);
      for (const rows of Object.values(section.lists)) for (const row of rows) Object.entries(row).forEach(([k, v]) => k !== "id" && take(v));
    }
    return [...words].sort();
  };

  it.each(SPECS.map((spec) => [spec.id, spec] as const))("%s: every {word} left is one its page fills", (id, spec) => {
    const allowed = PAGE_WORDS[id];
    expect(allowed, `${id} needs its page words listed here`).toBeDefined();
    const sparse: Record<string, Record<string, string>> = {};
    for (const section of spec.sections) {
      const first = section.fields.find((f) => f.kind !== "link");
      if (first) sparse[section.id] = { [first.key]: "Ours" };
    }
    for (const stored of [null, sparse]) {
      for (const word of leftover(spec, stored)) expect(allowed, `${id} leaves {${word}} unfilled`).toContain(word);
    }
  });

  it("types the criteria's default name only on the two pages that follow a rename", () => {
    const follows = new Set(["good-neighbor", "co-creators-guide"]);
    const elsewhere = WORDS.filter((d) => !follows.has(d.spec.id));
    expect(offending(elsewhere, /Good Neighbor Criteria/)).toEqual([]);
  });

  it("opens a sentence with {guide}, the way the page capitalises an unnamed guide", () => {
    const withGuide = WORDS.filter((d) => d.text.includes("{guide}"));
    expect(withGuide.length).toBeGreaterThan(0);
    for (const d of withGuide) expect(d.text, d.where).toMatch(/(^|[.!?] )\{guide\}/);
  });

  it("reads a fresh village's own name wherever it says {village}", () => {
    const page = resolvePage(CO_CREATORS_GUIDE_PAGE, null, VARS);
    expect(page.hero.fields.headline).toBe("The Willowbrook Game Guide");
    expect(fillVars("{village}", VARS)).toBe("Willowbrook");
  });

  it("treats a saved empty list as none, and the empty starter lists as a real answer", () => {
    const howWeCreate = resolvePage(HOW_WE_CREATE_PAGE, null, VARS);
    expect(howWeCreate.tokens.lists.cards).toEqual([]);
    const investor = resolvePage(INVESTOR_JOURNEY, null, VARS);
    expect(investor.phases.lists.items).toEqual([]);
    const cleared = resolvePage(RIGHTS_STEWARD_PAGE, { rights: { items: [] } }, VARS);
    expect(cleared.rights.lists.items).toEqual([]);
  });
});

describe("every page a default sends a visitor to is mounted", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../../client/src/App.tsx"), "utf8");
  const routes = [
    ...new Set(ALL.map((d) => d.text.trim()).filter((t) => /^\/[a-z][a-z0-9-]*(\/[a-z0-9-]+)*$/.test(t))),
  ].sort();

  it("finds the routes it checks", () => {
    expect(routes).toContain("/good-neighbor");
    expect(routes.length).toBeGreaterThan(10);
  });

  it.each(routes)("%s is a route in App.tsx", (route) => {
    expect(app).toContain(`path="${route}"`);
  });
});
