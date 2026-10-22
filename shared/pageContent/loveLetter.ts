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
 * THE DEFAULTS ARE THE LETTER EXACTLY AS IT WAS. For a village that calls its
 * letter "Love Letter" and has written none of these fields, the letter comes
 * out byte for byte as it did before 2026-10-22, so its fingerprint (the
 * letter version members align with) does not move. That is pinned in
 * server/lib/membershipLetter.test.ts against fingerprints taken from the old
 * code. A village with another name for its letter now reads that name where
 * the letter used to say "Love Letter", which is a new letter version for it.
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
        { key: "greeting", label: "Greeting", kind: "text", max: 80, default: "Dear Future {village} Family Member," },
        {
          key: "joining",
          label: "Paragraph after the opening",
          kind: "long",
          max: 400,
          default:
            "By signing this {commitment}, you are not just joining a community. You are becoming a co-creator of the most beautiful village we can imagine together. You are saying yes to regeneration, of the land, of community, of yourself.",
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
            "In return, you become a full member of {entity}, gaining access to community spaces, governance participation, {token} economy, and the opportunity to deepen your involvement through roles, residency, or business creation.",
        },
        { key: "closing", label: "Closing line", kind: "text", max: 60, default: "With love and anticipation," },
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
            { text: "Treat all beings with respect, compassion, and authentic communication" },
            { text: "Participate in community governance through our sociocratic circles" },
            { text: "Contribute to the regeneration of the land and ecosystem" },
            { text: "Support fellow community members in their growth and wellbeing" },
            { text: "Honor the values and agreements of the {village} community" },
            { text: "Practice Nonviolent Communication and authentic relating" },
            { text: "Meet financial obligations as agreed with the community" },
            { text: "Show up for community life, circles, celebrations, and shared care" },
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
          default: "Fill in your details below to officially join the {village} Family and become a member of {entity}.",
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
        { key: "submitLabel", label: "Button", kind: "text", max: 60, default: "Sign the {commitment} & Join the {village} Family" },
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
          default: "Suggested: $33-$108/month.",
          optional: true,
        },
        { key: "customLabel", label: "Last choice: a custom amount", kind: "text", max: 60, default: "I'd like to discuss a custom amount" },
        {
          key: "customPlaceholder",
          label: "Hint in the custom amount box",
          kind: "text",
          max: 80,
          default: "Tell us what works for you (e.g. $20/month, in-kind, barter)",
        },
      ],
      lists: [
        {
          key: "tiers",
          label: "Levels",
          help: "Up to six, before the custom choice. The amount is what a signing records; the label is what the signer reads.",
          itemLabel: "Level",
          titleKey: "label",
          maxItems: 6,
          fields: [
            { key: "value", label: "Amount recorded", kind: "text", max: 12, default: "" },
            { key: "label", label: "What the signer reads", kind: "text", max: 48, default: "" },
          ],
          default: [
            { value: "33", label: "$33/month, Seed level" },
            { value: "55", label: "$55/month, Sprout level" },
            { value: "88", label: "$88/month, Grove level" },
            { value: "108", label: "$108/month, Forest level" },
          ],
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
          default: "You are not just joining a place. You are becoming part of something alive.",
          optional: true,
        },
      ],
    },
  ],
};
