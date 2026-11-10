/**
 * The languages Village OS offers (internal spec i18n, US4 and §8 R15, R34).
 *
 * `source` is English: it lives in the code as the message. `reviewed` means a
 * person reviews the catalog string by string; a string not yet reviewed is
 * labelled "Translated automatically" (V.12). Machine locales (P2) are added
 * here only once their script has a tested font stack and, for right-to-left
 * scripts, the shell and core pages mirror (R15, R34).
 *
 * Pseudo locales (en-XA longer and accented, ar-XB right to left) exist for the
 * overflow sweep and are never offered to members.
 */
export type LocaleTier = "source" | "reviewed" | "machine" | "pseudo";

export type LocaleEntry = { tag: string; tier: LocaleTier };

export const LOCALES: readonly LocaleEntry[] = [
  { tag: "en", tier: "source" },
  { tag: "es", tier: "reviewed" },
];

export const PSEUDO_LOCALES: readonly LocaleEntry[] = [
  { tag: "en-XA", tier: "pseudo" },
  { tag: "ar-XB", tier: "pseudo" },
];

/** Tags a member may choose (and the server accepts as a saved choice). */
export function offeredLocaleTags(withPseudo = false): string[] {
  return [...LOCALES, ...(withPseudo ? PSEUDO_LOCALES : [])].map((l) => l.tag);
}

/** The tier of a tag, or null when Village OS does not offer it. */
export function tierOf(tag: string, withPseudo = false): LocaleTier | null {
  return [...LOCALES, ...(withPseudo ? PSEUDO_LOCALES : [])].find((l) => l.tag === tag)?.tier ?? null;
}

/**
 * A language's own name for itself ("Español", "العربية"), from Intl, first
 * letter capitalised the way that language capitalises it. The tag when Intl
 * has no name for it.
 */
export function autonym(tag: string): string {
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    if (!name || name === tag) return tag;
    return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
  } catch {
    return tag;
  }
}
