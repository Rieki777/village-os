#!/usr/bin/env node
/**
 * Did every test file run, exactly once, across the sharded CI test jobs, and pass?
 *
 * WHY THIS EXISTS. Until 2026-10-21 `ci.yml` ran the whole suite as one step of
 * one job, and that step had grown to 85% of a 40-minute limit: one run was
 * cancelled at 40m22s on a tree whose twin passed in 30m34s. Rye's ruling that
 * day was "split the tests", so the suite now runs as N `test (i/N)` jobs, each
 * calling `vitest run --shard=i/N`.
 *
 * A split suite has a failure mode a single run does not: a file can fall
 * between the shards, or land in two of them, and every shard still reports
 * green about the files it was handed. Vitest's sharding is a hash of the path
 * sliced into N ranges, which is sound today, and a sound mechanism is still
 * not a measurement. So each shard writes vitest's JSON report, and this job
 * reads all of them back against the file list vitest itself resolves from
 * `vitest.config.ts`, and refuses anything other than: every file, once, passed.
 *
 * WHAT COUNTS AS PASSED. A file whose report status is "passed". A file that
 * is "skipped" fails here, because in CI every database-gated file has a
 * database, so a whole file skipping is a suite that did not run; a skip is not
 * a pass. A test-level skip or todo inside a passing file is reported and allowed,
 * exactly as the single-run summary always allowed it.
 *
 * WHAT IT CANNOT SEE. It trusts the JSON reports to describe the runs that wrote
 * them; a shard that wrote a report and then died is already red in its own job.
 * It does not compare test COUNTS across runs, only files, because a test count
 * moves every time somebody adds a test.
 *
 * Exit 0: every file once, all passed. Exit 1: the answer is bad (missing,
 * duplicated, unexpected, or failed files). Exit 2: it could not look (a report
 * missing or unreadable, the file list unavailable, shard counts that disagree).
 *
 * Usage (CI, after downloading every shard's report into one directory):
 *   node scripts/check-test-shards.mjs --shards 4 --dir test-results
 * Report names are shard-<i>-of-<N>-attempt-<run_attempt>.json; see latestAttempts.
 * Self-test: node scripts/check-test-shards.test.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Absolute or relative report path to a repo-relative, forward-slash path. */
export function toRel(name, root = ROOT) {
  const abs = path.resolve(root, name);
  return path.relative(root, abs).split(path.sep).join("/");
}

/**
 * `shard-3-of-4-attempt-2.json` to { index: 3, count: 4, attempt: 2 }, anything
 * else to null. A name with no attempt is attempt 1, so a local run's report
 * still reads.
 */
export function parseShardName(file) {
  const m = /^shard-(\d+)-of-(\d+)(?:-attempt-(\d+))?\.json$/.exec(file);
  return m ? { index: Number(m[1]), count: Number(m[2]), attempt: Number(m[3] ?? 1) } : null;
}

/**
 * One report per shard: the one from the newest run attempt.
 *
 * WHY. `gh run rerun --failed` re-runs only the red shard, and the run then
 * holds an artifact from EACH attempt. On batch 75 (2026-11-01) both were named
 * `test-results-shard-4`, and download-artifact took attempt 1's, so the
 * re-run's green never reached this check and only a full re-run cleared it.
 * The toolkit keeps the highest artifact ID per name, and there the older
 * artifact had the higher ID (13077656607 against 13077014486), so an ID is not
 * a clock. The workflow now writes the attempt into the artifact name and the
 * report name, and this picks by that number. A newest attempt that failed is
 * still the one judged, so a re-run can turn a flake green and never hide a red.
 */
export function latestAttempts(shards) {
  const best = new Map();
  for (const s of shards) {
    const held = best.get(s.index);
    if (!held || s.attempt > held.attempt) best.set(s.index, s);
  }
  return [...best.values()];
}

/**
 * The whole decision, as data, so the self-test can drive it without a suite.
 *
 * expected: repo-relative paths vitest resolves for an unsharded run.
 * shards:   [{ index, count, report }] where report is vitest's JSON output.
 * want:     how many shards the workflow declares.
 */
export function judge({ expected, shards, want }) {
  const problems = []; // could not look: exit 2
  const failures = []; // looked, and the answer is bad: exit 1
  const seen = new Map(); // file -> [shard index, ...]
  const perShard = [];

  const counts = new Set(shards.map((s) => s.count));
  if (counts.size > 1 || (counts.size === 1 && !counts.has(want))) {
    problems.push(
      `the reports disagree about the shard count: the workflow declares ${want}, the reports say ${[...counts].join(", ") || "nothing"}`,
    );
  }
  for (let i = 1; i <= want; i++) {
    if (!shards.some((s) => s.index === i)) problems.push(`no report from shard ${i} of ${want}`);
  }

  for (const s of shards) {
    const results = Array.isArray(s.report?.testResults) ? s.report.testResults : null;
    if (!results) {
      problems.push(`shard ${s.index} wrote a report with no testResults array`);
      continue;
    }
    let tests = 0;
    let skippedTests = 0;
    let ms = 0;
    for (const r of results) {
      const rel = toRel(r.name);
      if (rel.startsWith("..")) {
        problems.push(`shard ${s.index} reports a file outside the repository: ${r.name}`);
        continue;
      }
      seen.set(rel, [...(seen.get(rel) ?? []), s.index]);
      if (r.status !== "passed") failures.push(`${rel}: ${r.status} in shard ${s.index}`);
      const assertions = Array.isArray(r.assertionResults) ? r.assertionResults : [];
      tests += assertions.length;
      skippedTests += assertions.filter((a) => a.status !== "passed" && a.status !== "failed").length;
      if (Number.isFinite(r.endTime) && Number.isFinite(r.startTime)) ms += r.endTime - r.startTime;
    }
    perShard.push({ index: s.index, files: results.length, tests, skippedTests, seconds: Math.round(ms / 1000) });
  }

  const expectedSet = new Set(expected);
  const missing = expected.filter((f) => !seen.has(f));
  const twice = [...seen].filter(([, where]) => where.length > 1).map(([f, where]) => `${f} (shards ${where.join(", ")})`);
  const extra = [...seen.keys()].filter((f) => !expectedSet.has(f));
  for (const f of missing) failures.push(`${f}: ran in no shard`);
  for (const f of twice) failures.push(`${f}: ran more than once`);
  for (const f of extra) failures.push(`${f}: ran, and is not in the file list vitest resolves`);

  perShard.sort((a, b) => a.index - b.index);
  return { problems, failures, perShard, ran: seen.size, expected: expected.length, missing, twice, extra };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

/** The files an UNSHARDED run would execute, from vitest's own resolution of the config. */
function expectedFiles() {
  const vitest = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
  const r = spawnSync(process.execPath, [vitest, "list", "--filesOnly", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) return { error: `vitest list exited ${r.status}: ${(r.stderr || "").trim().slice(-400)}` };
  const start = r.stdout.indexOf("[");
  try {
    const rows = JSON.parse(r.stdout.slice(start));
    return { files: rows.map((row) => toRel(row.file)).sort() };
  } catch (e) {
    return { error: `could not parse vitest list --json output: ${e.message}` };
  }
}

function main() {
  const want = Number(arg("--shards"));
  const dir = path.resolve(ROOT, arg("--dir") ?? "test-results");
  if (!Number.isInteger(want) || want < 1) {
    console.error("check-test-shards: --shards <N> is required and must be a positive integer.");
    process.exit(2);
  }

  const listed = expectedFiles();
  if (listed.error) {
    console.error(`check-test-shards: could not read the full file list, so nothing can be compared. ${listed.error}`);
    process.exit(2);
  }
  if (!listed.files.length) {
    console.error("check-test-shards: vitest resolved ZERO test files. That is a broken config, not a clean run.");
    process.exit(2);
  }

  const shards = [];
  const unreadable = [];
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    console.error(`check-test-shards: ${dir} does not exist, so no shard report arrived at all.`);
    process.exit(2);
  }
  for (const file of names) {
    const meta = parseShardName(file);
    if (!meta) continue;
    try {
      shards.push({ ...meta, report: JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) });
    } catch (e) {
      unreadable.push(`${file}: ${e.message}`);
    }
  }

  const kept = latestAttempts(shards);
  const superseded = shards.filter((s) => !kept.includes(s));
  const v = judge({ expected: listed.files, shards: kept, want });
  v.problems.push(...unreadable.map((u) => `unreadable report ${u}`));

  const lines = [];
  lines.push(`Test shards: ${kept.length} report(s) of ${want} declared`);
  for (const s of v.perShard) {
    const attempt = kept.find((k) => k.index === s.index)?.attempt ?? 1;
    lines.push(
      `  shard ${s.index}/${want}  attempt ${attempt}  ${String(s.files).padStart(4)} files  ${String(s.tests).padStart(6)} tests` +
        `  ${String(s.skippedTests).padStart(3)} skipped or todo  ${s.seconds}s of test time`,
    );
  }
  for (const s of superseded) lines.push(`  (attempt ${s.attempt} of shard ${s.index} superseded by a re-run, not read)`);
  lines.push(`  files vitest resolves for the whole suite  ${v.expected}`);
  lines.push(`  distinct files that ran across the shards  ${v.ran}`);
  lines.push(`  missing ${v.missing.length}, ran twice ${v.twice.length}, unexpected ${v.extra.length}`);
  for (const l of lines) console.log(l);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Test shards\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
    } catch {
      /* the log above already carries it */
    }
  }

  if (v.problems.length) {
    console.error("\ncheck-test-shards could not look, so it cannot say the suite ran:");
    for (const p of v.problems) console.error(`  ${p}`);
    for (const f of v.failures.slice(0, 50)) console.error(`  also: ${f}`);
    process.exit(2);
  }
  if (v.failures.length) {
    console.error(`\ncheck-test-shards: ${v.failures.length} file(s) did not run exactly once and pass:`);
    for (const f of v.failures.slice(0, 100)) console.error(`  ${f}`);
    if (v.failures.length > 100) console.error(`  ...and ${v.failures.length - 100} more`);
    process.exit(1);
  }
  console.log(`\nEvery one of the ${v.expected} test files ran exactly once and passed.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
