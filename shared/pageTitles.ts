/**
 * Moved from client/src/App.tsx (2026-10-22) so the server can give a shared
 * link the same page name the browser tab shows: a crawler runs no JavaScript,
 * so a title painted only on the client is a title no link preview ever reads.
 *
* The page's name, in the browser and to a screen reader.
 *
 * Every one of the twenty-six routes served the single <title> baked into
 * index.html, so this whole application announced itself as one page. Three
 * separate costs: a screen reader reads the title on navigation, so every
 * move sounded identical and gave no confirmation anything had happened; a
 * member with several tabs open could not tell them apart; and the title was
 * a hardcoded village name in a platform that is supposed to be forkable.
 *
 * The village's own name comes from the live config, so a fork's title is
 * the fork's name with no code change. The page part is a plain map — a
 * route that gains a page adds a line, and one that does not falls back to
 * the village name alone rather than to a lie.
 */
export const PAGE_TITLES: Readonly<Record<string, string>> = {
  "/": "", // the home page is the village itself; no prefix
  "/journey-to-launch": "Journey to launch",
  "/setup-game": "The Setup Game",
  "/project-history": "Command Centre",
  "/feedback": "Feedback",
  "/network": "Village network",
  "/contribute": "Contribute",
  "/seasonal-festivals": "Seasonal festivals",
  "/investor": "Investor journey",
  "/steward": "Steward journey",
  "/resident": "Resident journey",
  "/prosperity": "Prosperity journey",
  "/love-letter": "{commitment}",
  "/request-membership": "Ask to join",
  "/circles": "Circles",
  "/quests": "Quests",
  "/propose-quest": "Propose a quest",
  "/roles": "Roles",
  "/forum": "Forum",
  "/messages": "Messages",
  "/introductions": "Introductions",
  "/feed": "Village feed",
  "/map": "Village map",
  "/map/circles": "Circles and roles",
  "/events": "Village Calendar",
  "/first-walk": "Your First Walk",
  "/stay": "Stays",
  "/library": "Material library",
  "/badges": "Badges & skills",
  "/powers": "What this village looks after",
  "/review": "Review",
  "/cash-payouts": "Cash to pay out",
  "/role-proposals": "Propose my roles",
  // Keys here are matched by longest PREFIX against the live location, so a
  // key with no route behind it can never match and is dead weight that
  // reads like a promise. /health, /exchange and /profiles were all three:
  // the health dashboard is /village-health, the exchange lives inside the
  // wallet, and the member directory is /profile.
  "/village-health": "Village health",
  // Both spellings resolve to the same page. /tokens is what the nav links to
  // and what a member sees; /wallet stays mounted because Stripe return URLs
  // and order notifications already carry it (server/index.ts), and a member's
  // own balances now also live in a Wallet section on their profile.
  "/tokens": "The Exchange",
  "/wallet": "The Exchange",
  "/profile": "My profile",
  "/login": "Sign in",
  "/set-password": "Choose a password",
  "/forgot-password": "Set a new password",
  "/game-mechanics": "Game Mechanics",
  "/exit-policy": "Leaving well",
  "/tools": "Tools",
  // One line covers the shelf and every detail page: keys match by longest
  // prefix, so /modules/stays reads as the library too.
  "/modules": "Module Library",
  // Longest-prefix matching makes /campaigns win over /campaign for the list
  // page, so the pair costs two lines and no route can fall through them.
  "/campaigns": "Our raisings",
  "/campaign": "Crowdpool",
  // One line covers the shelf and every place, by the same longest-prefix
  // rule the module library uses above.
  "/places": "Places, photographed",
  // Its own address rather than /places/photos, because a place key called
  // "photos" would shadow it and because this is a different object from a
  // place: the whole village's record on one page.
  "/photographs": "Every photograph",
  "/admin": "Village settings",
  "/journal": "Journal",
  // One line covers the list and every room, by the longest-prefix rule.
  "/sessions": "Live sessions",
  // The shopfront pages (shared/brochure.ts). They had no entry, so their
  // tabs and their link previews carried the village name alone.
  "/housing": "Housing",
  "/opportunities": "Opportunities",
  "/visit": "Visit",
  "/work-with-us": "Work with us",
  "/team": "Team",
  "/master-plan": "Master plan",
  "/good-neighbor": "Good neighbor",
  "/co-creators-guide": "Co-creators guide",
  "/how-we-create": "How we create",
  "/resident-rights": "Resident rights",
  "/steward-rights": "Steward rights",
  // Untitled until a production sweep found them (2026-10-31); each name is
  // the page's own heading. shared/pageTitles.test.ts now reads App.tsx and
  // fails on any route left without one.
  "/claim": "Claim this village",
  "/register": "Join",
  "/reserve": "Reserve your home",
  "/email": "Your email",
  "/village-email": "How the village emails",
  "/training": "Training",
  "/governance": "Governance",
  "/decisions": "Decisions",
  "/propose": "Start a proposal",
  "/role-applications": "Role application",
  "/seat-applications": "Role application",
  "/season-plans": "The village's season",
  "/season-plans/mine": "Your season",
  "/aligned": "Aligned",
  "/gratitude": "Gratitude",
  "/404": "Page not found",
};

/**
 * The page part of the title for a location, by longest matching prefix, so
 * /forum/123 still reads as the forum. `{commitment}` is the village's own
 * word for what a member signs. Empty means the location has no page name.
 */
export function pageTitleFor(location: string, words: { commitment?: string } = {}): string {
  const match = Object.keys(PAGE_TITLES)
    .filter((p) => (p === "/" ? location === "/" : location.startsWith(p)))
    .sort((a, b) => b.length - a.length)[0];
  const page = match ? PAGE_TITLES[match] : "";
  return page.replace("{commitment}", words.commitment?.trim() || "Membership agreement");
}

/** "Page · Village", or the village alone where the page has no name. */
export function documentTitle(location: string, village: string, words: { commitment?: string } = {}): string {
  const page = pageTitleFor(location, words);
  return page ? `${page} · ${village}` : village;
}
