/**
 * Build the server bundle, stamping the git SHA into it.
 *
 * The build marker used to be a hand-edited string, so it was accurate only
 * when somebody remembered. Six commits once shipped under a stale one and
 * /health cheerfully reported an old build while new code served. The marker
 * is load-bearing — the launch registry reads it, FORK_RUNBOOK tells forks to
 * verify a deploy with it, and the feedback relay sends it upstream as the
 * identity of the deployment a bug came from — so it must not depend on
 * discipline.
 *
 * Railway builds from a git checkout, so `git rev-parse` is available there.
 * Where it is not (a tarball, a Docker layer without .git), the marker falls
 * back to "dev" rather than guessing: an honest "unknown" beats a confident
 * wrong answer about which code is running.
 */
import { execSync } from "child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { precompressAssets } from "./precompress-assets.mjs";

function gitSha() {
  // Railway and most CI providers expose the commit; prefer that over git.
  const fromEnv =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.SOURCE_VERSION ||
    "";
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

/**
 * The date of the commit this bundle was built from.
 *
 * The build marker used to read `2026-07-28-wave1-<sha>`, where the SHA was
 * stamped here and the date in front of it was hand-written in
 * server/index.ts. The SHA stayed true and the date did not: on 2026-09-02 a
 * deployment built from a 2026-09-01 commit was still announcing itself as
 * 2026-07-28, five weeks wrong, in a string the launch registry reads, the
 * fork runbook tells people to verify deploys with, and the feedback relay
 * sends upstream as the identity of the deployment a bug came from.
 *
 * The half a human maintains is the half that goes stale. So both halves are
 * derived now, and neither can drift from the other.
 *
 * The COMMIT date rather than the build date, because it identifies the code.
 * Rebuilding the same commit tomorrow should not look like a new version.
 */
function gitCommitDate() {
  const fromEnv = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "";
  try {
    // %cs is the committer date as strict YYYY-MM-DD, no timezone ambiguity.
    return execSync(`git show -s --format=%cs ${fromEnv || "HEAD"}`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const sha = gitSha();
const commitDate = gitCommitDate();

const result = await build({
  entryPoints: ["server/index.ts"],
  platform: "node",
  packages: "external",
  bundle: true,
  format: "esm",
  outdir: "dist",
  // The exact list of source files that went into the bundle. It is written
  // to dist/.build-inputs.json below and read by `assertFreshDist()` in
  // server/db/testDb.ts, which is how 41 e2e suites stopped reporting on the
  // PREVIOUS build. See the block comment there.
  metafile: true,
  define: {
    // JSON.stringify, not a bare quote: an empty SHA must compile to a
    // valid empty string literal, and the server treats "" as "dev".
    __BUILD_SHA__: JSON.stringify(sha),
    // The marker is composed HERE, whole, rather than half here and half in
    // server/index.ts. That split is what let the date go stale while the SHA
    // stayed true. It also keeps the monolith ratchet happy: index.ts gets to
    // shrink instead of carrying a second constant and its explanation.
    __BUILD_MARKER__: JSON.stringify(
      commitDate && sha ? commitDate + "-" + sha : (commitDate || sha || ""),
    ),
  },
});

/* ---------------------------------------------------------------------------
 * THE RECEIPT THAT SAYS WHAT THIS BUNDLE WAS BUILT FROM.
 *
 * Every e2e suite in this tree checks that dist/index.js EXISTS and stops
 * there. None of them checked that it was CURRENT, so editing server source
 * and running the suite without rebuilding returned a verdict on yesterday's
 * bytes: green on code that is not the code in the tree. Reproduced in four
 * minutes, both directions, 2026-08-31.
 *
 * The check cannot be "dist newer than everything in the repo": a README edit,
 * a test file, or a branch switch would all trip it, and a check that cries
 * wolf gets deleted. So the bundle is compared only against its OWN inputs,
 * taken from esbuild's own graph rather than from a guess, plus the lockfile
 * (the build is `packages: "external"`, so a `pnpm install` after a build
 * changes the code that runs while leaving every bundle input untouched).
 *
 * The CLIENT half is written separately, by scripts/build-client-manifest.mjs,
 * right after vite builds. It has to be: this script is routinely run on its
 * own during an inner loop, and if it also stamped the client inputs it would
 * be certifying a bundle it had not rebuilt.
 *
 * mtime is recorded as a fast pre-filter; the hash is the verdict, because
 * `git checkout` and `git worktree add` rewrite mtimes on files whose bytes
 * end up identical to what the bundle was built from.
 * ------------------------------------------------------------------------ */
const ROOT = path.resolve(import.meta.dirname, "..");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
}

function rel(p) {
  return path.relative(ROOT, path.resolve(ROOT, p)).split(path.sep).join("/");
}

const SKIP_DIR = new Set(["node_modules", "dist", "__snapshots__"]);
const IS_TEST = /\.test\.[cm]?[jt]sx?$/;

function walk(dir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || SKIP_DIR.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (IS_TEST.test(e.name)) continue;
    out.push(full);
  }
  return out;
}

const serverInputs = Object.keys(result.metafile.inputs)
  .filter((p) => !p.includes("node_modules"))
  .map(rel);


function digestOf(files) {
  const out = {};
  for (const f of files) {
    const abs = path.join(ROOT, f);
    try {
      out[f] = sha256(abs);
    } catch {
      /* a file that vanished between the build and this walk is not a manifest entry */
    }
  }
  return out;
}

const manifest = {
  sha,
  builtAt: Date.now(),
  server: digestOf([...new Set(serverInputs)].sort()),
  lockfile: fs.existsSync(path.join(ROOT, "pnpm-lock.yaml"))
    ? sha256(path.join(ROOT, "pnpm-lock.yaml"))
    : null,
};

fs.writeFileSync(
  path.join(ROOT, "dist", ".build-inputs.json"),
  `${JSON.stringify(manifest, null, 0)}\n`,
);

console.log(
  `  dist/index.js built${sha ? ` @ ${sha}` : " (no git context — marker will read 'dev')"}` +
    ` from ${Object.keys(manifest.server).length} server inputs`,
);

/*
 * The client's immutable assets, brotli'd once at quality 11, into
 * dist/precompressed (scripts/precompress-assets.mjs has the measurements and
 * the reasons). Here because this is the last step of `pnpm build` and the one
 * that builds what the server serves, and because running this script alone
 * then keeps the set current too: it is incremental, so an unchanged client
 * costs only the hashing. A failure is LOUD and not fatal. The server checks
 * every copy before it serves one and otherwise encodes per request, as it
 * always has, so a missing set costs bytes and never a deploy.
 */
try {
  await precompressAssets({ root: ROOT });
} catch (e) {
  console.error(`  dist/precompressed NOT written, so /assets will be encoded per request: ${e?.stack ?? e}`);
}
