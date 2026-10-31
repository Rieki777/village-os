import { useGameConfig } from "@/lib/gameApi";

/**
 * What this village calls its two tokens, for prose.
 *
 * The third sibling of `useVillageName` and `useVillageContent`: those carry a
 * village's own NAME and its own CLAIMS, these carry the words it uses for the
 * two things a member earns and holds. A page that reads its village name from
 * the config and still says "Gratitude" in the sentence beside it has moved
 * half the problem and left the half a member reads on every screen.
 *
 * TWO TOKENS, TWO HOOKS, because they are two different things and a village
 * renames them separately in Admin then Tokens:
 *
 *   `useTokenName()`       the RECOGNITION token. Earned from consented work,
 *                          sent peer to peer, settled on lunar cycles, and
 *                          carrying no financial value of its own. Served as
 *                          `currency.name` and derived from the token registry.
 *   `useValueTokenName()`  the VALUE token the cycle pool distributes across
 *                          recognition. Served as `currency.value.name`, also
 *                          from the registry, keyed by the
 *                          `gratitude.pool_token` variable.
 *
 * WHY HOOKS AND NOT `cfg?.currency?.name ?? "..."` IN THIRTY FILES. The
 * fallback is the whole design, and a fallback repeated by hand in thirty
 * files is a fallback that will disagree with itself. That is measured, not
 * feared: before this hook existed, `Quests.tsx`, `QuestDetail.tsx`,
 * `GameDashboard.tsx` and `GratitudeWall.tsx` each read the config and each
 * fell back to the literal "Gratitude", while `CoCreatorsGuide.tsx` read the
 * config for the value token and hardcoded the recognition token sixteen
 * times in the same file.
 *
 * THE FALLBACK IS FOR THE LOADING WINDOW, NEVER FOR A VILLAGE'S CHOICE, which
 * is why it is a generic noun and never the platform default word. Once
 * `/api/game/config` answers, neither name is ever blank: `mergedConfig()`
 * falls back through the registry, the brand overlay and the platform default
 * in turn, and the value token falls back to its own slug. So a caller reading
 * "recognition" is reading "the config has not landed yet", and it can never
 * be confused with a village that chose the word. A fallback of "Gratitude"
 * would fail exactly that test: a village that renamed its token to Seeds
 * would paint the old word first and the new word a moment later, which reads
 * as the village having chosen Gratitude.
 *
 * CALLERS PASS THEIR OWN FALLBACK WHERE THE SENTENCE NEEDS ONE, the same rule
 * `useVillageName("this village")` follows. A count reads "40-300 tokens"
 * while it loads, a heading reads "Recognition", and both are the caller's
 * call because only the caller knows the grammar of its own slot.
 */
export function useTokenName(fallback = "recognition"): string {
  const cfg = useGameConfig();
  return String(cfg?.currency?.name ?? "").trim() || fallback;
}

/**
 * The sentence-position variant of the recognition token, for a slot where
 * the word sits mid-sentence and title case would look like a proper noun
 * dropped into prose ("send gratitude to someone this month").
 *
 * Derived server-side from the same name, never stored beside it, so the two
 * cannot drift. See the `currency` block in `mergedConfig()`.
 */
export function useTokenNameLower(fallback = "recognition"): string {
  const cfg = useGameConfig();
  return String(cfg?.currency?.nameLower ?? "").trim() || fallback;
}

/**
 * The value token the cycle pool shares across recognition each cycle.
 *
 * The default fallback is the one `CoCreatorsGuide.tsx` already chose when it
 * became the first page to read this name, kept so the loading paint on that
 * page is unchanged by this hook landing.
 */
export function useValueTokenName(fallback = "village tokens"): string {
  const cfg = useGameConfig();
  return String(cfg?.currency?.value?.name ?? "").trim() || fallback;
}

/**
 * What this village calls ALL its tokens together: the umbrella word.
 *
 * Rye, 2026-10-23: "Village Tokens is the umbrella word, which should be able
 * to be set in admin to name each type of token". The platform default is his
 * own word, "Village Tokens", and a village renames it in Admin then Tokens.
 * Served as `currency.collectiveName`; pages say it as `{tokens}`. The loading
 * fallback is a generic noun, the rule `useTokenName` explains above.
 */
export function useTokensWord(fallback = "tokens"): string {
  const cfg = useGameConfig();
  return String(cfg?.currency?.collectiveName ?? "").trim() || fallback;
}
