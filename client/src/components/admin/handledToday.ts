/**
 * How many items this device has handled today.
 *
 * The server does not record when a status changed, so the count lives here
 * and nowhere else. It is never added to a request. At local midnight the
 * stored day no longer matches and the count reads as zero.
 */
import { storedText, writeStored } from "@/lib/safeStorage";

export const HANDLED_TODAY_KEY = "admin.handledToday";

/** Fired after Remove, Redirect or Done so the header can count it. */
export const HANDLED_EVENT = "admin:handled";

export function localDayKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function readHandledCount(now: Date): number {
  const raw = storedText("local", HANDLED_TODAY_KEY);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { day?: unknown; count?: unknown };
    if (parsed.day !== localDayKey(now)) return 0;
    const n = parsed.count;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  } catch {
    return 0;
  }
}

/** Count one handled item and return the new total for today. */
export function noteHandled(now: Date = new Date()): number {
  const next = readHandledCount(now) + 1;
  writeStored("local", HANDLED_TODAY_KEY, JSON.stringify({ day: localDayKey(now), count: next }));
  return next;
}

/** Tell the header, and any open admin view, that one item was handled. */
export function announceHandled(): number {
  const next = noteHandled(new Date());
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(HANDLED_EVENT));
  return next;
}
