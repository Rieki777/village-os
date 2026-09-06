#!/usr/bin/env node
/**
 * The burn-down ratchet's own guard.
 *
 *   node scripts/sql-burndown.test.mjs
 *
 * A ratchet has exactly one job, which is to refuse, and a ratchet that has
 * never been seen to refuse is a JSON file with a comment on top. So the cases
 * below drive the REAL script over a fixture tree, through its own `--root`
 * and `--baseline` flags, rather than re-implementing its arithmetic here. A
 * copy of the logic would pass while the shipped logic failed, which is the
 * failure mode this file exists to make impossible.
 *
 * The case that matters most is `--update-baseline` refusing to RAISE. That is
 * the whole difference between a ratchet and a logbook: a number that can be
 * re-recorded upward whenever it goes red records history and enforces
 * nothing. `scripts/check-image-budget.mjs` and `scripts/check-village-facts.mjs`
 * both hold that line and both had it proved by a test; this one does too.
 *
 * The last section asserts against the COMMITTED register, not a fixture: its
 * counts must add up to its own declared total and to BURNDOWN_CEILING. That is
 * the case that catches a hand-edit, which is the way a list like this actually
 * gets loosened in practice.
 *
 * House style: plain Node, no runner, non-zero exit on failure.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CODE_RULES, RAW_SQL_RULE_ID } from "./contribution-scan.mjs";
import {
  BASELINE_PATH,
  BURNDOWN_CEILING,
  auditBaseline,
  countsFor,
  isTestFile,
  main,
  rawSqlRule,
  readBaseline,
  runBurndown,
  totalOf,
} from "./sql-burndown.mjs";

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

/** Run the script's `main` with its output captured, so the log stays readable. */
const quietly = (argv) => {
  const log = console.log;
  const err = console.error;
  const said = [];
  console.log = (...a) => said.push(a.join(" "));
  console.error = (...a) => said.push(a.join(" "));
  try {
    return { code: main(argv), said: said.join("\n") };
  } finally {
    console.log = log;
    console.error = err;
  }
};

console.log("Raw SQL burn-down");

// ── 1. The rule is the one place it is defined ───────────────────────────────

check("the register reads its rule from CODE_RULES", rawSqlRule().id, RAW_SQL_RULE_ID);
check(
  "a rule set without that id THROWS rather than measuring nothing",
  (() => {
    try {
      rawSqlRule(CODE_RULES.filter((r) => r.id !== RAW_SQL_RULE_ID));
      return "returned";
    } catch {
      return "threw";
    }
  })(),
  "threw",
);

// ── 2. The audit, on data alone ──────────────────────────────────────────────

const LISTED = { total: 5, counts: { "server/lib/a.ts": 3, "server/lib/b.ts": 2 }, entries: {} };

const clean = auditBaseline({ "server/lib/a.ts": 3, "server/lib/b.ts": 2 }, LISTED, 5);
check("an unchanged tree raises nothing", [clean.grown, clean.unexpected, clean.stale, clean.declared, clean.ceiling], [[], [], [], null, null]);

const grew = auditBaseline({ "server/lib/a.ts": 4, "server/lib/b.ts": 2 }, LISTED, 5);
check("a listed file that gained a call site is GROWN", grew.grown, [{ file: "server/lib/a.ts", found: 4, allowed: 3 }]);

const fresh = auditBaseline({ "server/lib/a.ts": 3, "server/lib/b.ts": 2, "server/lib/new.ts": 1 }, LISTED, 5);
check("a file that is not in the register at all is UNEXPECTED", fresh.unexpected, [{ file: "server/lib/new.ts", found: 1 }]);

const fell = auditBaseline({ "server/lib/a.ts": 1, "server/lib/b.ts": 2 }, LISTED, 5);
check("a listed file that lost call sites is STALE, so the fall gets written down", fell.stale, [
  { file: "server/lib/a.ts", found: 1, listed: 3 },
]);

const cleared = auditBaseline({ "server/lib/b.ts": 2 }, LISTED, 5);
check("a file burned all the way down is STALE at zero", cleared.stale, [{ file: "server/lib/a.ts", found: 0, listed: 3 }]);

const handEdited = auditBaseline({ "server/lib/a.ts": 3, "server/lib/b.ts": 2 }, { ...LISTED, total: 99 }, 5);
check("a declared total that disagrees with its own counts is caught", handEdited.declared, { listed: 5, declared: 99 });

const drifted = auditBaseline({ "server/lib/a.ts": 3, "server/lib/b.ts": 2 }, LISTED, 4);
check("a ceiling that disagrees with the register is caught", drifted.ceiling, { listed: 5, ceiling: 4 });

// ── 3. Against a real tree ───────────────────────────────────────────────────

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sql-burndown-"));
const baselineFile = path.join(root, "register.json");
const write = (rel, lines) => {
  const full = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${Array.isArray(lines) ? lines.join("\n") : lines}\n`, "utf8");
};

try {
  // THE POINT OF THE WHOLE CHANGE: the register counts the GENERIC form. If the
  // pattern ever loses its type-argument list again, this file reads as clean
  // and the ratchet holds a number that means nothing.
  write("server/lib/legacy.ts", [
    'const a = await pool.query<RowDataPacket[]>("SELECT 1");',
    'const b = await pool.query<any[]>("SELECT 2");',
    'const c = await pool.query("SELECT 3");',
  ]);
  // Out of the rule's scope entirely: this is where raw SQL belongs.
  write("server/repos/proper.ts", ['const r = await pool.query<RowDataPacket[]>("SELECT 4");']);
  // In the rule's scope, out of the REGISTER: a test asserting a row is the
  // test doing its job, and there is no repo to route it through.
  write("server/legacy.test.ts", ['const t = await pool.query<any[]>("SELECT 5");']);
  // A same-line waiver keeps a line out of the register, the way it keeps it
  // out of a finding.
  write("server/lib/waived.ts", ['const w = await pool.query<any[]>("SELECT 6"); // module-review-ok: proving the waiver']);
  // Ordinary code that a naive widening would have swept in.
  write("client/src/fine.ts", ["const busy = c.query < max && pool.size > (limit);", "const m = new Map<string, number>();"]);

  const first = countsFor(root);
  check("the register counts generic and plain call sites alike", first.counts["server/lib/legacy.ts"], 3);
  check("server/repos is out of scope and contributes nothing", first.counts["server/repos/proper.ts"], undefined);
  check("a test file is out of the register", first.counts["server/legacy.test.ts"], undefined);
  check("a same-line waiver keeps a line out of the register", first.counts["server/lib/waived.ts"], undefined);
  check("and the waiver is counted, not hidden", first.waived, 1);
  check("ordinary comparisons contribute nothing", first.counts["client/src/fine.ts"], undefined);
  check("the register total is the sum of its counts", totalOf(first.counts), 3);
  check("the rule itself still covers test files", CODE_RULES.find((r) => r.id === RAW_SQL_RULE_ID).scope("server/legacy.test.ts"), true);
  check("while the register does not", isTestFile("server/legacy.test.ts"), true);

  // 3a. Seeding. The one write allowed to be a rise.
  const seeded = quietly(["--root", root, "--baseline", baselineFile, "--update-baseline"]);
  check("seeding a register that does not exist yet is allowed", seeded.code, 0);
  check("and it records the measured total", readBaseline(baselineFile).total, 3);
  const seededOn = readBaseline(baselineFile).entries["server/lib/legacy.ts"].since;

  // 3b. A clean run against the register it just wrote.
  const green = runBurndown({ root, baselinePath: baselineFile, ceiling: null });
  check("the gate passes against its own register", green.refusals, []);

  // 3c. THE CASE THIS FILE EXISTS FOR: --update-baseline refuses to RAISE.
  write("server/lib/legacy.ts", [
    'const a = await pool.query<RowDataPacket[]>("SELECT 1");',
    'const b = await pool.query<any[]>("SELECT 2");',
    'const c = await pool.query("SELECT 3");',
    'const d = await pool.query<RowDataPacket[]>("SELECT 7");',
  ]);
  const raise = quietly(["--root", root, "--baseline", baselineFile, "--update-baseline"]);
  check("--update-baseline REFUSES to raise the total", raise.code, 1);
  check("and says which way the number is allowed to move", raise.said.includes("only ever falls"), true);
  check("and leaves the register on disk untouched", readBaseline(baselineFile).total, 3);

  const blocked = runBurndown({ root, baselinePath: baselineFile, ceiling: null });
  check("the gate refuses the grown file", blocked.result.grown, [{ file: "server/lib/legacy.ts", found: 4, allowed: 3 }]);
  check("and names it in a sentence a human can act on", blocked.refusals[0].includes("MORE raw SQL"), true);

  // 3d. A brand-new file carrying raw SQL is a NEW violation, not debt.
  write("server/lib/legacy.ts", [
    'const a = await pool.query<RowDataPacket[]>("SELECT 1");',
    'const b = await pool.query<any[]>("SELECT 2");',
    'const c = await pool.query("SELECT 3");',
  ]);
  write("server/lib/brandnew.ts", ['const n = await pool.query<any[]>("SELECT 8");']);
  const added = runBurndown({ root, baselinePath: baselineFile, ceiling: null });
  check("a file absent from the register is a NEW violation", added.result.unexpected, [
    { file: "server/lib/brandnew.ts", found: 1 },
  ]);
  check("and the message says the register does not grow", added.refusals[0].includes("does not grow"), true);
  const raiseAgain = quietly(["--root", root, "--baseline", baselineFile, "--update-baseline"]);
  check("--update-baseline will not absorb a new file either", raiseAgain.code, 1);
  fs.rmSync(path.join(root, "server", "lib", "brandnew.ts"));

  // 3e. A fall is recorded, and only downward.
  write("server/lib/legacy.ts", ['const c = await pool.query("SELECT 3");']);
  const stale = runBurndown({ root, baselinePath: baselineFile, ceiling: null });
  check("a fall nobody wrote down is itself a refusal", stale.result.stale, [
    { file: "server/lib/legacy.ts", found: 1, listed: 3 },
  ]);
  check("and the message says it is good news", stale.refusals[0].includes("Good news"), true);
  const lowered = quietly(["--root", root, "--baseline", baselineFile, "--update-baseline"]);
  check("--update-baseline accepts a fall", lowered.code, 0);
  check("and writes the lower number", readBaseline(baselineFile).total, 1);
  check("keeping the date the entry was first recorded", readBaseline(baselineFile).entries["server/lib/legacy.ts"].since, seededOn);
  check("the gate is green again", runBurndown({ root, baselinePath: baselineFile, ceiling: null }).refusals, []);

  // 3f. A walk that finds nothing must never read as a clean tree.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "sql-burndown-empty-"));
  try {
    const nothing = runBurndown({ root: empty, baselinePath: baselineFile, ceiling: null });
    check("zero scannable files is a REFUSAL, never a pass", nothing.refusals.length, 1);
    check("and says so in those terms", nothing.refusals[0].includes("Refusing to report a pass"), true);
    check("with no audit result to mistake for one", nothing.result, null);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

// ── 4. The COMMITTED register ────────────────────────────────────────────────
//
// Not a fixture. A hand-edit is how a list like this actually gets loosened,
// and the three numbers that have to agree are the register's counts, the
// register's own `total` field, and the constant in the script. Two of them
// agreeing proves nothing.

const committed = readBaseline(BASELINE_PATH);
check("the committed register's counts add up to its declared total", totalOf(committed.counts), committed.total);
check("and to BURNDOWN_CEILING", committed.total, BURNDOWN_CEILING);
check("every entry carries the date it was first recorded", Object.keys(committed.counts).every((k) => !!committed.entries?.[k]?.since), true);
check("and no entry sits at zero, which would be an allowance for nothing", Object.values(committed.counts).every((n) => n > 0), true);

console.log(
  failures === 0
    ? `\nPASS  raw SQL burn-down: ${assertions} assertion(s), 0 failures.`
    : `\nFAIL  raw SQL burn-down: ${failures} failure(s) of ${assertions}.`,
);
process.exit(failures === 0 ? 0 : 1);
