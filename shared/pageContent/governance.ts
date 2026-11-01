/**
 * How We Govern (/governance), as fields.
 *
 * Every village has this page: it is a door on the welcome page of a new
 * village, brochure pages on or off. Until 2026-10-23 it was one village's
 * JSX, so every new village described a sociocracy, five named circles, a
 * practice of nonviolent communication and a Hypha space it might not have.
 *
 * The defaults are the words the page carried in code until 2026-10-23, moved
 * here unchanged, EXCEPT two facts that already had a setting:
 *   - the steward's veto window is `{veto}`, from Admin, Variables
 *     (`governance.veto_hours`). The page said "three days" whatever the
 *     village had set, and 72 hours is only the floor. `{veto}` is filled by
 *     the page itself (`vetoWindowWords` below), not by shared vars;
 *   - the Hypha section draws only while the village's Hypha DHO link is set
 *     (Admin, Variables, `hypha.org_url`) as well as switched on here.
 * "Love Letter" in the closing button is `{commitment}`, which is "Love
 * Letter" where that is the village's commitment name.
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
        { key: "headline", label: "Headline", kind: "text", max: 48, default: "Power Belongs to the Circle, Not the Person" },
        {
          key: "intro",
          label: "Paragraph under the headline",
          help: "Wrap words in **double stars** to make them bold.",
          kind: "long",
          max: 280,
          default:
            "{village} uses sociocracy, a consent-based governance system where every voice can influence decisions. While the systems are still finding their feet, members elect stewards who can veto a decision, and those same members can vote a steward out.",
        },
      ],
    },
    {
      id: "principles",
      label: "Principles",
      shows: "The row of cards under the open votes. Each gets the next icon in a fixed set.",
      hideable: true,
      fields: [{ key: "heading", label: "Heading", kind: "text", max: 40, default: "The Core Principles" }],
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
              title: "Consent over consensus",
              body: "We don't need everyone to love a decision. We need no one to have a serious objection. This keeps us moving without demanding perfection.",
            },
            {
              title: "Circles, not hierarchy",
              body: "Decisions are made in the circle closest to the work. The Development Circle governs the build. The Community Circle governs the human experience. No top-down override.",
            },
            {
              title: "Transparency by default",
              body: "Meeting notes, decisions, and proposals are recorded and accessible to all members. Nothing happens in secret.",
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
        { key: "intro", label: "Sentence under the heading", kind: "text", max: 100, default: "Every decision follows the same simple path.", optional: true },
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
            { text: "Someone senses a tension or opportunity." },
            { text: "They bring a proposal to their circle." },
            { text: "The circle discusses, amends, and tests for consent." },
            { text: "If no one has a paramount objection, the proposal passes." },
            { text: "The decision is logged and published." },
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
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Circles and Their Domains" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 180,
          default: "Authority lives close to the work. Each circle governs its domain and reports up only when something crosses boundaries.",
          optional: true,
        },
        { key: "linkLabel", label: "Link to the circles page", kind: "text", max: 32, default: "See all circles in detail" },
      ],
      lists: [
        {
          key: "items",
          label: "Circle cards",
          help: "Two side by side on a wide screen. Leave the list empty for none.",
          itemLabel: "Circle",
          titleKey: "name",
          maxItems: 8,
          fields: [
            { key: "name", label: "Name", kind: "text", max: 32, default: "" },
            { key: "body", label: "What it looks after", kind: "long", max: 180, default: "" },
          ],
          default: [
            {
              name: "General Coordinating Circle",
              body: "Where the circles meet: the four leads and circle representatives, coordinating strategy, budget stewardship, and decisions that cross circle boundaries.",
            },
            {
              name: "Outreach & Growth Circle",
              body: "Connects with people and guides their whole journey into the village: marketing, sales, social media, and membership & onboarding as one flow.",
            },
            {
              name: "Community Circle",
              body: "The lived experience: events, hospitality, stays on the land, and the governance and team-health practices that keep the human systems honest.",
            },
            {
              name: "Development Circle",
              body: "The physical realization: master planning, architecture, permitting, construction, land operations, and regenerative systems.",
            },
            {
              name: "Finance & Business Circle",
              body: "Stewards the money and builds the engines that generate it: financial operations, the legal container, and business development.",
            },
          ],
        },
      ],
    },
    {
      id: "conflict",
      label: "Conflict resolution",
      shows: "Up to three paragraphs on how tension between members is worked through.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Conflict Resolution" },
        {
          key: "first",
          label: "First paragraph",
          kind: "long",
          max: 280,
          default:
            "When tension shows up, it goes through three stages. First, the people involved have a direct conversation, supported by our shared practice of nonviolent communication. Most things resolve here.",
        },
        {
          key: "second",
          label: "Second paragraph",
          help: "Leave blank for none.",
          kind: "long",
          max: 280,
          default:
            "If that doesn't land, a facilitated conversation is requested. A trained member from a different circle helps both sides be heard and find a path forward.",
          optional: true,
        },
        {
          key: "third",
          label: "Third paragraph",
          help: "Leave blank for none.",
          kind: "long",
          max: 280,
          default:
            "If the tension still won't resolve, the relevant circle holds a mediation. No one is removed from the community without a circle consent vote. We err on the side of repair and reintegration whenever possible.",
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
            "The community votes stewards in. A steward holds a veto: once a major proposal passes, a steward has {veto} to stop it before it takes effect. That window exists so somebody with the whole picture can catch a decision that would cause harm or break something the village depends on.",
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
            "The agreements we launch with are not permanent. Any member can propose a change through their circle. Rules that no longer serve the community get amended or removed. Governance is alive; it grows with us.",
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
            "Governance is logged on Hypha, an open-source platform owned by its contributors. Every proposal, vote, and contribution is transparent and traceable. Value in, value out.",
        },
        {
          key: "linkLabel",
          label: "Link to the Co-Creators Guide",
          help: "Shown while your brochure pages are on.",
          kind: "text",
          max: 32,
          default: "Learn more in the Game Guide",
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
          default: "Join the circle closest to your gifts and start shaping the village from the inside.",
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
