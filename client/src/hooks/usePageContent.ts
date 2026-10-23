import { useEffect, useMemo, useState } from "react";
import { readVillageSection } from "@/hooks/useVillageContent";
import { useGameConfig } from "@/lib/gameApi";
import { pageSectionKey, type PageSpec, type PageVars, type ResolvedPage } from "@shared/pageContent/types";
import { resolvePage } from "@shared/pageContent/resolve";
import { pageVarsFrom } from "@shared/pageContent/vars";

/**
 * The `{words}` a page field may use, from the village's own settings. The
 * rules live in shared/pageContent/vars.ts, because the server fills the same
 * words into the Work With Us acknowledgement email.
 */
export function usePageVars(): PageVars | null {
  const config = useGameConfig();
  return useMemo(() => (config ? pageVarsFrom(config) : null), [config]);
}

/**
 * One page's words, resolved: what the village saved, its defaults for
 * everything else, `{words}` filled in. Null until both the config and the
 * saved section have answered, so a page never paints the defaults and then
 * swaps in the village's own words a moment later.
 */
export function usePageContent(spec: PageSpec): ResolvedPage | null {
  const vars = usePageVars();
  const [stored, setStored] = useState<{ doc: unknown } | null>(null);
  useEffect(() => {
    let alive = true;
    readVillageSection(pageSectionKey(spec)).then((doc) => {
      if (alive) setStored({ doc });
    });
    return () => {
      alive = false;
    };
  }, [spec]);
  return useMemo(() => (vars && stored ? resolvePage(spec, stored.doc, vars) : null), [spec, stored, vars]);
}
