/**
 * Point the @fontsource CSS at the unhinted copies in client/src/fonts.
 *
 * The packaged woff2 files carry TrueType hinting that no engine this app runs
 * in makes much use of, and it was a tenth of the font bytes in `dist/public`.
 * `scripts/unhint-fonts.py` writes a copy of each cut main.tsx imports with
 * every glyph, code point and layout feature kept and only the hinting
 * removed, and its `--check` proves that against the originals.
 *
 * Only the url() changes. The @font-face rule stays exactly as @fontsource
 * wrote it, so the family name, weight, style, unicode-range and
 * `font-display: swap` a page sees are the package's own. A cut with no copy
 * keeps its original url and renders in the hinted file, so a missing copy
 * costs bytes, never a font. unhintedFonts.test.ts makes that miss loud.
 */

const FONT_URL = /url\((['"]?)\.\/files\/([a-z0-9-]+\.woff2)\1\)/g;

/**
 * Rewrite `url(./files/NAME.woff2)` to `url(<fontsDir>/NAME.woff2)` for every
 * NAME in `available`. `fontsDir` is a path vite can resolve from the CSS
 * file, such as the `@` alias. Returns null when nothing changed.
 */
export function pointAtUnhintedFonts(css: string, available: ReadonlySet<string>, fontsDir: string): string | null {
  const next = css.replace(FONT_URL, (whole, _q, name: string) =>
    available.has(name) ? `url(${fontsDir}/${name})` : whole,
  );
  return next === css ? null : next;
}
