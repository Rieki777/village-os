// Self-test for scripts/plan-shards.mjs: every file lands in exactly one shard,
// the loads are balanced, and the plan is deterministic. Run: node scripts/plan-shards.test.mjs
import assert from "node:assert/strict";
import { planShards } from "./plan-shards.mjs";

const files = Array.from({ length: 200 }, (_, i) => `server/f${String(i).padStart(3, "0")}.test.ts`);
const timings = { "server/f000.test.ts": 150, "server/f001.test.ts": 90, "server/f002.test.ts": 60 };
const a = planShards(files, timings, 4);
const b = planShards([...files].reverse(), timings, 4);
const all = a.flatMap((s) => s.files);
assert.equal(all.length, files.length, "every file is planned");
assert.equal(new Set(all).size, files.length, "no file is planned twice");
assert.deepEqual(a.map((s) => s.files), b.map((s) => s.files), "input order does not change the plan");
const loads = a.map((s) => s.load);
assert.ok(Math.max(...loads) - Math.min(...loads) <= 151, `loads stay within the heaviest file: ${loads}`);
assert.ok(a.every((s) => s.files.length > 0), "no empty shard");
// A file with no recorded time still lands somewhere.
assert.ok(planShards(["x.test.ts"], {}, 2).flatMap((s) => s.files).includes("x.test.ts"));
// Control: dropping a file from the plan must be visible to the partition check.
const broken = a.map((s) => s.files).flat().slice(1);
assert.notEqual(new Set(broken).size, files.length, "control: a lost file is detected");
console.log(`plan-shards: ${files.length} files in 4 shards, loads ${loads.map(Math.round).join("/")}`);
