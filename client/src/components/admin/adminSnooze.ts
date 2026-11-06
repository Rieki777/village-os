/**
 * Hide a request until tomorrow or next week, on this device only.
 *
 * Snooze does not delete anything and does not tell the server.
 */
import { storedText, writeStored } from "@/lib/safeStorage";

const KEY = "admin.snooze";

export function tomorrow(now = new Date()): Date {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(8, 0, 0, 0);
  return next;
}

export function nextWeek(now = new Date()): Date {
  const next = new Date(now);
  next.setDate(next.getDate() + 7);
  next.setHours(8, 0, 0, 0);
  return next;
}

function readMap(): Record<string, string> {
  const raw = storedText("local", KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function snoozeUntil(id: string, until: Date): void {
  const map = readMap();
  map[id] = until.toISOString();
  writeStored("local", KEY, JSON.stringify(map));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("admin:snooze"));
}

export function isSnoozed(id: string, now = new Date()): boolean {
  const until = readMap()[id];
  if (!until) return false;
  const time = Date.parse(until);
  return Number.isFinite(time) && time > now.getTime();
}
