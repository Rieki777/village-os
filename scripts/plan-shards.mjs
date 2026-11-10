/**
 * Balanced test shards: give shard i of N the files whose recorded times add up
 * to an equal share, instead of vitest's `--shard`, which hashes file paths and
 * hands every shard an equal COUNT (CI audit, 2026-11-10: file time per shard
 * 344, 265, 314 and 299 s, with one 150 s file in shard 1).
 *
 *   node scripts/plan-shards.mjs <i> <N>       write test-results/shard-<i>-files.txt, print the plan
 *   node scripts/plan-shards.mjs --refresh <dir>   rewrite scripts/test-timings.json from vitest JSON reports
 *
 * HOW IT STAYS SAFE. The file list is what `vitest list --filesOnly --json`
 * resolves for the WHOLE suite, the same call tests-ran-once makes, and every
 * file goes to exactly one shard by construction. vitest.config.ts reads the
 * resulting list through CI_SHARD_FILES, so the argv stays a whole run and the
 * hollow-run rule in server/db/provisioningReport.ts still applies (a positional
 * file argument would have switched it off). tests-ran-once then proves it
 * again from the reports. A file with no recorded time costs the median, so a
 * new file lands somewhere sensible and a stale table costs balance only.
 *
 * Each file also carries FIXED seconds of per-file overhead (worker spawn,
 * import, environment): the shard logs show about 28 of 47 test-step minutes
 * are not test bodies, so counting only test time would pile cheap files up.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TIMINGS = path.join(import.meta.dirname, "test-timings.json");
export const FIXED = 1.0;

/** Greedy longest-first into the lightest shard; deterministic (ties by name). */
export function planShards(files, timings, n) {
  const known = Object.values(timings).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 0;
  const weight = (f) => (timings[f] ?? median) + FIXED;
  const order = [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1));
  const shards = Array.from({ length: n }, () => ({ files: [], load: 0 }));
  for (const f of order) {
    let best = shards[0];
    for (const s of shards) if (s.load < best.load) best = s;
    best.files.push(f);
    best.load += weight(f);
  }
  for (const s of shards) s.files.sort();
  return shards;
}

function listFiles() {
  const vitest = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
  const r = spawnSync(process.execPath, [vitest, "list", "--filesOnly", "--json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`vitest list exited ${r.status}: ${(r.stderr || "").slice(-400)}`);
  const out = r.stdout.slice(r.stdout.indexOf("["));
  return JSON.parse(out).map((e) => path.relative(ROOT, e.file ?? e).split(path.sep).join("/"));
}

function refresh(dir) {
  const files = {};
  for (const name of fs.readdirSync(dir).filter((f) => /^shard-.*\.json$/.test(f))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    for (const t of j.testResults ?? []) {
      const rel = path.relative(ROOT, t.name).split(path.sep).join("/");
      const dur = (t.endTime - t.startTime) / 1000;
      if (dur >= 0.5) files[rel] = Math.round(dur * 10) / 10;
    }
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
  const prev = JSON.parse(fs.readFileSync(TIMINGS, "utf8"));
  fs.writeFileSync(TIMINGS, JSON.stringify({ _about: prev._about, files: sorted }, null, 1) + "\n");
  console.log(`plan-shards: wrote ${Object.keys(sorted).length} timings`);
}

const argv = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1].split(path.sep).join("/")}` || process.argv[1] === import.meta.filename) {
  if (argv[0] === "--refresh") {
    refresh(argv[1]);
  } else {
    const i = Number(argv[0]);
    const n = Number(argv[1]);
    if (!Number.isInteger(i) || !Number.isInteger(n) || i < 1 || i > n) {
      console.error("usage: node scripts/plan-shards.mjs <i> <N>");
      process.exit(1);
    }
    const files = listFiles();
    if (!files.length) {
      console.error("plan-shards: vitest resolved ZERO test files. That is a broken config, not a clean run.");
      process.exit(1);
    }
    const timings = JSON.parse(fs.readFileSync(TIMINGS, "utf8")).files;
    const shards = planShards(files, timings, n);
    const mine = shards[i - 1];
    fs.mkdirSync(path.join(ROOT, "test-results"), { recursive: true });
    const out = path.join(ROOT, "test-results", `shard-${i}-files.txt`);
    fs.writeFileSync(out, mine.files.join("\n") + "\n");
    console.log(
      `plan-shards: shard ${i}/${n} gets ${mine.files.length} of ${files.length} files; planned load ` +
        shards.map((s) => `${Math.round(s.load)}s`).join(" / ") + `; list at ${path.relative(ROOT, out)}`,
    );
  }
}
