/**
 * The shard proof's own proof.
 *
 * check-test-shards.mjs is the one thing standing between a split suite and a
 * file that quietly ran nowhere. A checker nobody has watched refuse is a
 * checker that reports green either way, so every refusal it promises is
 * driven here against the REAL `judge` function: a file in no shard, a file in
 * two, a file nobody listed, a failed file, a wholly skipped file, a missing
 * shard, and shards that disagree about the count. The clean case is last, so
 * a judge that refuses everything cannot pass this file either.
 *
 * Run: node scripts/check-test-shards.test.mjs
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judge, latestAttempts, parseShardName, toRel } from "./check-test-shards.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let run = 0;
const check = (name, fn) => {
  fn();
  run += 1;
  console.log(`  PASS  ${name}`);
};

const abs = (rel) => path.join(ROOT, ...rel.split("/"));
const file = (rel, status = "passed", tests = ["passed"]) => ({
  name: abs(rel),
  status,
  startTime: 0,
  endTime: 1000,
  assertionResults: tests.map((s) => ({ status: s })),
});
const shard = (index, count, results) => ({ index, count, report: { testResults: results } });

const EXPECTED = ["server/a.test.ts", "server/b.e2e.test.ts", "shared/c.test.ts", "client/src/d.test.tsx"];
const clean = () => [
  shard(1, 2, [file("server/a.test.ts"), file("shared/c.test.ts")]),
  shard(2, 2, [file("server/b.e2e.test.ts"), file("client/src/d.test.tsx", "passed", ["passed", "skipped"])]),
];

check("a shard report name carries its index and count, and nothing else matches", () => {
  assert.deepStrictEqual(parseShardName("shard-3-of-4.json"), { index: 3, count: 4, attempt: 1 });
  assert.strictEqual(parseShardName("shard-3.json"), null);
  assert.strictEqual(parseShardName("notes.json"), null);
});

check("a report name may carry the run attempt that wrote it", () => {
  assert.deepStrictEqual(parseShardName("shard-3-of-4-attempt-2.json"), { index: 3, count: 4, attempt: 2 });
  assert.strictEqual(parseShardName("shard-3-of-4.json").attempt, 1);
  assert.strictEqual(parseShardName("shard-3-of-4-attempt-.json"), null);
});

// Batch 75, 2026-11-01: shard 4 failed on a flake, `gh run rerun --failed`
// passed it on attempt 2, and tests-ran-once still read attempt 1's report,
// because the run then held two artifacts of the same name and the download
// took the older one. A re-run must be judged on what it re-ran.
const rerun = () => [
  ...clean().map((s) => ({ ...s, attempt: 1 })),
  { ...shard(2, 2, [file("server/b.e2e.test.ts", "failed", ["failed"]), file("client/src/d.test.tsx")]), attempt: 1 },
];
check("a re-run shard is judged on its newest attempt, whichever order the reports arrive in", () => {
  const reports = rerun();
  // attempt 1 failed shard 2; the clean shard 2 is the re-run.
  reports[1].attempt = 2;
  for (const order of [reports, [...reports].reverse()]) {
    const kept = latestAttempts(order);
    assert.deepStrictEqual(kept.map((s) => `${s.index}@${s.attempt}`).sort(), ["1@1", "2@2"]);
    const v = judge({ expected: EXPECTED, shards: kept, want: 2 });
    assert.deepStrictEqual(v.failures, []);
    assert.deepStrictEqual(v.problems, []);
  }
});

check("control: judging every attempt at once is red, so the selection is what turns it green", () => {
  const reports = rerun();
  reports[1].attempt = 2;
  const v = judge({ expected: EXPECTED, shards: reports, want: 2 });
  assert.ok(v.failures.length > 0);
});

check("a newest attempt that failed stays failed: re-running cannot launder a red", () => {
  const reports = rerun(); // make the FAILED shard 2 report the newest attempt
  reports[2].attempt = 3;
  const v = judge({ expected: EXPECTED, shards: latestAttempts(reports), want: 2 });
  assert.deepStrictEqual(v.failures, ["server/b.e2e.test.ts: failed in shard 2"]);
});

check("an absolute report path comes back repo-relative with forward slashes", () => {
  assert.strictEqual(toRel(abs("server/db/testDb.test.ts")), "server/db/testDb.test.ts");
});

check("a file in no shard is a failure that names it", () => {
  const shards = clean();
  shards[1].report.testResults.pop();
  const v = judge({ expected: EXPECTED, shards, want: 2 });
  assert.deepStrictEqual(v.missing, ["client/src/d.test.tsx"]);
  assert.ok(v.failures.some((f) => f.startsWith("client/src/d.test.tsx: ran in no shard")));
});

check("a file in two shards is a failure that names both", () => {
  const shards = clean();
  shards[1].report.testResults.push(file("server/a.test.ts"));
  const v = judge({ expected: EXPECTED, shards, want: 2 });
  assert.deepStrictEqual(v.twice, ["server/a.test.ts (shards 1, 2)"]);
  assert.ok(v.failures.length >= 1);
});

check("a file nobody listed is a failure", () => {
  const shards = clean();
  shards[0].report.testResults.push(file("server/stray.test.ts"));
  const v = judge({ expected: EXPECTED, shards, want: 2 });
  assert.deepStrictEqual(v.extra, ["server/stray.test.ts"]);
});

check("a failed file is a failure", () => {
  const shards = clean();
  shards[0].report.testResults[0] = file("server/a.test.ts", "failed", ["failed"]);
  const v = judge({ expected: EXPECTED, shards, want: 2 });
  assert.deepStrictEqual(v.failures, ["server/a.test.ts: failed in shard 1"]);
  assert.strictEqual(v.problems.length, 0);
});

check("a wholly skipped file is a failure, because a skip is not a pass", () => {
  const shards = clean();
  shards[1].report.testResults[0] = file("server/b.e2e.test.ts", "skipped", ["skipped"]);
  const v = judge({ expected: EXPECTED, shards, want: 2 });
  assert.deepStrictEqual(v.failures, ["server/b.e2e.test.ts: skipped in shard 2"]);
});

check("a missing shard is 'could not look', never a pass over the shards that arrived", () => {
  const v = judge({ expected: EXPECTED, shards: clean().slice(0, 1), want: 2 });
  assert.ok(v.problems.includes("no report from shard 2 of 2"));
});

check("shards that disagree with the declared count cannot be judged", () => {
  const v = judge({ expected: EXPECTED, shards: clean(), want: 3 });
  assert.ok(v.problems.some((p) => p.includes("disagree about the shard count")));
  assert.ok(v.problems.includes("no report from shard 3 of 3"));
});

check("a report with no testResults cannot be judged", () => {
  const shards = clean();
  shards[0].report = {};
  const v = judge({ expected: EXPECTED, shards, want: 2 });
  assert.ok(v.problems.includes("shard 1 wrote a report with no testResults array"));
});

check("the clean split passes, and counts a test-level skip without failing it", () => {
  const v = judge({ expected: EXPECTED, shards: clean(), want: 2 });
  assert.deepStrictEqual(v.problems, []);
  assert.deepStrictEqual(v.failures, []);
  assert.strictEqual(v.ran, 4);
  assert.strictEqual(v.perShard[1].skippedTests, 1);
});

console.log(`\ncheck-test-shards self-test: ${run} case(s) passed.`);
