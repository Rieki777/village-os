#!/usr/bin/env node
/**
 * THE PAYLOAD GUARD: a route whose INSERT can never succeed, in any version.
 *
 * ── THE CLASS THIS EXISTS FOR ────────────────────────────────────────────
 * Two routes shipped that threw on every single call, and every gate we have
 * passed them both.
 *
 *   POST /api/admin/investor-docs/upload built `{id, name, filename, pageLink,
 *   uploadedAt}` and handed it to a repo whose columns were `{id, title,
 *   description, url, requires_request, sort_order}`. `title` is NOT NULL and
 *   the payload never set it, so the insert threw `Column 'title' cannot be
 *   null` on every press since the route shipped. An admin could press Upload,
 *   watch the file leave the browser, and nothing was ever saved. Each press
 *   also left an orphan file on the uploads volume.
 *
 *   POST /api/investor-docs/request, the PUBLIC "send me the investor packet"
 *   form, omitted `status` on its `submissions` insert. `submissions.status` is
 *   NOT NULL, so the insert threw and the route returned 500 every time. The
 *   stewards' inbox was empty because no lead was ever captured, and an empty
 *   inbox looks exactly like an inbox nobody has written to.
 *
 * `check-admin-reach.mjs` passes both, because a caller exists in the browser.
 * `check-route-reachability.mjs` passes both, because the doors are there.
 * Nothing we run asks whether a route WORKS. This one asks.
 *
 * ── THE MECHANISM, WHICH IS ONE LINE ─────────────────────────────────────
 * `dbCollection` in `server/repos/store-db.ts` builds one INSERT naming EVERY
 * column in the spec:
 *
 *     INSERT INTO `t` (`a`,`b`,`c`) VALUES (?,?,?)
 *
 * so a key the caller simply did not set arrives as an explicit NULL, and an
 * explicit NULL is not an absent column: THE COLUMN DEFAULT NEVER APPLIES.
 * That is what turns a harmless-looking omission into a guaranteed NOT NULL
 * violation on a column that has a perfectly good DEFAULT sitting in the
 * schema. Read `itemParams` and `toDb` together and it is unmissable; read
 * either alone and it is invisible.
 *
 * `toDb` rescues exactly two cases and no others:
 *
 *   - `kind: "bool"`  — an absent boolean writes 0, never NULL.
 *   - `defaultNow`    — an absent time writes `new Date()`, never NULL.
 *
 * `kind: "int"` is NOT one of them. The `v == null` branch returns before the
 * switch that would coerce it, so an absent int on a NOT NULL int column writes
 * NULL and the insert is refused just the same. Anything that exempts `int`
 * here is reading `toDb` from memory rather than from the file.
 *
 * ── WHAT THIS CHECKS, AND WHY THERE IS NO WAIVER LIST ────────────────────
 * Three rules, all static. No database, no build, no new dependency.
 *
 *   1. DRIFT. Every `db` column a spec names must exist in that spec's table,
 *      as the migrations in `drizzle/` leave it. A spec naming a column the
 *      schema does not have breaks the SELECT in `load()` at boot as well as
 *      every write, so this is free in the same pass and worth having.
 *
 *   2. PAYLOAD. Every object literal handed to `<repo>.insert(...)`, and every
 *      literal pushed onto an array that a `<repo>.replaceAll(...)` then
 *      writes, must name every spec'd column that is NOT NULL in the schema and
 *      is not rescued by `bool` or `defaultNow`. Naming the key and handing it
 *      a literal `null` or `undefined` fails for the same reason and is
 *      reported the same way.
 *
 *   3. OMISSION, the mirror of rule 1 and the quiet one. Every column the
 *      TABLE has must be in the spec, because `replaceAll` re-INSERTs exactly
 *      the spec'd columns and a column left out is RE-DEFAULTED on every row.
 *      One steward editing one row resets that column for the whole village.
 *      A column MySQL maintains (`ON UPDATE CURRENT_TIMESTAMP`) is exempt and
 *      must NOT be spec'd, which is the only carve-out and is a property of
 *      the schema rather than a waiver anyone types. The rule found
 *      `roles.created_at` the day it was written, sitting one table away from
 *      the `circles.created_at` fix that had already shipped with a comment
 *      warning about exactly this.
 *
 * `check-admin-reach.mjs` carries an allowlist because "this route deliberately
 * has no door" is a real design decision somebody can defend. THERE IS NO
 * EQUIVALENT HERE. An insert missing a NOT NULL column cannot succeed against
 * any schema this repo has ever had, so there is nothing to waive: the fix is
 * always to name the column, or to stop spec'ing it. A waiver list would only
 * ever record a route that does not work.
 *
 * ── BLIND SPOTS, STATED HERE RATHER THAN DISCOVERED LATER ────────────────
 * A gate that does not say what it cannot see gets read as saying everything is
 * fine. These are the gaps, and they are real:
 *
 *   - A ROW ASSEMBLED ACROSS STATEMENTS ESCAPES IT. This resolves a literal, an
 *     identifier bound to a literal, and later `row.key = value` assignments in
 *     the same function. A row built in a loop, returned from a helper, or
 *     spread from a variable (`{...base, id}`) cannot be read statically and is
 *     SKIPPED. Every skip is printed with its file and line and counted, so the
 *     number of unchecked payloads is on screen next to the number of checked
 *     ones. It is never silent.
 *
 *   - A LATER ASSIGNMENT COUNTS EVEN WHEN IT IS CONDITIONAL. `if (submitter) {
 *     entry.userId = submitter.id; }` reads here as "the payload names userId",
 *     because deciding whether a branch runs is not something a parser can do.
 *     For a NULLABLE column that is exactly right. For a NOT NULL one it would
 *     be a false negative, so a required column set only inside an `if` is
 *     invisible to this gate.
 *
 *   - IT SAYS NOTHING ABOUT THE READER. This is one half of the class. The
 *     other half is a route that writes fine while the READER addresses fields
 *     that are not columns: the investor packet email addressed `d.filename`
 *     and `d.name`, neither of which is a column of `investor_docs`, so every
 *     link in it would have read "undefined" and pointed at
 *     `/api/uploads/undefined`. The writer could never save a row, so that half
 *     had nothing to show it. A field read off a row is an ordinary property
 *     access on an `any`, indistinguishable from every other property access in
 *     the file, and only a round trip through a real database catches it. At
 *     165 routes that is not a sweep, and pretending otherwise here would be
 *     the more expensive mistake.
 *
 *   - IT READS SPECS, NOT SQL. Raw `INSERT INTO` in `server/lib/*` is a
 *     different shape with a different failure mode (an unnamed column DOES get
 *     its default) and is out of scope on purpose.
 *
 *   - TESTS ARE EXEMPT, the way they are for `check-voice.mjs` and
 *     `check-admin-reach.mjs`. A test that writes a bad payload fails when it
 *     runs, which is the whole point of it.
 *
 * Usage:
 *   node scripts/check-repo-payloads.mjs
 *   node scripts/check-repo-payloads.mjs --table
 *   node scripts/check-repo-payloads.mjs --json
 *   node scripts/check-repo-payloads.mjs --columns <table>   # audit the DDL parse
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "drizzle");
const SCAN_ROOTS = ["server", "scripts"];

/**
 * Floors. Every one of these is "the read broke", never "nothing to report".
 *
 * A gate that matches zero things prints the same green as a gate that matched
 * everything and found nothing wrong, and this repo has paid for that confusion
 * more than once. So each half of the comparison declares the smallest number
 * that could possibly be right, and falls over below it.
 */
const MIN_TABLES = 40;
const MIN_REPOS = 5;
const MIN_PAYLOADS = 5;

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

// ── The schema, as drizzle/ leaves it ────────────────────────────────────────

/**
 * Comment lines come off exactly the way the migration runner takes them off
 * (`splitStatements`, server/db/migrate.ts), so this parse sees what MySQL saw.
 * Trailing `-- ` comments come off too, quote-aware: the runner does not strip
 * them because MySQL reads them itself, and a trailing comment carrying the
 * words NOT NULL would otherwise make a nullable column look required here.
 */
function stripComments(sql) {
  const out = [];
  for (const line of sql.split("\n")) {
    if (/^\s*--/.test(line)) continue;
    let quote = null;
    let cut = -1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
      if (c === "-" && line[i + 1] === "-" && /[\s]/.test(line[i + 2] ?? " ")) { cut = i; break; }
    }
    out.push(cut === -1 ? line : line.slice(0, cut));
  }
  return out.join("\n");
}

/** Split a clause list on commas at paren depth 0, ignoring quoted text. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** The parenthesised body of a CREATE TABLE, matched bracket for bracket. */
function parenBody(stmt, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < stmt.length; i++) {
    const c = stmt[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "(") { if (depth === 0) from = i; depth++; }
    else if (c === ")") { depth--; if (depth === 0) return stmt.slice(from + 1, i); }
  }
  return null;
}

const NON_COLUMN = /^(PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|FULLTEXT|SPATIAL|CHECK)\b/i;

function readSchema() {
  if (!fs.existsSync(MIGRATIONS)) {
    // Never a skip. Without the migrations there is no schema to compare a spec
    // against, and a gate that shrugs at a missing half of its own comparison
    // is a gate that reports "clean" about nothing at all.
    console.error(`::error::${rel(MIGRATIONS)} does not exist, so no schema could be read and nothing was compared.`);
    process.exit(1);
  }
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  /** table -> Map(column -> { notNull, hasDefault, source }) */
  const tables = new Map();
  const unread = [];
  let statements = 0;

  for (const file of files) {
    const sql = stripComments(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
    for (const raw of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
      statements++;
      const stmt = raw.replace(/\s+/g, " ").trim();

      const create = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?\s*\(/i.exec(stmt);
      if (create) {
        const body = parenBody(stmt, create.index);
        if (body === null) { unread.push(`${file}: unbalanced CREATE TABLE ${create[1]}`); continue; }
        const cols = new Map();
        for (const item of splitTopLevel(body)) {
          if (NON_COLUMN.test(item)) continue;
          const m = /^`([A-Za-z0-9_]+)`\s+(.*)$/s.exec(item);
          if (!m) { unread.push(`${file}: ${create[1]}: unparsed item ${JSON.stringify(item.slice(0, 60))}`); continue; }
          cols.set(m[1], { notNull: /\bNOT\s+NULL\b/i.test(m[2]), hasDefault: /\bDEFAULT\b/i.test(m[2]), dbManaged: /\bON\s+UPDATE\s+CURRENT_TIMESTAMP\b/i.test(m[2]), source: file });
        }
        if (cols.size === 0) { unread.push(`${file}: CREATE TABLE ${create[1]} yielded no columns`); continue; }
        // `IF NOT EXISTS` means a re-declaration is a no-op against a live
        // database, so the FIRST declaration wins here too.
        if (!tables.has(create[1])) tables.set(create[1], cols);
        continue;
      }

      const alter = /^ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?\s+([\s\S]*)$/i.exec(stmt);
      if (alter) {
        const cols = tables.get(alter[1]);
        if (!cols) { unread.push(`${file}: ALTER TABLE ${alter[1]} before any CREATE`); continue; }
        for (const clause of splitTopLevel(alter[2])) {
          let m;
          if ((m = /^ADD\s+(?:COLUMN\s+)?`([A-Za-z0-9_]+)`\s+(.*)$/is.exec(clause))) {
            cols.set(m[1], { notNull: /\bNOT\s+NULL\b/i.test(m[2]), hasDefault: /\bDEFAULT\b/i.test(m[2]), dbManaged: /\bON\s+UPDATE\s+CURRENT_TIMESTAMP\b/i.test(m[2]), source: file });
          } else if ((m = /^MODIFY\s+(?:COLUMN\s+)?`([A-Za-z0-9_]+)`\s+(.*)$/is.exec(clause))) {
            cols.set(m[1], { notNull: /\bNOT\s+NULL\b/i.test(m[2]), hasDefault: /\bDEFAULT\b/i.test(m[2]), dbManaged: /\bON\s+UPDATE\s+CURRENT_TIMESTAMP\b/i.test(m[2]), source: file });
          } else if ((m = /^CHANGE\s+(?:COLUMN\s+)?`([A-Za-z0-9_]+)`\s+`([A-Za-z0-9_]+)`\s+(.*)$/is.exec(clause))) {
            cols.delete(m[1]);
            cols.set(m[2], { notNull: /\bNOT\s+NULL\b/i.test(m[3]), hasDefault: /\bDEFAULT\b/i.test(m[3]), dbManaged: /\bON\s+UPDATE\s+CURRENT_TIMESTAMP\b/i.test(m[3]), source: file });
          } else if ((m = /^DROP\s+(?:COLUMN\s+)?`([A-Za-z0-9_]+)`\s*$/i.exec(clause))) {
            cols.delete(m[1]);
          } else if (!/^(ADD|DROP|ALTER|RENAME|CONVERT|ENGINE|DEFAULT|CHARACTER|COLLATE)\b/i.test(clause)) {
            // An ALTER clause nobody here understands is a hole in the schema
            // this gate believes in, so it is named rather than dropped.
            unread.push(`${file}: ALTER TABLE ${alter[1]}: unparsed clause ${JSON.stringify(clause.slice(0, 60))}`);
          }
        }
        continue;
      }

      const drop = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/i.exec(stmt);
      if (drop) { tables.delete(drop[1]); continue; }

      if (/^(CREATE\s+TABLE|ALTER\s+TABLE)/i.test(stmt)) {
        unread.push(`${file}: unrecognised DDL ${JSON.stringify(stmt.slice(0, 60))}`);
      }
      // Everything else (CREATE INDEX, DROP INDEX, INSERT, UPDATE, DELETE, SET)
      // cannot change a column's name or its nullability, so it is not read.
    }
  }
  return { files, tables, statements, unread };
}

// ── The specs and the payloads, read with the TypeScript compiler ────────────

function sources(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      sources(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const unwrap = (n) => {
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression?.(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression?.(n))) n = n.expression;
  return n;
};

const isFn = (n) =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) || ts.isSourceFile(n);

function fnChain(node) {
  const chain = [];
  for (let n = node; n; n = n.parent) if (isFn(n)) chain.push(n);
  return chain;
}

/** `const name = <object literal>` anywhere in an enclosing scope. */
function bindingFor(name, from) {
  for (let n = from; n; n = n.parent) {
    let found = null;
    const scan = (node) => {
      if (found) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
        const init = unwrap(node.initializer);
        if (ts.isObjectLiteralExpression(init)) found = init;
      }
      ts.forEachChild(node, scan);
    };
    if (isFn(n) || ts.isBlock(n)) { scan(n); if (found) return found; }
  }
  return null;
}

/** Keys the code assigns onto `name` after it was built, in the same function. */
function laterKeys(name, from) {
  const keys = new Set();
  const fn = fnChain(from)[0];
  if (!fn) return keys;
  const scan = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === name
    ) keys.add(node.left.name.text);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isElementAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === name &&
      node.left.argumentExpression &&
      ts.isStringLiteralLike(node.left.argumentExpression)
    ) keys.add(node.left.argumentExpression.text);
    ts.forEachChild(node, scan);
  };
  scan(fn);
  return keys;
}

/** An object literal reduced to the facts this gate needs. */
function readLiteral(lit) {
  const keys = new Set();
  const emptied = new Set();
  let partial = null;
  for (const p of lit.properties) {
    if (ts.isSpreadAssignment(p)) { partial = "spread"; continue; }
    if (!p.name) { partial = "unnamed property"; continue; }
    if (ts.isComputedPropertyName(p.name)) { partial = "computed key"; continue; }
    const key = ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name) ? p.name.text : null;
    if (key === null) { partial = "unreadable key"; continue; }
    keys.add(key);
    if (ts.isPropertyAssignment(p)) {
      const v = unwrap(p.initializer);
      if (v.kind === ts.SyntaxKind.NullKeyword) emptied.add(key);
      else if (ts.isIdentifier(v) && v.text === "undefined") emptied.add(key);
    }
  }
  return { keys, emptied, partial };
}

function readSources() {
  /** repo variable name -> spec */
  const repos = new Map();
  /** { repo, file, line, keys, emptied, via } */
  const payloads = [];
  const unresolved = [];
  const files = SCAN_ROOTS.flatMap((r) => sources(path.join(ROOT, r)));

  const specs = [];
  let specFiles = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes("dbCollection")) continue;
    specFiles++;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === "dbCollection"
      ) {
        const arg = node.initializer.arguments[1];
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        if (!arg || !ts.isObjectLiteralExpression(arg)) {
          unresolved.push({ what: `spec for ${node.name.text}`, where: `${rel(file)}:${line}`, why: "the spec is not an object literal" });
          return;
        }
        let table = null;
        const columns = [];
        for (const p of arg.properties) {
          if (!ts.isPropertyAssignment(p) || !p.name || !ts.isIdentifier(p.name)) continue;
          if (p.name.text === "table" && ts.isStringLiteralLike(p.initializer)) table = p.initializer.text;
          if (p.name.text === "columns" && ts.isArrayLiteralExpression(p.initializer)) {
            for (const el of p.initializer.elements) {
              if (!ts.isObjectLiteralExpression(el)) continue;
              const col = {};
              for (const q of el.properties) {
                if (!ts.isPropertyAssignment(q) || !q.name || !ts.isIdentifier(q.name)) continue;
                if (ts.isStringLiteralLike(q.initializer)) col[q.name.text] = q.initializer.text;
                else if (q.initializer.kind === ts.SyntaxKind.TrueKeyword) col[q.name.text] = true;
                else if (q.initializer.kind === ts.SyntaxKind.FalseKeyword) col[q.name.text] = false;
              }
              if (col.js && col.db) columns.push(col);
            }
          }
        }
        if (!table || columns.length === 0) {
          unresolved.push({ what: `spec for ${node.name.text}`, where: `${rel(file)}:${line}`, why: "no table name or no columns could be read" });
          return;
        }
        specs.push({ name: node.name.text, table, columns, where: `${rel(file)}:${line}` });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  for (const s of specs) repos.set(s.name, s);

  const at = (sf, node) => `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  /**
   * The payload pass reads EVERY scanned file that names a repo, not only the
   * ones that say `dbCollection`.
   *
   * The first draft reused the spec pass's parse, which meant a repo exported
   * out of server/index.ts and written to from a lib file would have had its
   * inserts checked by nothing, and the run would still have printed a green.
   * Today every spec and every write live in one file and the two passes read
   * the same list; the day one moves, only this version notices.
   */
  const parsed = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (![...repos.keys()].some((name) => src.includes(name))) continue;
    parsed.push({ file, sf: ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true) });
  }

  for (const { sf } of parsed) {
    /** `<repo>.replaceAll(<identifier>)` — the array a push has to reach. */
    const arrays = [];
    const collect = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "replaceAll" &&
        ts.isIdentifier(node.expression.expression) &&
        repos.has(node.expression.expression.text)
      ) {
        const arg = unwrap(node.arguments[0]);
        if (arg && ts.isIdentifier(arg)) {
          /*
           * The NEAREST enclosing function, not the whole chain. Every chain
           * ends at the SourceFile, so matching on "shares any ancestor" made
           * every `rows.push(...)` in the file belong to every
           * `repo.replaceAll(rows)` in the file. Those names are `all`, `rows`,
           * `filtered` and `keep`: a collision was a matter of time, and it
           * would have attributed a payload to the wrong table.
           */
          arrays.push({ repo: node.expression.expression.text, name: arg.text, fn: fnChain(node)[0] });
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(sf);

    const take = (repoName, argNode, refNode, via) => {
      const where = at(sf, refNode);
      let lit = unwrap(argNode);
      let name = null;
      if (lit && ts.isIdentifier(lit)) {
        name = lit.text;
        lit = bindingFor(name, refNode);
      }
      if (!lit || !ts.isObjectLiteralExpression(lit)) {
        unresolved.push({ what: `${repoName}.${via}`, where, why: name ? `\`${name}\` is not bound to an object literal in this function` : "the argument is not an object literal" });
        return;
      }
      const { keys, emptied, partial } = readLiteral(lit);
      if (partial) {
        unresolved.push({ what: `${repoName}.${via}`, where, why: `the literal carries a ${partial}, so an absent key cannot be read as absent` });
        return;
      }
      if (name) for (const k of laterKeys(name, refNode)) keys.add(k);
      payloads.push({ repo: repoName, where, keys, emptied, via });
    };

    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
        const recv = node.expression.expression.text;
        const method = node.expression.name.text;
        if (method === "insert" && repos.has(recv) && node.arguments[0]) {
          take(recv, node.arguments[0], node, "insert");
        } else if (method === "push" && node.arguments[0]) {
          const chain = fnChain(node);
          const owner = arrays.find((a) => a.name === recv && chain.includes(a.fn));
          if (owner) take(owner.repo, node.arguments[0], node, "push -> replaceAll");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return { repos, payloads, unresolved, scanned: files.length, specFiles, read: parsed.length };
}

// ── The comparison ───────────────────────────────────────────────────────────

const schema = readSchema();
const code = readSources();

const drift = [];
const missing = [];

for (const spec of code.repos.values()) {
  const cols = schema.tables.get(spec.table);
  if (!cols) {
    drift.push({ repo: spec.name, where: spec.where, detail: `names table \`${spec.table}\`, which no migration in drizzle/ creates` });
    continue;
  }
  for (const c of spec.columns) {
    if (!cols.has(c.db)) {
      drift.push({ repo: spec.name, where: spec.where, detail: `spec'd column \`${spec.table}\`.\`${c.db}\` (js \`${c.js}\`) does not exist in the schema` });
    }
  }
}

/*
 * RULE 3, THE MIRROR OF RULE 1: a column the TABLE has and the SPEC omits.
 *
 * Rule 1 catches a spec naming a column that is not there, which breaks the
 * boot read loudly. This is the same drift pointing the other way and it is
 * the quiet one: `replaceAll` is DELETE-all plus a re-INSERT of exactly the
 * spec'd columns, so a column left OUT is not left alone. It is re-defaulted,
 * on every row in the table, from one steward editing one row.
 *
 * Three columns have been found this way and each one had to be found by a
 * person reading the file:
 *
 *   circles.created_at         every admin circle edit reset EVERY circle's
 *                              birth date to the moment of that edit
 *   circles.home_structure_key the address plane's column (0060), wiped
 *                              village-wide by any admin circle edit
 *   roles.created_at           the same as the first, one table over, and it
 *                              survived the round that fixed the first
 *
 * The `circles.created_at` fix carried a comment naming the trap, and the
 * comment did not find its twin. A rule does.
 *
 * THE ONE EXEMPTION, and it is principled rather than a waiver list: a column
 * declared `ON UPDATE CURRENT_TIMESTAMP` is maintained by MySQL. A spec must
 * NOT name it, because naming it would hand the database a value on every
 * write and take the maintenance away. `tools.updated_at` is the live case.
 */
const omitted = [];
for (const spec of code.repos.values()) {
  const cols = schema.tables.get(spec.table);
  if (!cols) continue;
  const specd = new Set(spec.columns.map((c) => c.db));
  for (const [name, col] of cols) {
    if (specd.has(name) || col.dbManaged) continue;
    omitted.push({ repo: spec.name, where: spec.where, table: spec.table, column: name, col });
  }
}

/** The columns an insert MUST name, per repo, with the reason it must. */
const required = new Map();
for (const spec of code.repos.values()) {
  const cols = schema.tables.get(spec.table);
  if (!cols) continue;
  const need = [];
  for (const c of spec.columns) {
    const col = cols.get(c.db);
    if (!col || !col.notNull) continue;
    if (c.kind === "bool") continue;      // toDb writes 0 for an absent boolean.
    if (c.defaultNow) continue;           // toDb writes new Date() for an absent time.
    need.push({ ...c, hasDefault: col.hasDefault });
  }
  required.set(spec.name, need);
}

for (const p of code.payloads) {
  const spec = code.repos.get(p.repo);
  for (const c of required.get(p.repo) ?? []) {
    if (!p.keys.has(c.js)) {
      missing.push({ ...p, table: spec.table, js: c.js, db: c.db, hasDefault: c.hasDefault, how: "never names" });
    } else if (p.emptied.has(c.js)) {
      missing.push({ ...p, table: spec.table, js: c.js, db: c.db, hasDefault: c.hasDefault, how: "hands a literal null to" });
    }
  }
}

const totalColumns = [...schema.tables.values()].reduce((n, c) => n + c.size, 0);
const totalRequired = [...required.values()].reduce((n, c) => n + c.length, 0);

/*
 * `--columns <table>` prints what the DDL parse believes about one table, so
 * the parse can be audited against a live `SHOW COLUMNS` rather than trusted.
 * Every rule this gate applies rests on that read being right, and the ALTER
 * paths (MODIFY, CHANGE, DROP COLUMN) each run in only one or two migrations,
 * so nothing else would ever exercise them where a person could look.
 */
const wanted = process.argv[process.argv.indexOf("--columns") + 1];
if (process.argv.includes("--columns")) {
  const cols = schema.tables.get(wanted);
  if (!cols) {
    console.error(`::error::no table \`${wanted}\` after ${schema.files.length} migration file(s). ${schema.tables.size} table(s) were parsed.`);
    process.exit(1);
  }
  console.log(`  \`${wanted}\`: ${cols.size} column(s), after ${schema.files.length} migration file(s)`);
  for (const [name, c] of cols) {
    console.log(`    ${name.padEnd(28)} ${c.notNull ? "NOT NULL" : "NULL    "}  ${c.hasDefault ? "has DEFAULT" : ""}  (${c.source})`);
  }
  process.exit(0);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({
    migrations: schema.files.length,
    statements: schema.statements,
    tables: schema.tables.size,
    columns: totalColumns,
    repos: [...code.repos.values()].map((s) => ({ name: s.name, table: s.table, columns: s.columns.length, where: s.where })),
    payloads: code.payloads.map((p) => ({ repo: p.repo, where: p.where, via: p.via, keys: [...p.keys] })),
    unresolved: code.unresolved,
    unread: schema.unread,
    drift,
    missing: missing.map((m) => ({ repo: m.repo, where: m.where, table: m.table, column: m.db, field: m.js, how: m.how })),
    omitted: omitted.map((o) => ({ repo: o.repo, where: o.where, table: o.table, column: o.column, notNull: o.col.notNull, source: o.col.source })),
  }, null, 2));
  process.exit(drift.length + missing.length + omitted.length > 0 ? 1 : 0);
}

// Provenance first, on every run including the green one, because a gate that
// matched nothing prints the same green as a gate that matched everything.
console.log(`  ${schema.files.length} migration file(s) in drizzle/, ${schema.statements} statement(s), ${schema.tables.size} table(s), ${totalColumns} column(s)`);
console.log(`  ${code.scanned} source file(s) under ${SCAN_ROOTS.join("/, ")}/; ${code.specFiles} mention dbCollection and gave ${code.repos.size} repo spec(s); ${code.read} name a repo and were read for payloads`);
console.log(`  ${totalRequired} spec'd column(s) are NOT NULL and rescued by neither bool nor defaultNow`);
console.log(`  ${code.payloads.length} payload literal(s) checked, ${code.unresolved.length} not readable statically`);

for (const u of code.unresolved) {
  console.log(`    not checked  ${u.where}  ${u.what}: ${u.why}`);
}
for (const u of schema.unread) {
  console.log(`    not read     ${u}`);
}

if (process.argv.includes("--table")) {
  console.log("");
  for (const spec of code.repos.values()) {
    const need = (required.get(spec.name) ?? []).map((c) => c.js);
    console.log(`  ${spec.name} -> \`${spec.table}\` (${spec.columns.length} column(s)); must name: ${need.length ? need.join(", ") : "nothing"}`);
    for (const p of code.payloads.filter((x) => x.repo === spec.name)) {
      const bad = need.filter((k) => !p.keys.has(k) || p.emptied.has(k));
      console.log(`      ${(bad.length ? "BROKEN" : "ok").padEnd(7)} ${p.where}  ${p.via}`);
    }
  }
  console.log("");
}

// A read that found nothing is a broken read, not a clean tree. Each floor
// names the half of the comparison that came back empty.
let broke = false;
if (schema.tables.size < MIN_TABLES) {
  console.error(`::error::read only ${schema.tables.size} table(s) out of ${schema.files.length} migration file(s) in drizzle/, below the ${MIN_TABLES} this schema has had for a long time. That is a broken parse, not a small schema, and every payload below it would be checked against nothing.`);
  broke = true;
}
if (code.repos.size < MIN_REPOS) {
  console.error(`::error::read only ${code.repos.size} dbCollection spec(s) from ${SCAN_ROOTS.join(", ")}, below the ${MIN_REPOS} this server has had since S12. Either the specs moved out of server/index.ts or dbCollection was renamed; either way nothing was compared.`);
  broke = true;
}
if (code.payloads.length < MIN_PAYLOADS) {
  console.error(`::error::found only ${code.payloads.length} readable payload literal(s), below the ${MIN_PAYLOADS} these routes have carried for a long time. A gate that matches zero inserts prints exactly the same green as a gate that checked them all.`);
  broke = true;
}
if (broke) process.exit(1);

if (drift.length > 0) {
  console.error("");
  console.error(`::error::${drift.length} dbCollection spec(s) name a column the schema does not have. load() SELECTs every spec'd column by name, so this breaks the boot read as well as every write.`);
  for (const d of drift) console.error(`  ${d.where}  ${d.repo}: ${d.detail}`);
  console.error("");
  console.error("  Either add the column in a new drizzle/ migration, or take it out of the spec.");
}

if (missing.length > 0) {
  console.error("");
  const broken = new Set(missing.map((m) => m.where)).size;
  console.error(`::error::${broken} insert payload(s) cannot succeed, over ${missing.length} column(s). dbCollection names every spec'd column on every INSERT, so an absent key is written as an explicit NULL and the column DEFAULT never applies.`);
  for (const m of missing) {
    const def = m.hasDefault ? ", which has a DEFAULT that will never be reached" : "";
    console.error(`  ${m.where}  ${m.repo}.${m.via}: ${m.how} \`${m.js}\` for \`${m.table}\`.\`${m.db}\`, NOT NULL${def}`);
  }
  console.error("");
  console.error("  This route throws on every call, in every version, against every schema this");
  console.error("  repo has had. Name the column in the payload, or take it out of the spec in");
  console.error("  server/index.ts so the INSERT stops naming it and the DEFAULT can apply.");
}

if (omitted.length > 0) {
  console.error("");
  const tables = new Set(omitted.map((o) => o.table)).size;
  console.error(`::error::${omitted.length} column(s) across ${tables} table(s) exist in the schema and are missing from their dbCollection spec. replaceAll is DELETE-all plus a re-INSERT of exactly the spec'd columns, so each of these is RE-DEFAULTED on every row in its table whenever anything writes that collection.`);
  for (const o of omitted) {
    const shape = `${o.col.notNull ? "NOT NULL" : "NULL"}${o.col.hasDefault ? " with a DEFAULT" : ""}`;
    console.error(`  ${o.where}  ${o.repo}: \`${o.table}\`.\`${o.column}\` (${shape}, ${o.col.source}) is not in the spec`);
  }
  console.error("");
  console.error("  Add the column to the spec in server/index.ts so its value survives the round");
  console.error("  trip. A NOT NULL timestamp wants `kind: \"time\", defaultNow: true`, which carries");
  console.error("  an existing value through and stamps now only for a row that genuinely has none.");
  console.error("  A column MySQL maintains itself (ON UPDATE CURRENT_TIMESTAMP) is exempt and is");
  console.error("  never reported here.");
}

if (drift.length + missing.length + omitted.length > 0) process.exit(1);

console.log(`  every payload names every column its table requires, every spec'd column exists, and no column is left out of its spec to be re-defaulted`);
