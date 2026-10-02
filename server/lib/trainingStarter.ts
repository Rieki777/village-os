/**
 * The starter training list a fresh deployment gets, once, when the table is
 * empty.
 *
 * Two of these descriptions once named one village outright, so every village
 * that installed this platform opened its training page and read another
 * village's name back at itself on day one. The first fix swapped that name
 * for the new village's own, which kept the claim and changed its subject:
 * "the foundation of how we talk to each other at <your village>" and "how
 * <your village> makes decisions together" told members that a village which
 * had chosen nothing yet already talks in NVC and decides by consent. That is
 * the never-build rule "seeding aspirational structure"
 * (docs/COORDINATION_SUBSTRATE.md, section 7).
 *
 * So each description now says what the practice IS and never that this
 * village practises it. The list itself stays: the practices are the
 * platform's opinion about what a village might learn first, and whether one
 * is required is the village's choice to make later (the canvas plan's Team
 * block). The caller still hands in the village name; nothing here reads it,
 * which is why the parameter is marked unused rather than removed, and a
 * description that starts using it again is making the claim again.
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
export function starterTrainingModules(_village?: string) {
  return [
    {
      id: "nvc-intro",
      title: "Introduction to Nonviolent Communication",
      description:
        "The four components of Nonviolent Communication, and why they matter when people live and work side by side.",
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
        "The difference between consensus and consent, and why it matters when a group decides together.",
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
