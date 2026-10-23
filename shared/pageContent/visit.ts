/**
 * The visit page (/visit), as fields.
 *
 * Most of this page is already the village's own: the sentence under the
 * headline, the ways to visit and the logistics come from Make it yours,
 * Visit Program (`visit-config`). This spec holds the two lines that were
 * still typed into the page: the headline, and the promise made after the form
 * is sent.
 *
 * The defaults are the words the page carried in code until 2026-10-22, so
 * switching the page onto this spec changes nothing a visitor sees.
 */
import type { PageSpec } from "./types";

export const VISIT_PAGE: PageSpec = {
  id: "visit",
  label: "Visit",
  path: "/visit",
  sections: [
    {
      id: "hero",
      label: "Top of the page",
      shows: "The headline on the coloured band. The sentence under it is in Make it yours, Visit Program.",
      fields: [{ key: "headline", label: "Headline", kind: "text", max: 48, default: "Come and see for yourself" }],
    },
    {
      id: "form",
      label: "After the form is sent",
      shows: "What a visitor reads under \"Thank you.\" once they have sent the visit form.",
      fields: [
        {
          key: "thanks",
          label: "Line under \"Thank you.\"",
          help: "Promise only what your team will do. Leave blank for none.",
          kind: "long",
          max: 160,
          default: "We'll be in touch within 48 hours to coordinate.",
          optional: true,
        },
      ],
    },
  ],
};
