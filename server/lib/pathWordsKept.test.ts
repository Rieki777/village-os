/**
 * The ladder's defaults went neutral (readiness R061): the boot fixup that keeps
 * an established village's path and stage words (server/lib/pathWordsKept.ts).
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { GAME_CONFIG } from "../../shared/gameConfig";
import {
  defaultVillagePathWords,
  resolveVillagePathWords,
  storableVillagePaths,
  VILLAGE_PATHS_DOCUMENT,
  villagePathsProblems,
} from "../../shared/villagePaths";
import { holdsOwnPageWords, keepVillagePathWords, keptVillagePaths, PATH_WORDS_BEFORE_NEUTRAL } from "./pathWordsKept";
import { loadVillagePaths, villagePathWords } from "./villagePaths";
import { servedLadder } from "./progressionPayload";

type Doc = Record<string, any>;
const BEFORE = PATH_WORDS_BEFORE_NEUTRAL as Doc;
/** The four rungs whose sentences named one village's practice. */
const NEUTRALISED = ["initiate", "co-creator", "guide", "sage"];

function stores(content: Doc | null, paths: Doc | null) {
  let doc = paths;
  const put = vi.fn(async (next: Doc) => {
    doc = next;
  });
  return { content: { get: () => content }, paths: { get: () => doc, put }, now: () => doc };
}

describe("the path and stage words a village read before the ladder went neutral", () => {
  it("are a document Admin, Paths & Stages accepts and stores as it is", () => {
    expect(villagePathsProblems(BEFORE)).toEqual([]);
    expect(storableVillagePaths(BEFORE)).toEqual(BEFORE);
  });

  it("differ from today's defaults on the four rungs that named one village's practice, and nowhere else", () => {
    const today = defaultVillagePathWords();
    for (const id of NEUTRALISED) expect(today.stages[id].description, id).not.toBe(BEFORE.stages[id].description);
    expect(BEFORE.stages.initiate.description).toBe("Walking the Co-Creator Right of Passage.");
    const rest = { ...today, stages: Object.fromEntries(Object.entries(today.stages).filter(([id]) => !NEUTRALISED.includes(id))) };
    const restBefore = { ...BEFORE, stages: Object.fromEntries(Object.entries(BEFORE.stages).filter(([id]) => !NEUTRALISED.includes(id))) };
    expect(rest).toEqual(restBefore);
  });

  it("are today's neutral words a new village reads, true of any village", () => {
    const today = defaultVillagePathWords();
    for (const id of NEUTRALISED) expect(today.stages[id].description, id).not.toMatch(/Passage|circle|Seven|Twenty-one/);
    expect(GAME_CONFIG.stages.find((s) => s.id === "contributor")?.description, "Contributor states its unlock rule (Rye, 2026-09-08)").toBe(
      "The village has paid you for what you brought it.",
    );
  });
});

describe("who keeps the old words", () => {
  it("a village holding any page-* section of its own is established", () => {
    expect(holdsOwnPageWords({ "page-home": {} })).toBe(true);
    expect(holdsOwnPageWords({ investor: {}, team: [], covenant: {} })).toBe(false);
    expect(holdsOwnPageWords(null)).toBe(false);
  });
});

describe("keepVillagePathWords", () => {
  it("writes today's path and stage words for a village that already made its page words its own", async () => {
    const s = stores({ "page-home": { hero: { headline: "{tagline}" } } }, {});
    expect(await keepVillagePathWords(s.content, s.paths)).toBe(true);
    const words = resolveVillagePathWords(s.now());
    for (const id of NEUTRALISED) expect(words.stages[id].description, id).toBe(BEFORE.stages[id].description);
    expect(words.ladder.title).toBe(BEFORE.ladder.title);
    expect(words.paths.resident.description).toBe(BEFORE.paths.resident.description);
  });

  it("CONTROL: never writes over a word the village saved, and fills only what it left alone", async () => {
    const own = { stages: { initiate: { name: "Apprentice", description: "Our own rite." } }, paths: { investor: { label: "Backer" } } };
    const s = stores({ "page-visit": {} }, own);
    expect(await keepVillagePathWords(s.content, s.paths)).toBe(true);
    const kept = s.now()!;
    expect(kept.stages.initiate).toEqual({ name: "Apprentice", description: "Our own rite." });
    expect(kept.paths.investor.label).toBe("Backer");
    expect(kept.paths.investor.role, "a word it never saved keeps reading what it read").toBe(BEFORE.paths.investor.role);
    expect(kept.stages.guide.description).toBe(BEFORE.stages.guide.description);
  });

  it("keeps the old words for a village that saved some of its paths and stages but no page words", async () => {
    const s = stores({}, { ladder: { title: "The Spiral" } });
    expect(await keepVillagePathWords(s.content, s.paths)).toBe(true);
    expect(s.now()!.ladder.title).toBe("The Spiral");
    expect(s.now()!.stages["co-creator"].description).toBe(BEFORE.stages["co-creator"].description);
  });

  it("fills a stored word nothing reads (blank, or not text), the way the reader already ignores it", async () => {
    const s = stores({ "page-home": {} }, { stages: { sage: { name: "Elder", description: "   " }, guide: { description: 7 } } });
    await keepVillagePathWords(s.content, s.paths);
    expect(s.now()!.stages.sage).toEqual({ name: "Elder", description: BEFORE.stages.sage.description });
    expect(s.now()!.stages.guide.description).toBe(BEFORE.stages.guide.description);
  });

  it("writes nothing for a new village, which reads the neutral ladder", async () => {
    for (const content of [null, {}, { investor: {}, steward: {}, team: [] }]) {
      const s = stores(content, null);
      expect(await keepVillagePathWords(s.content, s.paths)).toBe(false);
      expect(s.paths.put).not.toHaveBeenCalled();
    }
    expect(keptVillagePaths({}, {})).toBeNull();
  });

  it("changes nothing on a second run", async () => {
    const s = stores({ "page-home": {} }, null);
    await keepVillagePathWords(s.content, s.paths);
    const once = JSON.stringify(s.now());
    expect(await keepVillagePathWords(s.content, s.paths)).toBe(false);
    expect(JSON.stringify(s.now())).toBe(once);
    expect(s.paths.put).toHaveBeenCalledTimes(1);
  });
});

describe("at boot, through the cache every reader answers from", () => {
  it("an established village's ladder still reads today's sentences after the fixup, with no admin step", async () => {
    let row: unknown = null;
    const pool = {
      query: async (sql: string, args: unknown[] = []) => {
        if (/^\s*SELECT/i.test(sql)) {
          expect(args[0]).toBe(VILLAGE_PATHS_DOCUMENT);
          return [row === null ? [] : [{ value: JSON.stringify(row) }]];
        }
        row = JSON.parse(String(args[1]));
        return [{ affectedRows: 1 }];
      },
    } as unknown as Pool;
    await loadVillagePaths(pool);
    expect(villagePathWords().stages.initiate.description, "the neutral default before the fixup").not.toBe(BEFORE.stages.initiate.description);
    expect(await keepVillagePathWords({ get: () => ({ "page-home": {} }) })).toBe(true);
    expect(villagePathWords().stages.initiate.description).toBe(BEFORE.stages.initiate.description);
    expect(servedLadder("Pact").find((s) => s.id === "guide")?.description).toBe(BEFORE.stages.guide.description);
    expect(row, "written under the village's own document").toEqual(BEFORE);
  });
});
