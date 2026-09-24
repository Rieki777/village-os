/**
 * MAKE A LANE'S WORKTREE CORRECTLY, so the four traps cannot be forgotten.
 *
 * Several sessions run against this repository at once and each one starts by
 * making a worktree by hand. On 2026-09-23 three separate branches were made
 * the same day and all three carried the same defect, which is the tell that it
 * is a property of the procedure rather than of anybody's care.
 *
 * ── TRAP 1: THE INHERITED UPSTREAM, AND IT REACHES PRODUCTION ──────────────
 *
 * `git worktree add -b wt/thing <path> origin/main` sets the new branch's
 * UPSTREAM to `origin/main`. So a later bare `git push` in that worktree does
 * not push the branch, it pushes the commits to MAIN. Merging to main deploys
 * production here, so the blast radius of forgetting one flag is a deploy
 * nobody asked for.
 *
 * Caught three times on 2026-09-23 and never fired, which is luck. The fix is
 * structural: `--no-track` means the upstream is never created, so there is
 * nothing to remember and nothing to unset afterwards. This script passes it
 * and then ASKS THE QUESTION BACK, because a flag that silently stopped working
 * would leave exactly the state it was added to prevent.
 *
 * ── TRAP 2: A WORKTREE UNDER TEMP IS DELETED WHILE YOU WORK ────────────────
 *
 * Windows Storage Sense purges the temp directories, so a worktree there can
 * vanish mid-lane. Worktrees live beside the repository.
 *
 * ── TRAP 3: NO .env MEANS A HOLLOW GREEN ───────────────────────────────────
 *
 * Without `TEST_DATABASE_URL` every database-backed suite SKIPS. A skip is not
 * a pass, and a fresh worktree that skips them reports a green that means
 * nothing. This script copies `.env` from a sibling worktree and refuses
 * loudly when it cannot find one, rather than leaving a tree that looks ready.
 *
 * ── TRAP 4: NO node_modules MEANS AN EMPTY TEST LOG ────────────────────────
 *
 * A run in a tree that was never installed dies before any test executes and
 * prints no `Test Files` line at all, which reads like "nothing to run" rather
 * than "this never started". It has cost a red CI run. So installing is part of
 * making the worktree, not a thing to remember afterwards.
 *
 * Usage:
 *   node scripts/new-worktree.mjs <name>
 *   node scripts/new-worktree.mjs <name> --base origin/main
 *   node scripts/new-worktree.mjs <name> --dry-run      print the plan, do nothing
 *   node scripts/new-worktree.mjs <name> --no-install   skip pnpm install
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function git(args, opts = {}) {
  // `stdio: "inherit"` hands the child our streams and returns NULL rather than
  // a string, so trimming unconditionally throws on exactly the calls whose
  // progress we wanted to show. Caught on this script's first real run.
  const out = execFileSync("git", args, { encoding: "utf8", cwd: opts.cwd ?? ROOT, stdio: opts.stdio ?? "pipe" });
  return typeof out === "string" ? out.trim() : "";
}

function fail(message) {
  console.error(`\nREFUSED: ${message}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const NO_INSTALL = argv.includes("--no-install");
const baseIdx = argv.indexOf("--base");
const BASE = baseIdx !== -1 && argv[baseIdx + 1] ? argv[baseIdx + 1] : "origin/main";
/*
 * Skip the value that belongs to `--base`, BY INDEX and only when the flag is
 * actually present. Comparing `argv[baseIdx + 1]` instead reads `argv[0]` when
 * the flag is absent, which silently swallows the name and prints the usage
 * line at somebody who typed a perfectly good one. It did exactly that on the
 * first run of this script.
 */
const name = argv.find((a, i) => !a.startsWith("--") && !(baseIdx !== -1 && i === baseIdx + 1));

if (!name) {
  console.error("Usage: node scripts/new-worktree.mjs <name> [--base <ref>] [--dry-run] [--no-install]");
  process.exit(1);
}

// A name becomes a branch and a directory, so it may hold only what both accept.
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  fail(`"${name}" must be lowercase letters, digits and hyphens, starting with a letter or digit.`);
}

const branch = `wt/${name}`;
const parent = path.dirname(ROOT);
const dir = path.join(parent, `wt-${name}`);

// TRAP 2. Compare against the real temp directories rather than the word
// "temp", so a legitimate path that merely contains it is not refused.
const tempRoots = [process.env.TEMP, process.env.TMP, "/tmp"].filter(Boolean).map((p) => path.resolve(p));
if (tempRoots.some((t) => dir.toLowerCase().startsWith(t.toLowerCase()))) {
  fail(`${dir} is under a temp directory, which Storage Sense purges while a lane is still working in it.`);
}

const plan = [
  `branch   ${branch}`,
  `path     ${dir}`,
  `base     ${BASE}`,
  `install  ${NO_INSTALL ? "skipped (--no-install)" : "pnpm install --frozen-lockfile"}`,
];
console.log(`\nnew worktree\n  ${plan.join("\n  ")}\n`);

if (DRY) {
  console.log("--dry-run: nothing was created.");
  process.exit(0);
}

if (fs.existsSync(dir)) fail(`${dir} already exists.`);
const branches = git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]).split("\n");
if (branches.includes(branch)) fail(`branch ${branch} already exists. Pick another name or delete it first.`);

console.log(`fetching ${BASE.split("/")[0]}...`);
git(["fetch", BASE.split("/")[0] ?? "origin", "--quiet"]);

// TRAP 1. `--no-track` is the whole fix: the upstream is never created.
console.log(`creating the worktree...`);
git(["worktree", "add", "--no-track", "-b", branch, dir, BASE], { stdio: "inherit" });

// ASK THE QUESTION BACK. A flag that stopped working would leave precisely the
// state it exists to prevent, and nothing else in this script would notice.
let upstream = "";
try {
  upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd: dir });
} catch {
  upstream = "";
}
if (upstream) {
  console.error(
    `\nREFUSED: the new branch has an upstream (${upstream}) despite --no-track.\n` +
      `A bare 'git push' in that worktree would push to it, and if that is main it DEPLOYS PRODUCTION.\n` +
      `Run:  git -C "${dir}" branch --unset-upstream\n` +
      `then tell whoever owns this script, because --no-track has stopped working.`,
  );
  process.exit(1);
}
console.log("upstream: none, as intended.");

// TRAP 3. Find a sibling worktree that has one. Nearest first is not worth the
// complexity; any sibling's .env points at the same local database.
const envTarget = path.join(dir, ".env");
if (!fs.existsSync(envTarget)) {
  const sibling = fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory() && path.join(parent, e.name) !== dir)
    .map((e) => path.join(parent, e.name, ".env"))
    .find((p) => fs.existsSync(p));
  if (sibling) {
    fs.copyFileSync(sibling, envTarget);
    console.log(`.env copied from ${path.relative(parent, sibling)}`);
  } else {
    console.error(
      `\nWARNING: no .env found in any sibling worktree, so this tree has no TEST_DATABASE_URL.\n` +
        `Every database-backed suite will SKIP, and a run that skips them is a green that means nothing.\n` +
        `Copy one in before you trust any test result here.`,
    );
  }
}
if (fs.existsSync(envTarget) && !fs.readFileSync(envTarget, "utf8").includes("TEST_DATABASE_URL")) {
  console.error(
    `\nWARNING: the .env here names no TEST_DATABASE_URL. The database suites will skip and read as passing.`,
  );
}

// TRAP 4.
if (!NO_INSTALL) {
  console.log(`\ninstalling (this is part of making the worktree, not a later step)...`);
  execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
}

console.log(
  `\nready.\n\n  cd ${dir}\n\n` +
    `When you push, name the refspec on both sides. There is no upstream to fall back on, which is\n` +
    `the point, and this form says where it is going:\n\n` +
    `  git push origin refs/heads/${branch}:refs/heads/${branch}\n`,
);
