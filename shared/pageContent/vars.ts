/**
 * The `{words}` a page field may use, from the village's own settings.
 *
 * One function for both sides: the browser fills a page with it
 * (`usePageVars`), and the server fills the words of an email a page's fields
 * also write (the Work With Us acknowledgement). Two copies of these rules
 * would drift, and a founder would see `{village}` filled one way on the page
 * and another way in the inbox.
 *
 * Every one of these was a setting a founder could already change that the
 * brochure pages never read: the audit of 2026-10-22 found "Love Letter" typed
 * twenty times beside a commitment name nobody used, and a member name that
 * was required in setup and shown nowhere.
 */
import type { PageVars } from "./types";

/** The slice of the public game config the words come from. */
export interface PageVarSource {
  project?: {
    name?: unknown;
    tagline?: unknown;
    location?: unknown;
    memberName?: unknown;
    commitmentName?: unknown;
    roleName?: unknown;
    catalystName?: unknown;
  } | null;
  currency?: { name?: unknown; value?: { name?: unknown } | null } | null;
}

export function pageVarsFrom(config: PageVarSource): PageVars {
  const word = (typed: unknown, fallback: string) => String(typed ?? "").trim() || fallback;
  const { project, currency } = config;
  const location = word(project?.location, "");
  const village = word(project?.name, "the village");
  return {
    village,
    // Never blank: the Home headline is `{tagline}` by default, and a
    // village that cleared its Tagline still needs a headline.
    tagline: word(project?.tagline, `Welcome to ${village}`),
    location,
    "in-location": location ? ` in ${location}` : "",
    member: word(project?.memberName, "member"),
    commitment: word(project?.commitmentName, "membership agreement"),
    role: word(project?.roleName, "role"),
    catalyst: word(project?.catalystName, "steward"),
    token: word(currency?.name, "recognition"),
    value: word(currency?.value?.name, "village tokens"),
  };
}
