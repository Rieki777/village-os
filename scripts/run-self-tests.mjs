/**
 * Run EVERY guard self-test, found by glob rather than named one at a time.
 *
 * `scripts/` holds the meta-tests: the files that prove a guard can actually go
 * red. Nothing else in this repository can reach them. vitest.config.ts's
 * include globs cover `server/`, `shared/` and `client/` only, and none of these
 * files end in `.ts` anyway, so `pnpm test` cannot see them by two independent
 * rules. There are no git hooks. So they run only if ci.yml names them.
 *
 * ci.yml named four of nine. The other five ran nowhere at all, and two of them
 * are the ones that matter most: `check-voice.test.mjs` guards the house writing
 * rules on all shipped copy, and `check-migration-compat.test.mjs` guards "a
 * migration leaves the previous release able to run", which is the only thing
 * standing between a bad migration and a village that cannot roll back. All
 * five were green when this was written, so this starts from a known state.
 *
 * Naming them individually is what left the gap, and it would leave it again
 * for the tenth self-test somebody writes. This globs, so a new self-test is
 * wired the moment it is saved. It also prints the count, so "none found"
 * (a rename, a moved directory) reads as the failure it would be rather than
 * as a silent pass.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(import.meta.dirname, ".");
const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

if (files.length === 0) {
  console.error(
    "FAIL -- no scripts/*.test.mjs found at all. Either every guard self-test was deleted or " +
      "this script is looking in the wrong place. Both are failures, not a clean run.",
  );
  process.exit(1);
}

let failed = 0;

/*
 * CONCURRENCY. The self-tests are independent child processes (each reads the
 * repository and its own fixtures; none writes outside a temp directory), and
 * they were run one after another: 3.3 minutes median in the verify job
 * (CI audit, 2026-11-10). They now run SELF_TEST_JOBS at a time (default 4, the
 * runner's vCPU count). Output is still printed in sorted file order, after
 * each result is in, so a red log reads the same as before and a failure keeps
 * every line the child printed. SELF_TEST_JOBS=1 restores the serial run.
 */
const JOBS = Math.max(1, Number(process.env.SELF_TEST_JOBS ?? 4) || 4);

function runOne(f) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(DIR, f)], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => resolve({ f, status: 1, signal: null, out: String(e) }));
    child.on("close", (status, signal) => resolve({ f, status, signal, out }));
  });
}

const results = new Array(files.length);
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(JOBS, files.length) }, async () => {
    while (next < files.length) {
      const i = next++;
      results[i] = await runOne(files[i]);
    }
  }),
);

for (const r of results) {
  const ok = r.status === 0;
  if (!ok) failed += 1;
  const all = r.out
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  console.log(`${ok ? "ok  " : "FAIL"}  ${r.f}  ${all[all.length - 1]?.trim() ?? ""}`);
  // On failure, print what the child actually said: every line naming which
  // assertion failed and why (a red build must carry a way to act on it).
  if (!ok) {
    for (const l of all) console.log(`        ${l}`);
    if (r.status === null) console.log(`        (killed by signal ${r.signal})`);
  }
}


