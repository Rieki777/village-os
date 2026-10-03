/*
 * The smallest service worker that earns its keep.
 *
 * It handles ONE thing: the Living Map artifact, which is ~4 MB and served
 * from a content-hashed, immutable URL. Cache-first there means a member who
 * has opened the map once opens it instantly forever, and offline, and the
 * hash in the name makes a stale hit impossible: new bytes, new URL, new
 * cache entry.
 *
 * EVERYTHING ELSE PASSES THROUGH UNTOUCHED. No app-shell precache, no
 * navigation fallback, no API caching. A service worker that intercepts
 * broadly is a service worker that can serve a village yesterday's data or
 * strand it on a build that no longer exists, and the failure mode is a site
 * that looks broken with no way for the member to force a refresh. The narrow
 * version cannot do that.
 *
 * Installability comes from having a manifest and a registered worker; it
 * does not require caching the whole app, so we do not.
 */
const CACHE = "grounds-v1";

self.addEventListener("install", () => {
  // Nothing to precache. Take over as soon as the old worker lets go.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from an older naming scheme so an upgrade cannot leave
      // megabytes of unreachable artifact behind on someone's phone.
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  // Only the immutable, hashed artifact. The stable /grounds/index.html name
  // is deliberately excluded: its bytes change without its URL changing, so
  // caching it hard is exactly the stale-forever trap.
  if (!/^\/grounds\/grounds-[a-z0-9]+\.html$/i.test(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) {
        event.waitUntil(keepOnly(cache, req.url));
        return hit;
      }
      const res = await fetch(req);
      /*
       * Only a clean, complete response is worth keeping, and only under its
       * own name. A redirected one is the current version answering a stale
       * hash: kept, it would sit under the wrong key, and the prune below
       * would then throw the real current copy away in its favour.
       */
      if (res && res.status === 200 && res.type === "basic" && !res.redirected) {
        event.waitUntil(cache.put(req, res.clone()).then(() => keepOnly(cache, req.url)));
      }
      return res;
    })(),
  );
});

/*
 * ONE VERSION OF THE MAP PER DEVICE.
 *
 * The cache name never changes, so the activate step above never cleans it,
 * and every deploy that touched the artifact used to add one more ~5.4 MB copy
 * under a new hash. On 2026-10-01 a local run of three real versions held
 * three copies and 16.3 MB, and nothing ever came back down.
 *
 * Only the version the manifest names can ever be asked for: an older hash is
 * answered with a redirect to the current one, and this worker does not cache
 * the shell, so an older copy is unreachable the moment a newer one is
 * requested. Whatever was just served stays and everything else goes. Pruning
 * on a hit as well as after a fresh put is what clears a device that already
 * holds several copies, on its next visit, without downloading anything.
 *
 * Compared WITHOUT the fragment. The shell opens the map at an address
 * (`#skipIntro`, `#/place/greenhouse&skipIntro`), a request keeps its
 * fragment, and the cache matches without one. Comparing whole URLs deleted
 * the copy being served whenever two visits arrived at different addresses,
 * which would have downloaded the map again on nearly every visit.
 *
 * Inside `waitUntil`, because the worker may be stopped as soon as the
 * response is handed over, and a put or a delete cut off halfway is the
 * leak this replaces.
 */
async function keepOnly(cache, keepUrl) {
  const bare = (u) => u.split("#")[0];
  for (const key of await cache.keys()) {
    if (bare(key.url) !== bare(keepUrl)) await cache.delete(key);
  }
}
