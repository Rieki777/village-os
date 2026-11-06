/**
 * What a public page says, as data a village edits in Admin, Pages.
 *
 * WHY THIS EXISTS (Rye, 2026-10-22). The brochure pages were written as one
 * village's JSX. A founder running the published image could change the name,
 * the pictures and a handful of links, and nothing else: the Home headline
 * stayed "Co-Become the Most Beautiful Village" whatever the Tagline said. The
 * ruling is that every village's pages are fully its own, so every word a page
 * says about a village lives here as a field with a default, a limit and a
 * line saying where it shows.
 *
 * ONE SPEC PER PAGE, read three ways:
 *   - the page renders `resolvePage(spec, stored, vars)` instead of literals;
 *   - Admin, Pages builds its editor from the same spec, so a field added here
 *     is editable the moment it exists;
 *   - `PUT /api/admin/content/page-<id>` refuses a document the spec does not
 *     describe, or a value longer than its limit.
 *
 * STORAGE is the existing `content` document, one section per page
 * (`page-home`, ...). It holds ONLY what the village changed. Every field falls
 * back to its default on its own, at read time, so a field added to a spec
 * reaches a village that saved the page before the field existed.
 */

/** How a field is edited and how its limit reads. */
export type FieldKind =
  /** One line. */
  | "text"
  /** A paragraph. `**double stars**` mark bold words. */
  | "long"
  /** A URL, a site path (`/visit`), `mailto:` or `#anchor`. */
  | "link";

export interface FieldSpec {
  key: string;
  /** What the founder sees above the box. */
  label: string;
  /** One more line of help: what happens when it is blank, what to avoid. */
  help?: string;
  kind: FieldKind;
  /**
   * The most characters the layout holds before it stops looking right.
   * Counted after the founder types and BEFORE `{village}`-style words are
   * filled in, so a long village name is the template's problem, not theirs.
   */
  max: number;
  /** What the page says until the village says otherwise. May use `{words}`. */
  default: string;
  /** Blank is a real answer: the element it fills is not drawn. */
  optional?: boolean;
}

export interface ListSpec {
  key: string;
  label: string;
  help?: string;
  /** What one row is called in the editor ("Persona"). */
  itemLabel: string;
  /** The row field whose value names a row in the editor. */
  titleKey: string;
  fields: FieldSpec[];
  /**
   * FIXED rows: one per id, in this order, never added or removed (the four
   * path cards each lead to their own page). A stored row merges with its
   * default field by field. Without `fixed` the list is FREE: a stored list
   * replaces the default list whole, and an empty stored list means "none".
   */
  fixed?: readonly string[];
  minItems?: number;
  maxItems: number;
  default: ReadonlyArray<Readonly<Record<string, string>>>;
}

export interface SectionSpec {
  id: string;
  label: string;
  /** Where a visitor meets it, in the founder's words ("Top of the homepage"). */
  shows: string;
  /** May a village switch the whole section off? */
  hideable?: boolean;
  fields: FieldSpec[];
  lists?: ListSpec[];
}

export interface PageSpec {
  /** The content section is `page-${id}`. */
  id: string;
  label: string;
  /** The page's address, for the editor's "Open this page" link. */
  path: string;
  sections: SectionSpec[];
}

/** One list row after resolution. Fixed rows carry their id. */
export type ResolvedItem = Readonly<Record<string, string>> & { id?: string };

export interface ResolvedSection {
  hidden: boolean;
  fields: Readonly<Record<string, string>>;
  lists: Readonly<Record<string, ReadonlyArray<ResolvedItem>>>;
}

export type ResolvedPage = Readonly<Record<string, ResolvedSection>>;

/** The `{words}` a field may use, filled in from the village's own settings. */
export type PageVars = Readonly<Record<string, string>>;

export const PAGE_SECTION_PREFIX = "page-";

export function pageSectionKey(spec: Pick<PageSpec, "id">): string {
  return `${PAGE_SECTION_PREFIX}${spec.id}`;
}
