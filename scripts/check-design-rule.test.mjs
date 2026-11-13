/**
 * check-design-rule.mjs, run for real against a fixture: it goes red on each
 * kind of off-rule class, stays green on the sheet's own vocabulary and on a
 * waived line, ignores comments, and refuses a journey page with no world.
 *
 * Run: node scripts/check-design-rule.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-design-rule.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "design-rule-"));

function run(body, { page = false } = {}) {
  const rel = "client/src/pages/Fixture.tsx";
  fs.mkdirSync(path.join(root, "client/src/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
  const r = spawnSync(process.execPath, [SCRIPT, "--root", root, "--files", rel, "--pages", page ? rel : "none"], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

const ok = (cls) => `export const A = () => <div className="${cls}" />;\n`;

// Green: the sheet's own vocabulary.
for (const cls of [
  "rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8",
  "text-xs font-semibold uppercase tracking-widest text-notice",
  "jw-btn inline-flex min-h-11 rounded-xl bg-notice text-background hover:bg-notice/90",
  "rounded-lg border border-border bg-teal-deep text-white hover:bg-teal-deep-dark",
  "rounded-full border-2 border-notice text-open bg-destructive/10 font-display",
  "min-h-[4.5rem] max-w-[66ch]",
]) {
  const r = run(ok(cls));
  assert.strictEqual(r.code, 0, `expected green for "${cls}":\n${r.out}`);
}

// Red: one of each rule.
for (const [cls, rule] of [
  ["text-stone-600", "palette"],
  ["hover:bg-red-50", "palette"],
  ["text-sage", "tone"],
  ["bg-cream", "tone"],
  ["bg-white", "tone"],
  ["focus-visible:ring-teal-deep", "tone"],
  ["bg-[#ffffff]", "colour"],
  ["font-serif", "font"],
  ["rounded-md", "radius"],
  ["rounded-t-[14px]", "radius"],
  ["shadow-lg", "shadow"],
  ["text-[11px]", "type"],
  ["tracking-[0.14em]", "type"],
]) {
  const r = run(ok(cls));
  assert.strictEqual(r.code, 1, `expected red for "${cls}"`);
  assert.ok(r.out.includes(`[${rule}] ${cls}`), `expected [${rule}] ${cls} in:\n${r.out}`);
}

// A comment is not a class, on one line or across several.
assert.strictEqual(run(`// text-stone-600 shadow-lg\n/* bg-cream\n rounded-md */\n${ok("bg-card")}`).code, 0);

// A waiver on the line passes and is counted.
const w = run(`export const A = () => <div className="shadow-lg" />; // design-ok: a lifted dialog\n`);
assert.strictEqual(w.code, 0, w.out);
assert.ok(w.out.includes("1 waiver(s)"), w.out);

// A journey page must stand in the world.
const bare = run(ok("bg-card"), { page: true });
assert.strictEqual(bare.code, 1);
assert.ok(bare.out.includes("[world]"), bare.out);
const world = run(`import { WORLD } from "@/components/journey/look";\nexport const A = () => <div className={WORLD} />;\n`, { page: true });
assert.strictEqual(world.code, 0, world.out);

fs.rmSync(root, { recursive: true, force: true });
console.log("check-design-rule self-test: ok");
