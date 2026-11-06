#!/usr/bin/env node
/**
 * AN IMPORT MUST NAME ITS FILE IN THE FILE'S OWN CASE, AND NO TWO FILES IN ONE
 * FOLDER MAY DIFFER ONLY BY CASE BEFORE THE FIRST DOT.
 *
 * WHY (5 Nov 2026). Main at 5e4f5f0 would not typecheck or build on Windows
 * while Linux CI stayed green. `client/src/components/admin` held
 * `AdminFeel.tsx` beside `adminFeel.ts`, and `AdminQueueState.tsx` beside
 * `adminQueueState.ts`. On a case-insensitive disk `./AdminFeel` and
 * `./adminFeel` are the same specifier, so resolution handed both importers
 * one file and the other file's exports vanished: vite's `"replayTour" is not
 * exported by adminFeel.ts`, tsc's TS1149/TS1261 and TS2305. Every lane on a
 * Windows box was blocked, and nothing on Linux could see it.
 *
 * A scan for paths equal when lower-cased finds NOTHING here, because
 * `admin/adminfeel.ts` and `admin/adminfeel.tsx` still differ by extension. So
 * this checks the two things that actually broke:
 *
 *   1. SPECIFIERS. In each folder, no two things an import can name (a code
 *      file less its extension, or a folder holding an index file) that are
 *      equal lower-cased and different as written. `AdminFeel.tsx` beside
 *      `adminFeel.ts` is one (`AdminFeel` and `adminFeel`), and so is
 *      `AdminQueueState.test.tsx` beside `adminQueueState.test.ts`.
 *      `CardInvite.tsx` beside `cardInvite.test.tsx` is not (`CardInvite` and
 *      `cardInvite.test` never meet), and `adminNight.css` beside
 *      `adminNight.ts` is not (a stylesheet is named with its extension).
 *   2. SPELLING. Every relative import, and every `@/` and `@shared/` import,
 *      that reaches a file must spell each path segment in that file's on-disk
 *      case. A specifier that resolves only case-insensitively is a fault. One
 *      that resolves to nothing at all is not this guard's business (a package,
 *      a virtual module, or a typo tsc already reports).
 *
 * What it reads: every .ts, .tsx, .js, .jsx, .mjs and .cjs file under
 * client/src, server, shared and scripts, skipping node_modules and dist.
 * Import specifiers are found by pattern (`from "…"`, `import("…")`,
 * `import "…"`, `require("…")`, `vi.mock("…")`), so a specifier written inside
 * a comment is checked too. That costs nothing when it is spelled right.
 *
 * What it cannot see: a specifier built at run time, and a collision between a
 * folder and a file (`Foo/` beside `foo.ts`). TypeScript's
 * forceConsistentCasingInFileNames (set in tsconfig.json) is the second line,
 * and it fires only where the disk is case-insensitive.
 *
 * Usage:
 *   node scripts/check-import-casing.mjs              this repository
 *   node scripts/check-import-casing.mjs --root <dir> another tree (the self-test's fixtures)
 *   node scripts/check-import-casing.mjs --json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const at = argv.indexOf("--root");
const ROOT = at >= 0 ? path.resolve(argv[at + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asJson = argv.includes("--json");

const SCAN = ["client/src", "server", "shared", "scripts"];
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const ALIASES = [
  ["@/", "client/src/"],
  ["@shared/", "shared/"],
];
/** Tried in the bundler's order: a file with an added extension before the name as written, which may be a folder. */
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ""];
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual)\s*\(\s*)(["'])([^"'\n]+)\1/g;

/** Directory listings, read once each. */
const listings = new Map();
function list(dir) {
  if (!listings.has(dir)) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      /* not a folder */
    }
    listings.set(dir, names);
  }
  return listings.get(dir);
}

function walk(rel, out) {
  const abs = path.join(ROOT, rel);
  for (const name of list(abs)) {
    if (SKIP_DIRS.has(name)) continue;
    const childRel = rel ? `${rel}/${name}` : name;
    let st;
    try {
      st = fs.statSync(path.join(ROOT, childRel));
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(childRel, out);
    else if (CODE.test(name)) out.push(childRel);
  }
}

const faults = [];

// ── 1. Specifiers a folder offers ───────────────────────────────────────────
/**
 * The name an import reaches a file by: the file name less its code extension
 * (`AdminFeel.tsx` -> `AdminFeel`, `adminFeel.test.ts` -> `adminFeel.test`), or
 * a folder's own name when it holds an index file. Anything else (a .css, a
 * folder with no index) is reached by its full name and cannot be confused
 * with a code file's specifier, so it offers none.
 */
function specifierOf(relDir, name) {
  const m = /^(.+)\.(ts|tsx|js|jsx|mjs|cjs)$/.exec(name);
  if (m) return m[1];
  const abs = path.join(ROOT, relDir, name);
  try {
    if (fs.statSync(abs).isDirectory() && list(abs).some((n) => /^index\.(ts|tsx|js|jsx|mjs|cjs)$/.test(n))) return name;
  } catch {
    /* gone */
  }
  return null;
}

const dirsSeen = new Set();
function checkStems(relDir) {
  if (dirsSeen.has(relDir)) return;
  dirsSeen.add(relDir);
  const byLower = new Map();
  for (const name of list(path.join(ROOT, relDir))) {
    const stem = specifierOf(relDir, name);
    if (!stem) continue;
    const key = stem.toLowerCase();
    if (!byLower.has(key)) byLower.set(key, new Map());
    const spellings = byLower.get(key);
    if (!spellings.has(stem)) spellings.set(stem, []);
    spellings.get(stem).push(name);
  }
  for (const spellings of byLower.values()) {
    if (spellings.size < 2) continue;
    const names = [...spellings.values()].flat().sort();
    faults.push({ kind: "stem", at: relDir, files: names, why: `${names.join(" and ")} are imported by names that differ only by case` });
  }
}

// ── 2. Spelling ─────────────────────────────────────────────────────────────
/**
 * Walk a relative path segment by segment from `baseAbs`. Returns "exact" when
 * every segment matches as written, "case" when it matches only with case
 * folded, and null when it does not exist at all.
 */
function resolveSegments(baseAbs, relPath) {
  let dir = baseAbs;
  let exact = true;
  const parts = relPath.split("/").filter((p) => p && p !== ".");
  for (const part of parts) {
    if (part === "..") {
      dir = path.dirname(dir);
      continue;
    }
    const names = list(dir);
    if (names.includes(part)) {
      dir = path.join(dir, part);
      continue;
    }
    const folded = names.find((n) => n.toLowerCase() === part.toLowerCase());
    if (!folded) return null;
    exact = false;
    dir = path.join(dir, folded);
  }
  return exact ? "exact" : "case";
}

function checkSpecifier(fileRel, spec) {
  let baseAbs;
  let rest;
  if (spec.startsWith("./") || spec.startsWith("../")) {
    baseAbs = path.join(ROOT, path.dirname(fileRel));
    rest = spec;
  } else {
    const alias = ALIASES.find(([p]) => spec.startsWith(p));
    if (!alias) return;
    baseAbs = path.join(ROOT, alias[1]);
    rest = spec.slice(alias[0].length);
  }
  rest = rest.split("?")[0];
  // The first spelling that exists at all decides: exact, or only with case folded.
  for (const ext of EXTS) {
    const r = resolveSegments(baseAbs, rest + ext);
    if (r === "exact") return;
    if (r === "case") {
      faults.push({ kind: "spelling", at: fileRel, spec, why: `"${spec}" reaches a file only when case is ignored` });
      return;
    }
  }
  for (const ext of EXTS.slice(0, -1)) {
    const r = resolveSegments(baseAbs, `${rest}/index${ext}`);
    if (r === "exact") return;
    if (r === "case") {
      faults.push({ kind: "spelling", at: fileRel, spec, why: `"${spec}" reaches a folder index only when case is ignored` });
      return;
    }
  }
}

const files = [];
for (const top of SCAN) if (fs.existsSync(path.join(ROOT, top))) walk(top, files);
for (const f of files) {
  checkStems(path.posix.dirname(f));
  const text = fs.readFileSync(path.join(ROOT, f), "utf8");
  SPEC.lastIndex = 0;
  let m;
  while ((m = SPEC.exec(text)) !== null) checkSpecifier(f, m[2]);
}

if (asJson) {
  process.stdout.write(JSON.stringify({ files: files.length, folders: dirsSeen.size, faults }, null, 2) + "\n");
} else if (faults.length) {
  console.error(`::error::${faults.length} import casing fault(s). A case-insensitive disk (Windows, macOS) resolves these to the wrong file or merges two files into one.`);
  for (const f of faults) console.error(`    [${f.kind}] ${f.at}: ${f.why}`);
  console.error("  Rename one file of each pair so the names differ by more than case, and spell every import as the file is spelled.");
} else {
  console.log(`  import casing: ${files.length} file(s) in ${dirsSeen.size} folder(s), every import spelled as its file, no two import names differing only by case`);
}
process.exit(faults.length ? 1 : 0);
