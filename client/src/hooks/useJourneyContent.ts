import { useCallback, useEffect, useMemo, useState } from "react";
import { usePageContent } from "@/hooks/usePageContent";
import { readStoredJson, writeStoredJson } from "@/lib/safeStorage";
import { countWord, withPageWords } from "@/lib/journeyPage";
import type { PageSpec, PageVars, ResolvedItem, ResolvedPage } from "@shared/pageContent/types";

/**
 * A journey page's words: the village's own, its defaults, `{words}` filled,
 * then the words only this page knows. `{count}` is always one of them, so
 * "Follow these {count} steps" follows the list instead of saying seven.
 * Null until the saved words have arrived, like `usePageContent`.
 */
export function useJourneyContent(spec: PageSpec, pageWords: (page: ResolvedPage) => PageVars = () => ({})): ResolvedPage | null {
  const page = usePageContent(spec);
  const words = page ? { count: countWord(page.steps?.lists.items?.length ?? 0), ...pageWords(page) } : null;
  const key = words ? JSON.stringify(words) : "";
  // `words` is rebuilt every render; its contents are what matter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (page && words ? withPageWords(page, words) : null), [page, key]);
}

/**
 * Which steps this visitor has ticked, kept in their own browser.
 *
 * A step is known by its title. Before 2026-10-22 each page saved ticks under
 * a fixed id per step; those are read once by position (`legacyIds`) so a
 * returning visitor keeps their progress on a page the village has not
 * rewritten.
 */
export function useJourneyProgress(storageKey: string, steps: readonly ResolvedItem[] | null, legacyIds: readonly string[]) {
  const [done, setDone] = useState<string[]>([]);
  const ready = steps !== null;
  useEffect(() => {
    if (!steps) return;
    // A blocked store or a half-written value reads as no progress, which
    // costs a visitor their ticks and never the page.
    const saved = readStoredJson("local", storageKey);
    if (saved.status === "value" && Array.isArray(saved.value)) {
      const values = saved.value.filter((v): v is string => typeof v === "string");
      setDone(
        values.map((v) => {
          const at = legacyIds.indexOf(v);
          return at >= 0 && steps[at] ? steps[at].title : v;
        }),
      );
    }
    // Read once, when the steps first arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, ready]);

  const isDone = useCallback((step: ResolvedItem) => done.includes(step.title), [done]);
  const toggle = useCallback(
    (step: ResolvedItem) => {
      const next = done.includes(step.title) ? done.filter((t) => t !== step.title) : [...done, step.title];
      setDone(next);
      writeStoredJson("local", storageKey, next);
    },
    [done, storageKey],
  );
  const total = steps?.length ?? 0;
  const doneCount = steps ? steps.filter((s) => done.includes(s.title)).length : 0;
  return { isDone, toggle, doneCount, total, progress: total ? (doneCount / total) * 100 : 0 };
}
