/**
 * The Team page (brochure villages), as fields.
 *
 * The defaults are NEUTRAL STARTER TEXT (2026-10-23), true of any village.
 * They were the first village's words until then; that village keeps its own
 * copy in its database, and the record of it is
 * server/seeds/amora/pages/page-team.json. What the page does with them:
 *
 *   - the "roles are open" line shows ONLY while some role has a place nobody
 *     holds (counted from /api/org on the page);
 *   - the advisory council and the board start with NO lines, and the page
 *     draws neither box until the village lists someone or something in it.
 *     A council or a board is a fact about one village, so the platform
 *     claims none; a village that has one writes it in, and one that does not
 *     never sees an empty box.
 *
 * The people themselves are not here: the grid is the village's live roles
 * (/api/org) merged with the Team cards (portrait and bio), as before.
 */
import type { PageSpec } from "./types";

export const TEAM_PAGE: PageSpec = {
  id: "team",
  label: "Team",
  path: "/team",
  sections: [
    {
      id: "header",
      label: "Top of the page",
      shows: "Under the heading \"The {village} Team\".",
      fields: [
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 160,
          default: "The people holding roles here, and the circles they hold them in.",
        },
      ],
    },
    {
      id: "leadership",
      label: "The people",
      shows: "The cards for everyone holding a role. The cards themselves come from your roles and the Team cards.",
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 32, default: "Who Holds the Roles" },
        {
          key: "openNote",
          label: "Line under the cards while a role is open",
          help: "Shown only while at least one role has a place nobody holds. Blank shows nothing even then.",
          kind: "long",
          max: 140,
          default: "Some roles here are open right now.",
          optional: true,
        },
        {
          key: "openLink",
          label: "Link to the open roles",
          help: "Goes to your Roles page. Shown with the line above.",
          kind: "text",
          max: 32,
          default: "See the open roles",
        },
      ],
    },
    {
      id: "advisory",
      label: "Advisory council",
      shows: "A shaded box under the people, drawn once it lists at least one line.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Advisory Council" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 200,
          default: "The people who advise {village} on its culture, its partnerships, and its place in the wider community.",
        },
        {
          key: "terms",
          label: "What advisors receive",
          help: "The small line at the bottom of the box. Leave blank for none.",
          kind: "long",
          max: 200,
          default: "",
          optional: true,
        },
      ],
      lists: [
        {
          key: "items",
          label: "Who sits on it",
          help: "Up to eight, in two columns. With none, the box is not shown.",
          itemLabel: "Line",
          titleKey: "text",
          maxItems: 8,
          fields: [{ key: "text", label: "Line", kind: "text", max: 60, default: "" }],
          default: [],
        },
      ],
    },
    {
      id: "board",
      label: "Board",
      shows: "A second shaded box, with up to three columns of short lists, drawn once it has a column.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Board" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 200,
          default: "The people who oversee {village}'s legal and financial decisions.",
        },
      ],
      lists: [
        {
          key: "columns",
          label: "Columns",
          help: "Up to three, side by side. Each has a heading and up to four lines; a blank line is left out. With none, the box is not shown.",
          itemLabel: "Column",
          titleKey: "heading",
          maxItems: 3,
          fields: [
            { key: "heading", label: "Heading", kind: "text", max: 24, default: "" },
            { key: "first", label: "First line", kind: "text", max: 32, default: "" },
            { key: "second", label: "Second line", kind: "text", max: 32, default: "" },
            { key: "third", label: "Third line", kind: "text", max: 32, default: "" },
            { key: "fourth", label: "Fourth line", kind: "text", max: 32, default: "" },
          ],
          default: [],
        },
      ],
    },
    {
      id: "cta",
      label: "Closing invitation",
      shows: "The last box on the page. The second button goes to your Events page URL and hides when that is blank.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Join Our Community" },
        {
          key: "body",
          label: "Sentence under the heading",
          kind: "long",
          max: 180,
          default: "Whether you're an investor, resident, steward, or prosperity creator, there's a place for you at {village}.",
        },
        { key: "pathLabel", label: "First button (to Choose your path)", kind: "text", max: 28, default: "Find Your Path" },
        { key: "callLabel", label: "Second button (to your Events page)", kind: "text", max: 28, default: "Join Community Call" },
      ],
    },
  ],
};
