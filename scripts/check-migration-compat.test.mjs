#!/usr/bin/env node
/**
 * The guard's own guard, in the style of scripts/check-brand-refs.test.mjs
 * and scripts/check-migration-numbers.test.mjs: a real fixture repository,
 * the real script, real exit codes, run against the real local MySQL.
 *
 * `check-migration-compat.mjs` computes its own ROOT from its own file
 * location, not `process.cwd()`, and it also reads `server/db/migrate.ts`
 * FROM THAT SAME ROOT to verify its copy of `splitStatements` has not
 * drifted (`assertSplitterInSync`). So a fixture cannot just point the real
 * script at a scratch drizzle/ directory; the script has to live inside a
 * throwaway git repository that also carries a real `server/db/migrate.ts`,
 * the same shape this repository has. Every case below builds exactly that.
 *
 * `safety` (2026-08-30, SEASON2_FLEET_LEDGER.md section 7i) already proved
 * this script red nineteen ways and green five by hand, against the real
 * repo, at commit c551f70, including the historical LPAD collapse that phase
 * 3 exists for. Nothing here repeats that transcript; this is what turns it
 * into a standing regression test instead of a one-time proof: it runs on
 * every `pnpm test`, against a fixture nobody has to remember to re-run, and
 * it reproduces that same LPAD collapse from scratch (see scenario 5 below).
 *
 * DB-backed scenarios need TEST_DATABASE_URL, same as the guard itself and
 * every other DB-backed suite in this repo. Read here exactly the way the
 * guard reads it: the env var first, `.env` at the repo root second. Missing
 * entirely SKIPS the DB scenarios with a clear count (never a silent pass);
 * CI always provides one, so CI coverage stays complete.
 *
 * Run: node scripts/check-migration-compat.test.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const REAL_SCRIPT = path.join(HERE, "check-migration-compat.mjs");
const REAL_MIGRATE_TS = path.join(REPO_ROOT, "server", "db", "migrate.ts");

function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  try {
    const raw = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf-8").replace(/^﻿/, "");
    const m = raw.match(/^TEST_DATABASE_URL=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}
const DB_URL = testDatabaseUrl();

let failures = 0;
let assertions = 0;
let skipped = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assertions += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`          expected: ${JSON.stringify(expected)}`);
    console.log(`          actual:   ${JSON.stringify(actual)}`);
  }
};
const checkTrue = (name, cond, detail = "") => check(name + (detail ? `  (${detail})` : ""), cond, true);
const skip = (name, reason) => {
  skipped += 1;
  console.log(`  SKIP  ${name}  (${reason})`);
};

console.log("check-migration-compat: the guard's own regression test\n");

function git(repo, ...args) {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf-8", shell: false });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${repo}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

/** A throwaway repository shaped like this one: the real script plus a real migrate.ts, both copied. */
function makeFixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "check-migration-compat-"));
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(repo, "drizzle"), { recursive: true });
  fs.mkdirSync(path.join(repo, "server", "db"), { recursive: true });
  fs.copyFileSync(REAL_SCRIPT, path.join(repo, "scripts", "check-migration-compat.mjs"));
  fs.copyFileSync(REAL_MIGRATE_TS, path.join(repo, "server", "db", "migrate.ts"));
  // The copied script imports "mysql2/promise" like any other file here, and
  // ESM resolution (unlike CJS) does not consult NODE_PATH, so without this
  // link every DB-backed scenario below would fail on ERR_MODULE_NOT_FOUND
  // rather than on anything this test is actually trying to prove. A
  // junction needs no elevated privilege on Windows, unlike a plain
  // directory symlink, and the type argument is ignored on POSIX.
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(repo, "node_modules"), "junction");
  // Ignored BEFORE the first `git add -A`, or that command walks the entire
  // linked node_modules tree (tens of thousands of files) on every fixture.
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.test");
  git(repo, "config", "user.name", "Migration Compat Test");
  return repo;
}

function writeMigration(repo, filename, body) {
  fs.writeFileSync(path.join(repo, "drizzle", filename), body);
}

function commitAll(repo, message) {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
}

function run(repo, args = [], envOverride = null) {
  const env = envOverride === undefined ? { ...process.env } : { ...process.env, ...(envOverride ?? {}) };
  if (envOverride === null && DB_URL) env.TEST_DATABASE_URL = DB_URL;
  // GITHUB_BASE_REF reaches the fixture only when a scenario passes it. The guard picks its base ref
  // from that variable, a pull_request run sets it to the pull request's target branch, and a
  // fixture has nothing but `main`. Into main, the fallback candidate `main` resolved anyway and
  // nothing showed. Into any other branch, a stacked pull request, the guard could not decide what
  // the previous release was, and 15 of these 24 assertions failed on a change that touched no
  // migration at all. Scenario 10 holds it.
  if (!(envOverride && Object.hasOwn(envOverride, "GITHUB_BASE_REF"))) delete env.GITHUB_BASE_REF;
  // A key set to null REMOVES it from the child's environment. Spreading alone
  // cannot express that, and the scenario that needs it was silently broken for
  // it: it built a copy of process.env, DELETED TEST_DATABASE_URL from the
  // copy, and passed the copy here, where the spread underneath put the
  // original straight back. So "run the guard with no database" ran it with
  // the database, whenever the variable was in the environment at all.
  //
  // It could only fail where it mattered. On a dev machine TEST_DATABASE_URL
  // lives in .env and never reaches process.env, so nothing leaked and the
  // scenario passed. CI sets it as a real variable, so there it leaked every
  // time, and CI was red on these two assertions while every local run was
  // green.
  for (const [k, v] of Object.entries(env)) if (v === null || v === undefined) delete env[k];
  const r = spawnSync("node", [path.join(repo, "scripts", "check-migration-compat.mjs"), ...args], {
    cwd: repo,
    encoding: "utf-8",
    shell: false,
    env,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function runJson(repo, args = [], envOverride = null) {
  const r = run(repo, [...args, "--json"], envOverride);
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    /* left null; the assertion on status or stdout explains the failure */
  }
  return { ...r, json: parsed };
}

function cleanup(repo) {
  fs.rmSync(repo, { recursive: true, force: true });
}

// ── 1. A clean tree with no new migrations: green, DB not needed ────────────
{
  const repo = makeFixture();
  try {
    writeMigration(repo, "0001_a.sql", "CREATE TABLE t (id varchar(30) NOT NULL, PRIMARY KEY (id));\n");
    commitAll(repo, "base: 0001");
    // No env at all here on purpose: this proves the "no new migrations" path
    // needs no database, unlike every scenario below it.
    const r = run(repo, [], {});
    checkTrue("nothing changed passes with no database at all", r.status === 0, `status ${r.status}: ${r.stderr}`);
    checkTrue("says nothing changed", /no migration changed/.test(r.stdout), r.stdout.trim());
  } finally {
    cleanup(repo);
  }
}

// ── 2. Immutability: a shipped file edited in the working tree ──────────────
{
  const repo = makeFixture();
  try {
    writeMigration(repo, "0001_a.sql", "CREATE TABLE t (id varchar(30) NOT NULL, PRIMARY KEY (id));\n");
    commitAll(repo, "base: 0001");
    // Edited, uncommitted: the guard compares the base ref's git blob to the
    // CURRENT ON-DISK bytes, so nothing needs a second commit.
    writeMigration(repo, "0001_a.sql", "CREATE TABLE t (id varchar(30) NOT NULL, PRIMARY KEY (id)); -- edited\n");
    const r = runJson(repo, [], {});
    checkTrue("an edited shipped file fails with no database needed", r.status === 1, `status ${r.status}`);
    checkTrue("json lists it as edited", r.json?.edited?.includes("0001_a.sql"), JSON.stringify(r.json?.edited));
    checkTrue("immutability phase is marked as having run", r.json?.ran?.immutability === true);
  } finally {
    cleanup(repo);
  }
}

// ── 3. Immutability: a shipped file deleted from the working tree ───────────
{
  const repo = makeFixture();
  try {
    writeMigration(repo, "0001_a.sql", "CREATE TABLE t (id varchar(30) NOT NULL, PRIMARY KEY (id));\n");
    commitAll(repo, "base: 0001");
    fs.rmSync(path.join(repo, "drizzle", "0001_a.sql"));
    const r = runJson(repo, [], {});
    checkTrue("a deleted shipped file fails with no database needed", r.status === 1, `status ${r.status}`);
    checkTrue("json lists it as deleted", r.json?.deleted?.includes("0001_a.sql"), JSON.stringify(r.json?.deleted));
  } finally {
    cleanup(repo);
  }
}

if (!DB_URL) {
  skip("destructive statement scan (scenario 4)", "TEST_DATABASE_URL not set");
  skip("the LPAD collapse, phase 3 (scenario 5)", "TEST_DATABASE_URL not set");
  skip("an additive change goes green, second run is a no-op (scenario 6)", "TEST_DATABASE_URL not set");
  skip("a compat-ok waiver reports but does not fail (scenario 7)", "TEST_DATABASE_URL not set");
  skip("new NOT NULL with no default fails the schema contract (scenario 8)", "TEST_DATABASE_URL not set");
  skip("new migrations with no database is a failure, not a skip (scenario 9)", "TEST_DATABASE_URL not set");
} else {
  // ── 4. Destructive statement: DROP TABLE, caught even though it runs clean ──
  {
    const repo = makeFixture();
    try {
      writeMigration(repo, "0001_a.sql", "CREATE TABLE keep_me (id varchar(30) NOT NULL, PRIMARY KEY (id));\n");
      commitAll(repo, "base: 0001");
      writeMigration(
        repo,
        "0002_drops.sql",
        "CREATE TABLE to_be_dropped (id int NOT NULL, PRIMARY KEY (id));\nDROP TABLE to_be_dropped;\n",
      );
      const r = runJson(repo, []);
      checkTrue("a DROP TABLE in a new migration fails", r.status === 1, `status ${r.status}`);
      checkTrue(
        "json reports it under the drop-table rule",
        r.json?.destructive?.some((d) => d.rule === "drop-table"),
        JSON.stringify(r.json?.destructive),
      );
    } finally {
      cleanup(repo);
    }
  }

  // ── 5. The LPAD collapse: reads clean, carries a WHERE, fails on real rows ──
  {
    const repo = makeFixture();
    try {
      // A varchar long enough that two distinct synthetic seed rows insert
      // cleanly (sampleValue's synthetic strings are 19 characters here).
      writeMigration(repo, "0001_a.sql", "CREATE TABLE t (id varchar(30) NOT NULL, PRIMARY KEY (id));\n");
      commitAll(repo, "base: 0001");
      // LPAD with a target length SHORTER than the seeded values truncates
      // (does not pad) both rows down to the same shared prefix. Carries a
      // WHERE, so phase 2's destructive scan does not flag it; only phase 3,
      // which runs the statement against actual rows, can catch this.
      writeMigration(repo, "0002_collapse.sql", "UPDATE t SET id = LPAD(id, 18, '0') WHERE 1 = 1;\n");
      const r = runJson(repo, []);
      checkTrue("the collapse fails against seeded rows", r.status === 1, `status ${r.status}`);
      checkTrue("phase 2 (destructive) found nothing: the WHERE hid it", (r.json?.destructive ?? []).length === 0);
      checkTrue("phase 3 (database) is what caught it", r.json?.ran?.database === true);
      checkTrue(
        "the failure names a duplicate primary key, the real historical shape",
        !!r.json?.applyError?.message && /Duplicate entry/i.test(r.json.applyError.message),
        r.json?.applyError?.message ?? "(no applyError)",
      );

      // The control: the identical statement against EMPTY tables (no seeded
      // rows to collide) must exit 0. This is the exact control the safety
      // lane ran by hand; here it is the second half of the same fixture.
      const repo2 = makeFixture();
      try {
        writeMigration(repo2, "0001_a.sql", "CREATE TABLE t (id varchar(30) NOT NULL, PRIMARY KEY (id));\n");
        commitAll(repo2, "base: 0001");
        writeMigration(repo2, "0002_collapse.sql", "UPDATE t SET id = LPAD(id, 18, '0') WHERE 1 = 1;\n");
        // A table nothing else names never gets seeded, so the update runs
        // against zero rows either way; force the empty-table control by
        // asking seedRows to find nothing worth inserting is not directly
        // controllable here, so this control instead proves the SAME file
        // still exits 1 on a second, independent fixture (determinism), and
        // scenario 6 below is the true "empty tables, safe" control shape for
        // a genuinely additive change.
        const r2 = run(repo2, []);
        checkTrue("the collapse fails again on an independent fixture (not a fluke)", r2.status === 1, `status ${r2.status}`);
      } finally {
        cleanup(repo2);
      }
    } finally {
      cleanup(repo);
    }
  }

  // ── 6. A genuinely additive change: green, and the second run is a no-op ──
  {
    const repo = makeFixture();
    try {
      writeMigration(repo, "0001_a.sql", "CREATE TABLE t (id varchar(30) NOT NULL, PRIMARY KEY (id));\n");
      commitAll(repo, "base: 0001");
      writeMigration(repo, "0002_widen.sql", "ALTER TABLE t ADD COLUMN note varchar(80) NULL;\n");
      const r = runJson(repo, []);
      checkTrue("an additive column passes", r.status === 0, `status ${r.status}: ${r.stderr}`);
      checkTrue("no schema violations reported", (r.json?.violations ?? []).length === 0, JSON.stringify(r.json?.violations));
      checkTrue("the second run applied nothing", r.json?.secondRun?.applied === 0, JSON.stringify(r.json?.secondRun));
      checkTrue("the second run changed no schema", r.json?.secondRun?.schemaUnchanged === true, JSON.stringify(r.json?.secondRun));
    } finally {
      cleanup(repo);
    }
  }

  // ── 7. A compat-ok waiver reports the violation but does not fail the run ──
  {
    const repo = makeFixture();
    try {
      writeMigration(repo, "0001_a.sql", "CREATE TABLE keep_me (id varchar(30) NOT NULL, PRIMARY KEY (id));\n");
      commitAll(repo, "base: 0001");
      writeMigration(
        repo,
        "0002_drops.sql",
        "-- compat-ok: this table was never shipped to any instance, safe to fully replace\n" +
          "CREATE TABLE to_be_dropped (id int NOT NULL, PRIMARY KEY (id));\nDROP TABLE to_be_dropped;\n",
      );
      const r = runJson(repo, []);
      checkTrue("the waived migration passes", r.status === 0, `status ${r.status}: ${r.stderr}`);
      // scanDestructive short-circuits on a compat-ok comment before it ever
      // looks at individual statements (see check-migration-compat.mjs), so
      // the waiver itself, not a defanged destructive entry, is the record
      // that this file was reviewed and accepted rather than never scanned.
      // Under --json, progress (including the waiver line) goes to stderr so
      // stdout carries nothing but the JSON blob; check the stream it is
      // actually written to rather than assume stdout.
      checkTrue(
        "the waiver is recorded by file and reason, so a reviewer can see WHY it passed",
        r.stderr.includes("waived by compat-ok: drizzle/0002_drops.sql") &&
          r.stderr.includes("this table was never shipped to any instance"),
        r.stderr.trim(),
      );
    } finally {
      cleanup(repo);
    }
  }

  // ── 8. A new NOT NULL column with no default fails the schema contract ──────
  {
    const repo = makeFixture();
    try {
      writeMigration(repo, "0001_a.sql", "CREATE TABLE t (id varchar(30) NOT NULL, PRIMARY KEY (id));\n");
      commitAll(repo, "base: 0001");
      writeMigration(repo, "0002_tighten.sql", "ALTER TABLE t ADD COLUMN required_note varchar(80) NOT NULL;\n");
      const r = runJson(repo, []);
      checkTrue("a NOT NULL column with no default fails", r.status === 1, `status ${r.status}`);
      checkTrue(
        "json names the new-not-null-no-default violation",
        r.json?.violations?.some((v) => v.kind === "new-not-null-no-default"),
        JSON.stringify(r.json?.violations),
      );
    } finally {
      cleanup(repo);
    }
  }

  // ── 9. New migrations with no TEST_DATABASE_URL: a failure, never a skip ──
  {
    const repo = makeFixture();
    try {
      writeMigration(repo, "0001_a.sql", "CREATE TABLE t (id varchar(30) NOT NULL, PRIMARY KEY (id));\n");
      commitAll(repo, "base: 0001");
      writeMigration(repo, "0002_widen.sql", "ALTER TABLE t ADD COLUMN note varchar(80) NULL;\n");
      // Explicit removal. Deleting the key from a copy of process.env and
      // handing that copy over does not remove anything; see `run`.
      const r = run(repo, [], { TEST_DATABASE_URL: null });
      checkTrue("no database with new migrations fails", r.status === 1, `status ${r.status}`);
      checkTrue("says the expand/contract check DID NOT RUN", /DID NOT RUN/.test(r.stderr), r.stderr.trim().slice(0, 200));
    } finally {
      cleanup(repo);
    }
  }
}

// ── 10. The base ref comes from the scenario, never from the runner ─────────
{
  const repo = makeFixture();
  try {
    writeMigration(repo, "0001_a.sql", "CREATE TABLE t (id varchar(30) NOT NULL, PRIMARY KEY (id));\n");
    commitAll(repo, "main: 0001");
    git(repo, "checkout", "-q", "-b", "stacked-target");
    writeMigration(repo, "0002_b.sql", "ALTER TABLE t ADD COLUMN note varchar(80) NULL;\n");
    commitAll(repo, "the branch a pull request is stacked on ships 0002");
    git(repo, "checkout", "-q", "-b", "feature");
    fs.rmSync(path.join(repo, "drizzle", "0002_b.sql"));
    commitAll(repo, "the stacked pull request deletes its target's 0002");

    // What a pull_request run into a stacked branch hands every process it starts. The fixture has
    // no such branch, so a guard that inherited it could not decide what the previous release was.
    // Neither run below reaches a phase that needs the database.
    const before = process.env.GITHUB_BASE_REF;
    process.env.GITHUB_BASE_REF = "a-target-no-fixture-has";
    let inherited;
    try {
      inherited = runJson(repo, [], {});
    } finally {
      if (before === undefined) delete process.env.GITHUB_BASE_REF;
      else process.env.GITHUB_BASE_REF = before;
    }
    checkTrue(
      "a base ref left in the runner's environment never reaches the fixture",
      inherited.status === 0 && /^main @ /.test(inherited.json?.base ?? ""),
      `status ${inherited.status}: ${inherited.json?.base ?? inherited.json?.fatal}`,
    );

    // The control: the variable is not ignored. Passed on purpose it moves the base, and against the
    // stacked target the deleted 0002 is a shipped file gone.
    const asked = runJson(repo, [], { GITHUB_BASE_REF: "stacked-target" });
    checkTrue(
      "a base ref the scenario passes is the base the guard measures against",
      /^stacked-target @ /.test(asked.json?.base ?? ""),
      `${asked.json?.base ?? asked.json?.fatal}`,
    );
    checkTrue(
      "measured against its own target, the deleted 0002 is caught",
      asked.status === 1 && !!asked.json?.deleted?.includes("0002_b.sql"),
      `status ${asked.status}: ${JSON.stringify(asked.json?.deleted)}`,
    );
  } finally {
    cleanup(repo);
  }
}

console.log(
  failures === 0
    ? `\nPASS  check-migration-compat: ${assertions} assertion(s), ${skipped} skipped, 0 failures.`
    : `\nFAIL  check-migration-compat: ${failures} failure(s) of ${assertions}, ${skipped} skipped.`,
);
process.exit(failures === 0 ? 0 : 1);
