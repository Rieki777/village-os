/**
 * Whether this village serves the brochure pages. The rule, the list of pages
 * and the reasoning live in shared/brochure.ts; this file only reads the
 * stored switch once at boot and answers from memory afterwards.
 *
 * Loaded once at boot into a write-through cache. Admin, Pages switches it
 * (`setBrochurePages`, server/routes/brochurePages.ts) and every later request
 * reads the new value; members see it on their next page load.
 */
import type { Pool } from "mysql2/promise";
import { dbDocument, type DbDocument } from "../repos/store-db";
import { BROCHURE_DOCUMENT, brochureEnabled } from "../../shared/brochure";

export { isBrochurePath } from "../../shared/brochure";

let repo: DbDocument<{ enabled: boolean }> | null = null;

export async function loadBrochurePages(pool: Pool): Promise<boolean> {
  repo = dbDocument(pool, BROCHURE_DOCUMENT, { enabled: false });
  await repo.load();
  const on = brochurePagesOn();
  console.log(
    on
      ? "[site] brochure pages: ON (this village's own story pages, menus and footer links are served)"
      : "[site] brochure pages: off (see shared/brochure.ts to turn them on after replacing them)",
  );
  return on;
}

/** False until boot has loaded the switch, and false whenever it is absent. */
export function brochurePagesOn(): boolean {
  return repo ? brochureEnabled(repo.get()) : false;
}

/**
 * Turn the shopfront on or off from Admin, Pages (Rye, 2026-10-22: every
 * village's pages are its own to switch). The document is write-through
 * cached, so `brochurePagesOn()` answers the new value on the very next
 * request and the next page load serves or hides the pages. No restart.
 */
export async function setBrochurePages(on: boolean): Promise<boolean> {
  if (!repo) throw new Error("brochure pages are not loaded yet");
  await repo.put({ enabled: on });
  return brochurePagesOn();
}
