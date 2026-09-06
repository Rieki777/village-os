/**
 * The single Hypha home (S13, critique fix: "the DHO URL lived in four
 * places"). Everything share-like — governance, voting, equity, treasury —
 * happens on the village's Hypha DHO; this platform reads, displays, and
 * deep-links, and NEVER posts, mints, or moves anything there.
 *
 * One variable (`hypha.org_url`) is the root. The four named links derive
 * from it by convention, each individually overridable for DHOs whose paths
 * differ. Blank root = every Hypha surface hides — a dead governance button
 * is impossible by construction.
 */
export const HYPHA_LINK_NAMES = ["governance", "proposals", "treasury", "members"] as const;
export type HyphaLinkName = (typeof HYPHA_LINK_NAMES)[number];

/** Conventional path suffixes on a Hypha DHO. Overridable per deployment. */
const DEFAULT_SUFFIX: Record<HyphaLinkName, string> = {
  governance: "",
  proposals: "/agreements",
  treasury: "/treasury",
  members: "/members",
};

export interface HyphaLinks {
  configured: boolean;
  orgUrl: string;
  links: Record<HyphaLinkName, string>;
}

/**
 * Resolve the four named links from a variable reader. Returns
 * configured:false (and no links) when the org URL is blank.
 */
export function resolveHyphaLinks(getVar: (key: string) => string): HyphaLinks {
  const orgUrl = String(getVar("hypha.org_url") ?? "").trim().replace(/\/$/, "");
  if (!orgUrl) {
    return { configured: false, orgUrl: "", links: { governance: "", proposals: "", treasury: "", members: "" } };
  }
  const links = {} as Record<HyphaLinkName, string>;
  for (const name of HYPHA_LINK_NAMES) {
    const override = String(getVar(`hypha.link_${name}`) ?? "").trim();
    links[name] = override || orgUrl + DEFAULT_SUFFIX[name];
  }
  return { configured: true, orgUrl, links };
}

/** Fail-loud single-link accessor: an unknown name is a typo, never a blank. */
export function hyphaLink(resolved: HyphaLinks, name: string): string {
  if (!(HYPHA_LINK_NAMES as readonly string[]).includes(name)) {
    throw new Error(`Unknown Hypha link name: ${name}`);
  }
  return resolved.configured ? resolved.links[name as HyphaLinkName] : "";
}

/**
 * What a founder does before this platform can find their token contracts.
 *
 * It lives here rather than beside the discovery code because BOTH sides need
 * it and only one side could reach it. The server sends it on the status route
 * and on the lookup's answers, and the admin panel reads it off the status
 * route, which is behind the Hypha module gate. A fresh village ships that
 * module OFF, so the panel had no source for these steps in exactly the state
 * they exist to explain, and rendered an empty numbered list under the heading
 * "Find your contracts on Base".
 */
export const HYPHA_FIRST_STEPS: readonly string[] = [
  "Create your DAO on Hypha and create its tokens there.",
  "Issue yourself any amount of each token. Issuance is what puts the contract on Base, and a lookup can only see what your account holds.",
  "Copy your Base account address into the founder Base account address setting.",
  "Come back here, look the tokens up, and confirm each contract yourself.",
];

