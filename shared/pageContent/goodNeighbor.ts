/**
 * The Good Neighbor page (/good-neighbor), as fields: the village's admission
 * covenant, every word of it the village's own.
 *
 * THE DEFAULTS ARE NEUTRAL STARTER TEXT (2026-10-23). They were the founding
 * village's own covenant: its communication training, its background check,
 * its children's day, its local-leadership target, its land lease terms and
 * an epigraph from a named person. The founding village now holds its own
 * copy (its record is in server/seeds/), so these defaults keep only what
 * any village could sign up to, and leave the practices a village may or may
 * not adopt for it to write. Two things carry over on purpose:
 *   - the closing button says "Sign the {commitment}";
 *   - every place the page names the criteria writes `{good-neighbor}`, which
 *     is the headline field below, so renaming the criteria renames them
 *     everywhere at once (see goodNeighborName.ts).
 * No sentence restates that work is paid (Rye, 2026-10-23): the quest and
 * role cards say it.
 *
 * The criteria, dealbreakers, steps and commitments are FREE lists: a village
 * writes as many as it has. A criterion's practices and a dealbreaker group's
 * items are five numbered boxes each, because a page field cannot hold a list
 * inside a list row. A blank box is not drawn.
 *
 * LIMITS start from the audit (cust-audit/pages-D-guides-rights.md) and were
 * checked by screenshot at 1280, 390 and 320 wide with every box full.
 */
import type { FieldSpec, PageSpec } from "./types";
import { GOOD_NEIGHBOR_NAME_DEFAULT, GOOD_NEIGHBOR_PAGE_ID } from "./goodNeighborName";

const NAME_HELP = "{good-neighbor} is the name in the headline box at the top of this page.";

const numbered = (prefix: string, label: string, count: number, max: number): FieldSpec[] =>
  Array.from({ length: count }, (_, i) => ({
    key: `${prefix}${i + 1}`,
    label: `${label} ${i + 1}`,
    kind: "text" as const,
    max,
    default: "",
    optional: true,
  }));

export const GOOD_NEIGHBOR_PAGE: PageSpec = {
  id: GOOD_NEIGHBOR_PAGE_ID,
  label: "Good Neighbor",
  path: "/good-neighbor",
  sections: [
    {
      id: "hero",
      label: "Top of the page",
      shows: "The headline and the words under it.",
      fields: [
        { key: "eyebrow", label: "Small label above the headline", kind: "text", max: 30, default: "How We Live Together", optional: true },
        {
          key: "name",
          label: "Headline: what you call these criteria",
          help: "Also the name the Co-Creators Guide and the rest of this page use for them, wherever they write {good-neighbor}.",
          kind: "text",
          max: 40,
          default: GOOD_NEIGHBOR_NAME_DEFAULT,
        },
        {
          key: "intro",
          label: "Paragraph under the headline",
          kind: "long",
          max: 240,
          default:
            "What {village} asks of everyone who lives here, and what the village promises in return. Read it before you commit, and ask about anything that is unclear.",
        },
        {
          key: "quote",
          label: "Quotation",
          help: "Shown in italics, inside quotation marks. Leave blank for none.",
          kind: "long",
          max: 140,
          default: "",
          optional: true,
        },
        { key: "quoteBy", label: "Who said it", kind: "text", max: 40, default: "", optional: true },
      ],
    },
    {
      id: "values",
      label: "What the village values",
      shows: "A row of short cards under the top of the page.",
      hideable: true,
      fields: [{ key: "heading", label: "Heading", kind: "text", max: 60, default: "What {village} Values" }],
      lists: [
        {
          key: "items",
          label: "Values",
          help: "Up to three, side by side on a wide screen.",
          itemLabel: "Value",
          titleKey: "title",
          maxItems: 3,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 30, default: "" },
            { key: "body", label: "Description", kind: "long", max: 220, default: "" },
          ],
          default: [
            {
              title: "Care for Each Other",
              body: "Neighbors look out for one another. One person's wellbeing touches everyone's, so we show up for ourselves and for the whole.",
            },
            {
              title: "Care for the Land",
              body: "The land and water we share hold us up. We tend them so they are healthier for the people who come after us.",
            },
            {
              title: "Shared Responsibility",
              body: "Everyone here carries part of the work and part of the decisions. That is how a village runs itself.",
            },
          ],
        },
      ],
    },
    {
      id: "criteria",
      label: "The criteria",
      shows: "The numbered cards, one per criterion. Each gets the next icon and colour in a fixed set.",
      fields: [
        { key: "heading", label: "Heading", help: NAME_HELP, kind: "text", max: 50, default: "The {good-neighbor}" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 200,
          default: "These describe how we show up for each other, and what makes life at {village} work.",
        },
      ],
      lists: [
        {
          key: "items",
          label: "Criteria",
          help: "Numbered in the order shown. Practices are ticked lines; a blank one is not drawn.",
          itemLabel: "Criterion",
          titleKey: "title",
          minItems: 1,
          maxItems: 10,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 45, default: "" },
            { key: "subtitle", label: "Second line", kind: "text", max: 35, default: "" },
            { key: "description", label: "Description", kind: "long", max: 260, default: "" },
            ...numbered("practice", "Practice", 5, 140),
            { key: "note", label: "Note under the practices", help: "Shown in a shaded box. Leave blank for none.", kind: "long", max: 200, default: "", optional: true },
          ],
          default: [
            {
              title: "Shared Values",
              subtitle: "You Share What Matters Here",
              description:
                "You understand what {village} is for and you want to help build it. You have read the {commitment} and you agree with its spirit.",
              practice1: "You come to gatherings and take part in village life.",
              practice2: "You ask how things work here: how decisions are made, how work is shared, how money is handled.",
              practice3: "You accept that shared life sometimes asks for conversations you would prefer to skip, and you have them with care.",
            },
            {
              title: "Honest Communication",
              subtitle: "You Speak Directly and Kindly",
              description:
                "You are willing to talk through disagreement openly. You see conflict as something to work through together.",
              practice1: "When something bothers you, you raise it directly, early and kindly.",
              practice2: "You listen to understand before you answer.",
              practice3: "You are willing to apologize, make repair, and change.",
              note: "What does not fit here: a pattern of avoiding conflict through blame, manipulation or withdrawal.",
            },
            {
              title: "Financial Responsibility",
              subtitle: "You Can Meet Your Commitments",
              description:
                "You can sustain your commitment to {village}. You are honest about your resources and realistic about what you can afford.",
              practice1: "You know what living here costs, housing and village dues included, before you commit.",
              practice2: "You have a clear way to cover those costs.",
              practice3: "If your circumstances change, you tell the village early.",
              note: "What matters is honesty about what you can sustain.",
            },
            {
              title: "Contribution to Village Life",
              subtitle: "You Show Up and Take Part",
              description: "You give your time, energy or skills to the life of the village, in the way that fits your gifts.",
              practice1: "You look for where your gifts meet what {village} needs.",
              practice2: "You propose contributions and take on quests and roles.",
              practice3: "You join the circles that fit your interests and gifts.",
              note: "Everyone has seasons of more and less capacity. What matters is steady engagement and honesty about what you can give.",
            },
            {
              title: "Respect for the Land",
              subtitle: "You Care for Shared Places",
              description:
                "You treat the land, the water and the shared spaces as yours to look after, alongside everyone else who lives here.",
              practice1: "You use water, energy and materials with care.",
              practice2: "You take part in caring for the land, or support those who do.",
              practice3: "You treat shared spaces as your own responsibility.",
            },
            {
              title: "Openness and Respect",
              subtitle: "You Value Different Ways of Being",
              description:
                "You welcome people of different cultures, ages, backgrounds and views, and you are open to learning from them.",
              practice1: "You treat neighbors, guests and the wider community with respect.",
              practice2: "You make room for every age, from children to elders.",
            },
          ],
        },
      ],
    },
    {
      id: "dealbreakers",
      label: "Dealbreakers",
      shows: "The shaded section of grouped lines after the criteria.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Clear Dealbreakers" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 160,
          default: "Some behaviors cannot be part of life at {village}, and it is kinder to say so up front.",
        },
      ],
      lists: [
        {
          key: "groups",
          label: "Groups",
          help: "Two side by side on a wide screen. A blank line is not drawn.",
          itemLabel: "Group",
          titleKey: "category",
          maxItems: 6,
          fields: [{ key: "category", label: "Group name", kind: "text", max: 40, default: "" }, ...numbered("item", "Line", 5, 150)],
          default: [
            {
              category: "Harm or Abuse",
              item1: "A history of violence or serious harm to others, without real accountability and repair",
              item2: "Current patterns of manipulation, coercion or abuse",
              item3: "Refusing to take responsibility for harm done",
            },
            {
              category: "Taking Without Giving",
              item1: "Treating the community only as a resource to use",
              item2: "Refusing to contribute or to take part in shared decisions",
              item3: "Repeated dishonesty or fraud",
            },
            {
              category: "Disrespect",
              item1: "Hostility toward people because of who they are",
              item2: "Disregard for the land and the shared spaces",
            },
            {
              category: "Working Against Shared Decisions",
              item1: "Insisting on control over decisions that belong to the group",
              item2: "Refusing to take part in resolving conflict",
              item3: "Ignoring what the village has agreed",
            },
          ],
        },
      ],
    },
    {
      id: "process",
      label: "How fit is assessed",
      shows: "The numbered steps from first visit to welcome.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 50, default: "How Joining Works" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 140,
          default: "These criteria start a conversation. Here is how {village} and a newcomer get to know each other:",
        },
      ],
      lists: [
        {
          key: "steps",
          label: "Steps",
          help: "Numbered in the order shown.",
          itemLabel: "Step",
          titleKey: "title",
          maxItems: 10,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 30, default: "" },
            { key: "body", label: "Description", kind: "long", max: 200, default: "" },
          ],
          default: [
            { title: "First Visit", body: "You learn about {village} through its pages, its events and its people, and you ask your questions." },
            { title: "Getting to Know Each Other", body: "You come to gatherings and meet the people who live here. They get to know you too." },
            { title: "An Honest Conversation", body: "You talk openly with people from the village about your values, your hopes and your concerns." },
            {
              title: "Agreement",
              body: "When you and the village are both ready, the village decides in the way it has chosen, and you sign the {commitment}.",
            },
            { title: "Celebration", body: "We celebrate your arrival with the whole village. Welcome home." },
          ],
        },
      ],
    },
    {
      id: "commitments",
      label: "What the village commits to",
      shows: "The ticked tiles saying what the village promises in return.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 50, default: "What {village} Commits to You" },
        {
          key: "intro",
          label: "Sentence under the heading",
          help: NAME_HELP,
          kind: "long",
          max: 140,
          default: "This goes both ways. If you commit to the {good-neighbor}, {village} commits to you:",
        },
      ],
      lists: [
        {
          key: "items",
          label: "Commitments",
          help: "Two side by side on a wide screen.",
          itemLabel: "Commitment",
          titleKey: "text",
          maxItems: 12,
          fields: [{ key: "text", label: "Commitment", kind: "text", max: 100, default: "" }],
          default: [
            { text: "A supportive community that looks out for you" },
            { text: "Open, transparent decision-making" },
            { text: "A voice in the decisions that affect you" },
            { text: "Clear agreements about your home and what it costs" },
            { text: "Support for your growth and learning" },
            { text: "Celebrating what you bring" },
            { text: "Care and commitment when conflict comes up" },
            { text: "Care for the land, for the generations to come" },
          ],
        },
      ],
    },
    {
      id: "closing",
      label: "A final word",
      shows: "The last section, with its buttons. The second button goes to your Events page URL and hides when that is blank.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "A Final Word" },
        {
          key: "body",
          label: "First paragraph",
          help: NAME_HELP,
          kind: "long",
          max: 260,
          default:
            "The {good-neighbor} exist because good neighbors make a good village. They help everyone here know what to expect of each other.",
        },
        {
          key: "body2",
          label: "Second paragraph",
          kind: "long",
          max: 200,
          default: "If this sounds like the way you want to live, we would love to meet you.",
          optional: true,
        },
        {
          key: "commitLabel",
          label: "First button",
          help: "Opens the page where a member signs. {commitment} is what a member signs, from Identity.",
          kind: "text",
          max: 32,
          default: "Sign the {commitment}",
        },
        { key: "eventsLabel", label: "Second button", help: "Leave blank for one button.", kind: "text", max: 28, default: "See Upcoming Events", optional: true },
      ],
    },
  ],
};
