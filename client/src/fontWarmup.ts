/**
 * START THE FIRST SCREEN'S WEB FONTS AT BOOT, NOT AT FIRST PAINT.
 *
 * A browser asks for a web font only when it lays out text set in it. In this
 * app that happens late: the bundle downloads, runs, waits for
 * /api/game/config, and only then renders the shell, so the font requests went
 * out after everything else had already happened. Text then painted in the
 * fallback face and re-flowed when the real one landed, which moves every
 * line on the screen under a visitor who has just started reading.
 *
 * So the faces every route's first screen needs are asked for here, the
 * moment the bundle runs, while the config is still in flight. On slow 4G
 * they then arrive before the first paint instead of after it.
 *
 * WHICH FACES is read from the page, never written down. The village's own
 * theme stylesheet (server/routes/brandTheme.ts) overrides `--font-body` and
 * `--font-display`, and it has already applied by the time a module script
 * runs, so the families asked for are the ones this village renders: Amora
 * gets its own two, a fork gets its own, an untouched fork gets the platform
 * defaults in index.css. Nothing here names a typeface.
 *
 * WHICH WEIGHTS is measured. On 2026-10-20 production's first screens of /,
 * /quests, /investor, /visit, /modules, /events and /request-membership all
 * asked for exactly body 400, 500 and 600 and display 600 and 700, because
 * those are the shell's own cuts. /login is the one route that skips body 500
 * (about 10 KB it now fetches early anyway). /investor adds display 500 and
 * 500 italic and /events adds display 400 and 500; those stay on demand. A
 * weight a family does not carry resolves to the nearest one it does, which
 * is the face that renders anyway, so a single-weight face costs one download,
 * not five.
 *
 * Failure is silent by design: a font that does not load is the fallback face,
 * which is exactly what the page shows without this.
 */
export const FIRST_SCREEN_FACES: ReadonlyArray<readonly [token: string, weights: readonly number[]]> = [
  ["--font-body", [400, 500, 600]],
  ["--font-display", [600, 700]],
];

const GENERIC = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif",
  "ui-monospace", "ui-rounded", "math", "emoji", "fangsong", "-apple-system", "blinkmacsystemfont",
]);

/**
 * The first family in a CSS font stack, unquoted, or null when the stack has
 * nothing a web font could answer for (empty, a generic family, an unresolved
 * var()).
 */
export function firstFamily(stack: string): string | null {
  const first = stack.split(",")[0]?.trim() ?? "";
  if (!first || first.startsWith("var(")) return null;
  const name = first.replace(/^(["'])(.*)\1$/, "$2").trim();
  if (!name || GENERIC.has(name.toLowerCase())) return null;
  return name;
}

/** The `document.fonts.load` descriptors for the first screen, deduplicated. */
export function firstScreenFontQueries(readToken: (token: string) => string): string[] {
  const out = new Set<string>();
  for (const [token, weights] of FIRST_SCREEN_FACES) {
    const family = firstFamily(readToken(token));
    if (!family) continue;
    const quoted = `"${family.replace(/["\\]/g, "")}"`;
    for (const w of weights) out.add(`${w} 1em ${quoted}`);
  }
  return [...out];
}

/**
 * Ask for the first screen's faces now. Safe to call anywhere: it does nothing
 * where the Font Loading API is missing and never throws.
 */
export function warmFirstScreenFonts(doc: Document = document): void {
  try {
    const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts || typeof fonts.load !== "function") return;
    const style = getComputedStyle(doc.documentElement);
    for (const q of firstScreenFontQueries((t) => style.getPropertyValue(t))) {
      fonts.load(q).catch(() => {
        /* The fallback face is the page without this line. */
      });
    }
  } catch {
    /* Same: a missing optimisation, never an error a member sees. */
  }
}
