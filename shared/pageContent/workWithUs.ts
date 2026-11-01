/**
 * The Work With Us page (/work-with-us), as fields, and the email a proposer
 * receives after sending one.
 *
 * The intro, the reciprocity options and the guide's name and greeting were
 * already the village's own (Make it yours, Work With Us). This spec holds the
 * words that were still typed into the page and into server/index.ts: the line
 * above the reciprocity options, the thank-you after sending, and the
 * acknowledgement email. Two of those carried a response promise ("up to a
 * month") that only the village can make.
 *
 * The defaults are neutral starter text (2026-10-23): the first village's
 * reply time ("up to a month") came out of the thank-you and the email,
 * because only a village can promise one. That village keeps its own copy in
 * its database; the record is server/seeds/amora/pages/page-work-with-us.json.
 */
import type { PageSpec } from "./types";

export const WORK_WITH_US_PAGE: PageSpec = {
  id: "work-with-us",
  label: "Work With Us",
  path: "/work-with-us",
  sections: [
    {
      id: "reciprocity",
      label: "Reciprocity",
      shows: "Above the reciprocity options on the proposal form. The options themselves are in Make it yours, Work With Us.",
      fields: [
        {
          key: "lede",
          label: "Sentence above the options",
          help: "\"Select any that fit.\" follows it while there are options to select.",
          kind: "long",
          max: 200,
          default: "{village} is built on reciprocity, and there's more than one way to be valued here.",
        },
      ],
    },
    {
      id: "thanks",
      label: "After a proposal is sent",
      shows: "The page a person sees once their proposal has gone. The heading is also the title inside the email below.",
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 48, default: "Your proposal is with us" },
        {
          key: "body",
          label: "Sentence under the heading",
          help: "Promise only the reply time your team keeps.",
          kind: "long",
          max: 240,
          default:
            "Thank you for offering your gifts to {village}. We read every proposal with care, and there's room to talk it through and revise.",
        },
      ],
    },
    {
      id: "email",
      label: "Email to the person who proposed",
      shows: "Sent to the address on the proposal as soon as it arrives, when your village's email is set up.",
      fields: [
        { key: "subject", label: "Subject line", kind: "text", max: 80, default: "We've received your proposal" },
        {
          key: "body",
          label: "Message",
          help: "It opens with \"Hi\" and their name, and closes with \"The team\".",
          kind: "long",
          max: 400,
          default:
            "Thank you for offering your gifts. We read every Work With Us proposal with care, and we will reply once we have. There is room for conversation and revision.",
        },
      ],
    },
  ],
};
