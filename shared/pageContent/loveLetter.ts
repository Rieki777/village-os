/**
 * The membership letter page (`/love-letter`), as fields.
 *
 * THE LETTER'S OWN WORDS ARE READ ON THE SERVER TOO. A signed-in member who
 * signs aligns with the letter's exact words, which the server renders,
 * fingerprints and stores (shared/membershipLetter.ts, `letterParts`). So the
 * `letter` section below is read by BOTH sides from the same stored section
 * (`page-love-letter`): the server through `letterSourceFrom`, the page while
 * the server's copy is on its way. A field the page drew and the server did
 * not would be a member aligning with words they never saw.
 *
 * THE DEFAULTS ARE A NEUTRAL STARTER LETTER (2026-10-23), true of any village
 * and claiming nothing about its land, its prices or how it decides. Until
 * then they were the first village's letter, word for word. That village
 * keeps its own copy in its database (the record is
 * server/seeds/amora/pages/page-love-letter.json), so its letter version did
 * not move. EVERY OTHER VILLAGE THAT HAD NOT WRITTEN ITS OWN LETTER GOT A NEW
 * LETTER VERSION WITH THIS CHANGE: a member who aligned before keeps the
 * words they read, and the next signing aligns with these. Both are pinned in
 * server/lib/membershipLetter.test.ts: the starter letter's fingerprints, and
 * the old fingerprints reproduced from the adopted copy.
 *
 * `{entity}` works in this page's fields as well as the usual words: the name
 * a member joins (Legal, Membership entity), or the village's name.
 */
import type { PageSpec } from "./types";

/** The four paths a signer can tick. The ids are what a signing stores. */
export const LETTER_PATH_IDS = ["investor", "steward", "resident", "prosperity"] as const;

const ENTITY_HELP = "{entity} is the name a member joins, from Legal (Membership entity), or your village's name.";

export const LOVE_LETTER_PAGE: PageSpec = {
  id: "love-letter",
  label: "Membership letter",
  path: "/love-letter",
  sections: [
    {
      id: "hero",
      label: "Top of the page",
      shows: "The heading and the sentence above the letter.",
      fields: [
        { key: "headline", label: "Heading", kind: "text", max: 60, default: "The {village} {commitment}" },
        {
          key: "lede",
          label: "Sentence under the heading",
          help: `${ENTITY_HELP} "Read. Reflect. Sign." follows it.`,
          kind: "long",
          max: 160,
          default: "Our founding covenant, and your official membership in {entity}.",
        },
      ],
    },
    {
      id: "letter",
      label: "The letter",
      shows:
        "The letter itself. A member who aligns keeps these exact words, so changing any of them makes a new version of the letter; members who already aligned keep the words they read. The opening and governance paragraphs are in Covenant.",
      fields: [
        { key: "greeting", label: "Greeting", kind: "text", max: 80, default: "Dear friend of {village}," },
        {
          key: "joining",
          label: "Paragraph after the opening",
          kind: "long",
          max: 400,
          default:
            "By signing this {commitment}, you become part of {village}. You are saying yes to the people here, to caring for this place, and to building the village together.",
        },
        {
          key: "commitLead",
          label: "Line above the commitments",
          help: ENTITY_HELP,
          kind: "text",
          max: 80,
          default: "As a member of {entity}, you commit to:",
        },
        {
          key: "inReturn",
          label: "Paragraph after the commitments",
          help: ENTITY_HELP,
          kind: "long",
          max: 400,
          default:
            "In return, you become a full member of {entity}, gaining access to community spaces, governance participation, and the opportunity to deepen your involvement through roles, residency, or business creation.",
        },
        { key: "closing", label: "Closing line", kind: "text", max: 60, default: "With a warm welcome," },
        { key: "signature", label: "Signed by", kind: "text", max: 60, default: "The {village} Community" },
      ],
      lists: [
        {
          key: "commitments",
          label: "Commitments",
          help: "Up to twelve, in this order. With none, the line above them is left out too.",
          itemLabel: "Commitment",
          titleKey: "text",
          minItems: 1,
          maxItems: 12,
          fields: [{ key: "text", label: "Commitment", kind: "text", max: 100, default: "" }],
          default: [
            { text: "Treat everyone here with respect, care, and honest communication" },
            { text: "Take part in how {village} makes its decisions" },
            { text: "Care for the land and the places we share" },
            { text: "Support the people around you in their growth and wellbeing" },
            { text: "Honor the values and agreements of the {village} community" },
            { text: "Meet financial obligations as agreed with the community" },
            { text: "Show up for community life, celebrations, and shared care" },
          ],
        },
      ],
    },
    {
      id: "form",
      label: "The joining form",
      shows: "The form under the letter. A signed-in member sees their own account's words instead of the heading, the sentence and the button here.",
      fields: [
        { key: "visitorHeading", label: "Heading", kind: "text", max: 40, default: "Sign Your Membership" },
        {
          key: "visitorLede",
          label: "Sentence under the heading",
          help: ENTITY_HELP,
          kind: "long",
          max: 200,
          default: "Fill in your details below to join {village} and become a member of {entity}.",
        },
        {
          key: "standardsLabel",
          label: "Name of your standards page",
          help: "The linked words in the first tick box. The link goes to your Good Neighbor page.",
          kind: "text",
          max: 40,
          default: "Good Neighbor Criteria",
        },
        {
          key: "ackLabel",
          label: "Second tick box",
          help: ENTITY_HELP,
          kind: "long",
          max: 240,
          default: "I have read the {commitment} above and commit to the values and agreements of the {village} community as a member of {entity}.",
        },
        { key: "submitLabel", label: "Button", kind: "text", max: 60, default: "Sign the {commitment} & Join {village}" },
      ],
      lists: [
        {
          key: "paths",
          label: "Paths",
          help: "The four choices, in this order. What a signing records is the path, not these words.",
          itemLabel: "Path",
          titleKey: "label",
          fixed: LETTER_PATH_IDS,
          maxItems: 4,
          fields: [{ key: "label", label: "Label", kind: "text", max: 48, default: "" }],
          default: [
            { label: "Investor / Capital Contributor" },
            { label: "Village Steward / Co-Creator" },
            { label: "Resident / Future Villager" },
            { label: "Prosperity Creator / Business Builder" },
          ],
        },
      ],
    },
    {
      id: "contribution",
      label: "Monthly contribution",
      shows: "The contribution choice in the form. Your short note from Legal sits before the suggested line.",
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Monthly Membership Contribution" },
        {
          key: "suggested",
          label: "Suggested amount line",
          help: "Leave blank for none.",
          kind: "text",
          max: 60,
          default: "",
          optional: true,
        },
        { key: "customLabel", label: "Last choice: a custom amount", kind: "text", max: 60, default: "I'd like to discuss an amount" },
        {
          key: "customPlaceholder",
          label: "Hint in the custom amount box",
          kind: "text",
          max: 80,
          default: "Tell us what works for you: an amount, in-kind, or barter",
        },
      ],
      lists: [
        {
          key: "tiers",
          label: "Levels",
          help: "Up to six, before the custom choice. The amount is what a signing records; the label is what the signer reads. With none, the signer describes an amount in their own words.",
          itemLabel: "Level",
          titleKey: "label",
          maxItems: 6,
          fields: [
            { key: "value", label: "Amount recorded", kind: "text", max: 12, default: "" },
            { key: "label", label: "What the signer reads", kind: "text", max: 48, default: "" },
          ],
          default: [],
        },
      ],
    },
    {
      id: "thanks",
      label: "After signing",
      shows: "The thank-you a signer sees once their letter is sent.",
      fields: [
        {
          key: "quote",
          label: "Closing quote",
          help: "Shown in quotation marks. Leave blank for none.",
          kind: "text",
          max: 140,
          default: "Welcome to {village}. We're glad you're here.",
          optional: true,
        },
      ],
    },
  ],
};
