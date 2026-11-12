/**
 * The class lists the outside service's differences on /review share, so the
 * list, its rows, the bulk sheet and the draft card draw from one set. The
 * app's own tokens only (the approved boards drew them in raw colours; the
 * page uses what the theme gives them).
 */
export const card = "bg-card border border-border rounded-xl";
/** A ring offset from the fill, so focus shows on a teal control (QA Q2): the default outline is the fill's own colour. */
export const ring = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
export const primary = `inline-flex items-center justify-center min-h-[44px] px-3.5 rounded-lg bg-teal-deep text-white text-sm font-semibold hover:bg-teal-deep-dark disabled:opacity-60 ${ring}`;
export const secondary =
  "inline-flex items-center justify-center min-h-[44px] px-3.5 rounded-lg border border-border bg-card text-foreground text-sm font-medium hover:bg-muted disabled:opacity-60";
export const inlineLink = "text-notice underline hover:text-foreground";
export const chip = "self-start rounded-lg bg-notice/10 text-notice font-semibold";
