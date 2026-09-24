#!/usr/bin/env node
/**
 * The brand-reference guard (S56): platform code carries NO village's brand.
 *
 * The rule (economy/architecture invariant 2.1 #2): identity lives in
 * shared/gameConfig.ts, behaviour in shared/gameVariables.ts, per-deployment
 * data in DB rows and seeds. A fork inherits the platform by pulling; if a
 * village's name is welded into a lib file, every fork inherits that village.
 *
 * Three zones, because a blanket ban on 400+ legacy hits would be ignored
 * within a week:
 *
 *   HARD-CLEAN — any hit fails. server/lib/**, shared/** (except the
 *     declared identity home), scripts/**, drizzle/**, and EVERY file not
 *     in the baseline. New code is born clean, everywhere.
 *   DECLARED HOMES — exempt. shared/gameConfig.ts, server/seeds/**, docs,
 *     markdown, this script and its baseline: brand belongs there.
 *   RATCHET — server/index.ts and client/src/** may only ever DECREASE.
 *     The baseline is committed; CI fails if a count rises or a new file
 *     appears. 400+ legacy hits become a monotonic burn-down instead of a
 *     permanent allowlist.
 *
 * A genuine false positive gets an inline `brand-ok: <reason>` on the line;
 * waivers are counted and printed so they stay honest.
 *
 * --update-baseline is a RATCHET, the same discipline as
 * `scripts/check-image-budget.mjs`: per file, the recorded count may only
 * fall. Without that check, `--update-baseline` run after ADDING a brand
 * reference would silently raise the allowance it exists to hold down, which
 * is exactly the failure this guard is supposed to catch in everyone else's
 * code. `--force` is the deliberate escape hatch (a file's ratchet zone
 * genuinely grew) and it still prints every raise, so a forced raise is
 * never quiet even when it is intentional.
 *
 * Usage:
 *   node scripts/check-brand-refs.mjs                          # the gate
 *   node scripts/check-brand-refs.mjs --update-baseline         # only ever downward, per file
 *   node scripts/check-brand-refs.mjs --update-baseline --force # allow a deliberate raise
 */
import fs from "fs";
import path from "path";
import { stripComments } from "./brand-strip.mjs";
import { dropIgnored } from "./git-subjects.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const BASELINE_PATH = path.join(ROOT, "scripts", "brand-refs-baseline.json");

/** Forks extend this with their own village's terms. */
const BANNED = [
  "amora",
  "dominicalito",
  "regencivics",
  "amoracita",
];

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".sql", ".css", ".html", ".json"]);

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".vite", "attached_assets", "data"]);

/** Declared homes: brand belongs here by design. */
const EXEMPT = [
  "shared/gameConfig.ts",
  "server/seeds/",
  "docs/",
  "scripts/check-brand-refs.mjs",
  "scripts/brand-refs-baseline.json",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
];

/**
 * THE SHOPFRONT (Rye, 2026-08-03). Public brochure pages: the story this
 * village tells about itself to people who are not members yet.
 *
 * A fork does not white-label these, it REPLACES them, the way it replaces
 * its own logo. Policing a village's own prose for its own name cost real
 * effort and taught nobody anything: 13 of these pages carried the entire
 * remaining ratchet debt, and none of it was ever going to be paid down.
 *
 * The line is drawn at PRODUCT: anything a signed-in member coordinates
 * through (the forum, the map, the library, the wallet, the admin) stays
 * ratcheted and must white-label properly. If a new page here starts
 * carrying member-facing machinery, take it off this list.
 */
const SHOPFRONT = [
  "client/src/pages/Home.tsx",
  "client/src/pages/Team.tsx",
  "client/src/pages/MasterPlan.tsx",
  "client/src/pages/ProjectHistory.tsx",
  "client/src/pages/Housing.tsx",
  "client/src/pages/Opportunities.tsx",
  "client/src/pages/Visit.tsx",
  "client/src/pages/WorkWithUs.tsx",
  "client/src/pages/LoveLetter.tsx",
  "client/src/pages/GoodNeighbor.tsx",
  "client/src/pages/CoCreatorsGuide.tsx",
  "client/src/pages/HowWeCreate.tsx",
  "client/src/pages/InvestorJourney.tsx",
  "client/src/pages/StewardJourney.tsx",
  "client/src/pages/ResidentJourney.tsx",
  "client/src/pages/ProsperityJourney.tsx",
  "client/src/pages/ResidentRights.tsx",
  "client/src/pages/StewardRights.tsx",
  "client/src/components/WhyCostaRica.tsx",
];

/**
 * Ratchet zones: counts may fall, never rise — and a NEW file in one of
 * them starts at a baseline of zero, so it must be clean like everywhere
 * else. Applied migrations are immutable history (their token seeds name
 * the deployment that ran them); the app shell, the client pages and the
 * test fixtures are a fork's to rewrite. All burn down, none may grow.
 */
const RATCHET = ["server/index.ts", "client/", "drizzle/", "vitest.config.ts", "scripts/"];

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const isExempt = (r) =>
  EXEMPT.some((e) => r === e || r.startsWith(e)) || SHOPFRONT.includes(r) || r.endsWith(".md");
const isRatchet = (r) => RATCHET.some((z) => r === z || r.startsWith(z)) || /\.test\.tsx?$/.test(r);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const pattern = new RegExp(`\\b(${BANNED.join("|")})`, "i");

/**
 * The guard reads CODE, not commentary. A comment recording where a design
 * came from ("ported verbatim so this and regen-civics agree") is honest
 * provenance a fork should keep; a brand name inside a string literal or an
 * identifier is what a fork would inherit and have to hunt down. Comments
 * are counted separately and reported, never failed.
 */
function scanFile(file) {
  const hits = [];
  let waived = 0;
  let provenance = 0;
  const ext = path.extname(file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let inBlock = false;
  lines.forEach((line, i) => {
    const opensBlock = /\/\*/.test(line) && !/\*\//.test(line);
    const closesBlock = /\*\//.test(line);
    const wasInBlock = inBlock;
    if (opensBlock) inBlock = true;
    if (closesBlock) inBlock = false;
    if (!pattern.test(line)) return;
    if (/brand-ok:/.test(line)) { waived += 1; return; }
    const code = wasInBlock ? "" : stripComments(line, ext);
    if (!pattern.test(code)) { provenance += 1; return; }
    hits.push({ line: i + 1, text: line.trim().slice(0, 120) });
  });
  return { hits, waived, provenance };
}

const walked = walk(ROOT);
const { kept: tracked, skipped: ignoredCount, consulted: gitConsulted } = dropIgnored(walked, { cwd: ROOT, rel });
const files = tracked.filter((f) => !isExempt(rel(f)));
const counts = {};
const details = {};
let waivers = 0;
let provenanceTotal = 0;
for (const file of files) {
  const r = rel(file);
  const { hits, waived, provenance } = scanFile(file);
  waivers += waived;
  provenanceTotal += provenance;
  if (hits.length) { counts[r] = hits.length; details[r] = hits; }
}

/**
 * SHOPFRONT is exempt, not zero. Every OTHER exempt/ratchet number this
 * script prints (ratchetTotal, baselineTotal, waivers, provenanceTotal) is
 * visible somewhere in its own output; the SHOPFRONT count was not, so a
 * green "hard-clean zones are clean" line could read as "no village name
 * anywhere" when 165 lived, unmeasured, in 19 files by design. Counted the
 * same way as everything else (one hit per matching line) so it is
 * comparable, never folded into `failures` because these files are correctly
 * never a gate: R1 (fleet program) makes THIS number the thing to watch, since
 * every founder instance inherits these 19 pages until a fork rewrites them.
 */
let shopfrontTotal = 0;
for (const relPath of SHOPFRONT) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) continue;
  shopfrontTotal += scanFile(abs).hits.length;
}

if (process.argv.includes("--update-baseline")) {
  const ratchetOnly = Object.fromEntries(Object.entries(counts).filter(([f]) => isRatchet(f)));
  const oldBaseline = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) : {};
  const force = process.argv.includes("--force");

  // Per file, never the total: the gate above enforces `count > baseline[file]`
  // one file at a time, so that is also the unit a raise has to be caught in.
  // A total-only check would miss a file rising from 0 to 3 while another
  // file elsewhere fell by 4: global total down, one file's ceiling raised.
  const raised = Object.entries(ratchetOnly)
    .map(([file, count]) => ({ file, from: oldBaseline[file] ?? 0, to: count }))
    .filter((r) => r.to > r.from);

  if (raised.length && !force) {
    console.error(`\n::error::refusing to raise the brand-refs baseline for ${raised.length} file(s):\n`);
    for (const r of raised) console.error(`  ${r.file}: ${r.from} -> ${r.to}`);
    console.error(
      `\nThis ratchet only turns down. If a hit is a genuine false positive, add ` +
      `\`brand-ok: <reason>\` on that line instead of raising the baseline. If the raise is ` +
      `genuinely deliberate, rerun with --force.\n`,
    );
    process.exit(1);
  }

  fs.writeFileSync(BASELINE_PATH, JSON.stringify(ratchetOnly, null, 2) + "\n");
  const total = Object.values(ratchetOnly).reduce((n, v) => n + v, 0);
  if (raised.length) {
    console.log(`\n::warning::baseline RAISED for ${raised.length} file(s) via --force:`);
    for (const r of raised) console.log(`  ${r.file}: ${r.from} -> ${r.to}`);
    console.log("");
  }
  console.log(`Baseline written: ${Object.keys(ratchetOnly).length} file(s), ${total} reference(s).`);
  const hardNow = Object.entries(counts).filter(([f]) => !isRatchet(f));
  if (hardNow.length) {
    console.log("\nNOTE: these are in HARD-CLEAN zones and are NOT baselined — they must be fixed:");
    for (const [f, n] of hardNow) console.log(`  ${f}: ${n}`);
  }
  process.exit(0);
}

const baseline = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) : {};
const failures = [];

for (const [file, count] of Object.entries(counts)) {
  if (isRatchet(file)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) {
      failures.push({
        file,
        reason: `${count} brand reference(s), baseline allows ${allowed} — the ratchet only turns down`,
        hits: details[file].slice(0, 5),
      });
    }
  } else {
    failures.push({
      file,
      reason: `${count} brand reference(s) in a HARD-CLEAN zone — platform code carries no village's brand`,
      hits: details[file].slice(0, 5),
    });
  }
}

const ratchetTotal = Object.entries(counts).filter(([f]) => isRatchet(f)).reduce((n, [, v]) => n + v, 0);
const baselineTotal = Object.values(baseline).reduce((n, v) => n + v, 0);

if (failures.length) {
  console.error("\nBRAND GUARD FAILED — \"No village's brand in platform code\" (invariant 2.1 #2).\n");
  console.error("Identity belongs in shared/gameConfig.ts; per-deployment data belongs in seeds or the database.\n");
  for (const f of failures) {
    console.error(`  ${f.file} — ${f.reason}`);
    for (const h of f.hits) console.error(`      ${f.file}:${h.line}: ${h.text}`);
  }
  console.error(`\nIf a hit is a genuine false positive, add \`brand-ok: <reason>\` on that line.`);
  console.error(`If you REMOVED references, refresh the baseline: node scripts/check-brand-refs.mjs --update-baseline\n`);
  console.error(`(SHOPFRONT stays exempt regardless: ${shopfrontTotal} reference(s) in ${SHOPFRONT.length} brochure page(s), by design, see EXEMPT/SHOPFRONT above.)\n`);
  process.exit(1);
}

console.log(
  `Brand guard passed. Ratchet zones hold ${ratchetTotal} legacy reference(s) in code ` +
  `(baseline ${baselineTotal}); hard-clean zones are clean; ` +
  `${provenanceTotal} provenance mention(s) in comments; ${waivers} waiver(s) in force. ` +
  `SHOPFRONT (${SHOPFRONT.length} brochure page(s), never gated by design: a fork replaces them, it does not white-label them) carries ${shopfrontTotal} reference(s).`,
);

/*
 * THE DENOMINATOR, PRINTED WHETHER OR NOT ANYTHING WAS SKIPPED.
 *
 * A guard that stopped scanning too much and a guard that stopped scanning at
 * all report the same green, so the population is stated rather than implied.
 * The second line only appears when git declined to answer, and it says the
 * filter did NOT run rather than letting a full scan pass for a filtered one.
 */
console.log(
  `  scanned ${files.length} of ${walked.length} file(s) on disk: ` +
  `${ignoredCount} ignored by git, ${tracked.length - files.length} exempt by this guard.`,
);
if (!gitConsulted) {
  console.log("  NOTE: git could not be consulted, so nothing was filtered and every walked file was scanned.");
}
