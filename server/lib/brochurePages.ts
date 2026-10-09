/**
 * Whether this village serves the brochure pages. The rule, the list of pages
 * and the reasoning live in shared/brochure.ts; this file only reads the
 * stored switch once at boot and answers from memory afterwards.
 *
 * Read once on purpose, like the rest of the brand: the answer decides which
 * links every page carries, so it must not change underneath a member between
 * two requests. Changing it is a database write and a restart.
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
