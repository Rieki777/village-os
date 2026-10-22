import { useEffect, useMemo, useState } from "react";
import { readVillageSection } from "@/hooks/useVillageContent";
import { useGameConfig } from "@/lib/gameApi";
import { pageSectionKey, type PageSpec, type PageVars, type ResolvedPage } from "@shared/pageContent/types";
import { resolvePage } from "@shared/pageContent/resolve";

/**
 * The `{words}` a page field may use, from the village's own settings.
 *
 * Every one of these was a setting a founder could already change that the
 * brochure pages never read: the audit of 2026-10-22 found "Love Letter" typed
 * twenty times beside a commitment name nobody used, and a member name that
 * was required in setup and shown nowhere.
 */
export function usePageVars(): PageVars | null {
  const config = useGameConfig();
  return useMemo(() => {
    if (!config) return null;
    const word = (typed: unknown, fallback: string) => String(typed ?? "").trim() || fallback;
    const { project, currency } = config;
    const location = word(project?.location, "");
    const village = word(project?.name, "the village");
    return {
      village,
      // Never blank: the Home headline is `{tagline}` by default, and a
      // village that cleared its Tagline still needs a headline.
      tagline: word(project?.tagline, `Welcome to ${village}`),
      location,
      "in-location": location ? ` in ${location}` : "",
      member: word(project?.memberName, "member"),
      commitment: word(project?.commitmentName, "membership agreement"),
      role: word(project?.roleName, "role"),
      catalyst: word(project?.catalystName, "steward"),
      token: word(currency?.name, "recognition"),
      value: word(currency?.value?.name, "village tokens"),
    };
  }, [config]);
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
