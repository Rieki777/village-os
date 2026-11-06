/**
 * THE ICON ON A ROLE'S TILE, for the player card's role tiles (the approved
 * design, https://claude.ai/artifact/XGP6VP5WFU1T6ti7RD482P, Rye 2026-10-22).
 *
 * The design draws one gold line icon per role: a door for onboarding and
 * people, a game screen for the front end and the platform, three circles in
 * a ring for governance, org design and facilitation. This file picks the
 * icon from words already on the role, so no village has to choose one and
 * no new column is stored. The drawings live with the card
 * (client/src/components/playerCard/roleIcons.tsx), keyed by `RoleIcon`, so a
 * key added here without a drawing fails to compile.
 *
 * ── THE KEYWORD MAP ─────────────────────────────────────────────────────────
 *
 * Read top to bottom, first match wins. The role's NAME is read against the
 * whole map first; only a name that matches nothing falls through to its
 * DOMAIN ("What I look after"), and a role that matches neither gets the star.
 * Order matters where two rows could both match: "Human Operations &
 * Onboarding" is a door (people come first), not a gear.
 *
 *   door     onboarding, welcome, people, human, member, newcomer, intake,
 *            hospitality, host, recruiting
 *   screen   front-end, front end, game, platform, app, software, web,
 *            digital, interface, design system
 *   circles  governance, organizational / organisational, org design,
 *            facilitation, sociocracy, circle, structure, consent
 *   sprout   land, garden, farm, food, forest, ecology, regeneration, soil,
 *            water, permaculture, seed, plant
 *   coins    finance, treasury, money, fund, budget, investor, accounting,
 *            economy, token, bookkeeping
 *   house    building, construction, housing, house, infrastructure,
 *            maintenance, facilities
 *   heart    care, healing, health, wellbeing, wellness, conflict, support
 *   book     learning, education, teaching, knowledge, memory,
 *            documentation, research, school, mentoring
 *   speech   communication, comms, media, story, outreach, marketing,
 *            social, press, events
 *   gear     operations, ops, systems, tech, data, hosting, back end,
 *            logistics, admin
 *   star     anything else
 *
 * A keyword ending in `*` matches any word that starts with it ("facilitat*"
 * finds facilitator and facilitation); any other keyword matches a whole word
 * only, so "app" is not found inside "applicant".
 *
 * Pure: no pool, no clock, no imports.
 */

export const ROLE_ICONS = ["door", "screen", "circles", "sprout", "coins", "house", "heart", "book", "speech", "gear", "star"] as const;
export type RoleIcon = (typeof ROLE_ICONS)[number];

/** The keyword map, in the order it is read. The star is the fallback and has no keywords. */
export const ROLE_ICON_KEYWORDS: ReadonlyArray<readonly [Exclude<RoleIcon, "star">, readonly string[]]> = [
  ["door", ["onboard*", "welcom*", "people", "human", "member*", "newcomer*", "intake", "hospitality", "host", "hosts", "hosting guests", "recruit*"]],
  ["screen", ["front-end", "front end", "frontend", "game*", "platform*", "app", "apps", "software", "web*", "digital", "interface*", "design system"]],
  ["circles", ["governance", "organizational", "organisational", "org design", "facilitat*", "sociocra*", "circle*", "structure*", "consent"]],
  ["sprout", ["land", "lands", "garden*", "farm*", "food", "forest*", "ecolog*", "regenerat*", "soil*", "water*", "permaculture", "seed*", "plant*"]],
  ["coins", ["financ*", "treasur*", "money", "fund*", "budget*", "invest*", "accounting", "accounts", "econom*", "token*", "bookkeep*"]],
  ["house", ["build*", "construct*", "housing", "house*", "infrastructure", "maintenance", "facilities"]],
  ["heart", ["care*", "caring", "heal*", "health*", "wellbeing", "well-being", "wellness", "conflict*", "support*"]],
  ["book", ["learn*", "educat*", "teach*", "knowledge", "memory", "document*", "research*", "school*", "mentor*"]],
  ["speech", ["communicat*", "comms", "media", "story*", "storytell*", "outreach", "marketing", "social", "press", "event*"]],
  ["gear", ["operations", "ops", "system*", "tech*", "data", "hosting", "back end", "back-end", "backend", "logistic*", "admin*"]],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One keyword as a pattern: a whole word, or a word start when it ends in `*`. */
function patternOf(keyword: string): RegExp {
  const prefix = keyword.endsWith("*");
  const word = escape(prefix ? keyword.slice(0, -1) : keyword);
  return new RegExp(`(^|[^a-z0-9])${word}${prefix ? "" : "($|[^a-z0-9])"}`);
}

const PATTERNS: ReadonlyArray<readonly [Exclude<RoleIcon, "star">, RegExp[]]> = ROLE_ICON_KEYWORDS.map(
  ([icon, words]) => [icon, words.map(patternOf)] as const,
);

function iconIn(text: string | null | undefined): RoleIcon | null {
  const s = String(text ?? "").toLowerCase();
  if (!s.trim()) return null;
  for (const [icon, patterns] of PATTERNS) if (patterns.some((p) => p.test(s))) return icon;
  return null;
}

/** The icon for a role: its name first, then its domain, then the star. PURE. */
export function roleIcon(name: string | null | undefined, domain?: string | null): RoleIcon {
  return iconIn(name) ?? iconIn(domain) ?? "star";
}
