/**
 * S2 STEP 1, ON THE REAL ROUTES: THE MAP PAGE SWITCHES TO WEBP IMAGES ONCE THE
 * BACKGROUND PASS IS DONE, AND NOTHING A CLIENT ALREADY HOLDS STOPS WORKING.
 *
 * Runs server/routes/grounds.ts on a real Express app with a real PNG sprite
 * embedded in the artifact, so sharp genuinely re-encodes it. Before the pass
 * finishes the page is the S1 page; after, the manifest names a new hashed
 * page that names the WebP. The S1 page's URL and its PNG keep answering,
 * because a phone may hold either for a year.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import express from "express";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadModuleSettings, wireModuleAuth } from "../lib/modules";
import { register, type GroundsRoutes } from "./grounds";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grounds-webp-"));
const groundsFile = path.join(dir, "grounds-v0.html");

let base = "";
let server: ReturnType<express.Express["listen"]> | undefined;
let routes: GroundsRoutes;
let s1: { url: string; page: string; png: string };

const get = (p: string) => fetch(base + p, { redirect: "manual" }); // module-review-ok: the test client dialling its own in-process server on localhost

beforeAll(async () => {
  const w = 120, h = 100, raw = Buffer.alloc(w * h * 4);
  for (let i = 0; i < raw.length; i += 4) { raw[i] = (i / 4) % 251; raw[i + 1] = 140; raw[i + 2] = 90; raw[i + 3] = (i / 4) % w < 10 ? 0 : 255; }
  const png = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  fs.writeFileSync(groundsFile, "<!doctype html><p>drawing code</p><script>window.SPRITES={barn:'data:image/png;base64," + png.toString("base64") + "'}</script>");

  await loadModuleSettings({ query: async () => [[{ module_id: "map", lifecycle: "public", config: null, updated_at: null }], []] } as any);
  wireModuleAuth({ isAdmin: async () => false, isAuthed: async () => false, meterUserId: () => null });
  const app = express();
  routes = register(app, { groundsFile });
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;

  // The first read starts the pass; it serves the S1 page while the pass runs.
  const url = (await (await get("/grounds/manifest.json")).json()).url as string;
  const page = await (await get(url)).text();
  s1 = { url, page, png: page.match(/\/grounds\/a\/[0-9a-f]{16}\.png/)![0] };
  await routes.webpReady();
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the map page after the WebP pass", () => {
  it("is named by a new hashed URL, which names a WebP where the PNG was", async () => {
    const url = (await (await get("/grounds/manifest.json")).json()).url as string;
    expect(url).not.toBe(s1.url);
    expect(url).toMatch(/^\/grounds\/grounds-[0-9a-f]{12}\.html$/);
    const page = await (await get(url)).text();
    expect(page).toMatch(/\/grounds\/a\/[0-9a-f]{16}\.webp/);
    expect(page).not.toContain(s1.png);
    expect(page).toContain("drawing code");
    expect((await get("/grounds/index.html").then((r) => r.text()))).toBe(page);
  });

  it("serves the WebP as image/webp, cached for a year", async () => {
    const url = (await (await get("/grounds/manifest.json")).json()).url as string;
    const webp = (await (await get(url)).text()).match(/\/grounds\/a\/[0-9a-f]{16}\.webp/)![0];
    const res = await get(webp);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).format).toBe("webp");
  });

  it("still answers the S1 page's URL and its PNG, for a phone that cached them", async () => {
    const page = await get(s1.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(s1.page);
    const png = await get(s1.png);
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
  });

  it("redirects a hash it never served to the current page", async () => {
    const res = await get("/grounds/grounds-000000000000.html");
    expect(res.status).toBe(302);
    const url = (await (await get("/grounds/manifest.json")).json()).url as string;
    expect(res.headers.get("location")).toBe(url);
  });
});
