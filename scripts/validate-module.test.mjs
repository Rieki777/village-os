#!/usr/bin/env node
/**
 * The guild half of module intake, proved red and green against the real
 * script.
 *
 * Each case copies `shared/` into a scratch directory, breaks one thing in the
 * copy, and runs the real `validate-module.mjs` with `VALIDATE_MODULE_SHARED`
 * pointed at it. The script reads everything else (docs, server wiring, the
 * raw-SQL register) from this repository as usual, so a failure here is the
 * guild check and nothing else: the clean case proves the rest of the run is
 * green on this tree.
 *
 * `shared/guilds.test.ts` covers every rule in `guildProblems` one at a time.
 * This file covers the thing that test cannot: that the intake script actually
 * calls it, and charges the problem to the module that owns it.
 *
 * Run: node scripts/validate-module.test.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "validate-module.mjs");
const SHARED = path.join(HERE, "..", "shared");

let failures = 0;
let assertions = 0;
const check = (name, ok) => {
  assertions += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${name}`);
};

/** A scratch copy of shared/ with `edit` applied to one file. */
function brokenShared(file, edit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-module-test-"));
  for (const f of fs.readdirSync(SHARED)) {
    if (f.endsWith(".ts")) fs.copyFileSync(path.join(SHARED, f), path.join(dir, f));
  }
  if (file) {
    const p = path.join(dir, file);
    const before = fs.readFileSync(p, "utf8");
    const after = edit(before);
    if (after === before) throw new Error(`the edit to ${file} changed nothing, so this case proves nothing`);
    fs.writeFileSync(p, after);
  }
  return dir;
}

function run(dir, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, VALIDATE_MODULE_SHARED: dir },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

console.log("validate-module: guild manifests");

{
  const r = run(brokenShared(null), "stays");
  check("a clean copy passes for stays", r.status === 0);
  check("the guild section ran", r.out.includes("guild problems for the selected module(s): 0  OK"));
}

{
  const dir = brokenShared("modules.ts", (s) =>
    s.replace(/(\n    id: "stays",\r?\n)    guild: \[[^\]]*\],\r?\n/, "$1"),
  );
  const r = run(dir, "stays");
  check("a module with no guild fails", r.status === 1);
  check("and says which", r.out.includes('module "stays" declares no guild'));
}

{
  const dir = brokenShared("guilds.ts", (s) =>
    s.replace(
      /(id: "stripe-webhook",[\s\S]*?consequence:\s*)"[^"]*"( \+\s*"[^"]*")*/,
      '$1""',
    ),
  );
  const r = run(dir, "stays");
  check("a guild seed with no consequence line fails", r.status === 1);
  check("and names the seed", r.out.includes('seed "stripe-webhook": has no consequence line'));
}

{
  const dir = brokenShared("guilds.ts", (s) =>
    s.replace(/(id: "stripe-webhook",[\s\S]*?undo:\s*)"[^"]*"/, '$1""'),
  );
  const r = run(dir, "stays");
  check("a guild seed with no undo line fails", r.status === 1);
}

{
  const dir = brokenShared("guilds.ts", (s) =>
    s.replace(/(id: "stripe-webhook",[\s\S]*?compost: )\[[\s\S]*?\],\n/, "$1[],\n"),
  );
  const r = run(dir, "stays");
  check("a guild seed with no compost steps fails", r.status === 1);
  check("and says so", r.out.includes('seed "stripe-webhook": has no compost steps'));
}

{
  const dir = brokenShared("guilds.ts", (s) =>
    s.replace(/(id: "stripe-webhook",[\s\S]*?checkKey: )"stripe-webhook"/, '$1"no-such-check"'),
  );
  const r = run(dir, "stays");
  check("a live check naming no real launch check fails", r.status === 1);
}

{
  // Another module's broken seed is not charged to this one.
  const dir = brokenShared("guilds.ts", (s) =>
    s.replace(/(id: "saberra-api-secret",[\s\S]*?undo:\s*)"[^"]*"/, '$1""'),
  );
  const r = run(dir, "stays");
  check("a broken seed in another module's guild is not charged here", r.status === 0);
}

console.log(failures === 0 ? `validate-module guild checks: ${assertions} passed` : `validate-module guild checks: ${failures} failure(s) of ${assertions}`);
process.exit(failures === 0 ? 0 : 1);
