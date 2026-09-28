/**
 * TWENTY EVENTS, FIVE SECTIONS, AND A BURST THAT READS AS ONE LINE.
 *
 * The bell used to render `items.slice(0, 15)` straight down the page, so a
 * quiet week and a loud one looked the same and a member who was thanked
 * eleven times scrolled past eleven near-identical lines to find the ballot
 * underneath them.
 *
 * Three decisions, all of them arithmetic, all of them here where a test can
 * hold them:
 *
 *  1. GROUPING. Every type declares which part of village life it belongs to
 *     (shared/notificationKinds.ts). Groups carrying something unread come
 *     first, and inside that split the declared order is kept, so the sections
 *     sit where a member learned they sit.
 *
 *  2. BATCHING AT FOUR. Android auto-bundles at four or more notifications
 *     from one app without a group key, and four is the only number for this
 *     that any platform actually documents
 *     (docs/NOTIFICATION_RESEARCH.md part 1 section 2). Below four, the lines
 *     are worth reading one at a time.
 *
 *  3. READ AND UNREAD NEVER BATCH TOGETHER. The batch key carries the read
 *     state, so a fresh thank-you can never vanish into a settled pile of
 *     eleven older ones. This is the whole reason the batch key is not just
 *     the type.
 *
 * A batched row is a DISCLOSURE and never a link. Four library notices point
 * at four different items, so sending the batched line to the newest one would
 * be a small lie told four times. It opens instead, and the rows inside it are
 * the links.
 */
import { NOTIFICATION_GROUPS, kindOf, manyLine, wordsInAppOnly, type NotificationGroupId } from "@shared/notificationKinds";

export interface FeedItem {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  isRead: boolean;
  at: string;
}

export interface FeedRow {
  /** Stable across polls: the newest member's id, or the batch key. */
  key: string;
  /** Every notification this row stands for, newest first. */
  items: FeedItem[];
  type: string;
  /** The line a member reads. The batched line when this stands for many. */
  title: string;
  /** The row's own second line, or the kind's blurb when it carries none. */
  detail: string | null;
  /**
   * Show the second line whole, never cut to two lines. True for a kind whose
   * words are read in the app alone (a restorative intake): its email leaves
   * the words out, so this row is the one place its recipient reads them.
   */
  whole: boolean;
  /** Null on a batched row: it opens instead of navigating. */
  link: string | null;
  unread: number;
  at: string;
  batched: boolean;
}

export interface FeedGroup {
  id: NotificationGroupId;
  title: string;
  blurb: string;
  rows: FeedRow[];
  unread: number;
}

/** Four or more of one kind collapse into one line. Android's own threshold. */
export const BATCH_AT = 4;

const newestFirst = (a: FeedItem, b: FeedItem) =>
  Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : -1);

/**
 * The rows of one group, batched. Exported for the test, and because the
 * batching rule is the part most likely to be argued with later.
 */
export function batchRows(items: FeedItem[]): FeedRow[] {
  const buckets = new Map<string, FeedItem[]>();
  for (const it of items) {
    // Read state is IN the key on purpose: see the header.
    const key = `${it.type}:${it.isRead ? "read" : "new"}`;
    const list = buckets.get(key) ?? [];
    list.push(it);
    buckets.set(key, list);
  }

  const rows: FeedRow[] = [];
  for (const [key, list] of Array.from(buckets.entries())) {
    list.sort(newestFirst);
    // A kind read in the app alone never batches: a batched row shows titles
    // only, every restorative intake carries the same title, and the words
    // are nowhere else (shared/notificationKinds.ts, `wordsInAppOnly`).
    if (list.length >= BATCH_AT && !wordsInAppOnly(list[0].type)) {
      rows.push({
        key,
        items: list,
        type: list[0].type,
        title: manyLine(list[0].type, list.length),
        detail: kindOf(list[0].type).blurb,
        whole: false,
        link: null,
        unread: list.filter((i) => !i.isRead).length,
        at: list[0].at,
        batched: true,
      });
      continue;
    }
    for (const it of list) {
      rows.push({
        key: it.id,
        items: [it],
        type: it.type,
        title: it.title,
        // The kind's blurb fills in only where the row carries no body, which
        // is where a reader most needs to be told why the line matters.
        detail: it.body ? String(it.body) : kindOf(it.type).blurb,
        whole: wordsInAppOnly(it.type),
        link: it.link ?? null,
        unread: it.isRead ? 0 : 1,
        at: it.at,
        batched: false,
      });
    }
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.key < b.key ? 1 : -1));
}

/**
 * The whole panel: grouped, batched, and ordered so anything unread is at the
 * top without the sections themselves shuffling around under a reader's hand.
 */
export function buildFeed(items: FeedItem[]): FeedGroup[] {
  const byGroup = new Map<NotificationGroupId, FeedItem[]>();
  for (const it of items) {
    const g = kindOf(it.type).group;
    const list = byGroup.get(g) ?? [];
    list.push(it);
    byGroup.set(g, list);
  }

  const groups: FeedGroup[] = [];
  for (const def of NOTIFICATION_GROUPS) {
    const list = byGroup.get(def.id);
    if (!list?.length) continue;
    const rows = batchRows(list);
    groups.push({
      id: def.id,
      title: def.title,
      blurb: def.blurb,
      rows,
      unread: rows.reduce((n, r) => n + r.unread, 0),
    });
  }

  // Unread first, declared order preserved inside each half.
  return [...groups.filter((g) => g.unread > 0), ...groups.filter((g) => g.unread === 0)];
}

/** Every unread id a row stands for. What clicking it should actually mark. */
export function unreadIdsOf(row: FeedRow): string[] {
  return row.items.filter((i) => !i.isRead).map((i) => i.id);
}
