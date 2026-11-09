/**
 * The hardcoded-English ratchet's own test (internal spec i18n, US6.1, §8 R13, R14).
 *
 * Unit cases run `copyHits` on small sources; the end-to-end cases spawn the
 * real script against a scratch tree with its own baseline, never this repo.
 *
 * Run: node scripts/check-i18n-ratchet.test.mjs
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyHits } from "./check-i18n-ratchet.mjs";

const SCRIPT = fileURLToPath(new URL("./check-i18n-ratchet.mjs", import.meta.url));
let run = 0;
const check = (name, fn) => { fn(); run += 1; console.log(`  PASS  ${name}`); };
const kinds = (src) => copyHits(src, "x.tsx").map((h) => h.kind);

check("JSX text with letters counts once per element, however it is split", () => {
  assert.deepEqual(kinds(`export const A = () => <p>Hello there {name}, welcome back</p>;`), ["jsx-text"]);
  assert.deepEqual(kinds(`export const A = () => <div><p>One</p><p>Two</p></div>;`), ["jsx-text", "jsx-text"]);
});

check("punctuation, numbers and whitespace alone are not copy", () => {
  assert.deepEqual(kinds(`export const A = () => <p>{a} · {b} / 12 — ( )</p>;`), []);
});

check("copy props count; class names, ids and test hooks do not", () => {
  assert.deepEqual(kinds(`export const A = () => <input placeholder="Your name" aria-label="Name" title="Name" alt="x y" />;`), ["prop", "prop", "prop", "prop"]);
  assert.deepEqual(kinds(`export const A = () => <div className="flex gap-2" id="main" data-testid="Big Box" href="/a b" />;`), []);
});

check("a template literal sentence counts once, not once per piece", () => {
  assert.deepEqual(kinds("export const A = ({n}) => <b aria-label={`Your account, ${n} and more`} />;"), ["prop"]);
});

check("toast, confirm and alert messages count", () => {
  assert.deepEqual(kinds(`toast.success("Saved your work"); toast("Done"); window.confirm("Delete it?"); alert("Oops"); toast.error(err.message);`), ["call", "call", "call", "call"]);
});

check("English plural hacks count (R14)", () => {
  assert.deepEqual(kinds('const s = `${n} vote${n === 1 ? "" : "s"}`;'), ["plural-hack"]);
});

check("anything inside Lingui macros is translated, so it does not count", () => {
  const src = `import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
const M = msg\`Saved\`;
export const A = () => { const { t } = useLingui(); return <p title={t\`Close menu\`}><Trans>Hello <b>there</b> {name}</Trans></p>; };`;
  assert.deepEqual(kinds(src), []);
});

check("a Trans that is NOT the Lingui one gives no exemption", () => {
  const src = `import { Trans } from "./elsewhere";
export const A = () => <p><Trans>Hello there</Trans></p>;`;
  assert.deepEqual(kinds(src), ["jsx-text"]);
});

check("an i18n-ok waiver on the line or the line above exempts one hit", () => {
  assert.deepEqual(kinds(`export const A = () => <p>Village OS</p>; // i18n-ok: product name`), []);
  assert.deepEqual(kinds(`// i18n-ok: product name\nexport const A = () => <p>Village OS</p>;`), []);
});

check("t called at module scope is flagged: it never switches language (R13)", () => {
  const src = `import { t } from "@lingui/core/macro";\nconst LABEL = t\`Save\`;`;
  assert.deepEqual(kinds(src), ["module-scope-t"]);
});

function tree(files, baseline) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-ratchet-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  if (baseline) {
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "i18n-ratchet-baseline.json"), JSON.stringify(baseline));
  }
  return dir;
}
const runOn = (dir, ...args) => spawnSync(process.execPath, [SCRIPT, "--root", dir, ...args], { encoding: "utf8" });

check("end to end: at the baseline passes; one new English string fails, naming the file and line", () => {
  const files = { "client/src/pages/Home.tsx": `export const A = () => <p>Old text</p>;\n` };
  const dir = tree(files, { "client/src/pages/Home.tsx": 1 });
  assert.equal(runOn(dir).status, 0);
  fs.appendFileSync(path.join(dir, "client/src/pages/Home.tsx"), `export const B = () => <p>Hello there</p>;\n`);
  const r = runOn(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /client\/src\/pages\/Home\.tsx.*1 -> 2/);
  assert.match(r.stdout + r.stderr, /Home\.tsx:2/);
});

check("end to end: a new file with English fails; test files are not scanned", () => {
  const dir = tree({ "client/src/New.tsx": `export const A = () => <p>Hi there</p>;\n`, "client/src/New.test.tsx": `<p>Test words</p>` }, {});
  const r = runOn(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /New\.tsx/);
  assert.doesNotMatch(r.stdout + r.stderr, /New\.test\.tsx/);
});

check("end to end: --update-baseline only lowers; raising needs --force", () => {
  const dir = tree({ "client/src/A.tsx": `export const A = () => <div><p>One</p><p>Two</p></div>;\n` }, { "client/src/A.tsx": 1 });
  assert.equal(runOn(dir, "--update-baseline").status, 1);
  fs.writeFileSync(path.join(dir, "client/src/A.tsx"), `export const A = () => <div />;\n`);
  assert.equal(runOn(dir, "--update-baseline").status, 0);
  const written = JSON.parse(fs.readFileSync(path.join(dir, "scripts/i18n-ratchet-baseline.json"), "utf8"));
  assert.deepEqual(written, {}, "a file at zero leaves the baseline");
});

console.log(`check-i18n-ratchet: ${run} checks passed`);
