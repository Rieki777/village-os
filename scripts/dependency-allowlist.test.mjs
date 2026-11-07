/**
 * The new-dependency rule's own test (validate-module.mjs, contribution check 3a).
 *
 * The rule: a pull request adds no package, except one named in
 * dependency-allowlist.mjs at its exact pinned version and in the section
 * (dependencies or devDependencies) the entry names. These cases run the same
 * function the gate calls.
 *
 * Run: node scripts/dependency-allowlist.test.mjs
 */
import assert from "node:assert";
import { ALLOWED_NEW_DEPENDENCIES, newDependencyProblems } from "./dependency-allowlist.mjs";

let run = 0;
const check = (name, fn) => { fn(); run += 1; console.log(`  PASS  ${name}`); };

const before = { dependencies: { react: "^19.3.1" }, devDependencies: { vite: "^7.3.7" } };
const allowed = [
  { name: "@lingui/core", version: "6.12.0", section: "dependencies", purpose: "i18n runtime", date: "2026-11-06" },
  { name: "@lingui/cli", version: "6.12.0", section: "devDependencies", purpose: "i18n extraction", date: "2026-11-06" },
];

check("nothing added: no problems", () => {
  assert.deepEqual(newDependencyProblems(before, before, allowed), []);
});

check("an unlisted package still fails", () => {
  const after = { ...before, dependencies: { ...before.dependencies, "left-pad": "1.3.0" } };
  const p = newDependencyProblems(before, after, allowed);
  assert.equal(p.length, 1);
  assert.match(p[0], /left-pad.*not on the allow-list/);
});

check("an allow-listed package at its pinned version, in its section, passes", () => {
  const after = {
    dependencies: { ...before.dependencies, "@lingui/core": "6.12.0" },
    devDependencies: { ...before.devDependencies, "@lingui/cli": "6.12.0" },
  };
  assert.deepEqual(newDependencyProblems(before, after, allowed), []);
});

check("an allow-listed package at a different version fails", () => {
  for (const v of ["6.12.1", "^6.12.0", "~6.12.0", "latest"]) {
    const after = { ...before, dependencies: { ...before.dependencies, "@lingui/core": v } };
    const p = newDependencyProblems(before, after, allowed);
    assert.equal(p.length, 1, v);
    assert.match(p[0], /@lingui\/core.*6\.12\.0/);
  }
});

check("a build-only package added to dependencies (shipped) fails", () => {
  const after = { ...before, dependencies: { ...before.dependencies, "@lingui/cli": "6.12.0" } };
  const p = newDependencyProblems(before, after, allowed);
  assert.equal(p.length, 1);
  assert.match(p[0], /devDependencies/);
});

check("bumping an allow-listed package already present is a new version: it needs a new entry", () => {
  const was = { ...before, dependencies: { ...before.dependencies, "@lingui/core": "6.12.0" } };
  const now = { ...before, dependencies: { ...before.dependencies, "@lingui/core": "6.13.0" } };
  const p = newDependencyProblems(was, now, allowed);
  assert.equal(p.length, 1);
  assert.match(p[0], /6\.13\.0/);
});

check("a bump of a package that was never allow-listed is the existing rule's business, not this one's", () => {
  const now = { ...before, dependencies: { react: "^19.4.0" } };
  assert.deepEqual(newDependencyProblems(before, now, allowed), []);
});

check("every real entry names an exact version, a section, a purpose and a date", () => {
  assert.ok(ALLOWED_NEW_DEPENDENCIES.length > 0);
  for (const e of ALLOWED_NEW_DEPENDENCIES) {
    assert.match(e.version, /^\d+\.\d+\.\d+$/, e.name);
    assert.ok(e.section === "dependencies" || e.section === "devDependencies", e.name);
    assert.ok(e.purpose.length > 10, e.name);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, e.name);
  }
});

console.log(`dependency-allowlist: ${run} checks passed`);
