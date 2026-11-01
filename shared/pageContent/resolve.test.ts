import { describe, expect, it } from "vitest";
import { HOME_PAGE } from "./home";
import { MASTER_PLAN_PAGE } from "./masterPlan";
import { pageContentProblem, PAGE_SPECS } from "./index";
import {
  adoptedDocument,
  charCount,
  fillVars,
  markerDocument,
  pageDocumentProblems,
  resolvePage,
  resolvePageRaw,
} from "./resolve";

const vars = { village: "Willowbrook", tagline: "Roots and rivers", "in-location": " in the hills" };

/** A Home field's default, as the spec holds it: the words are the spec's to choose, the behaviour is this file's. */
const homeDefault = (sectionId: string, key: string) =>
  HOME_PAGE.sections.find((s) => s.id === sectionId)!.fields.find((f) => f.key === key)!.default;
const homeList = (sectionId: string, key: string) =>
  HOME_PAGE.sections.find((s) => s.id === sectionId)!.lists!.find((l) => l.key === key)!.default;

describe("resolving a page", () => {
  it("falls back to every default when the village has saved nothing", () => {
    const page = resolvePage(HOME_PAGE, null, vars);
    expect(page.hero.fields.headline).toBe("Roots and rivers");
    // `{in-location}` is filled where the default puts it.
    expect(homeDefault("hero", "subline")).toContain("{in-location}");
    expect(page.hero.fields.subline).toBe(fillVars(homeDefault("hero", "subline"), vars));
    expect(page.hero.fields.subline).toContain(" in the hills");
    expect(page.personas.fields.heading).toBe(fillVars(homeDefault("personas", "heading"), vars));
    expect(page.journey.lists.stages).toHaveLength(homeList("journey", "stages").length);
    expect(page.paths.lists.cards.map((c) => c.id)).toEqual(["investor", "steward", "resident", "prosperity"]);
  });

  it("takes a saved field and back-fills the rest field by field", () => {
    const page = resolvePage(HOME_PAGE, { hero: { headline: "Ours now" } }, vars);
    expect(page.hero.fields.headline).toBe("Ours now");
    expect(page.hero.fields.highlight).toBe(fillVars(homeDefault("hero", "highlight"), vars));
    expect(page.cta.fields.heading).toBe(homeDefault("cta", "heading"));
  });

  it("lets an optional field be blanked, and refuses a blank for a required one", () => {
    const page = resolvePage(HOME_PAGE, { hero: { highlight: "", headline: "  " } }, vars);
    expect(page.hero.fields.highlight).toBe("");
    expect(page.hero.fields.headline).toBe("Roots and rivers");
  });

  it("treats a saved empty free list as none, never as the defaults", () => {
    const page = resolvePage(HOME_PAGE, { personas: { items: [] } }, vars);
    expect(page.personas.lists.items).toEqual([]);
  });

  it("merges a fixed list row by row, keeping its order and defaults", () => {
    const page = resolvePage(HOME_PAGE, { paths: { cards: [{ id: "resident", title: "Neighbour" }] } }, vars);
    const cards = page.paths.lists.cards;
    expect(cards.map((c) => c.id)).toEqual(["investor", "steward", "resident", "prosperity"]);
    expect(cards[2].title).toBe("Neighbour");
    expect(cards[2].description).toBe(fillVars(homeList("paths", "cards")[2].description, vars));
    expect(cards[0].title).toBe(homeList("paths", "cards")[0].title);
  });

  it("hides only a hideable section", () => {
    const page = resolvePage(HOME_PAGE, { personas: { hidden: true }, hero: { hidden: true } }, vars);
    expect(page.personas.hidden).toBe(true);
    expect(page.hero.hidden).toBe(false);
  });

  it("leaves a {word} it has no value for visible, so the founder can see what to set", () => {
    expect(fillVars("Join as a {member}", {})).toBe("Join as a {member}");
    expect(fillVars("{village} and {village}", { village: "A" })).toBe("A and A");
  });
});

describe("keeping the words on the page", () => {
  it("writes every field out with {words} kept, so a later default change moves nothing", () => {
    const doc = adoptedDocument(HOME_PAGE, { hero: { headline: "Ours now" } }) as Record<string, Record<string, unknown>>;
    expect(doc.hero.headline).toBe("Ours now");
    expect(doc.personas.heading).toBe(homeDefault("personas", "heading"));
    expect((doc.journey.stages as unknown[]).length).toBe(homeList("journey", "stages").length);
    expect(pageDocumentProblems(HOME_PAGE, doc)).toEqual([]);
    // The page reads exactly as it did before the words were kept.
    expect(resolvePageRaw(HOME_PAGE, doc)).toEqual(resolvePageRaw(HOME_PAGE, { hero: { headline: "Ours now" } }));
  });
});

describe("validating a saved page", () => {
  it("accepts every spec's own defaults and its marker document", () => {
    for (const spec of PAGE_SPECS) {
      expect(pageDocumentProblems(spec, adoptedDocument(spec, null))).toEqual([]);
      expect(pageDocumentProblems(spec, markerDocument(spec))).toEqual([]);
    }
  });

  it("refuses text longer than its limit, counting characters the way a person does", () => {
    const max = HOME_PAGE.sections[0].fields.find((f) => f.key === "headline")!.max;
    expect(pageDocumentProblems(HOME_PAGE, { hero: { headline: "x".repeat(max) } })).toEqual([]);
    const problems = pageDocumentProblems(HOME_PAGE, { hero: { headline: "x".repeat(max + 1) } });
    expect(problems).toEqual([`hero.headline is ${max + 1} characters; the most it holds is ${max}.`]);
    expect(charCount("🌱🌱")).toBe(2);
  });

  it("refuses a key nothing renders", () => {
    expect(pageDocumentProblems(HOME_PAGE, { hero: { tagline: "x" } })).toEqual([
      "hero.tagline is not a field of Top of the page.",
    ]);
    expect(pageDocumentProblems(HOME_PAGE, { footer: {} })).toEqual(['"footer" is not a section of Home.']);
  });

  it("refuses too many rows, unknown fixed ids and repeated ones", () => {
    const tooMany = Array.from({ length: 10 }, () => ({ label: "a" }));
    expect(pageDocumentProblems(HOME_PAGE, { personas: { items: tooMany } })[0]).toMatch(/has 10 rows; the most it holds is 9/);
    expect(pageDocumentProblems(HOME_PAGE, { paths: { cards: [{ id: "elder" }] } })[0]).toMatch(/is not one of/);
    expect(pageDocumentProblems(HOME_PAGE, { paths: { cards: [{ id: "investor" }, { id: "investor" }] } })[0]).toMatch(/appears twice/);
  });

  it("refuses a link into the investor vault, however it is spelled, and keeps every other link", () => {
    const pdf = (pdfUrl: string) => pageDocumentProblems(MASTER_PLAN_PAGE, { valuation: { pdfUrl } });
    for (const leak of ["/api/uploads/cap-table.pdf", "/api/./uploads/cap-table.pdf", "https://elsewhere.example/api/uploads/x.pdf"]) {
      expect(pdf(leak)[0], leak).toMatch(/investor vault/);
    }
    for (const fine of ["", "/uploads/master-plan.pdf", "https://example.org/plan.pdf", "/visit"]) expect(pdf(fine), fine).toEqual([]);
    expect(pdf("javascript:alert(1)")[0]).toMatch(/must start with/);
  });

  it("refuses hiding a section that cannot be hidden", () => {
    expect(pageDocumentProblems(HOME_PAGE, { hero: { hidden: true } })).toEqual(["Top of the page cannot be hidden."]);
  });
});

describe("the save route's check", () => {
  it("passes sections that are not pages through untouched", () => {
    expect(pageContentProblem("legal", { anything: 1 })).toBeNull();
  });

  it("refuses a page nobody has specified", () => {
    expect(pageContentProblem("page-nowhere", {})).toBe('There is no page called "nowhere".');
  });

  it("refuses an over-long Home headline and accepts a fitting one", () => {
    expect(pageContentProblem("page-home", { hero: { headline: "Short" } })).toBeNull();
    expect(pageContentProblem("page-home", { hero: { headline: "x".repeat(200) } })).toMatch(/the most it holds is/);
  });
});

describe("every spec is well formed", () => {
  it("has unique ids, positive limits, and defaults that fit their own limits", () => {
    const ids = new Set<string>();
    for (const spec of PAGE_SPECS) {
      expect(ids.has(spec.id)).toBe(false);
      ids.add(spec.id);
      for (const section of spec.sections) {
        const keys = [...section.fields.map((f) => f.key), ...(section.lists ?? []).map((l) => l.key)];
        expect(new Set(keys).size).toBe(keys.length);
        for (const field of section.fields) {
          expect(field.max).toBeGreaterThan(0);
          expect(charCount(field.default)).toBeLessThanOrEqual(field.max);
        }
        for (const list of section.lists ?? []) {
          if (list.fixed) expect(list.default).toHaveLength(list.fixed.length);
          else expect(list.default.length).toBeLessThanOrEqual(list.maxItems);
          for (const row of list.default) {
            for (const field of list.fields) expect(charCount(row[field.key] ?? "")).toBeLessThanOrEqual(field.max);
          }
        }
      }
    }
  });
});
