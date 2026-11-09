/**
 * S1 of the map speed plan: lift the map artifact's embedded images out of the page.
 *
 * `docs/prototypes/grounds-v0.html` carries about 5 MB of images as base64
 * text (the building sprites, the satellite plate, the surround). Text inside
 * a page cannot arrive in parallel, cannot be cached apart from the page, and
 * must all arrive before the page's script has run, so on a mid-range phone
 * over slow 4G the map was usable only after about 23 seconds (measured
 * 8 Nov 2026, median of three cold loads).
 *
 * This takes each embedded image over `MIN_SPLIT_CHARS` and serves it as its
 * own file, named by a hash of its bytes, so it can be cached for a year and
 * fetched alongside everything else. The page is otherwise untouched: the only
 * edit is the URL inside each quote, and swapping the data URIs back restores
 * the source exactly (held by groundsSplit.test.ts on the real artifact).
 *
 * WHY THIS IS SAFE FOR THE ARTIFACT'S CODE. Every consumer of these strings
 * hands them to an image: `<img src>`, `new Image().src`, or a CSS `url()`.
 * A same-origin URL behaves the same in all three, including a canvas
 * `getImageData` read, which a same-origin image does not taint. The paths are
 * absolute so they resolve the same from the page, its CSS and its script.
 *
 * The source file is never written. Other lanes own its contents; this runs
 * when the server reads the file to serve it.
 */
import crypto from "crypto";

/** Where the lifted images are served. Absolute on purpose; see the header. */
export const ASSET_PREFIX = "/grounds/a/";

/**
 * Below this many base64 characters an image stays inline: a request costs a
 * round trip, and on a 150 ms network that is worth about 30 KB of transfer.
 * Every sprite on the real map is well over it.
 */
export const MIN_SPLIT_CHARS = 2048;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export interface GroundsAsset {
  type: string;
  bytes: Buffer;
}

export interface SplitResult {
  /** The page, with each lifted image's data URI replaced by its asset path. */
  html: string;
  /** Asset file name (`<hash16>.<ext>`) to its bytes. An image used twice is stored once. */
  assets: Map<string, GroundsAsset>;
}

/*
 * The URI ends at the first character outside the base64 alphabet, which in
 * this file is always a closing quote or parenthesis. A base64 payload is
 * never shorter than the threshold by accident, so prose such as
 * "data:image/png;base64, is how…" never matches (it has no payload).
 */
const DATA_URI = /data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})/g;

export function splitArtifact(source: string): SplitResult {
  const assets = new Map<string, GroundsAsset>();
  const html = source.replace(DATA_URI, (whole, type: string, payload: string) => {
    if (payload.length < MIN_SPLIT_CHARS) return whole;
    const bytes = Buffer.from(payload, "base64");
    /*
     * Only lift what decodes back to the same text. Buffer.from forgives
     * malformed base64; the page's browser might read it differently, and
     * then the swap would be a visible change. Such a URI stays inline.
     */
    if (bytes.toString("base64") !== payload) return whole;
    const name = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16) + "." + EXT[type];
    if (!assets.has(name)) assets.set(name, { type, bytes });
    return ASSET_PREFIX + name;
  });
  return { html, assets };
}
