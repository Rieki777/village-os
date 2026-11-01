#!/usr/bin/env node
/**
 * A MIGRATION MAY ONLY CALL A FUNCTION THAT HAS ALREADY RUN ON PRODUCTION.
 *
 * WHY THIS GATE EXISTS, with the date and the log line. On 2026-11-01 batch 74
 * merged, the deploy failed after 15.5 minutes, and the Railway log said:
 *
 *     FAIL: 0298_a_season_goal_keeps_its_name.sql
 *       -> FUNCTION railway.SHA1 does not exist (statement 7 of 8)
 *
 * SHA1() is built into MySQL. It is not available on the engine Amora runs, and
 * NOTHING in this repository could have said so, because the one gate that
 * executes migrations, scripts/check-migration-compat.mjs, applies them to the
 * mysql:8 service container in CI, where SHA1 works. The whole stack was green
 * on a file production refuses. Statements 1 to 6 had already applied, so the
 * instance was left with six of eight statements done, recorded in
 * `_migrations_partial`, and no version of the app that would boot.
 *
 * THE RULE IS AN ALLOW-LIST, AND IT HAD TO BE. A deny-list of "functions we
 * know are missing" fails open by construction: the next unportable name is one
 * nobody has written down yet, which is exactly how this one arrived. An
 * allow-list fails closed. A new name is a one-line, deliberate edit here with
 * a reason, and until somebody makes it, CI is red instead of the deploy.
 *
 * WHERE THE LIST COMES FROM, which is the part that makes it evidence and not
 * taste. Every name in PORTABLE below appears in a migration that HAS RUN on
 * the production database. That is not an argument about standards, it is the
 * strongest portability proof available: the engine has already executed it.
 * Measured on 2026-11-01 across all 214 migrations: 53 distinct identifiers are
 * called, 52 of them first appear at or below 0297 (production's high-water
 * mark), and exactly ONE first appears above it. That one is SHA1, and it is
 * the one that failed. The list is therefore the complete set of proven names,
 * and the defect is its only exclusion.
 *
 * WHAT IT SCANS, and why it counts more than function calls. The pattern is
 * IDENT followed by an open bracket, which also catches type names (varchar(40))
 * and keywords that take brackets (KEY, VALUES, IF). Narrowing it to "things
 * that look like functions" would mean deciding in advance which names matter,
 * and SHA1 would have passed any such filter as an obvious builtin. So
 * everything callable is listed, type names included. A longer list is the
 * price of a pattern that cannot be talked out of a hit.
 *
 * WHAT IT CANNOT CATCH. It reads text, not behaviour. A function that exists on
 * both engines and MEANS something different (LPAD truncating as well as
 * padding, which this repository has already been bitten by) is invisible here
 * and is check-migration-compat's phase 3, which runs the SQL on rows. It also
 * says nothing about a function called from application code: this is the
 * migration path only, because that is the path that runs before anything can
 * answer a healthcheck.
 *
 * Usage:
 *   node scripts/check-migration-sql.mjs
 *   node scripts/check-migration-sql.mjs --list     print every name in use
 *   node scripts/check-migration-sql.mjs --json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "drizzle");

/** The runner's own discovery regex, copied from discoverMigrations. */
const DISCOVERABLE = /^\d{4}.*\.sql$/;

/**
 * EVERY IDENTIFIER CALLED WITH BRACKETS THAT HAS RUN ON PRODUCTION.
 *
 * Adding a name here is a claim that the production engine can run it. The only
 * claim this gate accepts as proof is that a migration containing it has
 * already applied there; anything newer than production's high-water mark is a
 * guess, and 0298 is what a guess costs. If you need a function nobody has run
 * yet, compute it in TypeScript instead -- see server/lib/seasonGoalIds.ts,
 * which is 0298's backfill after this rule was written.
 */
const PORTABLE = new Set([
  // Keywords and clauses that take brackets.
  "AS", "CHECK", "ENUM", "EXISTS", "FROM", "IN", "JOIN", "KEY", "NOT", "OR", "VALUES", "WHERE",
  // Type names.
  "CHAR", "DATETIME", "DECIMAL", "TIMESTAMP", "TINYINT", "VARCHAR",
  // Index, constraint and table names this repository declares inline.
  "IX_ENTITY", "IX_MODULE", "MODULE_ENTITY_FACTS", "UQ_MODULE_RECORD", "FAUCET",
  // Conditionals and null handling.
  "COALESCE", "IF", "NULLIF", "GREATEST",
  // Strings.
  "CONCAT", "LEFT", "LENGTH", "LOWER", "LPAD", "REPLACE", "SUBSTRING", "SUBSTRING_INDEX", "TRIM",
  // Numbers and aggregates.
  "COUNT", "MAX", "MIN", "ROUND", "SUM",
  // Dates. CURRENT_TIMESTAMP and UTC_TIMESTAMP appear both bare and called.
  "CURRENT_TIMESTAMP", "DATE_ADD", "DATE_FORMAT", "UTC_TIMESTAMP",
  // Casting.
  "CAST", "CONVERT",
  // JSON.
  "JSON_EXTRACT", "JSON_OBJECT", "JSON_REMOVE", "JSON_SEARCH", "JSON_UNQUOTE",
]);

/**
 * Names this gate refuses by name as well as by absence, so the error says what
 * happened rather than only that something is unlisted. A measured failure, not
 * a policy opinion.
 */
const KNOWN_MISSING = new Map([
  [
    "SHA1",
    "answered `FUNCTION railway.SHA1 does not exist` on production on 2026-11-01 and failed the deploy, " +
      "while CI's mysql:8 accepted it. Compute the digest in TypeScript (server/lib/seasonGoalIds.ts).",
  ],
]);

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const asList = argv.includes("--list");

/**
 * Comment lines are stripped exactly as server/db/migrate.ts strips them --
 * but BLANKED rather than removed, so a reported line number is the line in
 * the file. Dropping them shifts every number after the header by the length
 * of the header, and these headers run to thirty lines: the first version of
 * this script pointed at 0298:14, which is prose, for a defect on line 45.
 */
function statementsOf(sql) {
  return sql
    .split(/\r?\n/)
    .map((line) => (/^\s*--/.test(line) ? "" : line))
    .join("\n");
}

/** Every called identifier in a body, upper-cased, with the line it sits on. */
function callsIn(body) {
  const out = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    for (const m of lines[i].matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      out.push({ name: m[1].toUpperCase(), line: i + 1 });
    }
  }
  return out;
}

if (!fs.existsSync(DIR)) {
  console.error(`::error::no drizzle/ directory at ${DIR}. This script is run from the repo root.`);
  process.exit(1);
}

const files = fs.readdirSync(DIR).filter((f) => DISCOVERABLE.test(f)).sort();

// A gate whose "found nothing" and "read nothing" print the same line is not a
// gate. 214 files on 2026-11-01; an empty directory is a broken checkout.
if (files.length === 0) {
  console.error(`::error::no discoverable migrations in ${DIR}. Nothing was scanned, so nothing was checked.`);
  process.exit(1);
}

const used = new Map();
const offences = [];
for (const file of files) {
  const body = statementsOf(fs.readFileSync(path.join(DIR, file), "utf-8"));
  for (const { name, line } of callsIn(body)) {
    if (!used.has(name)) used.set(name, []);
    used.get(name).push(`${file}:${line}`);
    if (!PORTABLE.has(name)) offences.push({ file, line, name, why: KNOWN_MISSING.get(name) ?? null });
  }
}

if (asList) {
  for (const name of [...used.keys()].sort()) {
    const uses = used.get(name);
    console.log(`${PORTABLE.has(name) ? "ok  " : "NEW "} ${name}  (${uses.length} use(s), first ${uses[0]})`);
  }
  process.exit(0);
}

if (offences.length > 0) {
  const names = [...new Set(offences.map((o) => o.name))];
  console.error(
    `::error::${offences.length} call(s) to ${names.length} name(s) no migration has ever run on production: ` +
      `${names.join(", ")}.`,
  );
  for (const o of offences) {
    console.error(`    drizzle/${o.file}:${o.line}  ${o.name}`);
    if (o.why) console.error(`      ${o.name} ${o.why}`);
  }
  console.error("");
  console.error("  CI applies migrations to a mysql:8 service container, which accepts far more than the");
  console.error("  production engine does, so a green compat run says nothing about this. 0298 passed every");
  console.error("  gate in the repository and took Amora down for 15.5 minutes.");
  console.error("  Either compute the value in TypeScript and run it at boot (server/lib/seasonGoalIds.ts is");
  console.error("  the worked example), or add the name to PORTABLE in this script with the evidence that");
  console.error("  production has already run it.");
  if (asJson) {
    console.log(JSON.stringify({ files: files.length, names: [...used.keys()].sort(), offences, ok: false }, null, 2));
  }
  process.exit(1);
}

if (asJson) {
  console.log(
    JSON.stringify(
      { files: files.length, distinct: used.size, names: [...used.keys()].sort(), offences: [], ok: true },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(
  `  ${files.length} migrations call ${used.size} distinct name(s), every one of them already run on production`,
);
