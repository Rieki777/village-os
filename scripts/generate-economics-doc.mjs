/**
 * NO SHEBANG, and it has to stay that way.
 *
 * Same reason `scripts/generate-token-doc.mjs` carries that rule and the same
 * reason `scripts/check-identity-keys.mjs` does: this file is imported, not
 * only executed, so it can go through a bundler's transform as well as node,
 * and A SHEBANG PLUS CRLF LINE ENDINGS makes that transform throw
 * `SyntaxError: Invalid or unexpected token`. Either one alone is fine.
 * `core.autocrlf` is true on the Windows checkouts this repository is
 * developed on, so the failure appears at a rebase and not at the edit that
 * caused it. The self-test asserts the line is still absent.
 */
/**
 * THE FACTS IN docs/ECONOMICS.md, WRITTEN FROM THE CODE RATHER THAN ABOUT IT.
 *
 * `docs/TOKENS.md` is generated whole. This document cannot be, and the
 * difference is the point: most of ECONOMICS.md is narrative that no reader
 * can derive from a switch statement (why a lock that stops one member racing
 * themselves is what makes the village fail against each other, what a member
 * sees when a spend refuses, what a departing member is owed). Prose like that
 * has to be written and it can drift.
 *
 * So the document is SPLIT. Every fact that a machine can read out of the code
 * lives inside a marked region:
 *
 *     <!-- generated:tokens start -->
 *     ...written by this script, never by hand...
 *     <!-- generated:tokens end -->
 *
 * and `scripts/check-economics-doc.mjs` regenerates each region and fails the
 * build when the committed text and the code have come apart. Everything
 * outside the markers is prose, and `scripts/check-economics-narrative.mjs`
 * is the guard on that half: it fails when the economy's code moved and the
 * document did not.
 *
 * WHAT IT DESCRIBES. A FRESH village: what a founder standing up a new
 * instance gets on the first boot. Not the live deployment, which has history
 * and which no script here can reach.
 *
 * WHAT IT READS, AND THE RULE FOR EACH READER. Every reader is ANCHORED and
 * FAILS LOUD. If the shape it expects is gone it throws, naming the file and
 * the text it could not read, and the check exits 2 rather than 0. A reader
 * that silently returns nothing when the code moves is worse than no reader:
 * the document keeps rendering and quietly loses a faucet.
 *
 *   scripts/generate-token-doc.mjs   the registry, faucets, sinks and seeded
 *                                    rules, through ITS readers rather than a
 *                                    second copy of them (see below)
 *   server/lib/ledger.ts             checkLedgerInvariants: what boot refuses
 *   server/lib/economy.ts            the `keys` object: every occurrence key
 *
 * WHY IT IMPORTS THE TOKEN GENERATOR INSTEAD OF COPYING IT. Those readers are
 * anchored, fail loud, and are already proved twice over: by
 * `scripts/generate-token-doc.test.mjs` and by `server/db/tokenDoc.test.ts`,
 * which runs every migration against a real MySQL and asserts the SQL
 * interpreter's rows equal the database's. A second copy of that interpreter
 * would be a second thing to keep true, and the first time the two disagreed
 * one document would be right and the other would look right. Nothing here
 * writes docs/TOKENS.md or calls its renderer; only the readers are used.
 *
 * NO SERVER TYPESCRIPT IS IMPORTED AT RUNTIME, for the same reason the token
 * generator does not: `server/lib/economy.ts` reaches a database on load. The
 * TypeScript compiler parses the files as text and the readers walk the AST.
 *
 * Usage:
 *   node scripts/generate-economics-doc.mjs           rewrite the regions in place
 *   node scripts/generate-economics-doc.mjs --stdout  print them, write nothing
 *   node scripts/generate-economics-doc.mjs --list    print what it reads
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { collectFacts } from "./generate-token-doc.mjs";

export const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
);

export const DOC_RELATIVE = "docs/ECONOMICS.md";
export const DOC_PATH = path.join(ROOT, "docs", "ECONOMICS.md");

/**
 * Every file the generated regions are derived from. Existence is checked
 * before anything is parsed, so a rename fails with the path it wanted rather
 * than with a parse error twenty frames deep.
 *
 * `drizzle` and the token generator's own source list are read through
 * `collectFacts`, which checks them itself and throws the same way.
 */
export const SOURCES = [
  "drizzle",
  "server/lib/economy.ts",
  "server/lib/economySeed.ts",
  "server/lib/ledger.ts",
  "server/lib/spending.ts",
  "server/lib/exit.ts",
  "server/lib/voiceClaim.ts",
  "server/lib/redemption.ts",
  "shared/gameVariables.ts",
];

/** Thrown when the code no longer has the shape a reader is anchored to. */
export class ReadError extends Error {}

function fail(message) {
  throw new ReadError(message);
}

// ── TypeScript: anchored reads ──────────────────────────────────────────────

const sourceCache = new Map();

function sourceFile(abs) {
  if (!sourceCache.has(abs)) {
    if (!fs.existsSync(abs)) fail(`economics-doc: ${abs} is gone; the generator reads it`);
    sourceCache.set(
      abs,
      ts.createSourceFile(abs, fs.readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true),
    );
  }
  return sourceCache.get(abs);
}

function eachChild(node, fn) {
  node.forEachChild((child) => {
    fn(child);
    eachChild(child, fn);
  });
}

/** Top-level `const NAME = ...` in a file, by name. */
function constInit(abs, name) {
  const sf = sourceFile(abs);
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) return d.initializer;
    }
  }
  return null;
}

/** A named function declaration, by name. */
function functionNamed(abs, name) {
  const sf = sourceFile(abs);
  let found;
  eachChild(sf, (n) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n;
  });
  if (!found) fail(`economics-doc: ${path.basename(abs)} no longer declares function ${name}()`);
  return found;
}

/**
 * Every occurrence key the economy can write, read out of `keys` in
 * server/lib/economy.ts.
 *
 * Each entry is an arrow function returning ONE template literal, and that is
 * asserted rather than assumed: a key built by concatenation or by a helper
 * would render as an empty shape here and the table would announce a key
 * format that is not the one the ledger holds. The parameter names are the
 * placeholders, so the rendered shape reads the way a row in the database
 * reads.
 *
 * WHY THE SHAPE IS WORTH PRINTING AT ALL. `keys.roleCycle`'s own comment
 * records what changing one of these costs: when the cycle id's spelling
 * moved, every already-paid seat in the open lunation looked unpaid, and a
 * migration had to rename the historical keys in the same change. A format
 * nobody can see is a format nobody checks before editing.
 */
export function occurrenceKeys(root = ROOT) {
  const abs = path.join(root, "server", "lib", "economy.ts");
  const init = constInit(abs, "keys");
  if (!init || !ts.isObjectLiteralExpression(init)) {
    fail("economics-doc: server/lib/economy.ts no longer declares `export const keys = { ... }`");
  }
  const out = [];
  for (const prop of init.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      fail(
        `economics-doc: an entry in \`keys\` (server/lib/economy.ts) is not a plain \`name: fn\` ` +
          `assignment, and this reader cannot follow it: ${prop.getText().slice(0, 80)}`,
      );
    }
    const fn = prop.initializer;
    if (!ts.isArrowFunction(fn)) {
      fail(`economics-doc: keys.${prop.name.text} is not an arrow function; the reader cannot follow it`);
    }
    const params = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : p.name.getText()));
    const body = fn.body;
    if (!ts.isTemplateExpression(body) && !ts.isNoSubstitutionTemplateLiteral(body)) {
      fail(
        `economics-doc: keys.${prop.name.text} no longer returns a single template literal ` +
          `(it returns ${ts.SyntaxKind[body.kind]}). The document prints the key SHAPE, and a ` +
          "key assembled another way would render as a shape the ledger never holds.",
      );
    }
    let shape;
    if (ts.isNoSubstitutionTemplateLiteral(body)) {
      shape = body.text;
    } else {
      shape = body.head.text;
      for (const span of body.templateSpans) {
        const e = span.expression;
        shape += ts.isIdentifier(e) ? `<${e.text}>` : `<${e.getText()}>`;
        shape += span.literal.text;
      }
    }
    out.push({ name: prop.name.text, params, shape });
  }
  if (!out.length) fail("economics-doc: `keys` in server/lib/economy.ts is empty");
  return out;
}

/**
 * What every boot refuses, read out of `checkLedgerInvariants` in
 * server/lib/ledger.ts.
 *
 * READ FROM THE BODY, NOT FROM THE COMMENT ABOVE IT. That function carries a
 * numbered list in its own JSDoc, and reading that list would be reading prose
 * about the code, which is the failure this whole pipeline exists to stop: the
 * comment can say six while the body runs five.
 *
 * Each check in that body is a query followed by a loop that pushes one
 * sentence per row, so the reader pairs them in source order: the most recent
 * query is the one a `problems.push` belongs to. That pairing is CHECKED, not
 * assumed. A push with no query before it, or a query with no push after it,
 * means the shape moved and this throws rather than dropping an invariant
 * from the document in silence.
 */
/**
 * One string, template literal, or `+` chain of them, rendered with its
 * interpolations turned into `<placeholder>`. Returns null for anything else.
 *
 * ONE READER FOR BOTH THE REFUSALS AND THE INVARIANTS, because they kept
 * meeting the same shapes one at a time. `sendRefusal` wraps a sentence across
 * a `+` to fit the line and so does the uncredited finding in
 * `checkLedgerInvariants`; each was found separately, by a reader that could
 * not read it, and fixing it in one place left the other blind. The `+` join
 * is strict: every leaf must itself be readable, so a genuine
 * `"..." + someVariable` still returns null and the caller still throws
 * rather than printing half a sentence.
 */
/**
 * The name to print inside `<...>` for one interpolated expression.
 *
 * NAME THE COLUMN BEING READ, NOT THE FUNCTION READING IT. `${r.kind}` is
 * plainly `<kind>`, but the uncredited finding interpolates
 * `${Number(lost[0].units)}` and
 * `${new Date(lost[0].last_at).toISOString()}`, and printing those verbatim
 * puts the coercion wrapper in a table a founder reads. The rule is one line
 * and it is not a guess: take the last property access that is NOT the callee
 * of a call, which is the value being read rather than the method reading it,
 * so `Number(lost[0].units)` gives `units` and
 * `new Date(lost[0].last_at).toISOString()` gives `last_at` rather than
 * `toISOString`.
 *
 * Falls back to the expression's own collapsed text when there is no such
 * access at all (`${recognitionName()}` has none), because an honest ugly
 * placeholder beats an invented pretty one.
 */
function placeholderFor(node) {
  const named = [];
  const visit = (n) => {
    if (ts.isPropertyAccessExpression(n)) {
      const isCallee =
        n.parent && (ts.isCallExpression(n.parent) || ts.isNewExpression(n.parent)) && n.parent.expression === n;
      if (!isCallee) named.push(n.name.text);
    }
    n.forEachChild(visit);
  };
  visit(node);
  return named.length ? named[named.length - 1] : node.getText().replace(/\s+/g, " ");
}

function literalText(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    for (const span of node.templateSpans) {
      s += `<${placeholderFor(span.expression)}>`;
      s += span.literal.text;
    }
    return s;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalText(node.left);
    const right = literalText(node.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

/**
 * ── THE ONE ACCEPTED SHAPE FOR A KEYSTONE SET ──────────────────────────────
 *
 * `new Set([ "a", "b" ])` with every element a plain string literal, and
 * NOTHING ELSE.
 *
 * WHY THIS READER EXISTS BESIDE `setConst`. `scripts/generate-token-doc.mjs`
 * reads these sets with `setConst`, which walks the initialiser and takes the
 * FIRST array literal it finds. That reads the shape of the source text rather
 * than the value the program holds, so every one of these passes it unchanged:
 *
 *     new Set([...].concat(["spend"]))
 *     new Set(process.env.NODE_ENV === "test" ? [...3...] : [...4...])
 *     new Set([...].filter((s) => s !== "reversal"))
 *
 * The adversary pass (F7) drove all three past BOTH doc guards AND the
 * `payments.test.ts` pin, which compares the set inside a process that
 * identifies itself as the test environment and therefore cannot see the
 * ternary at all. `ALLOW_NEGATIVE_SOURCES` is the set that decides which
 * sources may drive a member's balance below zero, and its own comment calls
 * it "static ON PURPOSE"; this is the mechanism by which it gets widened in
 * production with every gate green.
 *
 * So this reader does not ask what array literal is in there. It asks whether
 * the declaration is EXACTLY one of the two shapes a keystone set is allowed
 * to have, and refuses everything else by name. A reader that accepts a family
 * of shapes can be walked past; a reader that accepts a fixed list can only be
 * walked past by changing the shape, which is a diff somebody reviews.
 *
 *     new Set(["a", "b"])        every element a plain string literal
 *     frozenSet(["a", "b"])      the same, through the helper that seals it
 *
 * `frozenSet` is the second form because the keystone lane is closing F14 by
 * sealing these sets against runtime mutation: it returns a Set whose add,
 * delete and clear throw. The wrapper changes what the value can DO, not what
 * it IS, so the list reads the same out of either and both documents keep
 * saying the same thing across that change.
 *
 * A THIRD form is a deliberate one-line addition here, never something this
 * function infers. `scripts/generate-token-doc.mjs`'s `setConst` accepts the
 * same two and refuses the same way, so the two documents cannot disagree
 * about what a keystone set is allowed to look like.
 */
/**
 * The SOURCE TEXT of a top-level const's initialiser.
 *
 * Exists so check-economics-doc.test.mjs can evaluate the expression in a
 * subprocess under NODE_ENV=production and compare the value the program
 * actually holds with the list this document prints. `frozenStringSet` reads
 * the shape; that test reads the value; F7 is the gap between the two.
 */
export function constInitializerText(root, relFile, name) {
  const abs = path.join(root, relFile);
  const init = constInit(abs, name);
  if (!init) fail(`economics-doc: ${relFile} no longer declares ${name}`);
  return init.getText();
}

export function frozenStringSet(root, relFile, name) {
  const abs = path.join(root, relFile);
  const init = constInit(abs, name);
  if (!init) fail(`economics-doc: ${relFile} no longer declares ${name}`);

  const shapeOf = (n) => n.getText().replace(/\s+/g, " ").slice(0, 160);
  const refuse = (why) =>
    fail(
      `economics-doc: ${name} in ${relFile} is ${why}, and this reader accepts exactly two shapes:\n` +
        `    new Set(["a", "b"])\n` +
        `    frozenSet(["a", "b"])\n` +
        `  every element a plain string literal. It found:\n    ${shapeOf(init)}\n` +
        "  This set decides real behaviour and is read into the document as a list of values. A " +
        "declaration whose value cannot be read off the source text (a .concat, a .filter, an " +
        "environment-keyed ternary) makes the document state a list the program does not hold. " +
        "If a new form is deliberate, teach this reader that one form.",
    );

  let args;
  if (ts.isNewExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "Set") {
    args = init.arguments ?? [];
  } else if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "frozenSet") {
    args = init.arguments ?? [];
  } else {
    refuse("neither a `new Set(...)` nor a `frozenSet(...)`");
  }
  if (args.length !== 1) refuse(`built from ${args.length} argument(s) rather than exactly one`);
  const arr = args[0];
  if (!ts.isArrayLiteralExpression(arr)) refuse("built from something other than a plain array literal");
  const out = [];
  for (const el of arr.elements) {
    if (!ts.isStringLiteral(el) && !ts.isNoSubstitutionTemplateLiteral(el)) {
      refuse(`built from an array holding \`${shapeOf(el)}\`, which is not a plain string literal`);
    }
    out.push(el.text);
  }
  if (!out.length) refuse("an empty set, which no keystone set is");
  return out;
}

/**
 * The string-array accumulators a function declares, by name.
 *
 * `checkLedgerInvariants` collects its output into local `const x = []`
 * declarations, and which one a finding lands in is the whole difference
 * between "boot refuses" and "a founder should read this". Read rather than
 * assumed: hardcoding the names would have to be edited every time the
 * function grows another, and editing it is exactly what nobody does.
 */
function accumulators(fn) {
  const names = [];
  eachChild(fn, (n) => {
    if (!ts.isVariableDeclaration(n) || !ts.isIdentifier(n.name)) return;
    if (n.initializer && ts.isArrayLiteralExpression(n.initializer) && n.initializer.elements.length === 0) {
      names.push(n.name.text);
    }
  });
  return names;
}

/**
 * Which accumulators decide `ok`, read out of the return statement.
 *
 * THIS IS THE PART THAT MUST NOT BE GUESSED. `checkLedgerInvariants` returns
 * `{ ok: problems.length === 0, problems, uncredited }`, so `problems` gates
 * boot and `uncredited` deliberately does not: the first are corruptions and a
 * village whose books do not add up must not serve, the second is a real loss
 * that is no reason to take the village offline. Writing "problems blocks,
 * uncredited does not" into this file would be a fact about today that the
 * document would keep printing after somebody changed it.
 *
 * So the set is derived from the `ok` expression itself, and an `ok` this
 * reader cannot follow is a THROW rather than a shrug: reporting a finding as
 * a boot refusal, or a boot refusal as a finding, are both worse than
 * refusing to render.
 */
function bootGating(fn, names) {
  let okExpr;
  eachChild(fn, (n) => {
    if (okExpr || !ts.isReturnStatement(n) || !n.expression) return;
    if (!ts.isObjectLiteralExpression(n.expression)) return;
    const ok = n.expression.properties.find(
      (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "ok",
    );
    if (ok) okExpr = ok.initializer;
  });
  if (!okExpr) {
    fail(
      "economics-doc: checkLedgerInvariants() no longer returns an object literal with an `ok` " +
        "property. The document states which findings refuse boot and which are only reported, and " +
        "that distinction is read from `ok`. It will not guess at it.",
    );
  }
  const gating = new Set();
  eachChild(okExpr, (n) => {
    if (!ts.isPropertyAccessExpression(n) || n.name.text !== "length") return;
    if (ts.isIdentifier(n.expression) && names.includes(n.expression.text)) gating.add(n.expression.text);
  });
  if (!gating.size) {
    fail(
      `economics-doc: checkLedgerInvariants()'s \`ok\` is computed from something other than the ` +
        `length of ${names.join(", ")}, and this reader cannot tell which findings refuse boot. ` +
        "Teach it the new shape rather than letting the document guess.",
    );
  }
  return gating;
}

export function invariantChecks(root = ROOT) {
  const abs = path.join(root, "server", "lib", "ledger.ts");
  const fn = functionNamed(abs, "checkLedgerInvariants");

  const names = accumulators(fn);
  if (!names.length) {
    fail("economics-doc: checkLedgerInvariants() declares no string accumulator; the reader cannot follow it");
  }
  const gating = bootGating(fn, names);

  const found = [];
  let pendingSql = null;
  let pendingQueryOrder = -1;
  let order = 0;

  const sqlOf = (node) => {
    let sql = null;
    eachChild(node, (n) => {
      if (sql) return;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
        if (/\bFROM\b|\bSELECT\b/i.test(n.text)) sql = n.text;
      }
      // Concatenated string chains: take the whole joined text.
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        ts.isStringLiteral(n.left) &&
        /\bSELECT\b/i.test(n.left.text)
      ) {
        const parts = [];
        const walk = (b) => {
          if (ts.isBinaryExpression(b) && b.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            walk(b.left);
            walk(b.right);
            return;
          }
          if (ts.isStringLiteral(b) || ts.isNoSubstitutionTemplateLiteral(b)) parts.push(b.text);
        };
        walk(n);
        sql = parts.join("");
      }
    });
    return sql;
  };

  eachChild(fn, (n) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const isQuery =
        ts.isPropertyAccessExpression(callee) && callee.name.text === "query";
      if (isQuery) {
        const sql = sqlOf(n);
        if (sql) {
          order += 1;
          pendingSql = sql.replace(/\s+/g, " ").trim();
          pendingQueryOrder = order;
        }
        return;
      }
      /*
       * A push into ANY of the function's accumulators, not just `problems`.
       *
       * This used to name `problems` alone, and the day a seventh read landed
       * whose finding goes into `uncredited` the reader paired six findings
       * with seven reads and REFUSED, which is what brought this change about.
       * It refused rather than printing six, and that is the behaviour to
       * keep: widening the match is teaching it a real shape, and the count
       * check below is untouched.
       */
      const isPush =
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "push" &&
        ts.isIdentifier(callee.expression) &&
        names.includes(callee.expression.text);
      if (!isPush) return;
      const into = callee.expression.text;
      if (!pendingSql) {
        fail(
          `economics-doc: checkLedgerInvariants() pushes into ${into} with no query before it. ` +
            "The reader pairs each finding with the read that produced it and can no longer do so.",
        );
      }
      const message = literalText(n.arguments[0]);
      if (message === null) {
        fail(
          `economics-doc: a ${into}.push() in checkLedgerInvariants() no longer carries a string, ` +
            `template literal, or concatenation of them (${ts.SyntaxKind[n.arguments[0].kind]}); ` +
            "the reader cannot print what it found.",
        );
      }
      found.push({
        order: pendingQueryOrder,
        sql: pendingSql,
        message: message.replace(/\s+/g, " ").trim(),
        into,
        refusesBoot: gating.has(into),
      });
      pendingSql = null;
    }
  });

  if (!found.length) {
    fail("economics-doc: checkLedgerInvariants() no longer pushes any finding; the reader found no invariants");
  }
  if (found.length !== order) {
    fail(
      `economics-doc: checkLedgerInvariants() runs ${order} read(s) and produced ${found.length} ` +
        `finding(s), into ${names.join(", ")}. One of them is a read whose finding this reader could ` +
        "not find, which means the document would print fewer invariants than boot actually enforces.",
    );
  }
  return found;
}

/**
 * The refusal sentences one function can hand a member, in the order it
 * checks them.
 *
 * WHY THE ORDER MATTERS ENOUGH TO PRINT. `sendGratitude`'s header calls the
 * order of refusals part of the contract, and `checkGive` says the same in its
 * own words: the most specific and most private reason wins, so a member is
 * told the useful thing rather than the first thing. A document that listed
 * these alphabetically would lose the only property anybody needs from them.
 *
 * TWO SHAPES, because the two files answer differently. `server/lib/spending.ts`
 * returns the sentence directly (`return "..."`), while `checkGive` returns
 * `{ ok: false, error: "..." }`. Both are read: any string or template literal
 * that is either returned or assigned to a property named `error`. Anything
 * else in that position throws, because a refusal assembled from a variable
 * would be a sentence the document cannot quote and would silently omit.
 */
export function refusalsFrom(root, relFile, fnName) {
  const abs = path.join(root, relFile);
  const fn = functionNamed(abs, fnName);
  const out = [];
  // Shared with invariantChecks; see literalText's own note for why.
  const textOf = literalText;
  /*
   * A refusal that cannot be read is a FAILURE, never a skip.
   *
   * The first draft of this reader pushed only what `textOf` could resolve and
   * silently ignored the rest. `sendRefusal` returns two of its sentences out
   * of a ternary (`def.kind === "recognition" ? ... : ...`), so that draft
   * dropped the recognition refusal, which is the single most load-bearing
   * sentence in the send path, and printed a shorter list that looked
   * complete. A reader that can lose a case without losing its green is the
   * exact failure this pipeline exists to stop, so every unreadable position
   * throws with the syntax kind it met.
   */
  const readOrFail = (node, what) => {
    // `return null` is "nothing refuses this", which is a real answer.
    if (node.kind === ts.SyntaxKind.NullKeyword) return [];
    const direct = textOf(node);
    if (direct !== null) return [direct];
    // A ternary is two sentences and both are reachable, so both are printed.
    if (ts.isConditionalExpression(node)) {
      return [...readOrFail(node.whenTrue, what), ...readOrFail(node.whenFalse, what)];
    }
    if (ts.isParenthesizedExpression(node)) return readOrFail(node.expression, what);
    /*
     * `return { ok: false, error: "..." }`. The sentence is on the `error`
     * property, which the walk below reaches on its own, so this returns
     * nothing rather than reading it twice. `{ ok: true }` carries no refusal
     * and correctly contributes none.
     */
    if (ts.isObjectLiteralExpression(node)) return [];
    fail(
      `economics-doc: ${relFile} ${fnName}() ${what} this reader cannot quote ` +
        `(${ts.SyntaxKind[node.kind]}). The document prints the sentence a member sees, and a ` +
        "sentence this reader cannot resolve would be dropped in silence, which is how a refusal " +
        "disappears from the document while still shipping to members.",
    );
    return [];
  };

  eachChild(fn, (n) => {
    if (ts.isReturnStatement(n) && n.expression) {
      // Only refusal-shaped returns. A function like sendRefusal returns
      // strings and null; anything else here is read strictly.
      out.push(...readOrFail(n.expression, "returns a value"));
      return;
    }
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "error") {
      out.push(...readOrFail(n.initializer, "builds a refusal"));
    }
  });
  if (!out.length) {
    fail(
      `economics-doc: ${relFile} ${fnName}() returns no refusal sentence any more. ` +
        "Either it stopped refusing or the reader's anchor moved; both mean the document is now wrong.",
    );
  }
  return out.map((s) => s.replace(/\s+/g, " ").trim());
}


// ── Every key the ledger can actually hold ──────────────────────────────────

/** Files a posting can be written from: everything under server/, tests aside. */
function serverFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!e.name.endsWith(".ts") || e.name.includes(".test.") || e.name.includes(".spec.")) continue;
      out.push({ abs, rel: path.relative(root, abs).replace(/\\/g, "/") });
    }
  };
  walk(path.join(root, "server"));
  if (!out.length) fail("economics-doc: no TypeScript found under server/; the key reader has nothing to read");
  return out;
}

const enclosingFunction = (node) => {
  let n = node.parent;
  while (n && !ts.isFunctionDeclaration(n) && !ts.isFunctionExpression(n) && !ts.isArrowFunction(n) && !ts.isMethodDeclaration(n)) {
    n = n.parent;
  }
  return n ?? null;
};

/** Is `name` a parameter of any function enclosing this node? */
function isParameterHere(node, name) {
  let fn = enclosingFunction(node);
  while (fn) {
    for (const p of fn.parameters ?? []) {
      if (ts.isIdentifier(p.name) && p.name.text === name) return true;
      // A destructured parameter counts too: the value still comes from the caller.
      if (ts.isObjectBindingPattern(p.name)) {
        for (const el of p.name.elements) if (ts.isIdentifier(el.name) && el.name.text === name) return true;
      }
    }
    fn = enclosingFunction(fn);
  }
  return false;
}

/** The nearest `const name = ...` visible from this node, searching outward. */
function localConst(node, name) {
  let scope = node.parent;
  while (scope) {
    let found = null;
    const scan = (n) => {
      if (found) return;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
        found = n.initializer;
        return;
      }
      n.forEachChild(scan);
    };
    scope.forEachChild(scan);
    if (found) return found;
    scope = scope.parent;
  }
  return null;
}

/**
 * What a function hands back: the expression of its first `return`, or the
 * body itself when it is a concise arrow.
 *
 * `debitKeyFor` in voiceClaim.ts is `const debitKeyFor = (id) => `...`;` with
 * no block and no return statement, so a reader that only looked for a
 * ReturnStatement refused a key it could read perfectly well.
 */
function returnedExpression(fn) {
  if (!fn) return null;
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.body && !ts.isBlock(fn.body)) return fn.body;
  let ret = null;
  eachChild(fn, (n) => { if (!ret && ts.isReturnStatement(n) && n.expression) ret = n.expression; });
  return ret;
}

/** A top-level function in this file, by name. */
function fileFunction(abs, name) {
  const sf = sourceFile(abs);
  let found = null;
  eachChild(sf, (n) => {
    if (found) return;
    if ((ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) && n.name && ts.isIdentifier(n.name) && n.name.text === name) {
      found = ts.isFunctionDeclaration(n) ? n : n.initializer;
    }
  });
  return found;
}

/**
 * EVERY idempotency key a posting can write, resolved to its SHAPE.
 *
 * WHY THIS REPLACED A READ OF THE `keys` OBJECT. The old reader printed the
 * eight builders in `keys` and called that the trigger table. Two things were
 * wrong with it, and both shipped inside a generated, green document:
 *
 *   - the two highest-volume mints append `:${r.tokenSlug}` to the builder's
 *     output AT THE CALL SITE, so the table printed
 *     `quest.completed:<v>:<questId>:<claimId>:<userId>` for a key the ledger
 *     never holds. The old reader's own refusal text said that a key assembled
 *     another way "would render as a shape the ledger never holds", and it was
 *     rendering exactly that;
 *   - every key written without a builder was absent entirely:
 *     `voice-claim-settled:...`, `ord:<orderId>:reversal-leg1`,
 *     `pp:<purchaseId>:reversal:<periodKey>`, and the whole library, stays and
 *     seats families. Anyone reasoning about replay from this document was
 *     reasoning from a table missing most of the ledger.
 *
 * Found by the adversary pass, F10. So this reads the CALL SITES: every
 * `idempotencyKey:` property assignment under server/, resolved through
 * templates, builders, conditionals, local consts and local helper functions
 * into the string the ledger receives. A site it cannot resolve is a THROW
 * naming the file, the line and the expression, because a key table missing a
 * key is the defect this replaces.
 *
 * A key FORWARDED from a parameter (`mint()` handing on `input.idempotencyKey`)
 * is counted and not printed as a shape: the caller decides that key, and every
 * caller is read here too.
 *
 * The `:<tokenSlug>` suffix is resolved wherever it is written, so if the
 * keystone lane moves it inside the builders this reader reports the same final
 * shapes with no change here.
 */
export function postingKeys(root = ROOT) {
  const builders = new Map(occurrenceKeys(root).map((k) => [k.name, k.shape]));
  const sites = [];
  let forwarded = 0;

  for (const { abs, rel } of serverFiles(root)) {
    const sf = sourceFile(abs);
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

    /** Resolve one expression to the key shape(s) it can produce. */
    const resolve = (node, depth) => {
      if (depth > 8 || !node) return null;

      if (ts.isParenthesizedExpression(node)) return resolve(node.expression, depth + 1);

      if (ts.isConditionalExpression(node)) {
        const a = resolve(node.whenTrue, depth + 1);
        const b = resolve(node.whenFalse, depth + 1);
        return a && b && a !== "forwarded" && b !== "forwarded" ? [...a, ...b] : null;
      }

      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];

      if (ts.isTemplateExpression(node)) {
        let shapes = [node.head.text];
        for (const span of node.templateSpans) {
          const inner = resolve(span.expression, depth + 1);
          const parts = inner && inner !== "forwarded" ? inner : [`<${placeholderFor(span.expression)}>`];
          const next = [];
          for (const s of shapes) for (const p of parts) next.push(s + p + span.literal.text);
          shapes = next;
        }
        return shapes;
      }

      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const a = resolve(node.left, depth + 1);
        const b = resolve(node.right, depth + 1);
        if (!a || !b || a === "forwarded" || b === "forwarded") return null;
        const out = [];
        for (const x of a) for (const y of b) out.push(x + y);
        return out;
      }

      // `keys.someBuilder(...)`
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const target = node.expression;
        if (ts.isIdentifier(target.expression) && target.expression.text === "keys") {
          const shape = builders.get(target.name.text);
          if (!shape) {
            fail(
              `economics-doc: ${rel}:${lineOf(node)} calls keys.${target.name.text}(), which is not in the ` +
                "`keys` object this reader read. The key table would silently lose it.",
            );
          }
          return [shape];
        }
      }

      // A call to a helper declared in this file: read what it returns.
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const ret = returnedExpression(fileFunction(abs, node.expression.text));
        if (ret) return resolve(ret, depth + 1);
        return null;
      }

      // `helper(...).property`, for example keysFor(row).pay
      if (ts.isPropertyAccessExpression(node) && ts.isCallExpression(node.expression)) {
        const callee = node.expression.expression;
        if (ts.isIdentifier(callee)) {
          const ret = returnedExpression(fileFunction(abs, callee.text));
          if (ret && ts.isObjectLiteralExpression(ret)) {
            const prop = ret.properties.find(
              (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === node.name.text,
            );
            if (prop) return resolve(prop.initializer, depth + 1);
          }
        }
        return null;
      }

      if (ts.isIdentifier(node)) {
        if (isParameterHere(node, node.text)) return "forwarded";
        const init = localConst(node, node.text);
        if (init) return resolve(init, depth + 1);
        return null;
      }

      if (ts.isPropertyAccessExpression(node)) {
        let rootExpr = node;
        while (ts.isPropertyAccessExpression(rootExpr)) rootExpr = rootExpr.expression;
        if (ts.isIdentifier(rootExpr) && isParameterHere(node, rootExpr.text)) return "forwarded";
        return null;
      }

      return null;
    };

    eachChild(sf, (n) => {
      if (!ts.isPropertyAssignment(n) || !ts.isIdentifier(n.name) || n.name.text !== "idempotencyKey") return;
      const line = lineOf(n);
      const got = resolve(n.initializer, 0);
      if (got === "forwarded") { forwarded += 1; return; }
      if (!got || !got.length) {
        fail(
          `economics-doc: ${rel}:${line} writes an idempotency key this reader cannot resolve:\n` +
            `    ${n.initializer.getText().replace(/\s+/g, " ").slice(0, 160)}\n` +
            "  The key table must name every shape the ledger can hold. Teach the reader this shape, or " +
            "write the key as a template literal, a `keys` builder, or a local helper it can follow.",
        );
      }
      for (const shape of got) sites.push({ file: rel, line, shape });
    });
  }

  if (!sites.length) {
    fail("economics-doc: no idempotency keys found under server/; the reader is looking in the wrong place");
  }
  return { sites, forwarded, builders };
}

/** The tables an invariant's SQL reads, for the "reads" column. */
function tablesIn(sql) {
  const names = new Set();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+`?([a-z_][a-z0-9_]*)`?/gi)) {
    const name = m[1].toLowerCase();
    // Derived-table aliases (`FROM ( ... ) m`) never match this pattern, but a
    // subquery's own FROM does, which is correct: it is still a table read.
    names.add(name);
  }
  return Array.from(names).sort();
}

// ── Rendering ───────────────────────────────────────────────────────────────

const yesNo = (b) => (b ? "yes" : "no");

function table(headers, rows) {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const r of rows) lines.push(`| ${r.join(" | ")} |`);
  return lines.join("\n");
}

/** Markdown table cells cannot hold a bare pipe. */
const cell = (v) => String(v).replace(/\|/g, "\\|");

/**
 * Every system account the migrations seed, with the faucet flag they seed it
 * with.
 *
 * WHY THIS IS DERIVED AND WAS NOT. The vault half of the faucets region named
 * four accounts, one at a time, inside this file. The migrations seed eleven
 * non-faucet ones. So a table inside a region marked GENERATED, which a reader
 * therefore trusts more than prose, was telling somebody asking where value
 * sits about four of the eleven places it can sit, and the doc guard could not
 * see it: a hand-kept list inside a generator is byte-identical on both sides
 * of the comparison however incomplete it is. `sys:voice-decay` had been
 * missing since 0165 and `sys:redemption-hold` and `sys:redeemed` arrived in
 * 0161 without reaching it.
 *
 * This is the same reasoning that made `faucetAccounts(pool)` derive the faucet
 * set in `server/lib/economy.ts` (ECONOMICS.md 10.33): the sentence saying what
 * a system account is has ONE home, and a new one reaches every reader on the
 * day it is seeded.
 *
 * Read from the seed tuples rather than from a schema: the runner applies these
 * files at boot, so an account exists exactly when a migration says it does.
 */
export function seededSystemAccounts(root) {
  const dir = path.join(root, "drizzle");
  const found = new Map();
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(dir, name), "utf8");
    // Comment lines first: the runner strips them, and a `--` line quoting an
    // account id would otherwise seed a row that does not exist.
    const body = sql.replace(/^\s*--.*$/gm, "");
    for (const m of body.matchAll(
      /\(\s*'(sys:[a-z0-9-]+)'\s*,\s*'[a-z]+'\s*,\s*[^,]+,\s*'([^']*)'\s*,\s*([01])\s*\)/gi,
    )) {
      // First seed wins. `INSERT IGNORE` means a later file re-stating a row
      // changes nothing, so the earliest one is the row the database holds.
      if (!found.has(m[1])) found.set(m[1], { id: m[1], label: m[2], faucet: m[3] === "1", from: name });
    }
  }
  if (!found.size) {
    fail("economics-doc: no `sys:` account seeds found under drizzle/; the reader is looking for the wrong shape");
  }
  return Array.from(found.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The richer sentence for a vault this document has already explained.
 *
 * Anything absent here falls back to the LABEL its migration seeded, which is
 * what lets a new vault reach the table on the day it is seeded instead of on
 * the day somebody remembers this map. The LIST is derived; only the wording
 * is kept.
 */
const VAULT_SENTENCES = {
  "sys:treasury": "where a spent credit lands, unless the token names its own sink",
  "sys:exit-settlement": "a departing member's swept balance",
  "sys:voice-bridge": "voice debited by a claim, waiting on Hypha",
  "sys:voice-settled": "voice whose claim Hypha confirmed",
  "sys:voice-decay": "all the voice that has waned in this village, and it only ever receives",
  "sys:event-escrow": "a seat fee, until the gathering is held or cancelled",
  "sys:library-escrow": "a loan deposit, until the loan settles",
  "sys:library-pool": "the usage fee a settled loan released",
  "sys:library-sink": "library credit an admin burned",
  "sys:redemption-hold": "tokens held against a redemption somebody has open",
  "sys:redeemed": "tokens a confirmed redemption retired, and it only ever receives",
};

/**
 * The regions, by name. Each renders to a string WITHOUT its markers; the
 * splice and the check both add those.
 *
 * ORDER IS THE ORDER THEY APPEAR IN THE DOCUMENT, which is only a convenience
 * for `--stdout`. The check finds each region by its marker, so moving a
 * section in the document does not move anything here.
 */
export const REGIONS = {
  /** The registry a fresh village boots with. */
  tokens(f) {
    const rows = f.tokens.map((t) => [
      cell(`\`${t.slug}\``),
      cell(t.name),
      cell(t.kind),
      cell(t.governance === "platform" ? "the village" : "Hypha, on Base"),
      cell(t.decimals),
      cell(t.faucet ? `\`${t.faucet}\`` : "none, it is read from Base"),
      cell(t.sendable ? "yes" : `no: ${t.sendBlockedBy}`),
    ]);
    return [
      table(
        ["Slug", "Name", "Kind", "Governed by", "Decimals", "Faucet", "A member may send it"],
        rows,
      ),
      "",
      `${f.tokens.length} tokens in a fresh village: ` +
        `${f.tokens.filter((t) => t.governance === "platform").length} minted here, ` +
        `${f.tokens.filter((t) => t.governance !== "platform").length} read from Base. ` +
        `The registry rows are seeded by ${f.migrationsRead.length} migration file(s) ` +
        "and by the modules that register their own token at boot.",
    ].join("\n");
  },

  /** Which account issues which token, and the system accounts that are not faucets. */
  faucets(f, root) {
    const rows = Object.entries(f.faucets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([slug, account]) => [cell(`\`${account}\``), cell(`\`${slug}\``)]);
    const vaults = seededSystemAccounts(root).filter((a) => !a.faucet);
    const holding = vaults.map((a) => [
      cell(`\`${a.id}\``),
      cell(VAULT_SENTENCES[a.id] ?? `${a.label.charAt(0).toLowerCase()}${a.label.slice(1)}`),
    ]);
    return [
      table(["Faucet account", "Issues"], rows),
      "",
      "A faucet's NEGATIVE balance is the issued supply of its token. These system accounts are not faucets and never go below zero:",
      "",
      table(["Vault account", "Holds"], holding),
      "",
      `${vaults.length} of them, read from every \`INSERT\` into \`ledger_accounts\` under \`drizzle/\` ` +
        "and never from a list kept here: this table named four for as long as the migrations seeded more, " +
        "and a reader asking where value sits was told about less of it than exists.",
      "",
      "Sources that may drive a NON-faucet account below zero, and only with `allowNegative` set: " +
        f.allowNegative.map((s) => `\`${s}\``).join(", ") +
        ".",
    ].join("\n");
  },

  /** The mint rules a fresh village is born with. */
  "mint-rules"(f) {
    const rows = f.seededRules.map((r) => [
      cell(`\`${r.trigger}\``),
      cell(`\`${r.token}\``),
      cell(r.amount === null ? "read from the work" : r.amount),
      cell(r.ceiling),
      cell(r.recipient),
      cell(r.enabled === false ? "**no**" : "yes"),
    ]);
    return [
      table(["Trigger", "Token", "Amount", "Ceiling", "Recipient", "Enabled"], rows),
      "",
      "Seeded by `seedEconomy` in `server/lib/economySeed.ts` with `INSERT IGNORE` on " +
        "(village, trigger, token), so an amount a village has edited is never restored by a redeploy.",
    ].join("\n");
  },

  /** Where a spent token goes, and what may be spent at all. */
  sinks(f) {
    const rows = f.tokens
      .filter((t) => t.priceable)
      .map((t) => [cell(`\`${t.slug}\``), cell(`\`${t.spendSink}\``)]);
    return [
      "A token may carry a price when it is platform-governed, active, not an example, and of kind " +
        f.priceableKinds.map((k) => `\`${k}\``).join(" or ") +
        " (`isPriceableToken`, `server/lib/spending.ts`). Today that is:",
      "",
      table(["Priceable token", "Spending it lands in"], rows),
      "",
      "`spendSinkFor` names " +
        (Object.keys(f.spendSinks.named).length
          ? Object.entries(f.spendSinks.named)
              .map(([slug, account]) => `\`${slug}\` to \`${account}\``)
              .join(", ")
          : "no token") +
        ` and sends everything else to \`${f.spendSinks.fallback}\`.`,
      "",
      "Kinds a member may hand to another member (`SENDABLE_KINDS`): " +
        f.sendableKinds.map((k) => `\`${k}\``).join(", ") +
        ". Held out by name even though they are that kind (`MODULE_VOUCHERS`): " +
        f.moduleVouchers.map((s) => `\`${s}\``).join(", ") +
        ".",
    ].join("\n");
  },

  /** What every boot refuses. */
  conservation(f, root) {
    const checks = invariantChecks(root);
    // Backticked, because a finding carries `<token_type>` placeholders and a
    // markdown renderer eats an unbackticked angle bracket as an HTML tag.
    const rows = checks.map((c) => [
      cell(`\`${c.message}\``),
      cell(tablesIn(c.sql).map((t) => `\`${t}\``).join(", ")),
      cell(c.refusesBoot ? "**yes**" : "no, reported only"),
    ]);
    const refusing = checks.filter((c) => c.refusesBoot).length;
    const reporting = checks.length - refusing;
    return [
      `\`checkLedgerInvariants\` (\`server/lib/ledger.ts\`) runs ${checks.length} reads at every boot and ` +
        "emits one sentence per offending row. These are the sentences, with the tables each read " +
        "and whether the village refuses to serve on it:",
      "",
      table(["The sentence", "Reading", "Refuses boot"], rows),
      "",
      reporting === 0
        ? `All ${refusing} refuse boot.`
        : `${refusing} of these refuse boot and ${reporting} ${reporting === 1 ? "does" : "do"} not. ` +
          "The difference is deliberate and is read out of the function's own `ok` expression rather " +
          "than written here: a corruption means a village whose books do not add up must not serve, " +
          "while a LOSS is real, worth a founder's attention, and no reason to take the village " +
          "offline.",
      "",
      "Conservation is checked against `token_balances`, which is a CACHE, and the cache is " +
        "separately checked against a recomputation from `token_ledger`. Both are needed: the sum " +
        "of a wrong cache can still be zero.",
    ].join("\n");
  },

  /**
   * The exact sentences a member reads when the economy says no.
   *
   * QUOTED FROM THE CODE, never retyped. A refusal is the only part of this
   * engine most members will ever meet, and a document that paraphrases one is
   * a document that cannot be used to answer "why did it say that?". The
   * angle brackets are the code's own interpolations.
   */
  refusals(f, root) {
    const groups = [
      {
        title: "Sending a token to another member",
        where: "`sendRefusal`, `server/lib/spending.ts`",
        lines: refusalsFrom(root, "server/lib/spending.ts", "sendRefusal"),
      },
      {
        title: "Putting a price on a room or a seat",
        where: "`priceRefusal`, `server/lib/spending.ts`",
        lines: refusalsFrom(root, "server/lib/spending.ts", "priceRefusal"),
      },
      {
        title: "Opening sending on a token, as an admin",
        where: "`mayToggleTransferable`, `server/lib/spending.ts`",
        lines: refusalsFrom(root, "server/lib/spending.ts", "mayToggleTransferable"),
      },
      {
        title: "Giving gratitude",
        where: "`checkGive`, `server/lib/economy.ts`",
        lines: refusalsFrom(root, "server/lib/economy.ts", "checkGive"),
      },
      {
        title: "Asking to redeem tokens for something real",
        where: "`redemptionRefusal`, `server/lib/redemption.ts`",
        lines: refusalsFrom(root, "server/lib/redemption.ts", "redemptionRefusal"),
      },
      {
        title: "Confirming or refusing somebody's redemption",
        where: "`confirmRefusal`, `server/lib/redemption.ts`",
        lines: refusalsFrom(root, "server/lib/redemption.ts", "confirmRefusal"),
      },
    ];
    const out = [];
    for (const g of groups) {
      out.push(`**${g.title}** (${g.where}):`, "");
      for (const line of g.lines) out.push(`- \`${line}\``);
      out.push("");
    }
    out.pop();
    return out.join("\n");
  },

  /** Every key the ledger can actually hold, read from the call sites. */
  triggers(f, root) {
    const builderRows = occurrenceKeys(root).map((k) => [
      cell(`\`keys.${k.name}\``),
      cell(`\`${k.shape}\``),
    ]);

    const { sites, forwarded } = postingKeys(root);
    const byShape = new Map();
    for (const site of sites) {
      if (!byShape.has(site.shape)) byShape.set(site.shape, new Set());
      byShape.get(site.shape).add(site.file);
    }
    const shapeRows = Array.from(byShape.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([shape, files]) => [
        cell(`\`${shape}\``),
        cell(Array.from(files).sort().map((x) => `\`${x}\``).join(", ")),
      ]);

    return [
      "A key names an OCCURRENCE, never a thing, and `token_ledger.idempotency_key` is UNIQUE, so " +
        "the shape of the key is what decides whether a second attempt pays again.",
      "",
      `\`keys\` in \`server/lib/economy.ts\` builds ${builderRows.length} of them. The angle ` +
        "brackets are that builder's own parameter names.",
      "",
      table(["Builder", "What the builder returns"], builderRows),
      "",
      "**A builder's output is not always the key.** The token slug used to be appended to it " +
        "at the two mint call sites rather than built in, which printed a shape here that the " +
        "ledger never held; it is a builder parameter now, and both tables agree because of it. " +
        "Most of the economy still does not use a builder at all. So the table below is read " +
        "from the CALL SITES: every `idempotencyKey` written under `server/`, resolved through " +
        "templates, builders, conditionals, local constants and local helpers into the string " +
        "the ledger receives.",
      "",
      table(["Key shape the ledger holds", "Written in"], shapeRows),
      "",
      `${byShape.size} distinct shapes across ${sites.length} posting site(s)` +
        (forwarded
          ? `, plus ${forwarded} site(s) that forward a key their caller decided (\`mint()\` and ` +
            "`mintStayCredits` hand on what they were given, and every caller of those is read above)."
          : ".") +
        " A shape ending in a timestamp and a random suffix is a key the caller did not make " +
        "idempotent: the admin mint and the exchange stocking route both fall back to one when no " +
        "client nonce is sent, so a retried request there is a second posting rather than a no-op.",
    ].join("\n");
  },
};

export const REGION_NAMES = Object.keys(REGIONS);

export const startMarker = (name) => `<!-- generated:${name} start -->`;
export const endMarker = (name) => `<!-- generated:${name} end -->`;

/**
 * Render one region's body. Throws a ReadError when a source moved.
 *
 * `facts` is passed in by `renderAll` so six regions do not re-read the whole
 * migration set six times.
 */
export function renderRegion(name, root = ROOT, facts = null) {
  const render = REGIONS[name];
  if (!render) fail(`economics-doc: no region named "${name}"; known: ${REGION_NAMES.join(", ")}`);
  return render(facts ?? collectFacts(root), root);
}

/** Every region, by name. One read of the sources for all of them. */
export function renderAll(root = ROOT) {
  for (const rel of SOURCES) {
    if (!fs.existsSync(path.join(root, rel))) {
      fail(`economics-doc: ${rel} is gone; the generator reads it`);
    }
  }
  const facts = collectFacts(root);
  verifyKeystoneSets(root, facts);
  const out = {};
  for (const name of REGION_NAMES) out[name] = renderRegion(name, root, facts);
  return out;
}

/**
 * The three sets this document prints as lists of VALUES, checked twice.
 *
 * `collectFacts` reads them through generate-token-doc.mjs's `setConst`, which
 * takes the first array literal in the initialiser. `frozenStringSet` reads the
 * same declarations and refuses anything that is not exactly
 * `new Set([<string literals>])`. Running both and comparing is what closes
 * F7: the strict reader refuses the shapes `setConst` cannot see through, and
 * the comparison catches the case where the two readers would report different
 * lists for a shape neither refused.
 *
 * A MISMATCH IS A THROW, not a preference for one reader. If the two disagree,
 * the document cannot be written from either without saying which one is
 * right, and this file will not guess.
 */
export function verifyKeystoneSets(root, facts) {
  const pins = [
    { file: "server/lib/ledger.ts", name: "ALLOW_NEGATIVE_SOURCES", seen: facts.allowNegative },
    { file: "server/lib/spending.ts", name: "SENDABLE_KINDS", seen: facts.sendableKinds },
    { file: "server/lib/spending.ts", name: "MODULE_VOUCHERS", seen: facts.moduleVouchers },
  ];
  for (const pin of pins) {
    const strict = frozenStringSet(root, pin.file, pin.name);
    const a = [...strict].sort();
    const b = [...(pin.seen ?? [])].sort();
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
      fail(
        `economics-doc: the two readers disagree about ${pin.name} in ${pin.file}.\n` +
          `    strict reader:  ${JSON.stringify(a)}\n` +
          `    token-doc setConst: ${JSON.stringify(b)}\n` +
          "  One of them is reading a shape the other cannot see. The document prints this set as a " +
          "list of values and will not choose between two answers.",
      );
    }
  }
}

/**
 * Find one region's body in a document.
 *
 * Returns `{ body, start, end }` or a `problem` string. A MISSING MARKER IS A
 * PROBLEM AND NOT AN EMPTY REGION: an empty region compares equal to nothing
 * and would let somebody delete a table by deleting its markers, which is the
 * one edit this whole pipeline has to refuse.
 */
export function findRegion(text, name) {
  const open = startMarker(name);
  const close = endMarker(name);
  const a = text.indexOf(open);
  if (a === -1) return { problem: `the marker ${open} is not in the document` };
  if (text.indexOf(open, a + open.length) !== -1) {
    return { problem: `the marker ${open} appears more than once` };
  }
  const b = text.indexOf(close, a + open.length);
  if (b === -1) return { problem: `${open} is there but ${close} is not` };
  if (text.indexOf(close, b + close.length) !== -1) {
    return { problem: `the marker ${close} appears more than once` };
  }
  return {
    body: text.slice(a + open.length, b).replace(/^\n/, "").replace(/\n$/, ""),
    start: a + open.length,
    end: b,
  };
}

/** Put every rendered region back into the document text. */
export function spliceAll(text, rendered) {
  let out = text;
  for (const name of REGION_NAMES) {
    const found = findRegion(out, name);
    if (found.problem) fail(`economics-doc: ${DOC_RELATIVE}: ${found.problem}`);
    out = `${out.slice(0, found.start)}\n${rendered[name]}\n${out.slice(found.end)}`;
  }
  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const invokedDirectly = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  return path.resolve(arg) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
})();

if (invokedDirectly) {
  if (process.argv.includes("--list")) {
    process.stdout.write(`${DOC_RELATIVE} regions are generated from:\n`);
    for (const s of SOURCES) process.stdout.write(`  ${s}\n`);
    process.stdout.write(`  scripts/generate-token-doc.mjs (its readers, not its renderer)\n`);
    process.stdout.write(`\nRegions: ${REGION_NAMES.join(", ")}\n`);
  } else if (process.argv.includes("--stdout")) {
    const rendered = renderAll();
    for (const name of REGION_NAMES) {
      process.stdout.write(`${startMarker(name)}\n${rendered[name]}\n${endMarker(name)}\n\n`);
    }
  } else {
    const rendered = renderAll();
    const before = fs.readFileSync(DOC_PATH, "utf8");
    const after = spliceAll(before, rendered);
    if (before === after) {
      process.stdout.write(`${DOC_RELATIVE}: ${REGION_NAMES.length} generated region(s) already match the code.\n`);
    } else {
      fs.writeFileSync(DOC_PATH, after);
      process.stdout.write(`${DOC_RELATIVE}: ${REGION_NAMES.length} generated region(s) rewritten from the code.\n`);
    }
  }
}
