/**
 * THE SHEET'S LOOK, as class strings: the design language of the profile
 * (pages/Profile.tsx and components/profile/*), named so the joining journey
 * draws with the same hand. docs/DESIGN_RULE.md is the rule; this file is what
 * a page imports to follow it. scripts/check-design-rule.mjs holds the journey
 * files to it.
 *
 * Every value below is lifted from a real profile component, named beside it.
 * The colours are the semantic tokens only (card, muted, border, foreground,
 * muted-foreground, notice, ring, destructive), so they re-theme with the
 * sheet's night world (`.sheet-night` in client/src/index.css) and with a
 * village's own palette, and nothing here needs a light and a dark copy.
 *
 * Plain strings and nothing else: no component, no import, so a page that uses
 * them pays nothing in its chunk beyond the words.
 */

/** The world: the sheet's night ground (Profile.tsx's root). Put it on the page's outermost element inside <Layout>. */
export const WORLD = "relative sheet-night min-h-screen bg-background";

/** A section panel (Profile.tsx "About you", the treasury, Paths). */
export const CARD = "rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8";

/** The one panel on a page that says "start here" (StartHereCard). At most one per page. */
export const CARD_FEATURED = "rounded-2xl border-2 border-notice/60 bg-card p-5 shadow-sm sm:p-8";

/** A tile inside a panel (MaturityLadder's next stage, the treasury's "Coming when you finish"). */
export const TILE = "rounded-xl border border-border bg-muted p-4";

/** A quiet row: a line that can be skimmed past (QuietSection). */
export const QUIET = "rounded-xl border border-border/60 px-4 py-3";

/** The eyebrow over a heading (StartHereCard "Start here", SurfacedBanner). Gold, small, spaced capitals. */
export const EYEBROW = "text-xs font-semibold uppercase tracking-widest text-notice";

/** A page title (ProfileHero's name). The display face carries the weight; on the sheet it is never bold. */
export const H1 = "font-display text-4xl leading-tight text-foreground sm:text-5xl";

/** A section heading (Profile.tsx "About you"). */
export const H2 = "font-display text-2xl font-bold text-card-foreground";

/** The large line a featured panel leads with (StartHereCard's step). */
export const STATEMENT = "font-display text-2xl font-bold leading-snug text-card-foreground sm:text-3xl";

/** A paragraph under a heading (StartHereCard's lines). */
export const LEDE = "max-w-2xl text-base leading-relaxed text-muted-foreground";

/** Small supporting copy (QuietSection's sentence, a hint under a field). */
export const HINT = "text-sm text-muted-foreground";

/**
 * Buttons. `jw-btn` adds the journey's press, lift and focus language and a
 * 44px floor (client/src/index.css); the rest is the profile's own button.
 */
/** The one main act on a panel (StartHereCard's primary door). Gold fill, dark ink. */
export const BTN_PRIMARY =
  "jw-btn inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-notice px-5 py-2 font-semibold text-background hover:bg-notice/90 disabled:opacity-50";

/** A second act beside it (the bio Cancel, "Walk this path"). An edged button that fills softly on hover. */
export const BTN_SECONDARY =
  "jw-btn inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50";

/** A gold-edged act on a quiet row (QuietSection's action). */
export const BTN_NOTICE =
  "jw-btn inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-notice/70 px-4 py-2 text-sm font-medium text-notice hover:bg-notice/10 disabled:opacity-50";

/** A door to another page, drawn as a row (StartHereCard's "Other ways forward"). Pair with an ArrowRight. */
export const DOOR =
  "group flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-2 font-medium text-foreground hover:border-notice";

/** An inline link in running text (ProfileHero's "Walk another path"). */
export const LINK = "font-medium text-notice underline underline-offset-2 hover:text-foreground";

/** A chip that names something held (ProfileHero's path chip). */
export const CHIP = "inline-flex items-center gap-1 rounded-full bg-notice px-3 py-1 text-sm font-medium text-background";

/** A chip that names something not held, or a state (the treasury's soft labels). */
export const CHIP_SOFT = "inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground";

/** A text field or textarea (the bio editor). */
export const FIELD =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

/** A field's label. */
export const LABEL = "text-sm font-semibold text-foreground";

/** A number or icon set in a gold ring (the profile's stat tiles: paths walked, badges). */
export const RING = "inline-flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-notice text-notice";
