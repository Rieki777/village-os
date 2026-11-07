/**
 * GET /api/i18n/catalog/:locale and GET /api/i18n/locales (internal spec i18n,
 * plan §1.1, §8 R16, R35). The catalogs are compiled from scratch PO files by
 * the real build step, then served by the real route.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error -- a build script in plain JS, no declarations
import { compileCatalogs } from "../scripts/build-i18n-catalogs.mjs";
import { register } from "./routes/i18n";

let server: http.Server;
let base = "";
let pseudoAllowed = false;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-route-"));
  const src = path.join(dir, "locales");
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, "en.po"), 'msgid ""\nmsgstr ""\n"Language: en\\n"\n\nmsgid "Sign in"\nmsgstr "Sign in"\n');
  fs.writeFileSync(path.join(src, "es.po"), 'msgid ""\nmsgstr ""\n"Language: es\\n"\n\n#, fuzzy\nmsgid "Sign in"\nmsgstr "Iniciar sesión"\n');
  const out = path.join(dir, "out");
  await compileCatalogs({ srcDir: src, outDir: out });

  const app = express();
  register(app, { catalogDir: out, pseudoAllowed: () => pseudoAllowed });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Every request in this file goes to the test server above, on 127.0.0.1. */
const get = (p: string, init?: RequestInit) => fetch(`${base}${p}`, init); // module-review-ok: a test calling its own local server, never an outside host

describe("GET /api/i18n/catalog/:locale", () => {
  it("serves the compiled catalog keyed by the client macro's ids, with the unreviewed ids", async () => {
    const res = await get("/api/i18n/catalog/es");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body.messages[generateMessageId("Sign in")])).toContain("Iniciar sesión");
    expect(body.unreviewed).toEqual([generateMessageId("Sign in")]);
    expect(res.headers.get("etag")).toBe(`"${body.version}"`);
  });

  it("lets a request naming the current version keep it for a year, and revalidates anything else", async () => {
    const { version } = await (await get("/api/i18n/catalog/es")).json();
    const pinned = await get(`/api/i18n/catalog/es?v=${version}`);
    expect(pinned.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const bare = await get("/api/i18n/catalog/es");
    expect(bare.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    const again = await get("/api/i18n/catalog/es", { headers: { "if-none-match": `"${version}"` } });
    expect(again.status).toBe(304);
  });

  it("answers a language it does not offer with an empty catalog and 200, never a 404 (V.10)", async () => {
    for (const tag of ["de", "xx", "..%2f..%2fetc", "en"]) {
      const res = await get(`/api/i18n/catalog/${tag}`);
      expect(res.status).toBe(200);
      expect((await res.json()).messages).toEqual({});
    }
  });

  it("serves the pseudo locales only where they are allowed", async () => {
    pseudoAllowed = false;
    expect((await (await get("/api/i18n/catalog/en-XA")).json()).messages).toEqual({});
    pseudoAllowed = true;
    const body = await (await get("/api/i18n/catalog/en-XA")).json();
    expect(JSON.stringify(body.messages[generateMessageId("Sign in")])).toContain("[");
    pseudoAllowed = false;
  });
});

describe("GET /api/i18n/locales", () => {
  it("lists the offered languages with their tier, without pseudo locales unless allowed", async () => {
    const body = await (await get("/api/i18n/locales")).json();
    expect(body.locales).toContainEqual({ tag: "en", tier: "source", dir: "ltr" });
    expect(body.locales).toContainEqual({ tag: "es", tier: "reviewed", dir: "ltr" });
    expect(body.locales.some((l: { tier: string }) => l.tier === "pseudo")).toBe(false);
  });
});
