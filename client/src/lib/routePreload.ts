/**
 * START A ROUTE'S OWN CHUNK WITH THE BUNDLE, NOT AFTER IT.
 *
 * BUILD-TIME ONLY. `vite.config.ts` imports this to write a tiny script into
 * `dist/public`; nothing in the app imports it, so it never ships in a chunk.
 * It lives under client/src so `pnpm check` type-checks it.
 *
 * Almost every page is `lazy()` (the rule is in App.tsx), which is right: a
 * visitor downloads the shell plus the one page they asked for. The cost is
 * WHEN that page arrives. The browser learns the page's file name only by
 * running the main bundle, so on a first visit the page chunk is requested
 * after the bundle has downloaded AND executed: one more full round trip in
 * series, on exactly the visit where every round trip hurts most.
 *
 * The page for a URL is already known at build time. So the build emits a
 * small script, loaded `async` beside the bundle, that reads `location`,
 * finds the first route that matches (wouter's Switch takes the first match
 * too, and the table keeps App.tsx's order), and adds `modulepreload` links for
 * that page's chunk and the chunks it imports. When the bundle later runs and
 * calls `import()`, the module is already there, and Vite's own preload helper
 * sees the links and does not ask again.
 *
 * WHAT IT CANNOT GET WRONG, by construction:
 *  - A path no route matches preloads nothing. A route this parser cannot read
 *    preloads nothing. Either way the page loads exactly as it did before.
 *  - Files the entry already loads (index.html names them) are never listed.
 *  - Every link it adds is a hint. A wrong one costs bytes, never correctness.
 *
 * External, not inline: a script-src CSP that allows 'self' allows it with no
 * hash to keep in step with each build.
 */

export interface LazyRoute {
  /** The wouter pattern, exactly as App.tsx declares it. */
  path: string;
  /** The page module, relative to client/src and without extension: "pages/Quests". */
  module: string;
}

/**
 * The routes App.tsx serves from a lazily loaded page, in declaration order.
 *
 * Reads the two shapes App.tsx uses, `const X = lazyPage(() => import("./pages/Y"))`
 * (or `brochurePage(...)`, or `lazy(...)`) and `<Route path="/p" component={X} />`.
 * A route whose component is eager (Home, Login, NotFound) is left out: it is
 * already in the main bundle.
 */
export function lazyRoutesFromApp(appSource: string): LazyRoute[] {
  const loaders = new Map<string, string>();
  const decl = /const\s+(\w+)\s*=\s*(?:lazyPage|brochurePage|lazy)\(\s*\(\)\s*=>\s*import\(\s*["']\.\/([\w/.-]+?)(?:\.tsx?)?["']\s*\)/g;
  for (const m of appSource.matchAll(decl)) loaders.set(m[1], m[2]);
  const routes: LazyRoute[] = [];
  const route = /<Route\s+path=["']([^"']+)["']\s+component=\{(\w+)\}\s*\/>/g;
  for (const m of appSource.matchAll(route)) {
    const module = loaders.get(m[2]);
    if (module) routes.push({ path: m[1], module });
  }
  return routes;
}

/** A wouter pattern as a RegExp source: `:param` is one segment, trailing slash optional. */
export function routePattern(path: string): string {
  const body = path
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/")
    .replace(/\/$/, "");
  return `^${body}/?$`;
}

/** The facts this needs about one emitted chunk, read off Rollup's bundle. */
export interface ChunkFacts {
  fileName: string;
  /** Static imports, as emitted file names. */
  imports: readonly string[];
  isEntry: boolean;
  isDynamicEntry: boolean;
  /** The module the chunk stands for, an absolute path, or null. */
  facadeModuleId: string | null;
  /** CSS files this chunk pulls in. */
  css: readonly string[];
}

export interface RoutePreloadTable {
  /** Every file any route preloads, each once. */
  files: string[];
  /** [RegExp source, indexes into `files`], in route order. */
  routes: Array<[string, number[]]>;
}

/** "C:\\x\\client\\src\\pages\\Quests.tsx" -> "pages/Quests" (null outside client/src). */
export function moduleKey(facadeModuleId: string): string | null {
  const unix = facadeModuleId.split("?")[0].replace(/\\/g, "/");
  const at = unix.lastIndexOf("/client/src/");
  if (at < 0) return null;
  return unix.slice(at + "/client/src/".length).replace(/\.[cm]?[jt]sx?$/, "");
}

export function routePreloadTable(routes: readonly LazyRoute[], chunks: readonly ChunkFacts[]): RoutePreloadTable {
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const closure = (start: ChunkFacts): ChunkFacts[] => {
    const seen = new Map<string, ChunkFacts>();
    const walk = (c: ChunkFacts) => {
      if (seen.has(c.fileName)) return;
      seen.set(c.fileName, c);
      for (const f of c.imports) {
        const next = byFile.get(f);
        if (next) walk(next);
      }
    };
    walk(start);
    return [...seen.values()];
  };
  // What index.html already loads: the entry and everything it imports statically.
  const loaded = new Set<string>();
  for (const e of chunks.filter((c) => c.isEntry)) {
    for (const c of closure(e)) {
      loaded.add(c.fileName);
      for (const css of c.css) loaded.add(css);
    }
  }
  const byModule = new Map<string, ChunkFacts>();
  for (const c of chunks) {
    if (!c.isDynamicEntry || !c.facadeModuleId) continue;
    const key = moduleKey(c.facadeModuleId);
    if (key) byModule.set(key, c);
  }
  const files: string[] = [];
  const index = new Map<string, number>();
  const at = (f: string) => {
    if (!index.has(f)) {
      index.set(f, files.length);
      files.push(f);
    }
    return index.get(f)!;
  };
  const out: Array<[string, number[]]> = [];
  const patterns = new Set<string>();
  for (const r of routes) {
    const chunk = byModule.get(r.module);
    const pattern = routePattern(r.path);
    if (!chunk || patterns.has(pattern)) continue;
    patterns.add(pattern);
    const want: string[] = [];
    for (const c of closure(chunk)) {
      if (!loaded.has(c.fileName)) want.push(c.fileName);
      for (const css of c.css) if (!loaded.has(css)) want.push(css);
    }
    const ids = [...new Set(want)].map(at);
    if (ids.length) out.push([pattern, ids]);
  }
  return { files, routes: out };
}

/**
 * The script itself: plain ES5, no imports, runs once and is done. `base` is
 * Vite's `base` ("/" here), prepended to each emitted file name.
 */
export function routePreloadScript(table: RoutePreloadTable, base: string): string {
  return `/* Generated by vite.config.ts (routeChunkPreload). See client/src/lib/routePreload.ts. */
(function () {
  var b = ${JSON.stringify(base)}, f = ${JSON.stringify(table.files)}, r = ${JSON.stringify(table.routes)};
  var p = location.pathname, d = document;
  for (var i = 0; i < r.length; i++) {
    if (!new RegExp(r[i][0], "i").test(p)) continue;
    for (var j = 0; j < r[i][1].length; j++) {
      var h = b + f[r[i][1][j]], l = d.createElement("link");
      if (/\\.css$/.test(h)) { l.rel = "preload"; l.as = "style"; } else { l.rel = "modulepreload"; }
      l.crossOrigin = "";
      l.href = h;
      d.head.appendChild(l);
    }
    return;
  }
})();
`;
}
