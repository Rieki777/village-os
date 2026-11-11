/**
 * THE FIVE ARCHETYPES AS ROOTS (build list 10, second amendment, 11 Nov 2026).
 *
 * "The five archetypes are the roots, and roles are the branches." Every role,
 * quest or offering grows from one or more of the five, and a person picks the
 * roots they grow from. This file holds the rules that make that true, as data
 * and pure functions, so the server, the editors and every list read one copy:
 *
 *   - how many roots a piece of work carries (1 to 3) and a person picks (1 to 5);
 *   - the coverage table an editor tags work with;
 *   - which look each archetype wears when the five are shown together;
 *   - what "matches my roots" means, for the quests list and the roles list.
 *
 * THE KEYS ARE THE ARCHETYPE KEYS (shared/archetypes.ts), never the names. A
 * village renames a root in Admin and every tag, pick and filter keeps working.
 *
 * A ROOT IS A LENS AND NEVER A GATE. Nothing here may be read by
 * `hasCapability` or by a claim. The filter changes what a list SHOWS, it is
 * off with one press, and every piece of work stays open to every hand
 * (server/lib/characters.ts says the same about classes).
 */
import { ARCHETYPE_KEYS } from "./archetypes";

/** A role or a quest grows from one to three roots. Four would say it grows from everything. */
export const MAX_ROOTS_ON_WORK = 3;

/** A person picks one to five: one root each, at most the whole cast. */
export const MAX_ROOTS_FOR_A_PERSON = 5;

/* ------------------------------------------------------------------ */
/* Reading a list of roots                                              */
/* ------------------------------------------------------------------ */

/**
 * A root list as any layer may carry it: an array from the server, a JSON
 * string from a raw column, or nothing. Keeps strings only, trimmed, without
 * duplicates, in the order given. Junk degrades to "no roots", never a throw.
 */
export function rootsFrom(v: unknown): string[] {
  let list: unknown = v;
  if (typeof v === "string") {
    try {
      list = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const x of list) {
    if (typeof x !== "string") continue;
    const k = x.trim();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * The roots an editor sends, checked against the village's own cast.
 *
 * An unknown key silently matches nothing (shared/archetypes.ts), so it is
 * refused by name. An empty list is allowed and means "not tagged yet": the
 * work then shows under every root's "also open". More than three is refused,
 * because a piece of work that grows from four roots is telling us its tags
 * are too wide.
 */
export function rootsForWork(
  v: unknown,
  cast: readonly string[],
): { ok: true; roots: string[] } | { ok: false; error: string } {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    return { ok: false, error: "Roots arrive as a list of the village's archetype keys." };
  }
  const roots: string[] = [];
  for (const raw of v as string[]) {
    const k = raw.trim();
    if (!cast.includes(k)) return { ok: false, error: `"${k.slice(0, 40)}" is not one of this village's roots.` };
    if (!roots.includes(k)) roots.push(k);
  }
  if (roots.length > MAX_ROOTS_ON_WORK) {
    return { ok: false, error: `Pick up to ${MAX_ROOTS_ON_WORK} roots. This one names ${roots.length}.` };
  }
  return { ok: true, roots };
}

/* ------------------------------------------------------------------ */
/* Matching                                                             */
/* ------------------------------------------------------------------ */

/**
 * Does this piece of work grow from any of my roots?
 *
 * Work with no roots matches nobody's filter: "show only what matches my
 * roots" means exactly that, and the list says how many it is hiding so the
 * rest is one press away. A person with no roots matches everything, because
 * there is nothing to filter by.
 */
export function rootsMatch(workRoots: readonly string[] | null | undefined, mine: readonly string[]): boolean {
  if (!mine.length) return true;
  const roots = workRoots ?? [];
  return roots.some((k) => mine.includes(k));
}

/** What a list shows under the filter, and how many it set aside. */
export interface RootsFiltered<T> {
  shown: T[];
  hidden: number;
  /**
   * Whether anything on the list carries roots at all. A village that has
   * tagged nothing yet has nothing to filter by, so the filter stands aside
   * and the switch is not offered: a default-on filter over an untagged list
   * would show a member an empty village.
   */
  tagged: boolean;
}

/**
 * The one filter both lists use (quests here; the roles list imports it).
 *
 * `on` is the person's choice; the filter only bites when they have roots.
 * The order of the list is kept: a filter narrows, it never re-ranks.
 */
export function filterByRoots<T>(
  items: readonly T[],
  rootsOf: (item: T) => readonly string[] | null | undefined,
  mine: readonly string[],
  on: boolean,
): RootsFiltered<T> {
  const tagged = items.some((i) => (rootsOf(i) ?? []).length > 0);
  if (!on || !mine.length || !tagged) return { shown: [...items], hidden: 0, tagged };
  const shown = items.filter((i) => rootsMatch(rootsOf(i), mine));
  return { shown, hidden: items.length - shown.length, tagged };
}

/** On by default once somebody has picked, unless they turned it off. */
export function rootsFilterOn(mine: readonly string[], turnedOff: boolean): boolean {
  return mine.length > 0 && !turnedOff;
}

/* ------------------------------------------------------------------ */
/* The cast, shown together                                             */
/* ------------------------------------------------------------------ */

export type CastPresentation = "f" | "m";
export type CastTone = "deep" | "olive" | "light";

/**
 * WHICH LOOK EACH ARCHETYPE WEARS WHEN THE FIVE ARE SHOWN TOGETHER (10.6):
 * three female and two male figures, with skin tones of one Black, two brown
 * and two white. Chosen against the stock art itself (server/assets/avatars),
 * and away from the usual casting: the Builder is a Black woman and the Space
 * Holder a man. A member's own pick always wins over this on their own
 * surfaces; this is only the face a root shows before anybody chose one.
 *
 * `shared/archetypeRoots.test.ts` holds the mix, so a change that breaks it
 * fails by name.
 */
export const CAST_LOOK: Readonly<Record<string, { presentation: CastPresentation; tone: CastTone }>> = {
  building: { presentation: "f", tone: "deep" },
  researching: { presentation: "f", tone: "olive" },
  facilitating: { presentation: "m", tone: "light" },
  catalyzing: { presentation: "m", tone: "olive" },
  storytelling: { presentation: "f", tone: "light" },
};

/** A village's own sixth archetype, which has no stock art of its own yet, wears this. */
const CAST_LOOK_FALLBACK = { presentation: "f" as const, tone: "olive" as const };

export function castLookFor(key: string): { presentation: CastPresentation; tone: CastTone } {
  return CAST_LOOK[key] ?? CAST_LOOK_FALLBACK;
}

/** The stock picture a root shows in the cast: `/images/avatars/<key>-<f|m>-<tone>.webp`. */
export function castArt(key: string): string {
  const { presentation, tone } = castLookFor(key);
  return `/images/avatars/${encodeURIComponent(key)}-${presentation}-${tone}.webp`;
}

/* ------------------------------------------------------------------ */
/* The coverage table                                                   */
/* ------------------------------------------------------------------ */

/** One function every human organization needs, and the roots it grows from. */
export interface RootCoverageRow {
  /** The kind of work, in plain words. */
  work: string;
  /** Archetype keys, in the order they matter most, each with an optional note on which part. */
  roots: ReadonlyArray<{ key: string; note?: string }>;
}

/**
 * THE COVERAGE CHECK (10.5): together the five hold every role any human
 * organization fundamentally needs. An editor reads this beside the five boxes
 * to tag a role or a quest, and "Use these" sets the boxes from one row.
 *
 * Platform defaults in plain words, naming no village. Keyed by archetype key,
 * so a village that renames a root sees its own name in every row.
 */
export const ROOT_COVERAGE: readonly RootCoverageRow[] = [
  { work: "Vision and leadership", roots: [{ key: "catalyzing" }, { key: "researching" }] },
  {
    work: "Finance and accounting",
    roots: [{ key: "researching" }, { key: "catalyzing" }, { key: "building", note: "daily books" }],
  },
  { work: "Legal and compliance", roots: [{ key: "researching" }, { key: "facilitating", note: "safeguarding" }] },
  { work: "Operations and admin", roots: [{ key: "building" }] },
  { work: "Technology", roots: [{ key: "building" }, { key: "researching" }] },
  { work: "Construction and land", roots: [{ key: "building" }, { key: "researching" }] },
  {
    work: "Food and agriculture",
    roots: [{ key: "building" }, { key: "facilitating", note: "kitchen and hospitality" }],
  },
  { work: "Sales and fundraising", roots: [{ key: "catalyzing" }, { key: "storytelling" }] },
  { work: "Marketing and communications", roots: [{ key: "storytelling" }] },
  { work: "People, HR and onboarding", roots: [{ key: "facilitating" }] },
  {
    work: "Care, health and education",
    roots: [{ key: "facilitating" }, { key: "storytelling", note: "teaching" }],
  },
  { work: "Research and strategy", roots: [{ key: "researching" }] },
  { work: "Memory and knowledge", roots: [{ key: "storytelling" }, { key: "researching" }] },
  { work: "Security and maintenance", roots: [{ key: "building" }, { key: "facilitating" }] },
];

/** The keys a coverage row sets, capped at what a piece of work may carry. */
export function rootsOfCoverage(row: RootCoverageRow): string[] {
  return row.roots.map((r) => r.key).slice(0, MAX_ROOTS_ON_WORK);
}

/** The seeded keys, re-exported so a test can assert the table names only real roots. */
export const SEEDED_ROOT_KEYS: readonly string[] = ARCHETYPE_KEYS;

/** "The Builder" reads "Builder" on a small tag; a village's own name without "The" is left alone. */
export function shortRootName(name: string): string {
  return name.replace(/^The\s+/i, "");
}
