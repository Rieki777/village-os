/**
 * Point the @fontsource CSS at the unhinted copies in client/src/fonts.
 *
 * The packaged woff2 files carry TrueType hinting that no engine this app runs
 * in makes much use of, and it was a tenth of the font bytes in `dist/public`.
 * `scripts/unhint-fonts.py` writes a copy of each cut main.tsx imports with
 * every glyph, code point and layout feature kept and only the hinting
 * removed, and its `--check` proves that against the originals.
 *
 * ONE FILE PER FAMILY where the family has a variable build. Eight of the
 * bundled families ship as five static cuts each, and every one of those cuts
 * is an instance of the family's variable font: the same advance widths, glyph
 * bounds and vertical metrics at that weight, which `--check` proves per cut.
 * So every cut of such a family points at the one variable copy
 * (`<family>-latin-wght-<style>.woff2`). That took 39 files and 663 KB of the
 * dist budget down to 9 files and 348 KB, and the default first screen from
 * five font requests to two.
 *
 * Only the url() changes. The @font-face rule stays exactly as @fontsource
 * wrote it, so the family name, weight, style, unicode-range and
 * `font-display: swap` a page sees are the package's own. That matters most
 * for the variable files: each rule still declares ONE weight, so the browser
 * picks the same face for every requested weight as it did with static files
 * (an 800 still resolves to the 700 face) and draws it at that face's weight.
 * Several rules naming one url cost one download. A cut with no copy keeps its
 * original url and renders in the hinted file, so a missing copy costs bytes,
 * never a font. unhintedFonts.test.ts makes that miss loud.
 */

const FONT_URL = /url\((['"]?)\.\/files\/([a-z0-9-]+\.woff2)\1\)/g;
const CUT = /^([a-z0-9-]+)-latin-\d+-(normal|italic)\.woff2$/;

/**
 * "montserrat-latin-600-normal.woff2" -> "montserrat-latin-wght-normal.woff2",
 * the name of the family's variable copy for that style, or null when `name`
 * is not a static cut.
 */
export function variableCopyName(name: string): string | null {
  const m = CUT.exec(name);
  return m ? `${m[1]}-latin-wght-${m[2]}.woff2` : null;
}

/**
 * The copy that serves the cut `name`: the family's variable copy when there
 * is one, else the cut's own unhinted copy, else null (the package's hinted
 * original keeps serving it).
 */
export function copyFor(name: string, available: ReadonlySet<string>): string | null {
  const variable = variableCopyName(name);
  if (variable && available.has(variable)) return variable;
  return available.has(name) ? name : null;
}

/**
 * Rewrite `url(./files/NAME.woff2)` to `url(<fontsDir>/COPY)` for every NAME
 * that has a copy in `available` (see `copyFor`). `fontsDir` is a path vite
 * can resolve from the CSS file, such as the `@` alias. Returns null when
 * nothing changed.
 */
export function pointAtUnhintedFonts(css: string, available: ReadonlySet<string>, fontsDir: string): string | null {
  const next = css.replace(FONT_URL, (whole, _q, name: string) => {
    const copy = copyFor(name, available);
    return copy ? `url(${fontsDir}/${copy})` : whole;
  });
  return next === css ? null : next;
}
