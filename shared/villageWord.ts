/**
 * A village's renameable words: the article and the plural of a word a founder
 * typed, worked out once.
 *
 * These lived in client/src/lib/gameApi.ts, which still re-exports them, and
 * moved here on 2026-10-23 so shared code (the membership letter's words) and
 * components whose tests replace gameApi wholesale use the one rule. Pure: no
 * imports, no React.
 */

/**
 * "a" or "an" for a word a founder typed, by its first letter.
 *
 * A HEURISTIC, and a knowingly imperfect one: it reads "Elder" correctly and
 * would read a hypothetical "Union" wrongly. The alternative was to write
 * every sentence around the article, which makes every render site read
 * stiffly to avoid a case no village has asked for. Exported and pinned by
 * `client/src/lib/catalystLabel.test.ts` rather than left to be inferred.
 */
export function articleFor(word: string): string {
  return /^[aeiou]/i.test(String(word ?? "").trim()) ? "an" : "a";
}

/**
 * The plural of a word a founder typed.
 *
 * English regular plurals only, which covers every word a village has plausibly
 * chosen for this: Catalysts, Founders, Stewards, Elders, Keepers, Weavers,
 * Guardians. The two irregular endings that do come up in practice are handled
 * (a trailing consonant plus y takes "ies", a sibilant takes "es"); a genuinely
 * irregular word would read wrongly, and rewriting every plural sentence to
 * dodge it made them all read worse than the one case that might be wrong.
 * Pinned by `client/src/lib/catalystLabel.test.ts`.
 */
export function pluralFor(word: string): string {
  const w = String(word ?? "").trim();
  if (!w) return w;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  return `${w}s`;
}

export interface CatalystLabel {
  /** The word itself, capitalised as the village typed it. */
  name: string;
  /** "a" or "an", whichever this word takes. */
  a: string;
  /** The two together, because nearly every site needs both. */
  aName: string;
  /** The same, capitalised, for the start of a sentence. */
  aNameCap: string;
  /** More than one of them. */
  plural: string;
}

/**
 * One renameable word, with its article and its plural worked out once.
 *
 * `CatalystLabel` was always this shape and only ever had one caller. Three
 * villages' worth of words now ride it (whoever runs the place, the position
 * somebody holds, one person's occupancy of that position), so the derivation
 * lives here and the hooks below are three lines each. Copying the article and
 * plural logic per word is how two of them end up disagreeing about "an".
 */
export function villageWord(typed: unknown, fallback: string): CatalystLabel {
  const name = String(typed ?? "").trim() || fallback;
  const a = articleFor(name);
  return { name, a, aName: `${a} ${name}`, aNameCap: a === "an" ? `An ${name}` : `A ${name}`, plural: pluralFor(name) };
}
