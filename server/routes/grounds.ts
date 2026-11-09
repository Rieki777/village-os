/**
 * The Living Map artifact, served from its SOURCE, behind the map module.
 *
 *   GET /grounds/grounds-:hash.html   the immutable, content-hashed copy
 *   GET /grounds/index.html           the stable name, revalidated
 *   GET /grounds/manifest.json        the presence probe the shell reads first
 *   GET /grounds/a/:name              an image lifted out of the page (S1, below)
 *
 * `docs/prototypes/grounds-v0.html` is a few megabytes of self-contained page.
 * It used to be copied into `client/public/grounds/` at build time, which put
 * it in `dist/public` and took the total from 3.7 MB to 7.8 MB against the CI
 * bundle budget's 6 MB ceiling. So there is one copy on disk and the server
 * hands it out. The caller passes the path in: `..` from `server/index.ts`'s
 * own `__dirname` is the repo root in both shapes (`server/` in dev, `dist/`
 * in production), and from this file it would not be.
 *
 * Registered ahead of the SPA catch-all. A missing artifact 404s here rather
 * than falling through and returning the app's own HTML, which an iframe would
 * render as the site inside itself.
 *
 * ── THE MODULE GATE (readiness R056) ──────────────────────────────────────
 *
 * These three routes were plain `app.get` with no module check, so a village
 * that had never turned the map on still served the artifact to anyone who
 * asked, while `/api/map` beside it answered 404. They now follow the map
 * module the way `/api/map` does, with ONE difference that the shell forces:
 *
 *   manifest.json   behind `requireModule("map")`, exactly as `/api/map` is:
 *                   404 while the map is off, 404 to anyone but an admin while
 *                   it is in preview, 401 to a stranger while it is
 *                   members-only. The shell's probe (client/src/pages/
 *                   LivingMap.tsx) sends the member's Bearer token, so a
 *                   member reaches it on a members-only map.
 *
 *   the two pages   404 while the map is off, and served otherwise. They
 *                   cannot ask who is looking, because the shell loads them as
 *                   an iframe `src`, and an iframe navigation carries no
 *                   Authorization header. The session is a Bearer token in
 *                   localStorage with no cookie at all, so a members-only or
 *                   preview check here would refuse the very member (or admin)
 *                   the shell is drawing the map for, and blank the map. The
 *                   page is the platform's own drawing code; everything a
 *                   village owns (its scene, skin, words, places and chips)
 *                   reaches it through `/api/map/*`, which keeps the full gate.
 *
 * The 404 body is `requireModule`'s own, so an off module reads the same here
 * as it does on every other route: existence is hidden, never explained.
 */
import crypto from "crypto";
import fs from "fs";
import type { Express, RequestHandler, Response } from "express";
import { splitArtifact, type SplitResult } from "../lib/groundsSplit";
import { webpSplit } from "../lib/groundsWebp";
import { effectiveLifecycle, requireModule } from "../lib/modules";

interface Deps {
  /** The artifact on disk. Absent is a real state: the routes answer 404. */
  groundsFile: string;
  /** S2: re-encode the lifted images as WebP in the background (default on). */
  webp?: boolean;
}

/** What register hands back: a way for a test to wait for the WebP pass. */
export interface GroundsRoutes {
  /** Settles once the current version's WebP pass has finished (or failed). */
  webpReady(): Promise<void>;
}

/** `requireModule`'s body for a module that is off. */
function moduleOff(res: Response) {
  return res.status(404).json({ error: "module_disabled", module: "map" });
}

/** The page gate: refuse only while the map is off. See the header for why. */
const mapNotOff: RequestHandler = (_req, res, next) => {
  if (effectiveLifecycle("map") === "off") {
    moduleOff(res);
    return;
  }
  next();
};

export function register(app: Express, deps: Deps): GroundsRoutes {
  const { groundsFile } = deps;
  const useWebp = deps.webp !== false;

  /**
   * Identify the artifact by content, so it can be cached forever.
   *
   * Megabytes revalidated on every navigation is megabytes of nothing, and the
   * map is the surface members open most. Hashed URLs let it be `immutable`,
   * the same bargain `/assets` already takes.
   *
   * The hash is memoised on (size, mtime) rather than recomputed per request:
   * reading the file to answer a probe would trade one waste for another. It
   * is also computed LAZILY, so boot does not pay for a file most deployments
   * never serve, and a mid-flight artifact swap is picked up by the mtime
   * check rather than needing a restart.
   */
  /*
   * ── S1 OF THE MAP SPEED PLAN: THE PAGE IS SERVED SPLIT ─────────────────
   *
   * The file embeds about 5 MB of images as base64, and nothing on the map
   * worked until all of it had arrived (about 23 s on a throttled phone,
   * 8 Nov 2026). The page is now served with each embedded image swapped for
   * `/grounds/a/<hash>.<ext>`, served below and cached for a year. The split
   * is computed with the hash, on the same (size, mtime) key, and held in
   * memory: the file is read once per version, never per request, and never
   * written. server/lib/groundsSplit.ts says why this is no visible change.
   */
  /*
   * ── S2 STEP 1: THE SAME PAGE, NAMING WEBP IMAGES ─────────────────────────
   *
   * Once per version a background pass re-encodes the lifted images as WebP
   * (server/lib/groundsWebp.ts, 3,678 KB to 1,866 KB on 9 Nov 2026). Until it
   * finishes the S1 page is served; after, the page that names the WebP files.
   * The two are DIFFERENT BYTES, so they get different immutable URLs: the
   * WebP page's hash is derived from the source's, and the manifest names
   * whichever is current. Both hashed URLs answer, so a shell that read the
   * manifest a moment before the swap still gets a page, and every original
   * image stays servable for pages cached before it.
   */
  type Version = { key: string; hash: string; split: SplitResult; webp: SplitResult | null; webpHash: string; pass: Promise<void> };
  let groundsTag: Version | null = null;
  const groundsInfo = (): { bytes: number; hash: string; split: SplitResult; version: Version } | null => {
    if (!fs.existsSync(groundsFile)) return null;
    const st = fs.statSync(groundsFile);
    const key = `${st.size}:${st.mtimeMs}`;
    if (groundsTag?.key !== key) {
      const raw = fs.readFileSync(groundsFile);
      const digest = crypto.createHash("sha256").update(raw).digest("hex");
      const split = splitArtifact(raw.toString("utf8"));
      const v: Version = {
        key, hash: digest.slice(0, 12), split, webp: null,
        webpHash: crypto.createHash("sha256").update(digest + ":webp").digest("hex").slice(0, 12),
        pass: Promise.resolve(),
      };
      if (useWebp && split.assets.size) {
        v.pass = webpSplit(split).then(
          (w) => { if (w.renamed.size) v.webp = w; },
          (err) => console.warn("[grounds] WebP pass failed; serving the S1 images", err),
        );
      }
      groundsTag = v;
    }
    const v = groundsTag;
    return v.webp
      ? { bytes: st.size, hash: v.webpHash, split: v.webp, version: v }
      : { bytes: st.size, hash: v.hash, split: v.split, version: v };
  };

  /*
   * The immutable URL. `grounds-<hash>.html` changes name whenever the bytes
   * change, so a year-long cache can never serve a stale map.
   */
  app.get("/grounds/grounds-:hash.html", mapNotOff, (req, res) => {
    const info = groundsInfo();
    if (!info) return res.status(404).json({ error: "map_artifact_absent" });
    // A stale hash means a client is asking for a version we no longer have.
    // Redirect rather than 404: the shell re-reads the manifest and recovers.
    const v = info.version;
    const page = req.params.hash === v.hash ? v.split : v.webp && req.params.hash === v.webpHash ? v.webp : null;
    if (!page) return res.redirect(302, `/grounds/grounds-${info.hash}.html`);
    res.type("html");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(page.html);
  });

  /*
   * The stable URL stays, for anything holding the old address and for a
   * hand-typed check. It revalidates instead of caching hard, because this
   * name does not change when the bytes do. sendFile's ETag makes that a 304.
   */
  app.get("/grounds/index.html", mapNotOff, (_req, res) => {
    const info = groundsInfo();
    if (!info) return res.status(404).json({ error: "map_artifact_absent" });
    res.type("html");
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    // res.send sets an ETag from the body, so a revisit is still a 304.
    res.send(info.split.html);
  });

  /*
   * The lifted images. Each name is a hash of its own bytes, so it is cached
   * for a year and can never go stale. Gated like the pages and for the same
   * reason: the page's own <img> requests carry no token, so only an OFF map
   * refuses them. A name this version does not hold is a 404, looked up in
   * memory and never resolved against the disk, so no path reaches a file.
   */
  app.get("/grounds/a/:name", mapNotOff, (req, res) => {
    // The WebP split holds every original too, so either page's images resolve.
    const asset = groundsInfo()?.split.assets.get(String(req.params.name));
    if (!asset) return res.status(404).json({ error: "map_asset_absent" });
    res.setHeader("Content-Type", asset.type);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(asset.bytes);
  });

  /*
   * The presence probe. `/map` cannot tell a served artifact from the SPA
   * fallback by status code alone, so it reads a few bytes of JSON instead.
   * Computed rather than written to disk, so it can never claim an artifact
   * that is no longer there.
   *
   * `present` and `bytes` are the original contract and are unchanged. `url`
   * is additive: a shell that ignores it still works off /grounds/index.html.
   */
  app.get("/grounds/manifest.json", requireModule("map"), (_req, res) => {
    const info = groundsInfo();
    if (!info) return res.status(404).json({ present: false });
    // The manifest itself must never be cached, or it would pin the shell to
    // a hashed URL that has since moved.
    res.setHeader("Cache-Control", "no-store");
    res.json({ present: true, bytes: info.bytes, url: `/grounds/grounds-${info.hash}.html` });
  });

  return { webpReady: () => groundsInfo()?.version.pass ?? Promise.resolve() };
}
