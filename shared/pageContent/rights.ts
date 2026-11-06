/**
 * The two rights pages (/resident-rights, /steward-rights), as fields.
 *
 * ONE BUILDER, TWO SPECS. The pages share a skeleton: a hero, a co-ownership
 * card, a list of rights, a list of responsibilities, a progression of
 * stages and a closing invitation. The resident page adds one section, the
 * vision for a resident's finances. So the skeleton is written once here and
 * each page hands it its own words.
 *
 * THE DEFAULTS ARE NEUTRAL STARTER TEXT (2026-10-23). Until then they were the
 * founding village's own words, and every other village showed that village's
 * land model, its businesses and its year thresholds as its own. The founding
 * village now holds its own copy (its record is in server/seeds/), so these
 * defaults say only what is true of any village: no tenure instrument, no
 * businesses, no years, no named circles, no decision method stated as fact.
 * A village writes its own rights over them in Admin, Pages.
 *
 * Two rulings bind them. A token may be named and no sentence says what it
 * does (Rye, 2026-10-22). No sentence restates that work is paid, because the
 * quest and role cards say it (Rye, 2026-10-23), which is why the steward
 * "Get Paid for Your Contribution" right is gone.
 *
 * `{transfer}` IS THE RESIDENT PAGE'S OWN WORD. The Land Share card used to
 * splice Legal's `landShareTransferNote` into its sentence in code. It is a
 * word now, so a village that rewrites the card keeps the note wherever it
 * puts the word. Only /resident-rights fills it (a space and the note, or
 * nothing when Legal has none); anywhere else it stays visible as typed,
 * which tells a founder it does nothing there.
 *
 * LIMITS start from cust-audit/pages-D-guides-rights.md and were then raised
 * where the founding village's own copy was longer (its "Village Dues" card
 * runs to about 400 characters) and proven at 1280, 390 and 320 pixels wide.
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
      label: "Card under the top",
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
    eyebrow: "For Residents",
    headline: "Your Rights and Responsibilities",
    intro:
      "Living at {village} means sharing a place with neighbors. Here is what you can count on, and what your neighbors can count on from you.",
  },
  ownership: {
    heading: "A Home Among Neighbors",
    body: "Your home is your own space. The land and buildings you share with your neighbors are looked after by everyone who lives here. Care for the shared places the way you care for your home, and expect the same of your neighbors.",
  },
  rights: {
    eyebrow: "What You Hold",
    heading: "Your Rights as a Resident",
    intro: "What every resident of {village} can count on.",
    items: [
      {
        title: "A Secure Home",
        description:
          "Your residency agreement sets out how long your home is yours, what it costs, and how it can be passed on{transfer}. Read it in full before you sign, and ask about anything that is unclear.",
      },
      {
        title: "A Voice in Village Life",
        description:
          "You can bring a proposal on anything that affects life here, and you have a say in the decisions that touch your home and your neighbors.",
      },
      {
        title: "Shared Spaces",
        description:
          "The shared land, buildings and gathering places are yours to use and enjoy, alongside everyone else who lives here.",
      },
      {
        title: "Privacy at Home",
        description: "Your home is your own. Neighbors, and anyone acting for the village, ask before they come in.",
      },
      {
        title: "A Fair Hearing",
        description:
          "If a dispute involves you, you hear what is said and you have your say before anything is decided.",
      },
      {
        title: "Clear Costs",
        description: "Before you sign, you see what you will pay and what it covers.",
      },
    ],
  },
  responsibilities: {
    eyebrow: "What You Carry",
    heading: "Your Responsibilities as a Resident",
    intro: "Village life works because everyone carries a share. This is what your neighbors count on from you.",
    items: [
      {
        title: "Care for Your Home and Its Surroundings",
        description:
          "Keep your home and the space around it in good order, keep shared paths clear, and leave shared spaces as you found them or better.",
      },
      {
        title: "Share the Work",
        description:
          "Shared spaces and systems need looking after. Every resident takes a share of that work, and the quest board shows what needs doing.",
      },
      {
        title: "Pay Your Village Dues",
        description: "Village dues cover the shared costs of living here. Keep up with them as agreed, and ask if anything about them is unclear.",
      },
      {
        title: "Take Part in Village Decisions",
        description:
          "Read the proposals that affect your home, have your say, and show up when the village gathers to decide.",
      },
      {
        title: "Be a Good Neighbor",
        description:
          "The Good Neighbor page sets out how {village} shares space and works through conflict. Every resident agrees to live by it.",
      },
      {
        title: "Welcome New Neighbors",
        description: "Help newcomers find their way, the way someone once helped you.",
      },
    ],
  },
  finances: {
    heading: "What Living Here Costs",
    body: "Village dues cover the shared costs of living at {village}, such as upkeep of shared spaces and common services. You see the amount and what it covers before you sign anything.",
    body2: "If you have questions about money, ask them before you commit. Clear answers up front make for good neighbors.",
    body3: "",
  },
  progression: {
    eyebrow: "Over Time",
    heading: "How Your Place Here Grows",
    intro: "Your place in {village} deepens as you take part. Each stage brings new ways to contribute.",
    stages: [
      { level: "Newcomer", description: "Settling in, meeting neighbors and learning how the village works", years: "" },
      { level: "Resident", description: "Taking part in decisions and sharing the work of the village", years: "" },
      { level: "Long-Term Resident", description: "Welcoming newcomers and keeping the village's memory", years: "" },
    ],
    footnote: "",
  },
  cta: {
    heading: "Ready to Call This Home?",
    body: "The Resident journey walks you through each step, from a first visit to moving in.",
    primaryLabel: "Return to Resident Journey",
    primaryWhere: "the Resident journey page",
    secondaryLabel: "Read the Good Neighbor Page",
    secondaryWhere: "the Good Neighbor page",
  },
});

export const RIGHTS_STEWARD_PAGE: PageSpec = rightsPage({
  id: "rights-steward",
  label: "Steward rights",
  path: "/steward-rights",
  who: "steward",
  hero: {
    eyebrow: "For Village Stewards",
    headline: "Your Rights and Responsibilities",
    intro:
      "Stewards look after the whole village: its work, its decisions and its people. Here is what you hold as a steward, and what {village} counts on you to carry.",
  },
  ownership: {
    heading: "You Help Shape This Village",
    body: "As a steward you take part in the decisions and the work that keep {village} going. Look after it as if you built it, because together with everyone here, you are building it.",
  },
  rights: {
    eyebrow: "What You Hold",
    heading: "Your Rights as a Steward",
    intro: "These rights come with the commitment you make as a steward.",
    items: [
      {
        title: "Voice in Governance",
        description:
          "You can bring proposals, take part in your circle's decisions, and have your say on the decisions that affect the whole village.",
      },
      {
        title: "Take On a Role",
        description:
          "You can propose yourself for a role that fits your gifts, or propose a new one {village} needs. Every role has a term, and the village agrees who holds it.",
      },
      {
        title: "Grow Along the Path",
        description:
          "As you contribute, you move along {village}'s path of growth, taking on more responsibility and helping the people who come after you.",
      },
      {
        title: "Shared Spaces",
        description:
          "The shared land and gathering places are yours to use and look after, and you are welcome at village gatherings.",
      },
    ],
  },
  responsibilities: {
    eyebrow: "What You Carry",
    heading: "Your Responsibilities as a Steward",
    intro: "Rights and responsibilities go together. This is what the village counts on from its stewards.",
    items: [
      {
        title: "Show Up for Your Circle",
        description:
          "Come to your circle's meetings, take part in its decisions, and let people know early when you can't make it.",
      },
      {
        title: "Look After the Whole",
        description:
          "Treat every shared space, resource and decision as yours to care for. Pick up what needs picking up, and notice what others might miss.",
      },
      {
        title: "Take On Quests",
        description:
          "Quests are how the work of the village gets done. Take on quests that use your gifts, and propose new ones when you see a need.",
      },
      {
        title: "Handle Conflict With Care",
        description:
          "When conflict comes up, speak directly and kindly, and bring it to the village's way of resolving conflict before it grows.",
      },
      {
        title: "Take Part in Each Season",
        description: "When a season turns, help the village look back at what it did and decide together what comes next.",
      },
      {
        title: "Welcome Those Who Come Next",
        description: "Help newcomers find their place, share what you know, and make the path easier for the next person.",
      },
    ],
  },
  progression: {
    eyebrow: "Your Path Forward",
    heading: "Growing Into the Work",
    intro: "Your part in {village} grows with what you contribute. Each stage carries more responsibility for the whole.",
    stages: [
      { level: "Co-Creator", description: "Contributing steadily and taking part in village decisions", years: "" },
      { level: "Role Holder", description: "Holding a role for its term and carrying its work", years: "" },
      { level: "Guide", description: "Mentoring newer stewards and sharing what you have learned", years: "" },
      { level: "Sage", description: "Keeping the village's long view and helping it through hard decisions", years: "" },
    ],
    footnote: "",
  },
  cta: {
    heading: "Ready to Begin?",
    body: "The Steward journey walks you through each step, from your first visit to taking on a role.",
    primaryLabel: "Return to Steward Journey",
    primaryWhere: "the Steward journey page",
    secondaryLabel: "Explore Quests",
    secondaryWhere: "the Quests page",
  },
});
