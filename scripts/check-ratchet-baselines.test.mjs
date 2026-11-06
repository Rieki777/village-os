/**
 * The baseline-rise gate goes red on a raise and stays green on everything a
 * lane does honestly (readiness R029, issue #600).
 *
 * Each case is a commit on a scratch branch over a scratch `main`, so the gate
 * reads a real merge base the way CI does. Nothing here touches this
 * repository's own baselines.
 *
 * Run: node scripts/check-ratchet-baselines.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-ratchet-baselines.mjs");
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-baselines-"));
const git = (...args) => {
  const r = spawnSync("git", ["-C", repo, "-c", "user.name=selftest", "-c", "user.email=selftest@example.test", "-c", "core.autocrlf=false", ...args], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const write = (name, value) => {
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repo, "scripts", name), `${JSON.stringify(value, null, 2)}\n`);
};
const BASE = {
  "lines-baseline.json": { threshold: 1000, total: 10, files: { "x.ts": 5, "y.ts": 5 } },
  "module-docs-baseline.json": { undocumented: 6, modules: 23, ids: ["a", "b"] },
};
const run = () => spawnSync(process.execPath, [SCRIPT, "--root", repo, "--base", "main"], { encoding: "utf8" });

/** One case: a branch off main carrying these baselines, and what the gate must say. */
function expectCase(name, baselines, status, said) {
  git("checkout", "-q", "-B", "work", "main");
  for (const [file, value] of Object.entries(baselines)) write(file, value);
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", name);
  const r = run();
  const out = `${r.stdout}\n${r.stderr}`;
  assert.strictEqual(r.status, status, `${name}: expected exit ${status}, got ${r.status}\n${out.slice(-800)}`);
  if (said) assert.match(out, said, `${name}: the output does not say ${said}`);
}

try {
  git("init", "-q", "-b", "main");
  for (const [file, value] of Object.entries(BASE)) write(file, value);
  git("add", "-A");
  git("commit", "-q", "-m", "base");

  const lines = BASE["lines-baseline.json"];
  const docs = BASE["module-docs-baseline.json"];
  expectCase("nothing changed", {}, 0, /rises\s+0/);
  expectCase("a total lowered, the way the integrator records a fall", { "lines-baseline.json": { ...lines, total: 9, files: { "x.ts": 4, "y.ts": 5 } } }, 0);
  expectCase("a file renamed, its count carried across", { "lines-baseline.json": { ...lines, files: { "z.ts": 5, "y.ts": 5 } } }, 0);
  expectCase("a denominator rose because a module was added", { "module-docs-baseline.json": { ...docs, modules: 24 } }, 0);

  expectCase("a total raised by hand", { "lines-baseline.json": { ...lines, total: 11 } }, 1, /total: 10 -> 11/);
  expectCase("a limit loosened", { "lines-baseline.json": { ...lines, threshold: 1200 } }, 1, /threshold: 1000 -> 1200/);
  expectCase(
    "one file raised, another lowered to hide it (the #575 shape, with the total held)",
    { "lines-baseline.json": { ...lines, files: { "x.ts": 6, "y.ts": 4 } } },
    1,
    /files\.x\.ts: 5 -> 6/,
  );
  expectCase("a new file let in above the old sum", { "lines-baseline.json": { ...lines, files: { ...lines.files, "w.ts": 1 } } }, 1, /files sum: 10 -> 11/);
  expectCase("the ratchet beside a denominator still holds", { "module-docs-baseline.json": { ...docs, undocumented: 7 } }, 1, /undocumented: 6 -> 7/);

  // A gate with nothing to read must say so, never pass.
  git("checkout", "-q", "-B", "work", "main");
  fs.rmSync(path.join(repo, "scripts"), { recursive: true, force: true });
  const empty = run();
  assert.strictEqual(empty.status, 1, "no baselines at all must fail");
  assert.match(`${empty.stdout}${empty.stderr}`, /measured nothing/);

  console.log("ok  ratchet baselines: 9 cases, a raise fails and an honest change passes");
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}
