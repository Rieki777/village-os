/**
 * The Journal's shared class strings, so every control on its four tabs is
 * one size and one shape. Light surfaces only, on the semantic tokens, so a
 * village's own colours reach every one of them (index.css, brandTokens.ts).
 * Every control is at least 44px tall, the phone's thumb target.
 */

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2";

/** White on the brand tone; hover steps to the derived hover tone, never a fade. */
export const BTN_PRIMARY =
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal-deep px-5 py-2.5 font-semibold text-white hover:bg-teal-deep-dark disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS}`;

export const BTN_SECONDARY =
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-teal-deep bg-card px-4 py-2 font-semibold text-teal-deep hover:bg-teal-deep/5 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS}`;

export const BTN_QUIET =
  `inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 font-medium text-teal-deep underline underline-offset-2 hover:bg-teal-deep/5 disabled:opacity-50 ${FOCUS}`;

export const CARD = "rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm";

export const INPUT =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring";

export const LABEL = "block text-sm font-semibold text-foreground";

export const HINT = "text-sm text-muted-foreground";

/** "Monday 6 October", in the reader's own locale and zone. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/** "07:42", in the reader's own locale and zone. */
export function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** A local calendar day key, so entries group by the reader's own midnight. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A pulse score as a person reads it: the centred scale carries its sign. */
export function signed(value: number, centred: boolean): string {
  const v = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return centred && value > 0 ? `+${v}` : v;
}

/** "Confidence" from "confidence": a metric's short name. */
export function metricName(key: string): string {
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : key;
}
