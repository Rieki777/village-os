/**
 * The five archetypes as roots (build list 10, second amendment): the rules
 * every list, editor and route reads, pinned as behaviour.
 */
import { describe, expect, it } from "vitest";
import { ARCHETYPES, ARCHETYPE_KEYS, ARCHETYPE_NAMES_RETIRED } from "./archetypes";
import {
  CAST_LOOK,
  MAX_ROOTS_ON_WORK,
  ROOT_COVERAGE,
  castArt,
  castLookFor,
  filterByRoots,
  rootsFilterOn,
  rootsForWork,
  rootsFrom,
  rootsMatch,
  rootsOfCoverage,
  shortRootName,
} from "./archetypeRoots";

describe("the five roots, as the build list confirmed them", () => {
  it("are Builder, Architect, Space Holder, Connector + Catalyst and Storyteller, each with two names", () => {
    expect(ARCHETYPES.map((a) => shortRootName(a.name))).toEqual([
      "Builder",
      "Architect",
      "Space Holder",
      "Connector + Catalyst",
      "Storyteller",
    ]);
    for (const a of ARCHETYPES) expect(a.subtitle.length, a.key).toBeGreaterThan(0);
  });

  it("carry the confirmed one-line descriptions", () => {
    const blurb = Object.fromEntries(ARCHETYPES.map((a) => [a.key, a.blurb]));
    expect(blurb.building).toBe("Makes things real and keeps them running, on the land and beyond.");
    expect(blurb.catalyzing).toBe("Connects people, resources and opportunities, and sparks what doesn't exist yet.");
  });

  it("keep their keys: a renamed key would silently match nothing", () => {
    expect([...ARCHETYPE_KEYS]).toEqual(["building", "researching", "facilitating", "catalyzing", "storytelling"]);
  });

  it("retire only names the platform shipped, never the new ones", () => {
    expect(ARCHETYPE_NAMES_RETIRED.catalyzing).toEqual(["The Catalyst"]);
    for (const a of ARCHETYPES) expect(ARCHETYPE_NAMES_RETIRED[a.key] ?? []).not.toContain(a.name);
  });
});

describe("the cast shown together (10.6)", () => {
  const looks = ARCHETYPE_KEYS.map((k) => castLookFor(k));

  it("is three female and two male figures", () => {
    expect(looks.filter((l) => l.presentation === "f")).toHaveLength(3);
    expect(looks.filter((l) => l.presentation === "m")).toHaveLength(2);
  });

  it("is one Black, two brown and two white skin tones", () => {
    expect(looks.filter((l) => l.tone === "deep")).toHaveLength(1);
    expect(looks.filter((l) => l.tone === "olive")).toHaveLength(2);
    expect(looks.filter((l) => l.tone === "light")).toHaveLength(2);
  });

  it("names a look for every seeded root, and points at the stock file", () => {
    for (const k of ARCHETYPE_KEYS) expect(CAST_LOOK[k], k).toBeTruthy();
    expect(castArt("building")).toBe("/images/avatars/building-f-deep.webp");
    expect(castArt("a-sixth")).toBe("/images/avatars/a-sixth-f-olive.webp");
  });
});

describe("tagging work", () => {
  const CAST = [...ARCHETYPE_KEYS];

  it("takes one to three of the village's roots, in order, without duplicates", () => {
    expect(rootsForWork(["catalyzing", "researching", "catalyzing"], CAST)).toEqual({ ok: true, roots: ["catalyzing", "researching"] });
    expect(rootsForWork([], CAST)).toEqual({ ok: true, roots: [] });
  });

  it("refuses a fourth root", () => {
    const r = rootsForWork(["building", "researching", "facilitating", "catalyzing"], CAST);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(`up to ${MAX_ROOTS_ON_WORK}`);
  });

  it("refuses an unknown key by name, and anything that is not a list of words", () => {
    const r = rootsForWork(["wizard"], CAST);
    expect(!r.ok && r.error).toContain("wizard");
    expect(rootsForWork("building", CAST).ok).toBe(false);
    expect(rootsForWork([3], CAST).ok).toBe(false);
  });

  it("reads a root list from any layer without throwing", () => {
    expect(rootsFrom('["building","building"," architect "]')).toEqual(["building", "architect"]);
    expect(rootsFrom("not json")).toEqual([]);
    expect(rootsFrom(null)).toEqual([]);
    expect(rootsFrom([1, "storytelling"])).toEqual(["storytelling"]);
  });
});

describe("the coverage check", () => {
  it("names only real roots, at most three per row, and covers all five", () => {
    const seen = new Set<string>();
    for (const row of ROOT_COVERAGE) {
      expect(rootsOfCoverage(row).length, row.work).toBeLessThanOrEqual(MAX_ROOTS_ON_WORK);
      for (const r of row.roots) {
        expect(ARCHETYPE_KEYS, row.work).toContain(r.key);
        seen.add(r.key);
      }
    }
    expect([...seen].sort()).toEqual([...ARCHETYPE_KEYS].sort());
  });

  it("tags finance the way the build list does: Architect, Connector + Catalyst, Builder for the daily books", () => {
    const finance = ROOT_COVERAGE.find((r) => r.work === "Finance and accounting")!;
    expect(rootsOfCoverage(finance)).toEqual(["researching", "catalyzing", "building"]);
    expect(finance.roots[2].note).toBe("daily books");
  });
});

describe("show only what matches my roots", () => {
  const work = [
    { id: "a", roots: ["building"] },
    { id: "b", roots: ["storytelling", "catalyzing"] },
    { id: "c", roots: [] as string[] },
    { id: "d", roots: undefined },
  ];
  const of = (w: (typeof work)[number]) => w.roots;

  it("keeps work that grows from any of my roots, and untagged work, in the list's own order", () => {
    const r = filterByRoots(work, of, ["catalyzing", "building"], true);
    expect(r.shown.map((w) => w.id)).toEqual(["a", "b", "c", "d"]);
    expect(r.hidden).toBe(0);
    expect(r.tagged).toBe(true);
  });

  it("hides only work tagged with none of my roots", () => {
    const r = filterByRoots(work, of, ["building"], true);
    expect(r.shown.map((w) => w.id)).toEqual(["a", "c", "d"]);
    expect(r.hidden).toBe(1);
  });

  it("stands aside on a list nothing is tagged on yet, so a new village never reads as empty", () => {
    const bare = [{ id: "x", roots: [] as string[] }, { id: "y", roots: undefined }];
    expect(filterByRoots(bare, (w) => w.roots, ["building"], true)).toEqual({ shown: bare, hidden: 0, tagged: false });
  });

  it("shows everything when it is off, and when I have no roots", () => {
    expect(filterByRoots(work, of, ["building"], false)).toEqual({ shown: work, hidden: 0, tagged: true });
    expect(filterByRoots(work, of, [], true)).toEqual({ shown: work, hidden: 0, tagged: true });
  });

  it("is on by default once I have picked, and off once I turned it off", () => {
    expect(rootsFilterOn(["building"], false)).toBe(true);
    expect(rootsFilterOn(["building"], true)).toBe(false);
    expect(rootsFilterOn([], false)).toBe(false);
  });

  it("matches untagged work for everybody, and everything for somebody with no roots", () => {
    expect(rootsMatch([], ["building"])).toBe(true);
    expect(rootsMatch(undefined, ["building"])).toBe(true);
    expect(rootsMatch(["storytelling"], ["building"])).toBe(false);
    expect(rootsMatch(null, [])).toBe(true);
  });
});
