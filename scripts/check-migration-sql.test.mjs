#!/usr/bin/env node
/**
 * The guard's own guard, in the style of scripts/check-migration-numbers.test.mjs:
 * a real fixture directory, the real script, real exit codes.
 *
 * check-migration-sql.mjs computes its own ROOT from its own file location
 * (import.meta.url), not from process.cwd(), so a fixture cannot point the real
 * script at a scratch drizzle/ with a flag. Every case below copies the real
 * script's current bytes into a throwaway directory's own scripts/, next to
 * that directory's own drizzle/, and runs it there with plain node, as CI does.
 *
 * WHAT MATTERS MOST HERE IS THE CONTROL. A gate that cannot be shown to go red
 * is not a gate, and this one guards a defect that already cost a 15.5 minute
 * outage: scripts/check-migration-compat.mjs was green on the same file, on a
 * real MySQL, because CI's engine has SHA1 and production's does not. So the
 * first case puts SHA1 back and demands exit 1 with SHA1 named.
 *
 * Run: node scripts/check-migration-sql.test.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPT = path.join(HERE, "check-migration-sql.mjs");
const REAL_DRIZZLE = path.join(HERE, "..", "drizzle");

let failures = 0;
let assertions = 0;
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

console.log("check-migration-sql: the guard's own regression test\n");

/** A throwaway directory with the real script copied into its own scripts/. */
function makeFixture(files) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "check-migration-sql-"));
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(repo, "drizzle"), { recursive: true });
  fs.copyFileSync(REAL_SCRIPT, path.join(repo, "scripts", "check-migration-sql.mjs"));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(repo, "drizzle", name), body);
  }
  return repo;
}

function run(repo, args = []) {
  const r = spawnSync("node", [path.join(repo, "scripts", "check-migration-sql.mjs"), ...args], {
    cwd: repo,
    encoding: "utf-8",
    shell: false,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function runJson(repo, args = []) {
  const r = run(repo, [...args, "--json"]);
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* left null; the status assertion explains the failure */
  }
  return { ...r, json };
}

const cleanup = (repo) => fs.rmSync(repo, { recursive: true, force: true });

/* ------------------------------------------------------------------ *
 * 1. THE CONTROL. The exact defect that shipped must come back red.
 * ------------------------------------------------------------------ */
{
  const repo = makeFixture({
    "0001_portable.sql": "ALTER TABLE `t` ADD COLUMN `c` varchar(40) NULL;\n",
    "0002_the_defect.sql":
      "-- A thirty line header, abbreviated, so the reported line number has\n" +
      "-- something to be wrong about.\n" +
      "--\n" +
      "UPDATE `t` SET `c` = CONCAT('g', LEFT(LOWER(SHA1(TRIM(`words`))), 11)) WHERE `c` IS NULL;\n",
  });
  try {
    const r = runJson(repo);
    check("the shipped defect exits 1", r.status, 1);
    checkTrue("SHA1 is named in the error", /SHA1/.test(r.stderr), r.stderr.split("\n")[0]);
    checkTrue(
      "the error carries the measured evidence, not just 'unlisted'",
      /FUNCTION railway\.SHA1 does not exist/.test(r.stderr),
    );
    check(
      "the offence names the file and the SHA1 call",
      r.json?.offences?.map((o) => [o.file, o.name]),
      [["0002_the_defect.sql", "SHA1"]],
    );
    // The line number must be the line in the FILE. The first version of this
    // script stripped comment lines before counting and pointed at prose.
    check("the reported line is the line in the file", r.json?.offences?.[0]?.line, 4);
  } finally {
    cleanup(repo);
  }
}

/* ------------------------------------------------------------------ *
 * 2. A tree that only calls proven names passes.
 * ------------------------------------------------------------------ */
{
  const repo = makeFixture({
    "0001_types_and_keywords.sql":
      "CREATE TABLE `t` (`id` int NOT NULL, `c` varchar(40) NULL, `d` decimal(12,2) NULL, PRIMARY KEY (`id`));\n",
    "0002_functions.sql":
      "UPDATE `t` SET `c` = CONCAT(TRIM(`c`), LOWER(LEFT(`c`, 3))) WHERE COALESCE(`c`, '') <> '';\n" +
      "INSERT INTO `t` (`id`, `c`) VALUES (1, CAST(UTC_TIMESTAMP() AS char));\n",
  });
  try {
    const r = runJson(repo);
    check("a tree of proven names exits 0", r.status, 0);
    check("no offences", r.json?.offences, []);
    checkTrue("it says how many files it read", /2 migrations/.test(run(repo).stdout), run(repo).stdout.trim());
  } finally {
    cleanup(repo);
  }
}

/* ------------------------------------------------------------------ *
 * 3. ANY unlisted name is refused, not only the one that bit us. This is
 *    what makes it an allow-list rather than a deny-list of one.
 * ------------------------------------------------------------------ */
{
  const repo = makeFixture({
    "0001_a_new_one.sql": "UPDATE `t` SET `c` = UUID_SHORT() WHERE `c` IS NULL;\n",
  });
  try {
    const r = runJson(repo);
    check("an unlisted name with no recorded history exits 1", r.status, 1);
    check("it is named", r.json?.offences?.map((o) => o.name), ["UUID_SHORT"]);
    checkTrue(
      "with no measured evidence it still says what to do instead",
      /compute the value in TypeScript/i.test(r.stderr),
    );
  } finally {
    cleanup(repo);
  }
}

/* ------------------------------------------------------------------ *
 * 4. A comment may say anything. Only statements are scanned.
 * ------------------------------------------------------------------ */
{
  const repo = makeFixture({
    "0001_comment_only.sql":
      "-- This file used to call SHA1(TRIM(`x`)) and the comment still says so,\n" +
      "-- because that history is worth keeping. Nothing below calls it.\n" +
      "ALTER TABLE `t` ADD COLUMN `c` varchar(40) NULL;\n",
  });
  try {
    const r = runJson(repo);
    check("SHA1 named only in a comment is not an offence", r.status, 0);
    checkTrue("and SHA1 is not reported as used", !(r.json?.names ?? []).includes("SHA1"), JSON.stringify(r.json?.names));
  } finally {
    cleanup(repo);
  }
}

/* ------------------------------------------------------------------ *
 * 5. An empty drizzle/ is a broken checkout, not a pass. A gate whose
 *    "read nothing" and "found nothing" print the same thing is not a gate.
 * ------------------------------------------------------------------ */
{
  const repo = makeFixture({});
  try {
    const r = run(repo);
    check("an empty drizzle/ exits 1", r.status, 1);
    checkTrue("and says nothing was scanned", /Nothing was scanned/.test(r.stderr), r.stderr.trim());
  } finally {
    cleanup(repo);
  }
}

/* ------------------------------------------------------------------ *
 * 6. A file the runner would never apply is not scanned, because it never
 *    runs. The discovery regex is the runner's own.
 * ------------------------------------------------------------------ */
{
  const repo = makeFixture({
    "notes_about_sha1.sql": "UPDATE `t` SET `c` = SHA1(`x`);\n",
    "0001_real.sql": "ALTER TABLE `t` ADD COLUMN `c` varchar(40) NULL;\n",
  });
  try {
    const r = runJson(repo);
    check("an undiscoverable file is not scanned", r.status, 0);
    check("one file read", r.json?.files, 1);
  } finally {
    cleanup(repo);
  }
}

/* ------------------------------------------------------------------ *
 * 7. THE REAL TREE. The rule is only true of this repository if it holds
 *    against this repository's own 214 migrations, so assert that here too
 *    rather than only against fixtures.
 * ------------------------------------------------------------------ */
{
  const r = spawnSync("node", [REAL_SCRIPT, "--json"], { encoding: "utf-8", shell: false });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* the status assertion explains it */
  }
  check("this repository's own migrations pass", r.status, 0);
  // A floor, so a scan that silently read nothing cannot pass as a clean one.
  checkTrue(
    "and it really read the tree (200+ files, 40+ distinct names)",
    (json?.files ?? 0) >= 200 && (json?.distinct ?? 0) >= 40,
    `${json?.files} files, ${json?.distinct} names`,
  );
  checkTrue(
    "SHA1 appears nowhere in a statement in drizzle/",
    !(json?.names ?? ["SHA1"]).includes("SHA1"),
  );
  checkTrue("drizzle/ is where it looked", fs.existsSync(REAL_DRIZZLE));
}

console.log(
  failures === 0
    ? `\nPASS  check-migration-sql: ${assertions} assertion(s), 0 failures.`
    : `\nFAIL  check-migration-sql: ${failures} failure(s) of ${assertions}.`,
);
process.exit(failures === 0 ? 0 : 1);
