/**
 * The business opportunities page (/opportunities), as fields.
 *
 * The defaults are the words the page carried in code until 2026-10-22, moved
 * here unchanged, except the three lines that said what the recognition token
 * does. Those follow Rye's token ruling of 2026-10-22 (TOKEN_COPY_PROPOSAL
 * rows 31 to 33): a token may be named, and no sentence says what it does.
 * A revenue share "paid in" the recognition token was also the wrong token.
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
            "Join our thriving village economy. These opportunities align business success with community prosperity through shared revenue.",
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
              status: "Planning",
              description:
                "A 120-150 key wellness retreat facility offering transformational experiences, workshops, and healing programs.",
              details: "120-150 guest rooms\nMultiple workshop spaces\nSpa and wellness facilities\nFarm-to-table restaurant",
              icon: "tent",
            },
            {
              title: "Health & Wellness Center",
              status: "Planning",
              description:
                "Integrative health services combining traditional and alternative medicine for residents and visitors.",
              details: "Primary care services\nAlternative therapies\nMental health support\nPreventive wellness programs",
              icon: "health",
            },
            {
              title: "Café & Restaurant",
              status: "Planning",
              description: "Farm-to-table dining experience showcasing local and organic produce from our regenerative farms.",
              details: "Organic menu\nCommunity gathering space\nEvent hosting\nCoffee roasting",
              icon: "cafe",
            },
            {
              title: "Artisan Market",
              status: "Future",
              description:
                "A marketplace for local crafts, produce, and goods created by community members and regional artisans.",
              details: "Local crafts and art\nFresh produce\nCommunity goods\nVisitor souvenirs",
              icon: "market",
            },
            {
              title: "Learning Center",
              status: "Future",
              description:
                "Educational programs for children and adults, including a forest school and skill-sharing workshops.",
              details: "Forest school\nAdult education\nSkill workshops\nResearch programs",
              icon: "learning",
            },
            {
              title: "Fitness & Recreation",
              status: "Future",
              description: "Fitness facilities and outdoor recreation programs for residents and retreat guests.",
              details: "Yoga studio\nFitness equipment\nHiking programs\nWater activities",
              icon: "fitness",
            },
            {
              title: "Art & Culture Hub",
              status: "Future",
              description: "A creative space for artists, musicians, and cultural programs that enrich community life.",
              details: "Artist studios\nPerformance space\nGallery\nMusic programs",
              icon: "art",
            },
            {
              title: "Regenerative Agriculture",
              status: "Active",
              description: "Farming operations that produce food for the community while regenerating the land.",
              details: "Organic vegetables\nFruit orchards\nMedicinal herbs\nPermaculture design",
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
            "All businesses at {village} share a percentage of revenue with the community. This creates alignment between business success and community prosperity. The exact percentage is negotiated based on the business type and community investment.",
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
