/**
 * The stock character art: thirty drawings, served by the server at the URL
 * they have always had.
 *
 *   GET /images/avatars/<class>-<f|m>-<tone>.webp
 *   GET /images/avatars/manifest.json   (the generator's record)
 *
 * WHY THE SERVER AND NOT `client/public`. CI caps the whole of `dist/public`
 * (MAX_TOTAL_DIST_KB, block-charged) and these files were 1616 KB of it,
 * enough to keep two finished pull requests out. Rye, 2026-10-13: "Move the
 * avatars to uploads". They now live in `server/assets/avatars`, which the
 * Dockerfile copies into the image beside the other files the running server
 * reads, and which the client build never sees.
 *
 * WHY NOT THE UPLOADS VOLUME ITSELF. Every instance has to answer these URLs:
 * a fresh fork whose volume is empty, a village with no volume mounted at all,
 * and the thirteen villages that upgrade onto this image with a volume that
 * has never held them. A copy seeded into the volume would still have to ship
 * in the image to be seeded from, would be charged to the village's upload
 * budget and carried in every uploads backup, and would leave one more boot
 * step that can half-run. Served from the image, the answer is the same on
 * every instance and there is no step to miss.
 *
 * THE URLS DID NOT CHANGE, and nothing stores them anyway: `avatarFor`
 * (server/lib/characters.ts), `portraitFor` (shared/roleSheet.ts) and the
 * picker (client/src/pages/Characters.tsx) compute every one from a class key,
 * a presentation and a tone at read time. Keeping the path means a bookmarked
 * image, a browser cache and any copy a village pasted somewhere all keep
 * working, with no migration.
 *
 * CACHE. The names are not content-hashed, so a year of `immutable` would
 * strand a redrawn file on every phone that saw the old one. A day, with the
 * ETag and Last-Modified express.static already sends, means a repeat visit
 * costs nothing and a redraw reaches everyone by tomorrow. The service worker
 * (client/public/sw.js) passes these through untouched; it caches only the
 * hashed map artifact.
 *
 * A MISS FALLS THROUGH to the server's own `/images/` rule, which answers 404
 * text/plain, so a missing drawing shows as a broken image the page already
 * handles (every caller draws a sigil or a medallion on error) and never as
 * the app's HTML with a 200.
 *
 * A route module rather than `server/index.ts`, which is ratcheted on lines
 * and routes (scripts/check-server-index-size.mjs).
 */
import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";

/** The public path. Unchanged since the art shipped; stored nowhere. */
export const STOCK_AVATAR_URL = "/images/avatars";

/** Where the files live, relative to the repository root (and to /app in the image). */
export const STOCK_AVATAR_DIR = path.join("server", "assets", "avatars");

/** One day, revalidated by ETag after that. See CACHE above. */
export const STOCK_AVATAR_MAX_AGE_SECONDS = 86400;

export interface StockAvatarDeps {
  /** Absolute path of the directory holding the drawings. */
  dir: string;
}

export function register(app: Express, deps: StockAvatarDeps): void {
  if (!fs.existsSync(deps.dir)) {
    // Loud and not fatal: the pages draw sigils, and the village still runs.
    console.warn(`[avatars] ${deps.dir} is missing, so stock character art will answer 404 and pages will draw sigils`);
  }
  app.use(
    STOCK_AVATAR_URL,
    express.static(deps.dir, {
      index: false,
      redirect: false,
      dotfiles: "ignore",
      maxAge: STOCK_AVATAR_MAX_AGE_SECONDS * 1000,
    }),
  );
}
