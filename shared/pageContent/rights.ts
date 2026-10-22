/**
 * The two rights pages (/resident-rights, /steward-rights), as fields.
 *
 * ONE BUILDER, TWO SPECS. The pages share a skeleton: a hero, a co-ownership
 * card, a list of rights, a list of responsibilities, a progression of
 * stages and a closing invitation. The resident page adds one section, the
 * vision for a resident's finances. So the skeleton is written once here and
 * each page hands it its own words.
 *
 * The defaults are the words each page carried in code until 2026-10-22,
 * moved here unchanged, EXCEPT the token rows Rye approved that day
 * (cust-audit/TOKEN_COPY_PROPOSAL.md rows 15-20): a token may be named, and no
 * sentence says what it does. So the resident "Dues Offset" right is now "A
 * Share in What We Build", the dues and finances paragraphs lose their token
 * sentence, the steward pay card says only that each card shows its worth,
 * and the steward stages no longer promise token access or more tokens.
 *
 * `{transfer}` IS THE RESIDENT PAGE'S OWN WORD. The Land Share card used to
 * splice Legal's `landShareTransferNote` into its sentence in code. It is a
 * word now, so a village that rewrites the card keeps the note wherever it
 * puts the word. Only /resident-rights fills it (a space and the note, or
 * nothing when Legal has none); anywhere else it stays visible as typed,
 * which tells a founder it does nothing there.
 *
 * LIMITS start from cust-audit/pages-D-guides-rights.md and were then raised
 * where today's own copy is longer (the resident "Village Dues" card runs to
 * about 400 characters) and proven at 1280, 390 and 320 pixels wide.
 */
import type { FieldSpec, ListSpec, PageSpec, SectionSpec } from "./types";

type Row = Readonly<Record<string, string>>;

interface RightsListWords {
  eyebrow: string;
  heading: string;
  intro: string;
  items: readonly Row[];
}

interface RightsPageWords {
  id: string;
  label: string;
  path: string;
  /** "resident" or "steward", for the editor's labels. */
  who: string;
  /** Extra help on a card's description, for a word only this page fills. */
  descriptionHelp?: string;
  hero: { eyebrow: string; headline: string; intro: string };
  ownership: { heading: string; body: string };
  rights: RightsListWords;
  responsibilities: RightsListWords;
  /** The resident page's money section. A page without it has no such section. */
  finances?: { heading: string; body: string; body2: string; body3: string };
  progression: { eyebrow: string; heading: string; intro: string; stages: readonly Row[]; footnote: string };
  cta: {
    heading: string;
    body: string;
    primaryLabel: string;
    primaryWhere: string;
    secondaryLabel: string;
    secondaryWhere: string;
  };
}

const eyebrowField = (value: string): FieldSpec => ({
  key: "eyebrow",
  label: "Small label above the heading",
  kind: "text",
  max: 24,
  default: value,
});

function cardList(label: string, itemLabel: string, words: RightsListWords, descriptionHelp?: string): ListSpec {
  return {
    key: "items",
    label,
    help: "Up to eight cards, two to a row on a wide screen. Each gets the next icon in a fixed set.",
    itemLabel,
    titleKey: "title",
    minItems: 1,
    maxItems: 8,
    fields: [
      { key: "title", label: "Title", kind: "text", max: 45, default: "" },
      {
        key: "description",
        label: "Description",
        help: descriptionHelp,
        kind: "long",
        max: 420,
        default: "",
      },
    ],
    default: words.items,
  };
}

function cardSection(id: string, label: string, shows: string, itemLabel: string, words: RightsListWords, descriptionHelp?: string): SectionSpec {
  return {
    id,
    label,
    shows,
    hideable: true,
    fields: [
      eyebrowField(words.eyebrow),
      { key: "heading", label: "Heading", kind: "text", max: 45, default: words.heading },
      { key: "intro", label: "Sentence under the heading", kind: "long", max: 160, default: words.intro },
    ],
    lists: [cardList(label, itemLabel, words, descriptionHelp)],
  };
}

function rightsPage(words: RightsPageWords): PageSpec {
  const sections: SectionSpec[] = [
    {
      id: "hero",
      label: "Top of the page",
      shows: "The first thing a visitor sees, on the coloured band.",
      fields: [
        { key: "eyebrow", label: "Small label above the headline", kind: "text", max: 30, default: words.hero.eyebrow },
        { key: "headline", label: "Headline", kind: "text", max: 45, default: words.hero.headline },
        { key: "intro", label: "Sentence under the headline", kind: "long", max: 240, default: words.hero.intro },
      ],
    },
    {
      id: "ownership",
      label: "Co-ownership card",
      shows: "The single card just under the top of the page.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 45, default: words.ownership.heading },
        { key: "body", label: "Paragraph", kind: "long", max: 380, default: words.ownership.body },
      ],
    },
    cardSection("rights", "Rights", `The cards listing what a ${words.who} holds.`, "Right", words.rights, words.descriptionHelp),
    cardSection(
      "responsibilities",
      "Responsibilities",
      `The cards listing what a ${words.who} carries.`,
      "Responsibility",
      words.responsibilities,
    ),
  ];

  if (words.finances) {
    sections.push({
      id: "finances",
      label: "The vision for finances",
      shows: "The gold-edged card after the responsibilities.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 50, default: words.finances.heading },
        { key: "body", label: "First paragraph", kind: "long", max: 450, default: words.finances.body },
        {
          key: "body2",
          label: "Second paragraph",
          help: "Leave blank for none.",
          kind: "long",
          max: 300,
          default: words.finances.body2,
          optional: true,
        },
        {
          key: "body3",
          label: "Third paragraph",
          help: "Leave blank for none.",
          kind: "long",
          max: 180,
          default: words.finances.body3,
          optional: true,
        },
      ],
    });
  }

  sections.push(
    {
      id: "progression",
      label: "How rights grow",
      shows: "The stages a person moves through, one row each.",
      hideable: true,
      fields: [
        eyebrowField(words.progression.eyebrow),
        { key: "heading", label: "Heading", kind: "text", max: 45, default: words.progression.heading },
        { key: "intro", label: "Sentence under the heading", kind: "long", max: 220, default: words.progression.intro },
        {
          key: "footnote",
          label: "Small print under the stages",
          help: "Leave blank for none.",
          kind: "text",
          max: 120,
          default: words.progression.footnote,
          optional: true,
        },
      ],
      lists: [
        {
          key: "stages",
          label: "Stages",
          help: "Up to five, first to last. Each gets the next icon in a fixed set.",
          itemLabel: "Stage",
          titleKey: "level",
          minItems: 1,
          maxItems: 5,
          fields: [
            { key: "level", label: "Name", kind: "text", max: 28, default: "" },
            { key: "description", label: "What it brings", kind: "text", max: 100, default: "" },
            {
              key: "years",
              label: "When (a short tag, like Year 3+)",
              help: "Leave blank for no tag.",
              kind: "text",
              max: 12,
              default: "",
              optional: true,
            },
          ],
          default: words.progression.stages,
        },
      ],
    },
    {
      id: "cta",
      label: "Closing invitation",
      shows: "The last section of the page, with two buttons.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: words.cta.heading },
        { key: "body", label: "Sentence under the heading", kind: "long", max: 160, default: words.cta.body },
        {
          key: "primaryLabel",
          label: "First button",
          help: `Goes to ${words.cta.primaryWhere}.`,
          kind: "text",
          max: 32,
          default: words.cta.primaryLabel,
        },
        {
          key: "secondaryLabel",
          label: "Second button",
          help: `Goes to ${words.cta.secondaryWhere}. Leave blank for one button.`,
          kind: "text",
          max: 32,
          default: words.cta.secondaryLabel,
          optional: true,
        },
      ],
    },
  );

  return { id: words.id, label: words.label, path: words.path, sections };
}

export const RIGHTS_RESIDENT_PAGE: PageSpec = rightsPage({
  id: "rights-resident",
  label: "Resident rights",
  path: "/resident-rights",
  who: "resident",
  descriptionHelp:
    "{transfer} becomes your Land Share transfer note from Legal (a space, then the note), or nothing when Legal has none.",
  hero: {
    eyebrow: "Resident Space",
    headline: "Your Rights and Responsibilities",
    intro:
      "Living at {village} means you are not a tenant. You are a co-owner of the whole village. These are the rights that protect you and the responsibilities that make this place worth protecting.",
  },
  ownership: {
    heading: "You Live Here. This Is Yours.",
    body: "The land at {village} is held collectively, not by a landlord, not by a developer, not by any single person. Every resident is a steward of the whole of it. Your home is your private space. The rest belongs to all of you. Approach every interaction with the land and the community from that place: this is mine, and it's also all of ours.",
  },
  rights: {
    eyebrow: "What You Hold",
    heading: "Your Rights as a Resident",
    intro:
      "These rights are protected by community governance structures and the Land Share Agreement, not by goodwill alone.",
    items: [
      {
        title: "Your Land Share is Yours",
        description:
          "Your Land Share Agreement gives you long-term security on your piece of this land, renewable, transferable to your children{transfer}, and protected by community ownership structures that ensure the land itself can never be sold away from the community.",
      },
      {
        title: "Security Through Community Ownership",
        description:
          "The land belongs to all of us collectively. That means no single person can take it away, sell it off, or change its use without community consent. Your home sits on ground that is held in trust for the whole, including your family, and the families that come after.",
      },
      {
        title: "Voice in Community Life",
        description:
          "Residents hold full voice in the Circles that govern daily community life. As you grow into the community and reach the appropriate milestones, your governance rights deepen, from participating in decisions that affect your daily life to shaping the long-term direction of {village}.",
      },
      {
        title: "Access to All Commons",
        description:
          "The trails, food forests, gathering spaces, streams, ponds, and the shared land are yours to use and enjoy. Seasonal festivals, community events, potlucks, and village celebrations are part of your life here.",
      },
      {
        title: "Community Services and Care",
        description:
          "As a resident, you have access to the wellness programs, education offerings, healing arts, and community care that {village} develops together. The businesses and services that grow here serve the community first.",
      },
      // TOKEN_COPY_PROPOSAL row 15 (Rye, 2026-10-22).
      {
        title: "A Share in What We Build",
        description:
          "The vision is a community where shared business profits make life here net-positive for every resident.",
      },
    ],
  },
  responsibilities: {
    eyebrow: "What You Carry",
    heading: "Your Responsibilities as a Resident",
    intro:
      "This is what it means to live here: the beautiful parts and the full weight of belonging to a place and the people in it.",
    items: [
      {
        title: "Care for Your Home and Its Surroundings",
        description:
          "Your home is your space and the community's landscape. Maintain your home to a standard that honors the land around it, keeping shared pathways clear, managing your immediate space with care, and contributing to the beauty of the village.",
      },
      {
        title: "Act as a Co-Owner",
        description:
          "You live here. This place is yours as much as it is anyone's. Pick up what needs picking up. Notice what others might miss. Bring a co-owner's eye to every interaction with the land, the buildings, and the community. Not because you have to, because this place is actually yours.",
      },
      {
        title: "Contribute to Maintenance",
        description:
          "The village runs on the shared effort of its residents. Every resident contributes time to the maintenance of shared spaces, infrastructure, and community assets. This isn't outsourced, it's how we stay alive. Details of your contribution commitment are agreed during your residency onboarding.",
      },
      // TOKEN_COPY_PROPOSAL row 16: the token sentence is gone, the rest is as it was.
      {
        title: "Village Dues",
        description:
          "Monthly village dues cover utilities, shared infrastructure maintenance, and community services. The vision is for dues to be fully covered by profits from {village}'s shared businesses, the retreat center, cafe, wellness offerings, and other enterprises, creating a net-positive financial life for all residents. Exact monthly amounts will be shared before signing your Land Share Agreement.",
      },
      {
        title: "Participate in Community Processes",
        description:
          "Living here means showing up, to Circle meetings that affect your domain, to conflict resolution processes when they arise, to seasonal votes, and to the community governance that keeps everything running. Showing up is required. It's what makes self-governance real.",
      },
      {
        title: "Honor the Good Neighbor Principles",
        description:
          "The Good Neighbor principles are a living guide to how we share space here. They cover noise, boundaries, shared resources, children and families, and how we handle conflict. Every resident commits to upholding and practicing them.",
      },
      {
        title: "Raise the Next Generation Together",
        description:
          "Children here are raised by the whole village, not just their parents. As a resident, you share responsibility for a child-safe, child-enriching environment, showing up for Children's Play Days, respecting family spaces, and contributing to the culture that children grow up in.",
      },
    ],
  },
  finances: {
    heading: "The Vision for Your Finances Here",
    body: "Village dues exist to keep the infrastructure running, water, power, roads, shared maintenance. Right now, they're a cost. The longer-term vision is different: as {village}'s shared businesses mature, the retreat center, the cafe, the wellness center, the artisan market, the education programs, the revenue they generate flows back into the community.",
    // TOKEN_COPY_PROPOSAL row 17.
    body2:
      "The goal is a life here that is economically net-positive. Where your business participation or your role in community operations covers your dues and gives you back more than you put in.",
    body3:
      'This is what "Wealth Through Contribution" actually means. Not a promise. A design intention we\'re building toward together.',
  },
  progression: {
    eyebrow: "Deepening Over Time",
    heading: "Rights Grow With Your Roots",
    intro:
      "The longer you live here, the deeper your governance voice becomes. This is a recognition of wisdom that can only come from time, presence, and commitment.",
    stages: [
      { level: "Resident", description: "Full access to commons, housing rights, community participation", years: "Year 1+" },
      {
        level: "Established Resident",
        description: "Deeper governance voice, eligible for Circle Representative roles",
        years: "Year 3+",
      },
      {
        level: "Long-Term Resident",
        description: "Senior voice in community decisions, Sage eligibility, rights of nature representation",
        years: "Year 7+",
      },
    ],
    footnote: "Year thresholds are approximate and will be confirmed in the Resident Agreement.",
  },
  cta: {
    heading: "Ready to Call This Home?",
    body: "Your journey begins with a Community Call. Come meet the team, ask your questions, and feel what's possible here.",
    primaryLabel: "Return to Resident Journey",
    primaryWhere: "the Resident journey page",
    secondaryLabel: "Read Good Neighbor Principles",
    secondaryWhere: "the Good Neighbor page",
  },
});

export const RIGHTS_STEWARD_PAGE: PageSpec = rightsPage({
  id: "rights-steward",
  label: "Steward rights",
  path: "/steward-rights",
  who: "steward",
  hero: {
    eyebrow: "Village Steward Space",
    headline: "Your Rights and Responsibilities",
    intro:
      "This is a covenant between co-owners, not a legal document. Every Village Steward holds both, the rights that come from real ownership of this place, and the responsibilities that make those rights worth something.",
  },
  ownership: {
    heading: "You Are a Co-Owner of This Village",
    body: 'Not in a passive sense. Not in a "you paid for something" sense. In the deepest sense, the land, the buildings, the culture, the economy, the future of this place are in your hands as much as anyone else\'s. Act from that space. Steward it as if you built it, because you are building it, right now.',
  },
  rights: {
    eyebrow: "What You Hold",
    heading: "Your Rights as a Steward",
    intro:
      "These are not privileges granted from above. They are yours because you showed up, committed, and earned them through the journey.",
    items: [
      {
        title: "Voice in Governance",
        description:
          "As a Village Steward you hold a genuine voice in how this community is shaped. You have the right to participate in Circle consent rounds, vote on decisions within your domain, and elect representatives to the Leadership Council. Your perspective matters at every level.",
      },
      // TOKEN_COPY_PROPOSAL row 18: the card names no token and says nothing a token does.
      {
        title: "Get Paid for Your Contribution",
        description: "Every role you hold and every quest you complete shows what it is worth on its own card.",
      },
      {
        title: "Apply for Seasonal Roles",
        description:
          "Once you complete your Co-Creator Right of Passage, you have the right to propose yourself for any seasonal role that fits your gifts, whether that's a Circle facilitation role, a land stewardship position, or a new role you help design. Roles are renewed by consent each season.",
      },
      {
        title: "Advance Along the Path",
        description:
          "After multiple seasons serving in a role, you earn the right to be recognized as a Guide, a mentor and anchor for those coming after you. After seasons as a Guide, you may become a Sage, holding the highest governance voice and long-term vision for the village.",
      },
      {
        title: "Access to Shared Land and Commons",
        description:
          "The land is yours to steward. You have the right to access all common areas, food forests, trails, gathering spaces, and natural features of the land. You can participate in every seasonal festival, community event, and village gathering.",
      },
      {
        title: "Retreat and Wellness Access",
        description:
          "As a contributing steward, you have access to {village}'s wellness offerings at community rates. Retreat facilities, healing arts programs, and wellness services are part of what this community builds together, and you are part of what makes them possible.",
      },
    ],
  },
  responsibilities: {
    eyebrow: "What You Carry",
    heading: "Your Responsibilities as a Steward",
    intro:
      "Rights and responsibilities are two sides of the same belonging. One without the other isn't community, it's just a transaction.",
    items: [
      {
        title: "Show Up for Your Circle",
        description:
          "Your Circle is counting on you. Attend meetings consistently, participate in consent rounds, and bring your whole self to the governance of your domain. If you can't make it, communicate early and often.",
      },
      {
        title: "Act as a Co-Owner",
        description:
          "Every steward is a co-owner of this village. Not in a legal technicality, in a lived reality. Approach every decision, every piece of land, every shared resource as if it belongs to you and to everyone here, because it does. Pick up what needs picking up. Fix what needs fixing. Notice what others might miss.",
      },
      {
        title: "Take On Quests",
        description:
          "Quests are how the village grows. As a steward you commit to actively taking on quests that stretch your contribution, building, tending, hosting, documenting, organizing. Your engagement keeps the community alive.",
      },
      {
        title: "Practice the Community Ways",
        description:
          "{village} runs on Nonviolent Communication, authentic relating, and consent-based decision-making. As a steward, you commit to practicing these tools, not just knowing them. When conflict arises, you bring it to the appropriate process before it festers.",
      },
      {
        title: "Contribute to the Seasonal Rhythm",
        description:
          "Every three months the community shapes its next season. Your presence in that vote matters. Attend seasonal transitions, participate in harvest circles and planting celebrations, and help decide collectively what {village} focuses on next.",
      },
      {
        title: "Lift Others as You Rise",
        description:
          "Your path from Visitor to Co-Creator to Guide to Sage is a relay. As you advance, you carry responsibility for welcoming newcomers, mentoring Initiates, and making it easier for the next person to find their place here.",
      },
    ],
  },
  progression: {
    eyebrow: "Your Path Forward",
    heading: "Rights Deepen as You Grow",
    intro:
      "Your rights and voice grow with your commitment, in recognition that those who have poured the most into this place hold the most wisdom for its future.",
    // TOKEN_COPY_PROPOSAL rows 19 and 20.
    stages: [
      { level: "Co-Creator", description: "Full governance voice, seasonal role eligibility", years: "" },
      { level: "Guide", description: "Mentorship responsibilities, voice in cross-circle decisions", years: "" },
      {
        level: "Sage",
        description: "Highest governance voice, wisdom keeper, long-term strategic guidance for the village",
        years: "",
      },
    ],
    footnote: "",
  },
  cta: {
    heading: "Ready to Begin?",
    body: "The Steward journey starts with a single step, showing up to a Community Call and saying yes to what's calling you.",
    primaryLabel: "Return to Steward Journey",
    primaryWhere: "the Steward journey page",
    secondaryLabel: "Explore Quests",
    secondaryWhere: "the Quests page",
  },
});
