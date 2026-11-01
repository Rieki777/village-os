/**
 * The Master Plan page (brochure villages), as fields.
 *
 * The defaults are NEUTRAL STARTER TEXT (2026-10-23), true of any village.
 * They were the first village's words until then; that village keeps its own
 * copy in its database, and the record of it is
 * server/seeds/amora/pages/page-master-plan.json.
 *
 * THE ZONES AND THE PHASES START EMPTY. Each one is a fact about one piece of
 * land (how many home sites, how big a retreat, what is under way), so the
 * platform states none. The page draws no zone cards and no phases section
 * until the village writes some.
 *
 * The PDF button was a disabled "Master Plan PDF, Coming Soon" on every
 * village, including villages with no plan to publish. It is a link the
 * village sets, and it is not drawn until there is one.
 *
 * The land figures (acres, homes, guest rooms, appraisal) stay in Settings;
 * only their labels are here.
 *
 * THE PHASES ARE WORDS, NOT MILESTONES. A village's phases can repeat what
 * Admin, Milestones holds (and Home already shows), and their statuses never
 * change on their own. They stay an editable list for now; reading them from
 * the milestones is a separate change.
 */
import type { PageSpec } from "./types";

export const MASTER_PLAN_PAGE: PageSpec = {
  id: "master-plan",
  label: "Master Plan",
  path: "/master-plan",
  sections: [
    {
      id: "hero",
      label: "Top of the page",
      shows: "Under the heading \"The {village} Master Plan\", over your master plan picture.",
      fields: [
        {
          key: "subline",
          label: "Sentence under the heading",
          kind: "long",
          max: 200,
          default: "How {village} plans to grow: where people will live, work, and gather, and how the land is cared for.",
        },
      ],
    },
    {
      id: "stats",
      label: "Land figures",
      shows: "The row of figures under the top of the page. The figures come from Settings; a figure left blank there hides its tile.",
      fields: [
        { key: "plannedHomesLabel", label: "Label under planned homes", kind: "text", max: 20, default: "Planned Homes" },
        { key: "guestRoomsLabel", label: "Label under guest rooms", kind: "text", max: 20, default: "Guest Rooms" },
        { key: "appraisalLabel", label: "Label under the appraisal", kind: "text", max: 20, default: "Appraised Value" },
      ],
    },
    {
      id: "vision",
      label: "Vision and zones",
      shows: "The paragraph and the cards describing each part of the land.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 32, default: "Our Vision" },
        {
          key: "body",
          label: "Paragraph under the heading",
          kind: "long",
          max: 400,
          default:
            "{village} is planned as a whole village: a place to live, work, learn, and gather. The plan sets out what will be built, what will be protected, and how the parts fit together.",
        },
      ],
      lists: [
        {
          key: "zones",
          label: "Zones",
          help: "Up to eight cards, top to bottom. Each gets the next icon in a fixed set. With none, only the paragraph shows.",
          itemLabel: "Zone",
          titleKey: "title",
          maxItems: 8,
          fields: [
            { key: "title", label: "Name", kind: "text", max: 32, default: "" },
            { key: "description", label: "Description", kind: "long", max: 160, default: "" },
            {
              key: "tags",
              label: "Tags",
              help: "Short labels separated by commas, shown as pills. Up to six.",
              kind: "text",
              max: 150,
              default: "",
            },
          ],
          default: [],
        },
      ],
    },
    {
      id: "valuation",
      label: "Land valuation",
      shows: "The shaded section with your appraisal from Settings.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 32, default: "Land Valuation" },
        {
          key: "support",
          label: "Sentence after the appraisal",
          help: "Shown only when Settings has an appraisal. Leave blank for none.",
          kind: "long",
          max: 200,
          default: "",
          optional: true,
        },
        {
          key: "pdfUrl",
          label: "Master plan document link",
          help: "Where the button goes: a web address, or a page on this site. Investor vault files cannot be linked from a public page. Leave blank and no button is shown.",
          kind: "link",
          max: 500,
          default: "",
          optional: true,
        },
        { key: "pdfLabel", label: "Button label", kind: "text", max: 32, default: "Master Plan PDF" },
      ],
    },
    {
      id: "phases",
      label: "Development phases",
      shows: "The list of phases with a status pill on each, drawn once there is at least one phase.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 32, default: "Development Phases" },
        {
          key: "intro",
          label: "Sentence under the heading",
          help: "Leave blank for none.",
          kind: "long",
          max: 200,
          default: "",
          optional: true,
        },
      ],
      lists: [
        {
          key: "phases",
          label: "Phases",
          help: "Up to ten, top to bottom. A status of In Progress or Planning gets its own colour. With none, the section is not shown.",
          itemLabel: "Phase",
          titleKey: "phase",
          maxItems: 10,
          fields: [
            { key: "phase", label: "Name", kind: "text", max: 32, default: "" },
            { key: "items", label: "What it holds", kind: "text", max: 60, default: "" },
            { key: "status", label: "Status", kind: "text", max: 16, default: "" },
          ],
          default: [],
        },
      ],
    },
    {
      id: "cta",
      label: "Closing invitation",
      shows: "The last section of the page. The first button goes to your Events page URL and hides when that is blank.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Be Part of the Vision" },
        {
          key: "body",
          label: "Sentence under the heading",
          kind: "long",
          max: 180,
          default: "Whether you want to invest, live, work, or create at {village}, there's a place for you in our master plan.",
        },
        { key: "callLabel", label: "First button (to your Events page)", kind: "text", max: 28, default: "Join Community Call" },
        { key: "pathLabel", label: "Second button (to the homepage)", kind: "text", max: 28, default: "Choose Your Path" },
      ],
    },
  ],
};

/** A zone's tags as the page draws them: comma-separated, trimmed, blanks dropped, at most six. */
export function zoneTags(tags: string): string[] {
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);
}
