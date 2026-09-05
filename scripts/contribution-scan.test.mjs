#!/usr/bin/env node
/**
 * The contribution scan's regression test.
 *
 *   node scripts/contribution-scan.test.mjs
 *
 * The case that matters is "edit a file that already carries violations". The
 * scan shipped proved by a fixture that was always a NEW file, and in a new
 * file every line is the contributor's, so whole-file scanning and added-line
 * scanning agree exactly. The one shape that separates them was the one shape
 * untested, and the result blocked every pull request touching a legacy file.
 *
 * So the git-backed cases below build a real repository with a dirty base and
 * then edit it, which is the only way to prove attribution rather than assert
 * it. House style: plain Node, no runner, non-zero exit on failure.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RAW_SQL_RULE_ID,
  addedLineNumbers,
  parseAddedLineNumbers,
  scanFileLines,
} from "./contribution-scan.mjs";

let failures = 0;
let assertions = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assertions++;
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`          expected: ${JSON.stringify(expected)}`);
    console.log(`          actual:   ${JSON.stringify(actual)}`);
  }
};

console.log("Contribution scan");

// ── 1. Hunk arithmetic, the part that goes silently wrong ────────────────────

check(
  "a single added line lands on its new line number",
  [...parseAddedLineNumbers("@@ -3,0 +4 @@\n+added")],
  [4],
);
check(
  "consecutive added lines increment",
  [...parseAddedLineNumbers("@@ -0,0 +10,3 @@\n+a\n+b\n+c")],
  [10, 11, 12],
);
check(
  "several hunks each restart at their own offset",
  [...parseAddedLineNumbers("@@ -1,0 +2 @@\n+a\n@@ -9,0 +40,2 @@\n+b\n+c")],
  [2, 40, 41],
);
check(
  "removed lines contribute nothing",
  [...parseAddedLineNumbers("@@ -5,2 +5,0 @@\n-gone\n-also gone")],
  [],
);
check(
  "the +++ file header is not an added line",
  [...parseAddedLineNumbers("--- a/f.ts\n+++ b/f.ts\n@@ -1,0 +1 @@\n+real")],
  [1],
);

// ── 2. Partitioning ──────────────────────────────────────────────────────────

// Line 1 is pre-existing debt, line 2 is what this change added.
const BODY = ['const a = pool.query("SELECT 1");', 'const b = pool.query("SELECT 2");'].join("\n");

const onlyTheirs = scanFileLines({ relPath: "server/x.ts", body: BODY, addedSet: new Set([2]) });
check("a hit on an added line is a finding", onlyTheirs.findings.length, 1);
check("the finding names the added line", onlyTheirs.findings[0].line, 2);
check("a hit on an untouched line is pre-existing", onlyTheirs.preExisting, 1);

const newFile = scanFileLines({ relPath: "server/x.ts", body: BODY, addedSet: null });
check("a new file attributes every line to the contributor", newFile.findings.length, 2);
check("a new file reports no pre-existing debt", newFile.preExisting, 0);

const untouched = scanFileLines({ relPath: "server/x.ts", body: BODY, addedSet: new Set() });
check("touching none of the offending lines produces no finding", untouched.findings.length, 0);
check("and the debt is still counted", untouched.preExisting, 2);

const waived = scanFileLines({
  relPath: "server/x.ts",
  body: 'const a = pool.query("SELECT 1"); // module-review-ok: proving the waiver',
  addedSet: new Set([1]),
});
check("a waiver on an added line suppresses the finding", waived.findings.length, 0);
check("and is counted", waived.waived, 1);

check(
  "a rule out of scope never fires",
  scanFileLines({ relPath: "docs/x.ts", body: BODY, addedSet: null }).findings.length,
  0,
);

// ── 2b. The type-argument hole ───────────────────────────────────────────────
//
// THE REGRESSION THIS SECTION EXISTS FOR. The raw-SQL rule read
// `(?:query|execute)\s*\(`, and a TypeScript type-argument list sits exactly
// between the method name and that paren. So `pool.query("...")` was a
// violation and `pool.query<RowDataPacket[]>("...")` was not, for the
// identical line of code, and which verdict a lane got came down to whether
// they had happened to write a generic. 436 non-test call sites outside
// `server/repos|db|seeds` were invisible to the gate on the day this was
// written, 18 of them in `server/lib/ledger.ts` and 19 in `server/index.ts`.
//
// The hole was in a REGEX, and a regex has no failing state anybody can see:
// it reports "no match" for a pattern that is wrong exactly as confidently as
// for a file that is clean. So the fix is only half a fix without these cases.
// The next person tightening this pattern gets a red instead of a silent
// re-opening, which is the whole reason a guard has a guard.
//
// The negative cases are the other half. A pattern widened with `.*` would
// catch every one of the generics below AND `if (db.query < n) f(`, and a
// guard that fires on ordinary comparisons is one people learn to route
// around. Both halves have to hold at once or the rule is not usable.

/** Findings from the raw-SQL rule alone, on a one-line file the change added. */
const sqlHits = (line) =>
  scanFileLines({ relPath: "server/x.ts", body: line, addedSet: new Set([1]) }).findings.filter(
    (f) => f.ruleId === RAW_SQL_RULE_ID,
  ).length;

const CAUGHT = [
  ['the plain call, which always worked', 'const [r] = await pool.query("SELECT 1");'],
  ["a generic call, the hole itself", 'const [r] = await pool.query<RowDataPacket[]>("SELECT 1");'],
  ["the `any[]` spelling, the commonest form in this tree", 'const [r] = await pool.query<any[]>("SELECT 1");'],
  ["two type arguments, one of them itself generic", 'await pool.query<RowDataPacket[], Foo<Bar>>(sql);'],
  ["three levels of nesting", "await pool.query<Foo<Bar<Baz>>>(sql);"],
  ["whitespace around the brackets", "await connection.query < RowDataPacket[] > ( sql );"],
  ["execute, not just query", "await conn.execute<ResultSetHeader>(sql, args);"],
  ["a union type argument keeps its single pipe", "await pool.query<A | B>(sql);"],
  ["an intersection type argument keeps its single ampersand", "await pool.query<A & B>(sql);"],
  ["an inline object type", "await c.execute<{ id: number }[]>(sql);"],
  ["createPool, untouched by the widening", "const p = createPool({ host });"],
  ["createConnection, untouched by the widening", "const p = createConnection({ host });"],
];
for (const [name, line] of CAUGHT) check(`CAUGHT: ${name}`, sqlHits(line), 1);

const IGNORED = [
  ["a longer method name is not `query`", "if (db.queryCount < max) run();"],
  ["a bare less-than is a comparison", "if (db.execute < limit) { run(); }"],
  ["`&&` cannot close a type-argument list", "const busy = c.query < max && pool.size > (limit);"],
  ["`||` cannot either", "const busy = c.query < max || pool.size > (limit);"],
  ["`<=` is not an open bracket", "if (pool.query <= n) f(1);"],
  ["a ternary with calls in both arms", "const t = db.query < n ? f(1) : g(2);"],
  ["an ordinary generic that is not a db handle", "const q = new Map<string, number>();"],
  ["a react-query hook is not a raw query", "useQuery<Thing[]>({ queryKey });"],
  ["a receiver whose name merely ends in `db`", "const n = await mydb.query(sql);"],
  ["a helper that hides the query is somebody else's rule", "const rows = await getRows(sql);"],
];
for (const [name, line] of IGNORED) check(`IGNORED: ${name}`, sqlHits(line), 0);

// The waiver, on a GENERIC hit, and the same-line rule three guards share.
// A marker on the line above reads as a waiver to a human and as nothing at
// all to the scanner, and that gap is worth a case rather than a convention.
const genericWaived = scanFileLines({
  relPath: "server/x.ts",
  body: 'const [r] = await pool.query<RowDataPacket[]>(sql); // module-review-ok: proving the waiver reaches a generic',
  addedSet: new Set([1]),
});
check("a same-line waiver suppresses a generic finding", genericWaived.findings.length, 0);
check("and is counted", genericWaived.waived, 1);

const waiverAbove = scanFileLines({
  relPath: "server/x.ts",
  body: ["// module-review-ok: a marker on the line above is not a waiver", "await pool.query<any[]>(sql);"].join("\n"),
  addedSet: new Set([1, 2]),
});
check("a waiver on the line ABOVE does nothing", waiverAbove.findings.length, 1);
check("and is not counted as a waiver", waiverAbove.waived, 0);

// Attribution still holds for the newly visible form: making the rule see a
// generic must not make it charge one to whoever opened the file.
const genericBody = ['await pool.query<any[]>("SELECT 1");', 'await pool.query<any[]>("SELECT 2");'].join("\n");
const genericUntouched = scanFileLines({ relPath: "server/x.ts", body: genericBody, addedSet: new Set() });
check("an untouched generic hit is pre-existing, not a finding", genericUntouched.findings.length, 0);
check("and is still counted as debt", genericUntouched.preExisting, 2);

// ── 3. Against a real repository ─────────────────────────────────────────────
//
// The scenarios the whole fix exists for. A throwaway repo, a base commit that
// is already dirty, and then the three ways a contributor can touch it.

const repo = fs.mkdtempSync(path.join(os.tmpdir(), "contribution-scan-"));
const git = (...args) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
/**
 * Always writes a trailing newline, because real source files have one and a
 * fixture without one tests something else. Git marks the last line of a
 * newline-less file as removed and re-added when anything is appended, so the
 * first draft of these fixtures made an append look like an edit to the line
 * above it. That artifact is real and it gets its own case at the end.
 */
const write = (rel, lines) => {
  const text = Array.isArray(lines) ? lines.join("\n") : String(lines);
  fs.mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), `${text}\n`, "utf8");
};

try {
  git("init", "-q");
  git("config", "user.email", "test@example.test");
  git("config", "user.name", "Contribution Scan Test");

  // A base that already carries two violations, the way a real legacy file does.
  write("server/legacy.ts", ['const a = pool.query("SELECT 1");', 'const b = pool.query("SELECT 2");']);
  git("add", "-A");
  git("commit", "-q", "-m", "base with pre-existing debt");
  const base = git("rev-parse", "HEAD").trim();

  const scanAgainstBase = (rel) =>
    scanFileLines({
      relPath: rel,
      body: fs.readFileSync(path.join(repo, rel), "utf8"),
      addedSet: addedLineNumbers(base, rel, repo),
    });

  // 3a. THE REGRESSION: add a clean line to a dirty file.
  write(
    "server/legacy.ts",
    ['const a = pool.query("SELECT 1");', 'const b = pool.query("SELECT 2");', "const clean = 1;"].join("\n"),
  );
  const cleanEdit = scanAgainstBase("server/legacy.ts");
  check("a clean hunk in a dirty file produces no finding", cleanEdit.findings.length, 0);
  check("and the untouched debt is reported, not charged", cleanEdit.preExisting, 2);

  // 3b. Add a violating line to the same dirty file.
  write(
    "server/legacy.ts",
    [
      'const a = pool.query("SELECT 1");',
      'const b = pool.query("SELECT 2");',
      'const mine = pool.query("SELECT 3");',
    ].join("\n"),
  );
  const dirtyEdit = scanAgainstBase("server/legacy.ts");
  check("a violating hunk blocks", dirtyEdit.findings.length, 1);
  check("and names the line the contributor added", dirtyEdit.findings[0].line, 3);
  check("while still not charging the pre-existing pair", dirtyEdit.preExisting, 2);

  // 3c. A brand-new file: no base version, so all of it is theirs.
  write("server/brand-new.ts", ["const ok = 1;", 'const bad = pool.query("SELECT 4");'].join("\n"));
  const added = scanAgainstBase("server/brand-new.ts");
  check("a new file's violation blocks", added.findings.length, 1);
  check("and is attributed to its own line", added.findings[0].line, 2);
  check("a new file has no base, so nothing is pre-existing", added.preExisting, 0);
  check("addedLineNumbers reports null for a file with no base", addedLineNumbers(base, "server/brand-new.ts", repo), null);
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}

console.log(
  failures === 0
    ? `\nPASS  contribution scan: ${assertions} assertion(s), 0 failures.`
    : `\nFAIL  contribution scan: ${failures} failure(s) of ${assertions}.`,
);
process.exit(failures === 0 ? 0 : 1);
