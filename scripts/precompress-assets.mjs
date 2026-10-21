#!/usr/bin/env node
/**
 * The client's immutable assets, brotli'd ONCE, at the highest quality.
 *
 * WHAT THIS FIXES. `compression()` in server/index.ts encodes brotli at its
 * default quality 4, per request. Cloudflare asks the origin for br, keeps
 * whatever comes back for a year (every /assets URL is hashed and immutable),
 * and hands members exactly those bytes. Measured on production at a5905b4 on
 * 2026-10-20: the main bundle reached browsers as 187,755 bytes of brotli,
 * byte for byte what Node's zlib emits at quality 4, and LARGER than gzip -6
 * of the same file (186,345). At quality 11 it is 159,369. Over the whole
 * built tree, 150 files: 1,105,796 bytes at quality 4 and 930,233 at 11
 * (15.9% less), which is 42 to 46 KB off every cold load of the eight routes
 * measured.
 *
 * WHY AT BUILD TIME. Quality 11 costs two to four seconds of CPU for the main
 * bundle alone: far too slow per request, and too dear per boot, because 71
 * e2e suites boot dist/index.js under NODE_ENV=production and a boot-time pass
 * would charge CI that CPU 71 times. Once per build it is about three seconds
 * of wall clock on four threads, and incremental after that.
 *
 * WHY OUTSIDE dist/public. CI's MAX_TOTAL_DIST_KB measures dist/public,
 * block-charged. These files are a second ENCODING of bytes already counted
 * there, not more content for a member to download, and 150 more files would
 * each cost a 4 KB block. They live in dist/precompressed, which the
 * Dockerfile ships along with the rest of dist/.
 *
 * WHAT THE SERVER TRUSTS: nothing by name alone. The manifest records each
 * source file's size and sha256, and server/lib/precompressedAssets.ts checks
 * the file it would otherwise have served against both, then decompresses the
 * copy once and compares it byte for byte before it serves it. A stale or
 * partial dist/precompressed can only ever cost the quality 4 path, never
 * serve the wrong bytes.
 *
 * INCREMENTAL. A file whose hash matches the previous manifest keeps its .br,
 * so `node scripts/build-server.mjs` on its own (the inner loop, which calls
 * this) pays only the hashing when the client has not been rebuilt.
 *
 *   node scripts/precompress-assets.mjs      (also run by scripts/build-server.mjs)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

export const MANIFEST_VERSION = 1;
export const QUALITY = 11;
/** compression()'s own threshold. Below it the origin encodes nothing today, and Cloudflare encodes those itself. */
export const MIN_BYTES = 1024;
/** Text the browser decodes. woff2 and webp are compressed already and are left alone. */
export const COMPRESSIBLE = /\.(css|js|json|mjs|svg|txt|xml)$/i;
/** zlib's async calls run on libuv's pool, which is four threads unless UV_THREADPOOL_SIZE says otherwise. */
const PARALLEL = 4;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    // express.static ignores dotfiles, so a copy of one could never be asked for.
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

const posix = (p) => p.split(path.sep).join("/");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32);

function brotli(buf) {
  return new Promise((resolve, reject) =>
    zlib.brotliCompress(
      buf,
      {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: QUALITY,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
        },
      },
      (err, out) => (err ? reject(err) : resolve(out)),
    ),
  );
}

/**
 * Write dist/precompressed/assets/<path>.br for every compressible file under
 * dist/public/assets, and dist/precompressed/manifest.json describing them.
 * Returns the manifest, or null when there is no client build to read.
 */
export async function precompressAssets({ root, log = (line) => console.log(line) }) {
  const assetsDir = path.join(root, "dist", "public", "assets");
  const outDir = path.join(root, "dist", "precompressed");
  const outAssets = path.join(outDir, "assets");
  const manifestPath = path.join(outDir, "manifest.json");
  if (!fs.existsSync(assetsDir)) {
    log("  dist/precompressed skipped: there is no dist/public/assets (the client is not built)");
    return null;
  }
  const started = Date.now();

  let previous = {};
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (m && m.version === MANIFEST_VERSION && m.quality === QUALITY && m.files) previous = m.files;
  } catch {
    /* no previous manifest: everything is compressed fresh */
  }

  const files = {};
  const todo = [];
  let reused = 0;
  for (const abs of walk(assetsDir)) {
    if (!COMPRESSIBLE.test(abs)) continue;
    const buf = fs.readFileSync(abs);
    if (buf.length < MIN_BYTES) continue;
    const rel = posix(path.relative(assetsDir, abs));
    const hash = sha256(buf);
    const brPath = path.join(outAssets, rel + ".br");
    const prev = previous[rel];
    if (
      prev && prev.sha256 === hash && prev.bytes === buf.length &&
      fs.existsSync(brPath) && fs.statSync(brPath).size === prev.br
    ) {
      files[rel] = prev;
      reused++;
      continue;
    }
    todo.push({ rel, buf, hash, brPath });
  }

  let compressed = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const br = await brotli(job.buf);
        // Never keep a copy that is not smaller: the per-request path is as good.
        if (br.length >= job.buf.length) continue;
        fs.mkdirSync(path.dirname(job.brPath), { recursive: true });
        fs.writeFileSync(job.brPath, br);
        files[job.rel] = { bytes: job.buf.length, sha256: job.hash, br: br.length };
        compressed++;
      }
    }),
  );

  // A copy whose source is gone (an old content hash) is dead weight in the image.
  if (fs.existsSync(outAssets)) {
    for (const abs of walk(outAssets)) {
      const rel = posix(path.relative(outAssets, abs)).replace(/\.br$/, "");
      if (!files[rel]) fs.rmSync(abs);
    }
  }

  const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
  const manifest = { version: MANIFEST_VERSION, quality: QUALITY, files: sorted };
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = manifestPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 1) + "\n");
  fs.renameSync(tmp, manifestPath);

  const raw = Object.values(sorted).reduce((a, f) => a + f.bytes, 0);
  const br = Object.values(sorted).reduce((a, f) => a + f.br, 0);
  log(
    `  dist/precompressed: ${Object.keys(sorted).length} file(s), ${Math.round(raw / 1024)} KB as ` +
      `${Math.round(br / 1024)} KB brotli-${QUALITY} (${compressed} compressed, ${reused} reused, ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s)`,
  );
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await precompressAssets({ root: path.resolve(import.meta.dirname, "..") });
}
