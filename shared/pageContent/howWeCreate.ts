/**
 * How We Create (/how-we-create), as fields.
 *
 * The defaults are the words the page carried in code until 2026-10-22, moved
 * here unchanged, EXCEPT the token copy Rye approved that day
 * (cust-audit/TOKEN_COPY_PROPOSAL.md rows 9 to 14): a token is named, and no
 * sentence says what it does. The economy section became "Our Tokens", one
 * line plus a link to the village's own rules at /game-mechanics; the pool
 * card, the conversion card and the footnote are gone.
 *
 * The Hypha section draws only while the village's Hypha DHO link is set
 * (Admin, Variables, `hypha.org_url`) as well as switched on here: a village
 * with no Hypha space was being told "we use Hypha.earth tools".
 *
 * "8 Sociocratic Circles" stays default text in an editable line. Wiring it to
 * the village's real circles (/api/org) is a later change.
 */
import type { FieldSpec, PageSpec } from "./types";

const numbered = (prefix: string, label: string, count: number, max: number): FieldSpec[] =>
  Array.from({ length: count }, (_, i) => ({
    key: `${prefix}${i + 1}`,
    label: `${label} ${i + 1}`,
    kind: "text" as const,
    max,
    default: "",
    optional: true,
  }));

export const HOW_WE_CREATE_PAGE: PageSpec = {
  id: "how-we-create",
  label: "How We Create",
  path: "/how-we-create",
  sections: [
    {
      id: "hero",
      label: "Top of the page",
      shows: "The headline and the sentence under it.",
      fields: [
        { key: "headline", label: "Headline", kind: "text", max: 40, default: "How We Create Together" },
        {
          key: "intro",
          label: "Sentence under the headline",
          kind: "long",
          max: 160,
          default: "Our governance, economic, and organizational systems are designed to ensure all beings belong and thrive.",
        },
      ],
    },
    {
      id: "principles",
      label: "Principles",
      shows: "The large cards under the top of the page. Each gets the next icon in a fixed set.",
      hideable: true,
      fields: [],
      lists: [
        {
          key: "items",
          label: "Principles",
          help: "Two side by side on a wide screen.",
          itemLabel: "Principle",
          titleKey: "title",
          maxItems: 6,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 30, default: "" },
            { key: "description", label: "Description", kind: "long", max: 300, default: "" },
          ],
          default: [
            {
              title: "Sociocracy & Teal",
              description:
                "We blend sociocratic governance with Teal organization principles. Self-management, wholeness, and evolutionary purpose guide our structure.",
            },
            {
              title: "Adaptive Governance",
              description:
                "Using Hypha tools, each circle designs its own governance strategy, from consent to consensus, tailored to its unique culture, values, and mission.",
            },
            {
              title: "{token}",
              description: "Recognition from the community. {village} sets its own rules for it and for its other tokens, and changes them by agreement.",
            },
            {
              title: "Seasonal Rhythm",
              description:
                "Every 3 months, the community decides together what kind of season comes next, a living response to what {village} needs most right now.",
            },
          ],
        },
      ],
    },
    {
      id: "tokens",
      label: "Our tokens",
      shows: "The shaded panel naming the village's tokens, with a link to the rules the village set for them.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Our Tokens" },
        {
          key: "intro",
          label: "Sentence under the heading",
          help: "{token} is your recognition token's name, from Admin, Tokens.",
          kind: "long",
          max: 240,
          default: "{village} keeps its own tokens, {token} among them. Their rules are the community's to design.",
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
      ],
      lists: [
        {
          key: "cards",
          label: "Cards",
          help: "Up to three, side by side on a wide screen.",
          itemLabel: "Card",
          titleKey: "title",
          maxItems: 3,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 30, default: "" },
            { key: "body", label: "Description", kind: "long", max: 220, default: "" },
          ],
          default: [
            {
              title: "Get paid for your work",
              body: "Every quest and role shows what it is worth on its own card. Revenue shares from community and private businesses are agreed with the village.",
            },
          ],
        },
      ],
    },
    {
      id: "governance",
      label: "Governance structure",
      shows: "The panel of governance phases, with a button to the Roles page.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 45, default: "Our Governance Structure" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 120,
          default: "Multi-tiered governance balancing development expertise with community wisdom.",
        },
        { key: "buttonLabel", label: "Button to the Roles page", help: "Leave blank for no button.", kind: "text", max: 32, default: "Explore Governance Roles", optional: true },
      ],
      lists: [
        {
          key: "phases",
          label: "Phases",
          help: "Two side by side on a wide screen. A blank line is not drawn.",
          itemLabel: "Phase",
          titleKey: "title",
          maxItems: 4,
          fields: [{ key: "title", label: "Title", kind: "text", max: 30, default: "" }, ...numbered("item", "Line", 5, 60)],
          default: [
            {
              title: "Development Phase",
              item1: "Development Board provides expert oversight",
              item2: "Community Advisory Council shapes culture",
              item3: "Core Team manages execution",
            },
            {
              title: "Operations Phase",
              item1: "8 Sociocratic Circles take active role",
              item2: "Leadership Council coordinates",
              item3: "Community self-governance emerges",
            },
          ],
        },
      ],
    },
    {
      id: "hypha",
      label: "Governance with Hypha",
      shows: "Ways a circle can decide, and how Hypha records them. Drawn only while your Hypha DHO link is set in Admin, Variables.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 45, default: "Flexible Governance with Hypha" },
        {
          key: "intro",
          label: "Paragraph under the heading",
          help: "Wrap words in **double stars** to make them bold.",
          kind: "long",
          max: 280,
          default:
            "Inspired by Teal and sociocracy, we use **Hypha.earth** tools to let each circle design its own governance strategy. No one-size-fits-all-each space can tailor decision-making to its unique culture, values, and mission.",
        },
        { key: "boxHeading", label: "Heading of the box under the methods", kind: "text", max: 40, default: "How Hypha Enables This" },
        {
          key: "boxBody",
          label: "Paragraph in that box",
          kind: "long",
          max: 400,
          default:
            "Hypha provides tools to formalize agreements, track roles, and manage proposals. Each circle can configure voting thresholds, quorum requirements, and decision timeframes. This creates transparency while honoring each group's autonomy. All agreements and role assignments are recorded on-chain for accountability.",
        },
      ],
      lists: [
        {
          key: "methods",
          label: "Ways to decide",
          help: "Two side by side on a wide screen. Each gets the next icon in a fixed set.",
          itemLabel: "Method",
          titleKey: "name",
          maxItems: 6,
          fields: [
            { key: "name", label: "Name", kind: "text", max: 24, default: "" },
            { key: "description", label: "Description", kind: "long", max: 140, default: "" },
            { key: "best", label: "Best for", help: "Shown after \"Best for:\". Leave blank for none.", kind: "text", max: 60, default: "", optional: true },
          ],
          default: [
            { name: "Consent", description: "No objections means the proposal passes. Fast and efficient for most decisions.", best: "Operational decisions, role assignments" },
            { name: "Consensus", description: "Everyone actively agrees. Builds deep alignment but takes more time.", best: "Major community decisions, values alignment" },
            { name: "Advice Process", description: "Anyone can make a decision after seeking advice from affected parties.", best: "Individual initiatives, quick actions" },
            { name: "Custom Blend", description: "Mix and match methods based on decision type and urgency.", best: "Circles with diverse needs" },
          ],
        },
      ],
    },
    {
      id: "seasons",
      label: "Seasonal rhythm",
      shows: "The season cards and the note under them. Each card gets the next emoji and colour in a fixed set.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 30, default: "Seasonal Rhythm" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 200,
          default:
            "Every 3 months, the community votes on what kind of season comes next, a collective response to what {village} needs most. Each season is its own chapter.",
        },
        {
          key: "note",
          label: "Note under the cards",
          help: "Wrap words in **double stars** to make them bold. Leave blank for none.",
          kind: "long",
          max: 320,
          default:
            "**No fixed cycle.** At the end of each season, the community comes together to vote on what's needed next. A village that just built all summer might choose Winter to design what comes next. A village deep in planning might choose Spring to break ground. The seasons follow {village}'s needs, not a calendar.",
          optional: true,
        },
      ],
      lists: [
        {
          key: "seasons",
          label: "Seasons",
          help: "Two side by side on a wide screen.",
          itemLabel: "Season",
          titleKey: "name",
          maxItems: 6,
          fields: [
            { key: "name", label: "Name (the coloured label)", kind: "text", max: 16, default: "" },
            { key: "title", label: "Title", kind: "text", max: 30, default: "" },
            { key: "description", label: "Description", kind: "long", max: 170, default: "" },
          ],
          default: [
            {
              name: "Spring",
              title: "Spring Season",
              description: "Breaking ground. Starting new buildings, projects, and initiatives. The season for bold beginnings and planting what we want to grow.",
            },
            {
              name: "Summer",
              title: "Summer Season",
              description: "Full momentum. Festivals, events, gatherings, and high community activity. The season to show up, celebrate, and build together at full energy.",
            },
            {
              name: "Fall",
              title: "Fall Season",
              description: "Harvest time. Reflection, lessons learned, and appreciating the abundance we've created. The season to gather what we've grown and give thanks.",
            },
            {
              name: "Winter",
              title: "Winter Season",
              description: "Deep design. Systems redesign, governance evolution, economic modelling, financial preparation, and investor relations. The season to think long.",
            },
          ],
        },
      ],
    },
    {
      id: "cta",
      label: "Learn more",
      shows: "The closing box. Its second button goes to your Events page URL and hides when that is blank.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Learn More" },
        {
          key: "body",
          label: "Sentence under the heading",
          kind: "long",
          max: 160,
          default: "Dive deeper into our governance and economic systems in the Co-Creators Guide, or join a community call to ask questions.",
        },
        { key: "guideLabel", label: "Button to the Co-Creators Guide", kind: "text", max: 30, default: "Read the Co-Creators Guide" },
        { key: "eventsLabel", label: "Second button", help: "Leave blank for one button.", kind: "text", max: 28, default: "Join Community Call", optional: true },
      ],
    },
  ],
};
