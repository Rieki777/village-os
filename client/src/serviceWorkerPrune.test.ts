/**
 * THE SERVICE WORKER KEEPS ONE COPY OF THE MAP, NOT ONE PER DEPLOY.
 *
 * `client/public/sw.js` caches the content-hashed artifact under a cache name
 * that never changes, so its activate step never cleaned it, and each deploy
 * that touched the artifact added another ~5.4 MB copy under a new hash. On
 * 2026-10-01 three real versions left three copies and 16.3 MB on one device.
 *
 * This runs the real file in a `vm` context against a small in-memory Cache
 * Storage that matches the way the real one does: without the fragment. That
 * detail is load-bearing. The shell opens the map at an address
 * (`#skipIntro`, `#/place/greenhouse&skipIntro`), and a prune that compared
 * whole URLs threw away the copy it was serving whenever two visits arrived at
 * different addresses. The second case below is that trap.
 *
 * WHAT THIS CANNOT SEE: a real browser's quota accounting, and the worker's
 * lifecycle. Both were measured in Chromium (three versions in turn, one key
 * after each; a device already holding four copies down to one after a
 * single visit under the new worker).
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { describe, expect, it } from "vitest";

const SW = fs.readFileSync(path.resolve(__dirname, "../public/sw.js"), "utf8");
const ORIGIN = "https://village.test";
const at = (hash: string, fragment = "#skipIntro") => `${ORIGIN}/grounds/grounds-${hash}.html${fragment}`;
const bare = (u: string) => u.split("#")[0];

interface FakeResponse {
  status: number;
  type: string;
  redirected: boolean;
  body: string;
  clone(): FakeResponse;
}
const response = (body: string, redirected = false): FakeResponse => ({
  status: 200,
  type: "basic",
  redirected,
  body,
  clone() {
    return response(body, redirected);
  },
});

/** Cache Storage, matching without the fragment as the real one does. */
function fakeCaches() {
  const stores = new Map<string, Map<string, { url: string; res: FakeResponse }>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const s = stores.get(name)!;
    return {
      async match(req: { url: string }) {
        return s.get(bare(req.url))?.res;
      },
      async put(req: { url: string }, res: FakeResponse) {
        s.set(bare(req.url), { url: req.url, res });
      },
      async keys() {
        return [...s.values()].map((e) => ({ url: e.url }));
      },
      async delete(req: { url: string }) {
        return s.delete(bare(req.url));
      },
    };
  };
  return {
    api: { open, keys: async () => [...stores.keys()], delete: async (n: string) => stores.delete(n) },
    urls: (name: string) => [...(stores.get(name)?.values() ?? [])].map((e) => bare(e.url)),
    names: () => [...stores.keys()],
  };
}

function worker(serve: (url: string) => FakeResponse) {
  const handlers: Record<string, (ev: unknown) => void> = {};
  const caches = fakeCaches();
  const network: string[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (ev: unknown) => void) => {
      handlers[type] = fn;
    },
    skipWaiting() {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(SW, {
    self,
    caches: caches.api,
    URL,
    fetch: async (req: { url: string }) => {
      network.push(bare(req.url));
      return serve(req.url);
    },
  });
  /** One iframe navigation to `url`, run to the end of every waitUntil. */
  const visit = async (url: string) => {
    const pending: Promise<unknown>[] = [];
    let answer: Promise<FakeResponse> | undefined;
    handlers.fetch({
      request: { method: "GET", url },
      respondWith: (p: Promise<FakeResponse>) => {
        answer = p;
        pending.push(p);
      },
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p);
      },
    });
    const res = await answer;
    // A waitUntil may be added while respondWith's promise is still running.
    for (let i = 0; i < pending.length; i++) await pending[i];
    return res;
  };
  const cacheName = /const CACHE = "([^"]+)"/.exec(SW)?.[1] ?? "";
  return { visit, network, cached: () => caches.urls(cacheName), cacheName };
}

describe("the map's service worker", () => {
  it("names the cache this test reads (the positive control)", () => {
    expect(worker(() => response("x")).cacheName).not.toBe("");
  });

  it("keeps only the version it last served, deploy after deploy", async () => {
    const w = worker((url) => response(url));
    const seen: number[] = [];
    for (const hash of ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"]) {
      await w.visit(at(hash));
      seen.push(w.cached().length);
      expect(w.cached(), `after deploying ${hash}`).toEqual([bare(at(hash))]);
    }
    expect(seen).toEqual([1, 1, 1]);
  });

  it("serves the cached copy to a visit at another address, and keeps it", async () => {
    const w = worker((url) => response(url));
    await w.visit(at("cccccccccccc", "#skipIntro"));
    const res = await w.visit(at("cccccccccccc", "#/place/greenhouse&skipIntro"));
    expect(res?.body, "served from the cache").toBe(at("cccccccccccc", "#skipIntro"));
    expect(w.network, "the second visit downloaded nothing").toEqual([bare(at("cccccccccccc"))]);
    expect(w.cached()).toEqual([bare(at("cccccccccccc"))]);
  });

  it("never stores the current version under a stale hash's name", async () => {
    const current = at("cccccccccccc");
    const w = worker((url) => response(current, url.includes("000000000000")));
    await w.visit(current);
    await w.visit(at("000000000000"));
    expect(w.cached(), "a redirected answer is not kept, and does not evict the real copy").toEqual([bare(current)]);
  });
});
