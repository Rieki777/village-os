/**
 * How We Create (/how-we-create), as fields.
 *
 * THE DEFAULTS ARE NEUTRAL STARTER TEXT (2026-10-23). They were the founding
 * village's own: its sociocracy and Teal, its eight circles, its development
 * board, its three-month seasons and its slogan. The founding village now
 * holds its own copy (its record is in server/seeds/), so these defaults
 * describe only what the platform gives every village: circles, proposals,
 * a decision method the village picks itself (governance.default_method),
 * seasons, and its tokens by name.
 *
 * The token copy Rye approved on 2026-10-22 (cust-audit/TOKEN_COPY_PROPOSAL.md
 * rows 9 to 14) stays: a token is named, and no sentence says what it does.
 * The "Get paid for your work" card is gone from the token section's default
 * list (Rye, 2026-10-23: the quest and role cards already say it), so the
 * section is the line and the link alone until a village adds a card.
 *
 * The Hypha section draws only while the village's Hypha DHO link is set
 * (Admin, Variables, `hypha.org_url`) as well as switched on here: a village
 * with no Hypha space was being told "we use Hypha.earth tools".
 *
 * The governance phases name no count of circles. Wiring them to the
 * village's real circles (/api/org) is a later change.
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
          default: "How {village} makes decisions, shares its work and moves through the seasons.",
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
              title: "Shared Governance",
              description:
                "Decisions are made together by the people they affect. Circles take care of their own areas of work, and anyone can bring a proposal.",
            },
            {
              title: "Decisions That Fit",
              description:
                "{village} chooses how it decides: by consent, by consensus, by majority, or by rules of its own. It can change that choice by agreement.",
            },
            {
              title: "{token}",
              description: "Recognition from the community. {village} sets its own rules for it and for its other tokens, and changes them by agreement.",
            },
            {
              title: "Seasonal Rhythm",
              description:
                "The village moves through seasons. At each turn, it looks back at what it did and decides together what comes next.",
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
          default: [],
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
          default: "Who decides what, and how that changes as the village grows.",
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
              title: "Early Days",
              item1: "The people who start it hold the first decisions",
              item2: "Circles form around the work",
              item3: "Members take on roles as they join",
            },
            {
              title: "Established",
              item1: "Circles decide within their own areas",
              item2: "Anyone can bring a proposal",
              item3: "The whole village decides what affects everyone",
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
          default: "{village} keeps its agreements and decisions on **Hypha**. Each circle can set up how it decides, to suit its own work.",
        },
        { key: "boxHeading", label: "Heading of the box under the methods", kind: "text", max: 40, default: "How Hypha Enables This" },
        {
          key: "boxBody",
          label: "Paragraph in that box",
          kind: "long",
          max: 400,
          default:
            "Hypha holds agreements, roles and proposals in one place. A circle can set its own voting threshold, quorum and time to decide, and every agreement stays on the record for anyone to check.",
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
          default: "{village} moves through the year in seasons. Each season has its own focus, and the community decides together what it will be.",
        },
        {
          key: "note",
          label: "Note under the cards",
          help: "Wrap words in **double stars** to make them bold. Leave blank for none.",
          kind: "long",
          max: 320,
          default: "**Each season is a chapter.** At its end the village looks back at what it did, celebrates, and sets the focus for the next one.",
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
              description: "Beginnings. Starting new projects and planting what we want to grow.",
            },
            {
              name: "Summer",
              title: "Summer Season",
              description: "Full momentum. Gatherings, shared work and celebration. The season to show up and build together.",
            },
            {
              name: "Fall",
              title: "Fall Season",
              description: "Harvest. Gathering what has grown, learning from the year and giving thanks.",
            },
            {
              name: "Winter",
              title: "Winter Season",
              description: "Rest and design. Looking at how the village works and planning what comes next. The season to think long.",
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
          default: "Read the Co-Creators Guide for the detail, or come to an event and ask your questions.",
        },
        { key: "guideLabel", label: "Button to the Co-Creators Guide", kind: "text", max: 30, default: "Read the Co-Creators Guide" },
        { key: "eventsLabel", label: "Second button", help: "Leave blank for one button.", kind: "text", max: 28, default: "See Upcoming Events", optional: true },
      ],
    },
  ],
};
