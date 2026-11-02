/**
 * Whether this village serves the brochure pages, and which of them. The rule,
 * the list of pages and the reasoning live in shared/brochure.ts; this file
 * only reads the stored switches once at boot and answers from memory
 * afterwards.
 *
 * Loaded once at boot into a write-through cache. Admin, Pages switches them
 * (`updateBrochurePages`, server/routes/brochurePages.ts) and every later
 * request reads the new value; members see it on their next page load.
 */
import type { Pool } from "mysql2/promise";
import { dbDocument, type DbDocument } from "../repos/store-db";
import {
  BROCHURE_DOCUMENT,
  applyBrochurePatch,
  brochurePathServed,
  brochureState,
  type BrochurePatch,
  type BrochurePath,
} from "../../shared/brochure";

export { isBrochurePath } from "../../shared/brochure";

type Stored = { enabled: boolean; hidden?: BrochurePath[] };

let repo: DbDocument<Stored> | null = null;

export async function loadBrochurePages(pool: Pool): Promise<boolean> {
  repo = dbDocument<Stored>(pool, BROCHURE_DOCUMENT, { enabled: false });
  await repo.load();
  const on = brochurePagesOn();
  const off = brochureHiddenPages();
  console.log(
    on
      ? `[site] brochure pages: ON (this village's own story pages, menus and footer links are served)${off.length ? `, except ${off.join(", ")}` : ""}`
      : "[site] brochure pages: off (see shared/brochure.ts to turn them on after replacing them)",
  );
  return on;
}

/** False until boot has loaded the switch, and false whenever it is absent. */
export function brochurePagesOn(): boolean {
  return repo ? brochureState(repo.get()).enabled : false;
}

/** The story pages switched off one by one. Empty until boot has loaded them. */
export function brochureHiddenPages(): BrochurePath[] {
  return repo ? brochureState(repo.get()).hidden : [];
}

/**
 * Whether this village serves `path` right now. Every address outside the
 * story pages is served; a story page needs both switches on.
 */
export function brochurePageServed(path: string): boolean {
  return brochurePathServed({ enabled: brochurePagesOn(), hidden: brochureHiddenPages() }, path);
}

/**
 * True when `path` is a story page switched off on its own. The question for
 * a link drawn somewhere that has always linked a story page whatever the
 * master switch said (the map's chips): it drops what this village switched
 * off by name, and changes nothing else.
 */
export function brochurePageOffAlone(path: string): boolean {
  return !brochurePathServed({ enabled: true, hidden: brochureHiddenPages() }, path);
}

/** Both switches, the way `/api/game/config` hands them to the client. */
export function brochureConfig(): { brochurePages: boolean; brochureHidden: BrochurePath[] } {
  return { brochurePages: brochurePagesOn(), brochureHidden: brochureHiddenPages() };
}

/*
 * One write at a time. A change reads the stored document and writes it back
 * whole, so two changes that overlapped would each start from the same old
 * document and the second would undo the first.
 */
let writing: Promise<unknown> = Promise.resolve();

/**
 * Change either switch, or both (Rye, 2026-10-22: every village's pages are
 * its own to switch). The document is write-through cached, so
 * `brochurePageServed()` answers the new value on the very next request and
 * the next page load serves or hides the pages. No restart.
 */
export function updateBrochurePages(patch: BrochurePatch): Promise<{ enabled: boolean; hidden: BrochurePath[] }> {
  const next = writing.then(async () => {
    if (!repo) throw new Error("brochure pages are not loaded yet");
    const doc = applyBrochurePatch(repo.get(), patch);
    await repo.put(doc);
    return brochureState(repo.get());
  });
  writing = next.catch(() => undefined);
  return next;
}

/** The master switch alone. Pages switched off one by one stay off. */
export async function setBrochurePages(on: boolean): Promise<boolean> {
  return (await updateBrochurePages({ enabled: on })).enabled;
}
