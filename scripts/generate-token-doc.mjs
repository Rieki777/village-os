/**
 * NO SHEBANG, and it has to stay that way.
 *
 * Every other script in this directory opens with `#!/usr/bin/env node`, and
 * none of them is imported by a Vitest test. This one is, by
 * server/db/tokenDoc.test.ts, so it goes through Vite's transform as well as
 * node. A SHEBANG AND CRLF LINE ENDINGS TOGETHER make that transform throw
 * `SyntaxError: Invalid or unexpected token`; either one alone is fine.
 *
 * That is not a hypothetical. `core.autocrlf` is true on the Windows checkouts
 * this repository is developed on, so this file ran green half a dozen times
 * on a working copy that still had LF, and went red the moment a rebase
 * checked it out with CRLF. scripts/check-identity-keys.mjs carries the same
 * note for the same reason, having found it the same way.
 *
 * Every caller runs this as `node scripts/generate-token-doc.mjs`, so the
 * shebang bought nothing. The self-test asserts the line is still absent.
 */
/**
 * docs/TOKENS.md, written from the code rather than about it.
 *
 * WHY THIS IS A GENERATOR AND NOT A DOCUMENT. A hand-written token document is
 * wrong within a month and nothing says so. Every fact in this repository that
 * a person copied into prose has drifted: FORK_RUNBOOK said 0006 seeds three
 * tokens (it seeds three of seven), the Setup Wizard offered a currency-name
 * field the registry always overrode, and the launch checklist read the brand
 * document for a name the brand document does not decide. Each of those was
 * true when it was typed. So this file reads the migrations and the server
 * source, derives the facts, and emits the document; `check-token-doc.mjs`
 * regenerates it and fails the build when the emitted text and the committed
 * text differ. The check is what makes the document trustworthy. Without it
 * this is a beautiful thing that lies.
 *
 * WHAT IT DESCRIBES. A FRESH village: what a founder standing up a new
 * instance gets on the first boot. Not the live deployment, which has history.
 *
 * WHAT IT READS, AND THE RULE FOR EACH READER. Every reader is ANCHORED and
 * FAILS LOUD. If the shape it expects is gone, it throws with the file and the
 * text it could not read, and the build stops. A reader that silently returns
 * nothing when the code moves is worse than no reader, because the document
 * keeps rendering and quietly loses a token.
 *
 *   drizzle/*.sql        the seeded registry rows, evaluated (see below)
 *   server/, recursively  tokens registered at boot by an ensure…Token function
 *   server/lib/economy.ts        faucetFor: which account issues which token
 *   server/lib/spending.ts       spendSinkFor, SENDABLE_KINDS, MODULE_VOUCHERS
 *   server/lib/ledger.ts         the registry's own SELECT, ALLOW_NEGATIVE_SOURCES
 *   server/lib/economySeed.ts    the mint rules a fresh village is born with
 *   shared/gameVariables.ts      the dials that decide pool token and vote weight
 *
 * THE SQL IS EVALUATED, NOT MATCHED. `tokens` is written by eight statements
 * across five migrations, including two UPDATE sweeps with WHERE clauses that
 * decide which rows they touch. Reading only the INSERTs would report
 * `gratitude` as transferable, which it was from 0006 until 0092 corrected it,
 * and transferable is the column that decides whether a member can hand
 * recognition to another member. So a small interpreter applies the statements
 * in migration order and the resulting rows are what the document reports.
 *
 * The interpreter understands the statement shapes this repository's token
 * seeds actually use and THROWS on anything else. A migration whose effect on
 * the registry it cannot evaluate has two one-line answers, written as a
 * comment directly above the statement:
 *
 *     -- token-doc: ignore
 *     -- token-doc: as-if UPDATE `tokens` SET `name` = 'X' WHERE `kind` = 'y'
 *
 * `ignore` means the statement changes nothing on a FRESH install. `as-if`
 * gives the fresh-install effect in a shape the interpreter can evaluate, for
 * a statement whose real WHERE reads data this reader has no access to. Both
 * are checked against a real MySQL by server/db/tokenDoc.test.ts, which runs
 * every migration and asserts the interpreter's rows equal the database's. A
 * lying `as-if` fails there.
 *
 * Usage:
 *   node scripts/generate-token-doc.mjs            write docs/TOKENS.md
 *   node scripts/generate-token-doc.mjs --stdout   print it, write nothing
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
);

export const DOC_PATH = path.join(ROOT, "docs", "TOKENS.md");

/**
 * Every file this document is derived from. Existence is checked before
 * anything is parsed, so a rename fails with the path it wanted rather than
 * with a parse error twenty frames deep.
 */
export const SOURCES = [
  "drizzle",
  "server/lib/economy.ts",
  "server/lib/economySeed.ts",
  "server/lib/ledger.ts",
  "server/lib/spending.ts",
  "server/lib/stays.ts",
  "server/lib/library.ts",
  "server/lib/gameStart.ts",
  "server/lib/exit.ts",
  "server/lib/voiceClaim.ts",
  "shared/gameVariables.ts",
];

class ReadError extends Error {}

function fail(message) {
  throw new ReadError(message);
}

// ── SQL: a small interpreter over the statements that write `tokens` ────────

/**
 * Split a migration file into statements, carrying any `-- token-doc:`
 * directive lines that sit above each one.
 *
 * Comments and quoted strings are tracked properly. A `--` inside a quoted
 * string is not a comment, and a `;` inside one is not a statement end; both
 * appear in this repository's migrations.
 */
export function splitSql(text) {
  const out = [];
  let buf = "";
  let directives = [];
  let pending = [];
  let quote = null;
  let block = false;
  let startLine = 1;
  const lines = text.split(/\r?\n/);

  /*
   * A directive is attached when a statement STARTS, which is the moment `buf`
   * is empty and a line yields code. Attaching it when a statement ENDS looked
   * equivalent and was not: a one-line statement ends inside the character
   * scan, before the end-of-line bookkeeping runs, so every directive above a
   * one-line statement was dropped and the escape hatch silently did nothing.
   */
  const startIfNeeded = (line) => {
    if (buf.trim()) return;
    startLine = line;
    directives = pending;
    pending = [];
  };

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const line = li + 1;
    const trimmed = raw.trim();
    if (!quote && !block && trimmed.startsWith("--")) {
      const m = /^--\s*token-doc:\s*(.+)$/i.exec(trimmed);
      if (m) pending.push(m[1].trim());
      continue;
    }

    // Scan the line into chunks: each chunk before a `;` closes a statement.
    const chunks = [];
    let cur = "";
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (block) {
        if (c === "*" && raw[i + 1] === "/") { block = false; i += 1; }
        continue;
      }
      if (quote) {
        cur += c;
        if (c === "\\") { cur += raw[i + 1] ?? ""; i += 1; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === "`") { quote = c; cur += c; continue; }
      if (c === "/" && raw[i + 1] === "*") { block = true; i += 1; continue; }
      if (c === "-" && raw[i + 1] === "-") break;
      if (c === ";") { chunks.push(cur); cur = ""; continue; }
      cur += c;
    }

    for (const chunk of chunks) {
      if (chunk.trim()) startIfNeeded(line);
      const sql = (buf + chunk).trim();
      if (sql) out.push({ sql, directives, line: startLine });
      buf = "";
      directives = [];
    }
    if (cur.trim()) startIfNeeded(line);
    if (cur.trim() || buf) buf += cur + "\n";
  }

  const tail = buf.trim();
  if (tail) out.push({ sql: tail, directives, line: startLine });
  return out;
}

/** Does this statement write, alter or create the `tokens` table? */
const TOKENS_TARGET =
  /^\s*(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|INSERT(?:\s+IGNORE)?\s+INTO|REPLACE\s+INTO|UPDATE|ALTER\s+TABLE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+`?tokens`?\b/i;

/**
 * Names the table in a table position. Tested against the statement with its
 * quoted strings blanked out, because 0112 carries the word "tokens" inside an
 * explanatory note it writes into app_config, and a mention test that reads
 * string contents fails on prose.
 */
const TOKENS_MENTION = /\b(?:INTO|UPDATE|FROM|JOIN|TABLE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?`?tokens`?(?![\w-])/i;

/** The statement with the inside of every quoted string removed. */
function codeOf(sql) {
  return sql.replace(/'(?:[^'\\]|\\.|'')*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function unquote(v) {
  const s = v.trim();
  if (/^'(?:[^'\\]|\\.|'')*'$/.test(s)) {
    return s.slice(1, -1).replace(/''/g, "'").replace(/\\(.)/g, "$1");
  }
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (/^NULL$/i.test(s)) return null;
  if (/^TRUE$/i.test(s)) return 1;
  if (/^FALSE$/i.test(s)) return 0;
  fail(`token-doc: cannot read the SQL value ${s}`);
}

/** Split on commas that sit at bracket depth zero and outside quotes. */
function splitTop(text, sep = ",") {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === "\\") { cur += text[i + 1] ?? ""; i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; cur += c; continue; }
    if (c === "(") depth += 1;
    if (c === ")") depth -= 1;
    if (c === sep && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

const col = (raw) => raw.trim().replace(/^`|`$/g, "");

/**
 * The WHERE grammar this reader accepts: AND-joined comparisons of one column
 * against a literal or a list. Anything else throws, which is the point.
 */
function whereMatcher(where, where_src) {
  if (!where || !where.trim()) return () => true;
  const clauses = where.split(/\s+AND\s+/i).map((c) => c.trim());
  const tests = clauses.map((clause) => {
    let m = /^`?(\w+)`?\s+NOT\s+IN\s*\((.+)\)$/i.exec(clause);
    if (m) {
      const set = splitTop(m[2]).map(unquote);
      return (row) => !set.includes(row[col(m[1])]);
    }
    m = /^`?(\w+)`?\s+IN\s*\((.+)\)$/i.exec(clause);
    if (m) {
      const set = splitTop(m[2]).map(unquote);
      return (row) => set.includes(row[col(m[1])]);
    }
    m = /^`?(\w+)`?\s*(=|<>|!=)\s*(.+)$/.exec(clause);
    if (m) {
      const want = unquote(m[3]);
      const eq = m[2] === "=";
      return (row) => (row[col(m[1])] === want) === eq;
    }
    return fail(
      `token-doc: cannot evaluate the WHERE clause "${clause}" in:\n    ${where_src}\n` +
        `  Teach scripts/generate-token-doc.mjs the shape, or put one of these ` +
        `directly above the statement:\n` +
        `    -- token-doc: ignore\n` +
        `    -- token-doc: as-if <the same statement, written with a simple WHERE>`,
    );
  });
  return (row) => tests.every((t) => t(row));
}

/** Column type to a JS shape: tinyint(1) is a flag, int is a number, the rest is text. */
function columnShape(typeText) {
  const t = typeText.trim().toLowerCase();
  if (/^tinyint\s*\(\s*1\s*\)/.test(t)) return "flag";
  if (/^(int|bigint|smallint|tinyint|decimal|numeric|float|double)/.test(t)) return "number";
  return "text";
}

/**
 * Apply one statement to the in-memory table.
 * `table` is { columns: Map<name,{shape,default}>, rows: Map<slug,row> }.
 */
function applyStatement(table, sql, where_src) {
  let m = /^\s*CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?tokens`?\s*\(([\s\S]+)\)\s*;?\s*$/i.exec(sql);
  if (m) {
    for (const def of splitTop(m[1])) {
      const cm = /^`(\w+)`\s+([^\s]+(?:\s*\([^)]*\))?)([\s\S]*)$/.exec(def);
      if (!cm) {
        if (/^(PRIMARY\s+KEY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN)/i.test(def)) continue;
        fail(`token-doc: cannot read the column definition "${def}"`);
      }
      const rest = cm[3] ?? "";
      const dm = /\bDEFAULT\s+((?:'(?:[^'\\]|\\.|'')*')|[\w.]+)/i.exec(rest);
      table.columns.set(cm[1], {
        shape: columnShape(cm[2]),
        default: dm ? (/^CURRENT_TIMESTAMP$/i.test(dm[1]) ? null : unquote(dm[1])) : null,
      });
    }
    return;
  }

  m = /^\s*ALTER\s+TABLE\s+`?tokens`?\s+([\s\S]+?)\s*;?\s*$/i.exec(sql);
  if (m) {
    for (const clause of splitTop(m[1])) {
      const am = /^ADD\s+COLUMN\s+`(\w+)`\s+([^\s]+(?:\s*\([^)]*\))?)([\s\S]*)$/i.exec(clause);
      if (!am) fail(`token-doc: cannot read the ALTER clause "${clause}" on tokens`);
      const rest = am[3] ?? "";
      const dm = /\bDEFAULT\s+((?:'(?:[^'\\]|\\.|'')*')|[\w.]+)/i.exec(rest);
      const shape = columnShape(am[2]);
      const value = dm ? (/^CURRENT_TIMESTAMP$/i.test(dm[1]) ? null : unquote(dm[1])) : null;
      table.columns.set(am[1], { shape, default: value });
      for (const row of table.rows.values()) row[am[1]] = value;
    }
    return;
  }

  m = /^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+`?tokens`?\s*\(([^)]+)\)\s*VALUES\s*([\s\S]+?)\s*;?\s*$/i.exec(sql);
  if (m) {
    const ignore = /^\s*INSERT\s+IGNORE/i.test(sql);
    const cols = splitTop(m[1]).map(col);
    for (const tuple of splitTop(m[2])) {
      const tm = /^\((.+)\)$/s.exec(tuple.trim());
      if (!tm) fail(`token-doc: cannot read the VALUES tuple "${tuple}"`);
      const values = splitTop(tm[1]).map(unquote);
      if (values.length !== cols.length) {
        fail(`token-doc: ${values.length} values for ${cols.length} columns in "${tuple}"`);
      }
      const row = { __file: table.currentFile };
      for (const [name, meta] of table.columns) row[name] = meta.default;
      cols.forEach((c, i) => { row[c] = values[i]; });
      const slug = row.slug;
      if (slug === undefined || slug === null) fail("token-doc: a tokens INSERT with no slug");
      if (table.rows.has(slug) && ignore) continue;
      table.rows.set(slug, row);
    }
    return;
  }

  m = /^\s*UPDATE\s+`?tokens`?\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+?))?\s*;?\s*$/i.exec(sql);
  if (m) {
    const sets = splitTop(m[1]).map((s) => {
      const sm = /^`?(\w+)`?\s*=\s*([\s\S]+)$/.exec(s);
      if (!sm) fail(`token-doc: cannot read the SET clause "${s}"`);
      return [col(sm[1]), unquote(sm[2])];
    });
    const match = whereMatcher(m[2], where_src ?? sql);
    for (const row of table.rows.values()) {
      if (!match(row)) continue;
      for (const [c, v] of sets) {
        /*
         * THE POINTER FOLLOWS THE IDENTITY, NOT THE INSERT.
         *
         * `arrivesIn` becomes the document's "Arrives from" cell, which exists
         * so a founder can open one file and check what their token is really
         * called. It used to name the migration that first INSERTed the row and
         * never moved again.
         *
         * For the equity mirror that was `0006_token_registry.sql`, where the
         * row still reads ('amora', 'Amora', ...) — one village's name, sitting
         * in the one file the document sent every other village to open. The
         * slug and the name they actually hold come from 0124. The cell was
         * true about the INSERT and wrong about the question being asked.
         *
         * Only `slug` and `name` move it. A later migration that flips
         * `active` or widens `decimals` has not changed what the token IS, and
         * pointing a founder at it would be a different kind of wrong.
         */
        if ((c === "slug" || c === "name") && row[c] !== v) row.__file = table.currentFile;
        row[c] = v;
      }
    }
    return;
  }

  fail(
    `token-doc: this statement writes the tokens table in a shape the reader does ` +
      `not understand:\n    ${sql.slice(0, 240)}\n` +
      `  Teach scripts/generate-token-doc.mjs the shape, or put one of these ` +
      `directly above it:\n    -- token-doc: ignore\n` +
      `    -- token-doc: as-if <the same effect, on a fresh install, in a simple statement>`,
  );
}

/** Migration files in the order the runner applies them. */
export function migrationFiles(root = ROOT) {
  const dir = path.join(root, "drizzle");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Run every migration's token statements and return the registry a fresh
 * village holds the moment migrations finish, before the server boots.
 */
export function seededRegistry(root = ROOT) {
  const table = { columns: new Map(), rows: new Map() };
  const touched = [];
  for (const file of migrationFiles(root)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    table.currentFile = rel;
    for (const stmt of splitSql(fs.readFileSync(file, "utf8"))) {
      const code = codeOf(stmt.sql);
      if (!TOKENS_MENTION.test(code)) continue;
      const directive = stmt.directives.find((d) => /^(ignore|as-if)\b/i.test(d));
      if (directive && /^ignore\b/i.test(directive)) { touched.push(`${rel} (read through a token-doc directive)`); continue; }
      if (directive) {
        const asIf = directive.replace(/^as-if\s*/i, "");
        applyStatement(table, asIf, `${asIf}\n  (as-if directive at ${rel}:${stmt.line})`);
        touched.push(`${rel} (read through a token-doc directive)`);
        continue;
      }
      if (!TOKENS_TARGET.test(code)) {
        if (/^\s*SELECT\b/i.test(code)) continue;
        fail(
          `token-doc: ${rel}:${stmt.line} mentions the tokens table in a statement ` +
            `this reader does not recognise as a read or a write:\n    ${stmt.sql.slice(0, 240)}`,
        );
      }
      try {
        applyStatement(table, stmt.sql, `${stmt.sql}\n  (${rel}:${stmt.line})`);
      } catch (err) {
        if (err instanceof ReadError) fail(`${err.message}\n  at ${rel}:${stmt.line}`);
        throw err;
      }
      touched.push(rel);
    }
  }
  if (!table.rows.size) fail("token-doc: no seeded token rows were found in drizzle/");
  /*
   * The CREATE TABLE is what teaches this reader the column list and the
   * defaults, and it is reached through the same mention test as everything
   * else. Miss it and the INSERTs still land, the rows still look plausible,
   * and every column the CREATE declared silently disappears from the
   * document. That happened once during this file's own build, so the
   * invariant is checked rather than assumed.
   */
  for (const required of ["slug", "name", "kind", "governance", "decimals", "transferable", "active"]) {
    if (!table.columns.has(required)) {
      fail(
        `token-doc: the tokens table has no \`${required}\` column after reading every migration. ` +
          "The CREATE TABLE was probably not recognised; check TOKENS_MENTION in scripts/generate-token-doc.mjs.",
      );
    }
  }

  const rows = Array.from(table.rows.values()).map((row) => {
    const out = { __file: row.__file };
    for (const [name, meta] of table.columns) {
      const v = row[name];
      out[name] = meta.shape === "flag" ? Number(v) === 1 : meta.shape === "number" ? Number(v ?? 0) : v;
    }
    return out;
  });
  return { rows, columns: Array.from(table.columns.keys()), files: Array.from(new Set(touched)) };
}

// ── TypeScript: anchored reads of the code that decides token behaviour ─────

const sourceCache = new Map();

function sourceFile(abs) {
  if (!sourceCache.has(abs)) {
    if (!fs.existsSync(abs)) fail(`token-doc: ${abs} is gone; the generator reads it`);
    sourceCache.set(abs, ts.createSourceFile(abs, fs.readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true));
  }
  return sourceCache.get(abs);
}

function eachChild(node, fn) {
  node.forEachChild((child) => { fn(child); eachChild(child, fn); });
}

/** Top-level `const NAME = …` in a file, by name. */
function constInit(abs, name) {
  const sf = sourceFile(abs);
  let found;
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) found = d.initializer;
    }
  }
  return found;
}

/** Where an imported name comes from, as an absolute path. */
function importSource(abs, name) {
  const sf = sourceFile(abs);
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause?.namedBindings) continue;
    const bindings = stmt.importClause.namedBindings;
    if (!ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if (el.name.text !== name) continue;
      const spec = stmt.moduleSpecifier.text;
      if (!spec.startsWith(".")) fail(`token-doc: ${name} is imported from "${spec}", which this reader cannot follow`);
      const target = path.resolve(path.dirname(abs), spec) + ".ts";
      return { abs: target, exported: el.propertyName?.text ?? el.name.text };
    }
  }
  return null;
}

/** A literal, or a name that resolves to one, following relative imports. */
export function literalOf(node, abs) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return -literalOf(node.operand, abs);
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression?.(node)) {
    return literalOf(node.expression, abs);
  }
  // `displayName || "Village Voice"`: the right side is the platform default.
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return literalOf(node.right, abs);
  }
  if (ts.isIdentifier(node)) {
    const local = constInit(abs, node.text);
    if (local) return literalOf(local, abs);
    const imported = importSource(abs, node.text);
    if (imported) {
      const init = constInit(imported.abs, imported.exported);
      if (!init) fail(`token-doc: ${node.text} is imported into ${abs} but is not a const in ${imported.abs}`);
      return literalOf(init, imported.abs);
    }
    fail(`token-doc: cannot resolve the constant ${node.text} in ${path.basename(abs)}`);
  }
  fail(`token-doc: ${path.basename(abs)} holds a value this reader cannot read: ${node.getText().slice(0, 80)}`);
}

function objectOf(node, abs) {
  if (!ts.isObjectLiteralExpression(node)) fail(`token-doc: expected an object literal in ${path.basename(abs)}`);
  const out = {};
  for (const p of node.properties) {
    if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) continue;
    out[p.name.text] = literalOf(p.initializer, abs);
  }
  return out;
}

function functionNamed(abs, name) {
  const sf = sourceFile(abs);
  let found;
  eachChild(sf, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
  });
  if (!found) fail(`token-doc: ${path.basename(abs)} no longer declares ${name}()`);
  return found;
}

/**
 * Tokens the server creates at first start. Every `registerToken` call under
 * server/lib must sit inside a function named ensure…Token, which is how a
 * boot registration is told apart from a runtime one. A call anywhere else
 * throws rather than being skipped: a module that registers a token the
 * document cannot see is exactly the drift this file exists to prevent.
 */
/**
 * Files where `registerToken` is called for a RUNTIME creation rather than a
 * boot registration, and is therefore none of this document's business: a
 * token a village creates on a Tuesday is not a token a fresh village holds.
 *
 * Kept as an explicit list rather than as silence, because the two cases are
 * indistinguishable from the syntax alone and a reader that guessed would
 * quietly drop whichever it guessed wrong. If the admin create route moves,
 * this fails with the new path in the message and the fix is this one line.
 */
const RUNTIME_REGISTRATION_FILES = ["server/index.ts"];

/** Every .ts file under a directory, recursively, tests excluded. */
function tsFilesUnder(dir, root) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...tsFilesUnder(abs, root));
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.includes(".test.") || entry.name.includes(".spec.")) continue;
    out.push({ abs, rel: path.relative(root, abs).replace(/\\/g, "/") });
  }
  return out;
}

export function bootTokens(root = ROOT) {
  const out = [];
  // RECURSIVE, and over the whole server rather than one directory. This was a
  // flat read of server/lib until server/lib/hypha/ was noticed sitting right
  // there: a module registering its token one directory deeper would have been
  // missed in silence, which is the exact failure this generator exists to
  // stop. Everything under server/ is walked, and every registerToken call has
  // to be either a boot registration named ensure…Token or a file on the
  // runtime list above.
  for (const { abs, rel } of tsFilesUnder(path.join(root, "server"), root)) {
    if (RUNTIME_REGISTRATION_FILES.includes(rel)) continue;
    const sf = sourceFile(abs);
    eachChild(sf, (node) => {
      if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
      if (node.expression.text !== "registerToken") return;
      let holder = node.parent;
      while (holder && !(ts.isFunctionDeclaration(holder) && holder.name)) holder = holder.parent;
      const fnName = holder?.name?.text;
      if (!fnName || !/^ensure\w*Token$/.test(fnName)) {
        fail(
          `token-doc: registerToken is called from ${fnName ?? "an anonymous function"} in ` +
            `${rel}. The document reads a boot registration from a function named ensure…Token. ` +
            `If this one registers a token every village gets, rename it to ensure…Token. If it ` +
            `creates a token at runtime, add "${rel}" to RUNTIME_REGISTRATION_FILES in ` +
            "scripts/generate-token-doc.mjs.",
        );
      }
      const def = objectOf(node.arguments[1], abs);
      const nameArg = node.arguments[1].properties.find(
        (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "name",
      );
      out.push({
        ...def,
        decimals: def.decimals ?? 0,
        active: def.active ?? true,
        is_example: false,
        sort_order: 0,
        nameFromCaller: !!nameArg && ts.isBinaryExpression(nameArg.initializer),
        registeredIn: rel,
        registeredBy: fnName,
      });
    });
  }
  if (!out.length) fail("token-doc: no boot-registered tokens found under server/");
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** faucetFor's switch: token slug to the account that issues it. */
export function faucetMap(root = ROOT) {
  const abs = path.join(root, "server", "lib", "economy.ts");
  const fn = functionNamed(abs, "faucetFor");
  let sw;
  eachChild(fn, (n) => { if (ts.isSwitchStatement(n) && !sw) sw = n; });
  if (!sw) fail("token-doc: faucetFor() is no longer a switch; the reader cannot follow it");
  const map = {};
  let sawDefault = false;
  for (const clause of sw.caseBlock.clauses) {
    const ret = clause.statements.find((s) => ts.isReturnStatement(s));
    if (!ret) fail("token-doc: a faucetFor case does not return; the reader cannot follow it");
    if (ts.isDefaultClause(clause)) {
      sawDefault = true;
      const v = ret.expression ? literalOf(ret.expression, abs) : null;
      if (v !== null) fail(`token-doc: faucetFor's default returns ${v}; the document assumes it returns null`);
      continue;
    }
    map[literalOf(clause.expression, abs)] = literalOf(ret.expression, abs);
  }
  if (!sawDefault) fail("token-doc: faucetFor has no default clause");
  return map;
}

/** spendSinkFor's conditional chain: which account a spent token lands in. */
export function spendSinks(root = ROOT) {
  const abs = path.join(root, "server", "lib", "spending.ts");
  const fn = functionNamed(abs, "spendSinkFor");
  const ret = fn.body?.statements.find((s) => ts.isReturnStatement(s));
  if (!ret?.expression) fail("token-doc: spendSinkFor() no longer returns an expression");
  const named = {};
  let node = ret.expression;
  while (ts.isConditionalExpression(node)) {
    const cond = node.condition;
    if (
      !ts.isBinaryExpression(cond) ||
      cond.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
      !ts.isIdentifier(cond.left)
    ) {
      fail(`token-doc: spendSinkFor tests "${cond.getText().slice(0, 60)}", which this reader cannot follow`);
    }
    named[literalOf(cond.right, abs)] = literalOf(node.whenTrue, abs);
    node = node.whenFalse;
  }
  return { named, fallback: literalOf(node, abs) };
}

/**
 * Which kinds may carry a price. Read out of `isPriceableToken` rather than
 * assumed equal to SENDABLE_KINDS: the two answer different questions and
 * happen to agree today, and a document that leans on the coincidence would
 * start lying the moment one of them moves.
 */
export function priceableKinds(root = ROOT) {
  const abs = path.join(root, "server", "lib", "spending.ts");
  const fn = functionNamed(abs, "isPriceableToken");
  const kinds = [];
  eachChild(fn, (n) => {
    if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return;
    if (!ts.isPropertyAccessExpression(n.left) || n.left.name.text !== "kind") return;
    kinds.push(literalOf(n.right, abs));
  });
  if (!kinds.length) fail("token-doc: isPriceableToken() no longer tests def.kind against a literal");
  return kinds;
}

/** One exported string constant, by file and name. Throws when it moves. */
export function stringConst(root, relFile, name) {
  const abs = path.join(root, relFile);
  const init = constInit(abs, name);
  if (!init) fail(`token-doc: ${relFile} no longer declares ${name}`);
  return literalOf(init, abs);
}

/** A `new Set([...])` assigned to a top-level const. */
export function setConst(root, relFile, name) {
  const abs = path.join(root, relFile);
  const init = constInit(abs, name);
  if (!init) fail(`token-doc: ${relFile} no longer exports ${name}`);
  let arr;
  eachChild(init, (n) => { if (ts.isArrayLiteralExpression(n) && !arr) arr = n; });
  if (!arr) fail(`token-doc: ${name} in ${relFile} is not a set built from an array literal`);
  return arr.elements.map((e) => literalOf(e, abs));
}

/** The mint rules a fresh village is seeded with. */
export function seededRules(root = ROOT) {
  const abs = path.join(root, "server", "lib", "economySeed.ts");
  const init = constInit(abs, "RULES");
  if (!init || !ts.isArrayLiteralExpression(init)) fail("token-doc: economySeed.ts no longer declares const RULES = [...]");
  return init.elements.map((e) => objectOf(e, abs));
}

/** One dial from shared/gameVariables.ts, by key. */
export function gameVariable(key, root = ROOT) {
  const abs = path.join(root, "shared", "gameVariables.ts");
  const sf = sourceFile(abs);
  let found;
  eachChild(sf, (node) => {
    if (found || !ts.isObjectLiteralExpression(node)) return;
    const k = node.properties.find(
      (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "key" && ts.isStringLiteral(p.initializer) && p.initializer.text === key,
    );
    if (!k) return;
    const out = { key };
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
      const n = p.name.text;
      if (n === "choices" && ts.isArrayLiteralExpression(p.initializer)) {
        out.choices = p.initializer.elements.map((e) => objectOf(e, abs));
        continue;
      }
      if (["key", "label", "default", "type", "ring", "category"].includes(n)) {
        out[n] = literalOf(p.initializer, abs);
      }
    }
    found = out;
  });
  if (!found) fail(`token-doc: shared/gameVariables.ts no longer defines the dial "${key}"`);
  return found;
}

/** Every dial key, so the document can say plainly that a setting does not exist yet. */
export function variableKeys(root = ROOT) {
  const abs = path.join(root, "shared", "gameVariables.ts");
  const sf = sourceFile(abs);
  const keys = [];
  eachChild(sf, (node) => {
    if (!ts.isPropertyAssignment(node) || !ts.isIdentifier(node.name) || node.name.text !== "key") return;
    if (ts.isStringLiteral(node.initializer)) keys.push(node.initializer.text);
  });
  return Array.from(new Set(keys));
}

/** The columns the running registry actually loads out of the tokens table. */
export function registryColumns(root = ROOT) {
  const abs = path.join(root, "server", "lib", "ledger.ts");
  const fn = functionNamed(abs, "loadTokenRegistry");
  let cols;
  eachChild(fn, (n) => {
    if (cols || !(ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))) return;
    const m = /SELECT\s+([\s\S]+?)\s+FROM\s+tokens/i.exec(n.text);
    if (m) cols = splitTop(m[1]).map(col);
  });
  if (!cols) fail("token-doc: loadTokenRegistry() no longer carries a SELECT … FROM tokens");
  return cols;
}

// ── The prose. Written by a person, kept here so the file stays generated ───

/**
 * One plain sentence per token, for a founder who has never read the code.
 *
 * KEYED BY SLUG for platform tokens and by `hypha:<kind>` for the Base
 * mirrors. The mirrors are keyed that way on purpose: drizzle/0006 seeds the
 * equity mirror under one village's own name, and scripts/check-brand-refs.mjs
 * correctly fails a build that compiles that literal into platform code. A key
 * built from kind and governance carries no village's name.
 *
 * Every token must have a sentence and every sentence must have a token. Both
 * directions throw, so a new token cannot ship undescribed and a removed one
 * cannot leave an orphan sentence behind.
 */
const SENTENCES = {
  gratitude:
    "Recognition. One member thanks another for something that actually happened, and this token is the record of it. It is a signal, never a price.",
  credits:
    "The village's own money. It is what the cycle pool shares out when a moon closes, and what a member spends on a night, a seat or a shelf.",
  "village-voice":
    "Earned say. It accrues here as work is confirmed and seats are held, and a member claims it across to Base once they hold enough.",
  "stay-credit":
    "A claim on a night in one of the village's rooms, issued by the stays module against its own beds.",
  "library-credit":
    "A deposit against the village's shelves, issued by the library module against what it lends.",
  "hypha:equity":
    "The village's equity, issued and governed on Base under Hypha. This platform shows a member what they hold and never moves it.",
  "hypha:voice":
    "Voice that has already been claimed across to Base. This platform shows a member what they hold there and never moves it.",
};

export const sentenceKey = (t) => (t.governance === "hypha" ? `hypha:${t.kind}` : t.slug);

/**
 * Every token has a sentence and every sentence has a token, or this returns
 * the refusal that stops the build.
 *
 * BOTH DIRECTIONS ON PURPOSE. A missing sentence ships a token nobody can
 * explain to a member. An orphan sentence is the older failure and the quieter
 * one: a token gets renamed or dropped, its description stays behind, and the
 * document keeps describing something that is gone while looking complete.
 */
export function sentenceCoverageProblem(tokens, sentences = SENTENCES) {
  for (const t of tokens) {
    const key = sentenceKey(t);
    if (sentences[key]) continue;
    return (
      `token-doc: the token "${t.slug}" has no sentence. Add one to SENTENCES in ` +
      `scripts/generate-token-doc.mjs under the key "${key}". A token nobody can ` +
      `describe in one line is a token nobody can explain to a member.`
    );
  }
  const used = new Set(tokens.map(sentenceKey));
  for (const key of Object.keys(sentences)) {
    if (used.has(key)) continue;
    return (
      `token-doc: SENTENCES in scripts/generate-token-doc.mjs describes "${key}", ` +
      `which no token matches any more. Delete the sentence or fix the key.`
    );
  }
  return null;
}

/** Titles for the sections of the document that are written rather than read. */
const KIND_WORDS = {
  recognition: "recognition",
  credit: "credit",
  voice: "voice",
  equity: "equity",
};

// ── Facts ───────────────────────────────────────────────────────────────────

export function collectFacts(root = ROOT) {
  for (const rel of SOURCES) {
    if (!fs.existsSync(path.join(root, rel))) fail(`token-doc: ${rel} is gone; the generator reads it`);
  }

  const seeded = seededRegistry(root);
  const boot = bootTokens(root);
  const faucets = faucetMap(root);
  const sinks = spendSinks(root);
  const sendableKinds = setConst(root, "server/lib/spending.ts", "SENDABLE_KINDS");
  const priceable = priceableKinds(root);
  const moduleVouchers = setConst(root, "server/lib/spending.ts", "MODULE_VOUCHERS");
  const allowNegative = setConst(root, "server/lib/ledger.ts", "ALLOW_NEGATIVE_SOURCES");
  const rules = seededRules(root);
  const poolToken = gameVariable("gratitude.pool_token", root);
  const poolSize = gameVariable("gratitude.pool_per_cycle", root);
  const weightMode = gameVariable("governance.weight_mode", root);
  const weightToken = gameVariable("governance.weight_token", root);
  const mintCap = gameVariable("ledger.admin_mint_cycle_cap", root);
  const claimThreshold = gameVariable("economy.voice_claim_threshold", root);
  const claimsWeek = gameVariable("economy.claims_week_days", root);
  const loaded = registryColumns(root);
  const accounts = {
    voiceBridge: stringConst(root, "server/lib/economy.ts", "VOICE_BRIDGE"),
    exitSettlement: stringConst(root, "server/lib/exit.ts", "EXIT_SETTLEMENT"),
    voiceSettled: stringConst(root, "server/lib/voiceClaim.ts", "VOICE_SETTLED"),
  };

  const rows = [];
  for (const r of seeded.rows) {
    rows.push({
      slug: r.slug,
      name: r.name,
      kind: r.kind,
      governance: r.governance,
      decimals: Number(r.decimals ?? 0),
      transferable: !!r.transferable,
      active: r.active !== false,
      isExample: !!r.is_example,
      sortOrder: Number(r.sort_order ?? 0),
      arrivesFrom: "migration",
      arrivesIn: r.__file,
      nameFromCaller: false,
    });
  }
  for (const b of boot) {
    if (rows.some((r) => r.slug === b.slug)) continue;
    rows.push({
      slug: b.slug,
      name: b.name,
      kind: b.kind,
      governance: b.governance,
      decimals: Number(b.decimals ?? 0),
      transferable: !!b.transferable,
      active: b.active !== false,
      isExample: false,
      sortOrder: 0,
      arrivesFrom: "boot",
      arrivesIn: b.registeredIn,
      registeredBy: b.registeredBy,
      nameFromCaller: !!b.nameFromCaller,
    });
  }

  const coverage = sentenceCoverageProblem(rows, SENTENCES);
  if (coverage) fail(coverage);

  /*
   * `faucetFor` naming a token no village has is a rule that can never be
   * written and a supply figure nobody can read, and it is invisible from
   * either side on its own: the switch looks complete and the registry looks
   * complete. Checking the two against each other is nearly free, so it is
   * checked here rather than left for somebody to notice.
   */
  const known = new Set(rows.map((r) => r.slug));
  for (const slug of Object.keys(faucets)) {
    if (known.has(slug)) continue;
    fail(
      `token-doc: faucetFor() in server/lib/economy.ts issues "${slug}" out of ` +
        `${faucets[slug]}, and no token by that slug exists in a fresh village. Either the ` +
        "token is missing from the seeds or the case is left over from one that went.",
    );
  }

  for (const t of rows) {
    t.sentence = SENTENCES[sentenceKey(t)];
    t.faucet = faucets[t.slug] ?? null;
    t.ruleEngineCanPay = t.faucet !== null;
    t.isCyclePoolDefault = poolToken.default === t.slug;
    t.isVoteWeightDefault = weightToken.default === t.slug;
    t.priceable = t.governance === "platform" && t.active && !t.isExample && priceable.includes(t.kind);
    t.spendSink = t.priceable ? (sinks.named[t.slug] ?? sinks.fallback) : null;
    // Deduped: when the cycle pool's faucet IS the token's faucet, one account
    // issues it by two routes and naming it twice reads like two faucets.
    t.issuedFrom = Array.from(new Set([t.faucet, t.isCyclePoolDefault ? "sys:cycle-pool" : null].filter(Boolean)));
    t.sendBlockedBy =
      t.governance !== "platform" ? "it is governed on Base"
      : !t.active ? "it is not in circulation"
      : t.isExample ? "it is a standing example"
      : !sendableKinds.includes(t.kind) ? `${KIND_WORDS[t.kind] ?? t.kind} is never handed between members`
      : moduleVouchers.includes(t.slug) ? "it buys one named thing from the village and cannot be passed on"
      : !t.transferable ? "the village has sending switched off for it"
      : null;
    t.sendable = t.sendBlockedBy === null;
    t.seededRules = rules
      .filter((r) => r.token === t.slug)
      // `enabled` rides along because a seeded rule can be seeded OFF. The
      // first one was the recognition rule for a seat, switched off rather
      // than deleted so a village can vote it back on. Dropping the flag
      // here, which this projection used to do, made the document announce a
      // payout that never happens.
      .map((r) => ({ trigger: r.trigger, amount: r.amount, ceiling: r.ceiling, recipient: r.recipient, enabled: r.enabled !== false }));
  }

  const order = { migration: 0, boot: 1 };
  rows.sort((a, b) => {
    const ga = a.governance === "hypha" ? 1 : 0;
    const gb = b.governance === "hypha" ? 1 : 0;
    if (ga !== gb) return ga - gb;
    if (order[a.arrivesFrom] !== order[b.arrivesFrom]) return order[a.arrivesFrom] - order[b.arrivesFrom];
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.slug.localeCompare(b.slug);
  });

  /*
   * Ruling 2 (a floor on how far a balance may go below zero) is recorded
   * below as staged. A dial that looks like it would be that setting means the
   * ruling may have been built and the document's status line is now wrong, so
   * this stops rather than quietly keeps saying "not built".
   *
   * The pattern is deliberately narrow. A loose /floor|negative/ over every
   * dial key matched `introductions.match_floor`, which is about matching
   * people and has nothing to do with balances, and the document cheerfully
   * announced a floor setting that does not exist. A guard that is wrong and
   * reads right is the failure this whole file exists to prevent.
   */
  const floorDials = variableKeys(root).filter(
    (k) => /^(ledger|tokens|economy)\./i.test(k) && /(floor|negative|overdraft|min_balance|minimum_balance)/i.test(k),
  );
  if (floorDials.length) {
    fail(
      `token-doc: ${floorDials.join(", ")} looks like the balance floor ruling 2 describes as staged. ` +
        "If it is, update ruling 2's status in scripts/generate-token-doc.mjs. If it is not, narrow the pattern beside this check.",
    );
  }

  return {
    tokens: rows,
    priceableKinds: priceable,
    columns: seeded.columns,
    loadedColumns: loaded,
    unloadedColumns: seeded.columns.filter((c) => !loaded.includes(c)),
    faucets,
    spendSinks: sinks,
    sendableKinds,
    moduleVouchers,
    allowNegative,
    seededRules: rules,
    accounts,
    dials: { poolToken, poolSize, weightMode, weightToken, mintCap, claimThreshold, claimsWeek },
    migrationsRead: seeded.files,
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────

const yes = (b) => (b ? "yes" : "no");

function table(headers, rows) {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const r of rows) lines.push(`| ${r.join(" | ")} |`);
  return lines.join("\n");
}

function tokenSection(t, f) {
  const lines = [];
  lines.push(`### ${t.name}`);
  lines.push("");
  lines.push(t.sentence);
  lines.push("");
  const rows = [
    ["Slug", `\`${t.slug}\``],
    ["Kind", t.kind],
    ["Who governs it", t.governance === "platform" ? "this village, which mints it and moves it" : "Hypha, on Base. Read here, never written"],
    ["Decimals", String(t.decimals)],
    ["Arrives from", t.arrivesFrom === "migration" ? `\`${t.arrivesIn}\`, when the database is migrated` : `\`${t.arrivesIn}\`, at the first server start (\`${t.registeredBy}()\`)`],
    [
      "Issued out of",
      t.issuedFrom.length ? t.issuedFrom.map((a) => `\`${a}\``).join(" and ") : "nothing here issues it",
    ],
    ["A mint rule can pay it", t.governance === "platform" ? yes(t.ruleEngineCanPay) : "no, it is a Base mirror"],
    ["Members may send it", t.sendable ? "yes" : `no, because ${t.sendBlockedBy}`],
    [
      "Can carry a price",
      t.priceable ? `yes, and spending it lands in \`${t.spendSink}\`` : `no, a price is posted in ${f.priceableKinds.map((k) => `${k} tokens`).join(" or ")}`,
    ],
  ];
  if (t.nameFromCaller) {
    rows.push(["Name", `\`${t.name}\` unless the seed is given another. The slug stays \`${t.slug}\` either way`]);
  }
  lines.push(table(["Fact", "Value"], rows));
  lines.push("");

  const live = t.seededRules.filter((r) => r.enabled);
  const off = t.seededRules.filter((r) => !r.enabled);
  const paid = live.length
    ? live
        .map((r) => `${r.amount} on \`${r.trigger}\` to the ${r.recipient}, up to ${r.ceiling} a moon`)
        .join("; ")
    : null;
  lines.push(`**Who can issue it, and how.** ${issuance(t, f, paid, off)}`);
  lines.push("");
  lines.push(`**What happens at cycle close.** ${cycleClose(t, f)}`);
  if (t.governance === "platform" && t.kind === "voice") {
    lines.push("");
    lines.push(
      `**Claiming it across to Base.** A member's chip turns claimable once they hold \`` +
        `${f.dials.claimThreshold.key}\` of it (default ${f.dials.claimThreshold.default}). The claim holds the ` +
        "amount aside, becomes a real proposal in the village's Hypha space, and settles on Base when that proposal " +
        `carries, moving to \`${f.accounts.voiceSettled}\`. A claim that is canceled, rejected or left to go stale ` +
        "returns the voice to the member instead, through the reversal of the very posting that took it. Claims open " +
        `in a window once a season, \`${f.dials.claimsWeek.key}\` days long (default ${f.dials.claimsWeek.default}), ` +
        "so a whole season of contribution formalises in one governance pass rather than as a trickle of separate " +
        "proposals.",
    );
  }
  return lines.join("\n");
}

function issuance(t, f, paid, off = []) {
  if (t.governance !== "platform") {
    return (
      "Nobody, here. It is issued on Base under Hypha, and this platform holds a read-only mirror of what a " +
      "member's wallet says. The ledger refuses any posting of it, so a bug cannot make this database a second " +
      "source of truth for the cap table."
    );
  }
  const bits = [];
  if (t.faucet) {
    bits.push(
      `Every unit comes out of \`${t.faucet}\`, and that account's negative balance is this token's issued supply.`,
    );
    bits.push(
      paid
        ? `A mint rule can pay it, and a fresh village is seeded to pay ${paid}.`
        : "A mint rule can pay it, and a fresh village is seeded with no rule that does.",
    );
    // A rule seeded OFF is a rule the village can vote back on, which is why it
    // is shipped switched off rather than deleted: no route creates a mint
    // rule, so deleting the row would remove the ability for good. It is named
    // here because a payout that does not happen is the one thing a founder
    // must not read as a payout that does.
    if (off.length) {
      bits.push(
        `One rule ships switched OFF and pays nobody until the village turns it on: ` +
          off
            .map((r) => `${r.amount} on \`${r.trigger}\` to the ${r.recipient}`)
            .join("; ") +
          ". It is seeded off rather than left out because no route creates a mint rule, so a village that " +
          "wanted it back would have no way to add it.",
      );
    }
  } else {
    bits.push(
      "No mint rule can pay it. `faucetFor()` in `server/lib/economy.ts` has no account for this token, so a rule " +
        "pointed at it reads as enabled and pays nobody.",
    );
  }
  if (t.isCyclePoolDefault) {
    bits.push(
      `It is the default answer to the \`${f.dials.poolToken.key}\` dial, so a closing moon releases it out of ` +
        "`sys:cycle-pool`, which is an administrator's deliberate act rather than a scheduled job.",
    );
  }
  bits.push(
    "No token at all can be issued before the village's launch vote carries. The gate sits on the ledger account's " +
      "`faucet` column, so it covers every faucet including one added later (`server/lib/gameStart.ts`).",
  );
  return bits.join(" ");
}

function cycleClose(t, f) {
  const bits = [];
  if (t.isCyclePoolDefault) {
    bits.push(
      `A closing moon shares out as many of this token as the \`${f.dials.poolSize.key}\` dial says ` +
        `(default ${f.dials.poolSize.default}, and 0 turns the pool off), split between members in proportion to the ` +
        "recognition each received that moon. Shares round down, and the remainder stays in the pool.",
    );
  }
  const cycleRules = t.seededRules.filter((r) => r.trigger === "role.cycle" && r.enabled);
  if (cycleRules.length) {
    bits.push(
      `Settlement pays everyone holding a seat ${cycleRules.map((r) => `${r.amount} of it`).join(" and ")}. A re-run pays ` +
        "nothing twice: each mint is keyed on the moon, the seat and the holder.",
    );
  }
  if (t.kind === "recognition") {
    bits.push(
      "The balance itself is untouched. What a member received during the moon decides their share of the pool, and then " +
        "the balance stays where it is. Ruling 1 below would expire an unspent balance here, and it is not built.",
    );
  }
  if (!bits.length) bits.push("Nothing. Balances carry across the moon unchanged.");
  return bits.join(" ");
}

export function render(f) {
  const L = [];
  const p = (s = "") => L.push(s);

  p("# Tokens");
  p();
  p(
    "Every token a village issues, what each one means, who may issue it, who may move it, and what happens to it " +
      "when a moon closes.",
  );
  p();
  p(
    "This describes a FRESH village: what a founder standing up a new instance holds after the migrations run and the " +
      "server starts for the first time. A village that has been running has its own history on top.",
  );
  p();

  p("## How to read this file");
  p();
  p(
    "This file is generated. `scripts/generate-token-doc.mjs` reads the migrations and the server source, works out the " +
      "facts, and writes the whole document. `scripts/check-token-doc.mjs` regenerates it and fails the build when the " +
      "committed text and the code have come apart.",
  );
  p();
  p("Editing this file by hand does not hold. Change the code, then run:");
  p();
  p("```bash");
  p("node scripts/generate-token-doc.mjs");
  p("```");
  p();
  p("Two kinds of line live here, and the difference matters:");
  p();
  p(
    "- **Read from the code.** Every table, every number, every slug, every account name, and the JSON block at the end. " +
      "If one of these is wrong, the code is what is wrong.",
  );
  p(
    "- **Written by a person.** The one-sentence description of each token, and the rulings section. They are stored " +
      "inside the generator so this whole file stays generated, and they are marked where they appear.",
  );
  p();
  p(
    "There is no timestamp and no author line, on purpose. Both would change on every run and turn an honest diff into " +
      "noise. The git history is the record of when this changed.",
  );
  p();

  p("## The tokens a fresh village holds");
  p();
  p(
    table(
      ["Token", "Slug", "Kind", "Governed by", "Decimals", "Members may send it", "Arrives from"],
      f.tokens.map((t) => [
        t.name,
        `\`${t.slug}\``,
        t.kind,
        t.governance === "platform" ? "this village" : "Hypha, on Base",
        String(t.decimals),
        yes(t.sendable),
        t.arrivesFrom === "migration" ? `\`${t.arrivesIn}\`` : `\`${t.arrivesIn}\` at boot`,
      ]),
    ),
  );
  p();
  p(
    `${f.tokens.length} tokens. The order is the order a village acquires them: the ones a migration seeds, then the ones ` +
      "the server registers the first time it starts, then the mirrors of what lives on Base.",
  );
  p();

  p("## Every token in full");
  p();
  for (const t of f.tokens) {
    p(tokenSection(t, f));
    p();
  }

  p("## The slug never changes");
  p();
  p(
    "A token has two names. The **slug** is its identity and the **name** is the village's word for it. A village " +
      "renames the name whenever it likes, in Admin then Tokens. The slug is fixed the moment the token exists.",
  );
  p();
  p(
    "One exception to the renaming, and it runs the other way: a Base mirror cannot be renamed here at all. Its name " +
      "is a fact about Base, and the rename route refuses it in those words. Two tokens may not share a display name " +
      "either, in either direction, because a balance in a name two things answer to is a balance nobody can read.",
  );
  p();
  p("The slug is fixed because history is written in it:");
  p();
  p(
    "- `slug` is the primary key of the `tokens` table, so moving it is not a rename, it is a different row.\n" +
      "- Every ledger row carries the slug in `token_type`, and every repeat-protection key carries the slug too. Change " +
      "the slug and the keys that stop a payment happening twice stop matching the payments they were protecting.\n" +
      "- Balances are held per account per slug. A moved slug is a balance nobody can find.",
  );
  p();
  p(
    "A rename touches one column that only humans read. A re-slug moves the key every ledger row was written against. " +
      "The create route already refuses a slug that exists, with the words \"Token history must never be silently " +
      "re-denominated\".",
  );
  p();

  p("## Who may move what");
  p();
  p(
    `A member may send a token to another member only when all of these hold. The list is read from ` +
      "`server/lib/spending.ts`:",
  );
  p();
  p(
    `- the village governs it, so a Base mirror is out\n` +
      `- its kind is ${f.sendableKinds.length === 1 ? `\`${f.sendableKinds[0]}\`` : `one of ${f.sendableKinds.map((k) => `\`${k}\``).join(", ")}`}\n` +
      `- it is not a module voucher (${f.moduleVouchers.map((s) => `\`${s}\``).join(", ")}), which buys one named thing from the village\n` +
      `- the village has \`transferable\` switched on for it\n` +
      `- it is in circulation and is not a standing example`,
  );
  p();
  p(
    "Recognition is held out of that list deliberately and permanently. A record of what happened between two people " +
      "stops being a record the moment it can be handed to a third.",
  );
  p();
  p(
    `A price is posted in ${f.priceableKinds.map((k) => `${k} tokens`).join(" or ")} and in nothing else, which is the same separation stated ` +
      "from the other end. Where a spent token lands:",
  );
  p();
  p(
    table(
      ["Token", "Lands in", "Why"],
      f.tokens
        .filter((t) => t.priceable)
        .map((t) => [
          `\`${t.slug}\``,
          `\`${t.spendSink}\``,
          t.spendSink === f.spendSinks.fallback
            ? "the village now holds that value and can spend it"
            : "spending it genuinely retires it, so it returns to the faucet that issued it",
        ]),
    ),
  );
  p();
  p("Three other things move a token, and none of them is one member handing it to another:");
  p();
  p(
    `- **Spending.** A member pays a village surface and the amount lands in the account above.\n` +
      `- **Claiming across to Base.** An open claim holds the amount in \`${f.accounts.voiceBridge}\`, which is not a ` +
      "faucet: it can only ever hold what a member put in it, which is what makes a cancelled claim provably " +
      "refundable.\n" +
      `- **Leaving.** A departing member's balances settle to \`${f.accounts.exitSettlement}\`.`,
  );
  p();
  p(
    "One more way value enters, outside the rule engine: an administrator can stock the treasury by hand out of " +
      `\`sys:mint\`, capped at \`${f.dials.mintCap.key}\` per token per moon (default \`${f.dials.mintCap.default}\`, and ` +
      "0 switches hand-minting off). The exchange's own rules decide which tokens that route will accept.",
  );
  p();

  p("## Balances, and how far down they go");
  p();
  p(
    "The ledger is double-entry. Every movement is a transfer from one account to another, and for every token the " +
      "balances of all accounts add up to zero. Faucet accounts are allowed to run negative, and a faucet's negative " +
      "balance is that token's issued supply. That is what makes issuance a number anyone can check rather than a " +
      "claim anyone has to trust.",
  );
  p();
  // One plain sentence per excepted source, and the build stops if a new one
  // is added without one. The count and the list are both read from the code,
  // so the paragraph cannot say "two" while the set holds three; the GLOSS is
  // the part a human has to write, and the failure is what makes them.
  const negGloss = {
    stay_night: "a stay burnt inside its grace window",
    payment_reversal: "the reversal leg after a refund",
    reversal: "a correction clawing back value the member had already spent",
  };
  const negMissing = f.allowNegative.filter((s) => !negGloss[s]);
  if (negMissing.length) {
    fail(
      `token-doc: ALLOW_NEGATIVE_SOURCES gained ${negMissing.join(", ")} with no plain sentence. ` +
        "Add one to negGloss in this generator, so the document says what the exception is for.",
    );
  }
  const negJoin = (parts) =>
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
  const negWord = ["No", "One", "Two", "Three", "Four", "Five"][f.allowNegative.length] ?? String(f.allowNegative.length);
  const negVerb = f.allowNegative.length === 1 ? "source is" : "sources are";
  p(
    `An ordinary account cannot go below zero. ${negWord} ${negVerb} excepted today, in \`ALLOW_NEGATIVE_SOURCES\`: ` +
      `${negJoin(f.allowNegative.map((s) => `\`${s}\``))}. Each is an honest state rather than a convenience: ` +
      `${negJoin(f.allowNegative.map((s) => negGloss[s]))}.`,
  );
  p();
  p(
    "There is no setting for how far a balance may go below zero. Ruling 2 below describes the one the founder asked " +
      "for, and the generator stops the build if a dial that looks like one ever appears, so this sentence cannot go " +
      "stale quietly.",
  );
  p();

  p("## The registry table");
  p();
  p(
    `The \`tokens\` table carries ${f.columns.length} columns. The running registry loads ` +
      `${f.loadedColumns.length} of them: ${f.loadedColumns.map((c) => `\`${c}\``).join(", ")}.`,
  );
  p();
  p(
    f.unloadedColumns.length
      ? `The rest are not loaded into the registry: ${f.unloadedColumns
          .map((c) => `\`${c}\``)
          .join(", ")}. A column on that list can still be used directly in SQL (\`sort_order\` orders several ` +
          "listings). One that nothing reads anywhere is dead weight, and this is the list to look in for it."
      : "Every column is loaded.",
  );
  p();

  p("## The founder's rulings");
  p();
  p(
    "Written by a person, from the founder's own words, and recorded here so the specification and the code sit in one " +
      "place. Each one says plainly whether it is built. Nothing marked staged exists in the code today, and no reader " +
      "should plan as though it does.",
  );
  p();

  p("### 1. Unspent gratitude expires at cycle close");
  p();
  p("**Staged.** Not built.");
  p();
  p(
    "Today a closing moon reads how much recognition each member received during it, uses that to split the value " +
      "pool, and leaves every recognition balance exactly where it was. Nothing expires and nothing is swept.",
  );
  p();

  p("### 2. Balances may go negative, with a floor that defaults to zero");
  p();
  p("**Staged.** Not built.");
  p();
  p(
    "The ruling: a balance can go negative, and how far is a setting in the economic game mechanics section, defaulting " +
      "to zero so that by default it cannot. Today the floor is zero for every ordinary account, enforced inside the " +
      "transfer transaction, with the two exceptions listed above. There is no dial.",
  );
  p();

  p("### 3. A module switched off puts its balances in the dark, and the rows survive");
  p();
  p("**Half built.**");
  p();
  p(
    "Built: nothing deletes a token row or a ledger row. A token's `active` flag is a member-visibility switch and " +
      "nothing more, so turning it off hides the token and leaves every balance and every history row intact, ready to " +
      "come back. The stays module registers its token at every boot whether the module is on or off, precisely so a " +
      "reward can post and wait.",
  );
  p();
  p(
    "Staged: switching a module off, once the game has started and members hold its token, being a decision the players " +
      "vote on rather than a switch an administrator flips.",
  );
  p();

  /*
   * REWRITTEN 2026-09-02. This ruling used to read "Voting weight cannot be
   * switched back and forth" and marked the missing one-way lock as staged
   * work. The founder reversed it that day: the mode is a village setting that
   * may move in either direction, the change touches only how votes are
   * COUNTED, and Voice holdings are untouched by it. The code never
   * implemented the lock, so the reversal costs nothing to adopt and the old
   * text was the only thing saying otherwise. docs/GOVERNANCE.md carries the
   * founder's words for this one in full, as its ruling 14.
   */
  /*
   * REWRITTEN AGAIN 2026-09-03 by the docgen lane. The paragraph below used to
   * end "What is missing is the VILLAGE'S OWN VOTE on it", and the vote landed:
   * `governance_mode` is a subject type with an executor, priced at the
   * constitutional tier. A status line that goes on naming a missing feature
   * after somebody builds it is the exact failure both generators exist to
   * stop, so the sentence is replaced by what shipped.
   */
  p("### 4. Voting weight switches back and forth, and holdings survive it");
  p();
  p("**Built.**");
  p();
  const wm = f.dials.weightMode;
  p(
    `Today \`${wm.key}\` is a ${wm.ring ?? "standard"}-ring dial with ${wm.choices?.length ?? 0} choices ` +
      `(${(wm.choices ?? []).map((c) => `\`${c.value}\``).join(", ")}), defaulting to \`${wm.default}\`. ` +
      `\`${f.dials.weightToken.key}\` decides which token weighs a vote when the mode is token, defaulting to ` +
      `\`${f.dials.weightToken.default}\`. Nothing refuses a change in either direction, and switching reads or ` +
      "ignores holdings without deleting one: balances are ledger rows and a custom allocation is its own table, so a " +
      "village can move from one person one vote to token weight and back and every holding survives the trip. Every " +
      "ballot freezes the weights when it opens, so a change mid-vote cannot move a result either.",
  );
  p();
  p(
    "The village's own vote on it landed. `governance_mode` is a subject type with an executor of its own, priced at " +
      "the constitutional tier, so the switch is a decision the village makes and no longer an administrator's act. " +
      "The ordinary dial path still refuses the key, so the change cannot arrive by a side door, and the dial stays in " +
      "the founder ring for the catalysts who set the initial conditions before the Game starts. What a passed vote " +
      "then does, and when it lands, is in `docs/GOVERNANCE.md`.",
  );
  p();

  p("### 5. Voice a founder issues before launch is still a ledger entry, and shows in history as a proposal");
  p();
  p("**Staged, and the code currently says the opposite.**");
  p();
  p(
    "Every issuance is a ledger row today, keyed and sourced, and the ledger is append-only, so the first half is how " +
      "the ledger already works. The second half is not: issuance is refused outright before the village's launch vote " +
      "carries. A founder cannot issue voice before launch at all, so there is no pre-launch entry to show. Building " +
      "this ruling means deciding what a pre-launch issuance is, and the honest reading of the founder's words is a " +
      "proposal that every player can see, resolved by the launch vote.",
  );
  p();

  p("### 6. Any player reaches the admin pages once the game starts, and changes need a vote");
  p();
  p("**Staged.** Not built, and out of scope for this work.");
  p();
  p(
    "It is a rebuild of how governance reaches every administrative surface, not a token change. It is recorded here " +
      "because it decides who may rename a token and who may switch a module off, and both of those are questions this " +
      "document answers today with \"an administrator\".",
  );
  p();

  p("### 7. Quests, roles and contributions can pay any combination of tokens");
  p();
  p("**Partly built.**");
  p();
  p(
    "The ruling in full: a quest, a role or a contribution of any kind should be able to pay any combination of any " +
      "tokens, with the village's voice and the village's credits as the defaults, and paying in recognition should " +
      "stop being a default and become something a village adds if it wants it.",
  );
  p();
  p(
    "Built: the shape. A mint rule names one token, one trigger and one amount, and several rules can share a trigger, " +
      "so a payout is already a combination rather than a single token. Each rule pays under its own key, so one of " +
      "them failing cannot pay another twice.",
  );
  p();
  p("What a fresh village is actually seeded to pay today, read from `server/lib/economySeed.ts`:");
  p();
  p(
    table(
      ["Trigger", "Token", "Amount", "Ceiling a moon", "Paid to", "On today"],
      f.seededRules.map((r) => [
        `\`${r.trigger}\``,
        `\`${r.token}\``,
        String(r.amount),
        String(r.ceiling),
        String(r.recipient),
        r.enabled === false ? "no, seeded off" : "yes",
      ]),
    ),
  );
  p();
  p(
    "A confirmed quest also mints recognition from the consent route itself, with its own range and cap, which is not " +
      "a mint rule and does not appear in that table. A contribution pays nothing at all: " +
      "`POST /api/profile/contribution` is a journal entry, and it is one deliberately, after a version of it that " +
      "added a caller-supplied amount straight onto a member's balance was removed.",
  );
  p();
  const payable = f.tokens.filter((t) => t.ruleEngineCanPay).map((t) => `\`${t.slug}\``);
  const unpayable = f.tokens.filter((t) => t.governance === "platform" && !t.ruleEngineCanPay).map((t) => `\`${t.slug}\``);
  p(
    `Staged: the freedom. The rule engine can pay ${payable.join(", ")}. ` +
      (unpayable.length
        ? `It cannot pay ${unpayable.join(", ")}, because \`faucetFor()\` has no account to issue from. `
        : "") +
      "A village also has no route that creates a mint rule, so today it can edit the amounts on the rules it was " +
      "seeded with and cannot add a token to a payout.",
  );
  p();

  p("### 8. Redeeming tokens for money or equity");
  p();
  p(
    "A village that decides to let members redeem a token for cash or for equity should check what its own country's " +
      "law asks of it first.",
  );
  p();

  p("## The bridge to Base, in three stages");
  p();
  p("The founder's staging, recorded as specification. Stage 1 is where the build stands.");
  p();
  p(
    table(
      ["Stage", "What it is", "Status"],
      [
        [
          "1",
          "A one-way bridge. Voice accrues in this village and a member claims it across to Base when they hold enough. Equity and claimed voice are read back as mirrors.",
          "Built in outline",
        ],
        ["2", "Full Hypha integration.", "Staged"],
        ["3", "The game mints directly to Base and Hypha drops out. Several years out.", "Staged"],
      ],
    ),
  );
  p();
  p(
    "The rule that survives all three stages: this platform never becomes a second source of truth for anything Base " +
      "governs. A Hypha-governed token is refused by the ledger, at the same place every other posting is checked.",
  );
  p();

  p("## Machine-readable");
  p();
  p(
    "The same facts, for anything that would rather parse than read. Regenerated with the rest of the file, so it " +
      "cannot drift from the prose above it.",
  );
  p();
  p("```json");
  p(
    JSON.stringify(
      {
        tokens: f.tokens.map((t) => ({
          slug: t.slug,
          name: t.name,
          kind: t.kind,
          governance: t.governance,
          decimals: t.decimals,
          transferable: t.transferable,
          active: t.active,
          sendableBetweenMembers: t.sendable,
          sendBlockedBy: t.sendBlockedBy,
          faucet: t.faucet,
          ruleEngineCanPay: t.ruleEngineCanPay,
          spendSink: t.governance === "platform" ? t.spendSink : null,
          arrivesFrom: t.arrivesFrom,
          arrivesIn: t.arrivesIn,
          isCyclePoolDefault: t.isCyclePoolDefault,
          isVoteWeightDefault: t.isVoteWeightDefault,
          seededRules: t.seededRules,
          description: t.sentence,
        })),
        sendableKinds: f.sendableKinds,
        moduleVouchers: f.moduleVouchers,
        allowNegativeSources: f.allowNegative,
        dials: Object.fromEntries(
          Object.values(f.dials).map((d) => [d.key, { label: d.label, default: d.default }]),
        ),
        registryColumns: { loaded: f.loadedColumns, notLoaded: f.unloadedColumns },
      },
      null,
      2,
    ),
  );
  p("```");
  p();

  p("## What this file is made from");
  p();
  p("The generator reads these and fails loudly if any of them moves:");
  p();
  for (const rel of SOURCES) p(`- \`${rel}\``);
  p();
  p(
    "It also walks every `.ts` file under `server/` looking for a token registered at first start. Each one has to sit " +
      "inside a function named `ensure…Token`, and a call anywhere else stops the build asking which kind it is. That " +
      "is what stops a new module registering a token the document never mentions.",
  );
  p();
  p(
    "The seeded rows are produced by applying every token statement in `drizzle/` in migration order, rather than by " +
      "reading the INSERTs alone. Two later migrations sweep the `transferable` column, and reading only the INSERTs " +
      "would report recognition as sendable, which it has not been since `0092_token_sinks.sql`. The migrations that " +
      `write the registry today: ${f.migrationsRead.map((m) => `\`${m}\``).join(", ")}.`,
  );
  p();
  p(
    "`server/db/tokenDoc.test.ts` runs every migration against a real MySQL and asserts the rows this generator " +
      "computed are the rows the database actually holds, and that the faucet, sink and sending answers here match what " +
      "the server's own functions return. The generator being wrong is a red test, not a quiet paragraph.",
  );
  p();

  return L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function generate(root = ROOT) {
  return render(collectFacts(root));
}

/** The document and the facts behind it, for callers that want to report on both. */
export function generateDetailed(root = ROOT) {
  const facts = collectFacts(root);
  return { text: render(facts), facts };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

if (invokedDirectly) {
  try {
    const text = generate();
    if (process.argv.includes("--stdout")) {
      process.stdout.write(text);
    } else {
      fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
      fs.writeFileSync(DOC_PATH, text, "utf8");
      process.stdout.write(`wrote docs/TOKENS.md (${text.split("\n").length} lines)\n`);
    }
  } catch (err) {
    process.stderr.write(`\n${err instanceof ReadError ? err.message : err?.stack ?? String(err)}\n\n`);
    process.exit(1);
  }
}
