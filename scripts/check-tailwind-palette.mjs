#!/usr/bin/env node
/**
 * The Tailwind-palette ratchet: every colour a page paints should come from
 * the village's palette, the one Admin > Make it yours > Look sets (Rye,
 * 2026-11-09: "all pages should be responsive and wired up to that design
 * scheme set in admin").
 *
 * WHAT IT COUNTS. Any Tailwind DEFAULT-PALETTE utility: a numbered step of one
 * of Tailwind's own colour families (`bg-emerald-50`, `text-blue-900`,
 * `border-stone-200`, `from-amber-100`, `ring-red-500`, ...) on any colour
 * utility, behind any variant (`hover:`, `md:`). Those are compiled from
 * Tailwind's palette, not from this repo's custom properties, so no seed,
 * accent or character a founder picks can ever reach them.
 *
 * WHAT IT DOES NOT COUNT. `text-gray-*` outside the admin zone: that is
 * scripts/check-tailwind-gray.mjs's number, and counting it twice would make
 * both numbers mean less. That guard SKIPS the admin zone, so this one counts
 * admin files with their `text-gray-*` included. Rye's light-only ruling for
 * Admin (2026-09-04) is about dark mode; it does not let Admin ignore the
 * village's palette, and the 2026-11-09 brief names Admin among the pages to
 * align.
 *
 * THE ALLOW-LIST IS THE TOKEN LAYER. Every `@theme inline` colour in
 * client/src/index.css carries no number and is never matched: the shadcn set
 * (`bg-card`, `text-muted-foreground`, `border-border`, `bg-primary`), the tone
 * layer (`teal-deep`, `aqua-light`, `cream`) and the status tokens:
 *   success      text-open        bg-sage-light
 *   warning      text-notice      bg-amber-light
 *   danger       text-destructive bg-destructive/10
 *   information  text-teal-deep   bg-aqua-light
 *
 * THE RATCHET is check-tailwind-gray.mjs's: a per-file baseline in
 * scripts/tailwind-palette-baseline.json that only falls, a write path that
 * refuses any file going up (R205), and new files born at zero. A genuine
 * false positive (a class name quoted in prose that renders nothing) takes
 * `palette-ok: <reason>` on its line, or alone on the line above.
 *
 * Usage:
 *   node scripts/check-tailwind-palette.mjs                    # the gate
 *   node scripts/check-tailwind-palette.mjs --json              # machine readable
 *   node scripts/check-tailwind-palette.mjs --update-baseline   # only ever downward
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./brand-strip.mjs";

const flagValue = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
// `--root` and `--baseline` exist for the self-test (check-colour-ratchets.test.mjs).
const ROOT = path.resolve(flagValue("--root") ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const SCAN_ROOT = path.join(ROOT, "client", "src");
const BASELINE_PATH = flagValue("--baseline")
  ? path.resolve(flagValue("--baseline"))
  : path.join(ROOT, "scripts", "tailwind-palette-baseline.json");

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx") && !/\.test\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FAMILIES = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITIES = "bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|divide|from|via|to|fill|stroke|accent|caret|decoration|placeholder|shadow";
export const PALETTE = new RegExp(`(?<![\\w-])(?:${UTILITIES})-(?:${FAMILIES})-\\d{2,3}\\b`, "g");

// Same zone as check-tailwind-gray.mjs's LIGHT_SURFACES: there it is skipped, here it is counted whole.
const ADMIN_ZONE = ["client/src/pages/Admin.tsx", "client/src/components/admin/"];
const inAdminZone = (r) => ADMIN_ZONE.some((p) => r === p || r.startsWith(p));

/** See check-tailwind-gray.mjs's commentStateAfterLine for the two traps this avoids. */
function commentStateAfterLine(line, startsInComment) {
  let quote = null;
  let inComment = startsInComment;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inComment) {
      if (c === "*" && line[i + 1] === "/") { inComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (c === "\\") { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "/" && line[i + 1] === "*") { inComment = true; i += 1; continue; }
  }
  return inComment;
}

function scanFile(file, admin) {
  const ext = path.extname(file);
  const lines = fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n");
  let count = 0;
  let waived = 0;
  const hits = [];
  let inBlock = false;
  let pendingWaiver = false;
  lines.forEach((line, i) => {
    const wasInBlock = inBlock;
    inBlock = commentStateAfterLine(line, wasInBlock);
    const code = wasInBlock ? "" : stripComments(line, ext);
    const all = code.match(PALETTE) ?? [];
    const found = admin ? all : all.filter((m) => !m.startsWith("text-gray-"));
    if (/palette-ok:/.test(line)) {
      if (found.length > 0) { waived += 1; pendingWaiver = false; } else pendingWaiver = true;
      return;
    }
    if (code.trim() === "") return;
    if (found.length > 0 && pendingWaiver) { waived += 1; pendingWaiver = false; return; }
    pendingWaiver = false;
    if (found.length > 0) {
      count += found.length;
      hits.push({ line: i + 1, text: line.trim().slice(0, 140) });
    }
  });
  return { count, waived, hits };
}

const counts = {};
const details = {};
let totalWaivers = 0;
let adminFiles = 0;
for (const file of walk(SCAN_ROOT).sort()) {
  const r = rel(file);
  const admin = inAdminZone(r);
  if (admin) adminFiles += 1;
  const { count, waived, hits } = scanFile(file, admin);
  totalWaivers += waived;
  if (count > 0) { counts[r] = count; details[r] = hits; }
}
const total = Object.values(counts).reduce((n, v) => n + v, 0);

const readBaseline = () =>
  fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) : null;

if (process.argv.includes("--update-baseline")) {
  const baseline = readBaseline();
  const recorded = baseline ? (baseline.files ?? {}) : null;
  const recordedTotal = recorded ? Object.values(recorded).reduce((n, v) => n + v, 0) : Infinity;
  if (total > recordedTotal) {
    console.error(
      `::error::refusing to raise the tailwind-palette baseline: ${total} is above the recorded ${recordedTotal}. ` +
        `This number only ever falls. Route the colour through a palette token (bg-card, text-muted-foreground, ` +
        `border-border, bg-primary, a status token) instead of Tailwind's default palette.`,
    );
    process.exit(1);
  }
  const rising = recorded
    ? Object.entries(counts)
        .filter(([f, n]) => n > (recorded[f] ?? 0))
        .map(([f, n]) => `${f}: ${n}, the baseline allows ${recorded[f] ?? 0}`)
    : [];
  if (rising.length) {
    console.error(
      `::error::refusing to write the tailwind-palette baseline: ${rising.length} file(s) are above their recorded number. ` +
        `The baseline only ever falls per file; a fall elsewhere does not buy this.\n    ${rising.join("\n    ")}`,
    );
    process.exit(1);
  }
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify({ totalLiterals: total, files: counts }, null, 2)}\n`);
  console.log(`tailwind-palette baseline lowered to ${total} across ${Object.keys(counts).length} file(s).`);
  process.exit(0);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ total, files: counts, waivers: totalWaivers }));
}

const baseline = readBaseline() ?? { totalLiterals: 0, files: {} };
const baselineFiles = baseline.files ?? {};
const baselineTotal = baseline.totalLiterals ?? Object.values(baselineFiles).reduce((n, v) => n + v, 0);

const failures = [];
for (const [file, count] of Object.entries(counts)) {
  const allowed = baselineFiles[file] ?? 0;
  if (count > allowed) {
    failures.push({
      file,
      reason: `${count} Tailwind default-palette colour class(es), baseline allows ${allowed}, the ratchet only turns down`,
      hits: details[file].slice(0, 5),
    });
  }
}

if (failures.length) {
  console.error("\nTAILWIND-PALETTE GUARD FAILED: the village's Admin palette cannot reach Tailwind's own default palette.\n");
  console.error("Route the colour through a palette token: bg-card / bg-muted / bg-background / text-foreground /");
  console.error("text-muted-foreground / border-border / bg-primary text-primary-foreground, or a status token:");
  console.error("text-open + bg-sage-light (success), text-notice + bg-amber-light (warning), text-destructive (danger).\n");
  for (const f of failures) {
    console.error(`  ${f.file}: ${f.reason}`);
    for (const h of f.hits) console.error(`      ${f.file}:${h.line}: ${h.text}`);
  }
  console.error("\nIf a hit is a genuine false positive (not a rendered class), add `palette-ok: <reason>` on that line.");
  console.error("If you REMOVED occurrences, lower the baseline: node scripts/check-tailwind-palette.mjs --update-baseline\n");
  process.exit(1);
}

console.log(
  `Tailwind-palette guard passed. ${total} default-palette colour class(es) across ${Object.keys(counts).length} file(s) ` +
    `(${adminFiles} admin-zone file(s) counted with their text-gray-*) (baseline ${baselineTotal}); ` +
    `${totalWaivers} waiver(s) in force.`,
);
