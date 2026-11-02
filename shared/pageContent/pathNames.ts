/**
 * ONE SET OF PATH NAMES (the coordinator's ruling under Rye's "obvious answer"
 * rule, 2026-11-01).
 *
 * A village names its four paths in Admin, Paths & Stages (shared/villagePaths.ts).
 * The menu, the footer, Home's path cards and the membership letter's path
 * choices each carried their own copy of the platform's four names as page
 * defaults, so a rename reached the join form and the emails and nothing a
 * visitor reads first. Now each of those boxes shows the village's path words,
 * until the village writes its own words in that box.
 *
 * WHAT COUNTS AS THE VILLAGE'S OWN WORDS. A box whose stored text differs from
 * the platform's word for that box. A box still holding the platform's word
 * follows the path. Two things put the platform's word into a village's store
 * without anybody choosing it: the Pages editor writes a whole list when one
 * row of it changes, and the first village's page words were copied whole
 * (Phase B). Counting those as choices would freeze the path names for any
 * village that ever touched its menu. The footer already read the menu this
 * way ("The footer uses a name once you change it here").
 *
 * HOW A PATH'S WORDS FILL A BOX. The box's platform word, with the platform's
 * path name and second line in it swapped for the village's. So a box that is
 * the name ("Investor") becomes the village's name, and a box that says more
 * than the path ("Resident / Future Villager") keeps the rest of its words
 * ("Neighbour / Future Villager"). A village that never renamed a path reads
 * every box exactly as before, character for character.
 *
 * The path words come in as `/api/game/config` serves them (`servedPaths`),
 * `{words}` already filled; the path boxes' platform words carry none, which a
 * test holds. A switched-off journey page is the caller's business: the menu,
 * the footer and Home leave its row out whatever it is called.
 */
import { GAME_CONFIG } from "../gameConfig";
import { resolvePageRaw } from "./resolve";
import type { PageSpec, ResolvedItem, ResolvedPage } from "./types";

/** A path's words as a page box shows them. */
export interface PathWordsShown {
  id: string;
  label: string;
  role: string;
}

/** Where a page names the paths: a fixed list whose rows are the journey pages, and the boxes that carry a path's words. */
export interface PathNameSpot {
  section: string;
  list: string;
  boxes: readonly string[];
}

/** Keyed by page spec id: the site menu (and through it the footer), Home's cards, the letter's choices. */
export const PATH_NAME_SPOTS: Readonly<Record<string, PathNameSpot>> = {
  site: { section: "menu", list: "pages", boxes: ["label", "subtitle"] },
  home: { section: "paths", list: "cards", boxes: ["title", "subtitle"] },
  "love-letter": { section: "form", list: "paths", boxes: ["label"] },
};

/** The path a page row names, by its journey page (`/investor` or `investor`), or null. */
export function pathOfPageRow(rowId: string): string | null {
  const page = `/${rowId.replace(/^\//, "")}`;
  return GAME_CONFIG.paths.find((p) => p.route === page)?.id ?? null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` with the platform's path name and second line swapped for the village's, in one pass. */
function swapWords(text: string, platform: { label: string; role: string }, village: PathWordsShown): string {
  const swaps = new Map<string, string>([
    [platform.role, village.role],
    [platform.label, village.label],
  ]);
  const words = [...swaps.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!words.length) return text;
  return text.replace(new RegExp(words.map(escape).join("|"), "g"), (w) => swaps.get(w) ?? w);
}

/**
 * The resolved page with every path box the village left as the platform's
 * word showing the village's path words instead. `stored` is the page's
 * stored section, the one `page` was resolved from. A page with no path spot,
 * or no path words to show, comes back as it went in.
 */
export function withPathNames(
  spec: PageSpec,
  stored: unknown,
  page: ResolvedPage,
  paths: readonly PathWordsShown[] | null | undefined,
): ResolvedPage {
  const spot = PATH_NAME_SPOTS[spec.id];
  const section = spot ? page[spot.section] : undefined;
  if (!spot || !section || !paths?.length) return page;
  const raw = resolvePageRaw(spec, stored)[spot.section]?.lists[spot.list] ?? [];
  const base = resolvePageRaw(spec, null)[spot.section]?.lists[spot.list] ?? [];
  const rows = (section.lists[spot.list] ?? []).map((row): ResolvedItem => {
    const pathId = pathOfPageRow(row.id ?? "");
    const platform = GAME_CONFIG.paths.find((p) => p.id === pathId);
    const village = paths.find((p) => p.id === pathId);
    const own = raw.find((r) => r.id === row.id);
    const theirs = base.find((r) => r.id === row.id);
    if (!platform || !village || !own || !theirs) return row;
    const next: Record<string, string> = { ...row };
    for (const box of spot.boxes) {
      if (typeof theirs[box] !== "string" || own[box] !== theirs[box]) continue;
      next[box] = swapWords(theirs[box], platform, village);
    }
    return next as ResolvedItem;
  });
  return { ...page, [spot.section]: { ...section, lists: { ...section.lists, [spot.list]: rows } } };
}
