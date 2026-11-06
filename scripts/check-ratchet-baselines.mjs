#!/usr/bin/env node
/**
 * A RATCHET BASELINE MAY ONLY FALL, AND NOW A GATE SAYS SO (readiness R029,
 * issue #600).
 *
 * Every counting ratchet here (`scripts/*-baseline.json`) documents that its
 * baseline only ever falls, and every one enforces that only inside its own
 * `--update-baseline`. The gate path of each asks whether the tree is at or
 * under the baseline. So a branch that edits the JSON upward by hand never runs
 * the refusal, and passes. PR #575 did exactly that: `Admin.tsx` 8266 -> 8360
 * when its tree needed 2 more lines, green on every check, caught only when a
 * batch was composed. The raise would have become main's permanent ceiling.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────
 *
 * Compared with the same file at the merge base (the newest merge base with
 * the base ref, the way check-migration-compat.mjs finds its release):
 *
 *   - no number may rise;
 *   - in a per-file map (an object whose values are all numbers), no entry
 *     that was there may rise, and the map's SUM may not rise. A new entry is
 *     allowed only inside that sum, which is what a rename looks like: the old
 *     key goes, the new one arrives with the same count.
 *
 * ── WHY NOT "TIGHT" ──────────────────────────────────────────────────────
 *
 * Issue #600 suggested failing whenever a baseline sits above what the tree
 * measures. That would make every lane that shrinks a counted file edit the
 * baseline in the same pull request, and the baselines are a contended
 * resource across a dozen lanes (the fleet ledger, section 27): every batch
 * would conflict on them. The settled practice is that the integrator lowers
 * a baseline after a fall, when the batch lands. This gate closes the hole
 * that practice cannot: the raise, which never self-corrects.
 *
 * ── WHAT IS NOT A RATCHET ────────────────────────────────────────────────
 *
 * A denominator rises for honest reasons and is named here, per file. Anything
 * not named is a ratchet, so a new baseline file is held to the rule from its
 * first edit, and a new field is a ratchet until somebody says otherwise here,
 * in a diff a reviewer sees.
 *
 * ── A RULED RAISE ────────────────────────────────────────────────────────
 *
 * When a raise is a decision (a ruling, with a date and who made it), it goes
 * in RULED_RAISES below, naming the file, the field and the new value. That is
 * a line in this file's diff, which is the point: the raise is reviewed where
 * the gate lives, never slipped into a JSON nobody reads.
 *
 * Usage:
 *   node scripts/check-ratchet-baselines.mjs
 *   node scripts/check-ratchet-baselines.mjs --base origin/main
 *   node scripts/check-ratchet-baselines.mjs --root <repo>   (for the self-test)
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ROOT = path.resolve(arg("--root") ?? path.join(import.meta.dirname, ".."));

/** Fields that are counts of what exists, never limits. Rising is honest. */
const DENOMINATORS = {
  // How many modules the registry holds. A new module raises it; the ratchet
  // in that file is `undocumented`.
  "scripts/module-docs-baseline.json": ["modules"],
  // How many images `client/public` holds, written beside the byte total and
  // never enforced (check-image-budget.mjs reads `totalBytes`). New art under
  // a falling byte total raises it, as it did at 299d408 (48 -> 53) and in
  // batch 88 (23 -> 30). Those are the only two rises on main since
  // 2026-09-01, measured over all 38 landings that touched a baseline, so
  // with this named the gate would have stopped no landing in that time.
  "scripts/image-budget-baseline.json": ["files"],
};

/** Raises that were decided, each with its ruling. Empty until one is. */
const RULED_RAISES = [
  // { file: "scripts/example-baseline.json", field: "total", to: 12, ruling: "Who, YYYY-MM-DD: what they said" },
];

function git(args) {
  const r = spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
  return { ok: r.status === 0, text: String(r.stdout ?? "").trim(), err: String(r.stderr ?? "").trim() };
}

function resolveBase() {
  const explicit = arg("--base");
  const candidates = explicit
    ? [explicit]
    : process.env.GITHUB_BASE_REF
      ? [`origin/${process.env.GITHUB_BASE_REF}`, process.env.GITHUB_BASE_REF]
      : ["origin/main", "main"];
  const found = [];
  for (const ref of candidates) {
    if (!git(["rev-parse", "--verify", `${ref}^{commit}`]).ok) continue;
    const mb = git(["merge-base", "HEAD", ref]);
    if (mb.ok) found.push({ ref, sha: mb.text });
  }
  if (found.length === 0) return { error: `could not resolve any of: ${candidates.join(", ")}` };
  // The newest merge base wins, for the reason check-migration-compat.mjs gives.
  let best = found[0];
  for (const c of found.slice(1)) if (git(["merge-base", "--is-ancestor", best.sha, c.sha]).ok) best = c;
  return best;
}

const isNumberMap = (o) =>
  o !== null && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length > 0 && Object.values(o).every((v) => typeof v === "number");

const sum = (o) => Object.values(o).reduce((n, v) => n + v, 0);

/** Every rise between two parsed baselines, as `field: before -> after` lines. */
function rises(before, after, denominators = [], at = "") {
  const out = [];
  if (typeof before === "number" && typeof after === "number") {
    if (after > before && !denominators.includes(at)) out.push({ field: at, before, after });
    return out;
  }
  if (isNumberMap(before) && isNumberMap(after) && !denominators.includes(at)) {
    for (const [k, v] of Object.entries(after)) {
      if (k in before && v > before[k]) out.push({ field: at ? `${at}.${k}` : k, before: before[k], after: v });
    }
    if (sum(after) > sum(before)) out.push({ field: `${at || "(top level)"} sum`, before: sum(before), after: sum(after) });
    return out;
  }
  if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    for (const k of Object.keys(after)) {
      if (k in before) out.push(...rises(before[k], after[k], denominators, at ? `${at}.${k}` : k));
    }
  }
  return out;
}

function main() {
  const dir = path.join(ROOT, "scripts");
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /-baseline\.json$/.test(f)).sort().map((f) => `scripts/${f}`)
    : [];
  if (files.length === 0) {
    console.error("check-ratchet-baselines: no scripts/*-baseline.json found at all, so this measured nothing. A rename or a moved directory reads here as a failure.");
    process.exit(1);
  }
  const base = resolveBase();
  if (base.error) {
    console.error(`check-ratchet-baselines: ${base.error}. Without a base there is nothing to compare a baseline against, and a pass would be a guess.`);
    process.exit(1);
  }

  const problems = [];
  let compared = 0;
  let fresh = 0;
  for (const file of files) {
    const after = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
    const shown = git(["show", `${base.sha}:${file}`]);
    if (!shown.ok) {
      fresh += 1;
      continue;
    }
    compared += 1;
    const before = JSON.parse(shown.text);
    for (const r of rises(before, after, DENOMINATORS[file] ?? [])) {
      const ruled = RULED_RAISES.find((x) => x.file === file && x.field === r.field && x.to === r.after);
      if (!ruled) problems.push(`  ${file}  ${r.field}: ${r.before} -> ${r.after}`);
    }
  }

  console.log(`ratchet baselines against ${base.ref} (merge base ${base.sha.slice(0, 8)})`);
  console.log(`  baseline files        ${files.length}`);
  console.log(`  compared with base    ${compared}`);
  console.log(`  new since base        ${fresh}`);
  console.log(`  ruled raises          ${RULED_RAISES.length}`);
  if (problems.length) {
    console.error(
      `\n${problems.length} baseline number(s) ROSE against the base. A ratchet baseline only falls:\n${problems.join("\n")}\n\n` +
        "Shrink the change until the tree fits the baseline the base ref has, or move the code somewhere the ratchet does not count " +
        "(a route module, a lib file). If the raise is a decision, add it to RULED_RAISES in scripts/check-ratchet-baselines.mjs " +
        "with the ruling, its date and who made it.",
    );
    process.exit(1);
  }
  console.log("  rises                 0");
}

main();
