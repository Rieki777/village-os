/**
 * ROLES A CHARACTER COULD OPEN: platform suggestions, words only.
 *
 * Rye asked (Village OS × Jared plan v3, §6 and §10) for the Catalyst to have
 * open roles for raising investment: crowd pooling campaigns, weaving new
 * villages in, investors and partnerships. A village may have none of these
 * on its chart. So the platform carries them as SUGGESTIONS a member can see
 * under the character and propose to the village through the ordinary role
 * proposal, never as rows written into anyone's chart (nothing turns on by
 * itself, constitution IV.2; adoption follows the power, I.2).
 *
 * Brand neutral by rule (IV.7): plain names any village can rename, written
 * to lead with the work (III.6). A village's own names for them live in that
 * village's own data. Money words describe the work and never what a token
 * does (V.1). Raising money from people outside the village is the kind of
 * work the plan's guardrails flag for advice, so the accountability says so.
 *
 * Keyed by the archetype's stable `key`, never its display name, which a
 * village may change.
 */
export interface CharacterRoleIdea {
  /** Stable slug, unique across all suggestions. */
  slug: string;
  /** The archetype key this suggestion is offered under. */
  archetype: string;
  name: string;
  /** One line: why the role exists. */
  aim: string;
  /** What the role holds. */
  domain: string;
  accountabilities: readonly string[];
}

export const CHARACTER_ROLE_IDEAS: readonly CharacterRoleIdea[] = [
  {
    slug: "investment-and-partnerships",
    archetype: "catalyzing",
    name: "Investment and Partnerships",
    aim: "Bring in the capital and partners the village needs to build what it has agreed to build.",
    domain: "Conversations with investors, funders and partner organisations on the village's behalf.",
    accountabilities: [
      "Keep a clear list of what the village is raising for and why",
      "Meet and follow up with people and groups who might invest or partner",
      "Bring every offer back to the village before anything is agreed",
      "Check each offer with whoever the village names for advice before it is promised",
    ],
  },
  {
    slug: "crowd-pool-steward",
    archetype: "catalyzing",
    name: "Crowd Pool Steward",
    aim: "Run the village's crowd pooling campaigns so many people can each give a little toward one need.",
    domain: "Crowd pooling campaigns: their story, their updates and thanking the people who give.",
    accountabilities: [
      "Shape each campaign around one need the village has agreed",
      "Post updates while a campaign runs and when it closes",
      "Thank every backer and tell them what their gift became",
      "Name every kind of gift: time, skills, materials, tools and money",
    ],
  },
  {
    slug: "village-weaver",
    archetype: "catalyzing",
    name: "Village Weaver",
    aim: "Weave new villages and land projects into the network, so we share people, tools and what we learn.",
    domain: "Introductions to other villages and land projects, and the first steps of working together.",
    accountabilities: [
      "Meet land projects that could join or partner with the network",
      "Make introductions between people who should know each other",
      "Find what nearby villages both need and could share",
      "Bring each new connection back to the village with a next step",
    ],
  },
];

/** The suggestions offered under one archetype, in order. */
export function roleIdeasFor(archetypeKey: string): CharacterRoleIdea[] {
  return CHARACTER_ROLE_IDEAS.filter((s) => s.archetype === archetypeKey);
}

/**
 * The suggestions a village's chart does not already carry, matched by name
 * case-insensitively, so a village that already made "Village Weaver" is not
 * offered it twice.
 */
export function unmetRoleIdeas(archetypeKey: string, chartRoleNames: readonly string[]): CharacterRoleIdea[] {
  const have = new Set(chartRoleNames.map((n) => String(n ?? "").trim().toLowerCase()));
  return roleIdeasFor(archetypeKey).filter((s) => !have.has(s.name.toLowerCase()));
}
