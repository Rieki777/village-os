/**
 * The filter's own guard, driven against REAL temporary repositories.
 *
 * Every case builds a throwaway git repo on disk and asks the shipped
 * `dropIgnored` about it. Nothing here mocks git, because the whole question
 * is what git says: a fixture that answered for git would be testing a second
 * implementation of the rule beside the one that ships.
 *
 * THE THIRD CASE IS THE ONE THAT MATTERS. A filter that narrows a guard's
 * subjects can fail in two directions, and only one of them is visible: too
 * little filtering shows up as a noisy red, too much shows up as a green. So
 * "outside a repository, nothing is filtered AND it says so" is asserted
 * explicitly rather than left to the happy path.
 *
 * Run: node scripts/git-subjects.test.mjs
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dropIgnored } from "./git-subjects.mjs";

const made = [];
let run = 0;
const check = (name, fn) => { fn(); run += 1; console.log(`  PASS  ${name}`); };

/** A throwaway repo with the given files, and a .gitignore if one is asked for. */
function repo(files, ignore) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-subjects-"));
  made.push(dir);
  spawnSync("git", ["init", "-q"], { cwd: dir });
  if (ignore !== undefined) fs.writeFileSync(path.join(dir, ".gitignore"), `${ignore}\n`);
  for (const f of files) {
    const full = path.join(dir, f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "x\n");
  }
  const rel = (p) => path.relative(dir, p).split(path.sep).join("/");
  return { dir, rel, abs: (f) => path.join(dir, f) };
}

console.log("\ngit-subjects: a guard scans what git tracks\n");

check("drops a file an ignore rule covers, and counts it", () => {
  const r = repo(["src/a.ts", "tmp/scratch.ts"], "tmp/");
  const out = dropIgnored([r.abs("src/a.ts"), r.abs("tmp/scratch.ts")], { cwd: r.dir, rel: r.rel });
  assert.deepStrictEqual(out.kept.map(r.rel), ["src/a.ts"]);
  assert.strictEqual(out.skipped, 1);
  assert.strictEqual(out.consulted, true);
});

check("KEEPS an untracked file that no rule ignores, because it is about to be committed", () => {
  const r = repo(["src/new.ts"], "tmp/");
  const out = dropIgnored([r.abs("src/new.ts")], { cwd: r.dir, rel: r.rel });
  assert.deepStrictEqual(out.kept.map(r.rel), ["src/new.ts"], "a new source file is a real subject");
  assert.strictEqual(out.skipped, 0);
});

check("outside a repository it filters NOTHING and says the filter did not run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-subjects-norepo-"));
  made.push(dir);
  fs.writeFileSync(path.join(dir, "a.ts"), "x\n");
  const rel = (p) => path.relative(dir, p).split(path.sep).join("/");
  const out = dropIgnored([path.join(dir, "a.ts")], { cwd: dir, rel });
  assert.strictEqual(out.kept.length, 1, "a guard must never scan less because git was unavailable");
  assert.strictEqual(out.consulted, false, "and the caller must be able to say so");
});

check("an empty list is answered without calling git at all", () => {
  const out = dropIgnored([], { cwd: process.cwd(), rel: (p) => p });
  assert.deepStrictEqual(out.kept, []);
  assert.strictEqual(out.consulted, true);
});

check("several ignored paths are all dropped and all counted", () => {
  const r = repo(["keep.ts", "tmp/a.ts", "tmp/deep/b.ts"], "tmp/");
  const out = dropIgnored([r.abs("keep.ts"), r.abs("tmp/a.ts"), r.abs("tmp/deep/b.ts")], { cwd: r.dir, rel: r.rel });
  assert.deepStrictEqual(out.kept.map(r.rel), ["keep.ts"]);
  assert.strictEqual(out.skipped, 2);
});

for (const d of made) fs.rmSync(d, { recursive: true, force: true });
console.log(`\nPASS  git subjects: ${run} assertion group(s), 0 failures.\n`);
