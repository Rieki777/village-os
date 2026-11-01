/**
 * The housing page (/housing), as fields.
 *
 * The defaults are NEUTRAL STARTER TEXT (2026-10-23), true of any village.
 * They were the first village's words until then; that village keeps its own
 * copy in its database, and the record of it is
 * server/seeds/amora/pages/page-housing.json. A village replaces them in
 * Admin, Pages, Housing.
 *
 * THE LAND FEATURES START EMPTY. Views, springs, forest and sun are facts
 * about one piece of land, and the page draws no features band until the
 * village lists its own.
 *
 * NOT HERE: the homes themselves. Those are the village's own table (0131,
 * `housing_home_types`, written in Admin, Housing) and the page keeps reading
 * them there, whole section or nothing.
 *
 * LIMITS were set from the layout: four features to a row on a wide screen
 * (a title on one line at about 28 characters), three tenure cards to a row,
 * and paragraphs that stay under five lines in their column.
 */
import type { PageSpec } from "./types";

/**
 * The icons a land feature may carry, by the word a founder types. The page
 * owns the pictures; a word not on this list draws the first one, so a typo
 * shows a plain icon instead of a hole.
 */
export const HOUSING_FEATURE_ICONS = [
  "mountain",
  "water",
  "forest",
  "sun",
  "leaf",
  "sprout",
  "wind",
  "home",
  "pin",
  "heart",
] as const;
export type HousingFeatureIcon = (typeof HOUSING_FEATURE_ICONS)[number];

/**
 * The three tenure cards. Fixed, because "transferable" carries the transfer
 * note from Admin, Legal while its description is left as the platform wrote
 * it.
 */
export const HOUSING_TENURE_IDS = ["renewable", "transferable", "community"] as const;

/** The transferable card's default body, which the page swaps for the Legal transfer note when there is one. */
export const HOUSING_TRANSFER_DEFAULT =
  "Pass your land share to your children, keeping it in the family. Ask a steward about this village's specific transfer and tax terms.";

export const HOUSING_PAGE: PageSpec = {
  id: "housing",
  label: "Housing",
  path: "/housing",
  sections: [
    {
      id: "hero",
      label: "Top of the page",
      shows: "Under the \"Housing at\" headline, on the coloured band.",
      fields: [
        {
          key: "lede",
          label: "Sentence under the headline",
          kind: "long",
          max: 240,
          default:
            "Find your place here. Homes sit on land the community holds together, and a Land Share Agreement is how you take one.",
        },
      ],
    },
    {
      id: "features",
      label: "The land",
      shows: "The row of short features under the top of the page.",
      hideable: true,
      fields: [],
      lists: [
        {
          key: "items",
          label: "Features",
          help: `Up to eight, four to a row on a wide screen. Icon is one word from: ${HOUSING_FEATURE_ICONS.join(", ")}. With none, the row is not shown.`,
          itemLabel: "Feature",
          titleKey: "title",
          maxItems: 8,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 28, default: "" },
            { key: "body", label: "Description", kind: "long", max: 120, default: "" },
            { key: "icon", label: "Icon", kind: "text", max: 16, default: "" },
          ],
          default: [],
        },
      ],
    },
    {
      id: "tenure",
      label: "How a home is held",
      shows: "The section explaining your land agreement, with three cards and a button to the resident journey.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Land Share Agreements" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 280,
          default:
            "A Land Share Agreement gives you long-term access to your home at {village}. Here is how it works:",
        },
      ],
      lists: [
        {
          key: "points",
          label: "Cards",
          help: "Three, side by side. While the Transferable card keeps the platform's description, it shows the transfer note from Admin, Legal when you have written one.",
          itemLabel: "Card",
          titleKey: "title",
          fixed: HOUSING_TENURE_IDS,
          maxItems: 3,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 24, default: "" },
            { key: "body", label: "Description", kind: "long", max: 160, default: "" },
          ],
          default: [
            {
              title: "Renewable",
              body: "Your agreement can be renewed, providing long-term security for your family.",
            },
            { title: "Transferable", body: HOUSING_TRANSFER_DEFAULT },
            {
              title: "Community Owned",
              body: "The land remains in community ownership, ensuring our values are preserved.",
            },
          ],
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
          label: "Sentence under \"Interested in Housing?\"",
          kind: "long",
          max: 200,
          default: "Join a community call to learn about the homes, what they cost, and how to become a resident.",
        },
      ],
    },
  ],
};
