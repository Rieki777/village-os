/**
 * How We Govern, step 2: the boot fixup that keeps an established village's
 * wording when the platform's defaults go neutral (server/lib/governanceWordsKept.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { GOVERNANCE_PAGE } from "../../shared/pageContent/governance";
import { contentVersion, pageDocumentProblems, resolvePageRaw } from "../../shared/pageContent/resolve";
import { GOVERNANCE_WORDS_BEFORE_NEUTRAL, keepGovernanceWords, keptGovernanceSection } from "./governanceWordsKept";

type Doc = Record<string, any>;
const KEY = "page-governance";
const BEFORE = GOVERNANCE_WORDS_BEFORE_NEUTRAL as Doc;

function repoOf(content: Doc | null) {
  let doc = content;
  const put = vi.fn(async (next: Doc) => {
    doc = next;
  });
  return { get: () => doc, put, now: () => doc };
}

describe("the words How We Govern showed before its defaults went neutral", () => {
  it("are a document the Pages editor can save again (no unknown box, no box over its limit)", () => {
    expect(pageDocumentProblems(GOVERNANCE_PAGE, BEFORE)).toEqual([]);
  });

  it("differ from today's defaults, which is the whole reason to keep them", () => {
    const neutral = resolvePageRaw(GOVERNANCE_PAGE, {});
    expect(neutral.hero.fields.headline).not.toBe(BEFORE.hero.headline);
  });
});

describe("keepGovernanceWords", () => {
  it("writes the old wording for a village that already made its page words its own", async () => {
    const repo = repoOf({ "page-home": { hero: { headline: "{tagline}" } }, team: [] });
    expect(await keepGovernanceWords(repo)).toBe(true);
    const kept = repo.now()![KEY];
    expect(resolvePageRaw(GOVERNANCE_PAGE, kept).hero.fields.headline).toBe(BEFORE.hero.headline);
    expect(repo.now()!["page-home"], "every other section is left as it was").toEqual({ hero: { headline: "{tagline}" } });
  });

  it("CONTROL: never writes over a box the village saved itself, and fills only the boxes it left alone", async () => {
    const own = { hero: { headline: "Our own way of deciding" }, cta: { hidden: true } };
    const repo = repoOf({ [KEY]: own });
    expect(await keepGovernanceWords(repo)).toBe(true);
    const kept = repo.now()![KEY];
    expect(kept.hero.headline).toBe("Our own way of deciding");
    expect(kept.hero.intro, "a box it never saved keeps reading what it read").toBe(BEFORE.hero.intro);
    expect(kept.cta.hidden, "a hidden section stays hidden").toBe(true);
  });

  it("leaves a list the village wrote as its own list", async () => {
    const items = [{ title: "Ours", body: "One principle, ours." }];
    const repo = repoOf({ "page-home": {}, [KEY]: { principles: { items } } });
    await keepGovernanceWords(repo);
    expect(repo.now()![KEY].principles.items).toEqual(items);
  });

  it("writes nothing for a new village, which gets the neutral starter page", async () => {
    const repo = repoOf({ investor: {}, steward: {}, resident: {}, prosperity: {} });
    expect(await keepGovernanceWords(repo)).toBe(false);
    expect(repo.put).not.toHaveBeenCalled();
    expect(repoOf(null).get()).toBeNull();
    expect(await keepGovernanceWords(repoOf(null))).toBe(false);
  });

  it("changes nothing on a second run", async () => {
    const repo = repoOf({ "page-home": {} });
    await keepGovernanceWords(repo);
    const once = JSON.stringify(repo.now());
    expect(await keepGovernanceWords(repo)).toBe(false);
    expect(JSON.stringify(repo.now())).toBe(once);
    expect(repo.put).toHaveBeenCalledTimes(1);
  });

  it("is the same answer as the pure function", () => {
    expect(keptGovernanceSection({})).toBeNull();
    expect(keptGovernanceSection({ "page-visit": {} })).toEqual(BEFORE);
  });
});

describe("a save opened before the fixup ran (the village mid-edit)", () => {
  it("names different words than the ones now stored, so the route refuses it", () => {
    const openedOn = contentVersion(undefined);
    const nowStored = keptGovernanceSection({ "page-home": {} });
    expect(contentVersion({})).toBe(openedOn);
    expect(contentVersion(nowStored)).not.toBe(openedOn);
  });
});
