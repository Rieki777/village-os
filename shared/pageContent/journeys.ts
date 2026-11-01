/**
 * The four journey pages (/investor, /steward, /resident, /prosperity), as
 * fields. One builder, four specs, because the pages share one skeleton: a
 * hero, bands about the village, a list of steps a visitor ticks off, and a
 * closing invitation.
 *
 * The defaults are the words the pages carried in code until 2026-10-22,
 * moved here unchanged except for the approved token copy (TOKEN_COPY rows 21
 * to 30, Rye 2026-10-22: a token may be named, and no sentence says what it
 * does), so switching a page onto its spec changes nothing a visitor sees.
 *
 * BUTTONS. Every button is a pair: its words and where it goes. Blank
 * "goes to" draws no button, which is how the four dead `#` buttons on
 * /resident ended. Two shortcuts keep the village's own settings wired:
 * `#events` is the Events page URL and `#contact` emails the contact address,
 * and either hides while its setting is blank. /investor adds `#pack-form` and
 * `#call-form` for its two forms.
 *
 * PAGE WORDS. Besides the `{words}` every page knows, a few fields take words
 * only their page can fill: `{count}` (how many steps, in words), and the ones
 * named in each page's help text ({range}, {guide}, {acronym}...). The page
 * fills them after the village's own words, so an unfilled one stays visible.
 */
import type { FieldSpec, ListSpec, PageSpec, SectionSpec } from "./types";

export const JOURNEY_IDS = ["investor", "steward", "resident", "prosperity"] as const;
export type JourneyId = (typeof JOURNEY_IDS)[number];

/** The shortcuts a "goes to" box understands besides an ordinary link. */
export const JOURNEY_TARGETS = {
  events: "#events",
  contact: "#contact",
  packForm: "#pack-form",
  callForm: "#call-form",
} as const;

const TARGET_HELP =
  "A page here (/visit), a full web address, or mailto:. #events opens your Events page URL and #contact emails your contact address; each hides while that setting is blank. Leave blank for no button.";
const INVESTOR_TARGET_HELP = `${TARGET_HELP} #pack-form and #call-form open this page's two forms.`;

const LINK_MAX = 300;
const BULLETS = 4;

function text(key: string, label: string, max: number, def: string, more: Partial<FieldSpec> = {}): FieldSpec {
  return { key, label, kind: "text", max, default: def, ...more };
}

function long(key: string, label: string, max: number, def: string, more: Partial<FieldSpec> = {}): FieldSpec {
  return { key, label, kind: "long", max, default: def, ...more };
}

function target(key: string, label: string, def: string, help: string): FieldSpec {
  return { key, label, kind: "link", max: LINK_MAX, default: def, optional: true, help };
}

/** A button: its words, and where it goes. */
function button(prefix: string, what: string, words: string, goesTo: string, help = TARGET_HELP): FieldSpec[] {
  return [
    text(`${prefix}Label`, `${what}: words`, 32, words),
    target(`${prefix}Target`, `${what}: goes to`, goesTo, help),
  ];
}

// ── Steps ────────────────────────────────────────────────────────────────

interface StepDefault {
  /** The id the page used for this step before 2026-10-22; only progress ticks saved under it read it. */
  legacyId: string;
  stage: string;
  title: string;
  description: string;
  bullets: readonly string[];
  label: string;
  target: string;
}

function stepRow(step: StepDefault): Record<string, string> {
  const row: Record<string, string> = {
    stage: step.stage,
    title: step.title,
    description: step.description,
  };
  for (let i = 0; i < BULLETS; i++) row[`bullet${i + 1}`] = step.bullets[i] ?? "";
  row.actionLabel = step.label;
  row.actionTarget = step.target;
  return row;
}

function stepsSection(opts: {
  heading: string;
  intro: string;
  steps: readonly StepDefault[];
  targetHelp: string;
  wordsHelp?: string;
}): SectionSpec {
  const list: ListSpec = {
    key: "items",
    label: "Steps",
    help: `Read top to bottom. Each gets the next icon in a fixed set, and a visitor can tick each one off.${opts.wordsHelp ? ` ${opts.wordsHelp}` : ""}`,
    itemLabel: "Step",
    titleKey: "title",
    minItems: 1,
    maxItems: 16,
    fields: [
      text("stage", "Stage (the small label)", 20, ""),
      text("title", "Title", 48, ""),
      long("description", "Description", 240, ""),
      ...Array.from({ length: BULLETS }, (_, i) =>
        text(`bullet${i + 1}`, `Point ${i + 1}`, 44, "", { optional: true, help: i === 0 ? "Shown when the step is opened. Blank points are left out." : undefined }),
      ),
      text("actionLabel", "Button words", 28, "", { optional: true }),
      target("actionTarget", "Button goes to", "", opts.targetHelp),
    ],
    default: opts.steps.map(stepRow),
  };
  return {
    id: "steps",
    label: "Steps",
    shows: "The list of steps a visitor ticks off, with a progress bar.",
    fields: [
      text("heading", "Heading", 40, opts.heading),
      long("intro", "Sentence under the heading", 160, opts.intro, {
        help: "{count} becomes how many steps there are, in words.",
      }),
    ],
    lists: [list],
  };
}

// ── Common sections ──────────────────────────────────────────────────────

interface HeroDefault {
  eyebrow: string;
  headline: string;
  highlight: string;
  intro: string;
  primary: readonly [string, string];
  secondary: readonly [string, string];
  /** The subject line `#contact` writes; without one a button's own words are used. */
  contactSubject?: string;
  introHelp?: string;
}

function heroSection(hero: HeroDefault, targetHelp: string): SectionSpec {
  return {
    id: "hero",
    label: "Top of the page",
    shows: "The first thing a visitor sees, over this page's picture (set in Make This Yours, Pictures).",
    fields: [
      text("eyebrow", "Small label beside the icon", 30, hero.eyebrow),
      text("headline", "Headline", 36, hero.headline, {
        help: "The biggest words on the page. Words over twelve letters do not fit a phone in one line.",
      }),
      text("highlight", "Words to show in colour", 24, hero.highlight, {
        optional: true,
        help: "A word or phrase from the headline, exactly as it appears there. Leave blank for none.",
      }),
      long("intro", "Paragraph under the headline", 280, hero.intro, hero.introHelp ? { help: hero.introHelp } : {}),
      ...button("primary", "First button", hero.primary[0], hero.primary[1], targetHelp),
      ...button("secondary", "Second button", hero.secondary[0], hero.secondary[1], targetHelp),
      ...(hero.contactSubject !== undefined
        ? [text("contactSubject", "Subject line when a button emails you", 60, hero.contactSubject, { help: "Used by every #contact button on this page." })]
        : []),
    ],
  };
}

function faqSection(heading: string): SectionSpec {
  return {
    id: "faq",
    label: "Questions",
    shows: "The heading over this page's questions. The questions themselves are edited in FAQs; with none, nothing shows.",
    fields: [text("heading", "Heading", 40, heading)],
  };
}

/** A heading, a paragraph and one button. */
function ctaBand(id: string, label: string, shows: string, d: { heading: string; body: string; cta: readonly [string, string]; bodyMax?: number }): SectionSpec {
  return {
    id,
    label,
    shows,
    hideable: true,
    fields: [
      text("heading", "Heading", 40, d.heading),
      long("body", "Paragraph", d.bodyMax ?? 200, d.body),
      ...button("cta", "Button", d.cta[0], d.cta[1]),
    ],
  };
}

/** The last band: a heading, a paragraph and up to two buttons. */
function closingBand(d: { heading: string; body: string; primary: readonly [string, string]; secondary: readonly [string, string]; targetHelp?: string; shows?: string }): SectionSpec {
  return {
    id: "closing",
    label: "Closing invitation",
    shows: d.shows ?? "The last band of the page. A button whose destination is blank or unset is left out.",
    hideable: true,
    fields: [
      text("heading", "Heading", 40, d.heading),
      long("body", "Paragraph", 200, d.body),
      ...button("primary", "First button", d.primary[0], d.primary[1], d.targetHelp),
      ...button("secondary", "Second button", d.secondary[0], d.secondary[1], d.targetHelp),
    ],
  };
}

interface JourneyDefinition {
  id: JourneyId;
  label: string;
  path: string;
  hero: HeroDefault;
  targetHelp?: string;
  beforeSteps: SectionSpec[];
  steps: { heading: string; intro: string; items: readonly StepDefault[]; wordsHelp?: string };
  afterSteps: SectionSpec[];
}

function buildJourney(def: JourneyDefinition): PageSpec {
  const help = def.targetHelp ?? TARGET_HELP;
  return {
    id: `journey-${def.id}`,
    label: def.label,
    path: def.path,
    sections: [
      heroSection(def.hero, help),
      ...def.beforeSteps,
      stepsSection({
        heading: def.steps.heading,
        intro: def.steps.intro,
        steps: def.steps.items,
        targetHelp: help,
        wordsHelp: def.steps.wordsHelp,
      }),
      ...def.afterSteps,
    ],
  };
}

// ── /investor ────────────────────────────────────────────────────────────

const INVESTOR_STEPS: StepDefault[] = [
  {
    legacyId: "discover",
    stage: "Curious",
    title: "Discover {village}",
    description: "Learn about our vision, values, and regenerative approach to community development.",
    bullets: ["Understand our mission and values", "Learn about the land and location", "Meet the founding team", "Ask questions in a live Q&A"],
    label: "Join Community Call",
    target: JOURNEY_TARGETS.events,
  },
  {
    legacyId: "request",
    stage: "Interested",
    title: "Request Investor Pack",
    description: "Receive the full investor pack: feasibility study, proformas, and development timeline.",
    bullets: ["15-year financial proformas", "Feasibility study with market analysis", "Development timeline and phases", "Legal structure overview"],
    label: "Request Pack",
    target: JOURNEY_TARGETS.packForm,
  },
  {
    legacyId: "call",
    stage: "Exploring",
    title: "Schedule Investment Call",
    description: "Connect one-on-one with our team to discuss your investment goals and how they align with {village}.",
    bullets: ["Discuss investment options", "Review financial projections", "Understand debt vs equity structures", "Explore your path to residency"],
    label: "Schedule Call",
    target: JOURNEY_TARGETS.callForm,
  },
  {
    legacyId: "commit",
    stage: "Committed",
    title: "Make Your Commitment",
    description: "Choose your investment vehicle and formalize your contribution to the {village} vision.",
    bullets: ["Select investment structure", "Review and sign agreements", "Transfer funds securely", "Receive investor updates"],
    label: "Contact Team",
    target: JOURNEY_TARGETS.contact,
  },
];

/** The four land and money figures, in tile order. Their values live in Admin, Settings. */
export const INVESTOR_FIGURE_IDS = ["appreciation", "appraisal", "projectedReturn", "targetRaise"] as const;

export const INVESTOR_JOURNEY: PageSpec = buildJourney({
  id: "investor",
  label: "Investor journey",
  path: "/investor",
  targetHelp: INVESTOR_TARGET_HELP,
  hero: {
    eyebrow: "Capital Contributor Journey",
    headline: "Invest in Regeneration",
    highlight: "Regeneration",
    intro:
      "Capital Contributors offer financial resources, credit lines, investments, or other capital resources. We prioritize investors who share the vision - capital structured to deliver real returns while keeping the village in the hands of the people who call it home.",
    primary: ["Request Investor Pack", JOURNEY_TARGETS.packForm],
    secondary: ["Join Community Call", JOURNEY_TARGETS.events],
    contactSubject: "Investment Commitment",
  },
  beforeSteps: [
    {
      id: "figures",
      label: "Key numbers",
      shows: "Tiles for the land and money figures you set in Admin, Settings. A tile shows only when its figure is set.",
      hideable: true,
      fields: [
        text("heading", "Heading", 40, "Key Numbers"),
        long("intro", "Sentence when figures are set", 160, "The figures this village has stated about its own land and its own raise."),
        long("empty", "Sentence when no figure is set", 160, "This village has not published any figures yet."),
        long("disclaimer", "Small print under the sentence", 140, "Past performance and projections are not guarantees of future results.", {
          optional: true,
          help: "Shown only when figures are set. Leave blank for none.",
        }),
      ],
      lists: [
        {
          key: "tiles",
          label: "Tiles",
          help: "One per figure, in this order. The figure and its small note come from Admin, Settings.",
          itemLabel: "Tile",
          titleKey: "title",
          fixed: INVESTOR_FIGURE_IDS,
          maxItems: INVESTOR_FIGURE_IDS.length,
          fields: [
            text("title", "Title", 24, ""),
            text("detail", "What the figure means", 80, ""),
          ],
          default: [
            { title: "Land Value", detail: "Change in the value of this village's land." },
            { title: "Appraisal", detail: "Current property valuation." },
            { title: "Projected Return", detail: "Based on phased development." },
            { title: "Target Raise", detail: "What this phase is raising." },
          ],
        },
      ],
    },
    {
      id: "personas",
      label: "Who invests",
      shows: "Coloured cards for the kinds of people who invest here.",
      hideable: true,
      fields: [
        text("heading", "Heading", 40, "Who Invests in {village}?"),
        long("intro", "Sentence under the heading", 140, "People with different goals and backgrounds are building at {village}. See if your story is here."),
      ],
      lists: [
        {
          key: "items",
          label: "People",
          help: "Up to nine. Each gets the next icon and colour in a fixed set.",
          itemLabel: "Person",
          titleKey: "title",
          maxItems: 9,
          fields: [text("title", "Who they are", 32, ""), text("subtitle", "Line under it", 80, "")],
          default: [
            { title: "Digital Nomad Couple", subtitle: "Invest from anywhere, build your future haven" },
            { title: "Worldschooling Family", subtitle: "Create a home base while the world is your classroom" },
            { title: "Retiree/Snowbird", subtitle: "A sanctuary of your own, with community and returns" },
            { title: "Longevity Seeker", subtitle: "Where your years are extended by regenerative living" },
            { title: "Remote Exec/Founder", subtitle: "Build wealth while building a better world" },
            { title: "Local & Regional Professional", subtitle: "Invest in your homeland's regenerative future" },
          ],
        },
      ],
    },
  ],
  steps: {
    heading: "Your Investment Journey",
    intro: "Track your progress as you explore investment opportunities at {village}.",
    items: INVESTOR_STEPS,
  },
  afterSteps: [
    {
      id: "phases",
      label: "Development phases",
      shows: "The dark band listing what gets built, each with a status and a progress bar.",
      hideable: true,
      fields: [
        text("heading", "Heading", 40, "Development Phases"),
        long("intro", "Sentence under the heading", 160, "With the potential 1% regenerative development loan, multiple phases can proceed simultaneously."),
        text("activeStatus", "Status drawn in gold", 16, "Planning", {
          help: "A phase whose status reads exactly this gets the gold label; any other status gets a pale one.",
        }),
      ],
      lists: [
        {
          key: "items",
          label: "Phases",
          help: "Up to eight, top to bottom.",
          itemLabel: "Phase",
          titleKey: "name",
          maxItems: 8,
          fields: [
            text("name", "Name", 32, ""),
            text("units", "Size (keys, homes, lots)", 16, ""),
            text("status", "Status", 16, ""),
            text("progress", "Progress, 0 to 100", 5, "", { help: "A whole number. The bar fills this far." }),
          ],
          default: [
            { name: "Resort & Retreat Center", units: "120-150 keys", status: "Planning", progress: "15" },
            { name: "Health Center", units: "1 facility", status: "Planning", progress: "10" },
            { name: "Community Center & Café", units: "1 facility", status: "Planning", progress: "20" },
            { name: "Show Homes", units: "10 homes", status: "Planning", progress: "25" },
            { name: "Residential Lots", units: "150+ lots", status: "Future", progress: "5" },
          ],
        },
      ],
    },
    faqSection("Investor FAQs"),
    closingBand({
      heading: "Ready to Explore?",
      body: "Connect with our team to discuss how {village} fits your investment goals.",
      primary: ["Request Investor Pack", JOURNEY_TARGETS.packForm],
      secondary: ["View the Master Plan", "/master-plan"],
      targetHelp: INVESTOR_TARGET_HELP,
    }),
    {
      id: "packForm",
      label: "Investor pack form",
      shows: "The form #pack-form opens.",
      fields: [
        text("rangeHint", "Hint inside the investment range box", 32, "e.g., $50K - $250K", {
          optional: true,
          help: "Grey example text. Leave blank for none.",
        }),
      ],
    },
    {
      id: "accreditation",
      label: "Accredited investor check",
      shows: "A box in the investor pack form a visitor must tick before it sends. Switch it off where your law has no such test.",
      hideable: true,
      fields: [
        long("statement", "What the visitor confirms", 140, "I confirm I am an accredited investor."),
        text("reminder", "Note when they send without ticking it", 80, "Please confirm you are an accredited investor."),
      ],
    },
    {
      id: "callForm",
      label: "Investment call form",
      shows: "The form #call-form opens, and the note shown once it is sent.",
      fields: [
        text("timeHint", "Hint inside the preferred time box", 32, "e.g., Tuesday 2pm EST", {
          optional: true,
          help: "Grey example text. Leave blank for none.",
        }),
        text("thanks", "Note once it is sent", 80, "Thank you! Our team will be in touch within 48 hours.", {
          help: "A promise to the visitor: say only what your team will keep.",
        }),
      ],
    },
  ],
});

// ── /steward ─────────────────────────────────────────────────────────────

const STEWARD_STEPS: StepDefault[] = [
  {
    legacyId: "community-call",
    stage: "Visitor",
    title: "Attend Community Call",
    description: "Learn about the basics and ask any immediate questions about {village}.",
    bullets: ["Meet the founding team", "Learn about our vision", "Ask questions live", "Connect with other visitors"],
    label: "Join Community Call",
    target: JOURNEY_TARGETS.events,
  },
  {
    legacyId: "events",
    stage: "Guest",
    title: "Participate in Events",
    description: "Join potlucks, events, workshops, and parties on our land to experience the community.",
    bullets: ["Weekly potlucks", "Village weaving gatherings", "Land tours", "Workshops and retreats"],
    label: "View Events",
    target: JOURNEY_TARGETS.events,
  },
  {
    legacyId: "immersion",
    stage: "Immersant",
    title: "Village Weaving Immersion (Optional)",
    description:
      "Optional: spend immersive time in the village learning how it operates, observing circles in action, and discovering where your gifts are most needed. A beautiful step, but not required.",
    bullets: ["Optional, join if it calls you", "2-4 week immersion period", "Shadow existing circle members", "Identify your R-Ikigai fit"],
    label: "Learn About Circles",
    target: "/circles",
  },
  {
    legacyId: "training",
    stage: "Participant",
    title: "Community Training",
    description:
      "Either complete our training in NVC (Nonviolent Communication), authentic relating, and other community practices, or demonstrate you already know and live these essential practices.",
    bullets: ["Do the training, or show you already live it", "Nonviolent Communication basics", "Authentic relating practices", "Consent-based decision making"],
    label: "Learn About Training",
    target: "/training",
  },
  {
    legacyId: "love-letter",
    stage: "Member",
    title: "Join the {village} Family",
    description: "Contemplate and sign our {commitment}, formally becoming a member of the community.",
    bullets: ["Understand our values deeply", "Reflect on your commitment", "Sign the {commitment}", "Join the {village} Family"],
    label: "Read the {commitment}",
    target: "/love-letter",
  },
  {
    legacyId: "circle",
    stage: "Contributor",
    title: "Participate in a Circle",
    description: "Join one of our sociocratic circles to contribute to community decision-making.",
    bullets: ["Choose a circle aligned with your gifts", "Attend circle meetings", "Participate in consent rounds", "Build relationships with circle members"],
    label: "Explore Circles",
    target: "/circles",
  },
  {
    legacyId: "quests",
    stage: "Quest Seeker",
    title: "Explore Quests",
    description:
      "Take on quests to contribute meaningfully to the village, or propose your own quest if you don't see your gift. A great way to demonstrate your commitment.",
    bullets: ["Browse available quests", "Choose quests matching your skills", "Submit your own quest proposal", "Get paid what each quest's card says"],
    label: "View Quests",
    target: "/quests",
  },
  {
    legacyId: "passage",
    stage: "Initiate",
    title: "Co-Creator Right of Passage",
    description: "Complete the right of passage with a vote from the Co-Creators circle to become a full member.",
    bullets: ["Demonstrate sustained commitment", "Present to the Co-Creators circle", "Receive consent from members", "Celebrate your passage"],
    label: "Read Co-Creator Criteria",
    target: "/co-creators-guide",
  },
  {
    legacyId: "roles",
    stage: "Co-Creator",
    title: "Explore & Apply for Roles",
    description: "Find a role that aligns with your gifts and apply for the upcoming season.",
    bullets: ["Review available roles", "Propose your role contribution", "Receive circle consent", "Begin your seasonal role"],
    label: "Explore Roles",
    target: "/roles",
  },
];

export const STEWARD_JOURNEY: PageSpec = buildJourney({
  id: "steward",
  label: "Steward journey",
  path: "/steward",
  hero: {
    eyebrow: "Village Steward Journey",
    headline: "Steward the Village",
    highlight: "Village",
    intro:
      "The Village Steward Space is for those coordinating and executing for the success of the whole Village. Join circles, take on roles, and help shape our regenerative community through sociocratic governance.",
    primary: ["Start with Community Call", JOURNEY_TARGETS.events],
    secondary: ["Learn How We Create", "/how-we-create"],
  },
  beforeSteps: [],
  steps: {
    heading: "Your Journey to Co-Creation",
    intro: "Each step deepens your connection with the community and helps you find where your gifts fit.",
    items: STEWARD_STEPS,
  },
  afterSteps: [
    {
      id: "ladder",
      label: "Path of growth",
      shows: "The green band of levels a steward grows through.",
      hideable: true,
      fields: [
        text("heading", "Heading", 40, "The Path of Growth"),
        long("intro", "Sentence under the heading", 160, "Each new season requires successful role proposals to continue. As you grow, so does your voice and responsibility."),
      ],
      lists: [
        {
          key: "items",
          label: "Levels",
          help: "Up to six. Each gets the next icon in a fixed set.",
          itemLabel: "Level",
          titleKey: "level",
          maxItems: 6,
          fields: [
            text("level", "Name", 16, ""),
            text("requirement", "How someone gets here", 60, ""),
            text("benefits", "What it brings", 64, ""),
          ],
          default: [
            { level: "Role Holder", requirement: "Apply and be approved for a seasonal role", benefits: "Voice in your circle" },
            { level: "Guide", requirement: "After multiple seasons in a role", benefits: "Mentorship responsibilities" },
            { level: "Sage", requirement: "After seasons as a Guide", benefits: "Highest voice, wisdom keeper, strategic guidance" },
          ],
        },
      ],
    },
    {
      id: "arc",
      label: "Long-term growth",
      shows: "The two cards under the path of growth.",
      hideable: true,
      fields: [
        text("heading", "Heading", 40, "Long-Term Growth"),
        long("intro", "Sentence under the heading", 160, "Your role deepens with each season."),
      ],
      lists: [
        {
          key: "items",
          label: "Cards",
          help: "Up to four. Each gets the next icon in a fixed set.",
          itemLabel: "Card",
          titleKey: "level",
          maxItems: 4,
          fields: [text("level", "Name", 16, ""), text("description", "Description", 60, "")],
          default: [
            { level: "Guide", description: "Mentor to newer stewards and circle facilitators" },
            { level: "Sage", description: "Village wisdom keeper and strategic guide" },
          ],
        },
      ],
    },
    ctaBand("seasons", "Seasons", "The band about how seasons turn here.", {
      heading: "Seasonal Festivals",
      body: "Every 3 months, the community votes on what kind of season comes next. Seasons aren't on a fixed cycle, they're chosen based on what {village} needs. Spring for new builds, Summer for events and energy, Fall for harvest and reflection, Winter for systems design and planning. Each seasonal transition is marked by a festival.",
      bodyMax: 420,
      cta: ["Learn About Our Seasons", "/seasonal-festivals"],
    }),
    ctaBand("rights", "Rights and responsibilities", "The band pointing to the steward covenant.", {
      heading: "Your Rights and Responsibilities",
      body: "As a Village Steward, you hold real ownership of this place, and real responsibility for it. Read the full covenant between co-owners.",
      cta: ["Read Rights and Responsibilities", "/steward-rights"],
    }),
    {
      id: "nextStep",
      label: "Your next step form",
      shows: "The form a would-be steward sends, and what they see once it is sent. Its call buttons go to your Events page URL and hide when that is blank.",
      hideable: true,
      fields: [
        text("heading", "Heading", 40, "Your Next Step"),
        long("body", "Paragraph", 200, "Tell us where you're coming from and what calls you here. We'll reach out with the right invitation."),
        text("giftsLabel", "First question", 60, "What gifts do you bring? (skills, time, passion)"),
        text("giftsHint", "Hint inside the first box", 80, "e.g. regenerative farming, facilitation, web development...", { optional: true }),
        text("questionLabel", "Second question", 60, "What called you to stewardship?"),
        text("questionHint", "Hint inside the second box", 100, "Share what resonated, what you're looking for, or any questions on your heart...", { optional: true }),
        text("submitLabel", "Send button", 40, "Begin My Stewardship Journey"),
        text("thanksHeading", "Heading once it is sent", 40, "Welcome, future Steward."),
        long("thanksBody", "Paragraph once it is sent", 200, "We've received your message and will be in touch soon with your next invitation into the village.", {
          help: "A promise to the visitor: say only what your team will keep.",
        }),
        text("thanksCta", "Call button once it is sent", 32, "Join the Next Community Call"),
        long("footnote", "Line under the send button", 120, "Or join our next community call to learn more first."),
        text("footnoteLink", "Words in that line that link to your events", 40, "join our next community call", {
          help: "Exactly as they appear in the line above.",
        }),
      ],
    },
    faqSection("Common Questions"),
  ],
});

// ── /resident ────────────────────────────────────────────────────────────

const RESIDENT_STEPS: StepDefault[] = [
  {
    legacyId: "community-call",
    stage: "Visitor",
    title: "Attend Community Call",
    description: "Learn about the basics and ask any immediate questions about living at {village}.",
    bullets: ["Meet the founding team", "Learn about our vision", "Ask questions live", "Connect with other visitors"],
    label: "Join Community Call",
    target: JOURNEY_TARGETS.events,
  },
  {
    legacyId: "events",
    stage: "Guest",
    title: "Attend Community Events",
    description: "Join potlucks, land tours, and community gatherings to experience {village}'s living culture.",
    bullets: ["Weekly potluck dinners", "Land tours with the founding team", "Community celebrations", "Children's events and family gatherings"],
    label: "View Events",
    target: JOURNEY_TARGETS.events,
  },
  {
    legacyId: "founding-seeder",
    stage: "Founding Seeder",
    title: "Become a Founding Seeder",
    description:
      "Join the Founding Seeders, our waitlist of soul-aligned people securing first access to homes and land at {village}. This is how you raise your hand and say: I'm serious about this.",
    bullets: ["Join the Founding Seeders waitlist", "First access to homes and land", "Priority as lots are released", "No obligation to purchase"],
    label: "Become a Founding Seeder",
    target: "",
  },
  {
    legacyId: "training",
    stage: "Participant",
    title: "Community Training",
    description:
      "Either complete our training in NVC (Nonviolent Communication), authentic relating, and other community practices, or demonstrate you already know and live these essential practices.",
    bullets: ["Do the training, or show you already live it", "Nonviolent Communication basics", "Authentic relating practices", "Consent-based decision making"],
    label: "Learn About Training",
    target: "/training",
  },
  {
    legacyId: "love-letter",
    stage: "Member",
    title: "Sign the {commitment} / Formal Membership",
    description: "Become an official member of the community by signing the membership agreement.",
    bullets: ["Read the founding principles", "Attend a membership orientation", "Sign the membership agreement", "Receive your member welcome package"],
    label: "Read the {commitment}",
    target: "/love-letter",
  },
  {
    legacyId: "housing",
    stage: "Explorer",
    title: "Explore Housing Options",
    description: "Browse available lots and housing options to find your perfect spot in the village.",
    bullets: ["Browse available lots", "Review home design options", "Understand pricing tiers", "Explore financing options"],
    label: "View Housing Options",
    target: "/housing",
  },
  {
    legacyId: "deposit",
    stage: "Deposit",
    title: "Put Down a Deposit on Your Future Home",
    description: "Secure your future home with a fully refundable deposit{range}. This holds your place and starts the real conversation.",
    bullets: ["Fully refundable deposit", "{deposit-summary}", "Reserves your future home", "Priority on your chosen lot"],
    label: "Reserve Your Home",
    target: "/reserve",
  },
  {
    legacyId: "background",
    stage: "Applicant",
    title: "Background Check",
    description: "Once your deposit is down, we complete a background check together. It's part of our commitment to community safety{background-note}.",
    bullets: ["Follows your deposit", "Standard background verification", "Community safety commitment", "Confidential handling"],
    label: "Coming Soon",
    target: "",
  },
  {
    legacyId: "fireside",
    stage: "Fireside",
    title: "Fireside Dinner With the Founding Team",
    description:
      "You're invited to an intimate 1-on-1 fireside dinner with the founding team, in person on the land, or online if you can't make it. A casual, beautiful friendship ritual where both sides explore the commitment fully.",
    bullets: ["Intimate 1-on-1 with the founders", "In person on the land, or online", "A friendship ritual, not an interview", "Explore mutual fit and commitment"],
    label: "By Invitation",
    target: "",
  },
  {
    legacyId: "family",
    stage: "Family Day",
    title: "Children's Play Day",
    description: "If you have children, attend our family day to see how kids thrive in our community.",
    bullets: ["Meet other families", "Experience child-friendly spaces", "Learn about our school plans", "Connect with parents"],
    label: "View Family Events",
    target: JOURNEY_TARGETS.events,
  },
  {
    legacyId: "passage",
    stage: "Initiate",
    title: "Resident Right of Passage",
    description: "Complete the passage with a vote from current residents. Review the Good Neighbor criteria.",
    bullets: ["Demonstrate commitment", "Present to residents", "Receive community consent", "Celebrate your passage"],
    label: "Good Neighbor Criteria",
    target: "/good-neighbor",
  },
  {
    legacyId: "land",
    stage: "Landowner",
    title: "Purchase Land Share Agreement",
    description: "Secure your land with a Land Share Agreement and required Land Credits.",
    bullets: ["Review agreement terms", "Secure financing if needed", "Complete land credits", "Sign your agreement"],
    label: "Learn About Land Shares",
    target: "",
  },
  {
    legacyId: "build",
    stage: "Builder",
    title: "Build Your Home",
    description: "Work with our approved builders or bring your own plans. Observe Resident Governance.",
    bullets: ["Choose your home design", "Select your builder", "Follow building guidelines", "Create your dream home"],
    label: "Building Guidelines",
    target: "/housing",
  },
  {
    legacyId: "move-in",
    stage: "Resident",
    title: "Move In Celebration!",
    description: "Welcome home! Celebrate with the {village} Family and begin your life in the village.",
    bullets: ["Community welcome ceremony", "Meet your neighbors", "Begin village life", "Celebrate your new home"],
    label: "Welcome Home",
    target: "",
  },
];

export const RESIDENT_JOURNEY: PageSpec = buildJourney({
  id: "resident",
  label: "Resident journey",
  path: "/resident",
  hero: {
    eyebrow: "Resident Co-Creator Journey",
    headline: "Make {village} Home",
    highlight: "Home",
    intro:
      "The Resident Space is for those coordinating the success of the whole Village from the perspective of Residents. Find your place in a loving community where all beings belong and thrive.",
    primary: ["Start with Community Call", JOURNEY_TARGETS.events],
    secondary: ["Explore Housing", "/housing"],
  },
  beforeSteps: [
    {
      id: "tenure",
      label: "Land share agreements",
      shows: "The band just under the top of the page, about how residents hold their land.",
      hideable: true,
      fields: [
        text("heading", "Heading", 40, "Land Share Agreements"),
        long(
          "body",
          "Paragraph",
          320,
          "Your Land Share Agreement gives you long-term access to your land with the ability to renew and pass down to your children{transfer-note}. The structure holds ownership in the community and gives your family security.",
          { help: "{transfer-note} becomes the transfer note from your legal settings, or nothing when that is blank." },
        ),
      ],
    },
  ],
  steps: {
    heading: "Your Path to Residency",
    intro: "Each step helps both sides decide. You figure out if {village} is right for you; we figure out the same.",
    items: RESIDENT_STEPS,
    wordsHelp:
      "{range} becomes \", \" and your deposit range, {deposit-summary} your short deposit figure, and {background-note} \", \" and your background check note; each becomes nothing while its setting is blank.",
  },
  afterSteps: [
    {
      id: "titles",
      label: "Titles for time here",
      shows: "The dark band of honorary titles for long presence.",
      hideable: true,
      fields: [
        text("heading", "Heading", 40, "Titles for Time Here"),
        long(
          "body",
          "Paragraph",
          320,
          "{village} marks long presence with a title. These titles are honorary: they carry no voice in governance and no rights today. Voice comes from what you contribute, and a village may decide later to attach powers of its own to these titles.",
        ),
      ],
      lists: [
        {
          key: "items",
          label: "Titles",
          help: "Up to six. Each gets the next icon in a fixed set.",
          itemLabel: "Title",
          titleKey: "level",
          maxItems: 6,
          fields: [
            text("level", "Title", 12, ""),
            text("years", "Time it marks", 12, "", { optional: true, help: "Shown with a + after it. Blank for none." }),
            text("description", "Description", 70, ""),
          ],
          default: [
            { level: "Resident", years: "", description: "Your arrival, you've made the village your home" },
            { level: "Guardian", years: "7 years", description: "Deep roots, steward of community traditions" },
            { level: "Elder", years: "21 years", description: "Village wisdom keeper, mentor to new residents" },
            { level: "Sage", years: "49 years", description: "Intergenerational bridge, keeper of the village's longest memory" },
          ],
        },
      ],
    },
    {
      id: "dues",
      label: "Village dues",
      shows: "The dues band. The amount and its own note are set in Admin, Settings.",
      hideable: true,
      fields: [
        text("heading", "Heading", 40, "Village Dues"),
        long(
          "fallback",
          "Paragraph when Admin, Settings has no dues note",
          300,
          "As a resident, you'll pay Village Dues that cover utilities, maintenance, and community services. Together, we work to reduce costs and create surplus that benefits everyone.",
        ),
        ...button("link", "Link under it", "How we create together", "/how-we-create"),
      ],
    },
    ctaBand("rights", "Rights and responsibilities", "The band pointing to the resident covenant.", {
      heading: "Your Rights and Responsibilities",
      body: "As a resident you are a co-owner of this village, not a tenant. Read the full covenant that protects you and defines what we're building together.",
      cta: ["Read Rights and Responsibilities", "/resident-rights"],
    }),
    ctaBand("nextStep", "Your next step", "The band inviting a visit.", {
      heading: "Your Next Step",
      body: "Schedule a village visit to experience {village} firsthand and ask any questions about becoming a resident.",
      cta: ["Schedule a Village Visit", "/visit"],
    }),
    faqSection("Common Questions"),
    closingBand({
      heading: "Find Your Home",
      body: "Start with a community call to learn about life at {village}, then explore our housing options and available lots.",
      primary: ["Join Community Call", JOURNEY_TARGETS.events],
      secondary: ["View Housing Options", "/housing"],
    }),
  ],
});

// ── /prosperity ──────────────────────────────────────────────────────────

const PROSPERITY_STEPS: StepDefault[] = [
  {
    legacyId: "community-call",
    stage: "Researcher",
    title: "Attend Community Call",
    description: "Learn about business opportunities at {village} and ask questions about our economic model.",
    bullets: ["Understand our economic vision", "Learn how the village economy works", "Meet other entrepreneurs", "Ask questions live"],
    label: "Join Community Call",
    target: JOURNEY_TARGETS.events,
  },
  {
    legacyId: "prosperity-packet",
    stage: "Dreamer",
    title: "Explore the Prosperity Packet",
    description: "Request the full guide to launching a business at {village}.",
    bullets: ["Business model overview", "Revenue share structure", "Integration requirements", "Success stories"],
    label: "Request Packet",
    target: JOURNEY_TARGETS.contact,
  },
  {
    legacyId: "business-proposal",
    stage: "Applicant",
    title: "Submit Business Proposal",
    description: "Present your vision and how it aligns with village needs and our regenerative mission. {guide} can help you shape it.",
    bullets: ["Describe your business vision", "Show village alignment", "Project community impact", "Include your timeline"],
    label: "Work With Us",
    target: "/work-with-us",
  },
  {
    legacyId: "membership",
    stage: "Member",
    title: "Sign {commitment} / Formal Membership",
    description: "Become an official member of the community.",
    bullets: ["Understand our founding principles", "Commit to regenerative values", "Sign membership agreement", "Join the community"],
    label: "Read the {commitment}",
    target: "/love-letter",
  },
  {
    legacyId: "approval",
    stage: "Partner",
    title: "Community Approval",
    description: "Present your business to the Business & Finance Council for community consent.",
    bullets: ["Present to Business & Finance Council", "Answer community questions", "Address impact concerns", "Receive consent decision"],
    label: "Learn About Circles",
    target: "/circles",
  },
  {
    legacyId: "launch",
    stage: "Builder",
    title: "Launch Your Business",
    description: "Begin serving the {village} community.",
    bullets: ["Agree your revenue share", "Set up community dashboard", "Train your team", "Celebrate your launch"],
    label: "",
    target: "",
  },
  {
    legacyId: "impact",
    stage: "Prospering Creator",
    title: "Grow Your Impact",
    description: "Advance through {acronym} tiers and scale your regenerative business.",
    bullets: ["Track impact metrics", "Grow community contribution", "Mentor other creators", "Advance to next tier"],
    label: "View {acronym} Tiers",
    target: "#ari-tiers",
  },
];

export const PROSPERITY_JOURNEY: PageSpec = buildJourney({
  id: "prosperity",
  label: "Prosperity journey",
  path: "/prosperity",
  hero: {
    eyebrow: "Prosperity Creator Journey",
    headline: "Create Regenerative Prosperity",
    highlight: "Regenerative Prosperity",
    intro: "Launch a business that serves the community and regenerates our ecosystem. Advance your impact through our {acronym} tiers.",
    introHelp: "{acronym} becomes the short name of your impact tiers, set lower down this page.",
    primary: ["Request Prosperity Packet", JOURNEY_TARGETS.contact],
    secondary: ["Join Community Call", JOURNEY_TARGETS.events],
    contactSubject: "Prosperity Packet Request",
  },
  beforeSteps: [
    {
      id: "economy",
      label: "Shared enterprise and co-ownership",
      shows: "The two short columns under the top of the page.",
      hideable: true,
      fields: [
        text("firstHeading", "First heading", 32, "Shared Enterprise"),
        long("firstBody", "First paragraph", 240, "Every business here agrees its revenue share with the village, business by business."),
        text("secondHeading", "Second heading", 32, "Co-Ownership Model"),
        long(
          "secondBody",
          "Second paragraph",
          240,
          "All {village} businesses are co-owned by the village community. You operate and manage your enterprise while the community shares in success through revenue participation.",
        ),
      ],
    },
  ],
  steps: {
    heading: "Your Path to Prosperity",
    intro: "Follow these {count} steps to launch your regenerative business at {village}.",
    items: PROSPERITY_STEPS,
    wordsHelp: "{guide} becomes your guide's name from Work With Us (\"The village guide\" until you name it), and {acronym} the short name of your impact tiers.",
  },
  afterSteps: [
    {
      id: "tiers",
      label: "Impact tiers",
      shows: "The four tier cards a business advances through. #ari-tiers links here.",
      hideable: true,
      fields: [
        text("acronym", "Short name", 8, "ARI", { help: "Fills {acronym} wherever this page uses it." }),
        text("framework", "Full name of the framework", 40, "{village} Regenerative Impact", { help: "Fills {framework}." }),
        text("heading", "Heading", 60, "{acronym} Tiers: {framework}"),
        long(
          "intro",
          "Sentence under the heading",
          240,
          "Measure and grow your impact through our {framework} framework. Advance through tiers based on community contribution and regenerative outcomes.",
        ),
      ],
      lists: [
        {
          key: "items",
          label: "Tiers",
          help: "Up to six, lowest first. Each gets the next colour in a fixed set.",
          itemLabel: "Tier",
          titleKey: "tier",
          maxItems: 6,
          fields: [
            text("tier", "Name", 12, ""),
            text("description", "Description", 48, ""),
            text("focus", "Focus", 32, ""),
            text("metric1", "Measure 1", 40, "", { optional: true }),
            text("metric2", "Measure 2", 40, "", { optional: true }),
            text("metric3", "Measure 3", 40, "", { optional: true }),
          ],
          default: [
            { tier: "Seed", description: "Early stage, establishing presence", focus: "Primary village impact", metric1: "Families served", metric2: "Community contributions per week", metric3: "Community meals contributed" },
            { tier: "Sprout", description: "Growing, measurable contribution", focus: "Regional visibility", metric1: "Local employment created", metric2: "Ecosystem health contribution", metric3: "Skill-sharing events" },
            { tier: "Grove", description: "Established, regional impact", focus: "Significant contribution", metric1: "Apprentices trained", metric2: "Land area regenerated", metric3: "Cultural events hosted" },
            { tier: "Forest", description: "Full impact. Global reach.", focus: "Global reach and legacy", metric1: "Regenerative practices replicated", metric2: "Knowledge shared globally", metric3: "Legacy created" },
          ],
        },
      ],
    },
    ctaBand("packet", "Packet invitation", "The band inviting a packet request. It hides when its button has nowhere to go.", {
      heading: "Ready to Explore Opportunities?",
      body: "Request the Prosperity Packet to learn everything about launching a business at {village}.",
      cta: ["Request Prosperity Packet", JOURNEY_TARGETS.contact],
    }),
    closingBand({
      heading: "Launch Your Regenerative Business",
      body: "Start with a community call to ask questions about the economic model, then request the Prosperity Packet and begin your journey.",
      primary: ["Join Community Call", JOURNEY_TARGETS.events],
      secondary: ["Request Packet", JOURNEY_TARGETS.contact],
      shows: "The last band before the questions. It hides when neither button has anywhere to go.",
    }),
    faqSection("Common Questions"),
  ],
});

export const JOURNEY_PAGES: readonly PageSpec[] = [INVESTOR_JOURNEY, STEWARD_JOURNEY, RESIDENT_JOURNEY, PROSPERITY_JOURNEY];

/**
 * The ids each page saved a visitor's ticks under before its steps became a
 * list, in default order, so a returning visitor keeps their progress.
 */
export const JOURNEY_LEGACY_STEP_IDS: Readonly<Record<JourneyId, readonly string[]>> = {
  investor: INVESTOR_STEPS.map((s) => s.legacyId),
  steward: STEWARD_STEPS.map((s) => s.legacyId),
  resident: RESIDENT_STEPS.map((s) => s.legacyId),
  prosperity: PROSPERITY_STEPS.map((s) => s.legacyId),
};
