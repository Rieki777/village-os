/**
 * "SHOW ONLY WHAT MATCHES MY ROOTS" (build list 10.3), for any list of work.
 *
 * The quests list uses it, and the roles list imports it: one rule for both.
 *   - A person's roots are the archetypes they play on their profile's
 *     characters page (`GET /api/me/characters`, the party).
 *   - The filter is ON by default once they have picked, and one press turns
 *     it off. That choice is remembered in this browser only: it is a
 *     per-viewer convenience, and a page that cannot read storage still works,
 *     with the filter on.
 *   - Signed out, or with no roots picked, there is nothing to filter by and
 *     the list shows everything.
 *   - It hides only work tagged with NONE of the person's roots. Work not
 *     tagged yet always shows, so a village that has tagged a few quests
 *     never sees most of its board vanish (coordinator, 11 Nov 2026).
 *
 * The matching itself is `filterByRoots` in shared/archetypeRoots.ts, so the
 * rule a test pins is the rule both lists run.
 */
import { useCallback, useEffect, useState } from "react";
import { filterByRoots, rootsFilterOn, rootsFrom, type RootsFiltered } from "@shared/archetypeRoots";
import { authToken } from "@/lib/gameApi";

/** The browser key for "this person turned the filter off". */
export const ROOTS_FILTER_OFF_KEY = "village.rootsFilter.off";

function readOff(): boolean {
  try {
    return window.localStorage.getItem(ROOTS_FILTER_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOff(off: boolean): void {
  try {
    if (off) window.localStorage.setItem(ROOTS_FILTER_OFF_KEY, "1");
    else window.localStorage.removeItem(ROOTS_FILTER_OFF_KEY);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

/** The signed-in person's roots, or [] when signed out or none are picked. `null` while loading. */
export function useMyRoots(userId: string | number | null | undefined): string[] | null {
  const [mine, setMine] = useState<string[] | null>(userId ? null : []);
  useEffect(() => {
    if (!userId) {
      setMine([]);
      return;
    }
    let live = true;
    const token = authToken();
    fetch("/api/me/characters", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        const party: unknown[] = Array.isArray(d?.party) ? d.party : [];
        setMine(rootsFrom(party.map((c: any) => c?.archetypeKey)));
      })
      // A failed read filters nothing: hiding work because a request dropped would be a claim about the person.
      .catch(() => live && setMine([]));
    return () => {
      live = false;
    };
  }, [userId]);
  return mine;
}

export interface RootsFilter {
  /** The person's roots; empty when there are none (or they are still loading). */
  mine: string[];
  /** Whether the filter is biting right now. */
  on: boolean;
  /** Whether there is anything to filter by: the toggle shows only then. */
  available: boolean;
  setOn: (on: boolean) => void;
  /** Narrow a list. Keeps its order. */
  apply: <T>(items: readonly T[], rootsOf: (item: T) => readonly string[] | null | undefined) => RootsFiltered<T>;
}

/** The whole filter for one list: the roots, the toggle, and the narrowing. */
export function useRootsFilter(userId: string | number | null | undefined): RootsFilter {
  const loaded = useMyRoots(userId);
  const mine = loaded ?? [];
  const [off, setOff] = useState<boolean>(() => readOff());
  const on = rootsFilterOn(mine, off);
  const setOn = useCallback((next: boolean) => {
    setOff(!next);
    writeOff(!next);
  }, []);
  const apply = useCallback(
    <T,>(items: readonly T[], rootsOf: (item: T) => readonly string[] | null | undefined) => filterByRoots(items, rootsOf, mine, on),
    // `mine` is a fresh array per render while loading; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mine.join(","), on],
  );
  return { mine, on, available: mine.length > 0, setOn, apply };
}
