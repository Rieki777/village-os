/**
 * Words that belong to the whole site rather than one page: what a shared link
 * shows, and the sign-off in the footer.
 *
 * WHY THE SHARE CARD LIVES HERE. Every link to this village unfurled as
 * "Village" with no picture, because client/index.html is one static file
 * served to every deployment and only /quests was rewritten on the server. The
 * server now splices these into every page it serves (server/lib/pageMeta.ts),
 * which is the only version a link preview ever reads: crawlers run no
 * JavaScript.
 */
import type { PageSpec } from "./types";
import { BROCHURE_PATHS } from "../brochure";

/** The footer sign-off a village gets until it writes its own. */
export const SITE_FOOTER_SIGNOFF = "Built with care by";

export const SITE_PAGE: PageSpec = {
  id: "site",
  label: "Whole site",
  path: "/",
  sections: [
    {
      id: "share",
      label: "When someone shares a link",
      shows: "The card a chat app or social site draws for a link to any page here.",
      fields: [
        {
          key: "description",
          label: "One sentence about the village",
          help: "Leave blank to use your Tagline. Search engines show about 155 characters.",
          kind: "long",
          max: 160,
          default: "",
          optional: true,
        },
        {
          key: "image",
          label: "Picture address",
          help: "The address of a picture you uploaded, ideally 1200 by 630. Leave blank to use your homepage picture.",
          kind: "link",
          max: 500,
          default: "",
          optional: true,
        },
      ],
    },
    {
      id: "menu",
      label: "Names in the menu",
      shows: "What the menu calls each of your story pages. The footer uses a name once you change it here.",
      fields: [],
      lists: [
        {
          key: "pages",
          label: "Pages",
          help: "One row per story page, in the order the menu shows them.",
          itemLabel: "Page",
          titleKey: "label",
          fixed: BROCHURE_PATHS,
          maxItems: BROCHURE_PATHS.length,
          fields: [
            { key: "label", label: "Name in the menu", kind: "text", max: 24, default: "" },
            {
              key: "subtitle",
              label: "Second line (journey pages only)",
              kind: "text",
              max: 28,
              default: "",
              optional: true,
            },
          ],
          // In BROCHURE_PATHS order. A test holds these to client/src/config/nav.ts.
          default: [
            { label: "Investor", subtitle: "Capital Contributor" },
            { label: "Village Steward", subtitle: "Co-Creator" },
            { label: "Resident", subtitle: "Co-Creator" },
            { label: "Prosperity Creator", subtitle: "Business Builder" },
            { label: "Sign the {commitment}", subtitle: "" },
            { label: "Plan a Visit", subtitle: "" },
            { label: "Work With Us", subtitle: "" },
            { label: "Business Opportunities", subtitle: "" },
            { label: "Housing", subtitle: "" },
            { label: "Master Plan", subtitle: "" },
            { label: "Our Team", subtitle: "" },
            { label: "How We Create", subtitle: "" },
            { label: "Good Neighbor", subtitle: "" },
            { label: "Co-Creators Guide", subtitle: "" },
            { label: "Resident Rights", subtitle: "" },
            { label: "Steward Rights", subtitle: "" },
            { label: "Command Centre", subtitle: "" },
          ],
        },
      ],
    },
    {
      id: "footer",
      label: "Footer",
      shows: "The bottom line of every page, before the platform's name.",
      fields: [
        {
          key: "signoff",
          label: "Words before the platform's name",
          help: "Shown just before the platform's name at the very bottom of every page. Leave blank to show the platform's name alone.",
          kind: "text",
          max: 40,
          default: SITE_FOOTER_SIGNOFF,
          optional: true,
        },
      ],
    },
  ],
};
