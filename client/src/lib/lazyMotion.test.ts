import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The animation engine stays off the first page.
 *
 * framer-motion's features (about 130 KB minified with layout projection, 15 KB
 * as `domAnimation`) used to ride in the shared chunk index.html preloads,
 * because the shell rendered `motion.*`. Now every component renders the slim
 * `m.*` inside `<LazyMotion>` (App.tsx), and lib/motionFeatures.ts is reached
 * only by a dynamic import. Two ways that quietly comes undone, one test each:
 *
 *  - a file imports `motion` again. Its `motion.div` carries every feature
 *    with it, statically, into whichever chunk that file lands in.
 *  - something imports lib/motionFeatures statically. Rollup then folds it
 *    into the eager graph and the first page pays for the engine again.
 *
 * IT READS THE BUILT ARTIFACT for the second, like server/trackerPrivacy.test.ts:
 * `pnpm build` runs before the tests in CI, and a missing dist fails here
 * rather than passing hollow.
 */

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "client/src");
const PUBLIC = path.join(ROOT, "dist/public");

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });

/** Every name a file imports from framer-motion. */
const framerImports = (code: string) =>
  [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']framer-motion["']/g)].flatMap((m) =>
    m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean),
  );

describe("framer-motion in the client source", () => {
  it("is imported somewhere, so the next test is not vacuous", () => {
    const users = sourceFiles(SRC).filter((f) => framerImports(fs.readFileSync(f, "utf8")).length > 0);
    expect(users.length).toBeGreaterThan(20);
  });

  it("never imports the full `motion` component, only the slim `m`", () => {
    const offenders = sourceFiles(SRC).filter((f) => framerImports(fs.readFileSync(f, "utf8")).includes("motion"));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});

describe("the built first page", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const assets = fs.readdirSync(path.join(PUBLIC, "assets"));
  const featureChunk = assets.find((f) => /^motionFeatures-[A-Za-z0-9_-]+\.js$/.test(f));

  /** index.html's scripts and preloads, plus every chunk they import statically. */
  const firstPage = (() => {
    const seen = new Set<string>();
    const queue = [...html.matchAll(/assets\/([A-Za-z0-9_.-]+\.js)/g)].map((m) => m[1]);
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const code = fs.readFileSync(path.join(PUBLIC, "assets", file), "utf8");
      // Static imports only: `import"./x.js"` and `from"./x.js"`. A dynamic
      // `import("./x.js")` is a door, and following it is the bug this hunts.
      for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*)["']\.\/([A-Za-z0-9_.-]+\.js)["']/g)) queue.push(m[1]);
    }
    return seen;
  })();

  it("emits the animation features as a chunk of their own", () => {
    expect(featureChunk, "dist/public/assets/motionFeatures-*.js").toBeTruthy();
  });

  it("does not load that chunk with the first page", () => {
    expect(firstPage.size).toBeGreaterThan(1);
    expect([...firstPage]).not.toContain(featureChunk);
  });

  it("reaches it by a dynamic import from the first page", () => {
    const doors = [...firstPage].filter((f) =>
      fs.readFileSync(path.join(PUBLIC, "assets", f), "utf8").includes(`import("./${featureChunk}")`),
    );
    expect(doors.length).toBeGreaterThan(0);
  });
});
