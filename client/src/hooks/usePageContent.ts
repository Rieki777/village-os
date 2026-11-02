import { useEffect, useMemo, useState } from "react";
import { readVillageSection } from "@/hooks/useVillageContent";
import { useGameConfig } from "@/lib/gameApi";
import { storyPageOffAlone } from "@/lib/brochure";
import { pageSectionKey, type PageSpec, type PageVars, type ResolvedItem, type ResolvedPage } from "@shared/pageContent/types";
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
/**
 * The page with every link box that points at a story page this village
 * switched off left blank (shared/brochure.ts). Every link box in a spec is
 * optional, and a blank one draws no button, so a page switched off in Admin,
 * Pages takes the buttons that lead to it away with it, wherever they are.
 *
 * Only the pages switched off one by one count here: every page that reads its
 * words through this hook is itself a story page, and renders only while the
 * master switch is on.
 */
export function withoutLinksToHiddenPages(spec: PageSpec, page: ResolvedPage, shown: (href: string) => boolean): ResolvedPage {
  const out: Record<string, ResolvedPage[string]> = {};
  for (const section of spec.sections) {
    const resolved = page[section.id];
    if (!resolved) continue;
    const fields: Record<string, string> = { ...resolved.fields };
    for (const f of section.fields) if (f.kind === "link" && !shown(fields[f.key] ?? "")) fields[f.key] = "";
    const lists: Record<string, ReadonlyArray<ResolvedItem>> = { ...resolved.lists };
    for (const list of section.lists ?? []) {
      const links = list.fields.filter((f) => f.kind === "link");
      if (!links.length || !lists[list.key]) continue;
      lists[list.key] = lists[list.key].map((row) => {
        const next: Record<string, string> = { ...row };
        for (const f of links) if (!shown(next[f.key] ?? "")) next[f.key] = "";
        return next as ResolvedItem;
      });
    }
    out[section.id] = { hidden: resolved.hidden, fields, lists };
  }
  return { ...page, ...out };
}

export function usePageContent(spec: PageSpec): ResolvedPage | null {
  const config = useGameConfig();
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
  return useMemo(
    () => (vars && stored ? withoutLinksToHiddenPages(spec, resolvePage(spec, stored.doc, vars), (href) => !storyPageOffAlone(config, href)) : null),
    [spec, stored, vars, config],
  );
}
