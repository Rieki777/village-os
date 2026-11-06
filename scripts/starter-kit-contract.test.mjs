/**
 * The starter kit is what a founder downloads and unzips (release.yml, "Build
 * the starter kit from the tag"). Readiness finding R185: it shipped nine files,
 * and its own guides sent the founder, and the founder's assistant, to files
 * that were not in it, so every such link in the unzipped folder led nowhere.
 *
 * This holds the kit to the guides a founder reads in it. Every repository
 * file that AGENTS.md, START_HERE.md, the setup prompt, UPGRADING or
 * .env.example names must be in the kit, or be listed below as outside it on
 * purpose, with the reason. The list fails CLOSED: a guide that starts naming
 * a new file fails this test until somebody decides which side it is on.
 *
 * Run: node scripts/starter-kit-contract.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r/g, "");

/** For changing the code, which means cloning the repository, as START_HERE says. Never in the kit. */
const OUTSIDE_ON_PURPOSE = new Map([
  ["CLAUDE.md", "for contributors to the platform, who clone the repository"],
  ["CONTRIBUTING.md", "for contributors, who clone the repository"],
  ["docs/modules/START_HERE.md", "for module builders, who clone the repository"],
  ["shared/brochure.ts", "source code, which a founder changes only in a clone"],
  ["ops/roll.mjs", "the fleet operator's tool, run from a clone"],
  ["scripts/check-migration-compat.mjs", "a release check, run from a clone"],
  ["scripts/fork-env-audit.mjs", "checks the server's code against .env.example, so it needs the code"],
  ["scripts/start-here-backup-contract.test.mjs", "a repository guard, not a founder's step: START_HERE cites it as what holds its backup section and selfhost-smoke.yml to each other, and it needs both of those files and the repository to run"],
]);

const workflow = read(".github/workflows/release.yml");
const block = workflow.split(/^\s*files=\(\s*$/m)[1]?.split(/^\s*\)\s*$/m)[0] ?? "";
const kit = block.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
assert.ok(kit.length >= 9, `release.yml's kit lists its files, found ${kit.length}`);
for (const f of kit) assert.ok(fs.existsSync(path.join(ROOT, f)), `the kit names ${f}, which does not exist`);

const GUIDES = ["AGENTS.md", "START_HERE.md", "docs/FOUNDER_SETUP_PROMPT.md", "docs/UPGRADING.md", ".env.example"];
const REF = /(?:\]\(|`|\s|^)((?:docs|scripts|ops|server|shared|client)\/[A-Za-z0-9_./-]+\.(?:md|mjs|ts|tsx|yml|json|sh)|[A-Z][A-Z_]+\.md)/gm;
const missing = [];
let seen = 0;
for (const guide of GUIDES) {
  assert.ok(kit.includes(guide), `${guide} is a guide in the kit`);
  for (const m of read(guide).matchAll(REF)) {
    const ref = m[1].replace(/[.,;:]+$/, "");
    if (!fs.existsSync(path.join(ROOT, ref)) || ref === guide) continue;
    seen += 1;
    if (!kit.includes(ref) && !OUTSIDE_ON_PURPOSE.has(ref)) missing.push(`${guide} names ${ref}`);
  }
}
assert.ok(seen >= 10, `the guides name repository files, found ${seen}: a parse that finds nothing proves nothing`);
assert.deepStrictEqual(missing, [], `the starter kit is missing files its own guides send a founder to:\n  ${[...new Set(missing)].join("\n  ")}`);
for (const f of OUTSIDE_ON_PURPOSE.keys()) assert.ok(!kit.includes(f), `${f} is listed as outside the kit on purpose, and the kit carries it`);

console.log(`ok  starter kit contract: ${kit.length} files, ${seen} references from ${GUIDES.length} guides, each in the kit or outside it on purpose`);
