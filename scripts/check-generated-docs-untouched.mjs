#!/usr/bin/env node
/**
 * A pull request does not edit a file main generates.
 *
 * (Rye, 2026-11-09. The rule and the reasons are in scripts/lib/generatedDocs.mjs.)
 *
 * Eight files are written by generators and `.github/workflows/generated-docs.yml`
 * regenerates and commits them after every merge to main. A pull request that
 * commits one regenerated copy conflicts with the next landing, and GitHub runs
 * no CI on a conflicted pull request. So the pull request is not allowed to carry
 * them, and this says so in plain words.
 *
 * WHOLE FILES (GOVERNANCE.md, governance-lineage.md, TOKENS.md, VARIABLES.md,
 * MODULES.md, CAPABILITIES.md, en.po): any change against the merge base fails.
 * ECONOMICS.md is half prose and the prose is a person's to edit, so only its
 * `<!-- generated:NAME start/end -->` regions are held; a region that is NEW in the
 * pull request (a new region needs its markers) is allowed.
 *
 * WHEN IT RUNS. On a pull_request, or locally with --base. On a push (main, where
 * the bot commits these files, and the integration branches) it says it did not
 * look and exits 0.
 *
 * WHAT IT CANNOT SEE. A hand edit that is byte-identical to what the generator would
 * write passes in spirit and fails here anyway, which is the intent: main writes it.
 * Exit 2 means the base could not be resolved and nothing was compared.
 *
 *   node scripts/check-generated-docs-untouched.mjs [--base origin/main]
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATED_FILES, REGION_RE } from "./lib/generatedDocs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const norm = (s) => (s ?? "").replace(/\r\n/g, "\n");

function regionMap(text) {
  const out = new Map();
  for (const m of norm(text).matchAll(new RegExp(REGION_RE.source, "g"))) out.set(m[1], m[0]);
  return out;
}

/** The generated files this change touched. `readBase`/`readHead` return a file's text or null. */
export function findViolations({ changed, readBase, readHead }) {
  const bad = [];
  for (const g of GENERATED_FILES) {
    if (!changed.includes(g.path)) continue;
    if (g.kind === "whole") {
      bad.push({ file: g.path, why: "main regenerates this file" });
      continue;
    }
    const before = regionMap(readBase(g.path));
    const after = regionMap(readHead(g.path));
    for (const [name, text] of before) {
      if (after.has(name) && after.get(name) !== text) bad.push({ file: g.path, why: `the generated:${name} region was edited` });
    }
  }
  return bad;
}

function git(args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME;
  const baseIdx = process.argv.indexOf("--base");
  if (event === "push" && baseIdx === -1) {
    console.log("Generated docs guard: this is a push, where main's workflow writes these files. Nothing to check.");
    return 0;
  }
  const baseName = baseIdx !== -1 ? process.argv[baseIdx + 1] : process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main";
  const mb = git(["merge-base", baseName, "HEAD"]);
  if (mb.status !== 0) {
    console.log(`Generated docs guard could not resolve ${baseName}, so it compared nothing.\nExit 2: this is the guard failing, not the pull request.`);
    return 2;
  }
  const base = mb.stdout.trim();
  const diff = git(["diff", "--name-only", `${base}`, "HEAD"]);
  if (diff.status !== 0) {
    console.log(`git diff failed:\n${diff.stderr}\nExit 2: nothing was compared.`);
    return 2;
  }
  const changed = diff.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  const show = (ref) => (file) => {
    const r = git(["show", `${ref}:${file}`]);
    return r.status === 0 ? r.stdout : null;
  };
  const bad = findViolations({ changed, readBase: show(base), readHead: show("HEAD") });
  if (bad.length === 0) {
    console.log(`Generated docs guard passed: none of the ${GENERATED_FILES.length} generated files was edited (${changed.length} file(s) changed against ${baseName}).`);
    return 0;
  }
  const lines = ["::error::This pull request edits a generated file. Main regenerates these after every merge; drop your change.", ""];
  for (const b of bad) lines.push(`  ${b.file}: ${b.why}`);
  lines.push(
    "",
    "Restore each one from the base:",
    ...[...new Set(bad.map((b) => b.file))].map((f) => `    git checkout ${baseName} -- ${f}`),
    "",
    "Your code change is enough. The would-be diff of GOVERNANCE.md and ECONOMICS.md is in the CI job summary",
    "for reviewers. If a generator itself is broken, fix the generator, not its output. See docs/GENERATED_DOCS.md.",
  );
  console.log(lines.join("\n"));
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
