#!/usr/bin/env node
/**
 * The raw-SQL burn-down: how much query code lives outside `server/repos`
 * today, recorded per file, and a ratchet that only ever turns down.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `scripts/contribution-scan.mjs` owns the rule "raw SQL outside
 * `server/repos`" and enforces it over the lines a pull request ADDED. That
 * attribution is right and it is not enough on its own, because the rule's
 * pattern was blind to a TypeScript type-argument list: `pool.query(...)` was
 * caught and `pool.query<RowDataPacket[]>(...)` was not, for the identical
 * violation. Widening the pattern made 445 non-test call sites visible in one
 * step.
 *
 * There were three ways to land that, and two of them are dishonest:
 *
 *   1. Fix all 445 in this change. Unreviewable, and it would rewrite files
 *      four lanes are working in.
 *   2. Waive them. `module-review-ok:` on 445 lines is a rule that has been
 *      repealed while still appearing to exist.
 *   3. Record them, and refuse to let the number grow. That is this file.
 *
 * So the list in `scripts/module-sql-pending.json` is a DEBT REGISTER, not an
 * allowlist. A file in it is not blessed; it is measured. The number beside it
 * may fall and may never rise, and a file that is not in it may carry no raw
 * SQL at all. Burning one down is moving its queries into `server/repos` and
 * running `--update-baseline`, which refuses to write a bigger number than the
 * one already recorded.
 *
 * ── WHY IT IS NOT DIFF-SCOPED, WHEN THE RULE BESIDE IT IS ───────────────────
 *
 * The contribution scan answers "did YOU add this", which is the right
 * question to block a contributor on. This answers "is the platform's own
 * total still falling", which no diff can see: a lane can move a query from
 * one file to another and the diff-scoped rule reports a finding in the new
 * place while the total stands still. Two questions, two mechanisms, one
 * pattern shared between them so they can never disagree about what raw SQL
 * is. The pattern is imported, never re-typed.
 *
 * ── WHY TESTS ARE OUT OF SCOPE HERE, AND ONLY HERE ──────────────────────────
 *
 * An e2e suite that reads a row back to prove a route wrote it is the test
 * doing its job, and there is no repo to route that through. The DEBT worth
 * burning down is production code. The contribution rule's own scope is
 * unchanged and still covers test files, so a test that adds raw SQL is still
 * a finding on the line that added it; it simply does not enter the register.
 * Saying this out loud matters: a reader who assumes the two scopes are the
 * same will read the register's total as the repository's total, and it is
 * not.
 *
 * ── THE FOUR REFUSALS ───────────────────────────────────────────────────────
 *
 * Lifted from `scripts/check-village-facts.mjs`, which is the house model for
 * a list that only shrinks. `grown` and `unexpected` are the ones every
 * ratchet has. `stale` is the one that is easy to leave out and should not be:
 * a count that has fallen and not been recorded is a standing allowance for
 * the same debt to come back later under a number nobody checked. It is a red
 * that means good news, and the message says so. `declared` and `ceiling`
 * catch the bookkeeping drifting from the measurement in each direction.
 *
 * Usage:
 *   node scripts/sql-burndown.mjs                    # the gate
 *   node scripts/sql-burndown.mjs --json             # machine readable
 *   node scripts/sql-burndown.mjs --list             # the register, sorted
 *   node scripts/sql-burndown.mjs --update-baseline  # only ever downward
 *   node scripts/sql-burndown.mjs --root <dir> --baseline <file>
 *
 * The last form points the guard at another tree and another list, so
 * `scripts/sql-burndown.test.mjs` can drive THIS script over a fixture rather
 * than a copy of it. A copy is a second implementation, and the thing worth
 * proving is that this one refuses. `scripts/validate-module.mjs` calls
 * `runBurndown()` with the defaults, which is what ships and what CI runs.
 *
 * Read the exit code, never the last line. A failing run's output ends with
 * whatever the last refusal happened to be.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_RULES, RAW_SQL_RULE_ID, scanFileLines } from "./contribution-scan.mjs";

// fileURLToPath, not `new URL(...).pathname` with a drive-letter fixup, for
// the reason check-identity-keys.mjs records: the hand-rolled form leaves a
// checkout under a path containing a space reading `%20` as literal
// characters, so the guard looks for files that are not there.
const SELF = fileURLToPath(import.meta.url);
export const ROOT = path.resolve(path.dirname(SELF), "..");
export const BASELINE_PATH = path.join(ROOT, "scripts", "module-sql-pending.json");

/**
 * 2026-09-03: the total recorded in module-sql-pending.json when the rule's
 * pattern was widened to see type-argument lists. THIS NUMBER ONLY EVER FALLS.
 *
 * It has to equal the total in the JSON, so raising the allowance means
 * editing a number one line under the sentence forbidding it. That is the
 * point: a burn-down list cannot grow by accident, only by a deliberate edit
 * that shows up in a diff next to this comment. Raising it is not the answer
 * to a red run. Moving the query into `server/repos` is.
 */
export const BURNDOWN_CEILING = 762;

/** The dirs the register covers. Mirrors the rule's own scope. */
export const SCAN_DIRS = ["server", "shared", "client"];

/** Excluded from the register, and ONLY from the register. See the header. */
export const isTestFile = (rel) => /\.test\.(ts|tsx|js|jsx|mjs)$/.test(rel);

const SCANNABLE = /\.(ts|tsx|js|jsx|mjs)$/;

/**
 * The one rule, taken from the one place that defines it.
 *
 * A missing rule is a THROW and never a skip. If somebody renames the rule id,
 * the honest outcome is a loud stop, not a register that silently measures
 * nothing and reports a repository with no raw SQL in it.
 */
export function rawSqlRule(rules = CODE_RULES) {
  const rule = rules.find((r) => r.id === RAW_SQL_RULE_ID);
  if (!rule) {
    throw new Error(
      `sql-burndown: no rule with id "${RAW_SQL_RULE_ID}" in contribution-scan.mjs. ` +
        "The register keys on that id; a rename has to move both, and a register that " +
        "cannot find its rule must stop rather than report a clean tree.",
    );
  }
  return rule;
}

/** Every scannable file under `dirs`, as repo-relative slash-separated paths. */
export function walk(root, dirs = SCAN_DIRS) {
  const out = [];
  const visit = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        visit(full);
        continue;
      }
      if (!SCANNABLE.test(e.name)) continue;
      out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  for (const d of dirs) visit(path.join(root, d));
  return out.sort();
}

/**
 * Count the rule's hits per file, through the SAME scanner the contribution
 * checks use.
 *
 * `addedSet: null` means "the whole file is in view", which is exactly the
 * question a register asks. Going through `scanFileLines` rather than
 * re-matching here is what keeps the comment stripping, the scope test and the
 * `module-review-ok:` waiver identical between the two callers. A waived line
 * is not a finding and so does not enter the register; the waiver count is
 * returned so a run can say how many are in force.
 */
export function countsFor(root, { dirs = SCAN_DIRS, rules = CODE_RULES } = {}) {
  const rule = rawSqlRule(rules);
  const counts = {};
  let scanned = 0;
  let waived = 0;
  for (const rel of walk(root, dirs)) {
    if (isTestFile(rel)) continue;
    if (!rule.scope(rel)) continue;
    scanned += 1;
    let body = "";
    try {
      body = fs.readFileSync(path.join(root, ...rel.split("/")), "utf8");
    } catch {
      continue;
    }
    const scan = scanFileLines({ relPath: rel, body, addedSet: null, rules: [rule] });
    waived += scan.waived;
    if (scan.findings.length) counts[rel] = scan.findings.length;
  }
  return { counts, scanned, waived };
}

export const totalOf = (counts) => Object.values(counts).reduce((n, v) => n + v, 0);

/**
 * The four refusals, plus the two arithmetic ones. Pure, so the self-test can
 * drive every branch without a filesystem.
 */
export function auditBaseline(counts, baseline, ceiling = BURNDOWN_CEILING) {
  const listed = baseline.counts ?? {};
  const grown = [];
  const unexpected = [];
  const stale = [];

  for (const [file, n] of Object.entries(counts)) {
    if (!(file in listed)) unexpected.push({ file, found: n });
    else if (n > listed[file]) grown.push({ file, found: n, allowed: listed[file] });
  }
  for (const [file, n] of Object.entries(listed)) {
    const found = counts[file] ?? 0;
    if (found < n) stale.push({ file, found, listed: n });
  }

  const listedTotal = totalOf(listed);
  return {
    grown,
    unexpected,
    stale,
    declared:
      baseline.total === undefined || baseline.total === listedTotal
        ? null
        : { listed: listedTotal, declared: baseline.total },
    ceiling: ceiling === null || listedTotal === ceiling ? null : { listed: listedTotal, ceiling },
    total: totalOf(counts),
    listedTotal,
  };
}

/**
 * One human sentence per refusal, in the order a reader should act on them.
 *
 * Returned rather than printed so `validate-module.mjs` can feed each one to
 * its own `bad()` and have it counted as a violation there, with the
 * `<-- VIOLATION` marker the intake classifier keys on.
 */
export function refusalLines(result, baselineFile = "scripts/module-sql-pending.json") {
  const lines = [];
  for (const u of result.unexpected) {
    lines.push(
      `NEW raw SQL: ${u.file} carries ${u.found} query call(s) outside server/repos and is not in the ` +
        `burn-down register at all. Move them into a repo under server/repos, or if a hit is a genuine ` +
        `false positive put \`module-review-ok: <reason>\` ON THAT LINE. This register does not grow.`,
    );
  }
  for (const g of result.grown) {
    lines.push(
      `MORE raw SQL: ${g.file} now carries ${g.found} query call(s) and the register allows ${g.allowed}. ` +
        `This ratchet only turns down. Move the new ones into server/repos.`,
    );
  }
  for (const s of result.stale) {
    lines.push(
      s.found === 0
        ? `${s.file} is in the burn-down register at ${s.listed} and is now CLEAN. Good news, and it needs the ` +
          `bookkeeping: run \`node scripts/sql-burndown.mjs --update-baseline\` and lower BURNDOWN_CEILING to ` +
          `${result.total} in scripts/sql-burndown.mjs in the same commit. An entry left behind is a standing ` +
          `permission for that debt to come back without anybody noticing.`
        : `${s.file} is registered at ${s.listed} and now carries ${s.found}. Good news, and the ratchet has to ` +
          `record it: run \`node scripts/sql-burndown.mjs --update-baseline\` and lower BURNDOWN_CEILING to ` +
          `${result.total}. A fall nobody writes down is an allowance for the old number to come back.`,
    );
  }
  if (result.declared) {
    lines.push(
      `${baselineFile} declares a total of ${result.declared.declared} and its own counts add up to ` +
        `${result.declared.listed}. Somebody edited one and left the other. ` +
        `\`node scripts/sql-burndown.mjs --update-baseline\` writes both from the same number.`,
    );
  }
  if (result.ceiling) {
    lines.push(
      result.ceiling.listed > result.ceiling.ceiling
        ? `${baselineFile} totals ${result.ceiling.listed} and BURNDOWN_CEILING is ${result.ceiling.ceiling}. ` +
          `This list only ever shrinks. Raising the ceiling is not a fix; moving the query into server/repos is.`
        : `${baselineFile} totals ${result.ceiling.listed} and BURNDOWN_CEILING is still ${result.ceiling.ceiling}. ` +
          `Lower the ceiling to ${result.ceiling.listed} so the ratchet holds at the number actually reached.`,
    );
  }
  return lines;
}

export function readBaseline(file) {
  if (!fs.existsSync(file)) return { total: 0, counts: {}, entries: {} };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeBaseline(file, counts, previous) {
  const today = new Date().toISOString().slice(0, 10);
  const entries = {};
  const sorted = Object.keys(counts).sort();
  for (const k of sorted) entries[k] = previous?.entries?.[k] ?? { since: today };
  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        note:
          "Raw SQL call sites outside server/repos, recorded per file. A DEBT REGISTER, not an " +
          "allowlist: a file listed here is measured, not blessed. This list only ever shrinks. " +
          "Read scripts/sql-burndown.mjs before editing it, and lower BURNDOWN_CEILING in that " +
          "file to match the total here. Test files are out of scope for the register and still " +
          "in scope for the contribution rule; the header says why.",
        rule: RAW_SQL_RULE_ID,
        fix: "move the query into a repo under server/repos, so the caches above it stay correct and a table's readers stay enumerable",
        total: totalOf(counts),
        counts: Object.fromEntries(sorted.map((k) => [k, counts[k]])),
        entries,
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * The whole gate, as a value. `validate-module.mjs` prints it; `main` below
 * prints it; the self-test asserts on it.
 *
 * A scan that found ZERO files to look at is a REFUSAL and never a pass, the
 * rule check-voice.mjs states in its own words: "0 findings" and "the walk did
 * not run" must never print the same line. A moved directory would otherwise
 * report a repository with no raw SQL in it forever.
 */
export function runBurndown({ root = ROOT, baselinePath = BASELINE_PATH, ceiling = BURNDOWN_CEILING } = {}) {
  const { counts, scanned, waived } = countsFor(root);
  if (scanned === 0) {
    return {
      counts: {},
      scanned: 0,
      waived: 0,
      result: null,
      refusals: [
        `found ZERO scannable files under ${SCAN_DIRS.map((d) => `${d}/`).join(", ")} in ${root}. That means ` +
          `the walk did not run, not that the tree is clean. Refusing to report a pass.`,
      ],
    };
  }
  const baseline = readBaseline(baselinePath);
  const result = auditBaseline(counts, baseline, ceiling);
  const rel = path.relative(root, baselinePath).split(path.sep).join("/");
  return { counts, scanned, waived, baseline, result, refusals: refusalLines(result, rel) };
}

// ── Standalone ──────────────────────────────────────────────────────────────

/** The value after a flag, e.g. `--root some/dir`. */
function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

export function main(argv) {
  const rootArg = flagValue(argv, "--root");
  const baselineArg = flagValue(argv, "--baseline");
  const root = rootArg ? path.resolve(rootArg) : ROOT;
  const baselinePath = baselineArg ? path.resolve(baselineArg) : BASELINE_PATH;
  // BURNDOWN_CEILING tracks the COMMITTED list. A run pointed at some other
  // list has nothing to compare it against, so that rule stands down and the
  // internally-consistent-total rule carries the arithmetic instead. Printed,
  // so a run without the ceiling rule never looks like a run with it.
  const ceiling = baselineArg ? null : BURNDOWN_CEILING;

  if (argv.includes("--update-baseline")) {
    const { counts, scanned } = countsFor(root);
    if (scanned === 0) {
      console.error(`::error::found ZERO scannable files under ${root}. Refusing to write a baseline from a walk that did not run.`);
      return 1;
    }
    const total = totalOf(counts);
    const old = readBaseline(baselinePath);
    const oldTotal = totalOf(old.counts ?? {});
    // The one write allowed to be a rise is the FIRST one, when no list exists
    // yet. That is the seeding run, and refusing it would leave hand-writing
    // eighty entries as the only way to create the file. Every run after it
    // may only lower the number.
    const seeding = !fs.existsSync(baselinePath);
    if (!seeding && total > oldTotal) {
      console.error(
        `::error::refusing to raise the raw-SQL burn-down total: ${total} is above the recorded ${oldTotal}. ` +
          `This number only ever falls. Move the query into a repo under server/repos, or if the hit is a ` +
          `genuine false positive put \`module-review-ok: <reason>\` ON THE LINE ITSELF. A raised ceiling is ` +
          `a repealed rule that still looks like a rule.`,
      );
      return 1;
    }
    writeBaseline(baselinePath, counts, seeding ? null : old);
    console.log(
      seeding
        ? `raw-SQL burn-down register seeded at ${total} across ${Object.keys(counts).length} file(s). ` +
          `Set BURNDOWN_CEILING to ${total} in scripts/sql-burndown.mjs in the same commit.`
        : `raw-SQL burn-down register lowered to ${total} across ${Object.keys(counts).length} file(s). ` +
          `Set BURNDOWN_CEILING to ${total} in scripts/sql-burndown.mjs in the same commit.`,
    );
    return 0;
  }

  const run = runBurndown({ root, baselinePath, ceiling });

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ ...run, ceiling }, null, 2));
    return run.refusals.length ? 1 : 0;
  }

  if (argv.includes("--list")) {
    for (const f of Object.keys(run.counts).sort()) {
      const since = run.baseline?.entries?.[f]?.since ?? "unrecorded";
      console.log(`  ${String(run.counts[f]).padStart(4)}  ${f}  (recorded ${since})`);
    }
  }

  console.log(
    `raw SQL outside server/repos: ${run.result?.total ?? "unmeasured"} call site(s) in ` +
      `${Object.keys(run.counts).length} file(s) of ${run.scanned} scanned; register ` +
      `${run.result?.listedTotal ?? "?"} (${ceiling === null ? "ceiling rule stood down" : `ceiling ${ceiling}`}); ` +
      `${run.waived} waiver(s) in force.`,
  );
  for (const line of run.refusals) console.error(`::error::${line}`);
  return run.refusals.length ? 1 : 0;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === SELF;
if (invoked) process.exit(main(process.argv.slice(2)));
