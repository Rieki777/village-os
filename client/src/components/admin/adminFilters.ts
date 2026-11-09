/**
 * Which admin pages have filters, and where they sit.
 *
 * The header's "Change the filters" link used to point every page at the
 * module library, which has none of them (Rye, 2026-11-09). It now shows only
 * on a page that draws its own filters, and lands in them. A page that adds a
 * filter bar puts `id={ADMIN_FILTERS_ID}` on it and its tab key here.
 */
export const ADMIN_FILTERS_ID = "admin-filters";

const TABS_WITH_FILTERS: ReadonlySet<string> = new Set(["players"]);

export function tabHasFilters(tab: string): boolean {
  return TABS_WITH_FILTERS.has(tab);
}

/** Scroll the open page's filters into view and put the cursor in the first one. */
export function focusAdminFilters(doc: Document = document): boolean {
  const bar = doc.getElementById(ADMIN_FILTERS_ID);
  if (!bar) return false;
  bar.scrollIntoView?.({ block: "start", behavior: "smooth" });
  const first = bar.querySelector<HTMLElement>("input, select, textarea, button");
  (first ?? bar).focus({ preventScroll: true });
  return true;
}
