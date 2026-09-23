#!/usr/bin/env node
/**
 * EXPAND, NEVER CONTRACT. A migration must leave the database runnable by the
 * release BEFORE it, so rolling one version back over an already migrated
 * database is safe.
 *
 * WHY THIS IS THE HIGHEST STAKES CHECK IN THE REPOSITORY. Thirteen founder
 * instances run one image. Migrations are applied AT BOOT, fail loud, by
 * server/db/migrate.ts. There is no separate migrate step and no approval
 * gate: the container starts, the schema changes, and the founder's village is
 * on the new schema whether or not the new code works. When it does not, the
 * only lever anybody has is to put the previous image back. That lever only
 * works if the previous release can still read and write the schema the new
 * migration produced. If it cannot, the rollback fails too, and the founder
 * has no working version at all.
 *
 * So a migration is allowed to ADD and forbidden to TAKE AWAY. Renames and
 * drops are done across two releases: release N adds the new thing and writes
 * to both, release N+1 (once N is proven) removes the old one. That is the
 * expand/contract rule, and this script is where it stops being a convention.
 *
 * THE ONE ESCAPE HATCH, and what it does not open. An inline
 * `-- compat-ok: <reason>` comment in a migration waives the destructive scan
 * for that file, and waives the schema contract when EVERY new migration in the
 * change carries one (the contract is a property of the schema the whole change
 * produces, so a violation cannot be attributed back to one file). It does NOT
 * waive immutability, and it does NOT waive the migration actually running: a
 * file that fails on a populated table fails here whatever comment it carries,
 * because that is not a policy judgement, it is the boot failure. For the same
 * reason it does not waive phase 5: a moment with no unique key is a boot
 * failure waiting for a deploy to be rolling, not a judgement about rollback.
 *
 * WHAT IT DOES, in five phases. Each one is reported separately, with its own
 * count, so no phase can go missing behind another phase's success.
 *
 *  1. IMMUTABILITY, from git alone. A migration file that exists at the base
 *     ref must be byte identical here, and none may be deleted. The applied
 *     ledger keys on FILENAME and stores no checksum, so an edited file is
 *     already recorded as applied on every running instance and its new body
 *     will never run there. Nothing reports that. Meanwhile a fresh instance
 *     gets the new body, and the two databases diverge permanently. The rule
 *     was written down in server/db/migrate.ts's own header and enforced by
 *     nothing.
 *
 *  2. DESTRUCTIVE STATEMENTS, read from the new files' text. This catches what
 *     the schema comparison in phase 4 structurally cannot see: a DROP TABLE
 *     followed by a CREATE TABLE of the same shape leaves the schema identical
 *     and the rows gone. Same for TRUNCATE, and for DELETE or UPDATE with no
 *     WHERE.
 *
 *  3. RUN IT ON ROWS. The base ref's migrations are applied to a scratch
 *     schema on a real MySQL, representative rows are inserted into every
 *     table the new migrations name, and only THEN are the new migrations
 *     applied. A migration that passes on an empty table and fails on a full
 *     one is the exact shape of the boot failure this fleet cannot afford, and
 *     it has happened here: a rename migration read correctly and then
 *     collapsed two periods onto one id on first run, because MySQL's LPAD
 *     truncates as well as pads.
 *
 *  4. THE SCHEMA CONTRACT. information_schema is captured before and after,
 *     and any difference that the PREVIOUS release cannot survive is a
 *     failure: a table or column that disappeared, a column that became NOT
 *     NULL, a type that narrowed, an enum value that vanished, a new UNIQUE
 *     index or FOREIGN KEY on a table that already existed, a new NOT NULL
 *     column with no default.
 *
 *  5. NO MOMENT WITHOUT A UNIQUE KEY, checked BETWEEN statements while phase 3
 *     applies them. Phases 3 and 4 both look at a file from the outside: does
 *     it apply, and what is the schema once it has. Neither can see a state
 *     that exists only part way through, and one of those states is a boot
 *     failure this fleet cannot afford.
 *
 *     Every upsert in this codebase is `INSERT ... ON DUPLICATE KEY UPDATE`.
 *     Swap a table's UNIQUE key in two statements, `DROP INDEX` and then
 *     `ADD UNIQUE KEY`, and between them the table has no unique key at all.
 *     Railway deploys by ROLLING: the old container serves while the new one
 *     boots and runs this file, so a write landing in that gap has nothing to
 *     collide on and INSERTs a duplicate. The `ADD` then fails, the container
 *     does not start, rolling the image back does not remove the row, and the
 *     next deploy fails the same way. Recovery is a hand DELETE in production.
 *
 *     So after every statement, any table that HAD a non-primary unique key
 *     before the change must still have one. Only those tables are watched: a
 *     table that never had one cannot lose it, and a table the change creates
 *     has no previous release reading it. The fix is one ALTER carrying both
 *     clauses, which MySQL applies together, leaving no moment between them.
 *
 *     Found on drizzle/0214 in September 2026, by a reviewer reading the file
 *     rather than by this script, which passed it. That is why it is here.
 *
 * BOTH SNAPSHOTS COME FROM ONE SERVER, which is what makes the comparison
 * trustworthy across engines. This machine runs MariaDB and CI runs MySQL 8,
 * and they disagree about how to render a type (`int(11)` against `int`) and
 * about what goes in EXTRA. None of that matters here, because every
 * difference this script reports is a difference between two states of the
 * SAME server. Dialect cancels.
 *
 * WHY "BECAME NOT NULL" IS A FAILURE EVEN WITH A DEFAULT. In most codebases
 * adding NOT NULL with a DEFAULT is safe for old code, because an INSERT that
 * omits the column takes the default. Not in this one. server/repos/store-db.ts
 * builds every INSERT naming EVERY column in the spec, so a key the caller did
 * not set arrives as an EXPLICIT NULL, and an explicit NULL is not an absent
 * column: the default never applies. That is already written up as a house trap
 * in CLAUDE.md and it is why two shipped routes could never once succeed. So a
 * column the previous release knows about must stay nullable if it was
 * nullable. A column the previous release does not know about is different, and
 * NOT NULL with a default is fine there, because the old INSERT does not name
 * it at all.
 *
 * WHAT THIS CANNOT CATCH. Stated plainly, so nobody rebuilds a bigger version
 * believing the bigger version was untried.
 *
 *  - MEANING. A migration that rewrites the VALUES in a column the previous
 *    release still reads, without changing the column, passes every phase here.
 *    Re-encoding a JSON blob, changing what a game_variables row means,
 *    renumbering ids: all invisible. Phase 3 proves the statements survive
 *    rows; it does not know what the rows are for.
 *  - THE FORWARD DIRECTION. Nothing here asks whether the NEW code works on the
 *    schema. That is what `pnpm test` and the boot are for.
 *  - THE PREVIOUS RELEASE'S CODE. This compares schemas, not behaviour. It
 *    never builds or boots the previous release, so a previous release that
 *    breaks for a reason with no schema signature is not covered. Booting the
 *    old image against the migrated schema is the stronger check and it costs a
 *    second full install and build; it belongs in the release workflow, on a
 *    tagged image, not on every push.
 *  - DEFAULTS AND TRIGGERS AS BEHAVIOUR. A changed DEFAULT on an existing
 *    column is reported only if it changes nullability or type. A migration
 *    that adds a trigger is not modelled at all.
 *  - COLLATION. A changed collation can change what a comparison returns
 *    without changing any of the fields compared here.
 *  - VILLAGE MIGRATIONS. A village's own 9000+ migrations are not in this
 *    repository and cannot be reasoned about from it.
 *  - THE SEEDED ROWS ARE SYNTHETIC. They are generated from column types, two
 *    per table, deliberately distinct from each other. They will catch a
 *    NOT NULL added to a populated table, a narrowing MODIFY, an UPDATE that
 *    collapses two rows onto one key. They will not catch a constraint that
 *    only real data violates. THE COUNT OF TABLES ACTUALLY SEEDED IS PRINTED
 *    ON EVERY RUN, including when it is zero, because "ran and found nothing"
 *    and "seeded nothing so found nothing" are different results.
 *
 * WHEN IT DOES NOT RUN. New migrations plus no database is a FAILURE, not a
 * skip: this exits 1 and says TEST_DATABASE_URL is missing. No new migrations
 * at all is a real pass and says so in those words. A base ref that will not
 * resolve is a failure. `actions/checkout@v4` clones at `fetch-depth: 1` by
 * default, which cannot resolve origin/main; the workflow sets `fetch-depth: 0`.
 *
 * Usage:
 *   node scripts/check-migration-compat.mjs
 *   node scripts/check-migration-compat.mjs --base origin/main
 *   node scripts/check-migration-compat.mjs --json
 *   node scripts/check-migration-compat.mjs --keep     leave the scratch schema for inspection
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "drizzle");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const asJson = has("--json");
const keepSchema = has("--keep");

/** Progress goes to stderr under --json, so stdout carries JSON and nothing else. */
const say = (...a) => (asJson ? console.error : console.log)(...a);

const report = {
  base: null,
  newMigrations: [],
  edited: [],
  deleted: [],
  unreadable: [],
  destructive: [],
  seeded: { tables: 0, rows: 0, refused: [] },
  applyError: null,
  gaps: [],
  violations: [],
  secondRun: null,
  ran: { immutability: false, destructive: false, database: false, gaps: false },
};
let failed = false;

function git(args, opts = {}) {
  // No shell. Git Bash on Windows rewrites the path half of `git show ref:path`
  // and the mangled call still exits 0 with plausible output.
  const r = spawnSync("git", args, { cwd: ROOT, shell: false, maxBuffer: 64 * 1024 * 1024, ...opts });
  return {
    ok: r.status === 0,
    out: r.stdout ?? Buffer.alloc(0),
    text: (r.stdout ? r.stdout.toString("utf-8") : "").trim(),
    err: (r.stderr ? r.stderr.toString("utf-8") : "").trim(),
  };
}

function die(message, ...detail) {
  console.error(`::error::${message}`);
  for (const d of detail) console.error(`  ${d}`);
  if (asJson) process.stdout.write(JSON.stringify({ ...report, ok: false, fatal: message }, null, 2) + "\n");
  process.exit(1);
}

/* ==================================================================== *
 * The statement splitter.
 *
 * A COPY of `splitStatements` in server/db/migrate.ts, because that file is
 * TypeScript and this is a plain .mjs guard that must run with no build step.
 * A copy that silently drifts from the original would make this whole gate
 * lie: it would be applying migrations by different rules than the boot does,
 * so a green run would say nothing about production.
 *
 * So the copy is fingerprinted. The original's source text is read back out of
 * server/db/migrate.ts on every run and hashed; if it has changed, this fails
 * and says to re-copy it. scripts/verify-migration-on-data.mjs holds a third
 * copy of the same eight lines with no such check, which is what made this
 * worth wiring.
 * ==================================================================== */

const SPLITTER_SHA = "025d5b8c6d1359ed";

function splitStatements(sql) {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  return withoutComments
    .split(/;\s*$/m)
    .map((chunk) => chunk.trim())
    .filter((s) => s.length > 0);
}

function assertSplitterInSync() {
  const src = path.join(ROOT, "server", "db", "migrate.ts");
  let text;
  try {
    text = fs.readFileSync(src, "utf-8");
  } catch (err) {
    die(`cannot read ${src} to check the statement splitter is still the one production uses`, String(err.message));
    return;
  }
  const m = text.replace(/\r\n/g, "\n").match(/export function splitStatements[\s\S]*?\n}\n/);
  if (!m) {
    die(
      "could not find splitStatements in server/db/migrate.ts",
      "This guard applies migrations with a copy of that function and verifies the copy is current.",
      "If the function was renamed or moved, update the matcher and SPLITTER_SHA in this file.",
    );
    return;
  }
  const sha = crypto.createHash("sha256").update(m[0].replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
  if (sha !== SPLITTER_SHA) {
    die(
      `server/db/migrate.ts splitStatements has changed (sha ${sha}, expected ${SPLITTER_SHA})`,
      "This guard splits migration SQL with a copy of that function so it can run without a build step.",
      "A drifted copy makes every result here a statement about rules production does not use.",
      "Re-copy the body into splitStatements() in this file and set SPLITTER_SHA to the sha above.",
    );
  }
}

/* ==================================================================== *
 * Phase 0: what is the previous release?
 * ==================================================================== */

function resolveBase() {
  const explicit = valueOf("--base");
  const candidates = explicit
    ? [explicit]
    : process.env.GITHUB_BASE_REF
      ? [`origin/${process.env.GITHUB_BASE_REF}`, process.env.GITHUB_BASE_REF]
      : ["origin/main", "main"];
  const head = git(["rev-parse", "HEAD"]);
  if (!head.ok) return { error: "not a git checkout (git rev-parse HEAD failed)" };
  const found = [];
  for (const ref of candidates) {
    if (!git(["rev-parse", "--verify", `${ref}^{commit}`]).ok) continue;
    const mb = git(["merge-base", "HEAD", ref]);
    if (mb.ok) found.push({ ref, sha: mb.text });
  }
  if (found.length === 0) return { error: `could not resolve any of: ${candidates.join(", ")}` };
  // THE NEWEST MERGE BASE WINS, not the first candidate that resolves. On a CI
  // runner only `origin/main` exists and the two are the same. On this machine,
  // where a dozen worktrees share one object store and nothing is pushed, the
  // local `main` runs AHEAD of `origin/main` (measured: 7 commits, 2026-08-30),
  // so taking the first match would compare against a release that is no longer
  // the one a rollback lands on, and would do it silently.
  let best = found[0];
  for (const c of found.slice(1)) {
    if (git(["merge-base", "--is-ancestor", best.sha, c.sha]).ok) best = c;
  }
  if (best.sha !== head.text) return best;
  const parent = git(["rev-parse", "--verify", "HEAD^{commit}^"]);
  if (!parent.ok) return { ref: `${best.ref} (root commit)`, sha: best.sha };
  // HEAD is the base branch, so the previous release is its first parent.
  return { ref: `${best.ref} (HEAD^)`, sha: parent.text };
}

/* ==================================================================== *
 * Phase 1: immutability.
 * ==================================================================== */

const DISCOVERABLE = /^\d{4}.*\.sql$/;

function migrationsAt(sha) {
  const tree = git(["ls-tree", "--name-only", sha, "drizzle/"]);
  if (!tree.ok) return null;
  return tree.text
    .split("\n")
    .map((l) => l.trim().replace(/^drizzle\//, ""))
    .filter((f) => DISCOVERABLE.test(f));
}

function bytesAt(sha, file) {
  const r = git(["show", `${sha}:drizzle/${file}`]);
  return r.ok ? { ok: true, out: r.out } : { ok: false, err: r.err };
}

/* ==================================================================== *
 * Phase 2: destructive statements.
 *
 * Every rule here names something the schema comparison cannot see, so this
 * is not a weaker duplicate of phase 4. A waiver is an inline comment
 * `-- compat-ok: <reason>` anywhere in the file, matching the `voice-ok` and
 * `save-ok` conventions elsewhere in this repo. The runner strips comment
 * lines before splitting, so a waiver never reaches the database.
 * ==================================================================== */

const DESTRUCTIVE = [
  {
    id: "drop-table",
    re: /\bDROP\s+TABLE\b/i,
    why: "the rows go with it, and a DROP followed by a CREATE of the same shape leaves the schema identical and the data gone",
  },
  {
    id: "drop-database",
    re: /\bDROP\s+(DATABASE|SCHEMA)\b/i,
    why: "a migration must never drop the database it is running in",
  },
  {
    id: "truncate",
    re: /\bTRUNCATE\b/i,
    why: "every row in the table, with no schema difference to show for it",
  },
  {
    id: "delete-without-where",
    re: /^\s*DELETE\s+FROM\s+[^;]*$/is,
    guard: (stmt) => !/\bWHERE\b/i.test(stmt),
    why: "a DELETE with no WHERE empties the table",
  },
  {
    id: "update-without-where",
    re: /^\s*UPDATE\s+/is,
    guard: (stmt) => !/\bWHERE\b/i.test(stmt),
    why: "an UPDATE with no WHERE rewrites every row, and phase 4 sees no schema change at all",
  },
  {
    id: "rename-table",
    re: /\b(RENAME\s+TABLE|ALTER\s+TABLE\s+\S+\s+RENAME)\b/i,
    why: "the previous release still selects from the old name",
  },
];

function scanDestructive(file, sql) {
  const found = [];
  if (/--\s*compat-ok\s*:/i.test(sql)) {
    const reason = (sql.match(/--\s*compat-ok\s*:\s*(.+)/i) || [])[1] || "";
    return { waived: reason.trim() || "(no reason given)", found };
  }
  for (const stmt of splitStatements(sql)) {
    for (const rule of DESTRUCTIVE) {
      if (!rule.re.test(stmt)) continue;
      if (rule.guard && !rule.guard(stmt)) continue;
      found.push({ file, rule: rule.id, why: rule.why, statement: stmt.replace(/\s+/g, " ").slice(0, 160) });
    }
  }
  return { waived: null, found };
}

/* ==================================================================== *
 * Phase 3 and 4: the database.
 * ==================================================================== */

function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  try {
    const raw = fs.readFileSync(path.join(ROOT, ".env"), "utf-8").replace(/^﻿/, "");
    const m = raw.match(/^TEST_DATABASE_URL=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

async function snapshot(conn, schema) {
  const [tables] = await conn.query(
    "SELECT TABLE_NAME n, TABLE_TYPE t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
    [schema],
  );
  const [columns] = await conn.query(
    "SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_DEFAULT d, IS_NULLABLE nul, DATA_TYPE dt, " +
      "CHARACTER_MAXIMUM_LENGTH clen, NUMERIC_PRECISION nprec, NUMERIC_SCALE nscale, COLUMN_TYPE ctype, EXTRA ex, " +
      "GENERATION_EXPRESSION gen, ORDINAL_POSITION pos " +
      "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION",
    [schema],
  );
  const [indexes] = await conn.query(
    "SELECT TABLE_NAME t, INDEX_NAME i, NON_UNIQUE nu, SEQ_IN_INDEX s, COLUMN_NAME c " +
      "FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
    [schema],
  );
  const [fks] = await conn.query(
    "SELECT CONSTRAINT_NAME k, TABLE_NAME t, COLUMN_NAME c, REFERENCED_TABLE_NAME rt, REFERENCED_COLUMN_NAME rc " +
      "FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL " +
      "ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION",
    [schema],
  );
  const cols = new Map();
  for (const r of columns) cols.set(`${r.t}.${r.c}`, r);
  const idx = new Map();
  for (const r of indexes) {
    const key = `${r.t}.${r.i}`;
    const e = idx.get(key) ?? { table: String(r.t), name: String(r.i), unique: Number(r.nu) === 0, cols: [] };
    e.cols.push(String(r.c));
    idx.set(key, e);
  }
  const fk = new Map();
  for (const r of fks) {
    const key = `${r.t}.${r.k}`;
    const e = fk.get(key) ?? { table: String(r.t), name: String(r.k), refs: String(r.rt), cols: [] };
    e.cols.push(String(r.c));
    fk.set(key, e);
  }
  return { tables: new Set(tables.map((r) => String(r.n))), cols, idx, fk };
}

/** Values of an enum(...) or set(...) COLUMN_TYPE, or null when it is neither. */
function enumValues(ctype) {
  const m = String(ctype || "").match(/^(?:enum|set)\((.*)\)$/i);
    if (!m) return null;
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

/**
 * Types a column may GROW into, in capacity order. Without these two ladders
 * every `int` to `bigint` and every `varchar` to `text` reads as a type change
 * and fails, and phase 4 has no per-violation escape hatch, so a gate that
 * blocks the safest widening there is would be a gate somebody deletes.
 */
const INT_LADDER = ["tinyint", "smallint", "mediumint", "int", "integer", "bigint"];
const TEXT_LADDER = ["char", "varchar", "tinytext", "text", "mediumtext", "longtext"];

function isWidening(a, b) {
  const da = String(a.dt).toLowerCase();
  const db = String(b.dt).toLowerCase();
  // An unsigned column that becomes signed loses its whole top half, whatever
  // else the change did.
  if (/unsigned/i.test(String(a.ctype)) && !/unsigned/i.test(String(b.ctype))) return false;
  if (da !== db) {
    const i = INT_LADDER.indexOf(da);
    const j = INT_LADDER.indexOf(db);
    if (i >= 0 && j >= 0) return j >= i;
    const k = TEXT_LADDER.indexOf(da);
    const l = TEXT_LADDER.indexOf(db);
    if (k >= 0 && l >= 0) return l >= k;
    return false;
  }
  const ea = enumValues(a.ctype);
  const eb = enumValues(b.ctype);
  if (ea && eb) return ea.every((v) => eb.includes(v));
  const ca = a.clen === null ? null : Number(a.clen);
  const cb = b.clen === null ? null : Number(b.clen);
  if (ca !== null && cb !== null && cb < ca) return false;
  // decimal(10,2) to decimal(10,4) READS as more precision and is a narrowing:
  // the scale grew out of the integer digits. Both halves have to hold.
  const pa = a.nprec === null ? null : Number(a.nprec);
  const pb = b.nprec === null ? null : Number(b.nprec);
  const sa = a.nscale === null ? null : Number(a.nscale);
  const sb = b.nscale === null ? null : Number(b.nscale);
  if (pa !== null && pb !== null) {
    if (pb < pa) return false;
    if (sa !== null && sb !== null && (sb < sa || pb - sb < pa - sa)) return false;
  }
  return true;
}

function diffContract(a, b) {
  const out = [];
  for (const t of a.tables) {
    if (!b.tables.has(t)) {
      out.push({ kind: "table-removed", at: t, why: "the previous release selects from it and gets a 1146" });
    }
  }
  for (const [key, ca] of a.cols) {
    const table = String(ca.t);
    if (!b.tables.has(table)) continue; // already reported as a table removal
    const cb = b.cols.get(key);
    if (!cb) {
      out.push({ kind: "column-removed", at: key, why: "the previous release names it in every SELECT and INSERT for that table" });
      continue;
    }
    if (String(ca.nul) === "YES" && String(cb.nul) === "NO") {
      out.push({
        kind: "column-tightened",
        at: key,
        why:
          "it was nullable and is now NOT NULL. server/repos/store-db.ts names every spec'd column on every " +
          "INSERT, so the previous release writes an EXPLICIT NULL here and the column's DEFAULT never applies",
      });
    }
    if (!isWidening(ca, cb)) {
      const ea = enumValues(ca.ctype);
      const eb = enumValues(cb.ctype);
      const lost = ea && eb ? ea.filter((v) => !eb.includes(v)) : [];
      out.push({
        kind: lost.length ? "enum-value-removed" : "column-narrowed",
        at: key,
        why: lost.length
          ? `the previous release still writes ${lost.map((v) => `'${v}'`).join(", ")}`
          : `${ca.ctype} became ${cb.ctype}, which the previous release's writes can overflow`,
      });
    }
  }
  for (const [key, cb] of b.cols) {
    if (a.cols.has(key)) continue;
    const table = String(cb.t);
    if (!a.tables.has(table)) continue; // a brand new table is invisible to the previous release
    const generated = String(cb.gen || "") !== "";
    const auto = /auto_increment/i.test(String(cb.ex || ""));
    if (String(cb.nul) === "NO" && cb.d === null && !generated && !auto) {
      out.push({
        kind: "new-not-null-no-default",
        at: key,
        why: "the previous release's INSERT into this table does not name the column and there is no default to fall back on",
      });
    }
  }
  for (const [key, ib] of b.idx) {
    if (a.idx.has(key)) continue;
    if (!a.tables.has(ib.table)) continue;
    if (!ib.unique) continue;
    out.push({
      kind: "new-unique-index",
      at: `${key} (${ib.cols.join(", ")})`,
      why: "the previous release does not know the pair must be unique and writes a duplicate",
    });
  }
  for (const [key, fb] of b.fk) {
    if (a.fk.has(key)) continue;
    if (!a.tables.has(fb.table)) continue;
    out.push({
      kind: "new-foreign-key",
      at: `${key} -> ${fb.refs} (${fb.cols.join(", ")})`,
      why: "the previous release writes rows in an order this constraint refuses",
    });
  }
  return out;
}

/** Tables a set of SQL files names, which is where rows are needed. */
function tablesTouched(sqls) {
  const found = new Set();
  const patterns = [
    /\bALTER\s+TABLE\s+`?([A-Za-z0-9_$]+)`?/gi,
    /\bUPDATE\s+`?([A-Za-z0-9_$]+)`?/gi,
    /\bINSERT\s+(?:IGNORE\s+)?INTO\s+`?([A-Za-z0-9_$]+)`?/gi,
    /\bDELETE\s+FROM\s+`?([A-Za-z0-9_$]+)`?/gi,
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+\S+\s+ON\s+`?([A-Za-z0-9_$]+)`?/gi,
    /\bRENAME\s+TABLE\s+`?([A-Za-z0-9_$]+)`?/gi,
  ];
  for (const sql of sqls) {
    for (const p of patterns) {
      p.lastIndex = 0;
      let m;
      while ((m = p.exec(sql)) !== null) found.add(m[1]);
    }
  }
  return [...found].sort();
}

/** One synthetic value for a column, distinct per row index. */
function sampleValue(col, i) {
  const dt = String(col.dt).toLowerCase();
  const len = col.clen === null ? null : Number(col.clen);
  const evs = enumValues(col.ctype);
  if (evs) return evs[Math.min(i, evs.length - 1)];
  if (/^(tinyint)$/.test(dt) && /tinyint\(1\)/i.test(String(col.ctype))) return i % 2;
  if (/int$/.test(dt)) return 900000 + i;
  if (/^(decimal|numeric|float|double)$/.test(dt)) return 1 + i;
  if (/^(date)$/.test(dt)) return `2020-01-0${i + 1}`;
  if (/^(datetime|timestamp)$/.test(dt)) return `2020-01-01 00:00:0${i}`;
  if (/^(time)$/.test(dt)) return `00:00:0${i}`;
  if (/^(year)$/.test(dt)) return 2020 + i;
  if (/blob|binary/.test(dt)) return Buffer.from(`probe${i}`);
  // A quoted string is itself valid JSON, and that is deliberate. MySQL 8
  // reports a JSON column as DATA_TYPE `json`; MariaDB reports the SAME column
  // as `longtext` with a `json_valid()` CHECK, and nothing in information_schema
  // distinguishes it from an ordinary longtext. So every unbounded text column
  // is seeded with a value that satisfies both readings. varchar and char, which
  // are the ones with a length to overflow, stay plain.
  const plain = `compat-probe-${col.t}-${col.c}-${i}`;
  if (/^(json|.*text)$/.test(dt)) return JSON.stringify(plain);
  return len && len < plain.length ? plain.slice(0, len) : plain;
}

async function seedRows(conn, snap, tables, log) {
  let seededTables = 0;
  let rows = 0;
  const refused = [];
  for (const table of tables) {
    if (!snap.tables.has(table)) continue;
    const cols = [...snap.cols.values()].filter(
      (c) => String(c.t) === table && String(c.gen || "") === "" && !/auto_increment/i.test(String(c.ex || "")),
    );
    if (cols.length === 0) {
      refused.push({ table, reason: "every column is generated or auto_increment" });
      continue;
    }
    let inserted = 0;
    let lastErr = null;
    for (let i = 0; i < 2; i += 1) {
      const names = cols.map((c) => `\`${c.c}\``).join(", ");
      const marks = cols.map(() => "?").join(", ");
      const values = cols.map((c) => sampleValue(c, i));
      try {
        await conn.query(`INSERT INTO \`${table}\` (${names}) VALUES (${marks})`, values);
        inserted += 1;
      } catch (err) {
        lastErr = err.message;
      }
    }
    if (inserted === 0) {
      refused.push({ table, reason: lastErr ?? "unknown" });
    } else {
      seededTables += 1;
      rows += inserted;
      if (inserted < 2) refused.push({ table, reason: `only ${inserted} of 2 rows: ${lastErr}` });
    }
  }
  log(`  seeded ${rows} row(s) across ${seededTables} of ${tables.length} table(s) the new migrations name`);
  return { tables: seededTables, rows, refused };
}

/**
 * Apply a list of migration files from a directory, recording each in
 * `_migrations_applied` exactly as server/db/migrate.ts does. Deliberately NOT
 * resumable: this is a scratch schema and a partial apply is a failure to
 * report, not a state to recover.
 */
async function applyFiles(conn, dir, files, afterStatement = null) {
  await conn.query(
    "CREATE TABLE IF NOT EXISTS `_migrations_applied` (" +
      "`filename` varchar(255) NOT NULL, " +
      "`applied_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, " +
      "PRIMARY KEY (`filename`))",
  );
  const [done] = await conn.query("SELECT filename FROM `_migrations_applied`");
  const already = new Set(done.map((r) => String(r.filename)));
  const applied = [];
  for (const file of files) {
    if (already.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf-8");
    const parts = splitStatements(sql);
    for (let i = 0; i < parts.length; i += 1) {
      try {
        await conn.query(parts[i]);
        if (afterStatement) await afterStatement(file, i + 1, parts.length);
      } catch (err) {
        return { applied, failure: { file, statement: i + 1, of: parts.length, message: err.message, sql: parts[i].replace(/\s+/g, " ").slice(0, 200) } };
      }
    }
    await conn.query("INSERT INTO `_migrations_applied` (filename) VALUES (?)", [file]);
    applied.push(file);
  }
  return { applied, failure: null };
}

/**
 * Which tables carry a unique key that is not the primary key, right now.
 *
 * One cheap read of information_schema, called after every statement, rather
 * than a whole `snapshot()`: this asks one question and a full capture of
 * every column and foreign key would be paid for once per statement to answer
 * it.
 */
async function tablesWithUniqueKey(conn, schema) {
  const [rows] = await conn.query(
    "SELECT DISTINCT TABLE_NAME n FROM information_schema.STATISTICS " +
      "WHERE TABLE_SCHEMA = ? AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'",
    [schema],
  );
  return new Set(rows.map((r) => String(r.n)));
}

/** The tables phase 5 watches: those that had a non-primary unique key before the change. */
function uniqueKeyTablesIn(snap) {
  const out = new Set();
  for (const e of snap.idx.values()) {
    if (e.unique && e.name !== "PRIMARY") out.add(String(e.table));
  }
  return out;
}

/* ==================================================================== *
 * Run.
 * ==================================================================== */

assertSplitterInSync();

const base = resolveBase();
if (base.error) {
  die(
    `cannot decide what the previous release is: ${base.error}`,
    "This gate compares the schema this branch produces with the schema the base ref produces.",
    "CI checks out with fetch-depth: 0. Locally: git fetch origin main",
  );
}
report.base = `${base.ref} @ ${base.sha.slice(0, 8)}`;
say(`  previous release: ${report.base}`);

const baseFiles = migrationsAt(base.sha);
if (!baseFiles) die(`could not list drizzle/ at ${base.sha}`);
const headFiles = fs.readdirSync(DIR).filter((f) => DISCOVERABLE.test(f)).sort();
const baseSet = new Set(baseFiles);
const headSet = new Set(headFiles);

// Phase 1.
report.ran.immutability = true;
for (const f of baseFiles) {
  if (!headSet.has(f)) {
    report.deleted.push(f);
    continue;
  }
  const was = bytesAt(base.sha, f);
  const now = fs.readFileSync(path.join(DIR, f));
  // Line endings are normalised: git may hand back LF where the checkout has
  // CRLF, and that difference never reaches the database.
  const norm = (b) => b.toString("utf-8").replace(/\r\n/g, "\n");
  /*
   * NOT BEING ABLE TO READ THE OLD VERSION IS NOT THE SAME FACT AS THE FILE
   * HAVING CHANGED, and this line used to say it was: a null fell straight
   * into `edited`, so any failure of `git show` printed "96 shipped migration
   * file(s) were edited", the most alarming sentence this script can produce,
   * about nothing at all.
   *
   * Measured on Windows in a worktree about 200 characters deep:
   *   fatal: failed to stat wrongsha:drizzle/0002_roles_and_cycles.sql:
   *   Filename too long
   * because `git show` resolves the rev/path ambiguity by stat-ing its
   * argument first, so cwd plus that argument has to fit in MAX_PATH. Only
   * the 16 shortest filenames survived, which made one environment failing
   * look like real, partial tampering.
   *
   * This script already argues the general form in scenario 9 of its own
   * regression test: an unrun check and a clean check must never print the
   * same thing. It holds for an unrun check and a failing one too.
   */
  if (!was.ok) {
    report.unreadable.push({ file: f, why: was.err || "git show failed with no message" });
    continue;
  }
  if (norm(was.out) !== norm(now)) report.edited.push(f);
}
report.newMigrations = headFiles.filter((f) => !baseSet.has(f));

if (report.unreadable.length) {
  failed = true;
  console.error("");
  console.error(
    `::error::the immutability check DID NOT RUN for ${report.unreadable.length} file(s): their version at ` +
      `${report.base} could not be read. This is not a finding about those files, it is this check failing.`,
  );
  for (const u of report.unreadable.slice(0, 5)) console.error(`    ${u.file}: ${u.why}`);
  if (report.unreadable.length > 5) console.error(`    ... and ${report.unreadable.length - 5} more, same shape`);
  console.error(`  If that says "Filename too long", the checkout is too deep for Windows: git show resolves`);
  console.error(`  <rev>:<path> by stat-ing it first, so cwd plus the argument must fit in MAX_PATH. Move the`);
  console.error(`  working copy nearer the drive root and run it again.`);
}

if (report.edited.length || report.deleted.length) {
  failed = true;
  console.error("");
  console.error(
    `::error::${report.edited.length} shipped migration file(s) were edited and ${report.deleted.length} were deleted. ` +
      `A shipped migration file is never changed.`,
  );
  for (const f of report.edited) console.error(`    edited:  drizzle/${f}`);
  for (const f of report.deleted) console.error(`    deleted: drizzle/${f}`);
  console.error(`  _migrations_applied keys on FILENAME and stores no checksum, so every instance that already`);
  console.error(`  ran this file has its name recorded and will never run the new body. Nothing reports that.`);
  console.error(`  A fresh instance gets the new body, and the two databases diverge with no error anywhere.`);
  console.error(`  Fix forward: add a new numbered migration. node scripts/check-migration-numbers.mjs --next`);
}

say(
  `  ${report.newMigrations.length} new migration(s) since the previous release` +
    (report.newMigrations.length ? `: ${report.newMigrations.join(", ")}` : ""),
);

// Phase 2.
report.ran.destructive = true;
const newSql = new Map();
for (const f of report.newMigrations) newSql.set(f, fs.readFileSync(path.join(DIR, f), "utf-8"));
const waivers = [];
for (const [f, sql] of newSql) {
  const { waived, found } = scanDestructive(f, sql);
  if (waived) waivers.push({ file: f, reason: waived });
  report.destructive.push(...found);
}
if (report.destructive.length) {
  failed = true;
  console.error("");
  console.error(
    `::error::${report.destructive.length} destructive statement(s) in the new migrations. Each one takes something ` +
      `away that the previous release still needs, and the first three leave no schema difference to find.`,
  );
  for (const d of report.destructive) {
    console.error(`    drizzle/${d.file}  [${d.rule}]  ${d.why}`);
    console.error(`      ${d.statement}`);
  }
  console.error(`  Expand now, contract later: add the new thing in this release, write to both, and remove the`);
  console.error(`  old one in a LATER release once this one is proven on all thirteen instances.`);
  console.error(`  A genuine exception takes an inline "-- compat-ok: <reason>" comment in the migration file.`);
}
if (waivers.length) {
  for (const w of waivers) say(`  waived by compat-ok: drizzle/${w.file} (${w.reason})`);
}

/* Phases 3 and 4. */
if (report.newMigrations.length === 0) {
  say(`  no new migrations, so there is nothing for the database phases to run`);
} else {
  const url = testDatabaseUrl();
  if (!url) {
    die(
      "there are new migrations and no TEST_DATABASE_URL, so the expand/contract check DID NOT RUN",
      "This is a failure and not a skip: an unrun check and a clean check must never print the same thing.",
      "CI provides a mysql service. Locally, set TEST_DATABASE_URL in .env (127.0.0.1:3307 here).",
    );
  }
  const u = new URL(url);
  const connBase = {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    timezone: "Z",
  };
  const schema = `village_compat_${Math.floor(Date.now() / 1000)}_${process.pid}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "compat-base-"));
  let admin;
  let conn;
  try {
    // The base ref's migrations, written out byte for byte.
    for (const f of baseFiles) {
      const b = bytesAt(base.sha, f);
      if (!b.ok) die(`could not read drizzle/${f} at ${base.sha}: ${b.err}`);
      fs.writeFileSync(path.join(tmp, f), b.out);
    }

    admin = await mysql.createConnection(connBase);
    // A crashed earlier run leaves a schema behind; two hours is longer than
    // any run of this and shorter than a working day.
    const [old] = await admin.query(
      "SELECT schema_name s FROM information_schema.schemata WHERE schema_name LIKE 'village\\_compat\\_%'",
    );
    for (const r of old) {
      const epoch = Number(String(r.s).split("_")[2]);
      if (Number.isFinite(epoch) && Date.now() - epoch * 1000 > 2 * 60 * 60 * 1000) {
        await admin.query(`DROP DATABASE IF EXISTS \`${r.s}\``);
      }
    }
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);

    conn = await mysql.createConnection({ ...connBase, database: schema });
    await conn.query("SET time_zone = '+00:00'");

    const t0 = Date.now();
    const basePass = await applyFiles(conn, tmp, baseFiles);
    if (basePass.failure) {
      die(
        `the PREVIOUS release's own migrations do not apply cleanly, so nothing here can be trusted`,
        `drizzle/${basePass.failure.file} statement ${basePass.failure.statement} of ${basePass.failure.of}: ${basePass.failure.message}`,
      );
    }
    say(
      `  applied ${basePass.applied.length} migration(s) from the previous release in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );

    const before = await snapshot(conn, schema);

    // Phase 3: put rows in the way.
    const touched = tablesTouched([...newSql.values()]);
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    report.seeded = await seedRows(conn, before, touched, (l) => say(l));
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    if (report.seeded.refused.length) {
      for (const r of report.seeded.refused) {
        say(`    not seeded: ${r.table} (${r.reason})`);
      }
    }
    if (touched.length > 0 && report.seeded.tables === 0) {
      say(
        `  ::warning::the new migrations name ${touched.length} table(s) and NONE of them could be seeded, ` +
          `so phase 3 proved nothing about behaviour on populated tables. Phase 4 still ran.`,
      );
    }

    /*
     * Phase 5 rides along with phase 3's apply. The watched set is fixed from
     * the BEFORE snapshot, so a table the change creates is not watched (no
     * previous release reads it) and a table that never had a unique key
     * cannot lose one.
     */
    const watched = uniqueKeyTablesIn(before);
    const seenGap = new Set();
    const watchGap = async (file, statement, of) => {
      if (watched.size === 0) return;
      const nowUnique = await tablesWithUniqueKey(conn, schema);
      for (const table of watched) {
        if (nowUnique.has(table)) continue;
        const [[{ n }]] = await conn.query(
          "SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
          [schema, table],
        );
        // A table the change DROPS is not a gap; phase 2 and phase 4 own that.
        if (Number(n) === 0) continue;
        const key = `${file}:${table}`;
        if (seenGap.has(key)) continue;
        seenGap.add(key);
        report.gaps.push({ file, statement, of, table });
      }
    };
    const newPass = await applyFiles(conn, DIR, report.newMigrations, watchGap);
    report.ran.database = true;
    report.ran.gaps = watched.size > 0;
    if (newPass.failure) {
      failed = true;
      report.applyError = newPass.failure;
      console.error("");
      console.error(
        `::error::drizzle/${newPass.failure.file} FAILED on a table that has rows, at statement ` +
          `${newPass.failure.statement} of ${newPass.failure.of}. This is the boot failure, caught before the deploy.`,
      );
      console.error(`    ${newPass.failure.message}`);
      console.error(`    ${newPass.failure.sql}`);
      console.error(`  Migrations are applied AT BOOT, fail loud. On a founder instance this is a container that`);
      console.error(`  does not start, on a database that is already part way through the file.`);
    } else {
      const after = await snapshot(conn, schema);
      report.violations = diffContract(before, after);

      // The second run. This proves the ledger stops a replay; it does NOT
      // prove the SQL is idempotent, and it does not need to, because
      // production never replays a recorded file either.
      const again = await applyFiles(conn, DIR, report.newMigrations);
      const third = await snapshot(conn, schema);
      const identical = JSON.stringify(diffContract(after, third)) === "[]" && JSON.stringify(diffContract(third, after)) === "[]";
      report.secondRun = { applied: again.applied.length, failure: again.failure, schemaUnchanged: identical };
      if (again.applied.length !== 0 || again.failure || !identical) {
        failed = true;
        console.error("");
        console.error(
          `::error::running the new migrations a SECOND time was not a no-op: ${again.applied.length} applied, ` +
            `failure ${again.failure ? again.failure.message : "none"}, schema unchanged ${identical}.`,
        );
        console.error(`  Every instance boots this file list on every start. A second run must do nothing at all.`);
      } else {
        say(`  second run applied 0 migrations and changed no schema (the ledger holds)`);
      }

      /*
       * Phase 5's verdict. NOT waivable by compat-ok, and the header says why:
       * this is the boot failure, not a judgement about what a rollback can
       * survive. A file carrying a waiver for the contract would otherwise
       * waive this too, which is exactly the file most likely to have a gap.
       */
      if (report.gaps.length) {
        failed = true;
        console.error("");
        console.error(
          `::error::${report.gaps.length} moment(s) with no unique key, part way through a migration. ` +
            `On a rolling deploy the previous release writes into that gap and the statement after it fails at boot.`,
        );
        for (const g of report.gaps) {
          console.error(`    drizzle/${g.file}: after statement ${g.statement} of ${g.of}, \`${g.table}\` has no unique key`);
        }
        console.error("");
        console.error(`  Every upsert here is INSERT ... ON DUPLICATE KEY UPDATE, which with no unique key to`);
        console.error(`  collide on INSERTs instead. The duplicate then fails the statement that adds the key`);
        console.error(`  back, on a database already part way through the file. Recovery is a hand DELETE in`);
        console.error(`  production, because rolling the image back does not remove the row.`);
        console.error(`  THE FIX IS ONE STATEMENT: put the DROP INDEX and the ADD UNIQUE KEY in a single`);
        console.error(`  ALTER TABLE, which MySQL applies together, so no moment between them exists.`);
        console.error(`  A compat-ok comment does NOT waive this, for the reason the header gives.`);
      } else if (report.ran.gaps) {
        say(`  no moment without a unique key, after every statement of ${report.newMigrations.length} file(s) (${watched.size} table(s) watched)`);
      }

      if (report.violations.length) {
        // The waiver covers the CHANGE, not a file, because the contract diff
        // is a property of the whole change: two new migrations produce one
        // schema and a violation cannot be attributed back to one of them. So
        // it only applies when EVERY new migration carries the token.
        const schemaWaived = waivers.length === report.newMigrations.length;
        report.schemaWaived = schemaWaived;
        const speak = schemaWaived ? console.log : console.error;
        if (!schemaWaived) failed = true;
        speak("");
        speak(
          `::${schemaWaived ? "warning" : "error"}::${report.violations.length} change(s) leave the schema unrunnable ` +
            `by the previous release. Rolling this image back would not recover a founder's instance.`,
        );
        for (const v of report.violations) {
          speak(`    [${v.kind}] ${v.at}`);
          speak(`      ${v.why}`);
        }
        speak("");
        if (schemaWaived) {
          speak(`  Reported and not failed: every new migration carries a compat-ok waiver.`);
          for (const w of waivers) speak(`    drizzle/${w.file}: ${w.reason}`);
        } else {
          console.error(`  EXPAND NOW, CONTRACT LATER. Add the new column or table in this release and keep the old`);
          console.error(`  one written to. Remove the old one in a later release, after this one has run on all`);
          console.error(`  thirteen instances long enough that rolling back to it is no longer the plan.`);
          console.error(`  Nullable, or NOT NULL with a DEFAULT on a column the previous release never names.`);
          console.error(`  A deliberate exception takes "-- compat-ok: <reason>" in EVERY new migration in the`);
          console.error(`  change, because these violations are a property of the schema the whole change`);
          console.error(`  produces and cannot be attributed back to one file.`);
        }
      }
    }
  } finally {
    try {
      if (conn && !keepSchema) await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      if (conn) await conn.end();
    } catch {
      /* a failed cleanup is never the interesting error */
    }
    try {
      if (admin) await admin.end();
    } catch {
      /* same */
    }
    if (keepSchema) say(`  --keep: left the scratch schema as ${schema}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (asJson) process.stdout.write(JSON.stringify({ ...report, ok: !failed }, null, 2) + "\n");
if (failed) process.exit(1);
if (asJson) process.exit(0); // --json prints JSON and nothing else, so it can be piped

say(
  report.newMigrations.length === 0
    ? `  no migration changed, and no shipped file was edited`
    : `  ${report.newMigrations.length} new migration(s) apply to a populated database and leave every table, ` +
      `column, type and constraint the previous release needs`,
);
