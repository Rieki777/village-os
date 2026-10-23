/**
 * Every page spec, keyed by its content section (`page-home`, ...).
 *
 * Imported by the server (to validate a save) and by Admin, Pages (to build
 * the editor). A public page imports ONLY its own spec file, never this
 * registry, so one page's words never ride in another page's bundle.
 */
import { HOME_PAGE } from "./home";
import { SITE_PAGE } from "./site";
import { PAGE_SECTION_PREFIX, pageSectionKey, type PageSpec } from "./types";
import { pageDocumentProblems } from "./resolve";

export const PAGE_SPECS: readonly PageSpec[] = [HOME_PAGE, SITE_PAGE];

export function pageSpecForSection(section: string): PageSpec | null {
  if (!section.startsWith(PAGE_SECTION_PREFIX)) return null;
  return PAGE_SPECS.find((spec) => pageSectionKey(spec) === section) ?? null;
}

/**
 * Why `PUT /api/admin/content/:section` must refuse this body, or null.
 *
 * Sections outside `page-*` are not this module's to judge and pass through
 * untouched. A `page-*` name no spec claims is refused: nothing renders it.
 */
export function pageContentProblem(section: string, body: unknown): string | null {
  if (!section.startsWith(PAGE_SECTION_PREFIX)) return null;
  const spec = pageSpecForSection(section);
  if (!spec) return `There is no page called "${section.slice(PAGE_SECTION_PREFIX.length)}".`;
  const problems = pageDocumentProblems(spec, body);
  return problems.length ? problems.join(" ") : null;
}

export * from "./types";
export * from "./resolve";
