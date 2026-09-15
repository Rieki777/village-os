#!/usr/bin/env node
/**
 * The facts command's own guard.
 *
 *   node scripts/module-facts.test.mjs
 *
 * WHY THIS FILE EXISTS AT ALL. `module-facts.mjs` is the first command a module
 * builder runs, and CLAUDE.md points at it as the authoritative gate list. It
 * had no test until 2026-09-09, and on the day it was changed to read every
 * pull-request workflow rather than `ci.yml` alone, that change shipped two
 * defects that only RUNNING it caught: `codeql.yml` was reported as unreadable
 * because it has no `run:` steps at all (it is actions only), and a shell block
 * running four gates reported only its first, which for the intake block was
 * `module-facts.mjs` itself, so the reader was pointed back here and never at
 * `validate-module.mjs`, which is what actually gates them.
 *
 * Both were the same defect the script exists to prevent, committed by the
 * script: a shorter truth than the real one, reported confidently.
 *
 * WHY IT DRIVES THE REAL SCRIPT rather than importing pieces of it. Nothing in
 * `module-facts.mjs` is exported, and importing it runs the whole body, prints a
 * report and can call `process.exit(1)`. So this runs it as a subprocess and
 * reads what a human would read. That also means these assertions are about the
 * SHIPPED output, which is the thing that can be wrong.
 *
 * THE SECOND OPINION IS DELIBERATE. This file works out which workflows gate a
 * pull request by reading the directory itself, differently from the way the
 * script does. Two readings of one fact that must agree is the point: a copy of
 * the script's own logic would pass in exactly the case the script is broken.
 *
 * House style: plain Node, no runner, non-zero exit on failure.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const WORKFLOWS = path.join(ROOT, ".github", "workflows");

let failures = 0;
let assertions = 0;
const check = (name, actual, expected) => {
  assertions++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  OK    ${name}`);
  }
};

// ── The second opinion ───────────────────────────────────────────────────────
//
// Deliberately not the script's parser. A workflow gates a pull request if the
// token appears anywhere before the next top-level key after `on:`. Cruder than
// the script's reading, which is what makes disagreement informative.
function gatesPr(yml) {
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^"?on"?:/.test(l));
  if (start < 0) return false;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) return false;
    if (/pull_request/.test(lines[i])) return true;
  }
  return false;
}

const files = fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort();

// The control. Every check below is over a set, and a check over a set that
// happens to be empty reports a clean sweep. This is the assertion that makes
// the rest mean something.
check("the workflow directory is not empty, so the sweep below means something", files.length > 0, true);

const expectedPr = files.filter((f) => gatesPr(fs.readFileSync(path.join(WORKFLOWS, f), "utf8"))).sort();
check("and at least one workflow gates a pull request", expectedPr.length > 0, true);

// ── The shipped output ───────────────────────────────────────────────────────
let out = "";
let code = 0;
try {
  out = execFileSync("node", [path.join(HERE, "module-facts.mjs")], { cwd: ROOT, encoding: "utf8" });
} catch (err) {
  out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  code = err.status ?? 1;
}

check("the facts command exits zero against this repository", code, 0);

const reported = files.filter((f) => out.includes(`.github/workflows/${f}`)).sort();
check("it reports EVERY workflow that runs on a pull request", reported, expectedPr);

const shouldNotAppear = files.filter((f) => !expectedPr.includes(f));
check(
  "and no workflow that does not",
  shouldNotAppear.filter((f) => out.includes(`.github/workflows/${f}`)),
  [],
);

// The regression that started this file. `module-intake.yml` runs its gates
// inside one shell block, and reporting only the block's first command pointed
// the reader at this very script instead of at the listing lint that gates them.
if (expectedPr.includes("module-intake.yml")) {
  const intake = out.slice(out.indexOf("module-intake.yml"));
  check(
    "a shell block reports every command it runs, not only the first",
    intake.includes("validate-module.mjs"),
    true,
  );
}

// An actions-only workflow has named steps and no shell. It is reported as
// having nothing to reproduce, which is different from being unreadable, and
// treating the two alike made a real workflow look broken.
const actionsOnly = expectedPr.filter((f) => {
  const yml = fs.readFileSync(path.join(WORKFLOWS, f), "utf8");
  return /^\s{6}-\s+name:/m.test(yml) && !/^\s{8}run:/m.test(yml);
});
if (actionsOnly.length) {
  check(
    "an actions-only workflow is reported, not treated as unreadable",
    out.includes("this workflow runs actions"),
    true,
  );
}

// The headline count has to be the one a reader would arrive at by hand.
const namedTotal = expectedPr.reduce(
  (n, f) => n + (fs.readFileSync(path.join(WORKFLOWS, f), "utf8").match(/^\s{6}-\s+name:/gm) ?? []).length,
  0,
);
check(
  "the headline names the real number of gating steps",
  out.includes(`${namedTotal} named step(s) across ${expectedPr.length} workflow(s)`),
  true,
);

console.log(
  failures === 0
    ? `\nPASS  module facts: ${assertions} assertion(s), 0 failures.`
    : `\nFAIL  module facts: ${failures} of ${assertions} assertion(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
