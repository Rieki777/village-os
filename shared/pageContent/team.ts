/**
 * The Team page (brochure villages), as fields.
 *
 * The defaults are the words the page carried in code until 2026-10-22, moved
 * here unchanged, so switching the page onto this spec changes nothing a
 * visitor sees. Two exceptions, both because the old page said something that
 * was not true for every village:
 *
 *   - the "roles are open" line now shows ONLY while some role has a place
 *     nobody holds (counted from /api/org on the page). It used to print the
 *     same sentence over a village with every role filled;
 *   - the advisory council and the board can be hidden, because a village
 *     that has neither should not have to describe one.
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
        { key: "heading", label: "Heading", kind: "text", max: 32, default: "Leadership Circle" },
        {
          key: "openNote",
          label: "Line under the cards while a role is open",
          help: "Shown only while at least one role has a place nobody holds. Blank shows nothing even then.",
          kind: "long",
          max: 140,
          default: "The team is growing, and several leadership roles and steward roles are open right now.",
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
      shows: "A shaded box under the people.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Community Advisory Council" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 200,
          default: "Practitioners and thought leaders shaping this village's culture, partnerships, and community integration.",
        },
        {
          key: "terms",
          label: "What advisors receive",
          help: "The small line at the bottom of the box. Leave blank for none.",
          kind: "long",
          max: 200,
          default: "Advisors receive First Right of Refusal on lot purchases, retreat discounts, and recognition as Founding Advisors.",
          optional: true,
        },
      ],
      lists: [
        {
          key: "items",
          label: "Who sits on it",
          help: "Up to eight, in two columns.",
          itemLabel: "Line",
          titleKey: "text",
          maxItems: 8,
          fields: [{ key: "text", label: "Line", kind: "text", max: 60, default: "" }],
          default: [
            { text: "Regenerative Agriculture & Permaculture Leaders" },
            { text: "Wellness & Healing Arts Practitioners" },
            { text: "Education & Child Development Experts" },
            { text: "Arts & Culture Leaders" },
            { text: "Local Community Representatives" },
            { text: "Cultural Liaisons from where the village sits" },
          ],
        },
      ],
    },
    {
      id: "board",
      label: "Board",
      shows: "A second shaded box, with up to three columns of short lists.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Development Board of Directors" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 200,
          default:
            "5-7 expert members providing strategic oversight, fiduciary responsibility, and guidance on business, legal, and financial aspects.",
        },
      ],
      lists: [
        {
          key: "columns",
          label: "Columns",
          help: "Up to three, side by side. Each has a heading and up to four lines; a blank line is left out.",
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
          default: [
            { heading: "Expertise Areas", first: "Legal & Regulatory", second: "Real Estate Development", third: "Financial & Investment", fourth: "" },
            { heading: "Responsibilities", first: "Financial Oversight", second: "Development Milestones", third: "Investor Relations", fourth: "" },
            { heading: "Meeting Schedule", first: "Monthly Meetings", second: "Quarterly Sessions", third: "Annual Retreat", fourth: "" },
          ],
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
