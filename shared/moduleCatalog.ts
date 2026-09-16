/**
 * The Module Library's copy: what each module promises, who it is for, what
 * standing it up looks like, and the five shelves the catalog is grouped on.
 *
 * It sits in `shared/` ON PURPOSE: `scripts/check-voice.mjs` parses `shared/`
 * string literals, so every sentence here is held to the house writing rules
 * by the gate, and the brand ratchet sees it too. Platform language only,
 * never one village's brand.
 *
 * The SERVER renders these entries into `/api/modules/catalog` (the same way
 * `priceLine` is rendered into the admin payload), so the client reads copy it
 * was handed and the registry stays out of the client bundle.
 *
 * `hue` and `emblem` drive the designed fallback art (`ModuleArt`): a gradient
 * from the hue plus a lucide emblem, so a fork with no images, or a village
 * that removed one, still looks finished. `emblem` is a lucide icon name; the
 * client maps it and falls back to a neutral mark for a name it does not know.
 */
import type { ModuleGroup } from "./modules";

export interface ModuleGroupDef {
  id: ModuleGroup;
  label: string;
  gloss: string;
}

/** The five shelves, in shelf order. Five is the ruling; there is no sixth. */
export const MODULE_GROUPS: ModuleGroupDef[] = [
  {
    id: "coordinate",
    label: "Coordinate",
    gloss: "Plan the work and the days: quests, the calendar, calls, tools.",
  },
  {
    id: "recognise",
    label: "Recognise",
    gloss: "See people: gratitude, the path from guest to co-creator, badges.",
  },
  {
    id: "host-and-earn",
    label: "Host and earn",
    gloss: "Value moving with care: stays, the shelves, the exchange, payments.",
  },
  {
    id: "know-and-decide",
    label: "Know and decide",
    gloss: "How the village understands itself: conversations, decisions, power, health.",
  },
  {
    id: "connect",
    label: "Connect",
    gloss: "People finding people: profiles, messages, the feed, other villages.",
  },
];

export interface ModuleCatalogEntry {
  /** One line under the name on the card. */
  promise: string;
  /** Three to five bullets on the detail page: what it does. */
  benefits: string[];
  /** Who this module is for, as one sentence. */
  forWhom: string;
  /** What you will set up, as one sentence beside the `setup` value. */
  setupSummary: string;
  /** What data it holds, in plain words beside the `dataClass` value. */
  dataSummary: string;
  /** 0..359, the fallback art's gradient hue. */
  hue: number;
  /** A lucide icon name for the fallback art's emblem. */
  emblem: string;
}

export const MODULE_CATALOG: Record<string, ModuleCatalogEntry> = {
  quests: {
    promise: "Work you can pick up and finish: the board where contribution starts.",
    benefits: [
      "Post work as quests anyone can claim",
      "Submission and consent keep the release of recognition honest",
      "Crews form around the bigger quests",
      "Finished work feeds progression, so contribution moves people forward",
    ],
    forWhom: "Villages that run on visible, shared work.",
    setupSummary: "Nothing to set up. Core, on from the first day.",
    dataSummary: "Quests, claims and submissions, tied to the named members who made them.",
    hue: 262,
    emblem: "Sparkles",
  },
  gratitude: {
    promise: "Appreciation that carries value, cycle by lunar cycle.",
    benefits: [
      "Send gratitude with a message, from your own cycle budget",
      "Lunar cycles close and share out the value pool",
      "A public wall shows appreciation moving through the village",
      "Every send lands in the recipient's own ledger",
    ],
    forWhom: "Villages that want recognition to be a habit, and to count.",
    setupSummary: "Nothing to set up. Core, on from the first day.",
    dataSummary: "Who appreciated whom, when, and the balances that followed.",
    hue: 340,
    emblem: "Heart",
  },
  progression: {
    promise: "The path from guest to co-creator, walked in the open.",
    benefits: [
      "Stages mark how deep someone is in",
      "Capabilities unlock as people grow",
      "Appointed roles carry real permissions",
      "Proposals open, get decided, and stay on the record",
    ],
    forWhom: "Villages where trust grows in steps and everyone can see the stairs.",
    setupSummary: "Nothing to set up. Core, on from the first day.",
    dataSummary: "Each member's stage, roles and capability grants.",
    hue: 152,
    emblem: "TrendingUp",
  },
  profiles: {
    promise: "Who is here: handles, journeys, and each member's own ledger.",
    benefits: [
      "A profile for every member, with a handle of their own",
      "Journeys record how someone arrived and where they are headed",
      "Balances and a personal ledger in one place",
      "Members choose what their profile shows",
    ],
    forWhom: "Every village. People have to be findable to be met.",
    setupSummary: "Nothing to set up. Core, on from the first day.",
    dataSummary: "Names, handles, journeys and balances: the most personal data the platform holds.",
    hue: 210,
    emblem: "Users",
  },
  map: {
    promise: "Circles, seats and the people holding them. Includes the Living Map of the land.",
    benefits: [
      "Nested circles show how the village organises itself",
      "Every seat names its holder, or stands as an open call",
      "A concierge routes offers of help to the right person",
      "The Living Map draws the land the village stands on",
    ],
    forWhom: "Villages ready to show where power sits and where help is needed.",
    setupSummary: "Draw your circles and name the first seats. Examples stand in while you do.",
    dataSummary: "Circles, seats, holders and contact requests, tied to named members.",
    hue: 28,
    emblem: "Landmark",
  },
  resources: {
    promise: "Who may spend what, with whose yes, and where the money comes from, drawn on the map.",
    benefits: [
      "Spending rules per circle or seat: what moves alone, what needs a yes",
      "Funding sources and season budgets, declared in the village's own currency",
      "Request approval opens a forum decision pre-filled from the rule",
      "Declared beside measured: the ledger's own counts and totals, never a member's balance",
    ],
    forWhom: "Villages that want the money questions answered before anyone has to ask.",
    setupSummary: "Declare one rule, one source and one budget; the map draws the rest.",
    dataSummary: "Rules, sources and budgets the village declares. Counts and totals from the ledger, no names.",
    hue: 75,
    emblem: "Coins",
  },
  forum: {
    promise: "Conversations that can end in a decision.",
    benefits: [
      "Threads by circle-of-life category",
      "Mentions and follows keep the right people in the room",
      "Proposals open, get decided, and stay on the record",
      "Community moderation with a clear report path",
    ],
    forWhom: "Villages that want decisions made in the open, where anyone can read how they went.",
    setupSummary: "Nothing to set up. Four starter categories are seeded and yours to rename.",
    dataSummary: "Threads, replies and recorded decisions, under each author's name.",
    hue: 200,
    emblem: "MessagesSquare",
  },
  feed: {
    promise: "The everyday stream: small posts, milestones, and hearts that are real gifts.",
    benefits: [
      "Microposts, events and announcements from one forum category",
      "The village's own milestones weave into the stream",
      "A heart is a real gratitude send from your cycle budget",
      "Light enough to read well on a phone over a slow link",
    ],
    forWhom: "Villages that want a daily pulse without another app.",
    setupSummary: "Nothing to set up. It reads one forum category from the day it is on.",
    dataSummary: "Posts and hearts, under each author's name.",
    hue: 20,
    emblem: "Newspaper",
  },
  messaging: {
    promise: "Private conversations, one to one or in a named group.",
    benefits: [
      "Direct messages and group threads are one thing with one home",
      "Read state follows you between devices",
      "One report path and one place to moderate",
      "Conversations keep their history when the module rests",
    ],
    forWhom: "Villages whose coordination outgrew a group chat somewhere else.",
    setupSummary: "Nothing to set up. On means people can write to each other.",
    dataSummary: "Private messages between named members: the village's most private table.",
    hue: 180,
    emblem: "MessageCircle",
  },
  stays: {
    promise: "Rooms on stay credits, where one credit hosts one night.",
    benefits: [
      "Rooms carry credit and optional USD prices, per audience",
      "Credits are bought, or earned through work-exchange quests",
      "Autopay posts each night and warns before a balance runs low",
      "Every movement lands on the one ledger",
    ],
    forWhom: "Villages hosting guests, arriving residents, or work-exchangers.",
    setupSummary: "Post at least one room and a price before going live. The legal card comes first.",
    dataSummary: "Bookings, balances and payment records, tied to named guests and members.",
    hue: 300,
    emblem: "BedDouble",
  },
  automation: {
    promise: "The weekly call becomes assigned work.",
    benefits: [
      "Recordings in, transcripts kept",
      "Every suggested task carries a verbatim quote and timestamp, or is dropped",
      "A human publishes the synthesis to the forum; nothing publishes itself",
      "Suggestions route to the roles they name",
    ],
    forWhom: "Villages whose calls are rich and whose follow-through is thin.",
    setupSummary: "Point it at your call recordings. It works from the first one you feed it.",
    dataSummary: "Recordings, transcripts and the tasks drawn from them. Voices are personal data.",
    hue: 250,
    emblem: "Mic",
  },
  health: {
    promise: "The village's vital signs, frozen at each cycle close.",
    benefits: [
      "Per-lunation snapshots of participation, recognition and contribution",
      "The land's own ledger: trees, water, hectares, as absolute counts",
      "Season goals sit over the numbers as the steering layer",
      "No leaderboards, by design",
    ],
    forWhom: "Villages that steer by evidence and want the land counted too.",
    setupSummary: "Snapshots collect on their own. Record the land's first measurements when ready.",
    dataSummary: "Village-level numbers and land measurements. No personal records.",
    hue: 130,
    emblem: "Activity",
  },
  library: {
    promise: "The village's shared tools and goods, backed by the shelves.",
    benefits: [
      "Donate an item and earn library credits, appraised and capped",
      "Borrow against an escrowed deposit",
      "Every item carries its own history",
      "Selling credits for fiat stays off unless a village opts in past the caution card",
    ],
    forWhom: "Villages with one good drill and eleven people who need it.",
    setupSummary: "Put the first items on the shelves and set your categories before going live.",
    dataSummary: "Items, loans and credit balances, tied to named members.",
    hue: 40,
    emblem: "Hammer",
  },
  badges: {
    promise: "Who people are and what they can do, said out loud.",
    benefits: [
      "Self-declared skills anyone can browse",
      "Badges earn from settled contribution, never from applause",
      "Honors are granted and say who granted them",
      "Warning badges suspend specific capabilities until resolved",
    ],
    forWhom: "Villages that want skills findable and recognition earned.",
    setupSummary: "Works from the start. Add your own badges when the defaults run thin.",
    dataSummary: "Skills, awards and any standing warnings, per named member.",
    hue: 50,
    emblem: "Award",
  },
  exchange: {
    promise: "The village's own tokens, bought from a stocked treasury.",
    benefits: [
      "Buy-only in v1: fiat in, credits out, from treasury stock",
      "Posted prices with a change cap, never a market",
      "Recognition and Hypha-governed tokens can never be listed",
      "Internal trading stays off until the caution card is read and accepted",
    ],
    forWhom: "Villages whose internal economy needs a front door.",
    setupSummary: "Stock the treasury and post prices before going live. The legal card comes first.",
    dataSummary: "Orders and balances, tied to named members and their payment records.",
    hue: 160,
    emblem: "Coins",
  },
  redemption: {
    promise: "A member turns tokens they hold into something real, and the village says when it happened.",
    benefits: [
      "Asking holds the tokens, so nothing is spent twice while the village pays",
      "Tokens are destroyed only after a steward confirms the member was paid",
      "A refusal, a withdrawal or an expiry gives every token back",
      "The confirming key can be handed to a named role",
    ],
    forWhom: "Villages that will pay members back, in cash, services or shares, for tokens they earned.",
    setupSummary: "Nothing to set up to switch it on. The legal card comes first.",
    dataSummary: "Each member's requests, what they asked for, and who decided, tied to named members.",
    hue: 40,
    emblem: "Landmark",
  },
  commerce: {
    promise: "Every payment your project receives, as products you define.",
    benefits: [
      "Application fees, donations, deposits, memberships and token packs",
      "Rides the same verified Stripe spine as stays and the exchange",
      "Zeffy and manual paths for fee-free giving",
      "Money flows in only, always",
    ],
    forWhom: "Villages taking applications, gifts or memberships without a second system.",
    setupSummary: "Create your first product before going live. The legal card comes first.",
    dataSummary: "Orders and payer details, held with the care payment records need.",
    hue: 100,
    emblem: "Handshake",
  },
  crowdpool: {
    promise: "Watch the pool your village is gathering become walls.",
    benefits: [
      "The hub campaign as a living page: gold ring, star lantern, needs shelf",
      "A ledger of arrivals in the map's own voice, aggregates only",
      "Every claim links to the hub page where the pledge itself happens",
      "Partner funder cards carry the hub's own cached numbers",
      "Hub outages degrade to the last snapshot with its age named",
    ],
    forWhom: "Villages raising something real through the hub's crowdpool.",
    setupSummary: "Link at least one hub campaign by id or slug in the module config.",
    dataSummary: "A cached copy of hub-public campaign data. Never member data.",
    hue: 42,
    emblem: "Landmark",
  },
  network: {
    promise: "Villages sharing needs and offers, on purpose.",
    benefits: [
      "Publish a need or an offer to the villages you choose",
      "Read what peer villages share, and nothing else",
      "Nothing about individual members ever travels",
      "Foundations for co-hiring, shared events and resource pooling",
    ],
    forWhom: "Villages that know their neighbours and want pipes between them.",
    setupSummary: "Nothing to set up. Choose your peers and publish when ready.",
    dataSummary: "What this village chose to publish. Never member data.",
    hue: 220,
    emblem: "Globe",
  },
  tools: {
    promise: "One place to find every tool the village uses.",
    benefits: [
      "An audience-aware registry: guests, members and roles each see their own view",
      "A pinned card deep-links your Hypha DHO",
      "Link checking says when a tool went dark",
      "Click counts show what is actually used",
    ],
    forWhom: "Villages whose tools live in eleven tabs somebody has to remember.",
    setupSummary: "Add your first tools, or start from the examples.",
    dataSummary: "Tool links and click counts. Little here is personal.",
    hue: 10,
    emblem: "Wrench",
  },
  events: {
    promise: "The village's one calendar: twelve months and thirteen moons, with equal weight.",
    benefits: [
      "Gatherings with a time, a place, a capacity and an RSVP",
      "Village time: the lunar clock and the year wheel beside the civic date",
      "Subscribe from any calendar app with one address",
      "Other surfaces read it, so the map lights the building something is in",
    ],
    forWhom: "Villages that live by more than one clock.",
    setupSummary: "Nothing to set up. Post the first gathering when it is time.",
    dataSummary: "Events and RSVPs, tied to named members.",
    hue: 280,
    emblem: "CalendarDays",
  },
  governance: {
    promise: "The village decides on-site: weighted ballots, frozen the day they open.",
    benefits: [
      "Staged proposals go to a real vote once support gathers",
      "Thresholds, electorate and weights freeze when a ballot opens",
      "Votes stay changeable until a human closes with a stated outcome",
      "Passed mechanics changes apply through the one amendment ledger",
      "Voting weight and every change to it sit on a member-readable record",
    ],
    forWhom: "Villages ready to conduct their own decisions where the sensing already happens.",
    setupSummary: "Nothing to set up. Pick a weight mode and the dials when you want more than the defaults.",
    dataSummary: "Ballots, who voted what and with what weight, objections and their rulings.",
    hue: 205,
    emblem: "Vote",
  },
  introductions: {
    promise: "A few good introductions a week, and both people say yes first.",
    benefits: [
      "Say what you seek in your own words, with a privacy tier you choose",
      "Offers are suggested from what the village already knows, and only you confirm them",
      "Every match shows its reasons, and you can correct any sentence about you",
      "A mutual yes opens one Messages thread; nothing is accepted for anyone",
    ],
    forWhom: "Villages where the right two people have not met yet.",
    setupSummary: "Nothing to set up. It works from the first intent someone posts.",
    dataSummary: "What members seek and offer, in their own words, plus who was introduced to whom.",
    hue: 320,
    emblem: "Handshake",
  },
  hypha: {
    promise: "Your DAO's real numbers from Base, on your own pages.",
    benefits: [
      "Find your token contracts from your founder account, then confirm each one yourself",
      "The name on screen is the one the contract answers to, read from the chain and dated",
      "Total supply and treasury balance as facts about the village, not one member's holding",
      "A failed chain read shows the last true figure with when it was true, and never a zero",
      "Outcomes that match no proposal are listed for a steward instead of dropped",
    ],
    forWhom: "Villages whose equity and governance already live on a Hypha DAO on Base.",
    setupSummary:
      "Set your DHO address and founder Base account, look your tokens up, and confirm each contract. Reading the chain needs a Base endpoint somebody pays for.",
    dataSummary:
      "Contract addresses, what those contracts call themselves, village-level supply and treasury figures, and a log of outcomes that arrived.",
    hue: 175,
    emblem: "Landmark",
  },
};

// ── The builders' shelf ──────────────────────────────────────────────────────

/**
 * The builder guide, on the UPSTREAM repository.
 *
 * Every fork inherits this exact link, and that is deliberate. Modules ship by
 * pull request to upstream and by no other route, so a link pointing at this
 * fork's own origin would send a builder somewhere their work cannot be
 * reviewed or shipped from. The one URL is correct in every village.
 */
export const BUILDER_GUIDE_URL = "https://github.com/Rieki777/village-os/blob/main/docs/modules/START_HERE.md"; // brand-ok: the upstream platform repository's own address, never a village's brand

/**
 * The module-building walkthrough, beside the guide above. Derived from
 * `BUILDER_GUIDE_URL` so the two can never point at different repositories.
 */
export const BUILD_A_MODULE_URL = BUILDER_GUIDE_URL.replace(/[^/]+$/, "BUILDING_A_MODULE.md");

/**
 * The $ReGen builders' pool page on the hub. The pool is the hub's, shared by
 * every village on the platform, so the address is the hub's own and belongs
 * in platform code the way the upstream repository's does.
 */
export const BUILDERS_POOL_URL = "https://regencivics.earth/builders-pool"; // brand-ok: the hub's own address; the pool lives there for every fork

/**
 * One sentence per pool reason, keyed on what `poolStatus` decided.
 *
 * The server sends `{ eligible, reason, disposition }` and the reason is the
 * whole message: "not eligible" on its own invites the founder to guess, and
 * the ways a module can sit in or out of the pool are not interchangeable. A
 * key with no entry renders nothing instead of a blank label, so a reason added
 * later is silent here instead of wrong.
 *
 * R59 rewrote two of these. A platform-built module and a core module used to
 * be OUT of the pool, and they are now in it with their share returning to it.
 * The sentences say where the money goes, because that is the question somebody
 * reading a pool label is actually asking, and the founder's instruction was
 * that the recycling be visible rather than implied.
 */
export const POOL_REASON_COPY: Record<string, string> = {
  "free-third-party": "In the $ReGen builders' pool",
  paid: "Charges a price, so not in the pool",
  "platform-built": "Earns from the pool, and its share goes back into the pool",
  core: "Core module. Earns from the pool, and its share goes back into the pool",
  withdrawn: "No longer offered, so not in the pool",
};
