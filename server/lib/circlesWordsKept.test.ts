/**
 * Circles, step 2: the boot fixup that keeps an established village's wording
 * when the page's defaults go neutral (server/lib/circlesWordsKept.ts, on the
 * rule in server/lib/pageWordsKept.ts that How We Govern uses too).
 */
import { describe, expect, it, vi } from "vitest";
import { CIRCLES_PAGE } from "../../shared/pageContent/circles";
import { contentVersion, pageDocumentProblems, resolvePageRaw } from "../../shared/pageContent/resolve";
import { CIRCLES_WORDS_BEFORE_NEUTRAL, keepCirclesWords, keptCirclesSection } from "./circlesWordsKept";
import { keepGovernanceWords } from "./governanceWordsKept";

type Doc = Record<string, any>;
const KEY = "page-circles";
const BEFORE = CIRCLES_WORDS_BEFORE_NEUTRAL as Doc;
/** What a fresh deployment's content document holds after its first boot (server/seeds/content-seed.json). */
const NEW_VILLAGE = { investor: {}, steward: {}, resident: {}, prosperity: {} };

function repoOf(content: Doc | null) {
  let doc = content;
  const put = vi.fn(async (next: Doc) => {
    doc = next;
  });
  return { get: () => doc, put, now: () => doc };
}

describe("the words Circles showed before its defaults went neutral", () => {
  it("are a document the Pages editor can save again (no unknown box, no box over its limit)", () => {
    expect(pageDocumentProblems(CIRCLES_PAGE, BEFORE)).toEqual([]);
  });

  it("hold every box the page has, so nothing an established village reads falls back to a neutral default", () => {
    for (const section of CIRCLES_PAGE.sections) {
      for (const field of section.fields) expect(typeof BEFORE[section.id]?.[field.key], `${section.id}.${field.key}`).toBe("string");
    }
  });

  it("differ from today's defaults, which is the whole reason to keep them", () => {
    const neutral = resolvePageRaw(CIRCLES_PAGE, {});
    expect(neutral.hero.fields.headline).not.toBe(BEFORE.hero.headline);
    expect(neutral.together.fields.after).not.toBe(BEFORE.together.after);
    expect(neutral.together.fields.acrossLinked).not.toBe(BEFORE.together.acrossLinked);
  });

  it("are the words the page typed until 2026-11-01", () => {
    expect(BEFORE.hero.headline).toBe("Our Sociocratic Circles");
    expect(BEFORE.together.acrossLinked).toContain("the four leads and circle representatives");
    expect(BEFORE.together.after).toBe("The Finance & Business Circle provides budget stewardship, oversight, and alignment across all circles.");
  });
});

describe("keepCirclesWords", () => {
  it("writes the old wording for a village that already made its page words its own", async () => {
    const repo = repoOf({ "page-home": { hero: { headline: "{tagline}" } }, team: [] });
    expect(await keepCirclesWords(repo)).toBe(true);
    const kept = resolvePageRaw(CIRCLES_PAGE, repo.now()![KEY]);
    expect(kept.hero.fields.headline).toBe("Our Sociocratic Circles");
    expect(kept.together.fields.after).toBe(BEFORE.together.after);
    expect(kept.card.fields.linked).toBe(BEFORE.card.linked);
    expect(repo.now()!["page-home"], "every other section is left as it was").toEqual({ hero: { headline: "{tagline}" } });
    expect(repo.now()!.team).toEqual([]);
  });

  it("CONTROL: never writes over a box the village saved itself, and fills only the boxes it left alone", async () => {
    const own = { hero: { headline: "The Circles of the Farm" }, together: { after: "" }, closing: { hidden: true } };
    const repo = repoOf({ "page-visit": {}, [KEY]: own });
    expect(await keepCirclesWords(repo)).toBe(true);
    const kept = repo.now()![KEY];
    expect(kept.hero.headline).toBe("The Circles of the Farm");
    expect(kept.together.after, "a box it saved blank stays blank: blank is its answer").toBe("");
    expect(kept.hero.intro, "a box it never saved keeps reading what it read").toBe(BEFORE.hero.intro);
    expect(kept.together.second, "and so does every other box it left alone").toBe(BEFORE.together.second);
    expect(kept.closing.hidden, "a hidden section stays hidden").toBe(true);
    expect(kept.closing.label).toBe(BEFORE.closing.label);
  });

  it("keeps a part of this page a village saved before it saved any other page", async () => {
    const repo = repoOf({ [KEY]: { today: { heading: "Our Working Circles" } } });
    expect(await keepCirclesWords(repo)).toBe(true);
    expect(repo.now()![KEY].today.heading).toBe("Our Working Circles");
    expect(repo.now()![KEY].hero.headline).toBe(BEFORE.hero.headline);
  });

  it("writes nothing for a new village, which gets the neutral starter page", async () => {
    const repo = repoOf(NEW_VILLAGE);
    expect(await keepCirclesWords(repo)).toBe(false);
    expect(repo.put).not.toHaveBeenCalled();
    expect(await keepCirclesWords(repoOf(null))).toBe(false);
    expect(await keepCirclesWords(repoOf({}))).toBe(false);
  });

  it("changes nothing on a second run", async () => {
    const repo = repoOf({ "page-home": {} });
    await keepCirclesWords(repo);
    const once = JSON.stringify(repo.now());
    expect(await keepCirclesWords(repo)).toBe(false);
    expect(JSON.stringify(repo.now())).toBe(once);
    expect(repo.put).toHaveBeenCalledTimes(1);
  });

  it("is the same answer as the pure function", () => {
    expect(keptCirclesSection({})).toBeNull();
    expect(keptCirclesSection(NEW_VILLAGE)).toBeNull();
    expect(keptCirclesSection({ "page-governance": {} })).toEqual(BEFORE);
  });
});

describe("the two boot fixups, in the order server/index.ts runs them", () => {
  it("give an established village both pages' old words", async () => {
    const repo = repoOf({ "page-home": {} });
    await keepGovernanceWords(repo);
    await keepCirclesWords(repo);
    expect(Object.keys(repo.now()!).sort()).toEqual(["page-circles", "page-governance", "page-home"]);
    expect(repo.now()![KEY]).toEqual(BEFORE);
  });

  it("give a new village neither: the first never makes it look established to the second", async () => {
    const repo = repoOf({ ...NEW_VILLAGE });
    await keepGovernanceWords(repo);
    await keepCirclesWords(repo);
    expect(repo.put).not.toHaveBeenCalled();
    expect(repo.now()).toEqual(NEW_VILLAGE);
  });
});

describe("a save opened before the fixup ran (the village mid-edit)", () => {
  it("names different words than the ones now stored, so the route refuses it", () => {
    const openedOn = contentVersion(undefined);
    const nowStored = keptCirclesSection({ "page-home": {} });
    expect(contentVersion({})).toBe(openedOn);
    expect(contentVersion(nowStored)).not.toBe(openedOn);
  });
});
