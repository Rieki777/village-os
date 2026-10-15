/**
 * THE FOUNDATION FONT CATALOGUE — what every village can choose from without
 * thinking about licences at all.
 *
 * Every offering here is SIL Open Font License, self-hosted via @fontsource
 * (imported in client/src/main.tsx, latin subset, bundled with content
 * hashes). Choosing one is therefore always legally safe and always fast —
 * no request leaves the origin for a typeface, anywhere on Earth.
 *
 * The catalogue is deliberately small and deliberately in one voice. The
 * platform's look is elegant-but-warm: a clean humanist display, a quiet
 * geometric body, a handwritten accent used sparingly. Every addition keeps
 * that register — offerings differ in mood (rooted, refined, airy), not in
 * kind. A catalogue of forty fonts is a design decision refused; twelve is a
 * design decision made.
 *
 * A village whose identity needs a face that is not here uploads its own
 * package (Admin → Typography) — with the licence acknowledgment that
 * transfers responsibility to the village that chose it, which is where it
 * belongs. This file is HARD-CLEAN territory: no village's name, ever.
 *
 * Adding an offering = one entry here + the matching latin-subset imports in
 * client/src/main.tsx + its pinned @fontsource dependency + its row in the
 * STACKS table of cardFontStacks (shared/brandTokens.ts). The test beside
 * this file fails when any of the four is missed. theme.css does the rest at
 * runtime.
 */

export type FontRole = "display" | "body" | "accent";

export interface FontOffering {
  /** Stable id stored nowhere — the STACK is what the brand doc stores. */
  id: string;
  /** The CSS font-family name exactly as @fontsource registers it. */
  family: string;
  role: FontRole;
  /** The full stack written into the brand doc when this offering is chosen. */
  stack: string;
  /** One line for the picker: mood, not taxonomy. */
  hint: string;
}

export const FONT_CATALOG: FontOffering[] = [
  // ── Display: headings, the village's voice at full volume ────────────────
  {
    id: "raleway",
    family: "Raleway",
    role: "display",
    stack: '"Raleway", system-ui, sans-serif',
    hint: "The platform default: clean, open, a little elegant.",
  },
  {
    id: "josefin-sans",
    family: "Josefin Sans",
    role: "display",
    stack: '"Josefin Sans", "Raleway", system-ui, sans-serif',
    hint: "Geometric and airy, with a vintage warmth.",
  },
  {
    // Also bundled at 300 and in 400 and 500 italic, so a heading set light
    // and an italic place line render in the real cuts. Without them the
    // browser fakes both, and a faked italic on a fine serif looks broken.
    id: "cormorant-garamond",
    family: "Cormorant Garamond",
    role: "display",
    stack: '"Cormorant Garamond", Georgia, serif',
    hint: "A refined serif; bookish, graceful, old-growth.",
  },
  {
    id: "playfair-display",
    family: "Playfair Display",
    role: "display",
    stack: '"Playfair Display", Georgia, serif',
    hint: "High-contrast serif with presence; good for bold names.",
  },
  {
    id: "marcellus",
    family: "Marcellus",
    role: "display",
    stack: '"Marcellus", Georgia, serif',
    hint: "Roman inscriptional calm; one weight, worn like stone.",
  },

  // ── Body: paragraphs, forms, the long middle of every page ───────────────
  {
    id: "montserrat",
    family: "Montserrat",
    role: "body",
    stack: '"Montserrat", -apple-system, BlinkMacSystemFont, sans-serif',
    hint: "The platform default: geometric, even, tireless.",
  },
  {
    id: "nunito-sans",
    family: "Nunito Sans",
    role: "body",
    stack: '"Nunito Sans", -apple-system, BlinkMacSystemFont, sans-serif',
    hint: "Rounded and warm; the softest of the bodies.",
  },
  {
    id: "raleway-body",
    family: "Raleway",
    role: "body",
    stack: '"Raleway", system-ui, sans-serif',
    hint: "Match the default display for a single-family look.",
  },
  {
    // Bundled at 300, 400 and 500, the weights a light body face is set in,
    // plus 600 and 700, because buttons, tiles, labels and headings across
    // the app (the live room's chrome among them) are set semibold, and
    // without the real cuts the browser fakes a thickened 500.
    id: "jost",
    family: "Jost",
    role: "body",
    stack: '"Jost", -apple-system, BlinkMacSystemFont, sans-serif',
    hint: "Light and geometric; calm across long pages.",
  },

  // ── Accent: handwritten moments — quotes, celebrations, margins ──────────
  {
    id: "kalam",
    family: "Kalam",
    role: "accent",
    stack: '"Kalam", cursive',
    hint: "The platform default: a steady, legible hand.",
  },
  {
    id: "caveat",
    family: "Caveat",
    role: "accent",
    stack: '"Caveat", cursive',
    hint: "Quicker and looser; a note left on the kitchen table.",
  },
  {
    // A formal copperplate script, one weight. Beautiful for a name, a place
    // line or a signature, and unreadable by the third line, so the hint says
    // so where the admin makes the choice.
    id: "pinyon-script",
    family: "Pinyon Script",
    role: "accent",
    stack: '"Pinyon Script", cursive',
    hint: "Formal copperplate; for a single line or a signature, never body text.",
  },
];

export function offeringsFor(role: FontRole): FontOffering[] {
  return FONT_CATALOG.filter((f) => f.role === role);
}
