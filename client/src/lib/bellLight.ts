/**
 * FIREFLIES ARRIVING: what the bell shows instead of a number (Phase B, B2).
 *
 * The number badge is gone from the screen. A count in amber on the corner of
 * every page is a small alarm that rings until it is cleared, and the lead's
 * rule for this phase is that nothing nags. So the bell has three looks, and
 * each one means one thing:
 *
 *   - "lit":  a few fireflies rest on the bell. Something unread waits on you
 *             (a kind marked `waits` in shared/notificationKinds.ts). This is
 *             the sitewide grammar: fireflies mean "something here waits on
 *             you", and the bell is one of the few places they may go.
 *   - "dot":  a still dot, no glow. Only news arrived since you last opened
 *             the panel. Opening the panel quiets it, as it quieted the badge.
 *   - "none": nothing new and nothing waiting.
 *
 * The count does not go away, it moves: the bell's spoken name carries every
 * number a sighted member used to read off the badge, and the panel still
 * lists each notice. Pure functions, so the rules are held by tests.
 */
import { waitsOnYou } from "@shared/notificationKinds";
import type { FeedItem } from "@/lib/notificationFeed";

export type BellLook = "lit" | "dot" | "none";

export interface BellCounts {
  unread: number;
  unseen: number;
  items: FeedItem[];
}

/** Ids of unread notices that ask something of their reader. */
export function waitingIds(items: FeedItem[]): string[] {
  return items.filter((i) => !i.isRead && waitsOnYou(i.type)).map((i) => i.id);
}

/**
 * How many unread notices wait on the reader. Zero whenever the server says
 * nothing is unread, so a list that is a poll old (another tab read them all)
 * can never keep the light on by itself.
 */
export function waitingCount({ unread, items }: Pick<BellCounts, "unread" | "items">): number {
  return Math.max(0, Math.min(unread, waitingIds(items).length));
}

export function bellLook(c: BellCounts): BellLook {
  if (waitingCount(c) > 0) return "lit";
  if (c.unseen > 0) return "dot";
  return "none";
}

/**
 * The bell's spoken name. Every count is said in a whole phrase, never a bare
 * number (WCAG SC 4.1.3's own worked example), so a screen reader hears what
 * the badge used to show and what the light now means.
 */
export function bellLabel(c: BellCounts): string {
  const parts = ["Notifications"];
  const waiting = waitingCount(c);
  if (waiting > 0) parts.push(`${waiting} ${waiting === 1 ? "waits" : "wait"} on you`);
  if (c.unseen > 0) parts.push(`${c.unseen} new`);
  else parts.push("nothing new");
  if (c.unseen === 0 && c.unread > 0) parts.push(`${c.unread} still unread`);
  return parts.join(", ");
}

/**
 * Waiting notices that were not in the last list this page saw. The bell
 * plays one arrival for these, once. `before` null means the page has not
 * seen a list yet, and the first list is seeded in silence: signing in must
 * not fly in a firefly for something that waited since last Tuesday.
 */
export function newlyWaiting(before: ReadonlySet<string> | null, items: FeedItem[]): string[] {
  if (before === null) return [];
  return waitingIds(items).filter((id) => !before.has(id));
}
