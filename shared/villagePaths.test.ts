/**
 * A village's words for its paths and its ladder: how a stored document is
 * read, and what a save may hold.
 *
 * THE BACK-FILL IS TESTED AGAINST OLD SHAPES, never against the default. A
 * stored document is answered whole by the store (`dbDocument.get()` merges
 * nothing), so the cases that matter are a document saved before a field
 * existed, one holding blanks, and one written around the editor. Asserting on
 * the default alone would pass whether or not the back-fill ran.
 */
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "./gameConfig";
import { pageVarsFrom } from "./pageContent/vars";
import {
  DEFAULT_LADDER_TITLE,
  LADDER_LIMITS,
  PATH_LIMITS,
  STAGE_LIMITS,
  defaultVillagePathWords,
  resolveVillagePathWords,
  servedPaths,
  servedStageWords,
  storableVillagePaths,
  villagePathsProblems,
} from "./villagePaths";

describe("the words a village that never saved reads", () => {
  it("are today's words: the platform's four paths, the join form's sentences, the ladder and its name", () => {
    const words = resolveVillagePathWords(null);
    expect(words).toEqual(defaultVillagePathWords());
    expect(Object.keys(words.paths)).toEqual(GAME_CONFIG.paths.map((p) => p.id));
    expect(Object.keys(words.stages)).toEqual(GAME_CONFIG.stages.map((s) => s.id));
    for (const p of GAME_CONFIG.paths) {
      expect(words.paths[p.id].label).toBe(p.label);
      expect(words.paths[p.id].role).toBe(p.role);
      expect(words.paths[p.id].description, p.id).not.toBe("");
    }
    for (const s of GAME_CONFIG.stages) expect(words.stages[s.id]).toEqual({ name: s.name, description: s.description });
    expect(words.ladder.title).toBe(DEFAULT_LADDER_TITLE);
    expect(DEFAULT_LADDER_TITLE).toBe("Path of Growth");
  });

  it("every default fits its own limit, so a village that never saved is never clipped", () => {
    const d = defaultVillagePathWords();
    for (const w of Object.values(d.paths)) {
      expect(w.label.length).toBeLessThanOrEqual(PATH_LIMITS.label);
      expect(w.role.length).toBeLessThanOrEqual(PATH_LIMITS.role);
      expect(w.description.length).toBeLessThanOrEqual(PATH_LIMITS.description);
    }
    for (const w of Object.values(d.stages)) {
      expect(w.name.length).toBeLessThanOrEqual(STAGE_LIMITS.name);
      expect(w.description.length).toBeLessThanOrEqual(STAGE_LIMITS.description);
    }
    expect(d.ladder.title.length).toBeLessThanOrEqual(LADDER_LIMITS.title);
  });
});

describe("a stored document, read over today's words", () => {
  it("keeps every word the village did not touch, field by field", () => {
    // An old shape: one path's name and nothing else, saved before sentences
    // or the ladder's name could be set.
    const words = resolveVillagePathWords({ paths: { steward: { label: "Keeper" } } });
    expect(words.paths.steward).toEqual({
      label: "Keeper",
      role: "Co-Creator",
      description: defaultVillagePathWords().paths.steward.description,
    });
    expect(words.paths.investor).toEqual(defaultVillagePathWords().paths.investor);
    expect(words.stages).toEqual(defaultVillagePathWords().stages);
    expect(words.ladder.title).toBe("Path of Growth");
  });

  it("reads a blank, a number or an object as today's word", () => {
    const words = resolveVillagePathWords({
      paths: { investor: { label: "   ", role: 7, description: { x: 1 } } },
      stages: { guest: { name: "" } },
      ladder: { title: "" },
    });
    expect(words.paths.investor).toEqual(defaultVillagePathWords().paths.investor);
    expect(words.stages.guest.name).toBe("Guest");
    expect(words.ladder.title).toBe("Path of Growth");
  });

  it("ignores ids this build does not know, so a stored document cannot invent a path or a stage", () => {
    const words = resolveVillagePathWords({ paths: { pirate: { label: "Pirate" } }, stages: { elder: { name: "Elder" } } });
    expect(Object.keys(words.paths)).toEqual(GAME_CONFIG.paths.map((p) => p.id));
    expect(Object.keys(words.stages)).toEqual(GAME_CONFIG.stages.map((s) => s.id));
  });

  it("clips a word written around the editor to its limit", () => {
    const words = resolveVillagePathWords({ stages: { sage: { name: "x".repeat(40) } } });
    expect(words.stages.sage.name).toBe("x".repeat(STAGE_LIMITS.name));
  });

  it("survives a document that is not an object at all", () => {
    for (const junk of [[], "paths", 3, { paths: [] }, { stages: "no" }]) {
      expect(resolveVillagePathWords(junk)).toEqual(defaultVillagePathWords());
    }
  });
});

describe("the words as pages and emails read them", () => {
  it("fills the village's {words}, and keeps the fixed id and page", () => {
    const vars = pageVarsFrom({ project: { name: "Riverbend", commitmentName: "Pact" } });
    const words = resolveVillagePathWords({ paths: { resident: { description: "Make {village} home." } } });
    const resident = servedPaths(words, vars).find((p) => p.id === "resident")!;
    expect(resident).toEqual({ id: "resident", label: "Resident", role: "Co-Creator", description: "Make Riverbend home.", route: "/resident" });
    expect(servedStageWords(words, "member", vars).description).toContain("Pact");
    expect(servedStageWords(words, "no-such-stage", vars).name).toBe("Visitor");
  });
});

describe("what a save may hold", () => {
  it("accepts a document of known ids and fields within their limits, blanks included", () => {
    expect(
      villagePathsProblems({
        paths: { investor: { label: "Backer", role: "", description: "Fund the build." } },
        stages: { member: { name: "Kin", description: "Signed the {commitment}." } },
        ladder: { title: "The Spiral" },
      }),
    ).toEqual([]);
    expect(villagePathsProblems({})).toEqual([]);
  });

  it("refuses an unknown path or stage, because ids stay fixed", () => {
    expect(villagePathsProblems({ paths: { pirate: { label: "Pirate" } } })[0]).toMatch(/no path called "pirate"/);
    expect(villagePathsProblems({ stages: { elder: { name: "Elder" } } })[0]).toMatch(/no stage called "elder"/);
  });

  it("refuses a field that does not exist, a word that is not text, and anything else at the top", () => {
    expect(villagePathsProblems({ paths: { investor: { route: "/x" } } })[0]).toMatch(/no "route"/);
    expect(villagePathsProblems({ stages: { guest: { rule: "granted" } } })[0]).toMatch(/no "rule"/);
    expect(villagePathsProblems({ paths: { investor: { label: 5 } } })[0]).toMatch(/must be text/);
    expect(villagePathsProblems({ order: ["guest"] })[0]).toMatch(/no "order"/);
    expect(villagePathsProblems([])).toHaveLength(1);
    expect(villagePathsProblems({ paths: [] })).toHaveLength(1);
  });

  it("refuses a word over its limit, and says how long it may be", () => {
    const long = "y".repeat(PATH_LIMITS.label + 1);
    const [problem] = villagePathsProblems({ paths: { steward: { label: long } } });
    expect(problem).toBe(`The Village Steward path's name can be up to ${PATH_LIMITS.label} characters, and has ${PATH_LIMITS.label + 1}.`);
    expect(villagePathsProblems({ ladder: { title: "z".repeat(LADDER_LIMITS.title + 1) } })).toHaveLength(1);
    expect(villagePathsProblems({ stages: { sage: { description: "d".repeat(STAGE_LIMITS.description + 1) } } })).toHaveLength(1);
  });

  it("stores only what was typed: trimmed, blanks dropped, empty groups gone", () => {
    expect(
      storableVillagePaths({
        paths: { investor: { label: "  Backer ", role: "" }, steward: { label: " " } },
        stages: { guest: { name: "" } },
        ladder: { title: "  " },
      }),
    ).toEqual({ paths: { investor: { label: "Backer" } } });
  });
});
