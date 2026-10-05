/**
 * The brochure pages, and the one switch that turns them off.
 *
 * Eighteen public pages and one component tell the first village's own story:
 * its four journeys, its master plan, its team, its housing, its visit and
 * membership forms, its rights pages, its build history. They are compiled
 * into the client and listed as the SHOPFRONT in scripts/check-brand-refs.mjs,
 * which explains why a fork replaces them rather than white-labelling them.
 *
 * Until 2026-10-02 every new village served them anyway, linked from its own
 * footer, because nothing could switch them off. Now one document in
 * `app_config` decides, read once at boot (server/lib/brochurePages.ts):
 *
 *   { "enabled": true }   the pages, their menu entries and their footer links
 *                         are served, exactly as before.
 *   absent, or false      none of them is linked from anywhere, each route
 *                         answers with the not-found page, and "/" shows the
 *                         neutral welcome page instead of the brochure home.
 *
 * Absent means OFF, so a new village starts clean with nothing to set.
 * Migration 0225 wrote `{ "enabled": true }` into every database that already
 * had members when it ran, so an existing village keeps its pages without
 * anybody touching a setting.
 *
 * A village that has rewritten these pages in its own fork turns them back on
 * with one statement against its own database, then a restart:
 *
 *   INSERT INTO app_config (config_key, value) VALUES ('brochure-pages', '{"enabled":true}')
 *     ON DUPLICATE KEY UPDATE value = VALUES(value);
 *
 * This list is the single source for every place that hides a brochure link:
 * the routes, the menus, the footer, the sitemap and the next-step prompt.
 * `/` is deliberately absent: the home route stays, and only what it renders
 * changes.
 */

/** The `app_config.config_key` the switch lives under. */
export const BROCHURE_DOCUMENT = "brochure-pages";

export const BROCHURE_PATHS = [
  "/investor",
  "/steward",
  "/resident",
  "/prosperity",
  "/love-letter",
  "/visit",
  "/work-with-us",
  "/opportunities",
  "/housing",
  "/master-plan",
  "/team",
  "/how-we-create",
  "/good-neighbor",
  "/co-creators-guide",
  "/resident-rights",
  "/steward-rights",
  "/project-history",
] as const;

export type BrochurePath = (typeof BROCHURE_PATHS)[number];

const SET: ReadonlySet<string> = new Set(BROCHURE_PATHS);

/** True for a brochure route, ignoring any query string or hash. */
export function isBrochurePath(path: string): boolean {
  const bare = path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return SET.has(bare);
}

/** Read the stored document. Only an explicit `true` turns the pages on. */
export function brochureEnabled(doc: unknown): boolean {
  return !!doc && typeof doc === "object" && (doc as { enabled?: unknown }).enabled === true;
}
