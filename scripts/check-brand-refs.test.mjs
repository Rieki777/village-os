/**
 * The guard's own guard.
 *
 * Two bugs made check-brand-refs report a different answer for the same
 * commit depending on the machine it ran on, and both were invisible because
 * the script only ever printed a number nobody could check:
 *
 *   1. CRLF. JavaScript's dot excludes the carriage return, so an anchored
 *      line-comment rule never reached the end of a line on a Windows
 *      checkout and NO comment was stripped. Every comment naming the
 *      village counted as code, and the baseline could never match its tree.
 *   2. Protocols. A URL contains a double slash, so the old rule cut the
 *      line there and any name after it became invisible. 41 real
 *      references hid behind that.
 *
 * The fixtures use a placeholder token, never a real village name: these
 * functions are about telling code from commentary and know nothing about
 * which words are banned. This file also lives in a ratchet zone, where a
 * new file's allowance is zero.
 *
 * Run: node scripts/check-brand-refs.test.mjs
 */
import assert from "node:assert";
import { cutLineComment, stripComments } from "./brand-strip.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Stands in for whatever a fork puts in BANNED. */
const TOKEN = /\bvillagename/i;
let run = 0;
const check = (name, fn) => { fn(); run += 1; console.log(`  PASS  ${name}`); };

console.log("\ncheck-brand-refs: telling code from commentary\n");

check("strips a line comment", () => {
  assert.strictEqual(cutLineComment("const a = 1; // villagename"), "const a = 1; ");
});

check("KEEPS a URL that merely contains a double slash", () => {
  const line = 'const u = "https://villagename.example/x";';
  assert.strictEqual(cutLineComment(line), line);
  assert.ok(TOKEN.test(stripComments(line, ".ts")), "a name inside a URL must stay visible");
});

check("strips a comment that FOLLOWS a URL", () => {
  const line = 'const u = "https://example.test/x"; // villagename lives here';
  assert.strictEqual(cutLineComment(line), 'const u = "https://example.test/x"; ');
});

check("survives CRLF: the comment is still stripped", () => {
  const line = '  | "brand" // the overlay that renames a fork, villagename\r';
  assert.ok(!TOKEN.test(stripComments(line, ".ts")), "a CRLF comment must not count as code");
});

check("survives CRLF: a string is still COUNTED", () => {
  const line = '  const name = "villagename";\r';
  assert.ok(TOKEN.test(stripComments(line, ".ts")), "a CRLF code line must still count");
});

check("respects quotes of every flavour", () => {
  assert.strictEqual(cutLineComment("const a = '// not a comment';"), "const a = '// not a comment';");
  assert.strictEqual(cutLineComment("const a = `// not a comment`;"), "const a = `// not a comment`;");
});

check("handles an escaped quote inside a string", () => {
  const line = 'const a = "she said \\"//\\" out loud"; // villagename';
  assert.strictEqual(cutLineComment(line), 'const a = "she said \\"//\\" out loud"; ');
});

check("strips SQL comments, and only in SQL", () => {
  assert.ok(!TOKEN.test(stripComments("SELECT 1; -- villagename", ".sql")));
  assert.ok(TOKEN.test(stripComments("const a = 'x'; -- villagename", ".ts")), "a double dash is not a comment in TypeScript");
});

check("treats a JSDoc continuation as commentary", () => {
  assert.strictEqual(stripComments(" * built for villagename", ".ts"), "");
});


/*
 * THE PUBLISHER'S NAME AND ITS ATTRIBUTION LIST (readiness R063; the
 * coordinator, 2026-11-08): allowed only where the list names the file, up to
 * the count it gives, and never as cover for a village term. These spawn the
 * guard on the real tree with another list, the way ratchet-gates-go-red
 * drives it with another baseline. The name is assembled at run time, so this
 * file carries none of it.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const GUARD = path.join(HERE, "check-brand-refs.mjs");
const NAME = ["ReGen", "Civics"].join(" ");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "brand-attribution-"));
const guard = (...args) => {
  const r = spawnSync(process.execPath, [GUARD, ...args], { cwd: REPO, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
};
const listed = JSON.parse(guard("--list-attribution").out);
const withList = (list) => {
  const f = path.join(scratch, `list-${run}.json`);
  fs.writeFileSync(f, JSON.stringify(list));
  return guard("--attribution", f);
};

console.log("\ncheck-brand-refs: the publisher's name, only where ATTRIBUTION says\n");

check("the tree passes with the list in force", () => {
  const r = guard();
  assert.strictEqual(r.status, 0, r.out.slice(-800));
  assert.match(r.out, /line\(s\) name the publisher, in the \d+ file\(s\) ATTRIBUTION lists/);
});

check("with an empty list, every mention is a hit, in hard-clean and ratchet zones alike", () => {
  const r = withList({});
  assert.strictEqual(r.status, 1, r.out.slice(-800));
  assert.match(r.out, /shared\/regenFile\.ts .*HARD-CLEAN/);
  assert.match(r.out, /client\/src\/pages\/Feedback\.tsx .*baseline allows 0/);
});

check("a file naming the publisher more often than its entry allows fails, naming the entry", () => {
  const one = Object.keys(listed)[0];
  const r = withList({ ...listed, [one]: { ...listed[one], lines: listed[one].lines - 1 } });
  assert.strictEqual(r.status, 1, r.out.slice(-800));
  assert.ok(r.out.includes(`${one}: ${listed[one].lines} line(s) name the publisher, its ATTRIBUTION entry allows ${listed[one].lines - 1}`), r.out.slice(-800));
});

check("an entry whose file names the publisher nowhere fails as stale", () => {
  const r = withList({ ...listed, "shared/modules.ts": { lines: 1, why: "nothing" } });
  assert.strictEqual(r.status, 1, r.out.slice(-800));
  assert.match(r.out, /shared\/modules\.ts: listed for attribution, but no code line in it names the publisher/);
});

check("a listed file may name the publisher, and a village term on the same line still fails", () => {
  const probe = `shared/zz-brand-attribution-probe-${process.pid}.ts`;
  const abs = path.join(REPO, probe);
  try {
    fs.writeFileSync(abs, `export const by = "Village OS, published by ${NAME}";\n`);
    const ok = withList({ ...listed, [probe]: { lines: 1, why: "the probe" } });
    assert.strictEqual(ok.status, 0, `a listed publisher line failed:\n${ok.out.slice(-800)}`);
    const unlisted = withList(listed);
    assert.strictEqual(unlisted.status, 1, "the same line in an unlisted file passed");
    assert.ok(unlisted.out.includes(probe), unlisted.out.slice(-800));
    fs.writeFileSync(abs, `export const by = "${["am", "ora"].join("")} village, published by ${NAME}";\n`);
    const mixed = withList({ ...listed, [probe]: { lines: 1, why: "the probe" } });
    assert.strictEqual(mixed.status, 1, "a village term rode in on an attributed line");
    assert.ok(mixed.out.includes(`${probe} `), mixed.out.slice(-800));
  } finally {
    fs.rmSync(abs, { force: true });
  }
});

fs.rmSync(scratch, { recursive: true, force: true });

console.log(`\n${run} check(s) passed\n`);
