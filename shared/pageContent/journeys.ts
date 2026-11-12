/**
 * The four journey pages (/investor, /steward, /resident, /prosperity), as
 * fields. One builder, four specs, because the pages share one skeleton: a
 * hero, bands about the village, a list of steps a visitor ticks off, and a
 * closing invitation.
 *
 * THE DEFAULTS ARE NEUTRAL STARTER TEXT (2026-10-23). They were the founding
 * village's own pages: its resort and lot counts, its loan, its waitlist name,
 * its fireside dinner, its children's day, its land share instrument, its
 * training, its council and its year counts. The founding village now holds
 * its own copy (its record is in server/seeds/), so each journey keeps a
 * sensible generic path and invents nothing: no figure, no phase, no person.
 * The investor figures come only from Admin, Settings, and the phases band
 * is not drawn until a village lists a phase.
 *
 * Two rulings bind them: a token may be named and no sentence says what it
 * does (Rye, 2026-10-22, TOKEN_COPY rows 21 to 30), and no sentence restates
 * that work is paid, because the quest and role cards say it (Rye,
 * 2026-10-23).
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
    description: "Learn what {village} is building, what it values, and how it makes decisions.",
    bullets: ["Read the village's story and values", "Learn about the place", "Meet the people behind it", "Ask your questions at an event"],
    label: "See Upcoming Events",
    target: JOURNEY_TARGETS.events,
  },
  {
    legacyId: "request",
    stage: "Interested",
    title: "Request Investor Pack",
    description: "Ask for the investor pack: the documents {village} shares with people considering an investment.",
    bullets: ["The plan and its phases", "The financial picture", "How investments are structured", "The legal structure"],
    label: "Request Pack",
    target: JOURNEY_TARGETS.packForm,
  },
  {
    legacyId: "call",
    stage: "Exploring",
    title: "Schedule Investment Call",
    description: "Talk one-on-one with the {village} team about your goals and how they fit the village.",
    bullets: ["Discuss investment options", "Review the financial picture", "Understand how investments are structured", "Ask about living here too"],
    label: "Schedule Call",
    target: JOURNEY_TARGETS.callForm,
  },
  {
    legacyId: "commit",
    stage: "Committed",
    title: "Make Your Commitment",
    description: "Choose how you invest, and put your commitment in writing with {village}.",
    bullets: ["Choose how you invest", "Review and sign agreements", "Complete the transfer", "Stay in touch as the village grows"],
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
    headline: "Invest in {village}",
    highlight: "{village}",
    intro:
      "Capital Contributors bring money, credit or other resources to help {village} grow. Read what the village has published, ask your questions, and decide whether it fits your goals.",
    primary: ["Request Investor Pack", JOURNEY_TARGETS.packForm],
    secondary: ["See Upcoming Events", JOURNEY_TARGETS.events],
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
        text("heading", "Heading", 40, "Why People Invest"),
        long("intro", "Sentence under the heading", 140, "People back a village for different reasons. See if yours is here."),
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
            { title: "Future Residents", subtitle: "Invest in the place you plan to call home" },
            { title: "Impact Investors", subtitle: "Back a village whose work you believe in" },
            { title: "Neighbors and Locals", subtitle: "Invest in the future of your own region" },
            { title: "Families", subtitle: "Build something lasting for the next generation" },
            { title: "Lenders", subtitle: "Offer credit on terms that work for both sides" },
            { title: "Friends of the Village", subtitle: "Support a place you care about, near or far" },
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
      shows: "The dark band listing what gets built, each with a status and a progress bar. It is not drawn until you list a phase.",
      hideable: true,
      fields: [
        text("heading", "Heading", 40, "Development Phases"),
        long("intro", "Sentence under the heading", 160, "What {village} plans to build, and how far along each part is."),
        text("activeStatus", "Status drawn in gold", 16, "Planning", {
          help: "A phase whose status reads exactly this gets the gold label; any other status gets a pale one.",
        }),
      ],
      lists: [
        {
          key: "items",
          label: "Phases",
          help: "Up to eight, top to bottom. None until you add one.",
          itemLabel: "Phase",
          titleKey: "name",
          maxItems: 8,
          fields: [
            text("name", "Name", 32, ""),
            text("units", "Size (keys, homes, lots)", 16, ""),
            text("status", "Status", 16, ""),
            text("progress", "Progress, 0 to 100", 5, "", { help: "A whole number. The bar fills this far." }),
          ],
          default: [],
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
        text("rangeHint", "Hint inside the investment range box", 32, "The range you have in mind", {
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
        text("timeHint", "Hint inside the preferred time box", 32, "e.g., weekday mornings", {
          optional: true,
          help: "Grey example text. Leave blank for none.",
        }),
        text("thanks", "Note once it is sent", 80, "Thank you! The team will be in touch soon.", {
          help: "A promise to the visitor: say only what your team will keep.",
        }),
      ],
    },
  ],
});

// ── /steward ─────────────────────────────────────────────────────────────

/**
 * ONE FLOW, TWO PATHS (build list section 8, 11 Nov 2026). The page used to
 * carry "Getting to know us" and an eleven-step journey that overlapped. It is
 * now one flow: the first steps everyone takes, then the path divides into
 * the steward path (hold a role) and the resident path (live here), and the
 * steward path ends by inviting a role holder onto the resident path too.
 *
 * EXPAND ONLY. The section ids a village has already saved keep their meaning
 * and are still read: `getToKnow` is the shared first steps (with a new
 * `exceptions` line), `steps` is the steward path. The new sections (`tracks`,
 * `crossover`, `foundingTeam`, `extras`) start from their defaults,
 * so a village that saved the old page keeps its words and gains the new parts.
 *
 * SHARED WITH /resident. `getToKnow` and `tracks` are read by the resident page
 * as well, so the first steps and the fork are written once, here.
 */

/** The stage labels the steward path uses, so the page can tell whose move a step is. */
export const STEWARD_STAGE_YOURS = "Your move";
export const STEWARD_STAGE_CIRCLE = "The circle's move";
export const STEWARD_STAGE_TOGETHER = "Together";

const STEWARD_STEPS: StepDefault[] = [
  {
    legacyId: "start",
    stage: STEWARD_STAGE_YOURS,
    title: "Find the role that is yours",
    description: "Read the open roles. Each card says what the role holds, the background we hope for, and what it asks of you.",
    bullets: [],
    label: "See the open roles",
    target: "/roles",
  },
  {
    legacyId: "apply",
    stage: STEWARD_STAGE_YOURS,
    title: "Apply for the role",
    description: "Apply from the role's own card. Tell us about you and the value you would bring, then confirm your email.",
    bullets: [],
    label: "",
    target: "",
  },
  {
    legacyId: "review",
    stage: STEWARD_STAGE_CIRCLE,
    title: "We read every application",
    description: "We invite some applicants to a conversation, and write to everyone else with a warm reply.",
    bullets: [],
    label: "",
    target: "",
  },
  {
    legacyId: "meet",
    stage: STEWARD_STAGE_TOGETHER,
    title: "Conversations, one at a time",
    description: "You meet the people the role works with most. You can ask them anything too.",
    bullets: [],
    label: "",
    target: "",
  },
  {
    legacyId: "consent",
    stage: STEWARD_STAGE_CIRCLE,
    title: "The circle decides by consent",
    description: "The circle weighs your application together. People choose people, and we tell you what the circle decided.",
    bullets: [],
    label: "",
    target: "",
  },
  {
    legacyId: "first-cycle",
    stage: STEWARD_STAGE_TOGETHER,
    title: "A first cycle together",
    description: "You begin the role for one cycle, so both sides can see how it fits. Either side may end it there.",
    bullets: [],
    label: "",
    target: "",
  },
  {
    legacyId: "seated",
    stage: STEWARD_STAGE_YOURS,
    title: "Take up the role",
    description: "When it fits, the role is yours, held with the circle that holds it.",
    bullets: [],
    label: "",
    target: "",
  },
];

/** One card of the first steps: a few points, a button, and an optional mark. */
function knowRow(r: { stage: string; title: string; mark: string; description: string; bullets: readonly string[]; label: string; target: string }): Record<string, string> {
  const row: Record<string, string> = { stage: r.stage, title: r.title, mark: r.mark, description: r.description };
  for (let i = 0; i < BULLETS; i++) row[`bullet${i + 1}`] = r.bullets[i] ?? "";
  row.actionLabel = r.label;
  row.actionTarget = r.target;
  return row;
}

/**
 * The first steps, shared by both paths: optional to visit, asked of anyone
 * applying for a role, with the exceptions line beside them (build list 8.2
 * and 1.12). They never lock an application. Platform defaults name no
 * village's own gathering; a village writes its own in Admin, Pages.
 */
function getToKnowSection(): SectionSpec {
  return {
    id: "getToKnow",
    label: "First steps (both paths)",
    shows:
      "The first steps everyone takes, in order, before the path divides. Shown on this page and on the resident page, so they are written once, here. A visitor can tick each one off.",
    hideable: true,
    fields: [
      text("heading", "Heading", 40, "Get to know us"),
      long("body", "Paragraph", 240, "Optional to visit, and asked of anyone applying for a role. Take them in this order, and tick each one off as you go."),
      long(
        "exceptions",
        "When someone may apply without them",
        420,
        "We encourage you to take these first steps. If you have not, you can still apply, especially if we invited you, if you live far away and the next call is more than a week off, or if you feel you are an incredibly strong candidate.",
        {
          optional: true,
          help: "Shown on this page under the first steps, beside the role application. Leave blank for none. The resident page does not show it.",
        },
      ),
    ],
    lists: [
      {
        key: "items",
        label: "First steps",
        help: "Read top to bottom. Opening a step shows its points and its button. Words in Mark show as a small label, for example Required to apply.",
        itemLabel: "Step",
        titleKey: "title",
        minItems: 0,
        maxItems: 8,
        fields: [
          text("stage", "Stage (the small label)", 20, ""),
          text("title", "Title", 48, ""),
          text("mark", "Mark (for example Optional)", 20, "", { optional: true }),
          long("description", "Description", 420, ""),
          ...Array.from({ length: BULLETS }, (_, i) => text(`bullet${i + 1}`, `Point ${i + 1}`, 44, "", { optional: true })),
          text("actionLabel", "Button words", 32, "", { optional: true }),
          target("actionTarget", "Button goes to", "", TARGET_HELP),
        ],
        default: [
          knowRow({
            stage: "First",
            title: "Come to an open call",
            mark: "",
            description: "Join an online call, live or as a recording. Hear what {village} is building and ask your first questions.",
            bullets: ["Meet the people", "Hear the vision", "Ask anything"],
            label: "See upcoming events",
            target: JOURNEY_TARGETS.events,
          }),
          knowRow({
            stage: "Second",
            title: "Walk the land with us",
            mark: "",
            description: "Come on a tour of the land with someone who knows it well. Ask us if you need another time.",
            bullets: [],
            label: "See upcoming events",
            target: JOURNEY_TARGETS.events,
          }),
          knowRow({
            stage: "Third",
            title: "Share a meal with the village",
            mark: "",
            description: "Come to a shared meal or gathering and meet {village} as it lives.",
            bullets: [],
            label: "See upcoming events",
            target: JOURNEY_TARGETS.events,
          }),
        ],
      },
    ],
  };
}

/** The fork after the first steps: the two paths, side by side. Read by both pages. */
function tracksSection(): SectionSpec {
  return {
    id: "tracks",
    label: "Two paths (both pages)",
    shows: "Where the path divides after the first steps: holding a role, or living here. Shown on this page and the resident page, each marking the one a visitor is on.",
    fields: [
      text("heading", "Heading", 40, "Two paths from here"),
      long("body", "Paragraph", 200, "After the first steps the path divides. Walk one, or both."),
      text("stewardTitle", "Role path: title", 32, "Hold a role"),
      long("stewardLine", "Role path: one line", 160, "Join the team that builds {village}, in a role that is yours."),
      text("residentTitle", "Home path: title", 32, "Live here"),
      long("residentLine", "Home path: one line", 160, "Make {village} your home, one stage at a time."),
      text("hereLabel", "Label on the path a visitor is on", 20, "You are here"),
    ],
  };
}

/**
 * The end of the steward path: an optional step onto the resident path too.
 * THE LEAD'S RULING (11 Nov, final): the role path carries this one optional
 * step, which links across to the resident path. A village's early
 * supporters programme (the first village calls it Founding Seeders) sits
 * inside the resident path only, as a step in that page's own list, and is
 * never its own step here.
 */
function crossoverSection(): SectionSpec {
  return {
    id: "crossover",
    label: "Optional step: join the resident path too",
    shows: "The last step of the role path: an optional invitation to walk the resident path as well, linking across to it.",
    hideable: true,
    fields: [
      text("mark", "Mark", 20, "Optional", { optional: true, help: "A small label beside the title. Leave blank for none." }),
      text("title", "Title", 60, "Join the resident path too"),
      long("body", "Paragraph", 240, "Many who hold a role here also make {village} home. You can walk the resident path alongside your role."),
      ...button("cta", "Button", "See the resident path", "/resident"),
    ],
  };
}

/** The founding team invitation: the page's one main act, in the quieter founding register. */
function foundingTeamSection(): SectionSpec {
  return {
    id: "foundingTeam",
    label: "Join the founding team",
    shows: "The quiet band after the role path, in the founding team's own look, with the page's one main button. Hide it while no role is open.",
    hideable: true,
    fields: [
      text("eyebrow", "Small label", 30, "Join the founding team"),
      text("heading", "Heading", 60, "The team that builds {village}"),
      long(
        "body",
        "Paragraph",
        360,
        "We are bringing together the few people who will carry {village} from an idea to a living village. Each role is a long commitment, held with care. Read the open roles and apply for the one that is yours.",
      ),
      ...button("cta", "Button", "Join the founding team", "/roles"),
    ],
  };
}

/** Optional extras: deeper ways in, none of them needed to apply. */
function extrasSection(): SectionSpec {
  return {
    id: "extras",
    label: "Optional extras",
    shows: "A short quiet list of deeper ways to know you, none of them needed to apply.",
    hideable: true,
    fields: [
      text("heading", "Heading", 40, "Optional, whenever you like"),
      long("body", "Paragraph", 200, "None of these is needed to apply. Each is a deeper way to know us."),
    ],
    lists: [
      {
        key: "items",
        label: "Extras",
        help: "Up to six, top to bottom. When (for example Later) shows as a small label.",
        itemLabel: "Extra",
        titleKey: "title",
        maxItems: 6,
        fields: [
          text("title", "Title", 48, ""),
          text("when", "When (small label)", 20, "", { optional: true }),
          long("description", "Description", 240, ""),
          text("actionLabel", "Button words", 32, "", { optional: true }),
          target("actionTarget", "Button goes to", "", TARGET_HELP),
        ],
        default: [
          { title: "Other events", when: "", description: "Gatherings, workshops and celebrations on the land.", actionLabel: "See upcoming events", actionTarget: JOURNEY_TARGETS.events },
          { title: "Village immersion", when: "", description: "Spend unhurried time in the village and see how it lives day to day.", actionLabel: "", actionTarget: "" },
          { title: "Community training", when: "Later", description: "The village's own practices for living and deciding together, once you have joined.", actionLabel: "Learn about training", actionTarget: "/training/steward" },
        ],
      },
    ],
  };
}

export const STEWARD_JOURNEY: PageSpec = buildJourney({
  id: "steward",
  label: "Steward journey",
  path: "/steward",
  hero: {
    eyebrow: "Holding a role",
    headline: "Steward the village",
    highlight: "village",
    intro:
      "Roles are how the work of {village} gets done, and each one is held by a person. Everyone starts on the same first steps. Then the path divides: hold a role, live here, or both.",
    primary: ["See the first steps", "#first-steps"],
    secondary: ["Ask us a question", JOURNEY_TARGETS.contact],
  },
  beforeSteps: [getToKnowSection(), tracksSection()],
  steps: {
    heading: "The role path",
    intro: "From your application to the role, in {count} steps. Some are your moves and some are the circle's, and each one says which.",
    items: STEWARD_STEPS,
  },
  afterSteps: [
    crossoverSection(),
    foundingTeamSection(),
    extrasSection(),
    ctaBand("rights", "Rights and responsibilities", "The band pointing to the steward rights page.", {
      heading: "Your rights and responsibilities",
      body: "Read what we ask of you, what you can count on from us, and how leaving a role works.",
      cta: ["Read rights and responsibilities", "/steward-rights"],
    }),
    faqSection("Common Questions"),
  ],
});

// ── /resident ────────────────────────────────────────────────────────────

const RESIDENT_STEPS: StepDefault[] = [
  {
    legacyId: "founding-seeder",
    stage: "Interested",
    title: "Say You're Interested",
    description: "Let {village} know you are serious about living here, so you hear when homes become available.",
    bullets: ["Tell the village you are interested", "Hear when homes become available", "No obligation to commit"],
    label: "Tell Us You're Interested",
    target: "",
  },
  {
    legacyId: "training",
    stage: "Participant",
    title: "Community Training",
    description: "Complete {village}'s community training, or show that you already live its practices.",
    bullets: ["Do the training, or show you already live it", "How the village communicates", "How conflict is handled", "How decisions are made"],
    label: "Learn About Training",
    // Each path's training step points at its own training page (the lead, 11 Nov 2026).
    target: "/training/resident",
  },
  {
    legacyId: "love-letter",
    stage: "Member",
    title: "Sign the {commitment}",
    description: "Read and sign the {commitment} to become a member of the community.",
    bullets: ["Read the {commitment}", "Ask about anything unclear", "Sign it", "Welcome to membership"],
    label: "Read the {commitment}",
    target: "/love-letter",
  },
  {
    legacyId: "housing",
    stage: "Explorer",
    title: "Explore Housing Options",
    description: "See the homes and places to live at {village}, and find the one that fits you.",
    bullets: ["See what is available", "Compare the options", "Understand the costs", "Ask about financing"],
    label: "View Housing Options",
    target: "/housing",
  },
  {
    legacyId: "deposit",
    stage: "Deposit",
    title: "Put Down a Deposit on Your Future Home",
    description: "Hold your place with a deposit{range}. Ask how it works and when it can be refunded before you pay.",
    bullets: ["Ask about refunds before you pay", "{deposit-summary}", "Holds your place"],
    label: "Reserve Your Home",
    target: "/reserve",
  },
  {
    legacyId: "background",
    stage: "Applicant",
    title: "Background Check",
    description: "Where {village} asks for one, a background check comes next. It is handled in confidence, for the sake of community safety{background-note}.",
    bullets: ["Only where the village asks for one", "Community safety", "Confidential handling"],
    label: "Ask About This Step",
    target: "",
  },
  {
    legacyId: "fireside",
    stage: "Conversation",
    title: "A Conversation With the Village",
    description:
      "Sit down with people from {village}, in person or online, and talk openly about whether this is the right fit for both of you.",
    bullets: ["In person or online", "An open, friendly conversation", "Explore fit on both sides"],
    label: "By Invitation",
    target: "",
  },
  {
    legacyId: "family",
    stage: "Families",
    title: "Family Life",
    description: "If you have children, ask about family life at {village} and come to a gathering together.",
    bullets: ["Ask about family life here", "Bring your children to a gathering", "Ask about schooling nearby"],
    label: "See Upcoming Events",
    target: JOURNEY_TARGETS.events,
  },
  {
    legacyId: "passage",
    stage: "Initiate",
    title: "Welcomed as a Resident",
    description: "The village agrees to welcome you as a resident, in the way it has chosen to decide. Read the Good Neighbor page first.",
    bullets: ["Know how neighbors live together here", "Show your commitment", "Receive the village's consent", "Celebrate the step"],
    label: "Read the Good Neighbor Page",
    target: "/good-neighbor",
  },
  {
    legacyId: "land",
    stage: "Agreement",
    title: "Sign Your Residency Agreement",
    description: "Agree the terms of your home with {village} and sign your residency agreement.",
    bullets: ["Review the terms", "Arrange financing if needed", "Ask about anything unclear", "Sign your agreement"],
    label: "Ask About the Terms",
    target: "",
  },
  {
    legacyId: "build",
    stage: "Builder",
    title: "Prepare Your Home",
    description: "Build, renovate or set up your home, working within the agreements {village} has made about building.",
    bullets: ["Choose your home design", "Find your builder", "Follow the building agreements", "Make it yours"],
    label: "View Housing",
    target: "/housing",
  },
  {
    legacyId: "move-in",
    stage: "Resident",
    title: "Move In and Celebrate",
    description: "Welcome home! Celebrate with your new neighbors and begin your life at {village}.",
    bullets: ["A welcome from the village", "Meet your neighbors", "Begin village life", "Celebrate your new home"],
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
    intro: "Find your place at {village}. This is the path from a first visit to moving in, one step at a time.",
    primary: ["Come to an Event", JOURNEY_TARGETS.events],
    secondary: ["Explore Housing", "/housing"],
  },
  beforeSteps: [
    {
      id: "entry",
      label: "First steps",
      shows:
        "The heading over the first steps everyone takes. The steps themselves, and the two paths after them, are written once on the Steward journey page and shown here as well.",
      hideable: true,
      fields: [
        text("heading", "Heading", 40, "Start with the first steps"),
        long("body", "Paragraph", 200, "Everyone begins here, whichever path you walk. Tick each one off as you go."),
      ],
    },
    {
      id: "tenure",
      label: "How residents hold their homes",
      shows: "The band just under the top of the page, about how residents hold their land.",
      hideable: true,
      fields: [
        text("heading", "Heading", 40, "How You Hold Your Home"),
        long(
          "body",
          "Paragraph",
          320,
          "Your residency agreement sets out how long your home is yours, what it costs, and whether you can pass it down to your children{transfer-note}. Ask to read it in full before you commit.",
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
            { level: "Guardian", years: "", description: "Deep roots, steward of community traditions" },
            { level: "Elder", years: "", description: "Village wisdom keeper, mentor to new residents" },
            { level: "Sage", years: "", description: "Keeper of the village's longest memory" },
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
          "Residents pay village dues that cover shared costs, such as upkeep of shared spaces and common services. {village} sets the amount and says what it covers.",
        ),
        ...button("link", "Link under it", "How we create together", "/how-we-create"),
      ],
    },
    ctaBand("rights", "Rights and responsibilities", "The band pointing to the resident covenant.", {
      heading: "Your Rights and Responsibilities",
      body: "Read what you can count on as a resident, and what your neighbors can count on from you.",
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
      body: "Come to an event to learn about life at {village}, then explore the places to live.",
      primary: ["See Upcoming Events", JOURNEY_TARGETS.events],
      secondary: ["View Housing Options", "/housing"],
    }),
  ],
});

// ── /prosperity ──────────────────────────────────────────────────────────

const PROSPERITY_STEPS: StepDefault[] = [
  {
    legacyId: "community-call",
    stage: "Researcher",
    title: "Come to an Event",
    description: "Learn what {village} needs and ask how businesses work here.",
    bullets: ["Learn what the village needs", "Learn how the village economy works", "Meet the people you would serve", "Ask questions live"],
    label: "See Upcoming Events",
    target: JOURNEY_TARGETS.events,
  },
  {
    legacyId: "prosperity-packet",
    stage: "Dreamer",
    title: "Ask for the Details",
    description: "Write to {village} and ask what it takes to start a business here.",
    bullets: ["What the village needs", "What a business gives back", "How businesses fit in here"],
    label: "Email the Village",
    target: JOURNEY_TARGETS.contact,
  },
  {
    legacyId: "business-proposal",
    stage: "Applicant",
    title: "Submit Business Proposal",
    description: "Describe your business and how it meets what {village} needs. {guide} can help you shape it.",
    bullets: ["Describe your business vision", "Show how it meets a village need", "Describe its impact", "Include your timeline"],
    label: "Work With Us",
    target: "/work-with-us",
  },
  {
    legacyId: "membership",
    stage: "Member",
    title: "Sign the {commitment}",
    description: "Read and sign the {commitment} to become a member of the community.",
    bullets: ["Read the {commitment}", "Ask about anything unclear", "Sign it", "Join the community"],
    label: "Read the {commitment}",
    target: "/love-letter",
  },
  {
    legacyId: "approval",
    stage: "Partner",
    title: "Community Approval",
    description: "Present your business to the village and receive its decision, made in the way {village} has chosen to decide.",
    bullets: ["Present your business", "Answer the community's questions", "Address any concerns about impact", "Receive the decision"],
    label: "Learn About Circles",
    target: "/circles",
  },
  {
    legacyId: "launch",
    stage: "Builder",
    title: "Launch Your Business",
    description: "Begin serving the {village} community.",
    bullets: ["Agree what your business gives back", "Tell the village you are open", "Train your team", "Celebrate your launch"],
    label: "",
    target: "",
  },
  {
    legacyId: "impact",
    stage: "Prospering Creator",
    title: "Grow Your Impact",
    description: "Advance through the {acronym} tiers as your business matures.",
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
    headline: "Create Shared Prosperity",
    highlight: "Shared Prosperity",
    intro: "Start a business that serves the community and cares for the land. Advance your impact through our {acronym} tiers.",
    introHelp: "{acronym} becomes the short name of your impact tiers, set lower down this page.",
    primary: ["Ask About Starting a Business", JOURNEY_TARGETS.contact],
    secondary: ["See Upcoming Events", JOURNEY_TARGETS.events],
    contactSubject: "Starting a business at {village}",
  },
  beforeSteps: [
    {
      id: "economy",
      label: "Two columns about business here",
      shows: "The two short columns under the top of the page.",
      hideable: true,
      fields: [
        text("firstHeading", "First heading", 32, "Shared Enterprise"),
        long("firstBody", "First paragraph", 240, "Every business here makes its own agreement with the village about what it gives back."),
        text("secondHeading", "Second heading", 32, "Serving the Village"),
        long(
          "secondBody",
          "Second paragraph",
          240,
          "A business here serves the people of {village} and the wider community, and grows with the village.",
        ),
      ],
    },
  ],
  steps: {
    heading: "Your Path to Prosperity",
    intro: "Follow these {count} steps to start your business at {village}.",
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
        text("acronym", "Short name", 8, "Growth", { help: "Fills {acronym} wherever this page uses it." }),
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
    ctaBand("packet", "Invitation to write", "The band inviting a would-be business to write to you. It hides when its button has nowhere to go.", {
      heading: "Ready to Explore Opportunities?",
      body: "Write to {village} to learn what it takes to start a business here.",
      cta: ["Email the Village", JOURNEY_TARGETS.contact],
    }),
    closingBand({
      heading: "Start Your Business Here",
      body: "Come to an event and ask your questions, then write to the village to begin.",
      primary: ["See Upcoming Events", JOURNEY_TARGETS.events],
      secondary: ["Email the Village", JOURNEY_TARGETS.contact],
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
