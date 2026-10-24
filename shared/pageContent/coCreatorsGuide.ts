/**
 * The Co-Creators Guide (/co-creators-guide), as fields.
 *
 * The defaults are the words the page carried in code until 2026-10-22, moved
 * here unchanged, EXCEPT:
 *   - the token copy Rye approved that day (cust-audit/TOKEN_COPY_PROPOSAL.md
 *     rows 1 to 8): the "{token}" section is one line plus a link to the
 *     village's own rules at /game-mechanics, and the hold card, the spend
 *     card and the flow chips are gone. The card of live quest and role pay
 *     (EarningsFromTheWork) stays: it reads the work, never typed figures;
 *   - "Love Letter" is `{commitment}` (Amora's commitment name IS "Love
 *     Letter", so it reads the same there), and the criteria are named by
 *     `{good-neighbor}`, the one name field on the Good Neighbor page.
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
            "Your complete guide to co-creating this village. How the economy works, how decisions get made, how to use our governance platform, and what the journey from visitor to Sage looks like.",
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
        NAV("R-Ikigai"),
        { key: "heading", label: "Heading", kind: "text", max: 30, default: "Your R-Ikigai" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 160,
          default: "The intersection of what you love, what you're good at, what {village} needs, and what the village pays for.",
        },
        { key: "centerTop", label: "Middle of the circles, first line", kind: "text", max: 10, default: "Your" },
        { key: "centerBottom", label: "Middle of the circles, second line", kind: "text", max: 12, default: "R-Ikigai" },
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
              body: "Your authentic desires and what brings you alive. What would you do even if no one paid you?",
            },
            {
              label: "What You're GOOD AT",
              title: "What You're GOOD AT (Skills)",
              body: "Your natural abilities, experience, and expertise. What do others come to you for?",
            },
            {
              label: "What the VILLAGE NEEDS",
              title: "What {village} NEEDS (Regeneration)",
              body: "The gaps we need filled to create a thriving, regenerative community. Where can you fill a real need?",
            },
            {
              label: "What PAYS",
              title: "What PAYS (Compensation)",
              body: "Roles and quests, each with its own value and the tokens it pays, on its card.",
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
          default: "Get paid for your work",
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
            "{village} practices consent-based decision making where everyone's voice matters, circles hold authority within their domains, and all concerns are heard.",
        },
        { key: "stepsHeading", label: "Heading over the steps", kind: "text", max: 30, default: "How Proposals Work" },
        {
          key: "note",
          label: "Note under the steps",
          help: "Wrap words in **double stars** to make them bold. Leave blank for none.",
          kind: "long",
          max: 160,
          default: "**Monthly All-Village Calls:** Major cross-circle decisions happen here, with full transparency and participation.",
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
            { title: "Proposal", description: "Anyone can raise a proposal for action or change. Proposals are presented clearly with context and goals." },
            { title: "Clarification", description: "The circle asks clarifying questions. This isn't debate, just understanding. Proposals may be refined." },
            { title: "Consent", description: "We look for consent, not unanimous agreement. No reasoned objections means we move forward." },
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
            { title: "Circles Hold Authority", body: "Each circle has decision-making power within its domain. No single person overrides the circle." },
            { title: "Objections vs. Disagreements", body: "A reasoned objection blocks progress. A disagreement is noted but doesn't stop the work. Know the difference." },
            { title: "Consent Culture", body: "We're not seeking unanimous agreement. We're looking for no reasoned objections. That's enough to move forward." },
            { title: "Anyone Can Raise Concerns", body: "If you see a problem, speak up. Concerns shape better decisions. Silence isn't consent." },
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
        { key: "eyebrow", label: "Small label above the heading", kind: "text", max: 32, default: "Where Governance Gets Real", optional: true },
        { key: "heading", label: "Heading", kind: "text", max: 32, default: "Meet Hypha" },
        {
          key: "intro",
          label: "First paragraph",
          help: "Wrap words in **double stars** to make them bold.",
          kind: "long",
          max: 450,
          default:
            "Hypha is the platform where every {village} decision lives, recorded, verifiable, and tamper-proof on a distributed ledger. This isn't a shared Google Doc or a Discord vote that disappears. It's an **incredibly secure, globally trusted governance system** used by communities around the world to hold their most important decisions. Your voice here is permanent. Your contributions here are real.",
        },
        {
          key: "body",
          label: "Second paragraph",
          kind: "long",
          max: 200,
          default:
            "No single person, not even the founders, can override a community consent vote on Hypha. That's the point. When we say {village} is community-governed, this is what makes it true.",
          optional: true,
        },
        { key: "openLabel", label: "Button to your Hypha space", help: "Opens your Hypha DHO link from Admin, Variables.", kind: "text", max: 30, default: "Open Hypha Platform" },
        { key: "valueHeading", label: "Heading of the box under the button", kind: "text", max: 30, default: "Value In = Value Out" },
        {
          key: "valueBody",
          label: "Paragraph in that box",
          kind: "long",
          max: 420,
          default:
            "Every proposal puts one question to the community: does this contribution serve {village}? Not hours logged, hours are not a contribution. What matters is the actual value created, articulated clearly, and assessed honestly by your peers.",
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
                "Before you begin any new type of contribution, a seasonal role, a quest, or a new initiative, you open it to the community with an Agreement. Describe what you're bringing, what {village} receives, and what you're requesting in return. The community votes. Value in = value out.",
              cta: "Create Agreement",
            },
            {
              title: "Claim Your Tokens",
              subtitle: "After completing a task, pay period, or season",
              description:
                "When you've done the work, completed a quest, finished a season as a role holder, or reached a milestone, you come back and propose a Contribution Claim. Detail what you delivered, what {village} gained, and claim the tokens it earned. This is how the value you create becomes visible and rewarded.",
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
                "Your voice is your governance power, it grows as you contribute. If you trust another member to represent your perspective while you're away or unavailable, you can delegate your voice to them. Choose someone whose judgment aligns with yours and whose commitment to {village} you trust deeply.",
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
            { label: "Propose", description: "Open your intention to the community in Hypha. Consent-based: the check is simply whether this serves us." },
            { label: "Create", description: "Do the work. Document it. Share what you created with the community." },
          ],
        },
      ],
    },
    {
      id: "spaces",
      label: "Spaces",
      shows: "The coloured cards naming the circles the village is organized into.",
      hideable: true,
      fields: [
        NAV("The Four Spaces"),
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "The Four Spaces" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 150,
          default: "{village} is organized into four interconnected circles, each stewarding a different dimension of our community.",
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
            { title: "Village Steward Space", description: "Coordinates overall village success, open to all path members" },
            { title: "Resident Space", description: "Governs residential life and neighbor relations" },
            { title: "Prosperity Space", description: "Manages business interests and shared enterprise" },
            { title: "Land Stewardship Space", description: "Cares for land and ecosystem health" },
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
            { label: "Member", note: "({village} Family)" },
            { label: "Contributor" },
            { label: "Quest Seeker" },
            { label: "Initiate" },
            { label: "Co-Creator" },
            { label: "Role Holder" },
            { label: "Guide", note: "(7+ years)" },
            { label: "Sage", note: "(21+ years)" },
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
              body: "After 7+ years of deep participation, you become a Guide. Guides mentor others, hold institutional memory, and help newer members navigate their journey.",
              duties: "**Responsibilities:** Mentorship, wisdom sharing, ceremony holding, and intergenerational connection.",
            },
            {
              title: "Sage",
              body: "After 21+ years, a Guide may become a Sage. Sages are the living embodiment of {village}'s values and vision, holding space for the village's evolution.",
              duties: "**Responsibilities:** Long-term vision, values stewardship, conflict resolution, and community healing.",
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
          default: "To become a resident of {village}, you commit to embodying these four pillars.",
        },
        {
          key: "body",
          label: "Paragraph above the button",
          kind: "long",
          max: 200,
          default:
            "The {good-neighbor} are essential for anyone seeking to become a Resident. They reflect our commitment to authentic community and mutual respect.",
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
            { title: "{commitment} Values", description: "Commitment to community values" },
            { title: "Authentic Communication", description: "Resolve conflicts with integrity" },
            { title: "Financial Stability", description: "Meet community dues" },
            { title: "Governance Participation", description: "Active in decision-making" },
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
          default: "The infinite journey starts with a single step. Choose your path below.",
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
            { title: "The {commitment}", description: "Read our community covenant and founding values" },
            { title: "Find Your Quest", description: "Discover opportunities that match your gifts" },
            { title: "Join Community Call", description: "Meet us live and ask your questions" },
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
          default:
            "{village} is an Infinite Game, played to keep creating together. We co-become the most beautiful village, where all beings belong and thrive. Success is measured by the flourishing of our community, land, and relationships.",
        },
        { key: "signoff", label: "Line under it", help: "Leave blank for none.", kind: "text", max: 40, default: "Welcome to {village}", optional: true },
      ],
    },
  ],
};
