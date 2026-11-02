/**
 * THE LADDER'S DEFAULT SENTENCES WENT NEUTRAL, AND AN ESTABLISHED VILLAGE KEEPS
 * ITS PATH AND STAGE WORDS, WITH NO SAVE FOR ANYONE TO REMEMBER (R061, 2026-11-01).
 *
 * Four rungs of the platform's ladder described one village: its rite of
 * passage, its circle, and its year counts for a guide and a sage. Every other
 * village read those as its own. The defaults in shared/gameConfig.ts are now
 * true of any village. The order rule is How We Govern's (#732): a default a
 * village still inherits must not move under it, and the save that keeps it is
 * done here, once, at boot (`keep-path-words-2026-11-01`).
 *
 * WHO KEEPS THE OLD WORDS. A village that already made its page words its own
 * (any `page-*` section stored) is an established village. So is one that
 * already saved some of its path and stage words. Each keeps every word it
 * shows today. A village with neither, which is every new one, reads the
 * neutral ladder.
 *
 * NEVER OVER A VILLAGE'S OWN WORD. Every word a village saved in Admin, Paths &
 * Stages stays exactly as saved. Only the words it never saved are filled, from
 * server/seeds/village-paths-before-neutral.json: `defaultVillagePathWords()`
 * as it answered before this change, `{words}` kept as words. A stored value
 * the reader already ignores (blank, or not text) counts as never saved.
 *
 * WHY NOT THE PAGE FIXUP ITSELF. The rule is the same; the document is not.
 * The page fixup fills a `page-*` section of the `content` document one section
 * at a time. These words live in their own `app_config` document,
 * `village-paths`, three levels deep (`paths.<id>.<field>`), so the fill here
 * walks that shape. `holdsOwnPageWords` is the shared question, asked the same
 * way governanceWordsKept.ts asks it.
 */
import BEFORE_NEUTRAL from "../seeds/village-paths-before-neutral.json";
import { saveVillagePaths, storedVillagePaths } from "./villagePaths";
import type { VillagePathsDocument } from "../../shared/villagePaths";

type Doc = Record<string, unknown>;

export const PATH_WORDS_BEFORE_NEUTRAL: Doc = BEFORE_NEUTRAL as Doc;

const isDoc = (v: unknown): v is Doc => !!v && typeof v === "object" && !Array.isArray(v);
const isWord = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** True when this village stored any page's words as its own: an established village. */
export function holdsOwnPageWords(content: Doc | null | undefined): boolean {
  const all = isDoc(content) ? content : {};
  return Object.keys(all).some((k) => k.startsWith("page-") && all[k] !== undefined);
}

/** `before`, with every word `mine` already holds kept as it is, and anything else `mine` holds kept too. */
function fill(before: Doc, mine: unknown): Doc {
  const own = isDoc(mine) ? mine : {};
  const out: Doc = {};
  for (const [key, old] of Object.entries(before)) {
    const v = own[key];
    out[key] = isDoc(old) ? fill(old, v) : isWord(v) ? v : old;
  }
  for (const [key, v] of Object.entries(own)) if (!(key in out)) out[key] = v;
  return out;
}

/**
 * The `village-paths` document this village should hold, or null when it needs
 * nothing written. Pure: the same content and stored words in, the same answer out.
 */
export function keptVillagePaths(content: Doc | null | undefined, stored: unknown): Doc | null {
  const savedSome = isDoc(stored) && Object.keys(stored).length > 0;
  if (!savedSome && !holdsOwnPageWords(content)) return null;
  const out = fill(PATH_WORDS_BEFORE_NEUTRAL, stored);
  return JSON.stringify(out) === JSON.stringify(stored) ? null : out;
}

/** The village's own path and stage words, as this fixup reads and writes them. */
export interface PathWordsStore {
  get(): Doc | null;
  put(doc: Doc): Promise<unknown>;
}

/** The cache every reader answers from (server/lib/villagePaths.ts), loaded at boot. */
const villagePathsStore: PathWordsStore = {
  get: () => storedVillagePaths(),
  put: (doc) => saveVillagePaths(doc as VillagePathsDocument),
};

/** The boot fixup: writes the kept words once, and reports whether it wrote. */
export async function keepVillagePathWords(
  content: { get(): Doc | null },
  paths: PathWordsStore = villagePathsStore,
): Promise<boolean> {
  const stored = paths.get() ?? {};
  const kept = keptVillagePaths(content.get(), stored);
  if (!kept) return false;
  await paths.put(kept);
  return true;
}
