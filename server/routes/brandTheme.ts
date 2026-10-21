/**
 * The village's theme stylesheet, and the shell that links it.
 *
 *   GET /api/brand/theme.css            the brand document as CSS, revalidated every load
 *   GET /api/brand/theme.css?v=<hash>   the same bytes, cached for a year when <hash> is current
 *
 * WHAT THIS IS. server/lib/themeCss.ts turns the brand document into a
 * stylesheet (fonts, the derived palette), and client/index.html links it
 * render-blocking, so a village's look arrives before its first paint.
 *
 * WHY THE URL CARRIES A VERSION. The route always answered `no-cache` with an
 * ETag, which asks every browser to check back. A cache in front of the
 * village does not have to listen: Cloudflare's default Browser Cache TTL
 * held the old stylesheet for four hours, so a founder who changed the brand
 * in Admin saw the old fonts and colours long after saving. A URL that
 * changes whenever the content changes is the one answer no cache can get
 * wrong. So every page the server sends has its stylesheet link rewritten to
 * `?v=<version>` (`shellWithTheme`), where the version is the same 16-hex
 * sha1 the route sends as its ETag (`themeCssVersion`). A request that names
 * the current version is told to keep the bytes for a year; any other, or
 * none, gets today's revalidate-always answer. An old shell still receives
 * current CSS, and a cache can only ever hold one version's bytes under that
 * version's own URL.
 *
 * WHY IT LIVES HERE. The handler sat inline in server/index.ts, and that file
 * is on a ratchet (scripts/check-server-index-size.mjs) that only lets it
 * shrink. Changing the handler was the moment to move it into a module of its
 * own, with the shell splice beside it, so both halves of the version agree
 * in one file.
 */
import type { Express, Request, Response } from "express";
import { THEME_HREF, buildThemeCss, themeCssVersion, withThemeVersion, type BrandThemeFields } from "../lib/themeCss";

/** The brand document, read as it stands on each request. Only its `theme` is used here. */
export type GetBrand = () => unknown;

/** The brand document's theme fields, or null when it has none. */
function themeOf(brand: unknown): BrandThemeFields | null {
  if (!brand || typeof brand !== "object") return null;
  const theme = (brand as { theme?: unknown }).theme;
  return theme && typeof theme === "object" ? (theme as BrandThemeFields) : null;
}

/**
 * The stylesheet and its version, built and hashed once per distinct theme. A
 * page load reads the CSS for the shell's link and then again for the
 * stylesheet itself; while the brand stands still, both reuse one result.
 *
 * KEYED ON THE THEME FIELDS, NOT THE CSS. This used to rebuild the CSS on
 * every call and compare the output, which saved only the hash. With a seed
 * set, building is the dear part: deriveTheme's colour math measured 1.2 to
 * 1.9 ms a call (2026-10-20), synchronous, on every page the server sends,
 * and production has a seed. buildThemeCss is a pure function of these fields
 * (shared/brandTokens.ts imports nothing), so the same fields always build the
 * same CSS, and a brand saved in Admin is a different key on the very next
 * request.
 */
let last: { key: string; css: string; version: string } | null = null;
function currentTheme(getBrand: GetBrand): { css: string; version: string } {
  const theme = themeOf(getBrand());
  const key = JSON.stringify(theme);
  if (last && last.key === key) return last;
  const css = buildThemeCss(theme);
  last = { key, css, version: themeCssVersion(css) };
  return last;
}

/** The shell with its stylesheet link carrying the current version. A shell without the link comes back unchanged. */
export function shellWithTheme(shell: string, getBrand: GetBrand): string {
  return withThemeVersion(shell, currentTheme(getBrand).version);
}

export function register(app: Express, deps: { getBrand: GetBrand }): void {
  const { getBrand } = deps;

  app.get(THEME_HREF, async (req: Request, res: Response) => {
    const { css, version } = currentTheme(getBrand);
    const etag = `"${version}"`;
    // Only the current version may be kept for good. A stale `v` is an old
    // shell asking, and it gets current CSS that it must check again.
    const pinned = typeof req.query?.v === "string" && req.query.v === version;
    res.setHeader("Cache-Control", pinned ? "public, max-age=31536000, immutable" : "no-cache");
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    res.type("text/css").send(css);
  });
}
