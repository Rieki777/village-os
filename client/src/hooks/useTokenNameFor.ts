import { useGameConfig } from "@/lib/gameApi";

/**
 * What this village calls ONE token, by its slug, for prose (readiness R084).
 *
 * The sibling of `useTokenName` and `useValueTokenName` in
 * `client/src/hooks/useTokenNames.ts`, which name the two tokens every village
 * has. This one names the rest: stay credits, library credits, whatever a
 * module brings. A founder renames each in Admin then Tokens, and before this
 * the member pages kept saying "stay credits" and "library credits" whatever
 * the registry said, because nothing served them the name.
 *
 * `GET /api/game/config` serves `currency.names`, every registry token's name
 * by slug, read live on each request. The slug is history's identity and never
 * changes, so it is the right key and the wrong thing to show.
 *
 * THE FALLBACK IS FOR THE LOADING WINDOW, the rule `useTokenName` explains: a
 * generic noun, never a village's word, chosen by the caller because only the
 * caller knows its sentence. A server too old to send `names` reads the same.
 */
export function useTokenNameFor(slug: string, fallback = "credits"): string {
  const cfg = useGameConfig();
  return String(cfg?.currency?.names?.[slug] ?? "").trim() || fallback;
}

/** The same, for a plain function that is handed the map (one read, many slugs). */
export function useTokenNameMap(): Record<string, string> {
  const cfg = useGameConfig();
  return cfg?.currency?.names ?? {};
}
