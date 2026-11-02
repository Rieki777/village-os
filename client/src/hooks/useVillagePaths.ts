import { useEffect, useMemo, useState } from "react";
import { fetchConfigCached, useGameConfig, type PublicGameConfig } from "@/lib/gameApi";
import { pageVarsFrom } from "@shared/pageContent/vars";
import { DEFAULT_LADDER_TITLE, defaultVillagePathWords, servedPaths, type ServedPath } from "@shared/villagePaths";

/**
 * The paths this village offers, in its own words (Admin, Make it yours,
 * Paths & Stages), as `/api/game/config` serves them: the fixed id and page,
 * the village's name, second line and sentence, every `{word}` filled.
 *
 * NULL WHILE THE CONFIG IS ON ITS WAY, so the join form never shows the
 * platform's four names and then swaps in the village's own a moment later.
 *
 * TODAY'S WORDS WHEN THE CONFIG CANNOT BE HAD. Choosing a path is required to
 * join, so a config that failed to load must not leave the form with nothing
 * to choose. The ids are the same either way; only the words would be the
 * platform's until the next load. An older server that serves no sentences
 * keeps its names, and the sentence comes from today's words.
 */
export function useVillagePaths(): ServedPath[] | null {
  const [answer, setAnswer] = useState<{ config: PublicGameConfig | null } | null>(null);
  useEffect(() => {
    let alive = true;
    fetchConfigCached().then((config) => {
      if (alive) setAnswer({ config });
    });
    return () => {
      alive = false;
    };
  }, []);
  return useMemo(() => {
    if (!answer) return null;
    const config = answer.config;
    const fallback = servedPaths(defaultVillagePathWords(), pageVarsFrom(config ?? {}));
    const served = Array.isArray(config?.paths) ? config.paths : [];
    if (served.length === 0) return fallback;
    return served.map((p) => ({
      id: p.id,
      label: p.label,
      role: p.role ?? "",
      description: typeof p.description === "string" ? p.description : (fallback.find((f) => f.id === p.id)?.description ?? ""),
      route: p.route,
    }));
  }, [answer]);
}

/**
 * The stage ladder's name in this village's words ("Path of Growth" until a
 * village names it). The platform's name covers only the paint before the
 * config lands, and a server too old to serve one.
 */
export function useLadderTitle(): string {
  const config = useGameConfig();
  return String(config?.ladder?.title ?? "").trim() || DEFAULT_LADDER_TITLE;
}
