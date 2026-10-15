/**
 * The stock character art answers at the URL every caller computes, from the
 * server, with no volume involved.
 *
 * The drawings left `client/public` (2026-10-13) so they stop counting against
 * the client budget. What that move must not do is change a single URL: the
 * server (`avatarFor`), the role sheet (`portraitFor`) and the picker all build
 * `/images/avatars/<class>-<f|m>-<tone>.webp` at read time, and pages already in
 * browsers ask for exactly that. So every URL here is produced by the real
 * helpers, never typed, and every one is asked of the real directory.
 *
 * No database, no built bundle, no DATA_DIR: the route reads nothing but its
 * own directory, which is the property that makes it work the same on a fresh
 * fork, an instance with no volume, and an upgraded village whose volume never
 * held the art. `server/hygiene.routes.e2e.test.ts` asks the same of the BUILT
 * server, booted on an empty data directory.
 */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { register, STOCK_AVATAR_DIR, STOCK_AVATAR_URL } from "./stockAvatars";
import { ARCHETYPE_KEYS, PRESENTATIONS, TONES, avatarFor } from "../lib/characters";
import { portraitFor } from "../../shared/roleSheet";

const ROOT = process.cwd();
const DIR = path.resolve(ROOT, STOCK_AVATAR_DIR);

/** An app shaped like the real one: the art, then the `/images/` miss rule. */
async function serve(dir: string): Promise<{ base: string; server: Server }> {
  const app = express();
  register(app, { dir });
  app.use((_req, res) => res.status(404).type("text/plain").send("Not found"));
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

let base = "";
let server: Server | undefined;

beforeAll(async () => {
  ({ base, server } = await serve(DIR));
});

afterAll(async () => {
  await new Promise((r) => server?.close(r));
});

/** Every URL a member's browser can be handed, built by the code that hands it out. */
function everyComputedUrl(): string[] {
  const urls = new Set<string>();
  for (const a of ARCHETYPE_KEYS) {
    for (const p of PRESENTATIONS) {
      for (const t of TONES) {
        const u = avatarFor(a, p, t);
        if (u) urls.add(u);
      }
    }
  }
  for (let i = 0; i < 40; i++) {
    const p = portraitFor({ id: `seat-${i}`, name: "Seat" }, [ARCHETYPE_KEYS[i % ARCHETYPE_KEYS.length]]);
    if (p.kind === "class") urls.add(p.src);
  }
  return [...urls].sort();
}

describe("stock character art", () => {
  it("lives outside the client bundle, so dist/public no longer pays for it", () => {
    expect(fs.existsSync(path.join(ROOT, "client/public/images/avatars"))).toBe(false);
    const files = fs.readdirSync(DIR);
    expect(files.filter((f) => f.endsWith(".webp"))).toHaveLength(30);
    expect(files).toContain("manifest.json");
  });

  it("serves every URL the server, the role sheet and the picker compute", async () => {
    const urls = everyComputedUrl();
    // All thirty, which also proves the helpers still agree with the files.
    expect(urls).toHaveLength(30);
    // The picker's own template (client/src/pages/Characters.tsx), spelled out.
    urls.push(`${STOCK_AVATAR_URL}/catalyzing-m-olive.webp`);
    for (const u of urls) {
      const res = await fetch(base + u); // module-review-ok: the test client dialling its own in-process server on localhost
      expect(res.status, u).toBe(200);
      expect(res.headers.get("content-type"), u).toBe("image/webp");
      expect(res.headers.get("cache-control"), u).toBe("public, max-age=86400");
      expect(res.headers.get("etag"), u).toBeTruthy();
      const bytes = Buffer.from(await res.arrayBuffer());
      const onDisk = fs.readFileSync(path.join(DIR, path.basename(u)));
      expect(bytes.equals(onDisk), `${u} is the file on disk`).toBe(true);
    }
  });

  it("still answers the generator's manifest at its old address", async () => {
    const res = await fetch(`${base}${STOCK_AVATAR_URL}/manifest.json`); // module-review-ok: the test client dialling its own in-process server on localhost
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/);
  });

  it("revalidates for free: a repeat visit with the ETag is a 304", async () => {
    const u = `${base}${STOCK_AVATAR_URL}/building-f-deep.webp`;
    const etag = (await fetch(u)).headers.get("etag") ?? ""; // module-review-ok: the test client dialling its own in-process server on localhost
    // fetch adds `Cache-Control: no-cache` to any conditional request it is
    // handed, which tells the server to ignore the ETag. A browser revalidating
    // a stale entry sends max-age=0, so say that.
    const again = await fetch(u, { headers: { "If-None-Match": etag, "Cache-Control": "max-age=0" } }); // module-review-ok: the test client dialling its own in-process server on localhost
    expect(again.status).toBe(304);
  });

  it("passes a miss and a climb to the next handler, never a file outside the directory", async () => {
    for (const u of [
      `${STOCK_AVATAR_URL}/necromancing-f-deep.webp`,
      `${STOCK_AVATAR_URL}/..%2f..%2f..%2fpackage.json`,
      `${STOCK_AVATAR_URL}/%2e%2e/%2e%2e/%2e%2e/package.json`,
      `${STOCK_AVATAR_URL}/`,
    ]) {
      const res = await fetch(base + u); // module-review-ok: the test client dialling its own in-process server on localhost
      expect(res.status, u).toBe(404);
      expect(await res.text(), u).toBe("Not found");
    }
  });

  it("boots and falls through when its directory is missing, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const gone = await serve(path.join(ROOT, "server", "assets", "no-such-dir"));
    try {
      expect(warn.mock.calls.flat().join(" ")).toMatch(/\[avatars\].*missing/);
      const res = await fetch(`${gone.base}${STOCK_AVATAR_URL}/building-f-deep.webp`); // module-review-ok: the test client dialling its own in-process server on localhost
      expect(res.status).toBe(404);
    } finally {
      warn.mockRestore();
      await new Promise((r) => gone.server.close(r));
    }
  });

  it("is copied into the runtime image beside the other files the server reads", () => {
    // A local tripwire only: selfhost-smoke.yml builds the image and fetches
    // one drawing from it, which is the real proof.
    const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^COPY --from=build \/app\/server\/assets \.\/server\/assets\s*$/m);
  });
});
