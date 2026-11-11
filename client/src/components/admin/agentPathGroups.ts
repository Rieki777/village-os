/**
 * The agent paths as a tree, for Admin, Players, Agents (AgentsPanel.tsx).
 *
 * The lead, 11 Nov 2026: "change that admin page to tree those 72+ paths so it's easier to understand and see and
 * not a massive list." The area a path belongs to is read off the path itself, so a path pasted or typed in lands
 * in its area without anybody keeping a second list. Pure, so the grouping and the search are tested without a
 * browser.
 */

export const PATH_GROUPS = [
  "pages",
  "faqs",
  "circles",
  "roles",
  "seasons",
  "onboarding",
  "map",
  "events",
  "quests",
  "connector",
  "other",
] as const;
export type PathGroup = (typeof PATH_GROUPS)[number];

/** First match wins, so the narrower areas come before the wider ones (circles before the org chart). */
const RULES: ReadonlyArray<[PathGroup, RegExp]> = [
  ["pages", /^\/api\/(admin\/(content|brochure-pages|village-paths|archetypes|confidentiality)|confidentiality)(\/|$)/],
  ["faqs", /^\/api\/admin\/faqs(\/|$)/],
  ["circles", /^\/api\/(admin\/circles|org\/circles)(\/|$)/],
  ["roles", /^\/api\/(admin\/org|org)(\/|$)|^\/api\/admin\/variables\/org\./],
  ["seasons", /^\/api\/(admin\/seasons|moon-review)(\/|$)/],
  ["onboarding", /^\/api\/admin\/onboarding-path(\/|$)/],
  ["map", /^\/api\/(admin\/map|map)(\/|$)/],
  ["events", /^\/api\/admin\/events(\/|$)/],
  ["quests", /^\/api\/admin\/quests(\/|$)/],
  ["connector", /^\/api\/admin\/(variables|settings|brand|launch|assistant|member-tasks|agent)/],
];

/** The area a path belongs to. */
export function pathGroup(path: string): PathGroup {
  const p = String(path ?? "").trim();
  for (const [group, test] of RULES) if (test.test(p)) return group;
  return "other";
}

export interface TreeEntry {
  method: string;
  path: string;
  confirm: "agent" | "person";
  label: string;
}

export interface TreeGroup<E extends TreeEntry> {
  group: PathGroup | "new";
  /** Each entry with its index in the list as saved, so an edit reaches the right row. */
  items: Array<{ entry: E; index: number }>;
  reads: number;
  writes: number;
  /** Writes a person confirms in the app. */
  byPerson: number;
}

/** Whether an entry matches the search words: every word in its method, path, label, area or who confirms. */
export function entryMatches(e: TreeEntry, query: string, groupWords = ""): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${e.method} ${e.path} ${e.label} ${groupWords} ${e.confirm === "person" ? "person" : "agent"}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * The list grouped by area, in PATH_GROUPS order, each group sorted by path then method, empty groups left out.
 * Entries whose index is in `fresh` (added on this screen and not saved yet) sit in their own "new" group at the
 * top, so a path being typed does not jump between areas under the cursor.
 */
export function groupAgentPaths<E extends TreeEntry>(
  entries: readonly E[],
  opts: { query?: string; fresh?: ReadonlySet<number>; groupWords?: (g: PathGroup) => string } = {},
): TreeGroup<E>[] {
  const buckets = new Map<PathGroup | "new", Array<{ entry: E; index: number }>>();
  entries.forEach((entry, index) => {
    const g: PathGroup | "new" = opts.fresh?.has(index) ? "new" : pathGroup(entry.path);
    const words = g === "new" ? "" : opts.groupWords?.(g) ?? g;
    if (g !== "new" && !entryMatches(entry, opts.query ?? "", words)) return;
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push({ entry, index });
  });
  const order: Array<PathGroup | "new"> = ["new", ...PATH_GROUPS];
  return order
    .filter((g) => buckets.has(g))
    .map((g) => {
      const items = buckets.get(g)!;
      if (g !== "new") items.sort((a, b) => a.entry.path.localeCompare(b.entry.path) || a.entry.method.localeCompare(b.entry.method));
      const reads = items.filter((i) => i.entry.method === "GET").length;
      return {
        group: g,
        items,
        reads,
        writes: items.length - reads,
        byPerson: items.filter((i) => i.entry.method !== "GET" && i.entry.confirm === "person").length,
      };
    });
}
