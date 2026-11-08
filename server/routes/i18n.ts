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
import type { AppDeps } from "../lib/appDeps";
import { LOCALES, PSEUDO_LOCALES, offeredLocaleTags, tierOf } from "@shared/i18nLocales";
import { directionOf } from "@shared/i18nDirection";

type Catalog = { locale: string; version: string; messages: Record<string, unknown>; unreviewed: string[] };

type Deps = {
  /** Where the compiled catalogs live (dist/i18n in a build). */
  catalogDir: string;
  /** Pseudo locales are for the overflow sweep, never for members. */
  pseudoAllowed: () => boolean;
} & Partial<Pick<AppDeps, "authedUser" | "overLimit" | "members">>;

const HOUR_MS = 60 * 60 * 1000;
/** Saves one member may make in an hour. Someone comparing languages switches often. */
const LOCALE_SAVES_PER_HOUR = 60;

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

  const { authedUser, members, overLimit } = deps;
  if (!authedUser || !members || !overLimit) return;

  /**
   * A member's language, saved in their preferences (users.prefs.locale) so it
   * follows them to every device. JSON on purpose: no migration, and erasure
   * already resets preferences whole. An empty value clears it, and the
   * browser's own languages apply again.
   */
  app.put("/api/profile/locale", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const raw = req.body?.locale;
    const offered = offeredLocaleTags();
    const tag = typeof raw === "string" ? raw.trim() : null;
    if (tag === null || (tag !== "" && !offered.includes(tag))) {
      return res.status(400).json({ error: `Choose one of: ${offered.join(", ")}.` });
    }
    if (await overLimit(`locale-choice:${me.id}`, LOCALE_SAVES_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That's a lot of switching. Try again in a little while." });
    }
    const updated = await members.update(me.id, (u: any) => {
      const prefs = { ...(u.prefs ?? {}) };
      if (tag) prefs.locale = tag;
      else delete prefs.locale;
      u.prefs = prefs;
    });
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json({ locale: (updated.prefs?.locale as string | undefined) ?? null });
  });
}
