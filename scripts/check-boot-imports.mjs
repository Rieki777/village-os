#!/usr/bin/env node
/**
 * NOTHING HEAVY ON THE BOOT PATH.
 *
 * `server/lib/base-reads.ts` imported `viem` and `viem/chains` at module top
 * level, and `server/index.ts` imports that file statically. In ESM every
 * static import in the graph is resolved and EVALUATED before the entry
 * module's first statement runs, so every boot loaded viem's 1,202-module
 * graph whether or not anything ever read the chain -- and printed nothing at
 * all while it did, because no server code had run yet.
 *
 * Measured on the tree that added this guard (Windows, Node 25, 2026-09-23):
 *   - `import("viem")` then `import("viem/chains")` in a bare node process:
 *     136,993ms on the first run after a fresh install, 6,547-16,590ms across
 *     seven later runs.
 *   - boot-to-first-log-byte of the built dist/index.js: 74,299ms with the
 *     static import, against an `E2E_BOOT_DEADLINE_MS` of 120,000ms that no
 *     environment variable can raise.
 * Fifty-six e2e suites spawn that bundle. Two lanes in one day met
 * `server did not start in 120s` with an EMPTY server log and stopped to
 * disprove their own diffs, because a boot that has not reached its first
 * statement looks exactly like a boot a change broke.
 *
 * So the durable fix is not the edit that made those imports dynamic. It is
 * this: a check that fails when a heavy package returns to the statically
 * boot-reachable graph, whoever adds it and whichever file they add it to.
 *
 * WHAT IT DOES. Walks the STATIC import graph from `server/index.ts` through
 * first-party files only, and collects every bare (node_modules) specifier it
 * reaches. `import type` is skipped -- type imports erase and cost nothing.
 * `import("x")` is skipped on purpose: a dynamic import is the fix, not the
 * defect. Then two rules:
 *
 *   1. BUDGET. Every boot-reachable package must be under MAX_FILES files as
 *      installed. This is the rule that does not need maintaining: a new
 *      dependency nobody has thought about is measured the day it arrives.
 *      The budget is empirical -- the largest package on the boot path today
 *      is printed by `--report`, and the ceiling sits above it with room,
 *      well under viem's 10,050.
 *   2. DENY. Packages proven to cost seconds, named with their numbers, are
 *      refused whatever their file count, so the rule survives a package
 *      getting smaller on disk without getting cheaper to evaluate.
 *
 * The denominator is printed on success as well as failure: a walker that
 * resolved nothing would otherwise report the same green as a clean tree, so
 * the count of files walked, the package count and the largest package all
 * appear in the passing line, and a walk that reaches almost nothing fails.
 *
 * The walk agrees with the bundler, which is the other half of trusting it:
 * it reaches 341 first-party files from server/index.ts, and
 * `scripts/build-server.mjs` reports "341 server inputs" from esbuild's own
 * metafile for the same entry. Two independent graphs, the same number.
 *
 * `--root`/`--entry`/`--max-files`/`--floor` exist so
 * scripts/check-boot-imports.test.mjs can drive it against fixture trees and
 * watch it refuse; CI passes none of them. `--report` prints every package on
 * the boot path with its file count, which is where MAX_FILES came from.
 */
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const ROOT = path.resolve(arg("--root", path.resolve(import.meta.dirname, "..")));
const ENTRY = path.resolve(ROOT, arg("--entry", "server/index.ts"));
const REPORT = args.includes("--report");

/**
 * The ceiling, in files as installed. Chosen from measurement, not from taste.
 * The largest package on the boot path today is mysql2 at 130 files, so the
 * budget is not set by what is already there. It is set by what could
 * reasonably arrive: drizzle-orm, this repo's own ORM dependency, installs
 * 2,666 files and importing it at boot would be a normal thing to do, so a
 * budget below that would fail an honest change. 3,000 clears it, and is under
 * a third of viem's 10,044.
 *
 * A package over the budget is not forbidden -- it is forbidden ON THE BOOT
 * PATH, and `await import()` inside the function that needs it costs a boot
 * nothing.
 */
const MAX_FILES = Number(arg("--max-files", 3000));

/** Refused whatever they measure, with why. */
const DENY = new Map([
  ["viem", "10,044 files and 1,202 modules evaluated; 6.5s warm to 137s cold to import on the measuring machine"],
]);

/**
 * Packages the budget may not judge, because their size on disk is not what a
 * boot pays. Each needs a measured reason, not a shrug. Empty on purpose: it
 * exists so the next person adds a line here with a number beside it rather
 * than raising MAX_FILES for everyone.
 */
const ALLOW = new Map([]);

const BUILTIN = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
const EXTS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

function resolveFirstParty(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, "client/src", spec.slice(2));
  else if (spec.startsWith("@shared/")) base = path.join(ROOT, "shared", spec.slice(8));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  const bare = base.replace(/\.js$/, "");
  const candidates = [base, ...EXTS.map((e) => bare + e), ...EXTS.map((e) => path.join(base, `index${e}`))];
  for (const cand of candidates) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return { missing: base };
}

function packageOf(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Static import/export-from specifiers, type-only ones dropped.
 *
 * Anchored at the start of a line, which is where an ESM import statement can
 * legally be, so `import x from "y"` written inside a comment or a string is
 * not mistaken for one. `import(` never matches: `import` must be followed by
 * whitespace here, and a dynamic import is the shape this guard exists to
 * push people towards.
 */
function staticSpecifiers(src) {
  const out = [];
  const stmt = /^[ \t]*import\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s*["']([^"']+)["']/gm;
  const sideEffect = /^[ \t]*import\s*["']([^"']+)["']/gm;
  const reexport = /^[ \t]*export\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s*(?:as\s+\w+\s*)?from\s*["']([^"']+)["']/gm;
  for (const re of [stmt, sideEffect, reexport]) {
    for (const m of src.matchAll(re)) {
      const head = m[0];
      if (/^[ \t]*(?:import|export)\s+type\s/.test(head)) continue; // erased at runtime
      const braces = head.match(/\{([\s\S]*?)\}/);
      if (braces) {
        const named = braces[1].split(",").map((s) => s.trim()).filter(Boolean);
        const beforeBrace = head.slice(0, head.indexOf("{")).replace(/^[ \t]*import/, "").trim();
        // `import { type A, type B } from "x"` erases entirely. A default or
        // namespace binding sitting alongside it does not, so the clause in
        // front of the brace has to be empty for this to count as type-only.
        if (named.length > 0 && named.every((s) => /^type\s/.test(s)) && beforeBrace === "") continue;
      }
      out.push(m[1]);
    }
  }
  return out;
}

const seen = new Set();
const firstPartyFiles = [];
const bare = new Map(); // package -> { specs: Set, via: string }
const unresolved = [];

function walk(file, chain) {
  if (seen.has(file)) return;
  seen.add(file);
  firstPartyFiles.push(file);
  let src;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const spec of staticSpecifiers(src)) {
    if (BUILTIN.has(spec)) continue;
    const r = resolveFirstParty(spec, file);
    if (r === null) {
      const pkg = packageOf(spec);
      if (!bare.has(pkg)) {
        bare.set(pkg, { specs: new Set(), via: [...chain, path.relative(ROOT, file)].join(" -> ") });
      }
      bare.get(pkg).specs.add(spec);
      continue;
    }
    if (typeof r === "object") {
      unresolved.push({ spec, from: path.relative(ROOT, file) });
      continue;
    }
    walk(r, [...chain, path.relative(ROOT, file)]);
  }
}

if (!fs.existsSync(ENTRY)) {
  console.error(`FAIL -- boot entry ${path.relative(ROOT, ENTRY)} does not exist. Nothing was scanned.`);
  process.exit(1);
}
walk(ENTRY, []);

function fileCount(pkg) {
  const dir = path.join(ROOT, "node_modules", pkg);
  if (!fs.existsSync(dir)) return null;
  let n = 0;
  const stack = [fs.realpathSync(dir)];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === "node_modules") continue; // pnpm's own links, not this package's own weight
      if (e.isDirectory()) stack.push(path.join(d, e.name));
      else n += 1;
    }
  }
  return n;
}

const measured = [...bare.entries()]
  .map(([pkg, info]) => ({ pkg, files: fileCount(pkg), ...info }))
  .sort((a, b) => (b.files ?? -1) - (a.files ?? -1));

if (REPORT) {
  for (const m of measured) {
    const count = m.files === null ? "not installed" : String(m.files);
    console.log(`${count.padStart(13)}  ${m.pkg}  [${[...m.specs].join(", ")}]`);
  }
}

/*
 * THE FLOOR. This guard's whole verdict rests on the walk reaching the graph.
 * A resolver that silently stopped at the entry file would refuse nothing and
 * print the same passing line. server/index.ts alone pulls hundreds of
 * first-party files, so anything near zero means the walker broke, not that
 * the tree got clean.
 */
const FLOOR_FILES = Number(arg("--floor", 20));
const failures = [];
if (firstPartyFiles.length < FLOOR_FILES) {
  failures.push(
    `the walk reached only ${firstPartyFiles.length} first-party file(s) from ${path.relative(ROOT, ENTRY)}, ` +
      `under the floor of ${FLOOR_FILES}. The resolver is broken, so this run proves nothing.`,
  );
}

for (const m of measured) {
  const deny = DENY.get(m.pkg);
  if (deny) {
    failures.push(
      `${m.pkg} is statically imported on the boot path (${[...m.specs].join(", ")}) -- ${deny}.\n` +
        `      reached via: ${m.via}\n` +
        `      Use \`await import("${[...m.specs][0]}")\` inside the function that needs it.`,
    );
    continue;
  }
  if (ALLOW.has(m.pkg)) continue;
  if (m.files !== null && m.files > MAX_FILES) {
    failures.push(
      `${m.pkg} is statically imported on the boot path and installs ${m.files} files, over the ` +
        `${MAX_FILES}-file budget.\n      reached via: ${m.via}\n` +
        `      Import it dynamically inside the function that needs it, or add it to ALLOW with a measured reason.`,
    );
  }
}

const notInstalled = measured.filter((m) => m.files === null).map((m) => m.pkg);
const largest = measured.find((m) => m.files !== null);

if (failures.length) {
  console.error(`FAIL -- ${failures.length} heavy package(s) on the boot path:`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    `\nScanned ${firstPartyFiles.length} first-party file(s) reachable from ${path.relative(ROOT, ENTRY)}, ` +
      `${measured.length} distinct package(s).`,
  );
  process.exit(1);
}

console.log(
  `Boot import guard passed. ${firstPartyFiles.length} first-party file(s) statically reachable from ` +
    `${path.relative(ROOT, ENTRY)}, ${measured.length} package(s) on the boot path, largest ` +
    `${largest ? `${largest.pkg} at ${largest.files} files` : "none measured"}, against a ${MAX_FILES}-file budget` +
    `${notInstalled.length ? `; ${notInstalled.length} not resolvable in node_modules (${notInstalled.join(", ")})` : ""}` +
    `${unresolved.length ? `; ${unresolved.length} first-party specifier(s) unresolved` : ""}.`,
);
