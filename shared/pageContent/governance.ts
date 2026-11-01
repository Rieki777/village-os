/**
 * How We Govern (/governance), as fields.
 *
 * Every village has this page: it is a door on the welcome page of a new
 * village, brochure pages on or off. Until 2026-10-23 it was one village's
 * JSX, so every new village described a sociocracy, five named circles, a
 * practice of nonviolent communication and a Hypha space it might not have.
 *
 * THE DEFAULTS ARE A NEUTRAL STARTER, true of any village on this platform.
 * They say nothing a village has to have chosen: no governance method, no
 * practice for conflict, no count of circles, no circle names (the circle
 * cards start empty and /circles shows the real ones). They describe what the
 * platform itself does: anyone may propose, a decision is recorded, a steward
 * may stop a passed change within the village's window, and the settings that
 * govern stewards are the one thing no steward may veto. A village writes its
 * own way of deciding over them in Admin, Pages, How We Govern.
 *
 * The words the page carried in code until 2026-10-23 were the first
 * village's own; that village saved them as its copy before these landed.
 *
 * Two facts come from settings and never from typed words:
 *   - the steward's veto window is `{veto}`, from Admin, Variables
 *     (`governance.veto_hours`). The page said "three days" whatever the
 *     village had set, and 72 hours is only the floor. `{veto}` is filled by
 *     the page itself (`vetoWindowWords` below), not by shared vars;
 *   - the Hypha section draws only while the village's Hypha DHO link is set
 *     (Admin, Variables, `hypha.org_url`) as well as switched on here.
 *
 * Every section after the top can be hidden. The decision band of live votes
 * is not a field: it is the village's real ballots.
 */
import type { PageSpec } from "./types";

/** The variable the veto window is read from. */
export const VETO_HOURS_KEY = "governance.veto_hours";

/**
 * The window's floor, in hours. `VETO_HOURS_FLOOR` in shared/governanceKinds.ts
 * is the authority; it is repeated here so the public page does not carry the
 * cycle clock in its bundle, and governance.test.ts holds the two equal.
 */
export const VETO_HOURS_MIN = 72;

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/**
 * How long a steward has, in the words a member reads: 72 is "three days",
 * 100 is "100 hours". Anything unreadable or under the floor reads as the
 * floor, which is what the engine enforces (`vetoHoursFrom`).
 */
export function vetoWindowWords(hours: unknown): string {
  const n = Number(hours);
  const h = Number.isFinite(n) ? Math.max(VETO_HOURS_MIN, Math.floor(n)) : VETO_HOURS_MIN;
  if (h % 24 !== 0) return `${h} hours`;
  const days = h / 24;
  return `${COUNT_WORDS[days] ?? String(days)} days`;
}

export const GOVERNANCE_PAGE: PageSpec = {
  id: "governance",
  label: "How We Govern",
  path: "/governance",
  sections: [
    {
      id: "hero",
      label: "Top of the page",
      shows: "The coloured band at the top of the page, above the village's open votes.",
      fields: [
        { key: "eyebrow", label: "Small label above the headline", kind: "text", max: 32, default: "How We Govern" },
        { key: "headline", label: "Headline", kind: "text", max: 48, default: "How {village} Decides" },
        {
          key: "intro",
          label: "Paragraph under the headline",
          help: "Wrap words in **double stars** to make them bold.",
          kind: "long",
          max: 280,
          default:
            "Here is how a proposal becomes a decision in {village}, who can stop one, and how the village changes its own rules. Every member can take part.",
        },
      ],
    },
    {
      id: "principles",
      label: "Principles",
      shows: "The row of cards under the open votes. Each gets the next icon in a fixed set.",
      hideable: true,
      fields: [{ key: "heading", label: "Heading", kind: "text", max: 40, default: "What Guides Us" }],
      lists: [
        {
          key: "items",
          label: "Principles",
          help: "Three side by side on a wide screen.",
          itemLabel: "Principle",
          titleKey: "title",
          maxItems: 6,
          fields: [
            { key: "title", label: "Title", kind: "text", max: 32, default: "" },
            { key: "body", label: "Paragraph", kind: "long", max: 200, default: "" },
          ],
          default: [
            {
              title: "Anyone can propose",
              body: "Any member can bring an idea to the village as a proposal. Who decides it depends on what it would change.",
            },
            {
              title: "Decided in the open",
              body: "Proposals, votes and their results are recorded where members can read them.",
            },
            {
              title: "Open to change",
              body: "The way {village} decides can change too, through the same steps as any other decision.",
            },
          ],
        },
      ],
    },
    {
      id: "decision",
      label: "How a decision gets made",
      shows: "The numbered steps under the principles. Each gets the next icon in a fixed set.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "How a Decision Gets Made" },
        { key: "intro", label: "Sentence under the heading", kind: "text", max: 100, default: "Most decisions follow the same path.", optional: true },
      ],
      lists: [
        {
          key: "steps",
          label: "Steps",
          help: "Read top to bottom, numbered for you.",
          itemLabel: "Step",
          titleKey: "text",
          maxItems: 8,
          fields: [{ key: "text", label: "Step", kind: "text", max: 100, default: "" }],
          default: [
            { text: "Someone notices something that could be better." },
            { text: "They write it up as a proposal." },
            { text: "The people it affects talk it through and suggest changes." },
            { text: "The village decides, in the way it agreed for that kind of decision." },
            { text: "The decision is recorded for every member to read." },
          ],
        },
      ],
    },
    {
      id: "circles",
      label: "Circles and their domains",
      shows: "Cards describing your circles, with a link to the circles page. The circles page itself always shows your real circles.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Our Circles" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 180,
          default: "Each circle looks after one part of the village's work. The circles page shows every one of them, with its roles.",
          optional: true,
        },
        { key: "linkLabel", label: "Link to the circles page", kind: "text", max: 32, default: "See every circle" },
      ],
      lists: [
        {
          key: "items",
          label: "Circle cards",
          help: "Two side by side on a wide screen. Empty, as it starts, draws no cards.",
          itemLabel: "Circle",
          titleKey: "name",
          maxItems: 8,
          fields: [
            { key: "name", label: "Name", kind: "text", max: 32, default: "" },
            { key: "body", label: "What it looks after", kind: "long", max: 180, default: "" },
          ],
          default: [],
        },
      ],
    },
    {
      id: "conflict",
      label: "Conflict resolution",
      shows: "Up to three paragraphs on how tension between members is worked through.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "When Tension Shows Up" },
        {
          key: "first",
          label: "First paragraph",
          kind: "long",
          max: 280,
          default:
            "Disagreements are part of living together. When tension shows up, start with a direct conversation with the people involved.",
        },
        {
          key: "second",
          label: "Second paragraph",
          help: "Leave blank for none.",
          kind: "long",
          max: 280,
          default:
            "If that does not settle it, ask a steward or someone you trust in the village to help everyone be heard.",
          optional: true,
        },
        {
          key: "third",
          label: "Third paragraph",
          help: "Leave blank for none.",
          kind: "long",
          max: 280,
          default: "",
          optional: true,
        },
      ],
    },
    {
      id: "stewards",
      label: "Stewards and their veto",
      shows: "Who can stop a decision that passed, for how long, and what the village can do about it.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 48, default: "Stewards, and Why They Are Temporary" },
        {
          key: "first",
          label: "First paragraph",
          help: "{veto} becomes how long a steward has to stop a change, from Admin, Variables (\"How long a steward has to stop a change\"). 72 hours reads as \"three days\".",
          kind: "long",
          max: 360,
          default:
            "A steward holds a veto: once a major proposal passes, a steward has {veto} to stop it before it takes effect. That window exists so somebody with the whole picture can catch a decision that would cause harm or break something the village depends on.",
        },
        {
          key: "second",
          label: "Second paragraph",
          help: "Leave blank for none.",
          kind: "long",
          max: 280,
          default:
            "A veto is answerable. It is recorded with the steward's name and their stated reason, both visible to every member, so stopping a decision costs a steward something and cannot be done quietly.",
          optional: true,
        },
        {
          key: "third",
          label: "Third paragraph",
          help: "Leave blank for none.",
          kind: "long",
          max: 280,
          default:
            "The community checks the stewards. Members who put a steward in can vote that steward out, and the settings governing stewards are the one thing no steward may veto, so a role can never defend itself against the village that granted it.",
          optional: true,
        },
        {
          key: "fourth",
          label: "Fourth paragraph",
          help: "Leave blank for none.",
          kind: "long",
          max: 280,
          default:
            "These are training wheels. Stewards exist while the systems are young and still being proven, and the village can lower or retire the role by vote once it no longer needs them.",
          optional: true,
        },
      ],
    },
    {
      id: "rules",
      label: "How rules evolve",
      shows: "One paragraph on how the village changes its own agreements.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "How Rules Evolve" },
        {
          key: "body",
          label: "Paragraph",
          kind: "long",
          max: 280,
          default:
            "The agreements {village} starts with can change. Any member can propose a change, and rules that no longer serve the community can be amended or removed.",
        },
      ],
    },
    {
      id: "hypha",
      label: "Hypha",
      shows: "How the village uses Hypha. Drawn only while your Hypha DHO link is set in Admin, Variables.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "The Hypha Platform" },
        {
          key: "body",
          label: "Paragraph",
          kind: "long",
          max: 280,
          default:
            "{village} has a space on Hypha, an open-source platform for proposals and votes. What happens there can be read and traced.",
        },
        {
          key: "linkLabel",
          label: "Link to the Co-Creators Guide",
          help: "Shown while your brochure pages are on.",
          kind: "text",
          max: 32,
          default: "Learn more in the guide",
        },
      ],
    },
    {
      id: "cta",
      label: "Closing invitation",
      shows: "The band at the foot of the page. Shown while your brochure pages are on, because both its buttons lead to them.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Ready to help govern?" },
        {
          key: "body",
          label: "Sentence under the heading",
          kind: "long",
          max: 160,
          default: "Find the circle closest to your gifts and help shape the village from the inside.",
          optional: true,
        },
        { key: "stewardLabel", label: "Button to the steward page", kind: "text", max: 28, default: "Become a Steward" },
        {
          key: "commitmentLabel",
          label: "Button to the page a member signs",
          help: "{commitment} is what a member signs, from Identity.",
          kind: "text",
          max: 36,
          default: "Sign the {commitment}",
        },
      ],
    },
  ],
};
