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
    blurb: "Creating tools, systems, and infrastructure that serve the regenerative movement.",
    examples: [
      "Building out the village platform",
      "Creating infrastructure for the land",
      "Developing governance tools",
      "Building dashboards and tracking systems",
    ],
    sigil: "hammer",
  },
  {
    key: "researching",
    name: "The Architect",
    subtitle: "Researching & Architecting",
    blurb: "Designing frameworks, exploring possibilities, and mapping the path forward.",
    examples: [
      "Designing tokenomics models",
      "Researching regenerative land practices",
      "Creating organizational frameworks",
      "Mapping ecosystem relationships",
    ],
    sigil: "lens",
  },
  {
    key: "facilitating",
    name: "The Spaceholder",
    subtitle: "Facilitating & Space Holding",
    blurb: "Creating containers for collaboration, learning, and community growth.",
    examples: [
      "Facilitating community sessions",
      "Hosting season incubators",
      "Running onboarding calls",
      "Holding space for conflict resolution",
    ],
    sigil: "circle",
  },
  {
    key: "catalyzing",
    name: "The Catalyst",
    subtitle: "Catalyzing & Connecting",
    blurb: "Weaving relationships, building bridges, and sparking new possibilities.",
    examples: [
      "Helping onboard new land projects",
      "Making key introductions",
      "Connecting people with projects",
      "Building partnership networks",
    ],
    sigil: "thread",
  },
  {
    key: "storytelling",
    name: "The Storyteller",
    subtitle: "Storytelling & Communicating",
    blurb: "Sharing the vision, documenting the journey, and drawing others in.",
    examples: [
      "Telling the story of the land",
      "Creating content that carries the work",
      "Documenting the journey",
      "Keeping the outside world in the loop",
    ],
    sigil: "book",
  },
];

/**
 * The stable identifiers, derived from the cast rather than written twice.
 *
 * Two lists of five would be one refactor from disagreeing, and the disagreement
 * would be silent: a key that no longer matches simply returns nothing.
 */
export const ARCHETYPE_KEYS: readonly string[] = ARCHETYPES.map((a) => a.key);
