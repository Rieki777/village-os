/**
 * The Co-Creators Guide (/co-creators-guide), as fields.
 *
 * THE DEFAULTS ARE NEUTRAL STARTER TEXT (2026-10-23). They were the founding
 * village's own guide: its branded ikigai, its four named spaces, its
 * monthly calls, its Guide and Sage year counts and its slogan. The founding
 * village now holds its own copy (its record is in server/seeds/), so these
 * defaults say only what the platform gives every village: quests, roles,
 * circles, proposals, the path stages, and a decision method the village
 * picks itself. Carried over on purpose:
 *   - the token copy Rye approved on 2026-10-22 (cust-audit/
 *     TOKEN_COPY_PROPOSAL.md rows 1 to 8): the "{token}" section is one line
 *     plus a link to the village's own rules at /game-mechanics. The card of
 *     open quests and roles (EarningsFromTheWork) stays: it reads the work,
 *     never typed figures;
 *   - the pay ruling (Rye, 2026-10-23): no sentence restates that work is
 *     paid, because the quest and role cards say it. The card is "Open quests
 *     and roles", the claim card is "Claim Your Contribution", and the
 *     fourth ikigai circle is the open work, never "what pays";
 *   - the criteria are named by `{good-neighbor}`, the one name field on the
 *     Good Neighbor page, and the commitment by `{commitment}`.
 *
 * Every section after the top can be hidden, and its pill in the sticky bar
 * goes with it. The Hypha section also needs the village's Hypha DHO link
 * (Admin, Variables, `hypha.org_url`): without one it is not drawn, and its
 * "Open Hypha Platform" button goes to that link, never to a shared address.
 */
import type { PageSpec } from "./types";

export const HYPHA_ACTION_IDS = ["agreement", "claim", "expenses", "delegate"] as const;
export const IKIGAI_CIRCLE_IDS = ["love", "good", "needs", "pays"] as const;
export const CONTRIBUTION_LOOP_IDS = ["sense", "propose", "create"] as const;
export const GUIDE_ELDER_IDS = ["guide", "sage"] as const;
export const GUIDE_CTA_IDS = ["commitment", "quests", "events"] as const;

const NAV = (fallback: string) => ({
  key: "navLabel",
  label: "Label in the bar of section links",
  help: "The pill near the top of the page that jumps here.",
  kind: "text" as const,
  max: 22,
  default: fallback,
});

export const CO_CREATORS_GUIDE_PAGE: PageSpec = {
  id: "co-creators-guide",
  label: "Co-Creators Guide",
  path: "/co-creators-guide",
  sections: [
    {
      id: "hero",
      label: "Top of the page",
      shows: "The headline on the dark band.",
      fields: [
        { key: "headline", label: "Headline", kind: "text", max: 45, default: "The {village} Game Guide" },
        {
          key: "intro",
          label: "Paragraph under the headline",
          kind: "long",
          max: 260,
          default:
            "Your guide to taking part in {village}: how work is shared, how decisions get made, and how you grow along the path from Visitor to Sage.",
        },
        { key: "alsoCalled", label: "Small line under the paragraph", help: "Leave blank for none.", kind: "text", max: 40, default: "Also called: The Co-Creators Guide", optional: true },
      ],
    },
    {
      id: "ikigai",
      label: "R-Ikigai",
      shows: "The four overlapping circles and the four boxes beside them.",
      hideable: true,
      fields: [
        NAV("Where You Fit"),
        { key: "heading", label: "Heading", kind: "text", max: 30, default: "Find Where You Fit" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 160,
          default: "Your best fit is where what you love, what you're good at and what {village} needs meet the quests and roles that are open.",
        },
        { key: "centerTop", label: "Middle of the circles, first line", kind: "text", max: 10, default: "Where" },
        { key: "centerBottom", label: "Middle of the circles, second line", kind: "text", max: 12, default: "You Fit" },
      ],
      lists: [
        {
          key: "circles",
          label: "Circles",
          help: "One per circle, in this order: top, right, bottom left, middle. The label sits on the diagram, so keep it short.",
          itemLabel: "Circle",
          titleKey: "title",
          fixed: IKIGAI_CIRCLE_IDS,
          maxItems: 4,
          fields: [
            { key: "label", label: "Label on the diagram", kind: "text", max: 22, default: "" },
            { key: "title", label: "Box title", kind: "text", max: 40, default: "" },
            { key: "body", label: "Box description", kind: "long", max: 130, default: "" },
          ],
          default: [
            {
              label: "What You LOVE",
              title: "What You LOVE (Passion)",
              body: "What brings you alive. What would you do for the joy of it?",
            },
            {
              label: "What You're GOOD AT",
              title: "What You're GOOD AT (Skills)",
              body: "Your natural abilities, experience, and expertise. What do others come to you for?",
            },
            {
              label: "What the VILLAGE NEEDS",
              title: "What {village} NEEDS",
              body: "The gaps that, once filled, make {village} stronger. Where can you fill a real need?",
            },
            {
              label: "What's OPEN",
              title: "What's OPEN (Quests and Roles)",
              body: "The roles and quests {village} needs, each on its own card.",
            },
          ],
        },
      ],
    },
    {
      id: "recognition",
      label: "Tokens",
      shows: "The line naming your tokens, with a link to their rules and the card of what quests and roles are worth.",
      hideable: true,
      fields: [
        NAV("{token}"),
        { key: "heading", label: "Heading", help: "{token} is your recognition token's name, from Admin, Tokens.", kind: "text", max: 40, default: "{token}" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 240,
          default:
            "Every quest and role shows what it is worth on its own card. {token} is recognition from the community, and {village} sets its own rules for it and its other tokens.",
        },
        {
          key: "linkLabel",
          label: "Link to your token rules",
          help: "Opens Game Mechanics, which shows the rules your village set. Leave blank for no link.",
          kind: "text",
          max: 30,
          default: "See how they work here",
          optional: true,
        },
        {
          key: "cardTitle",
          label: "Title of the card of what work is worth",
          help: "The card lists what open quests and roles are set to, read from the work itself.",
          kind: "text",
          max: 40,
          default: "Open quests and roles",
        },
      ],
    },
    {
      id: "voice",
      label: "Voice and governance",
      shows: "How proposals work and the key principles beside them.",
      hideable: true,
      fields: [
        NAV("Voice & Governance"),
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Voice & Governance" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 200,
          default:
            "Everyone's voice matters at {village}. Circles look after their own areas, anyone can bring a proposal, and the village decides together in the way it has chosen.",
        },
        { key: "stepsHeading", label: "Heading over the steps", kind: "text", max: 30, default: "How Proposals Work" },
        {
          key: "note",
          label: "Note under the steps",
          help: "Wrap words in **double stars** to make them bold. Leave blank for none.",
          kind: "long",
          max: 160,
          default: "**Village-wide decisions:** what affects everyone goes to the whole village, in the open.",
          optional: true,
        },
        { key: "principlesHeading", label: "Heading over the principles", kind: "text", max: 30, default: "Key Principles" },
      ],
      lists: [
        {
          key: "steps",
          label: "Steps",
          help: "Numbered in the order shown.",
          itemLabel: "Step",
          titleKey: "title",
          maxItems: 5,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 20, default: "" },
            { key: "description", label: "Description", kind: "long", max: 130, default: "" },
          ],
          default: [
            { title: "Proposal", description: "Anyone can raise a proposal for action or change, with clear context and goals." },
            { title: "Clarification", description: "People ask questions until the proposal is clear, and it may be refined along the way." },
            { title: "Decision", description: "The village decides in the way it has chosen, and everyone can see the outcome." },
          ],
        },
        {
          key: "principles",
          label: "Principles",
          help: "Each gets the next icon and colour in a fixed set.",
          itemLabel: "Principle",
          titleKey: "title",
          maxItems: 6,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 30, default: "" },
            { key: "body", label: "Description", kind: "long", max: 130, default: "" },
          ],
          default: [
            { title: "Circles Look After Their Areas", body: "Each circle makes the decisions that belong to its own area of work." },
            { title: "Anyone Can Propose", body: "If you see something that could be better, you can bring a proposal. Good ideas come from everywhere." },
            { title: "Decisions in the Open", body: "Proposals and their outcomes are visible to the village, so everyone knows what was decided." },
            { title: "Anyone Can Raise Concerns", body: "If you see a problem, speak up. Concerns shape better decisions." },
          ],
        },
      ],
    },
    {
      id: "hypha",
      label: "Hypha",
      shows: "The dark section about your Hypha space and its four action cards. Drawn only while your Hypha DHO link is set in Admin, Variables.",
      hideable: true,
      fields: [
        NAV("Hypha Platform"),
        { key: "eyebrow", label: "Small label above the heading", kind: "text", max: 32, default: "Where Agreements Are Kept", optional: true },
        { key: "heading", label: "Heading", kind: "text", max: 32, default: "Meet Hypha" },
        {
          key: "intro",
          label: "First paragraph",
          help: "Wrap words in **double stars** to make them bold.",
          kind: "long",
          max: 450,
          default:
            "{village} keeps its agreements and decisions in its own space on **Hypha**, where they are recorded for every member to see and check.",
        },
        {
          key: "body",
          label: "Second paragraph",
          kind: "long",
          max: 200,
          default: "Your proposals, your contributions and your votes live there, on the record.",
          optional: true,
        },
        { key: "openLabel", label: "Button to your Hypha space", help: "Opens your Hypha DHO link from Admin, Variables.", kind: "text", max: 30, default: "Open Our Hypha Space" },
        { key: "valueHeading", label: "Heading of the box under the button", kind: "text", max: 30, default: "Value In = Value Out" },
        {
          key: "valueBody",
          label: "Paragraph in that box",
          kind: "long",
          max: 420,
          default:
            "Every proposal asks one question: does this serve {village}? Describe the value you will create, or have created, clearly and honestly, and the community weighs it.",
        },
        { key: "loopHeading", label: "Heading over the three steps at the bottom", kind: "text", max: 50, default: "The {village} Contribution Loop" },
      ],
      lists: [
        {
          key: "actions",
          label: "Action cards",
          help: "One per card, in this order. Each button opens its own page in your Hypha space.",
          itemLabel: "Card",
          titleKey: "title",
          fixed: HYPHA_ACTION_IDS,
          maxItems: 4,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 30, default: "" },
            { key: "subtitle", label: "Second line", kind: "text", max: 50, default: "" },
            { key: "description", label: "Description", kind: "long", max: 340, default: "" },
            { key: "cta", label: "Button", kind: "text", max: 25, default: "" },
          ],
          default: [
            {
              title: "Start with an Agreement",
              subtitle: "Proposing a role, quest, or new contribution",
              description:
                "Before you begin a new role, quest or initiative, you open it to the community with an Agreement. Describe what you are bringing, what {village} receives, and what you are asking in return. The community decides.",
              cta: "Create Agreement",
            },
            {
              title: "Claim Your Contribution",
              subtitle: "After completing a task or season",
              description:
                "When you've done the work, completed a quest, finished a season as a role holder, or reached a milestone, you come back and propose a Contribution Claim. Detail what you delivered and what {village} gained. This is how the value you create becomes visible.",
              cta: "Propose a Contribution",
            },
            {
              title: "Propose Expenses",
              subtitle: "When your work has real costs",
              description:
                "If your contribution requires purchasing materials, covering travel, or paying for services that benefit the community, you can propose those expenses for reimbursement. Be transparent and specific, the community is the budget committee here, and your integrity in how you handle shared resources is part of your contribution.",
              cta: "Pay for Expenses",
            },
            {
              title: "Delegate Your Voice",
              subtitle: "Trust someone to vote on your behalf",
              description:
                "Your voice is your say in how {village} is governed. If you trust another member to represent your perspective while you're away or unavailable, you can delegate your voice to them. Choose someone whose judgment and commitment you trust.",
              cta: "View Members",
            },
          ],
        },
        {
          key: "loop",
          label: "Contribution loop",
          help: "Three steps, side by side on a wide screen.",
          itemLabel: "Step",
          titleKey: "label",
          fixed: CONTRIBUTION_LOOP_IDS,
          maxItems: 3,
          fields: [
            { key: "label", label: "Name", kind: "text", max: 12, default: "" },
            { key: "description", label: "Description", kind: "long", max: 130, default: "" },
          ],
          default: [
            { label: "Sense", description: "Find where your gifts are most needed. A quest waiting. A gap in the land. A conversation that sparks something." },
            { label: "Propose", description: "Open your intention to the community in Hypha. The question is simply whether it serves the village." },
            { label: "Create", description: "Do the work. Document it. Share what you created with the community." },
          ],
        },
      ],
    },
    {
      id: "spaces",
      label: "Spaces",
      shows: "The coloured cards naming the areas the village's work falls into.",
      hideable: true,
      fields: [
        NAV("Areas of Work"),
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Areas of Work" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 150,
          default: "The work of {village} falls into a few areas, each cared for by the people closest to it.",
        },
      ],
      lists: [
        {
          key: "items",
          label: "Spaces",
          help: "Up to four, two side by side on a wide screen. Each gets the next icon and colour in a fixed set.",
          itemLabel: "Space",
          titleKey: "title",
          maxItems: 4,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 30, default: "" },
            { key: "description", label: "Description", kind: "text", max: 80, default: "" },
          ],
          default: [
            { title: "Village Stewardship", description: "The village as a whole: its direction and its care" },
            { title: "Daily Life", description: "Homes, neighbors and life together" },
            { title: "Shared Enterprise", description: "Livelihoods, businesses and shared work" },
            { title: "Land Care", description: "The health of the land, the water and the living things on it" },
          ],
        },
      ],
    },
    {
      id: "progression",
      label: "Path of growth",
      shows: "The grid of stages and the two cards for the deepest stages.",
      hideable: true,
      fields: [
        NAV("Path of Growth"),
        { key: "heading", label: "Heading", kind: "text", max: 30, default: "Path of Growth" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 160,
          default: "Your journey through {village}, from first contact to deepest participation. Each stage has its own gifts and responsibilities.",
        },
      ],
      lists: [
        {
          key: "stages",
          label: "Stages",
          help: "Up to twelve, in order. They are tinted by position: the first four plain, the next three, the next three, then the last two in their own colours.",
          itemLabel: "Stage",
          titleKey: "label",
          maxItems: 12,
          fields: [
            { key: "label", label: "Name", kind: "text", max: 16, default: "" },
            { key: "note", label: "Small line under it", help: "Leave blank for none.", kind: "text", max: 20, default: "", optional: true },
          ],
          default: [
            { label: "Visitor" },
            { label: "Guest" },
            { label: "Immersant" },
            { label: "Participant" },
            { label: "Member" },
            { label: "Contributor" },
            { label: "Quest Seeker" },
            { label: "Initiate" },
            { label: "Co-Creator" },
            { label: "Role Holder" },
            { label: "Guide" },
            { label: "Sage" },
          ],
        },
        {
          key: "elders",
          label: "Deepest stages",
          help: "The two cards under the stages.",
          itemLabel: "Card",
          titleKey: "title",
          fixed: GUIDE_ELDER_IDS,
          maxItems: 2,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 20, default: "" },
            { key: "body", label: "Description", kind: "long", max: 200, default: "" },
            { key: "duties", label: "Responsibilities", help: "Wrap words in **double stars** to make them bold.", kind: "long", max: 130, default: "", optional: true },
          ],
          default: [
            {
              title: "Guide",
              body: "A Guide has walked the path long enough to help others along it. Guides mentor newer members, hold the village's memory, and help people find their way.",
              duties: "**Responsibilities:** Mentorship, sharing what they know, and welcoming newcomers.",
            },
            {
              title: "Sage",
              body: "Sages carry {village}'s long view. They hold its values close and help the village through its hardest decisions.",
              duties: "**Responsibilities:** The long view, care for the village's values, and help with hard conflicts.",
            },
          ],
        },
      ],
    },
    {
      id: "goodNeighbor",
      label: "Good neighbor summary",
      shows: "The short version of your criteria, with a button to the full page.",
      hideable: true,
      fields: [
        NAV("Good Neighbor"),
        {
          key: "heading",
          label: "Heading",
          help: "{good-neighbor} is the name in the headline box at the top of the Good Neighbor page.",
          kind: "text",
          max: 40,
          default: "{good-neighbor}",
        },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 120,
          default: "Everyone who lives at {village} commits to these.",
        },
        {
          key: "body",
          label: "Paragraph above the button",
          kind: "long",
          max: 200,
          default:
            "The {good-neighbor} are essential for anyone who wants to live here. They describe how neighbors treat each other and share the place.",
        },
        { key: "buttonLabel", label: "Button to the Good Neighbor page", kind: "text", max: 40, default: "Read the Full {good-neighbor}" },
      ],
      lists: [
        {
          key: "pillars",
          label: "Pillars",
          help: "Up to four, side by side on a wide screen. Each gets the next icon in a fixed set.",
          itemLabel: "Pillar",
          titleKey: "title",
          maxItems: 4,
          fields: [
            { key: "title", label: "Title", help: "{commitment} is what a member signs, from Identity.", kind: "text", max: 28, default: "" },
            { key: "description", label: "Description", kind: "text", max: 50, default: "" },
          ],
          default: [
            { title: "Shared Values", description: "Living by what the village stands for" },
            { title: "Honest Communication", description: "Working through conflict directly and kindly" },
            { title: "Financial Responsibility", description: "Meeting the commitments you make" },
            { title: "Taking Part", description: "Active in the work and the decisions" },
          ],
        },
      ],
    },
    {
      id: "cta",
      label: "Ready to begin",
      shows: "Three cards leading on. The third goes to your Events page URL and hides when that is blank.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 30, default: "Ready to Begin?" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 120,
          default: "Every path starts with a single step. Choose yours below.",
        },
        { key: "moreLabel", label: "Link line on every card", kind: "text", max: 20, default: "Learn More" },
      ],
      lists: [
        {
          key: "cards",
          label: "Cards",
          help: "In this order: your {commitment} page, the quest board, your events page.",
          itemLabel: "Card",
          titleKey: "title",
          fixed: GUIDE_CTA_IDS,
          maxItems: 3,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 28, default: "" },
            { key: "description", label: "Description", kind: "text", max: 70, default: "" },
          ],
          default: [
            { title: "Read the {commitment}", description: "What members sign, and why it matters" },
            { title: "Find Your Quest", description: "Discover opportunities that match your gifts" },
            { title: "Come to an Event", description: "Meet us live and ask your questions" },
          ],
        },
      ],
    },
    {
      id: "closing",
      label: "Closing words",
      shows: "The quotation on the dark band at the very bottom.",
      hideable: true,
      fields: [
        {
          key: "quote",
          label: "Quotation",
          help: "Shown in italics, inside quotation marks.",
          kind: "long",
          max: 280,
          default: "A village is never finished. We keep building {village} together, one season, one quest and one good decision at a time.",
        },
        { key: "signoff", label: "Line under it", help: "Leave blank for none.", kind: "text", max: 40, default: "Welcome to {village}", optional: true },
      ],
    },
  ],
};
