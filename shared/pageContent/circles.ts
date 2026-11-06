/**
 * Circles (/circles), as fields.
 *
 * Every village has this page: it draws the village's own circles, their
 * roles and who holds them, from the village's rows. Until 2026-11-01 the
 * words around those rows were one village's JSX, so every village read
 * "Our Sociocratic Circles", a consent process, "the four leads" and a
 * Finance & Business Circle as its own facts.
 *
 * THE DEFAULTS ARE A NEUTRAL STARTER, true of any village on this platform.
 * They name no governance method, no circle and no count. They say only what
 * the page itself shows: each circle looks after its own part of the work,
 * its card says what it may decide alone, and where the circles nest under
 * one top circle, which one that is. A village writes its own over them in
 * Admin, Pages, Circles.
 *
 * The words the page typed until then are the established village's, kept at
 * boot by server/lib/circlesWordsKept.ts from the snapshot in
 * server/seeds/page-circles-before-neutral.json, so a village that already
 * held its page words reads the same page with no save to remember.
 *
 * WHAT IS A FIELD AND WHAT IS NOT. The circles, their names, purposes, roles
 * and holders are data and are never typed here. Only the words around them
 * are fields: the top of the page, the headings over the two groups of
 * circles, the line in an opened circle's panel, the box on how circles work
 * together, and the closing button.
 *
 * `{coordinator}` is the village's own top circle, filled by the page itself
 * (shared/coordinatingCircle.ts), never typed. A village whose circles nest
 * under one top circle reads the "linked" words with that circle's name in
 * them; a village whose circles sit side by side reads the "side by side"
 * words, which name no circle.
 *
 * Every section after the top can be hidden. Hiding a group's heading never
 * hides the circles under it: they are the village's real circles.
 */
import type { PageSpec } from "./types";

/** The word the page fills with its top circle's name. */
export const COORDINATOR_WORD = "coordinator";

const LINKED_HELP =
  "Shown when your circles sit under one top circle. {coordinator} becomes that circle's name. Leave blank for none.";
const FLAT_HELP = "Shown when your circles sit side by side, with no one circle at the top. Leave blank for none.";

export const CIRCLES_PAGE: PageSpec = {
  id: "circles",
  label: "Circles",
  path: "/circles",
  sections: [
    {
      id: "hero",
      label: "Top of the page",
      shows: "The heading and paragraph above the circle map, with a button to the open roles.",
      fields: [
        { key: "headline", label: "Headline", kind: "text", max: 48, default: "Our Circles" },
        {
          key: "intro",
          label: "Paragraph under the headline",
          kind: "long",
          max: 280,
          default:
            "Circles are how {village} shares out its work. Each one looks after its own domain, and its roles say who does what.",
        },
        {
          key: "firstTerm",
          label: "First word with an explanation",
          help: "A word or phrase from the paragraph above, exactly as it appears there. It gets a small button that opens the explanation below. Leave blank for none.",
          kind: "text",
          max: 32,
          default: "domain",
          optional: true,
        },
        {
          key: "firstTip",
          label: "Its explanation",
          kind: "long",
          max: 200,
          default: "A domain is the part of the village's work that one circle looks after.",
          optional: true,
        },
        {
          key: "secondTerm",
          label: "Second word with an explanation",
          help: "Another word or phrase from the paragraph. Leave blank for none.",
          kind: "text",
          max: 32,
          default: "",
          optional: true,
        },
        {
          key: "secondTip",
          label: "Its explanation",
          kind: "long",
          max: 200,
          default: "",
          optional: true,
        },
        { key: "rolesLabel", label: "Button to the roles page", kind: "text", max: 28, default: "View Open Roles" },
      ],
    },
    {
      id: "today",
      label: "Circles at work",
      shows: "The heading over the circles that are running now. Hidden, the circles still show, without it.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "The Circles Today" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 160,
          default: "The circles at work in {village} right now.",
          optional: true,
        },
      ],
    },
    {
      id: "future",
      label: "Circles forming or resting",
      shows: "The heading over the circles that are forming or resting. Hidden, the circles still show, without it.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "Forming and Resting" },
        {
          key: "intro",
          label: "Sentence under the heading",
          kind: "long",
          max: 200,
          default: "Circles that are still forming, or resting for now.",
          optional: true,
        },
      ],
    },
    {
      id: "card",
      label: "Inside each circle",
      shows: "The line at the foot of a circle's panel once a visitor opens it.",
      hideable: true,
      fields: [
        { key: "label", label: "Bold words that start the line", kind: "text", max: 24, default: "How it fits:" },
        {
          key: "linked",
          label: "The line in a circle under your top circle",
          help: LINKED_HELP,
          kind: "long",
          max: 220,
          default: "This circle looks after its own part of the work and sits under the {coordinator}.",
          optional: true,
        },
        {
          key: "flat",
          label: "The line in every other circle",
          help: "Shown in your top circle itself, and in every circle when your circles sit side by side. Leave blank for none.",
          kind: "long",
          max: 220,
          default: "This circle looks after its own part of the village's work.",
          optional: true,
        },
      ],
    },
    {
      id: "together",
      label: "How circles work together",
      shows: "The box under the circles: up to three paragraphs on how the circles fit together.",
      hideable: true,
      fields: [
        { key: "heading", label: "Heading", kind: "text", max: 40, default: "How Circles Work Together" },
        {
          key: "first",
          label: "First paragraph, opening sentence",
          help: "Wrap words in **double stars** to make them bold.",
          kind: "long",
          max: 200,
          default: "Each circle looks after **its own part of the village's work**.",
        },
        {
          key: "acrossLinked",
          label: "First paragraph, next sentence (circles under one top circle)",
          help: LINKED_HELP,
          kind: "long",
          max: 200,
          default: "The other circles all sit under the **{coordinator}**.",
          optional: true,
        },
        {
          key: "acrossFlat",
          label: "First paragraph, next sentence (circles side by side)",
          help: FLAT_HELP,
          kind: "long",
          max: 200,
          default: "",
          optional: true,
        },
        {
          key: "after",
          label: "First paragraph, closing sentence",
          help: "Leave blank for none.",
          kind: "long",
          max: 200,
          default: "",
          optional: true,
        },
        {
          key: "second",
          label: "Second paragraph",
          help: "Leave blank for none.",
          kind: "long",
          max: 320,
          default: "Open a circle to see its roles, and its card to see what it can decide on its own.",
          optional: true,
        },
        {
          key: "thirdLinked",
          label: "Third paragraph (circles under one top circle)",
          help: LINKED_HELP,
          kind: "long",
          max: 280,
          default: "The map above shows how the circles nest under the {coordinator}, and which roles are still open.",
          optional: true,
        },
        {
          key: "thirdFlat",
          label: "Third paragraph (circles side by side)",
          help: FLAT_HELP,
          kind: "long",
          max: 280,
          default: "",
          optional: true,
        },
      ],
    },
    {
      id: "closing",
      label: "Closing button",
      shows: "The button at the foot of the page, to the roles page.",
      hideable: true,
      fields: [{ key: "label", label: "Button", kind: "text", max: 36, default: "Learn About Roles & Leadership" }],
    },
  ],
};
