/**
 * The dashboard's shared class strings, so every panel draws the approved
 * design's shapes the same way. Colours are tokens only (index.css, the
 * `dash-*` set under `@theme inline`), which is what lets a village re-tint
 * the sheet and what keeps scripts/check-theme-literals.mjs at zero.
 */

/** A top-level panel on the night ground. */
export const PANEL = "rounded-[22px] border border-dash-edge bg-card";
/** A card inside a panel. */
export const RAISED = "rounded-[18px] border border-dash-edge bg-dash-raised";
/** The small caps line above a heading. */
export const KICKER = "m-0 text-xs uppercase tracking-[0.17em] text-dash-gold-lit";
/** A section heading in the display face. */
export const H2 = "m-0 font-display text-[28px] leading-tight text-foreground sm:text-[32px]";
/** The gold call to action. */
export const BTN_GOLD =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-dash-gold px-5 font-semibold text-dash-gold-ink no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
/** The quiet outlined button beside it. */
export const BTN_LINE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-transparent px-4 font-medium text-foreground no-underline hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
/** An inline link in the gold the design uses for every link on the sheet. */
export const LINK = "text-dash-gold-lit underline underline-offset-2 hover:text-foreground";
/** A rounded chip. */
export const CHIP = "rounded-full border border-dash-edge bg-dash-chip px-3 py-1.5 text-[13px] text-foreground";
