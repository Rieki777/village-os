import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import {
  type ChunkFacts,
  lazyRoutesFromApp,
  routePreloadScript,
  routePreloadTable,
} from "./client/src/lib/routePreload";

/**
 * Serve the Living Map artifact in DEV, from the same source the server uses.
 *
 * In production Express hands out `docs/prototypes/grounds-v0.html` directly
 * (server/index.ts). It is deliberately NOT copied into `client/public`: a
 * second 4 MB copy in `dist/public` blew the CI bundle budget, which exists to
 * catch exactly that.
 *
 * Dev needs its own answer because `pnpm dev` runs no Express. It also cannot
 * simply drop the file in `public/`: a request ending in `.html` is claimed by
 * vite's own HTML middleware, which resolves it against `root` (`client/`) and
 * falls through to the SPA. Registering this middleware directly, rather than
 * returning a function from configureServer, puts it AHEAD of vite's internal
 * ones, which is the whole point. Two exact paths, no directory walking.
 */
function serveGroundsInDev(): Plugin {
  const file = path.resolve(import.meta.dirname, "docs", "prototypes", "grounds-v0.html");
  return {
    name: "serve-grounds-in-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        const isArtifact = url === "/grounds/index.html" || /^\/grounds\/grounds-[a-f0-9]+\.html$/.test(url);
        if (!isArtifact && url !== "/grounds/manifest.json") return next();
        if (!fs.existsSync(file)) return next();
        if (url === "/grounds/manifest.json") {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          /*
           * Dev answers the same SHAPE as production so the shell takes one
           * code path in both. The url is the stable name here: hashing 4 MB
           * on every reload would buy nothing when nothing is cached anyway.
           */
          res.end(JSON.stringify({
            present: true,
            bytes: fs.statSync(file).size,
            url: "/grounds/index.html",
          }));
          return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

/**
 * Drop the legacy `.woff` fallback that @fontsource declares beside every
 * `.woff2`.
 *
 * Every face was shipping twice: 32 `.woff2` files at 651 KB and 32 `.woff`
 * files at 758 KB, and the second set is dead weight. A browser only reaches
 * the fallback when it cannot parse woff2, and woff2 landed in every engine
 * BEFORE ES modules did (Chrome 36 vs 61, Firefox 39 vs 60, Safari 10 vs 11,
 * Edge 14 vs 16). `client/index.html` boots the app from a single
 * `<script type="module">`, so a browser old enough to want the `.woff` cannot
 * run the app at all and never gets as far as requesting a font. The bytes
 * were unreachable by construction.
 *
 * This strips the fallback from the `src:` list BEFORE vite resolves the
 * url(), which is what stops the file being emitted at all: vite copies a font
 * into `dist/public/assets` because some CSS points at it, so removing the
 * pointer removes the copy. `enforce: "pre"` puts this ahead of vite's own CSS
 * plugin, and the match is scoped to @fontsource so a village's hand-written
 * @font-face is untouched.
 *
 * Member-uploaded display faces are a separate path and keep full `.woff`
 * support: `server/index.ts` still sniffs the `wOFF` magic bytes and serves
 * `font/woff`. This is only about the packaged Latin faces.
 */
function dropLegacyWoffFallback(): Plugin {
  const FALLBACK = /,\s*url\([^)]*\.woff\)\s*format\((['"])woff\1\)/g;
  return {
    name: "drop-legacy-woff-fallback",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0].replace(/\\/g, "/");
      if (!file.endsWith(".css") || !file.includes("/@fontsource")) return null;
      const next = code.replace(FALLBACK, "");
      return next === code ? null : { code: next, map: null };
    },
  };
}

/**
 * Preload the visited route's own page chunk beside the main bundle.
 *
 * Every page but the eager three is `lazy()` (App.tsx), so on a first visit the
 * page's chunk was requested only after the main bundle had downloaded and run:
 * one more round trip in series. This emits `assets/route-preload-<hash>.js`, a
 * few kilobytes that load `async` with the bundle, read `location`, and add
 * `modulepreload` links for that page's chunk and its imports. The table comes
 * from App.tsx's routes and this build's own chunk graph, so it cannot name a
 * file that does not exist; client/src/lib/routePreload.ts has the rules and
 * routePreload.test.ts holds them, including a check against the real App.tsx.
 *
 * An external file rather than an inline script, so a `script-src 'self'`
 * policy covers it without a per-build hash. If App.tsx ever stops parsing,
 * the table is empty, the build warns, and no file or tag is emitted: pages
 * then load exactly as they did before this existed.
 *
 * Measured cost on the CI budgets: one asset of a few KB (one or two 4 KB
 * blocks of MAX_TOTAL_DIST_KB) and nothing on the main chunk.
 */
function routeChunkPreload(): Plugin {
  let base = "/";
  let emitted: string | null = null;
  return {
    name: "route-chunk-preload",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    generateBundle(_options, bundle) {
      emitted = null;
      const app = fs.readFileSync(path.resolve(import.meta.dirname, "client", "src", "App.tsx"), "utf8");
      const chunks: ChunkFacts[] = [];
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        chunks.push({
          fileName: out.fileName,
          imports: out.imports,
          isEntry: out.isEntry,
          isDynamicEntry: out.isDynamicEntry,
          facadeModuleId: out.facadeModuleId,
          css: [...(out.viteMetadata?.importedCss ?? [])],
        });
      }
      const table = routePreloadTable(lazyRoutesFromApp(app), chunks);
      if (table.routes.length === 0) {
        this.warn("route-chunk-preload: no route in client/src/App.tsx matched a page chunk, so nothing was emitted");
        return;
      }
      const ref = this.emitFile({ type: "asset", name: "route-preload.js", source: routePreloadScript(table, base) });
      emitted = this.getFileName(ref);
    },
    transformIndexHtml: {
      order: "post",
      handler() {
        if (!emitted) return;
        // fetchpriority: Chrome gives an async script Low priority, which would
        // queue this behind the fonts and images it exists to get ahead of.
        return [{ tag: "script", attrs: { async: true, fetchpriority: "high", src: base + emitted }, injectTo: "head" }];
      },
    },
  };
}

/**
 * SMALL SHARED MODULES SHARE TWO LAZY CHUNKS.
 *
 * Rollup gives every shared module its own chunk, and CI charges every file a
 * whole 4 KB block (scripts/check-dist-budget.mjs), so a 300-byte API helper
 * imported by two pages costs 4 KB. A module under this many bytes of source,
 * imported by two or more modules and loaded only after the first page, goes
 * into "smalls" (plain modules in shared/, client/src/lib/, client/src/hooks/)
 * or "smallui" (components). See `smallGroupOf` for the exact rule.
 *
 * Measured on batch 62 (2026-10-31, with experimentalMinChunkSize 4096 below):
 * 6500 KB block-charged with the old leaf-only rule, 6460 KB with this one
 * (this rule without minChunkSize, 6528). The first page fetches the same
 * code, about 242 KB gzipped either way, in more files: main JS reads 361 KB
 * where it read 623 KB, because rollup moves the boot modules the groups
 * import out of the entry chunk into shared boot chunks, which is why the
 * MAX_BOOT_JS_KB budget exists. The groups are 31 KB ("smalls") and 58 KB
 * ("smallui") gzipped. 6000 bytes measured 6492 KB; 12000 measured 6448 KB
 * with a 77 KB "smallui", too much for a route's first paint to wait on.
 * Measure all three budgets with check-dist-budget.mjs after any change.
 *
 * Four rules keep it safe, each one found by a build that broke without it:
 * - `onlyExplicitManualChunks` (output, below). Without it rollup moves every
 *   unassigned dependency of a group INTO the group, react included, and the
 *   first page load then fetches the whole group (400 KB when tried).
 * - Never a module the entry imports statically, for the same reason.
 * - A group imports only packages, boot modules and its own or an earlier
 *   group, and nothing the natural kit imports joins one, or two chunks import
 *   each other and rollup warns of a circular chunk.
 * - Two or more importers. A module with one importer already rides in that
 *   importer's chunk, so grouping it saves nothing and only grows the group.
 */
const SMALL_MODULE_BYTES = 9000;
/**
 * The modules the entry imports statically, worked out on the first call and
 * kept for the rest of the build. `vite build` is one build per process here;
 * a `--watch` rebuild would read a stale set and only lose some grouping.
 */
let eagerModules: Set<string> | null = null;
/** The natural interface kit, grouped into its own chunk below. */
const NATURAL_KIT = /components[\\/]natural[\\/]|lib[\\/]celebrated|shared[\\/]capabilities/;
/**
 * The two merged groups and where their members live. A "smalls" member is a
 * plain module; a "smallui" member is a component. "smallui" may import
 * "smalls" and never the reverse, so the two can never import each other.
 */
const SMALL_GROUPS = [
  { name: "smalls", home: /[\\/]shared[\\/][^\\/]+\.ts$|client[\\/]src[\\/](lib|hooks)[\\/].+\.ts$/, mayImport: ["smalls"] },
  { name: "smallui", home: /client[\\/]src[\\/]components[\\/].+\.tsx?$/, mayImport: ["smalls", "smallui"] },
] as const;
type SmallGroup = (typeof SMALL_GROUPS)[number]["name"];
/** Each module's group, worked out once per build like `eagerModules`. */
const smallVerdicts = new Map<string, SmallGroup | null>();

type ModuleInfoOf = (id: string) => { code?: string | null; importers: readonly string[]; importedIds: readonly string[] } | null;

/**
 * Which merged group a module joins, or null. It must be small, lazy, shared
 * by at least two importers (a module with one importer already rides in that
 * importer's chunk and costs no block of its own), and import only packages,
 * boot modules, or members of a group its own group may import. That last rule
 * keeps each group closed, so no chunk of ours can import it back.
 */
function smallGroupOf(id: string, info: ModuleInfoOf, eager: Set<string>): SmallGroup | null {
  const known = smallVerdicts.get(id);
  if (known !== undefined) return known;
  // Provisionally none, so an import cycle settles as "not small" instead of looping.
  smallVerdicts.set(id, null);
  const m = info(id);
  const group = SMALL_GROUPS.find((g) => g.home.test(id));
  const ok =
    !!group &&
    !!m?.code &&
    m.code.length < SMALL_MODULE_BYTES &&
    !eager.has(id) &&
    m.importers.length >= 2 &&
    !NATURAL_KIT.test(id) &&
    !m.importers.some((by) => NATURAL_KIT.test(by)) &&
    m.importedIds.every((dep) => {
      if (dep.includes("node_modules") || eager.has(dep)) return true;
      const of = smallGroupOf(dep, info, eager);
      return of !== null && (group.mayImport as readonly string[]).includes(of);
    });
  const verdict = ok ? group.name : null;
  smallVerdicts.set(id, verdict);
  return verdict;
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serveGroundsInDev(), dropLegacyWoffFallback(), routeChunkPreload()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        /**
         * One icon chunk, because the total budget is measured in BLOCKS.
         *
         * CI sizes `dist/public` with `du -sk`, and `du` counts allocated
         * blocks. On the ext4 filesystem the runners use, every file costs a
         * whole 4096 bytes however small it is. So the two budgets in
         * `.github/workflows/ci.yml` pull in opposite directions: MAX_MAIN_JS_KB
         * is real bytes on one file and falls when you split, MAX_TOTAL_DIST_KB
         * is block-charged across the tree and RISES when you split. A 400-byte
         * chunk costs four kilobytes of the ceiling.
         *
         * Icons were the worst case of that. Each lucide glyph is its own
         * module, so any glyph used by two lazy routes became its own chunk:
         * eighty files of 130 to 790 bytes, spending 278 KB of the ceiling on
         * padding to carry about 37 KB of code. Grouping the package into one
         * chunk took `dist/public` from 6536 KB to 6260 KB block-charged and
         * the emitted chunk count from 152 to 82, while the main chunk FELL
         * from 503 KB to 477 KB because the shell's own icons left with them.
         *
         * The cost, measured and stated plainly: a first page load now fetches
         * every icon the app uses instead of the handful that route needs. The
         * three heaviest routes gained 4.3 KB (admin), 6.0 KB (history) and
         * 6.9 KB (map) gzipped, every later navigation gets its icons from
         * cache, and eighty requests became one. Compression is why the raw
         * numbers and the wire numbers disagree so much: gzip does very little
         * for a 400-byte file and a lot for an 81 KB one.
         *
         * `output.experimentalMinChunkSize` was measured here too and is the
         * weaker knob: about 64 KB at 4096, a plateau by 20000, and it pushes
         * real bytes INTO the main chunk, which is the one budget measured in
         * real bytes. Reach for it only after this.
         *
         * It was on, at 8192, for a few days (2026-10-09 to 2026-10-13): Village
         * Comms and the sessions module landing together took the total to
         * 6656 KB of 6600, and 8192 brought it to 6548 at 24 KB more main JS.
         * It came off once the avatars (1.6 MB) moved from client/public to the
         * uploads volume (#464), which was the lasting fix. Measured on that
         * tree: off is 5096 KB block-charged with main JS 516 KB; 8192 is 4980
         * and 539. Off spends 116 KB more of a ceiling that now has 1.5 MB
         * free, and saves every visitor 23 KB on first load and the risk of a
         * changed chunk order, so it is off.
         *
         * Verify any chunking change with `node scripts/check-dist-budget.mjs`,
         * which prints both measures.
         */
        /*
         * ON AT 4096, 2026-10-30, BESIDE THE SMALL-MODULE RULE BELOW. With that
         * rule alone the dashboard measured 6584 KB of 6600, and the
         * companions section (0295) took it to 6608. Measured on that tree:
         * off, 6608 KB block-charged and main JS 620 KB; 4096, 6480 and 624;
         * 8192, 6408 and 657. 4096 buys 128 KB of the ceiling for 4 KB of
         * first load. The note above says why it is the weaker knob; take it
         * off the day the total has room without it.
         */
        experimentalMinChunkSize: 4096,
        // Groups hold only what manualChunks names: see SMALL_MODULE_BYTES.
        onlyExplicitManualChunks: true,
        manualChunks: (id: string, { getModuleInfo, getModuleIds }) => {
          if (id.includes("lucide-react")) return "icons";
          /*
           * The natural interface kit, one chunk instead of four.
           *
           * Its pieces are shared by the dashboard, the quest board, the
           * profile, the admin and both crowdpool boards, so rollup gave each
           * one its own shared chunk: 4276 real bytes spread across four files
           * and charged 16 KB in blocks. Grouped, the same bytes cost one
           * block. This is the merging fix the block-charge note above
           * describes, at the smallest scale it is worth doing.
           */
          if (NATURAL_KIT.test(id)) {
            return "natural";
          }
          // SMALL SHARED MODULES, two lazy chunks: see SMALL_MODULE_BYTES above.
          // Only modules the entry does NOT import statically, so the first
          // page load fetches nothing it did not fetch before.
          if (!eagerModules) {
            eagerModules = new Set();
            const stack = Array.from(getModuleIds()).filter((m) => getModuleInfo(m)?.isEntry);
            while (stack.length) {
              const m = stack.pop() as string;
              if (eagerModules.has(m)) continue;
              eagerModules.add(m);
              for (const dep of getModuleInfo(m)?.importedIds ?? []) stack.push(dep);
            }
          }
          return smallGroupOf(id, getModuleInfo, eagerModules) ?? undefined;
        },
      },
    },
  },
  server: {
    port: 3000,
    strictPort: false,
    host: true,
    // Dev API proxy (plan hazard table, dies at S0): `pnpm dev` used to serve
    // the SPA with no backend at all — and the API server ALSO defaulted to
    // port 3000, so the two collided before a proxy could even exist. Run
    // `pnpm dev:server` (API on 3001 via .env PORT) beside `pnpm dev` and the
    // SPA talks to a real backend.
    proxy: {
      "/api": { target: process.env.API_PROXY_TARGET || "http://localhost:3001", changeOrigin: true },
      "/health": { target: process.env.API_PROXY_TARGET || "http://localhost:3001", changeOrigin: true },
    },
  },
});
