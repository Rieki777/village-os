/**
 * The theme stylesheet over real HTTP: a link that names the current version
 * may be kept for good, and anything else must check back.
 *
 * WHY THIS IS PINNED. Cloudflare's default Browser Cache TTL held the bare
 * /api/brand/theme.css for four hours whatever `no-cache` said, so a brand
 * saved in Admin did not show on the village until the cache let go. The fix
 * versions the URL (server/routes/brandTheme.ts); these cases hold the four
 * answers that make it safe: a year only for the version that is current, and
 * today's revalidate-always for a stale version or none, with the ETag and
 * its 304 kept.
 *
 * Mounted on a bare Express app on port 0, so the headers are the ones a
 * browser and a cache in front of it really receive.
 */
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildThemeCss, themeCssVersion } from "./lib/themeCss";
import { register, shellWithTheme } from "./routes/brandTheme";

const BRAND = { theme: { fontDisplay: '"Cormorant Garamond", serif', fontBody: '"Jost", sans-serif' } };
let brand: unknown = BRAND;
const getBrand = () => brand;

let server: http.Server;
let base = "";

beforeAll(async () => {
  const app = express();
  register(app, { getBrand });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const current = () => themeCssVersion(buildThemeCss(BRAND.theme));

describe("GET /api/brand/theme.css", () => {
  it("lets a link naming the current version keep the bytes for a year", async () => {
    const res = await fetch(`${base}/api/brand/theme.css?v=${current()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe(`"${current()}"`);
    expect(res.headers.get("content-type")).toMatch(/^text\/css/);
    expect(await res.text()).toBe(buildThemeCss(BRAND.theme));
  });

  it("sends a stale version current CSS that it must check again", async () => {
    const res = await fetch(`${base}/api/brand/theme.css?v=0000000000000000`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toBe(buildThemeCss(BRAND.theme));
  });

  it("answers the bare link the way it always did", async () => {
    const res = await fetch(`${base}/api/brand/theme.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    // The ETag is the same hash the shell's link carries.
    expect(res.headers.get("etag")).toBe(`"${current()}"`);
  });

  it("answers 304 to a browser that already holds these bytes", async () => {
    const res = await fetch(`${base}/api/brand/theme.css`, { headers: { "If-None-Match": `"${current()}"` } });
    expect(res.status).toBe(304);
  });

  it("moves the shell's link and the stylesheet together when the brand moves", async () => {
    const shell = '<link rel="stylesheet" href="/api/brand/theme.css" />';
    const before = shellWithTheme(shell, getBrand);
    expect(before).toContain(`?v=${current()}"`);
    brand = { theme: { ...BRAND.theme, fontAccent: '"Pinyon Script", cursive' } };
    try {
      const after = shellWithTheme(shell, getBrand);
      expect(after).not.toBe(before);
      const v = /\?v=([0-9a-f]{16})"/.exec(after)?.[1];
      expect(v).toBeTruthy();
      const res = await fetch(`${base}/api/brand/theme.css?v=${v}`);
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      // The old version is now stale, so a cache can never hold the new bytes under it.
      const old = await fetch(`${base}/api/brand/theme.css?v=${current()}`);
      expect(old.headers.get("cache-control")).toBe("no-cache");
    } finally {
      brand = BRAND;
    }
  });

  it("reads a brand document with no theme as the untouched fork", async () => {
    brand = {};
    try {
      const res = await fetch(`${base}/api/brand/theme.css`);
      expect(await res.text()).toBe("");
      expect(res.headers.get("etag")).toBe(`"${themeCssVersion("")}"`);
    } finally {
      brand = BRAND;
    }
  });
});
