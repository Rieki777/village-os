/**
 * Every guard ci.yml runs has a test that runs it, or says here why not
 * (readiness R209).
 *
 * The audit found five guards with no test that executed them: every test that
 * named one named it in a comment. A guard nobody has seen go red is a claim,
 * and the next guard written would join them unless something asked. This asks.
 *
 * A guard counts as tested when `scripts/<name>.test.mjs` exists, or when a
 * test file names `<name>.mjs` on a line that is not a comment AND spawns a
 * process, which is how every self-test here runs its guard. Naming it in a
 * comment does not count; that is the shape the audit found.
 *
 * NOT_YET is the list of guards with no such test, each with its reason. It is
 * a ratchet: a guard that gains a test must leave it (this fails until it
 * does), and a new guard cannot join it without somebody writing the line and
 * the reason down in a reviewed change.
 *
 * Run: node scripts/every-gate-has-a-self-test.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** Guards with no test that runs them yet, and why each may stand for now. */
const NOT_YET = {
  // Regenerate-and-compare checks. Each generator has its own test, which is
  // where the document's content is held; the check is only that comparison.
  "check-capabilities-doc": "Regenerates docs/CAPABILITIES.md and compares; generate-capabilities-doc.test.mjs tests the generator, nothing yet drives the comparison red.",
  "check-modules-doc": "Regenerates docs/MODULES.md and compares; generate-modules-doc.test.mjs tests the generator, nothing yet drives the comparison red.",
  "check-variables-doc": "Regenerates docs/VARIABLES.md and compares; generate-variables-doc.test.mjs tests the generator, nothing yet drives the comparison red.",
  // Budgets measured on a built tree, which a self-test does not have.
  "check-dist-budget": "Measures dist/public after pnpm build. A self-test needs a built client, and CI builds one only in the verify job.",
  "check-artifact-budget": "Measures the living map artifact against a byte budget; it needs the shipped artifact as built, and no fixture of one exists yet.",
  // Static guards over the real tree that have no fixture self-test yet.
  "check-hook-order": "No React hook after an early return. No fixture test yet; a two-file fixture with a hook after a return is the shape it needs.",
  "check-map-routes": "The living map's own route list against the client's routes. No fixture test yet.",
  "check-mirror-annotations": "Hand-kept maps of server unions typed as Record<string, T>. No fixture test yet.",
  "check-repo-payloads": "A dbCollection INSERT that can never succeed (a NOT NULL column the spec leaves unset). No fixture test yet.",
  "check-route-reachability": "A route the client links to from only one other page. No fixture test yet.",
  "check-save-honesty": "A client control reporting success without reading the answer. No fixture test yet.",
  "check-upload-strip": "An upload route that writes a file without stripping what it carries. No fixture test yet.",
};

const ci = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const gates = [...new Set([...ci.matchAll(/node scripts\/(check-[a-z0-9-]+)\.mjs/g)].map((m) => m[1]))].sort();
assert.ok(gates.length >= 30, `read only ${gates.length} guards out of ci.yml, so the pattern stopped matching`);

/** Every test file a guard's test could live in. */
function testFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (/\.test\.(mjs|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const tests = ["scripts", "server", "shared", "client"].flatMap((d) => {
  const abs = path.join(ROOT, d);
  return fs.existsSync(abs) ? testFiles(abs) : [];
});
const sources = new Map(tests.map((f) => [f, fs.readFileSync(f, "utf8")]));

const SPAWNS = /\b(spawnSync|spawn|execFileSync|execFile|execSync|fork)\s*\(/;
const isComment = (line) => /^\s*(\*|\/\/|\/\*)/.test(line);

function runsIt(name) {
  if (fs.existsSync(path.join(HERE, `${name}.test.mjs`))) return `scripts/${name}.test.mjs`;
  for (const [file, src] of sources) {
    if (!SPAWNS.test(src)) continue;
    if (src.split(/\r?\n/).some((line) => !isComment(line) && line.includes(`${name}.mjs`))) {
      return path.relative(ROOT, file).replace(/\\/g, "/");
    }
  }
  return null;
}

const untested = gates.filter((g) => !runsIt(g));
const stale = Object.keys(NOT_YET).filter((g) => !untested.includes(g));
const unlisted = untested.filter((g) => !(g in NOT_YET));

assert.deepStrictEqual(
  stale,
  [],
  `these guards have a test that runs them now, or left ci.yml, so take them out of NOT_YET: ${stale.join(", ")}`,
);
assert.deepStrictEqual(
  unlisted,
  [],
  `these guards in ci.yml have no test that runs them. Write scripts/<name>.test.mjs that drives each red and green, ` +
    `or, if that genuinely cannot be done yet, add it to NOT_YET with the reason: ${unlisted.join(", ")}`,
);
for (const [g, why] of Object.entries(NOT_YET)) assert.ok(String(why).length > 20, `NOT_YET.${g} has no real reason`);

console.log(
  `ok  every gate has a self-test: ${gates.length - untested.length} of ${gates.length} guards in ci.yml are run by a test; ` +
    `${untested.length} named in NOT_YET with a reason`,
);
