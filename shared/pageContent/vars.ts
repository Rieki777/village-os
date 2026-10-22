/**
 * The `{words}` a page field may use, from a village's config, for code that
 * renders page words OUTSIDE the browser: the membership letter, which the
 * server renders, fingerprints and stores (shared/membershipLetter.ts).
 *
 * The page's own copy of this rule is `usePageVars` in
 * client/src/hooks/usePageContent.ts. They must agree word for word, or the
 * letter a member aligns with says something the page around it does not;
 * client/src/pages/LoveLetter.content.test.tsx holds them to each other.
 */
import type { PageVars } from "./types";

export function pageVarsFrom(config: any): PageVars {
  const word = (typed: unknown, fallback: string) => String(typed ?? "").trim() || fallback;
  const project = config?.project;
  const currency = config?.currency;
  const location = word(project?.location, "");
  const village = word(project?.name, "the village");
  return {
    village,
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
