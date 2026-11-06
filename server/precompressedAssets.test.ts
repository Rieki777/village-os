/**
 * /assets at brotli 11: the build writes the copies, the server checks them
 * and serves them, and every doubt falls back to what ran before.
 *
 * WHY THIS IS PINNED. compression() encodes /assets at brotli quality 4 per
 * request and Cloudflare keeps those bytes for a year, so on production at
 * a5905b4 the main bundle reached members 18% larger than quality 11 makes it
 * (187,755 against 159,369 bytes). scripts/precompress-assets.mjs writes the
 * quality 11 copies at build time and server/lib/precompressedAssets.ts serves
 * them. These cases hold the three things that make that safe:
 *
 *   1. it is SMALLER than the path it replaces, measured here against the
 *      real compression() middleware on the same file;
 *   2. it answers with the headers express.static would have sent, so no
 *      cache, browser or Cloudflare, sees a different object;
 *   3. it can never serve bytes the file on disk does not hold: a changed
 *      source, a corrupt copy, a missing manifest, a Range request or a
 *      client that prefers another coding all fall through to the old path.
 *
 * The app below is the static block of server/index.ts in miniature:
 * compression() first, then this middleware, then express.static with the
 * same options, on a bare Express app on port 0. Requests go through
 * node:http so the bytes compared are the encoded bytes on the wire.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import compression from "compression";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IMMUTABLE_YEAR, precompressedAssets, prefersBrotli, readManifest } from "./lib/precompressedAssets";
// @ts-expect-error - scripts/ is untyped JavaScript, deliberately outside tsconfig
import { precompressAssets } from "../scripts/precompress-assets.mjs";

/** Text that compresses like a bundle does: repetitive, but not one repeated line. */
function bundleLike(seed: number, kb: number): string {
  const words = ["const", "function", "return", "export", "import", "props", "state", "village", "member", "useEffect", "className", "children"];
  const out: string[] = [];
  let x = seed;
  while (out.join("").length < kb * 1024) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const w = words[x % words.length];
    out.push(`${w}_${x % 997}(${(x >> 8) % 13}, "${w}${x % 31}");\n`);
  }
  return out.join("");
}

let root = "";
let assetsDir = "";
let preDir = "";
const logs: string[] = [];

type Raw = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
function rawGet(base: string, p: string, headers: Record<string, string> = {}, method = "GET"): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${p}`, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

function appWith(precompressed: boolean): express.Express {
  const app = express();
  app.use(compression());
  if (precompressed) {
    app.use("/assets", precompressedAssets({ assetsDir, precompressedDir: preDir, log: (l) => logs.push(l) }));
  }
  app.use("/assets", express.static(assetsDir, { maxAge: "1y", immutable: true }));
  return app;
}

const servers: http.Server[] = [];
async function listen(app: express.Express): Promise<string> {
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
  return `http://127.0.0.1:${addr.port}`;
}

let after = ""; // compression + precompressed + static: the change
let before = ""; // compression + static: what production runs at a5905b4

const BR = { "Accept-Encoding": "gzip, deflate, br, zstd" }; // what Chrome sends

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "precompressed-"));
  assetsDir = path.join(root, "dist", "public", "assets");
  preDir = path.join(root, "dist", "precompressed");
  fs.mkdirSync(path.join(assetsDir, "images"), { recursive: true });
  fs.writeFileSync(path.join(assetsDir, "index-AbC123.js"), bundleLike(1, 96));
  fs.writeFileSync(path.join(assetsDir, "index-DeF456.css"), bundleLike(2, 48).replace(/;/g, "}"));
  fs.writeFileSync(path.join(assetsDir, "Route-GhI789.js"), bundleLike(3, 8));
  fs.writeFileSync(path.join(assetsDir, "unlisted-JkL000.js"), bundleLike(4, 32)); // removed from the manifest below: compression() decides it
  fs.writeFileSync(path.join(assetsDir, "tiny-MnO111.js"), "export const a = 1;\n");
  fs.writeFileSync(path.join(assetsDir, "font-PqR222.woff2"), Buffer.alloc(4096, 7));
  fs.writeFileSync(path.join(assetsDir, "images", "logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg">${"<rect/>".repeat(400)}</svg>`);
  await precompressAssets({ root, log: (l: string) => logs.push(l) });
  // The control file must stay on disk but leave the manifest, so the real
  // compression() negotiates it and can be read as the oracle.
  const m = JSON.parse(fs.readFileSync(path.join(preDir, "manifest.json"), "utf8"));
  delete m.files["unlisted-JkL000.js"];
  fs.writeFileSync(path.join(preDir, "manifest.json"), JSON.stringify(m));
  after = await listen(appWith(true));
  before = await listen(appWith(false));
});

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  fs.rmSync(root, { recursive: true, force: true });
});

describe("scripts/precompress-assets.mjs", () => {
  it("writes a copy for every compressible file over the threshold, and none for the rest", () => {
    const m = readManifest(preDir);
    expect(m?.quality).toBe(11);
    // Read before the control was removed: the build listed it too.
    expect(fs.existsSync(path.join(preDir, "assets", "unlisted-JkL000.js.br"))).toBe(true);
    expect(Object.keys(m!.files).sort()).toEqual(["Route-GhI789.js", "images/logo.svg", "index-AbC123.js", "index-DeF456.css"]);
    // Under compression()'s 1 KB threshold, and already-compressed woff2: left alone.
    expect(fs.existsSync(path.join(preDir, "assets", "tiny-MnO111.js.br"))).toBe(false);
    expect(fs.existsSync(path.join(preDir, "assets", "font-PqR222.woff2.br"))).toBe(false);
    for (const [rel, f] of Object.entries(m!.files)) {
      const source = fs.readFileSync(path.join(assetsDir, rel));
      const br = fs.readFileSync(path.join(preDir, "assets", rel + ".br"));
      expect(f.bytes).toBe(source.length);
      expect(f.br).toBe(br.length);
      expect(zlib.brotliDecompressSync(br).equals(source)).toBe(true);
    }
  });

  it("is incremental, and drops a copy whose source is gone", async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "precompressed-inc-"));
    try {
      const dir = path.join(scratch, "dist", "public", "assets");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "a-1.js"), bundleLike(5, 4));
      fs.writeFileSync(path.join(dir, "b-2.js"), bundleLike(6, 4));
      const lines: string[] = [];
      await precompressAssets({ root: scratch, log: (l: string) => lines.push(l) });
      expect(lines.at(-1)).toMatch(/2 compressed, 0 reused/);
      await precompressAssets({ root: scratch, log: (l: string) => lines.push(l) });
      expect(lines.at(-1)).toMatch(/0 compressed, 2 reused/);
      fs.rmSync(path.join(dir, "b-2.js"));
      await precompressAssets({ root: scratch, log: (l: string) => lines.push(l) });
      expect(Object.keys(readManifest(path.join(scratch, "dist", "precompressed"))!.files)).toEqual(["a-1.js"]);
      expect(fs.existsSync(path.join(scratch, "dist", "precompressed", "assets", "b-2.js.br"))).toBe(false);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("writes nothing and says so when the client is not built", async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "precompressed-none-"));
    try {
      const lines: string[] = [];
      expect(await precompressAssets({ root: scratch, log: (l: string) => lines.push(l) })).toBeNull();
      expect(lines.join("\n")).toMatch(/skipped/);
      expect(fs.existsSync(path.join(scratch, "dist", "precompressed"))).toBe(false);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("GET /assets with the precompressed copies", () => {
  it("sends the quality 11 copy, and it is smaller than what compression() sends today", async () => {
    const now = await rawGet(after, "/assets/index-AbC123.js", BR);
    const was = await rawGet(before, "/assets/index-AbC123.js", BR);
    expect(now.status).toBe(200);
    expect(now.headers["content-encoding"]).toBe("br");
    expect(was.headers["content-encoding"]).toBe("br");
    const source = fs.readFileSync(path.join(assetsDir, "index-AbC123.js"));
    expect(zlib.brotliDecompressSync(now.body).equals(source)).toBe(true);
    expect(now.body.equals(fs.readFileSync(path.join(preDir, "assets", "index-AbC123.js.br")))).toBe(true);
    expect(Number(now.headers["content-length"])).toBe(now.body.length);
    expect(now.body.length).toBeLessThan(was.body.length);
  });

  it("carries every header express.static sends for the same file", async () => {
    for (const p of ["/assets/index-AbC123.js", "/assets/index-DeF456.css", "/assets/images/logo.svg"]) {
      const now = await rawGet(after, p, BR);
      const plain = await rawGet(before, p, { "Accept-Encoding": "identity" });
      expect(now.headers["content-encoding"], p).toBe("br");
      for (const h of ["content-type", "cache-control", "etag", "last-modified"]) {
        expect(now.headers[h], `${p} ${h}`).toBe(plain.headers[h]);
      }
      expect(now.headers["cache-control"]).toBe(IMMUTABLE_YEAR);
      expect(String(now.headers.vary)).toMatch(/accept-encoding/i);
    }
  });

  it("answers 304 to the ETag a browser already holds", async () => {
    const first = await rawGet(after, "/assets/index-AbC123.js", BR);
    const again = await rawGet(after, "/assets/index-AbC123.js", { ...BR, "If-None-Match": String(first.headers.etag) });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
  });

  it("answers HEAD with the copy's headers and no body", async () => {
    const head = await rawGet(after, "/assets/index-AbC123.js", BR, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers["content-encoding"]).toBe("br");
    expect(Number(head.headers["content-length"])).toBe(fs.statSync(path.join(preDir, "assets", "index-AbC123.js.br")).size);
    expect(head.body.length).toBe(0);
  });

  it("chooses brotli exactly where compression() would", async () => {
    const headers = [
      "gzip, deflate, br, zstd",
      "br",
      "gzip, br",
      "br;q=1.0, gzip;q=0.8",
      "gzip;q=1.0, br;q=0.5",
      "gzip",
      "identity",
      "br;q=0",
      "*",
      "*;q=0.5, gzip",
      "deflate, gzip;q=0.9, br;q=0.9",
    ];
    for (const ae of headers) {
      // The control file is not in the manifest, so compression() negotiates it.
      const oracle = await rawGet(after, "/assets/unlisted-JkL000.js", { "Accept-Encoding": ae });
      const got = await rawGet(after, "/assets/index-AbC123.js", { "Accept-Encoding": ae });
      expect(got.headers["content-encoding"] === "br", ae).toBe(oracle.headers["content-encoding"] === "br");
      expect(got.status, ae).toBe(200);
    }
    // No header at all: compression() sends identity, and so does this.
    const bare = await rawGet(after, "/assets/index-AbC123.js", {});
    expect(bare.headers["content-encoding"]).toBeUndefined();
  });

  it("leaves a Range request to express.static", async () => {
    const r = await rawGet(after, "/assets/index-AbC123.js", { ...BR, Range: "bytes=0-99" });
    expect(r.status).toBe(206);
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.body.length).toBe(100);
  });

  it("does not trip on a path the manifest does not name", async () => {
    for (const p of ["/assets/__proto__", "/assets/constructor", "/assets/..%2Fmanifest.json", "/assets/%E0%A4%A"]) {
      const r = await rawGet(after, p, BR);
      expect(r.headers["content-encoding"], p).not.toBe("br");
      expect([400, 403, 404], p).toContain(r.status);
    }
  });

  it("never serves a copy once the file on disk has changed", async () => {
    const file = path.join(assetsDir, "Route-GhI789.js");
    const original = fs.readFileSync(file);
    const first = await rawGet(after, "/assets/Route-GhI789.js", BR);
    expect(first.body.equals(fs.readFileSync(path.join(preDir, "assets", "Route-GhI789.js.br")))).toBe(true);
    try {
      // Same length, different bytes, a later mtime: only the hash can tell.
      const changed = Buffer.from(original);
      changed[10] = changed[10] === 0x41 ? 0x42 : 0x41;
      fs.writeFileSync(file, changed);
      fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
      const r = await rawGet(after, "/assets/Route-GhI789.js", BR);
      expect(r.headers["content-encoding"]).toBe("br"); // compression() encoding the new file
      expect(zlib.brotliDecompressSync(r.body).equals(changed)).toBe(true);
    } finally {
      fs.writeFileSync(file, original);
    }
  });

  it("never serves a copy that does not decompress to the file", async () => {
    const copy = path.join(preDir, "assets", "index-DeF456.css.br");
    const good = fs.readFileSync(copy);
    // A fresh middleware, so the corrupt copy is the first one it ever reads.
    const corrupt = Buffer.from(good);
    corrupt[corrupt.length >> 1] ^= 0xff;
    fs.writeFileSync(copy, corrupt);
    try {
      const base = await listen(appWith(true));
      const r = await rawGet(base, "/assets/index-DeF456.css", BR);
      expect(r.status).toBe(200);
      expect(zlib.brotliDecompressSync(r.body).equals(fs.readFileSync(path.join(assetsDir, "index-DeF456.css")))).toBe(true);
      expect(r.body.equals(corrupt)).toBe(false);
    } finally {
      fs.writeFileSync(copy, good);
    }
  });

  it("is a pass-through, and says so, when the build wrote no manifest", async () => {
    const lines: string[] = [];
    const app = express();
    app.use(compression());
    app.use("/assets", precompressedAssets({ assetsDir, precompressedDir: path.join(root, "nowhere"), log: (l) => lines.push(l) }));
    app.use("/assets", express.static(assetsDir, { maxAge: "1y", immutable: true }));
    const base = await listen(app);
    const now = await rawGet(base, "/assets/index-AbC123.js", BR);
    const was = await rawGet(before, "/assets/index-AbC123.js", BR);
    expect(now.body.equals(was.body)).toBe(true);
    expect(lines.join("\n")).toMatch(/encoded per request/);
  });
});

describe("prefersBrotli", () => {
  it("reads quality values the way a negotiator does", () => {
    expect(prefersBrotli(undefined)).toBe(false);
    expect(prefersBrotli("")).toBe(false);
    expect(prefersBrotli("gzip, deflate, br, zstd")).toBe(true);
    expect(prefersBrotli("BR")).toBe(true);
    expect(prefersBrotli("br;q=0")).toBe(false);
    expect(prefersBrotli("gzip;q=1, br;q=0.5")).toBe(false);
    expect(prefersBrotli("br;q=0.5, identity")).toBe(false);
    expect(prefersBrotli("*")).toBe(true);
    expect(prefersBrotli("*;q=0, gzip")).toBe(false);
    expect(prefersBrotli(["gzip", "br"])).toBe(true);
  });
});
