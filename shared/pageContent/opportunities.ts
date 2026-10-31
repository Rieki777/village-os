/**
 * The business opportunities page (/opportunities), as fields.
 *
 * The defaults are NEUTRAL STARTER TEXT (2026-10-23), true of any village.
 * They were the first village's words until then; that village keeps its own
 * copy in its database, and the record of it is
 * server/seeds/amora/pages/page-opportunities.json. The eight cards keep their
 * kinds of venture, the kinds a village commonly hopes for, and lose every
 * figure and every status: a "Planning" or an "Active" badge is a claim about
 * one village's progress, so a card starts with none.
 *
 * Rye's token ruling of 2026-10-22 (TOKEN_COPY_PROPOSAL rows 31 to 33) holds
 * here too: a token may be named, and no sentence says what it does.
 *
 * THE EIGHT VENTURE IDS ARE A STORAGE CONTRACT. `content.money.ventureInvestment`
 * is keyed by them (the investment range a village types per venture), so the
 * list is FIXED: a village renames, rewrites or hides the cards, and the range
 * it typed stays on the card it typed it for.
 *
 * LIMITS come from the card: half the page wide on a desktop, a title in
 * text-2xl over two lines at most, a status badge beside the icon.
 */
import type { PageSpec } from "./types";

export const VENTURE_IDS = [
  "retreat-center",
  "health-wellness",
  "cafe-restaurant",
  "artisan-market",
  "learning-center",
  "fitness-recreation",
  "art-culture",
  "regenerative-agriculture",
] as const;

/**
 * The icons a venture card may carry, by the word a founder types. The page
 * owns the pictures; a word not on this list draws the first one.
 */
export const VENTURE_ICONS = [
  "sparkles",
  "tent",
  "health",
  "cafe",
  "market",
  "learning",
  "fitness",
  "art",
  "farm",
  "home",
  "tools",
  "heart",
] as const;
export type VentureIcon = (typeof VENTURE_ICONS)[number];

/** Most bullet lines a card draws. */
export const VENTURE_DETAIL_LINES = 6;

export const OPPORTUNITIES_PAGE: PageSpec = {
  id: "opportunities",
  label: "Business Opportunities",
  path: "/opportunities",
  sections: [
    {
      id: "hero",
      label: "Top of the page",
      shows: "Under the \"Business Opportunities\" headline.",
      fields: [
        {
          key: "lede",
          label: "Sentence under the headline",
          kind: "long",
          max: 240,
          default:
            "Bring a business to {village}. Here are the ventures the village would like to see, and how a business here grows with the community.",
        },
      ],
    },
    {
      id: "ventures",
      label: "Ventures",
      shows: "The eight venture cards. An investment range written in Make it yours, Money & Value Claims shows on its own card.",
      hideable: true,
      fields: [],
      lists: [
        {
          key: "cards",
          label: "Venture cards",
          help: `One per venture, in this order. Icon is one word from: ${VENTURE_ICONS.join(", ")}.`,
          itemLabel: "Venture",
          titleKey: "title",
          fixed: VENTURE_IDS,
          maxItems: VENTURE_IDS.length,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 40, default: "" },
            {
              key: "status",
              label: "Status badge",
              kind: "text",
              max: 16,
              default: "",
              optional: true,
            },
            { key: "description", label: "Description", kind: "long", max: 200, default: "" },
            {
              key: "details",
              label: `Bullet points, one per line (up to ${VENTURE_DETAIL_LINES})`,
              kind: "long",
              max: 300,
              default: "",
              optional: true,
            },
            { key: "icon", label: "Icon", kind: "text", max: 16, default: "" },
          ],
          default: [
            {
              title: "Retreat Center",
              status: "",
              description: "A place for guests to stay, rest, and learn, with room for workshops and gatherings.",
              details: "Guest rooms\nWorkshop spaces\nShared meals",
              icon: "tent",
            },
            {
              title: "Health & Wellness Center",
              status: "",
              description: "Health and wellbeing services for residents and visitors.",
              details: "Everyday care\nBodywork and therapies\nWellbeing classes",
              icon: "health",
            },
            {
              title: "Café & Restaurant",
              status: "",
              description: "A place to eat and meet, cooking with food from the village and the region around it.",
              details: "Local food\nA gathering space\nEvents",
              icon: "cafe",
            },
            {
              title: "Artisan Market",
              status: "",
              description: "A market for crafts, produce, and goods made by members and their neighbours.",
              details: "Crafts and art\nFresh produce\nEveryday goods",
              icon: "market",
            },
            {
              title: "Learning Center",
              status: "",
              description: "Learning for children and adults, from school days to skill-sharing workshops.",
              details: "Children's learning\nAdult education\nSkill workshops",
              icon: "learning",
            },
            {
              title: "Fitness & Recreation",
              status: "",
              description: "Ways to move and play, indoors and out, for residents and guests.",
              details: "Movement classes\nOutdoor activities\nSport and play",
              icon: "fitness",
            },
            {
              title: "Art & Culture Hub",
              status: "",
              description: "A home for artists, musicians, and the culture of village life.",
              details: "Studios\nPerformance space\nExhibitions",
              icon: "art",
            },
            {
              title: "Regenerative Agriculture",
              status: "",
              description: "Growing food for the community while caring for the soil it grows in.",
              details: "Vegetables\nOrchards\nHerbs",
              icon: "farm",
            },
          ],
        },
      ],
    },
    {
      id: "revenue",
      label: "Revenue sharing",
      shows: "The section under the cards, with a link to How We Create.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 48, default: "Revenue Sharing" },
        {
          key: "body",
          label: "Paragraph under the heading",
          kind: "long",
          max: 480,
          default:
            "Businesses at {village} share part of their revenue with the community, so a business and the village grow together. The share is agreed with each business, by its kind and by what the community puts in.",
        },
      ],
    },
    {
      id: "cta",
      label: "Closing invitation",
      shows: "The last section of the page. Its call button goes to your Events page URL and hides when that is blank.",
      fields: [
        {
          key: "body",
          label: "Sentence under \"Interested in an Opportunity?\"",
          kind: "long",
          max: 200,
          default:
            "Join a community call to learn more about specific opportunities, the application process, and how the economics work.",
        },
      ],
    },
  ],
};
