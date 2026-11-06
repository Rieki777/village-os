/**
 * The translation catalogs, served to the client (internal spec i18n, plan
 * §1.1; §8 R16, R35).
 *
 * `scripts/build-i18n-catalogs.mjs` compiles the PO files into dist/i18n at
 * build time; this serves them. They are deliberately NOT in dist/public, so
 * no language costs the client bundle budget, and English never appears here:
 * it is the source, kept in the code.
 *
 * Public and unauthenticated: a visitor needs the page in their language
 * before anyone signs in. Each file is read once and held in memory, and a
 * request naming the current `?v=` is cacheable for a year, so a village of
 * members behind one shared address costs one read per deploy. There is no
 * per-address limit on purpose: a rural village often shares one address, and
 * a limit would drop all of them to English at once.
 *
 * A language Village OS does not offer answers an empty catalog with 200, not
 * a 404: the client then shows English, and the console stays clean (V.10).
 */
import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { LOCALES, PSEUDO_LOCALES, tierOf } from "@shared/i18nLocales";
import { directionOf } from "@shared/i18nDirection";

type Catalog = { locale: string; version: string; messages: Record<string, unknown>; unreviewed: string[] };

type Deps = {
  /** Where the compiled catalogs live (dist/i18n in a build). */
  catalogDir: string;
  /** Pseudo locales are for the overflow sweep, never for members. */
  pseudoAllowed: () => boolean;
};

const EMPTY_VERSION = "none";

export function register(app: Express, deps: Deps): void {
  const cache = new Map<string, Catalog | null>();

  function load(locale: string): Catalog | null {
    if (cache.has(locale)) return cache.get(locale) ?? null;
    let catalog: Catalog | null = null;
    try {
      catalog = JSON.parse(fs.readFileSync(path.join(deps.catalogDir, `${locale}.json`), "utf8")) as Catalog;
    } catch {
      catalog = null;
    }
    cache.set(locale, catalog);
    return catalog;
  }

  function offered(tag: string): boolean {
    const tier = tierOf(tag, deps.pseudoAllowed());
    return tier === "reviewed" || tier === "machine" || tier === "pseudo";
  }

  app.get("/api/i18n/catalog/:locale", (req, res) => {
    const tag = String(req.params.locale ?? "");
    const catalog = offered(tag) ? load(tag) : null;
    const body: Catalog = catalog ?? { locale: tag, version: EMPTY_VERSION, messages: {}, unreviewed: [] };
    const etag = `"${body.version}"`;
    res.setHeader("ETag", etag);
    res.setHeader(
      "Cache-Control",
      catalog && req.query.v === body.version ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
    );
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.json(body);
  });

  app.get("/api/i18n/locales", (_req, res) => {
    const list = [...LOCALES, ...(deps.pseudoAllowed() ? PSEUDO_LOCALES : [])].map((l) => ({
      tag: l.tag,
      tier: l.tier,
      dir: directionOf(l.tag),
    }));
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ locales: list });
  });
}
