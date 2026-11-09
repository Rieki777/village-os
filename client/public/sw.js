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
/*
 * The images the server lifts out of the artifact (map speed plan S1,
 * server/lib/groundsSplit.ts). Each is named by a hash of its bytes, so it is
 * as immutable as the hashed page, and cached the same way so the map still
 * opens offline. Kept apart from the page so each cache prunes by its own rule.
 */
const ASSETS = "grounds-assets-v1";
const ASSET_PATH = /^\/grounds\/a\/[0-9a-f]{16}\.(?:png|jpg|webp|gif|svg)$/;

self.addEventListener("install", (event) => {
  // Nothing to precache. Take over as soon as the old worker lets go.
  self.skipWaiting();
  /*
   * AND KEEP EVERY OTHER REQUEST OFF THIS WORKER ENTIRELY.
   *
   * The fetch handler below returns early for anything that is not the
   * artifact, but returning early is not free: the browser still has to
   * start this worker for every navigation and hand it every asset and API
   * request before it can go to the network. Static routing (Chromium 123
   * and later) settles that at install time instead: /grounds/ goes to the
   * fetch handler exactly as before, and everything else goes straight to
   * the network without waking the worker. Rules are tried in order and the
   * first match wins.
   *
   * Where the API is missing (Firefox, Safari) nothing changes, and a
   * rejected rule set is swallowed so it can never fail the install.
   */
  if (typeof event.addRoutes === "function" && typeof URLPattern === "function") {
    event.waitUntil(
      event
        .addRoutes([
          { condition: { urlPattern: new URLPattern({ pathname: "/grounds/*" }) }, source: "fetch-event" },
          { condition: { urlPattern: new URLPattern({}) }, source: "network" },
        ])
        .catch(() => {}),
    );
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from an older naming scheme so an upgrade cannot leave
      // megabytes of unreachable artifact behind on someone's phone.
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE && n !== ASSETS).map((n) => caches.delete(n)));
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

  if (ASSET_PATH.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && res.status === 200 && res.type === "basic" && !res.redirected) {
          event.waitUntil(cache.put(req, res.clone()));
        }
        return res;
      })(),
    );
    return;
  }

  // Only the immutable, hashed artifact. The stable /grounds/index.html name
  // is deliberately excluded: its bytes change without its URL changing, so
  // caching it hard is exactly the stale-forever trap.
  if (!/^\/grounds\/grounds-[a-z0-9]+\.html$/i.test(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) {
        event.waitUntil(keepOnly(cache, req.url).then(() => keepNamedAssets(hit.clone())));
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
        const copy = res.clone();
        const named = res.clone();
        event.waitUntil(cache.put(req, copy).then(() => keepOnly(cache, req.url)).then(() => keepNamedAssets(named)));
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

/*
 * ONLY THE IMAGES THE CURRENT MAP STILL NAMES.
 *
 * The same leak as above, one level down: a deploy that changes one sprite
 * gives it a new name, and the old one would otherwise sit on the phone
 * forever. The page just served is the one the manifest names, so whatever
 * image it no longer mentions can never be asked for again.
 */
async function keepNamedAssets(pageResponse) {
  let text;
  try { text = await pageResponse.text(); } catch { return; }
  const cache = await caches.open(ASSETS);
  for (const key of await cache.keys()) {
    let p;
    try { p = new URL(key.url).pathname; } catch { continue; }
    if (!text.includes(p)) await cache.delete(key);
  }
}
