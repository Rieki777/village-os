/**
 * The Master Plan page (brochure villages), as fields.
 *
 * The defaults are the words the page carried in code until 2026-10-22, moved
 * here unchanged, so switching the page onto this spec changes nothing a
 * visitor sees, with one exception: the PDF button. It was a disabled
 * "Master Plan PDF, Coming Soon" on every village, including villages with no
 * plan to publish. It is now a link the village sets, and it is not drawn
 * until there is one.
 *
 * The land figures (acres, homes, guest rooms, appraisal) stay in Settings;
 * only their labels are here.
 *
 * THE PHASES ARE WORDS, NOT MILESTONES. The six phases repeat what Admin,
 * Milestones holds (and Home already shows), and their statuses never change
 * on their own. They stay an editable list with today's words for now;
 * reading them from the milestones is a separate change.
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
          default: "Our vision for a regenerative village that harmonizes human habitation with the natural beauty of the land it sits on.",
        },
      ],
    },
    {
      id: "stats",
      label: "Land figures",
      shows: "The row of figures under the top of the page. The figures come from Settings; a figure left blank there hides its tile.",
      fields: [
        { key: "plannedHomesLabel", label: "Label under planned homes", kind: "text", max: 20, default: "Planned Homes" },
        { key: "guestRoomsLabel", label: "Label under guest rooms", kind: "text", max: 20, default: "Retreat Keys" },
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
            "{village} is designed as a complete village ecosystem, a place where people live, work, learn, and thrive together. Our master plan balances development with conservation, ensuring that the land regenerates even as we build upon it.",
        },
      ],
      lists: [
        {
          key: "zones",
          label: "Zones",
          help: "Up to eight cards, top to bottom. Each gets the next icon in a fixed set.",
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
          default: [
            {
              title: "Village Center",
              description: "The heart of {village} featuring the community center, café, market, and gathering spaces.",
              tags: "Community Center, Café & Restaurant, Artisan Market, Event Spaces",
            },
            {
              title: "Residential Neighborhoods",
              description: "Clustered housing areas designed for community connection while maintaining privacy.",
              tags: "150+ home sites, Various lot sizes, Walking paths, Community gardens",
            },
            {
              title: "Retreat & Wellness",
              description: "The retreat center and health facilities serving guests and residents.",
              tags: "120-150 key retreat, Health Center, Spa facilities, Workshop spaces",
            },
            {
              title: "Agricultural Land",
              description: "Regenerative farms and food forests providing sustenance for the community.",
              tags: "Organic gardens, Food forest, Medicinal herbs, Livestock areas",
            },
            {
              title: "Commons & Conservation",
              description: "Protected natural areas, trails, and shared spaces for all to enjoy.",
              tags: "Nature preserves, Hiking trails, Water features, Wildlife corridors",
            },
          ],
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
          default: "This valuation supports the financing strategy and shows the asset base underneath the village.",
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
      shows: "The list of phases with a status pill on each.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 32, default: "Development Phases" },
        {
          key: "intro",
          label: "Sentence under the heading",
          help: "Leave blank for none.",
          kind: "long",
          max: 200,
          default:
            "With a potential 1% regenerative development loan, multiple phases can proceed simultaneously, accelerating our timeline significantly.",
          optional: true,
        },
      ],
      lists: [
        {
          key: "phases",
          label: "Phases",
          help: "Up to ten, top to bottom. A status of In Progress or Planning gets its own colour.",
          itemLabel: "Phase",
          titleKey: "phase",
          maxItems: 10,
          fields: [
            { key: "phase", label: "Name", kind: "text", max: 32, default: "" },
            { key: "items", label: "What it holds", kind: "text", max: 60, default: "" },
            { key: "status", label: "Status", kind: "text", max: 16, default: "" },
          ],
          default: [
            { phase: "Infrastructure", items: "Roads, utilities, water systems", status: "In Progress" },
            { phase: "Community Center", items: "Café, gathering spaces, offices", status: "Planning" },
            { phase: "Show Homes", items: "10 homes of various styles", status: "Planning" },
            { phase: "Retreat Center", items: "120-150 key wellness facility", status: "Planning" },
            { phase: "Health Center", items: "Integrative health services", status: "Planning" },
            { phase: "Residential Phase 1", items: "First 50 home sites", status: "Future" },
          ],
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
