/**
 * The Journal's shared class strings, so every control on its four tabs is
 * one size and one shape. Every control is at least 44px tall, the phone's
 * thumb target.
 *
 * ON ANY GROUND (batch 158, the lead's screenshot of Profile, Your journal):
 * these once said "light surfaces only" and set brand teal ink on `bg-card`.
 * The profile draws this card on the night world, where `bg-card` is dark,
 * so "Weekly pulse" and "Feedback" were dark teal on night: nearly invisible.
 * The buttons are now the journey's own (components/journey/look.ts), on
 * semantic tokens that read on the night and on linen alike. A test holds
 * every local BTN_* string to it (client/src/lib/btnGround.test.ts).
 */
import { BTN_PRIMARY as LOOK_PRIMARY, BTN_SECONDARY as LOOK_SECONDARY } from "@/components/journey/look";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** The one primary act: gold with dark ink on the night, the same token pair on linen. */
export const BTN_PRIMARY = `${LOOK_PRIMARY} ${FOCUS}`;

export const BTN_SECONDARY = `${LOOK_SECONDARY} ${FOCUS}`;

export const BTN_QUIET =
  `inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 font-medium text-foreground underline decoration-notice/60 underline-offset-2 hover:bg-muted disabled:opacity-50 ${FOCUS}`;

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
