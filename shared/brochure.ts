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
 * Since 2026-10-22 a village switches them on or off in Admin, Make it yours,
 * Pages (server/routes/brochurePages.ts), and the change applies on the next
 * page load: every word on them is the village's own, edited on that screen.
 *
 * This list is the single source for every place that hides a brochure link:
 * the routes, the menus, the footer, the sitemap and the next-step prompt.
 * `/` is deliberately absent: the home route stays, and only what it renders
 * changes.
 *
 * ONE PAGE AT A TIME (2026-10-23). A village with no lots has no use for a
 * Housing page, and the only switch it had took every story page down with it.
 * The same document now also lists the pages switched off one by one:
 *
 *   { "enabled": true, "hidden": ["/housing"] }
 *
 * A page is served while the master switch is on AND it is not in `hidden`
 * (`brochurePathServed`). An off page goes exactly the way every page goes
 * when the master switch is off: its route is the not-found page, and its
 * menu entry, footer link, sitemap line and share card go with it. The list
 * keeps its value while the master switch is off, so turning the pages back on
 * brings back only the ones that were on. A server from before this reads
 * `enabled` alone and ignores the list, so rolling back shows every page again
 * and loses nothing.
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

/**
 * The path alone: no query string, no hash, no trailing slash, lower case.
 * The router matches a route whatever its case (`/HOUSING` opens `/housing`),
 * so a switch that only knew the lower-case spelling could be walked round.
 */
function barePath(path: string): string {
  return path.split(/[?#]/, 1)[0].replace(/\/+$/, "").toLowerCase() || "/";
}

/** True for a brochure route, ignoring any query string or hash. */
export function isBrochurePath(path: string): boolean {
  return SET.has(barePath(path));
}

/** Read the stored document. Only an explicit `true` turns the pages on. */
export function brochureEnabled(doc: unknown): boolean {
  return !!doc && typeof doc === "object" && (doc as { enabled?: unknown }).enabled === true;
}

/**
 * The pages that carry their own switch: every story page a village edits in
 * Admin, Pages. The Command Centre is the one brochure route left out. It is
 * the team's working page, it has no words in the Pages editor to sit beside a
 * switch, and the master switch still covers it.
 */
export const SWITCHABLE_PAGES: readonly BrochurePath[] = BROCHURE_PATHS.filter((p) => p !== "/project-history");

const SWITCHABLE: ReadonlySet<string> = new Set(SWITCHABLE_PAGES);

/** True when `path` names a page with its own switch. */
export function isSwitchablePage(path: string): path is BrochurePath {
  return SWITCHABLE.has(path);
}

/**
 * The pages this village switched off one by one, from the stored document.
 * Anything else in the list (a typo, a page that has since left the platform)
 * is dropped, and the answer is always in menu order with no repeats.
 */
export function brochureHidden(doc: unknown): BrochurePath[] {
  const raw = doc && typeof doc === "object" ? (doc as { hidden?: unknown }).hidden : undefined;
  if (!Array.isArray(raw)) return [];
  const listed = new Set(raw.filter((p): p is string => typeof p === "string"));
  return SWITCHABLE_PAGES.filter((p) => listed.has(p));
}

/** Both switches, as the server stores them and the client is told them. */
export interface BrochureState {
  enabled: boolean;
  hidden: readonly string[];
}

export function brochureState(doc: unknown): { enabled: boolean; hidden: BrochurePath[] } {
  return { enabled: brochureEnabled(doc), hidden: brochureHidden(doc) };
}

/**
 * Whether this village serves `path`. Anything outside the story pages is
 * always served; a story page is served while the master switch is on and its
 * own switch is not off.
 */
export function brochurePathServed(state: BrochureState, path: string): boolean {
  const bare = barePath(path);
  if (!SET.has(bare)) return true;
  return state.enabled && !state.hidden.includes(bare);
}

/** What `PUT /api/admin/brochure-pages` accepts: either switch, or both. */
export interface BrochurePatch {
  enabled?: boolean;
  /** `true` shows a page, `false` switches it off. Pages not named keep their state. */
  pages?: Partial<Record<BrochurePath, boolean>>;
}

/**
 * Why a body cannot be saved as a change to the switches, in a sentence an
 * admin can act on, or null when it can. Unknown keys are refused rather than
 * ignored: a misspelt `page` would otherwise answer 200 and change nothing.
 */
export function brochurePatchProblem(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Send enabled, pages, or both.";
  const keys = Object.keys(body);
  const stray = keys.find((k) => k !== "enabled" && k !== "pages");
  if (stray) return `"${stray}" is not a switch here. Send enabled, pages, or both.`;
  if (!keys.length) return "Send enabled, pages, or both.";
  const { enabled, pages } = body as { enabled?: unknown; pages?: unknown };
  if ("enabled" in body && typeof enabled !== "boolean") return "enabled must be true or false";
  if ("pages" in body) {
    if (!pages || typeof pages !== "object" || Array.isArray(pages)) {
      return "pages must name each page by its address, with true to show it or false to hide it.";
    }
    for (const [path, show] of Object.entries(pages)) {
      if (!isSwitchablePage(path)) return `There is no story page at ${path} with a switch of its own.`;
      if (typeof show !== "boolean") return `The switch for ${path} must be true or false.`;
    }
  }
  return null;
}

/**
 * The stored document after a change. Pages the change does not name keep
 * their state, so two admins switching two different pages at once both land.
 */
export function applyBrochurePatch(doc: unknown, patch: BrochurePatch): { enabled: boolean; hidden: BrochurePath[] } {
  const now = brochureState(doc);
  const hidden = new Set<string>(now.hidden);
  for (const [path, show] of Object.entries(patch.pages ?? {})) {
    if (show === true) hidden.delete(path);
    else if (show === false) hidden.add(path);
  }
  return {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : now.enabled,
    hidden: SWITCHABLE_PAGES.filter((p) => hidden.has(p)),
  };
}
