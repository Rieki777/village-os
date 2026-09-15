#!/usr/bin/env node
/**
 * The guard's own guard, in the style of scripts/check-brand-refs.test.mjs
 * and scripts/contribution-scan.test.mjs: a real fixture repository, the
 * real script, real exit codes.
 *
 * `check-migration-numbers.mjs` computes its own ROOT from its own file
 * location (`import.meta.url`), not from `process.cwd()`, on purpose: it has
 * to look at the drizzle/ directory it actually ships next to, not whatever
 * directory happened to invoke it. That means a fixture cannot just point
 * the real script at a scratch drizzle/ with an env var or a flag; the
 * script itself has to LIVE inside the fixture, next to its own drizzle/, the
 * same shape it has in this repository. So every case below copies the real
 * script's current bytes into a throwaway git repository's own scripts/
 * directory and runs it from there with plain `node`, exactly as CI does.
 *
 * `safety` (2026-08-30, SEASON2_FLEET_LEDGER.md section 7i) already proved
 * this script red six ways and green five by hand, against the real repo, at
 * commit c551f70. Nothing here repeats that manual proof; this is what makes
 * it a standing regression test instead of a one-time transcript: it runs on
 * every `pnpm test`, against a fixture nobody has to remember to re-run.
 *
 * Run: node scripts/check-migration-numbers.test.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPT = path.join(HERE, "check-migration-numbers.mjs");

let failures = 0;
let assertions = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assertions += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`          expected: ${JSON.stringify(expected)}`);
    console.log(`          actual:   ${JSON.stringify(actual)}`);
  }
};
const checkTrue = (name, cond, detail = "") => check(name + (detail ? `  (${detail})` : ""), cond, true);

console.log("check-migration-numbers: the guard's own regression test\n");

/** A throwaway repository with the real script copied into its own scripts/. */
function makeFixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "check-migration-numbers-"));
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(repo, "drizzle"), { recursive: true });
  fs.copyFileSync(REAL_SCRIPT, path.join(repo, "scripts", "check-migration-numbers.mjs"));
  return repo;
}

function git(repo, ...args) {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf-8", shell: false });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${repo}: ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

function initGitRepo(repo) {
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.test");
  git(repo, "config", "user.name", "Migration Numbers Test");
}

function writeMigration(repo, filename, body = "SELECT 1;\n") {
  fs.writeFileSync(path.join(repo, "drizzle", filename), body);
}

function commitAll(repo, message) {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
}

/**
 * Run the copied script from inside the fixture, exactly as `node scripts/check-migration-numbers.mjs <args>` would.
 *
 * GITHUB_BASE_REF reaches the fixture only when a scenario passes it in `env`. The guard picks its
 * base ref from that variable, a pull_request run sets it to the pull request's target branch, and
 * a fixture has nothing but `main`. Into main, the fallback candidate `main` resolved anyway and
 * nothing showed. Into any other branch, a stacked pull request, the guard looked for
 * `origin/<target>` and `<target>`, found neither, and 5 of these 21 assertions failed on a change
 * that touched no migration at all. Scenario 10 holds it.
 */
function run(repo, args = [], env = {}) {
  const inherited = { ...process.env };
  delete inherited.GITHUB_BASE_REF;
  const r = spawnSync("node", [path.join(repo, "scripts", "check-migration-numbers.mjs"), ...args], {
    cwd: repo,
    encoding: "utf-8",
    shell: false,
    env: { ...inherited, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function runJson(repo, args = [], env = {}) {
  const r = run(repo, [...args, "--json"], env);
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    /* left null; the assertion on status or stdout will explain the failure */
  }
  return { ...r, json: parsed };
}

function cleanup(repo) {
  fs.rmSync(repo, { recursive: true, force: true });
}

// ── 1. A clean tree, no history needed ───────────────────────────────────────
{
  const repo = makeFixture();
  try {
    writeMigration(repo, "0001_a.sql");
    writeMigration(repo, "0002_b.sql");
    const r = run(repo, ["--no-history"]);
    checkTrue("clean tree with --no-history exits 0", r.status === 0, `status ${r.status}: ${r.stderr}`);
    checkTrue("prints the migration count", /2 migrations/.test(r.stdout), r.stdout.trim());
  } finally {
    cleanup(repo);
  }
}

// ── 2. --next reports the number after the highest upstream file ────────────
{
  const repo = makeFixture();
  try {
    writeMigration(repo, "0001_a.sql");
    writeMigration(repo, "0114_b.sql");
    const r = run(repo, ["--next"]);
    checkTrue("--next exits 0", r.status === 0, `status ${r.status}`);
    check("--next prints the number one above the highest file", r.stdout.trim(), "0115");
  } finally {
    cleanup(repo);
  }
}

// ── 3. Undiscoverable filename: a .sql file the runner's own regex misses ───
{
  const repo = makeFixture();
  try {
    writeMigration(repo, "0001_a.sql");
    writeMigration(repo, "notes.sql"); // does not match /^\d{4}.*\.sql$/
    const r = runJson(repo, ["--no-history"]);
    checkTrue("an undiscoverable filename fails", r.status === 1, `status ${r.status}`);
    checkTrue("json reports the discoverable rule", r.json?.problems?.some((p) => p.rule === "discoverable"));
  } finally {
    cleanup(repo);
  }
}

// ── 4. Duplicate number: two files, one four-digit prefix ───────────────────
{
  const repo = makeFixture();
  try {
    writeMigration(repo, "0001_a.sql");
    writeMigration(repo, "0002_first.sql");
    writeMigration(repo, "0002_second.sql");
    const r = runJson(repo, ["--no-history"]);
    checkTrue("two files sharing a number fail", r.status === 1, `status ${r.status}`);
    checkTrue("json reports the duplicate rule", r.json?.problems?.some((p) => p.rule === "duplicate"));
    const dup = r.json?.problems?.find((p) => p.rule === "duplicate");
    checkTrue("the duplicate is reported as number 0002", dup?.numbers?.[0]?.number === "0002", JSON.stringify(dup));
  } finally {
    cleanup(repo);
  }
}

// ── 5. The village band: 9000+ refused without --village, allowed with it ──
{
  const repo = makeFixture();
  try {
    writeMigration(repo, "0001_a.sql");
    writeMigration(repo, "9001_village_local.sql");
    const refused = runJson(repo, ["--no-history"]);
    checkTrue("a 9000+ file is refused without --village", refused.status === 1, `status ${refused.status}`);
    checkTrue("json reports the band rule", refused.json?.problems?.some((p) => p.rule === "band"));

    const allowed = run(repo, ["--no-history", "--village"]);
    checkTrue("the same tree passes with --village", allowed.status === 0, `status ${allowed.status}: ${allowed.stderr}`);
  } finally {
    cleanup(repo);
  }
}

// ── 6. The history rule: a number at or below a ref's ceiling is a regression ─
{
  const repo = makeFixture();
  try {
    initGitRepo(repo);
    // Base: 0001 and 0003. 0002 is a gap, same shape as this repo's own
    // burned numbers (0111, 0115-0119): free on disk, forbidden by history.
    writeMigration(repo, "0001_a.sql");
    writeMigration(repo, "0003_c.sql");
    commitAll(repo, "base: 0001 and 0003");

    // A NEW commit reuses the gap instead of building on the ceiling.
    writeMigration(repo, "0002_late.sql");
    commitAll(repo, "adds a migration inside the burned gap");

    const r = runJson(repo, []); // history ON: candidates fall back to local "main", which resolves here
    checkTrue("reusing a number at or below the ceiling fails", r.status === 1, `status ${r.status}: ${r.stderr}`);
    checkTrue("json reports the monotonic rule", r.json?.problems?.some((p) => p.rule === "monotonic"));
    const mono = r.json?.problems?.find((p) => p.rule === "monotonic");
    checkTrue(
      "the regression names the file that reused the gap",
      mono?.files?.some((f) => f.file === "0002_late.sql"),
      JSON.stringify(mono),
    );
  } finally {
    cleanup(repo);
  }
}

// ── 7. The same history rule, but the added file clears the ceiling: green ──
{
  const repo = makeFixture();
  try {
    initGitRepo(repo);
    writeMigration(repo, "0001_a.sql");
    writeMigration(repo, "0003_c.sql");
    commitAll(repo, "base: 0001 and 0003");

    writeMigration(repo, "0004_d.sql");
    commitAll(repo, "adds a migration above the ceiling");

    const r = run(repo, []);
    checkTrue("a number above the ceiling passes", r.status === 0, `status ${r.status}: ${r.stderr}`);
    checkTrue("reports nothing reused below the ceiling", /nothing added since/.test(r.stdout), r.stdout.trim());
  } finally {
    cleanup(repo);
  }
}

// ── 8. History that cannot resolve is a FAILURE, never a silent skip ────────
{
  // A directory that is not a git checkout at all: "main" cannot resolve.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "check-migration-numbers-nogit-"));
  try {
    fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(repo, "drizzle"), { recursive: true });
    fs.copyFileSync(REAL_SCRIPT, path.join(repo, "scripts", "check-migration-numbers.mjs"));
    fs.writeFileSync(path.join(repo, "drizzle", "0001_a.sql"), "SELECT 1;\n");

    const r = run(repo, []);
    checkTrue("no git checkout at all fails, not skips", r.status === 1, `status ${r.status}`);
    checkTrue(
      "the failure names the only-forward rule as unrun, not as clean",
      /DID NOT RUN/.test(r.stderr),
      r.stderr.trim().slice(0, 200),
    );

    const explicit = run(repo, ["--no-history"]);
    checkTrue("the same tree passes when history is explicitly turned off", explicit.status === 0, `status ${explicit.status}`);
  } finally {
    cleanup(repo);
  }
}

// ── 9. A correctly numbered next file goes green end to end ─────────────────
{
  const repo = makeFixture();
  try {
    initGitRepo(repo);
    writeMigration(repo, "0001_a.sql");
    writeMigration(repo, "0120_z.sql");
    commitAll(repo, "base up to 0120");

    writeMigration(repo, "0121_new.sql");
    commitAll(repo, "adds 0121, the next free number");

    const r = run(repo, []);
    checkTrue("0121 after a base ceiling of 0120 passes", r.status === 0, `status ${r.status}: ${r.stderr}`);
  } finally {
    cleanup(repo);
  }
}

// ── 10. The base ref comes from the scenario, never from the runner ─────────
{
  const repo = makeFixture();
  try {
    initGitRepo(repo);
    writeMigration(repo, "0001_a.sql");
    commitAll(repo, "main: 0001");
    git(repo, "checkout", "-q", "-b", "stacked-target");
    writeMigration(repo, "0005_e.sql");
    commitAll(repo, "the branch a pull request is stacked on reaches 0005");
    git(repo, "checkout", "-q", "-b", "feature");
    writeMigration(repo, "0003_c.sql");
    commitAll(repo, "the stacked pull request adds 0003, under its target's ceiling");

    // What a pull_request run into a stacked branch hands every process it starts. The fixture has
    // no such branch, so a guard that inherited it could not resolve a base at all.
    const before = process.env.GITHUB_BASE_REF;
    process.env.GITHUB_BASE_REF = "a-target-no-fixture-has";
    let inherited;
    try {
      inherited = runJson(repo, []);
    } finally {
      if (before === undefined) delete process.env.GITHUB_BASE_REF;
      else process.env.GITHUB_BASE_REF = before;
    }
    checkTrue(
      "a base ref left in the runner's environment never reaches the fixture",
      inherited.status === 0 && /^main @ /.test(inherited.json?.history?.base ?? ""),
      `status ${inherited.status}: ${inherited.json?.history?.base || inherited.json?.history?.reason}`,
    );

    // The control: the variable is not ignored. Passed on purpose it moves the base, and against the
    // stacked target's ceiling of 0005 the new 0003 is a regression.
    const asked = runJson(repo, [], { GITHUB_BASE_REF: "stacked-target" });
    checkTrue(
      "a base ref the scenario passes is the base the guard measures against",
      /^stacked-target @ /.test(asked.json?.history?.base ?? ""),
      JSON.stringify(asked.json?.history),
    );
    checkTrue(
      "measured against its own target, the stacked 0003 is a regression",
      asked.status === 1 &&
        !!asked.json?.problems?.some((p) => p.rule === "monotonic" && p.files?.some((f) => f.file === "0003_c.sql")),
      `status ${asked.status}: ${JSON.stringify(asked.json?.problems)}`,
    );
  } finally {
    cleanup(repo);
  }
}

console.log(
  failures === 0
    ? `\nPASS  check-migration-numbers: ${assertions} assertion(s), 0 failures.`
    : `\nFAIL  check-migration-numbers: ${failures} failure(s) of ${assertions}.`,
);
process.exit(failures === 0 ? 0 : 1);
