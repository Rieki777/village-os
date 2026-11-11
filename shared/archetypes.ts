/**
 * The five archetypal contributions, as classes. The cast of the game.
 *
 * WHY THIS IS IN shared/ AND NOT IN THE ECONOMY SEED. It used to be a private
 * const inside `server/lib/economySeed.ts`, a file about seeding tokens and
 * mint rules. No client file, no shared file and no migration named these five,
 * so the only way to find the identity of the whole game was to already know
 * where it lived. A lane looking for them could not.
 *
 * THE KEYS ARE IDENTIFIERS AND ARE NOT VOCABULARY. `building`, `researching`,
 * `facilitating`, `catalyzing` and `storytelling` are joined on by
 * `openPathsFor` (server/lib/characters.ts), by the per-power affinity map, and
 * by every character row a member has ever chosen. A renamed key does not fail:
 * it silently matches nothing, which is why the admin editor cannot reach them
 * and why `ARCHETYPE_KEYS` exists to be asserted against.
 *
 * EVERYTHING ELSE IS THE VILLAGE'S OWN WORDS. Name, subtitle, blurb, examples
 * and sigil are defaults a fork starts on, and a village edits any of them in
 * Admin. Once it does, `archetypes`.`customized` is set and the seed stops
 * overwriting that row, so a platform copy improvement travels to villages that
 * have not made the class theirs and never undoes one that has.
 */
export interface ArchetypeSeed {
  /** Stable identifier. Never editable, never a display string. */
  key: string;
  name: string;
  subtitle: string;
  blurb: string;
  examples: string[];
  /** A key into the shared glyph library, never a file path. */
  sigil: string;
}

export const ARCHETYPES: ArchetypeSeed[] = [
  {
    key: "building",
    name: "The Builder",
    subtitle: "Building & Developing",
    blurb: "Makes things real and keeps them running, on the land and beyond.",
    examples: [
      "Building homes and infrastructure",
      "Building tools, apps and systems",
      "Operations and logistics",
      "Maintenance and repair",
      "Developing and permitting",
      "Project management",
      "Growing food",
      "Cooking",
    ],
    sigil: "hammer",
  },
  {
    key: "researching",
    name: "The Architect",
    subtitle: "Researching & Designing",
    blurb: "Researches and designs the structure of things, physical and digital.",
    examples: [
      "Research",
      "Designing buildings, landscapes, systems and software",
      "Financial modeling and strategy",
      "Governance and legal structure",
      "Data and planning",
      "Decoration",
    ],
    sigil: "lens",
  },
  {
    key: "facilitating",
    name: "The Space Holder",
    subtitle: "Hosting & Space Holding",
    blurb: "Holds people, relationships and the shared field so everyone can thrive.",
    examples: [
      "Hosting and hospitality",
      "Facilitating and ceremony",
      "Care for children, elders and the sick",
      "Health and well-being",
      "Team and people support, onboarding",
      "Mediation and evolving through conflict",
      "Safeguarding",
    ],
    sigil: "circle",
  },
  {
    key: "catalyzing",
    name: "The Connector + Catalyst",
    subtitle: "Connecting & Catalyzing",
    blurb: "Connects people, resources and opportunities, and sparks what doesn't exist yet.",
    examples: [
      "Bringing in investors and funding",
      "Partnerships and networks",
      "Sales and enrolling residents",
      "Walking people through their journey",
      "Starting new initiatives, businesses and circles",
      "Founder, entrepreneur and visionary energy",
    ],
    sigil: "thread",
  },
  {
    key: "storytelling",
    name: "The Storyteller",
    subtitle: "Storytelling & Communicating",
    blurb: "Carries meaning between people, and from past to future.",
    examples: [
      "Communications, marketing and social media",
      "Writing, film and visual voice",
      "Teaching and training",
      "Documentation, memory and record-keeping",
      "Translation",
      "Reporting to the community and investors",
    ],
    sigil: "book",
  },
];

/**
 * NAMES THE PLATFORM ONCE SHIPPED, so a village still on them moves to the new
 * one (the five archetypes as roots, 11 Nov 2026: "Catalyst" became
 * "Connector + Catalyst", and "Spaceholder" became two words).
 *
 * A name belongs to the village, and the boot seed never restores one
 * (`seedEconomy`, server/lib/economySeed.ts). This list is the one narrow
 * exception: a row whose name is STILL exactly what the platform shipped, on a
 * class nobody has made their own (`customized = 0`), was never a village's
 * choice, so moving it to the new platform name takes nothing from anybody. A
 * village that typed any other name keeps it.
 */
export const ARCHETYPE_NAMES_RETIRED: Readonly<Record<string, readonly string[]>> = {
  facilitating: ["The Spaceholder"],
  catalyzing: ["The Catalyst"],
};

/**
 * The stable identifiers, derived from the cast rather than written twice.
 *
 * Two lists of five would be one refactor from disagreeing, and the disagreement
 * would be silent: a key that no longer matches simply returns nothing.
 */
export const ARCHETYPE_KEYS: readonly string[] = ARCHETYPES.map((a) => a.key);
