import { useEffect, useMemo, useState } from "react";
import { readVillageSection } from "@/hooks/useVillageContent";
import { usePageVars } from "@/hooks/usePageContent";
import { fillVars } from "@shared/pageContent/resolve";
import { pageSectionKey, type PageVars, type ResolvedPage } from "@shared/pageContent/types";
import { GOOD_NEIGHBOR_PAGE_ID, goodNeighborNameFrom } from "@shared/pageContent/goodNeighborName";

/**
 * What this village calls its Good Neighbor criteria, for a page OTHER than
 * the Good Neighbor page: the headline field saved there, `{words}` filled,
 * or the default. Null until it has been read, so a page waiting on it never
 * paints the default name and then swaps in the village's own.
 */
export function useGoodNeighborName(): string | null {
  const vars = usePageVars();
  const [raw, setRaw] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    readVillageSection(pageSectionKey({ id: GOOD_NEIGHBOR_PAGE_ID })).then((doc) => {
      if (alive) setRaw(goodNeighborNameFrom(doc));
    });
    return () => {
      alive = false;
    };
  }, []);
  return useMemo(() => (raw !== null && vars ? fillVars(raw, vars) : null), [raw, vars]);
}

/**
 * A resolved page with more `{words}` filled in: the ones that come from
 * another field rather than from the village's settings (`{good-neighbor}`).
 * A word with no value stays visible as typed, the same rule as `fillVars`.
 */
export function fillPageWords(page: ResolvedPage, words: PageVars): ResolvedPage {
  const out: Record<string, ResolvedPage[string]> = {};
  for (const [id, section] of Object.entries(page)) {
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(section.fields)) fields[k] = fillVars(v, words);
    const lists: Record<string, Array<Record<string, string>>> = {};
    for (const [k, rows] of Object.entries(section.lists)) {
      lists[k] = rows.map((row) => {
        const item: Record<string, string> = {};
        for (const [fk, fv] of Object.entries(row)) item[fk] = fk === "id" ? fv : fillVars(fv, words);
        return item;
      });
    }
    out[id] = { hidden: section.hidden, fields, lists };
  }
  return out;
}
