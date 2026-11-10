/**
 * The generated-docs flow's own guard: can each part of it go red, and does a
 * route-only change stay green?
 *
 * (Rye, 2026-11-09. The design is in scripts/lib/generatedDocs.mjs and
 * docs/GENERATED_DOCS.md.) Five claims, each with a control that fails for the
 * reason the claim names:
 *
 *   1. A pull request that changes code and no generated file passes.
 *   2. A pull request that hand-edits a generated file fails, in plain words.
 *      ECONOMICS.md is half prose: editing the prose passes, editing a
 *      generated region fails.
 *   3. In pr mode a stale GOVERNANCE.md passes and its would-be diff reaches the
 *      job summary; in strict mode the same stale file fails.
 *   4. A generator is idempotent: a second run writes the same bytes.
 *   5. The workflow that owns the files is portable (no secret, no repo name)
 *      and is the one place strict mode is switched on.
 *
 * Run: node scripts/check-generated-docs-untouched.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findViolations } from "./check-generated-docs-untouched.mjs";
import { GENERATED_FILES, docsMode, driftIsFatal } from "./lib/generatedDocs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
let passed = 0;
function check(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    throw err;
  }
  passed += 1;
  console.log(`  PASS  ${name}`);
}
const run = (script, env = {}, args = []) =>
  spawnSync(process.execPath, [path.join(HERE, script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, GENERATED_DOCS_MODE: "", GITHUB_STEP_SUMMARY: "", ...env },
  });

console.log("generated docs flow: the guards can go red, and a route-only change stays green\n");

// 1 and 2: the pure decision.
const econ = (body, prose = "prose") => `${prose}\n<!-- generated:tokens start -->\n${body}\n<!-- generated:tokens end -->\n`;
const io = (base, head) => ({ readBase: (f) => base[f] ?? null, readHead: (f) => head[f] ?? null });
check("a change to a route and no generated file passes", () => {
  assert.deepEqual(findViolations({ changed: ["server/routes/foo.ts", "server/routes/foo.test.ts"], ...io({}, {}) }), []);
});
check("CONTROL: a hand-edited GOVERNANCE.md fails", () => {
  const bad = findViolations({ changed: ["docs/GOVERNANCE.md"], ...io({}, {}) });
  assert.equal(bad.length, 1);
  assert.equal(bad[0].file, "docs/GOVERNANCE.md");
});
check("CONTROL: every whole-file generated doc and the English catalog is refused", () => {
  for (const g of GENERATED_FILES.filter((x) => x.kind === "whole")) {
    assert.equal(findViolations({ changed: [g.path], ...io({}, {}) }).length, 1, g.path);
  }
});
check("editing ECONOMICS.md prose passes", () => {
  const f = "docs/ECONOMICS.md";
  assert.deepEqual(findViolations({ changed: [f], ...io({ [f]: econ("a") }, { [f]: econ("a", "new prose") }) }), []);
});
check("CONTROL: editing an ECONOMICS.md generated region fails", () => {
  const f = "docs/ECONOMICS.md";
  const bad = findViolations({ changed: [f], ...io({ [f]: econ("a") }, { [f]: econ("b") }) });
  assert.equal(bad.length, 1);
  assert.match(bad[0].why, /generated:tokens/);
});
check("a region that is new in the pull request is allowed (a new region needs its markers)", () => {
  const f = "docs/ECONOMICS.md";
  assert.deepEqual(findViolations({ changed: [f], ...io({ [f]: "prose\n" }, { [f]: econ("x") }) }), []);
});
check("CRLF alone is not an edit", () => {
  const f = "docs/ECONOMICS.md";
  assert.deepEqual(findViolations({ changed: [f], ...io({ [f]: econ("a") }, { [f]: econ("a").replace(/\n/g, "\r\n") }) }), []);
});

// The script itself, end to end, in a scratch repository.
function scratchRepo(editGenerated) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gendocs-repo-"));
  const g = (...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.test");
  g("config", "user.name", "t");
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "GOVERNANCE.md"), "one\n");
  g("add", "-A");
  g("commit", "-qm", "base");
  g("checkout", "-qb", "lane");
  fs.writeFileSync(path.join(dir, "route.ts"), "x\n");
  if (editGenerated) fs.writeFileSync(path.join(dir, "docs", "GOVERNANCE.md"), "two\n");
  g("add", "-A");
  g("commit", "-qm", "lane");
  // The script resolves its repository from its own location, so it runs from a copy inside the scratch repo.
  fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
  fs.copyFileSync(path.join(HERE, "check-generated-docs-untouched.mjs"), path.join(dir, "scripts", "check-generated-docs-untouched.mjs"));
  fs.copyFileSync(path.join(HERE, "lib", "generatedDocs.mjs"), path.join(dir, "scripts", "lib", "generatedDocs.mjs"));
  return dir;
}
const guardIn = (dir, env = {}, args = ["--base", "main"]) =>
  spawnSync(process.execPath, [path.join(dir, "scripts", "check-generated-docs-untouched.mjs"), ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
check("end to end: a lane that only changes a route exits 0", () => {
  const r = guardIn(scratchRepo(false));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
check("CONTROL end to end: a lane that edits GOVERNANCE.md exits 1 and says what to do", () => {
  const r = guardIn(scratchRepo(true));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /Main regenerates these after every merge; drop your change/);
  assert.match(r.stdout, /git checkout main -- docs\/GOVERNANCE\.md/);
});
check("a push (main, where the bot commits) is not checked", () => {
  const r = guardIn(scratchRepo(true), { GITHUB_EVENT_NAME: "push" }, []);
  assert.equal(r.status, 0, r.stdout);
});

// 3: the mode, with a deliberately stale committed document.
check("docsMode is pr unless strict is asked for by name", () => {
  assert.equal(docsMode({}), "pr");
  assert.equal(docsMode({ GENERATED_DOCS_MODE: "yes" }), "pr");
  assert.equal(docsMode({ GENERATED_DOCS_MODE: "strict" }), "strict");
});
check("driftIsFatal: pr mode reports and passes, strict mode is fatal", () => {
  const summary = path.join(os.tmpdir(), `gendocs-summary-${process.pid}.md`);
  fs.rmSync(summary, { force: true });
  const args = { label: "docs/X.md", found: "a\nb\n", wanted: "a\nc\n", seen: true, regenerate: "gen" };
  assert.equal(driftIsFatal(args, { GITHUB_STEP_SUMMARY: summary }), false);
  assert.match(fs.readFileSync(summary, "utf8"), /-b\n\+c/);
  assert.equal(driftIsFatal(args, { GENERATED_DOCS_MODE: "strict" }), true);
  fs.rmSync(summary, { force: true });
});
const GOV = path.join(ROOT, "docs", "GOVERNANCE.md");
const original = fs.readFileSync(GOV);
try {
  fs.writeFileSync(GOV, `${original.toString("utf8")}\nA sentence a hand added.\n`);
  const summary = path.join(os.tmpdir(), `gendocs-gov-${process.pid}.md`);
  fs.rmSync(summary, { force: true });
  check("pr mode: a stale GOVERNANCE.md passes, and the would-be diff is in the job summary", () => {
    const r = run("check-governance-doc.mjs", { GITHUB_STEP_SUMMARY: summary });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const text = fs.readFileSync(summary, "utf8");
    assert.match(text, /docs\/GOVERNANCE\.md: what main will publish/);
    assert.match(text, /A sentence a hand added/);
  });
  check("CONTROL: strict mode, the same stale GOVERNANCE.md fails", () => {
    const r = run("check-governance-doc.mjs", { GENERATED_DOCS_MODE: "strict" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /have come apart/);
  });
  fs.rmSync(summary, { force: true });
} finally {
  fs.writeFileSync(GOV, original);
}

// 4: idempotent.
check("the governance generator is idempotent: two runs write the same bytes", () => {
  const a = run("generate-governance-doc.mjs", {}, ["--stdout"]);
  const b = run("generate-governance-doc.mjs", {}, ["--stdout"]);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout);
  assert.ok(a.stdout.length > 1000);
});

// 5: the workflow.
const wf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "generated-docs.yml"), "utf8");
check("the workflow runs on main, needs no secret, names no repository, and is where strict is set", () => {
  assert.match(wf, /branches: \["main"\]/);
  assert.match(wf, /contents: write/);
  assert.match(wf, /GENERATED_DOCS_MODE: strict/);
  assert.doesNotMatch(wf, /secrets\./);
  assert.doesNotMatch(wf, /Rieki777|village-os|railway/i);
  for (const g of ["governance", "economics", "token", "variables", "modules", "capabilities"]) {
    assert.match(wf, new RegExp(`generate-${g}-doc`));
  }
  assert.match(wf, /i18n:extract/);
});
check("CONTROL: ci.yml never sets strict, because a merge commit is one bot commit older than its docs", () => {
  const ci = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert.doesNotMatch(ci, /GENERATED_DOCS_MODE:\s*strict/);
  assert.match(ci, /check-generated-docs-untouched\.mjs/);
});
check("every generator in the registry exists", () => {
  for (const g of GENERATED_FILES) if (g.generator.startsWith("scripts/")) assert.ok(fs.existsSync(path.join(ROOT, g.generator)), g.generator);
});

console.log(`\n${passed} check(s) passed`);
