/**
 * Gene Keys class strings. Every surface here wears the profile's night world
 * (`sheet-night`, client/src/index.css), so the colours are the semantic
 * tokens it redeclares: `bg-card`, `bg-muted`, `border-border`,
 * `text-muted-foreground`, and `notice` for gold, what the sheet marks as
 * earned and important. No literal colour appears in this folder.
 * Every control is at least 44px tall.
 */
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The sheet's gold call to action, the shape PlayerRoleCard uses. */
export const BTN_GOLD = `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-notice/40 bg-notice/15 px-4 text-sm font-semibold text-notice hover:bg-notice/25 disabled:opacity-60 ${FOCUS}`;

export const BTN_PLAIN = `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60 ${FOCUS}`;

export const BTN_LINK = `inline-flex min-h-11 items-center font-medium text-notice underline underline-offset-2 ${FOCUS}`;

export const NIGHT_CARD = "sheet-night rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm";

export const TILE = "flex flex-col gap-0.5 rounded-xl border border-border bg-muted p-3";

export const EYEBROW = "text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground";

export const INPUT = `min-h-11 w-full rounded-lg border border-border bg-muted px-3 text-base text-foreground [color-scheme:dark] ${FOCUS}`;

export const HINT = "text-sm text-muted-foreground";
