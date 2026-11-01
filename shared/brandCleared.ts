/**
 * A BRAND LINE A VILLAGE HAS CLEARED ON PURPOSE (readiness R088).
 *
 * Every overlay field in the brand document inherits on blank: `pick()` in
 * `mergedConfig()` (server/index.ts) treats "", null and an absent key alike
 * and hands back the platform default. That is right for a name, and it is the
 * stored shape of every village that never touched a box, because the wizard
 * posts its whole form back with "" in each untouched field. So "" cannot be
 * repurposed to mean "show nothing": every village that never opened the tab
 * would lose its tagline and footer line on the next deploy. That is the empty
 * sentinel trap, and the reason this is a SEPARATE answer.
 *
 * The answer is a list on the project, `project.cleared`, naming the fields a
 * village chose to leave empty. Three states, each with its own spelling:
 *
 *   absent or ""      inherit the platform default (unchanged, every old doc)
 *   text              the village's own words
 *   listed in cleared AND empty
 *                     nothing at all
 *
 * A listed field that holds text shows the text. Typing words is a newer and
 * plainer answer than a box ticked earlier, so a stale entry can never hide
 * what a founder wrote.
 *
 * Only the two lines the finding names are clearable. Each has a reader that
 * already copes with nothing: the footer renders its line only when it is
 * truthy (client/src/components/Layout.tsx), and the Home headline's
 * `{tagline}` falls back to "Welcome to {village}" (shared/pageContent/vars.ts).
 * A field is added here only once every reader of it has been checked the same
 * way.
 */

export const CLEARABLE_BRAND_FIELDS = ["tagline", "footerBlurb"] as const;
export type ClearableBrandField = (typeof CLEARABLE_BRAND_FIELDS)[number];

export function isClearable(key: string): key is ClearableBrandField {
  return (CLEARABLE_BRAND_FIELDS as readonly string[]).includes(key);
}

/** The cleared list as stored, kept to clearable names: anything else is ignored. */
export function clearedFields(project: unknown): ClearableBrandField[] {
  const raw = (project as { cleared?: unknown } | null | undefined)?.cleared;
  if (!Array.isArray(raw)) return [];
  return CLEARABLE_BRAND_FIELDS.filter((k) => raw.includes(k));
}

/** True when the village chose nothing for this field and has not typed anything since. */
export function isCleared(project: unknown, key: string): boolean {
  if (!isClearable(key)) return false;
  const typed = String((project as Record<string, unknown> | null | undefined)?.[key] ?? "").trim();
  return !typed && clearedFields(project).includes(key);
}

/**
 * The project with this field cleared or restored. Clearing empties the box as
 * well, so the stored document reads the way the page does; restoring leaves
 * the box empty, which inherits the platform default again.
 */
export function withCleared<T extends Record<string, unknown>>(
  project: T,
  key: ClearableBrandField,
  on: boolean,
): T & { cleared: ClearableBrandField[] } {
  const rest = clearedFields(project).filter((k) => k !== key);
  const cleared = on ? [...rest, key] : rest;
  return { ...project, [key]: on ? "" : project[key] ?? "", cleared };
}

/**
 * What the site shows for a clearable field: nothing when cleared, otherwise
 * the village's words, otherwise the platform default. The same rule as
 * `pick()` for everything but the cleared case.
 */
export function overlayOrNone(project: unknown, key: ClearableBrandField, platformDefault: string): string {
  if (isCleared(project, key)) return "";
  const typed = (project as Record<string, unknown> | null | undefined)?.[key];
  return typed === "" || typed === undefined || typed === null ? platformDefault : String(typed);
}
