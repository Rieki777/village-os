import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Every lane worktree on this machine junctions `node_modules` to one shared
 * store, so vite resolves the `dotenv/config` setup file to a realpath OUTSIDE
 * the worktree root, and its default `server.fs.allow` boundary refuses to
 * serve it under the jsdom environment. The file exists and Node reads it fine;
 * only vite's boundary objects, and it objects for EVERY client test in that
 * worktree, including ones nobody touched. Two lanes lost time to it on the
 * same night and each built a private config instead of changing this shared
 * file, which is the right instinct and the wrong outcome.
 *
 * Allowing the store's realpath costs an ordinary checkout nothing: there the
 * realpath IS the directory already allowed, so this resolves to a duplicate.
 * `realpathSync` is guarded because a fresh clone runs this config before
 * anything is installed.
 */
const moduleStore = (() => {
  try {
    return fs.realpathSync(path.resolve(import.meta.dirname, "node_modules"));
  } catch {
    return null;
  }
})();

/**
 * Amora had vitest installed and zero tests. This config exists to make the
 * server testable at all, ahead of Phase 1b moving ~78 route handlers off JSON
 * and onto MySQL. Moving that much code with no safety net is how a live site
 * breaks.
 *
 * The GLOBAL environment is node, not jsdom: most of what matters here drives
 * the real HTTP API of the real built server, not React components. That
 * default is deliberately left alone (2026-08-31) rather than flipped to
 * jsdom now that component tests exist - jsdom is heavier to boot per file
 * and would be an unreviewed behaviour change touching every server test at
 * once for a benefit only the component tests need. Those opt into jsdom
 * individually with a `// @vitest-environment jsdom` docblock; see
 * client/src/test/setup.ts for the matcher/cleanup wiring they share.
 */
export default defineConfig({
  // Same react() plugin vite.config.ts builds with, and needed for the same
  // reason a server test never needed it before now: it is what turns JSX
  // into the automatic runtime's `jsx(...)` calls rather than classic-mode
  // `React.createElement`, which throws "React is not defined" the moment a
  // component test actually renders anything (there is no bare `React` import
  // anywhere in this codebase's own .tsx files - vite's plugin is the only
  // reason that has ever worked). Costs server tests nothing: esbuild only
  // reaches for it on a `.tsx`/`.jsx` file.
  plugins: [react()],
  /*
   * The same aliases vite.config.ts builds with. Without them a client module
   * that imports `@shared/...` typechecks (tsconfig paths) and builds (vite)
   * and then fails to COLLECT under vitest, which reports as "no tests" rather
   * than as a resolution error. Keep this list in step with vite.config.ts.
   */
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  // See the note on `moduleStore` above: this is what lets a junctioned lane
  // worktree run client tests at all.
  server: {
    fs: {
      allow: [path.resolve(import.meta.dirname), ...(moduleStore ? [moduleStore] : [])],
    },
  },
  test: {
    environment: "node",
    // S5: load .env so TEST_DATABASE_URL reaches the DB-backed suites locally
    // (CI sets it as a job env var; both paths land in process.env).
    // client/src/test/setup.ts registers @testing-library/jest-dom's
    // matchers and RTL's cleanup, for the component tests below. See that
    // file for why it is safe to run ahead of every test, not just client
    // ones.
    setupFiles: ["dotenv/config", "./client/src/test/setup.ts"],
    /*
     * Prints what provisioning cost when the run ends: template builds, clones,
     * and the per-migration-file price. The cost this comment block warns about
     * below was real and invisible, which is how it reached five minutes of
     * every CI job. A number nobody prints is a number nobody defends.
     *
     * IT ALSO DECIDES THE EXIT CODE. Its globalTeardown fails a whole run that
     * provisioned no scratch schema at all, which is what a run with no
     * TEST_DATABASE_URL is: 91 database-gated files skipped, 1,190 tests not
     * run, and until 2026-09-02 an exit code of 0 that nobody could tell apart
     * from a pass. `ALLOW_NO_TEST_DB=1` accepts the smaller suite on purpose;
     * a filtered run needs no opt-out. `hollowRunVerdict` in that file is the
     * whole decision, and `server/db/provisioningReport.test.ts` is its table.
     */
    globalSetup: ["server/db/provisioningReport.ts"],
    // Most client tests are still pure-logic (`.test.ts`, environment
    // "node" - helpers like the nav's gesture thresholds, far easier to check
    // against numbers than by waving a thumb at a phone). `.tsx` component
    // tests now exist too (2026-08-31): the global environment stays "node"
    // (see the top-level comment), so each component test file opts into a
    // DOM itself with a `// @vitest-environment jsdom` docblock as its FIRST
    // line - Vitest reads that per file, before any import runs. A `.tsx`
    // file that forgets the docblock and renders a component still fails
    // loudly (no `document`), which is what this comment used to promise
    // before any component test existed to test that promise: `.tsx` was
    // included in this glob from the start specifically so a forgotten test
    // file could never sit unrun beside real ones while `pnpm test` stayed
    // green.
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "client/**/*.test.{ts,tsx}"],
    // The end-to-end loop test builds and boots the server, so it needs room.
    testTimeout: 120_000,
    /*
     * This ceiling must stay comfortably ABOVE (provisioning + boot deadline),
     * and provisioning GROWS WITH EVERY MIGRATION ANYONE ADDS.
     *
     * An e2e hook does two slow things in series: provision a scratch schema
     * (drop, create, then run every migration) and then wait for the server to
     * answer /health. The second has its own deadline, and that deadline is now
     * ONE exported number, `E2E_BOOT_DEADLINE_MS` in `server/db/testDb.ts`. It
     * used to be five hand-copied literals and they had drifted: three files
     * said 180s and two said 120s, so two suites sat below the floor this
     * comment describes as the rule. So:
     *
     *     hookTimeout  >  provisioning  +  E2E_BOOT_DEADLINE_MS
     *
     * Measured 2026-08-11, at rest, against the hosted MySQL:
     *     round trip     140ms
     *     migrations     62 files
     *     provisioning   77.6s          (about 1.25s per migration file)
     *     worst case     257.6s         (77.6 + 180)
     *
     * Against the old 300s that left 42s of margin, roughly 14%, and it had
     * already stopped being enough: with three suites sharing this database
     * `examples.routes.e2e` failed on THIS timeout, then passed alone in 227s.
     * At the rate migrations land (0049 to 0062 in one week) 300s would have
     * been short at rest within a fortnight.
     *
     * Why raise this rather than shorten the boot deadline: when a server
     * genuinely will not start, the boot deadline prints the server's own log
     * and says what it was doing, while this timeout says only "Hook timed out"
     * and throws that log away. The informative error has to be the one that
     * fires, so this number stays the outer bound.
     *
     * TO RECOMPUTE: time one `provisionTestDb()` and add E2E_BOOT_DEADLINE_MS.
     * If that is within ~40% of this number, raise it. Do not lower the boot
     * deadline instead.
     *
     * WHAT CHANGED, 2026-08-22 (88 migration files). Provisioning no longer
     * runs the migrations per suite. `server/db/testDb.ts` migrates ONCE into a
     * template schema and clones it per suite, so the growth this comment
     * warned about is now paid once per run instead of once per DB-backed
     * suite, of which there are 44. The worst case that sizes THIS number is
     * therefore the FIRST suite to provision, which pays the template build and
     * a clone:
     *
     *     quiet box   template 2.1s + clone 0.7s  = 2.8s
     *     under load  template 8.8s + clone 4.1s  = 12.9s
     *     worst case  12.9 + 120 = 132.9s, 55% of this ceiling
     *
     * SIZE AGAINST THE LOADED NUMBER. The same tree on the same MariaDB
     * measured 4x apart on the same afternoon depending on what else was
     * running, which is the local version of the 4x-to-6x spread CI runners
     * show on identical content. A quiet measurement is the wrong basis for a
     * ceiling that only ever fires under contention.
     *
     * `pnpm measure:provisioning` prints exactly those numbers, and every run
     * prints its own totals at the end (globalSetup above).
     */
    hookTimeout: 240_000,
    // One server process per file, no parallel port fights.
    fileParallelism: false,
  },
});
