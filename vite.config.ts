import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

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

export default defineConfig({
  plugins: [react(), tailwindcss(), serveGroundsInDev(), dropLegacyWoffFallback()],
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
        experimentalMinChunkSize: 8192,
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
         * IT IS ON NOW, AT 8192 (2026-10-09). Village Comms and the sessions
         * module landing together took the total to 6656 KB of 6600 with the
         * icons grouping already in place. Measured on that tree: off 6656 KB
         * with main JS 516 KB; 4096 gave 6580 and 521; 8192 gave 6548 and 540;
         * 20000 gave 6480 and 554. 8192 leaves the next lane room for some 50
         * KB at a cost of 24 KB on first load. The lasting fix is the 1.6 MB
         * of avatars in client/public moving to the uploads volume, which this
         * knob only postpones.
         *
         * Verify any chunking change with `node scripts/check-dist-budget.mjs`,
         * which prints both measures.
         */
        manualChunks: (id: string) => {
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
          if (/components[\\/]natural[\\/]|lib[\\/]celebrated|shared[\\/]capabilities/.test(id)) {
            return "natural";
          }
          return undefined;
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
