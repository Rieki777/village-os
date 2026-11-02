#!/usr/bin/env node
/**
 * The bundle budget, measured the way CI measures it.
 *
 * WHY THIS FILE EXISTS. The budget lived as a shell block in
 * `.github/workflows/ci.yml` and CLAUDE.md said "nothing local reproduces
 * them". That was true, and it cost a lane a full session: the workflow sizes
 * `dist/public` with `du -sk`, and `du` reports ALLOCATED BLOCKS. On the ext4
 * filesystem GitHub runners use, every file consumes a whole 4096-byte block,
 * so a 300-byte chunk costs 4 KB and a 4100-byte chunk costs 8 KB. Add up the
 * rounding across a tree with a hundred small files and the gate reads about
 * 700 KB heavier than the bytes actually on disk. A lane that measured real
 * bytes locally saw headroom that CI did not have.
 *
 * THE COUNTER-INTUITIVE PART, and the reason this is worth a script instead of
 * a comment: the two budgets pull in opposite directions.
 *
 *   MAX_MAIN_JS_KB is REAL BYTES on one file. Splitting a route out of the
 *   main chunk makes that number fall. Splitting is the fix.
 *   MAX_TOTAL_DIST_KB is BLOCK-CHARGED bytes across the tree. Splitting a
 *   4 KB module into its own chunk adds a whole block whatever the module
 *   weighs, so splitting makes that number RISE. Merging is the fix.
 *
 * A build tuned only for the first budget quietly spends the second. This
 * script prints both so the trade is visible before a push, and it names the
 * files paying the most padding so the next lane knows where to look.
 *
 * WHAT IT MEASURES, precisely, so the arithmetic can be checked by hand:
 *   real bytes      sum of file sizes.
 *   block-charged   sum of ceil(size / 4096) * 4096 over files, plus what each
 *                   directory costs. Empty files cost nothing, which is what
 *                   `du` reports for them.
 *
 * A DIRECTORY IS NOT ALWAYS ONE BLOCK, which is the detail that made a first
 * version of this read 8 KB light. ext4 stores directory entries in 4 KB
 * blocks and grows past one once the names stop fitting, then adds an htree
 * index block on top. `dist/public/assets` holds about 120 hashed filenames
 * and measures 12288 bytes on ext4, three blocks where the other five
 * directories in the tree take one each. So directories are costed from their
 * entry names here, the same way the filesystem does it. Checked against a
 * real ext4 volume: `du -sk` said 5432 KB and this says 5432 KB.
 *
 * The numbers come off `.github/workflows/ci.yml`, which CLAUDE.md names as
 * the authority for them, so this script cannot drift from the gate by holding
 * a stale copy. Environment variables override for a what-if run.
 *
 * Usage:
 *   node scripts/check-dist-budget.mjs           # the gate, plus the report
 *   node scripts/check-dist-budget.mjs --report  # measure only, always exit 0
 *   node scripts/check-dist-budget.mjs --json    # machine readable
 *
 * Read the exit code. A failing run prints `::error::` lines that GitHub lifts
 * into the run summary, and those are not reliably the last line on a
 * terminal.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist", "public");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "ci.yml");

/** ext4 allocates whole blocks of this size, and `du` counts what is allocated. */
const BLOCK = 4096;

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const reportOnly = args.includes("--report");

/** Reads a budget off the workflow so this script and CI cannot disagree. */
function budgetFromWorkflow(name, fallback) {
  const fromEnv = process.env[name];
  if (fromEnv && /^\d+$/.test(fromEnv)) return { value: Number(fromEnv), source: "env" };
  try {
    const yml = fs.readFileSync(WORKFLOW, "utf8");
    const m = yml.match(new RegExp(`^\\s*${name}:\\s*(\\d+)\\s*$`, "m"));
    if (m) return { value: Number(m[1]), source: ".github/workflows/ci.yml" };
  } catch {
    /* falls through to the fallback below */
  }
  return { value: fallback, source: "built-in fallback" };
}

/**
 * What one directory costs on ext4, from the names it holds.
 *
 * Each entry is an 8-byte header plus the name rounded up to a multiple of 4,
 * and the first block also carries `.` and `..`. A small directory is one
 * linear block. Once the entries stop fitting, ext4 switches to an htree: one
 * index block above some number of leaf blocks.
 *
 * The leaves are the part worth explaining. An htree splits a leaf by HASH
 * RANGE and not by fill, so leaves sit partly empty and counting bytes as
 * though they packed tight reads a block light. LEAF_FILL is where that lands
 * in practice, and it is pinned tighter than it looks: on the trees checked
 * here 7100 bytes of entries took two leaves and 8044 took three, which puts
 * the boundary between 0.867 and 0.982, and 0.9 sits inside it.
 *
 * This is a model of a filesystem, so treat it as accurate to about one block
 * per large directory. It matched `du -sk` exactly on four different built
 * trees, and CI still runs `du` beside it as the authority.
 */
const LEAF_FILL = 0.9;
function directoryBytes(names) {
  const ENTRY_HEADER = 8;
  const DOT_ENTRIES = 24;
  const dirents = names.reduce((sum, n) => sum + ENTRY_HEADER + Math.ceil(Buffer.byteLength(n, "utf8") / 4) * 4, 0);
  if (dirents + DOT_ENTRIES <= BLOCK) return BLOCK;
  return (Math.ceil(dirents / (BLOCK * LEAF_FILL)) + 1) * BLOCK;
}

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  out.dirBytes += directoryBytes(entries.map((e) => e.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.dirs += 1;
      walk(full, out);
    } else if (entry.isFile()) {
      out.files.push({ path: path.relative(DIST, full).split(path.sep).join("/"), bytes: fs.statSync(full).size });
    }
  }
  return out;
}

const charged = (bytes) => (bytes === 0 ? 0 : Math.ceil(bytes / BLOCK) * BLOCK);
const kb = (bytes) => Math.floor(bytes / 1024);

if (!fs.existsSync(DIST)) {
  console.error("::error::dist/public is missing. Run pnpm build first: this gate measures the built tree.");
  process.exit(1);
}

const scan = walk(DIST, { files: [], dirs: 1, dirBytes: 0 });
const files = scan.files;

const realBytes = files.reduce((sum, f) => sum + f.bytes, 0);
const fileBlocks = files.reduce((sum, f) => sum + charged(f.bytes), 0);
const blockBytes = fileBlocks + scan.dirBytes;
const overheadBytes = blockBytes - realBytes;

const buckets = [
  { label: "under 1 KB", min: 0, max: 1024 },
  { label: "1 to 2 KB", min: 1024, max: 2048 },
  { label: "2 to 4 KB", min: 2048, max: 4096 },
  { label: "4 to 8 KB", min: 4096, max: 8192 },
  { label: "over 8 KB", min: 8192, max: Infinity },
];
const histogram = buckets.map((b) => {
  const inBucket = files.filter((f) => f.bytes >= b.min && f.bytes < b.max);
  return {
    label: b.label,
    count: inBucket.length,
    paddingBytes: inBucket.reduce((sum, f) => sum + (charged(f.bytes) - f.bytes), 0),
  };
});

/*
 * Zero-byte files are counted here and contribute nothing, which keeps this
 * line's count equal to the first three histogram buckets. `du` charges an
 * empty file no blocks, so it wastes no padding either.
 */
const subBlock = files.filter((f) => f.bytes < BLOCK);
const subBlockPadding = subBlock.reduce((sum, f) => sum + (f.bytes === 0 ? 0 : BLOCK - f.bytes), 0);

const worst = files
  .map((f) => ({ ...f, padding: charged(f.bytes) - f.bytes }))
  .sort((a, b) => b.padding - a.padding)
  .slice(0, 12);

/** The main chunk is the largest `assets/index-*.js`, matching the workflow. */
const mainCandidates = files.filter((f) => /^assets\/index-[^/]*\.js$/.test(f.path)).sort((a, b) => b.bytes - a.bytes);
const mainBytes = mainCandidates.length ? mainCandidates[0].bytes : 0;

/**
 * THE FIRST PAGE'S SCRIPTS, every `.js` file index.html names (the entry
 * script, its modulepreloads, the route preloader), in real bytes. Main JS
 * reads one file, and how rollup spreads the boot modules over files is a
 * chunking choice: on 2026-10-31 the small-module groups in vite.config.ts
 * moved react and the shared boot modules out of the entry chunk, and main JS
 * fell from 620 KB to 362 KB while the first page loaded the same code. This
 * number does not move when code only changes file, so it is the one that
 * says what a visitor fetches before anything renders.
 */
const indexHtml = fs.existsSync(path.join(DIST, "index.html")) ? fs.readFileSync(path.join(DIST, "index.html"), "utf8") : "";
const bootPaths = new Set(Array.from(indexHtml.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.js)"/g), (m) => m[1]));
const bootFiles = files.filter((f) => bootPaths.has(f.path));
const bootBytes = bootFiles.reduce((sum, f) => sum + f.bytes, 0);

const MAX_MAIN = budgetFromWorkflow("MAX_MAIN_JS_KB", 700);
const MAX_BOOT = budgetFromWorkflow("MAX_BOOT_JS_KB", 750);
const MAX_TOTAL = budgetFromWorkflow("MAX_TOTAL_DIST_KB", 6600);

const mainKb = kb(mainBytes);
const bootKb = kb(bootBytes);
const totalKb = kb(blockBytes);
const realKb = kb(realBytes);

const result = {
  files: files.length,
  directories: scan.dirs,
  realKb,
  blockChargedKb: totalKb,
  overheadKb: kb(overheadBytes),
  subBlockFiles: subBlock.length,
  subBlockPaddingKb: kb(subBlockPadding),
  mainJsKb: mainKb,
  maxMainJsKb: MAX_MAIN.value,
  bootJsKb: bootKb,
  bootJsFiles: bootFiles.length,
  maxBootJsKb: MAX_BOOT.value,
  maxTotalDistKb: MAX_TOTAL.value,
  histogram: histogram.map((h) => ({ label: h.label, count: h.count, paddingKb: kb(h.paddingBytes) })),
  worstPadding: worst.map((w) => ({ path: w.path, bytes: w.bytes, paddingBytes: w.padding })),
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
}

const lines = [];
const say = (line) => {
  lines.push(line);
  if (!asJson) console.log(line);
};

say("dist/public, measured two ways");
say(`  files                    ${files.length} in ${scan.dirs} directories`);
say(`  real bytes               ${realKb} KB`);
say(`  block-charged (du, ext4) ${totalKb} KB   <- THIS is what MAX_TOTAL_DIST_KB gates`);
say(`  padding overhead         ${kb(overheadBytes)} KB`);
say(`  files under 4 KB         ${subBlock.length}, burning ${kb(subBlockPadding)} KB in padding alone`);
say("");
say("size histogram");
for (const h of histogram) {
  say(`  ${h.label.padEnd(11)} ${String(h.count).padStart(4)} file(s), ${String(kb(h.paddingBytes)).padStart(4)} KB padding`);
}
say("");
say("worst offenders by padding");
for (const w of worst) {
  say(`  ${String(w.padding).padStart(5)} B wasted  ${String(w.bytes).padStart(7)} B on disk  ${w.path}`);
}
say("");
say(`Main JS: ${mainKb} KB of ${MAX_MAIN.value} KB, measured in REAL bytes (${MAX_MAIN.source})`);
say(`First-page JS: ${bootKb} KB of ${MAX_BOOT.value} KB across the ${bootFiles.length} scripts index.html loads, in REAL bytes (${MAX_BOOT.source})`);
say(`Total dist/public: ${totalKb} KB of ${MAX_TOTAL.value} KB, measured in BLOCK-CHARGED bytes (${MAX_TOTAL.source})`);
say(`  the same tree is ${realKb} KB in real bytes, so ${kb(overheadBytes)} KB of the ceiling pays for 4 KB block rounding`);
say("");
say("Splitting a chunk lowers main JS and RAISES the block-charged total.");
say("Merging small chunks lowers the total. Watch both numbers on any chunking change.");

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
}

if (reportOnly) process.exit(0);

let fail = 0;
if (!mainCandidates.length) {
  console.error("::error::No dist/public/assets/index-*.js found. The build did not produce a main chunk.");
  fail = 1;
}
if (mainKb > MAX_MAIN.value) {
  console.error(
    `::error::Main JS bundle is ${mainKb} KB, over the ${MAX_MAIN.value} KB budget. Split a route instead of raising the budget. Note that splitting adds a 4 KB block to the total below.`,
  );
  fail = 1;
}
if (!bootFiles.length) {
  console.error("::error::dist/public/index.html names no assets/*.js script. The build did not produce a first page to measure.");
  fail = 1;
}
if (bootKb > MAX_BOOT.value) {
  console.error(
    `::error::The first page loads ${bootKb} KB of scripts across ${bootFiles.length} files, over the ${MAX_BOOT.value} KB budget. Something the entry imports statically grew or joined it; make it lazy instead of raising the budget.`,
  );
  fail = 1;
}
if (totalKb > MAX_TOTAL.value) {
  console.error(
    `::error::dist/public is ${totalKb} KB block-charged (${realKb} KB of real bytes plus ${kb(overheadBytes)} KB of 4 KB block padding), over the ${MAX_TOTAL.value} KB budget. Check whether something large landed in client/public and belongs in the uploads volume, and whether a crop of sub-4 KB chunks can merge into their parents.`,
  );
  fail = 1;
}
process.exit(fail);
