/**
 * The starter training list a fresh deployment gets, once, when the table is
 * empty.
 *
 * Two of these descriptions once named one village outright, so every village
 * that installed this platform opened its training page and read another
 * village's name back at itself on day one. The name is a parameter, read at
 * seed time from the merged config (brand overlay over the gameConfig
 * default), which is not known at module load.
 *
 * Only the identity moved. The practices are the platform's opinion about what
 * a village should learn first and they stay exactly as written.
 *
 * ── EVERY ONE SAYS `mandatory: true`, AND IT HAS TO ─────────────────────────
 *
 * The table is a dbCollection, and a dbCollection insert names every column in
 * its spec. A module seeded without the key is written with `mandatory` as 0,
 * whatever migration 0197's DEFAULT 1 says, and a fresh village's Participant
 * rung would then open on nothing at all.
 *
 * Moved here out of server/index.ts, whose line ratchet only turns down.
 */
export function starterTrainingModules(village: string) {
  return [
    {
      id: "nvc-intro",
      title: "Introduction to Nonviolent Communication",
      description:
        `The foundation of how we talk to each other at ${village}. Learn the four components of NVC and why they matter.`,
      type: "Video",
      url: "",
      mandatory: true,
      order: 1,
    },
    {
      id: "authentic-relating",
      title: "Authentic Relating Practices",
      description:
        "Games and practices for deeper, more honest connection with the people around you.",
      type: "Practice",
      url: "",
      mandatory: true,
      order: 2,
    },
    {
      id: "consent-decisions",
      title: "Consent-Based Decision Making",
      description:
        `How ${village} makes decisions together: the difference between consensus and consent, and why it matters.`,
      type: "Article",
      url: "",
      mandatory: true,
      order: 3,
    },
    {
      id: "circle-facilitation",
      title: "Circle Facilitation Basics",
      description:
        "How to hold and participate in a circle meeting. The roles, the rhythms, and the practices.",
      type: "Workshop",
      url: "",
      mandatory: true,
      order: 4,
    },
  ];
}
