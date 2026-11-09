/**
 * S2 step 1 of the map speed plan: serve the lifted images as WebP.
 *
 * S1 (server/lib/groundsSplit.ts) lifted the map artifact's embedded images
 * out of the page and serves them as their own files. They are still PNG and
 * JPEG: 3,678 KB across 62 images on 9 Nov 2026, which is most of what a
 * phone waits for once the page itself is 300 KB. Re-encoded as WebP the same
 * set is 1,866 KB (sprites at quality 88 with alpha at 90, photographs at 80).
 *
 * `webpSplit` takes an S1 split and returns another: every image WebP can
 * beat gets a WebP under a name made from its own bytes, the page names the
 * WebP instead, and EVERY ORIGINAL STAYS in the asset map, because a page
 * cached before this (immutable, for a year) still names the originals.
 *
 * WebP only, with no PNG fallback by `Accept`: the platform's images are WebP
 * already (scripts/check-image-budget.mjs), every engine that runs the app's
 * module script decodes it, and a negotiated response behind a shared cache
 * is the one way to hand the wrong format to a browser.
 *
 * It is slow (seconds for the real set), so the route runs it in the
 * background once per version of the artifact and serves the S1 split until
 * it is done. sharp is imported on first use, the way server/lib/uploads.ts
 * does, so boot never pays for it.
 */
import crypto from "crypto";
import { ASSET_PREFIX, type GroundsAsset, type SplitResult } from "./groundsSplit";

export interface WebpSplit extends SplitResult {
  /** Original asset name to the WebP name that replaced it in the page. */
  renamed: Map<string, string>;
}

/** Sprites keep crisp edges and clean alpha; the satellite plates are photographs. */
const QUALITY: Record<string, { quality: number; alphaQuality?: number }> = {
  "image/png": { quality: 88, alphaQuality: 90 },
  "image/jpeg": { quality: 80 },
};

export async function webpSplit(split: SplitResult): Promise<WebpSplit> {
  const assets = new Map<string, GroundsAsset>(split.assets);
  const renamed = new Map<string, string>();
  const todo = Array.from(split.assets.entries()).filter(([, a]) => QUALITY[a.type]);
  if (todo.length) {
    const sharp = (await import("sharp")).default;
    for (const [name, a] of todo) {
      let bytes: Buffer;
      try {
        bytes = await sharp(a.bytes).webp({ ...QUALITY[a.type], effort: 6 }).toBuffer();
      } catch {
        continue; // an image sharp cannot read keeps its original, which already works
      }
      if (bytes.length >= a.bytes.length) continue; // never swap for something bigger
      const webp = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16) + ".webp";
      assets.set(webp, { type: "image/webp", bytes });
      renamed.set(name, webp);
    }
  }
  let html = split.html;
  renamed.forEach((webp, orig) => { html = html.split(ASSET_PREFIX + orig).join(ASSET_PREFIX + webp); });
  return { html, assets, renamed };
}
