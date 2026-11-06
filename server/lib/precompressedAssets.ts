/**
 * The client's immutable assets at brotli quality 11, served in front of
 * express.static.
 *
 * `compression()` encodes brotli at quality 4, per request, and Cloudflare
 * keeps whichever bytes it was handed for a year, because /assets is hashed
 * and immutable. So the quality the origin picks on the first request is the
 * quality every member downloads, and quality 4 made the main bundle 187,755
 * bytes where quality 11 makes it 159,369 (production, a5905b4, 2026-10-20;
 * the numbers for the whole tree are in scripts/precompress-assets.mjs, which
 * writes the copies this file serves).
 *
 * WHAT THIS DOES. For a GET or HEAD under /assets whose path the build's
 * manifest names, from a client that would have been sent brotli anyway, it
 * answers with the precompressed copy and every header express.static would
 * have sent (type, cache, ETag, Last-Modified), plus the encoding. Anything
 * else falls through to the exact path that ran before: express.static, then
 * compression() on the way out. That includes a Range request, a client that
 * prefers another coding, a path the manifest does not name, and every case
 * of doubt below.
 *
 * WHY IT CANNOT SERVE THE WRONG BYTES. The manifest is a claim made at build
 * time, so it is checked against the file on disk that would otherwise have
 * been served: same size, same sha256, and then the copy is decompressed once
 * and compared byte for byte. Only a copy that passes is kept, in memory,
 * keyed on the source's size and mtime, so a file swapped under a running
 * server is checked again. A failed check is remembered as a fall-through
 * for that version of the file, never as an error.
 *
 * WHY THE SAME ETAG. compression() leaves the identity ETag on the bytes it
 * encodes, so a browser or Cloudflare holding today's quality 4 copy has been
 * revalidating against that tag. Keeping it means this changes how many
 * bytes a fresh download costs and nothing about what any cache believes.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import type { NextFunction, Request, RequestHandler, Response } from "express";

const brotliDecompress = promisify(zlib.brotliDecompress);

/** What express.static({ maxAge: "1y", immutable: true }) sends; server/precompressedAssets.test.ts holds the two together. */
export const IMMUTABLE_YEAR = "public, max-age=31536000, immutable";

export interface PrecompressedManifest {
  version: number;
  quality: number;
  /** Keyed by the path under /assets, `/`-separated, exactly as a request names it. */
  files: Record<string, { bytes: number; sha256: string; br: number }>;
}

/** The manifest the build wrote, or null when it is absent, unreadable, or not this format. */
export function readManifest(precompressedDir: string): PrecompressedManifest | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(precompressedDir, "manifest.json"), "utf8"));
    if (!m || m.version !== 1 || typeof m.files !== "object" || m.files === null) return null;
    return m as PrecompressedManifest;
  } catch {
    return null;
  }
}

/**
 * True when brotli is the coding compression() would choose for this
 * Accept-Encoding: acceptable (q above zero, by name or through `*`) and not
 * outranked by any other coding the client listed, identity included. Ties go
 * to brotli because compression() prefers it on a tie. No header means no
 * brotli, as it does there.
 */
export function prefersBrotli(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return false;
  let br: number | null = null;
  let star: number | null = null;
  let best = 0;
  for (const part of value.split(",")) {
    const [rawToken, ...params] = part.split(";");
    const token = rawToken.trim().toLowerCase();
    if (!token) continue;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) q = Number(m[1]);
    }
    if (!Number.isFinite(q)) q = 0;
    if (token === "br") br = q;
    else if (token === "*") star = q;
    else best = Math.max(best, q);
  }
  const mine = br ?? star ?? 0;
  return mine > 0 && mine >= best;
}

interface Verified {
  key: string;
  br: Buffer | null;
}

/** The ETag the `etag` package (and so express.static) derives from a file's stats. */
function statTag(st: fs.Stats): string {
  return `W/"${st.size.toString(16)}-${st.mtime.getTime().toString(16)}"`;
}

export interface PrecompressedOptions {
  /** The directory express.static serves under /assets. */
  assetsDir: string;
  /** Where scripts/precompress-assets.mjs wrote manifest.json and assets/. */
  precompressedDir: string;
  /** Must equal what express.static sends for the same files. */
  cacheControl?: string;
  log?: (line: string) => void;
}

export function precompressedAssets(opts: PrecompressedOptions): RequestHandler {
  const log = opts.log ?? ((line: string) => console.log(line));
  const manifest = readManifest(opts.precompressedDir);
  if (!manifest) {
    log("[assets] no dist/precompressed manifest: /assets is encoded per request");
    return (_req, _res, next) => next();
  }
  const names = Object.keys(manifest.files).length;
  log(`[assets] ${names} precompressed brotli-${manifest.quality} cop${names === 1 ? "y" : "ies"} on offer for /assets`);
  const cacheControl = opts.cacheControl ?? IMMUTABLE_YEAR;
  const checked = new Map<string, Promise<Verified>>();

  async function verify(rel: string, key: string): Promise<Verified> {
    const entry = manifest!.files[rel];
    try {
      const source = await fs.promises.readFile(path.join(opts.assetsDir, rel));
      if (source.length !== entry.bytes) return { key, br: null };
      const hash = crypto.createHash("sha256").update(source).digest("hex").slice(0, entry.sha256.length);
      if (hash !== entry.sha256) return { key, br: null };
      const br = await fs.promises.readFile(path.join(opts.precompressedDir, "assets", rel + ".br"));
      if (br.length !== entry.br) return { key, br: null };
      if (!(await brotliDecompress(br)).equals(source)) return { key, br: null };
      return { key, br };
    } catch {
      return { key, br: null };
    }
  }

  return async function servePrecompressed(req: Request, res: Response, next: NextFunction) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.headers.range) return next();
    let rel: string;
    try {
      rel = decodeURIComponent(req.path).replace(/^\/+/, "");
    } catch {
      return next();
    }
    // Only a name the build wrote down. Nothing a request says is joined onto a path otherwise.
    if (!Object.prototype.hasOwnProperty.call(manifest.files, rel)) return next();
    if (!prefersBrotli(req.headers["accept-encoding"])) return next();

    let st: fs.Stats;
    try {
      st = await fs.promises.stat(path.join(opts.assetsDir, rel));
    } catch {
      return next();
    }
    if (!st.isFile()) return next();
    const key = `${st.size}:${st.mtimeMs}`;
    let pending = checked.get(rel);
    if (!pending || (await pending).key !== key) {
      pending = verify(rel, key);
      checked.set(rel, pending);
    }
    const { br } = await pending;
    if (!br) return next();

    res.setHeader("Cache-Control", cacheControl);
    res.setHeader("Last-Modified", st.mtime.toUTCString());
    res.setHeader("ETag", statTag(st));
    res.vary("Accept-Encoding");
    if (req.fresh) {
      res.statusCode = 304;
      return res.end();
    }
    res.type(path.extname(rel));
    res.setHeader("Content-Encoding", "br");
    res.setHeader("Content-Length", String(br.length));
    if (req.method === "HEAD") return res.end();
    res.end(br);
  };
}
