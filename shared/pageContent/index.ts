/**
 * Every page spec, keyed by its content section (`page-home`, ...).
 *
 * Imported by the server (to validate a save) and by Admin, Pages (to build
 * the editor). A public page imports ONLY its own spec file, never this
 * registry, so one page's words never ride in another page's bundle.
 */
import { HOME_PAGE } from "./home";
import { SITE_PAGE } from "./site";
import { RIGHTS_RESIDENT_PAGE, RIGHTS_STEWARD_PAGE } from "./rights";
import { HOUSING_PAGE } from "./housing";
import { OPPORTUNITIES_PAGE } from "./opportunities";
import { VISIT_PAGE } from "./visit";
import { WORK_WITH_US_PAGE } from "./workWithUs";
import { GOOD_NEIGHBOR_PAGE } from "./goodNeighbor";
import { HOW_WE_CREATE_PAGE } from "./howWeCreate";
import { CO_CREATORS_GUIDE_PAGE } from "./coCreatorsGuide";
import { TEAM_PAGE } from "./team";
import { MASTER_PLAN_PAGE } from "./masterPlan";
import { LOVE_LETTER_PAGE } from "./loveLetter";
import { JOURNEY_PAGES } from "./journeys";
import { GOVERNANCE_PAGE } from "./governance";
import { CIRCLES_PAGE } from "./circles";
import { PAGE_SECTION_PREFIX, pageSectionKey, type PageSpec } from "./types";
import { pageDocumentProblems } from "./resolve";

export const PAGE_SPECS: readonly PageSpec[] = [HOME_PAGE, SITE_PAGE, RIGHTS_RESIDENT_PAGE, RIGHTS_STEWARD_PAGE, HOUSING_PAGE, OPPORTUNITIES_PAGE, VISIT_PAGE, WORK_WITH_US_PAGE, GOOD_NEIGHBOR_PAGE, HOW_WE_CREATE_PAGE, CO_CREATORS_GUIDE_PAGE, TEAM_PAGE, MASTER_PLAN_PAGE, LOVE_LETTER_PAGE, ...JOURNEY_PAGES, GOVERNANCE_PAGE, CIRCLES_PAGE];

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
