/**
 * THE VILLAGE'S SUGGESTION ROUTES, the cache every suggestion door reads
 * (ROLE_POWERS_DESIGN.md §4.5).
 *
 * One `app_config` document, `suggestion-routes`, holding only the entries a
 * village changed from the platform default (`SUGGESTION_ROUTE` in
 * shared/suggestions.ts). Loaded once at boot; the dial's write
 * (server/routes/suggestionRoutes.ts) replaces it and the next read sees it.
 * Before the boot load, and in a test that never loads it, the table is the
 * platform default, which is what a village that never chose has anyway.
 */
import type { Pool } from "mysql2/promise";
import { dbDocument, type DbDocument } from "../repos/store-db";
import type { Capability } from "../../shared/capabilities";
import { effectiveSuggestionRoutes, type SuggestionRoute, type SuggestionRoutesDocument } from "../../shared/suggestions";

export const SUGGESTION_ROUTES_DOCUMENT = "suggestion-routes";

let repo: DbDocument<Record<string, unknown>> | null = null;

/** Read the stored routes once, at boot. */
export async function loadSuggestionRoutes(pool: Pool): Promise<void> {
  const next = dbDocument<Record<string, unknown>>(pool, SUGGESTION_ROUTES_DOCUMENT, {});
  await next.load();
  repo = next;
}

/** What the village stored: the entries that differ from the default. */
export function storedSuggestionRoutes(): Record<string, unknown> {
  return repo ? repo.get() : {};
}

/** The village's table in force, every power named. */
export function villageSuggestionRoutes(): Record<Capability, SuggestionRoute> {
  return effectiveSuggestionRoutes(storedSuggestionRoutes());
}

/** Store a document `storableSuggestionRoutes` produced. */
export async function saveSuggestionRoutes(doc: SuggestionRoutesDocument): Promise<void> {
  if (!repo) throw new Error("the village's suggestion routes are not loaded yet");
  await repo.put(doc as unknown as Record<string, unknown>);
}
