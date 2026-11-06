/**
 * Switches that live on this device: a simpler nav, a tour, gentle quests,
 * the all-clear line, and the weekly recap. There is no quiet-hours switch.
 */
import { storedText, writeStored } from "@/lib/safeStorage";
import type { NavGroup } from "./adminNavGroups";

export type FeelKey = "tour" | "quests" | "clear" | "recap";

const KEY: Record<FeelKey, string> = {
  tour: "admin.feel.tour",
  quests: "admin.feel.quests",
  clear: "admin.feel.clear",
  recap: "admin.feel.recap",
};

export function feelOn(key: FeelKey): boolean {
  return storedText("local", KEY[key]) !== "0";
}

export function setFeel(key: FeelKey, on: boolean): void {
  writeStored("local", KEY[key], on ? "1" : "0");
}

/** Admins see every tab. A steward starts on Today and Inbox until they ask for the rest. */
export function simpleNav(role: string | undefined): boolean {
  if (role === "admin" || role === "founder") return false;
  return storedText("local", "admin.feel.everything") !== "1";
}

export function showEverything(): void {
  writeStored("local", "admin.feel.everything", "1");
}

export function limitNav(groups: NavGroup[], simple: boolean): NavGroup[] {
  if (!simple) return groups;
  const keep = new Set(["home", "submissions", "feedback"]);
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => keep.has(item.key)) }))
    .filter((group) => group.items.length > 0);
}

export const TOUR_STEPS = [
  "This is Today. Start here each visit.",
  "The inbox holds requests, notes, and Sera tasks.",
  "Connections shows what is working.",
  "What is this? explains the page you have open.",
  "You are set. Nothing you saw here changed anything.",
];

export function weekKey(now = new Date()): string {
  const start = new Date(now);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
}

export function bumpWeek(now = new Date()): number {
  const key = "admin.weekCount";
  const week = weekKey(now);
  let count = 1;
  try {
    const parsed = JSON.parse(storedText("local", key) || "null") as { week?: string; count?: number } | null;
    if (parsed?.week === week && typeof parsed.count === "number") count = parsed.count + 1;
  } catch { /* start the week over */ }
  writeStored("local", key, JSON.stringify({ week, count }));
  return count;
}

export function weekCount(now = new Date()): number {
  try {
    const parsed = JSON.parse(storedText("local", "admin.weekCount") || "null") as { week?: string; count?: number } | null;
    if (parsed?.week === weekKey(now) && typeof parsed.count === "number") return parsed.count;
  } catch { /* no recap yet */ }
  return 0;
}
