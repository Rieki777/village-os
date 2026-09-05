/**
 * NO SHEBANG, and it has to stay that way.
 *
 * This file is imported by a Vitest suite (server/db/governanceDoc.test.ts),
 * so it goes through Vite's transform as well as node. A SHEBANG AND CRLF LINE
 * ENDINGS TOGETHER make that transform throw `SyntaxError: Invalid or
 * unexpected token`; either one alone is fine. `core.autocrlf` is true on the
 * Windows checkouts this repository is developed on, so the failure appears
 * the first time a rebase hands the file back with carriage returns.
 * scripts/generate-token-doc.mjs carries the same note for the same reason,
 * having found it the same way. The self-test asserts the line is still gone.
 */
/**
 * docs/GOVERNANCE.md, written from the code instead of about it.
 *
 * WHY THIS IS A GENERATOR. A hand-written governance document is wrong within
 * a month and nothing says so, and it is wrong in the most expensive
 * direction: it describes the system somebody intended. So this file reads the
 * subject registry, the close dispatcher, the engine's arithmetic, the dials,
 * the capability tables, the module definition, the clock and the route
 * registrations, works out the facts, and emits the document.
 * `scripts/check-governance-doc.mjs` regenerates it and fails the build when
 * the emitted text and the committed text differ. The check is what makes the
 * document worth trusting. Without it this is a beautiful thing that lies.
 *
 * WHAT IT DESCRIBES. A FRESH village: what a village standing up a new
 * instance holds on the first boot. A village that has been running has its
 * own history on top of it.
 *
 * IT DESCRIBES WHAT IS TRUE, INCLUDING WHAT IS BROKEN. A subject type with no
 * executor is named as one. A rule that lives in two places that could
 * disagree names both. A ruling nobody has built yet says "not built" in those
 * words and carries a guard so it cannot go on saying that after somebody
 * builds it.
 *
 * NOTHING HERE IS A HAND-WRITTEN LIST OF FILES. Two readers used to hold one.
 * `routeFacts` named three route modules; four more landed after it was
 * written, so `server/routes/delegation.ts`, `governanceVetoes.ts`,
 * `governanceLanding.ts` and `governanceMode.ts` were invisible, the routes
 * table lost thirteen rows, and `stagedFlags()` reads that same walk, so the
 * document stated as a fact that delegation was ruled and not built while seven
 * delegation routes were answering members. Route modules and migrations are
 * both walked as directories now, and a file a later lane adds is read the day
 * it appears.
 *
 * EVERY READER IS ANCHORED AND FAILS LOUD. Anchors are exported symbols and
 * syntax, never line numbers: `server/index.ts` lost about 2,500 lines to
 * route extractions in the hours while this document was being specified, and
 * a reader anchored on a line would have gone quietly wrong. If the shape a
 * reader expects is gone, it throws with the file and the text it could not
 * read, and the build stops. A reader that silently returns nothing when the
 * code moves is worse than no reader, because the document keeps rendering and
 * loses a fact.
 *
 * THE SOURCES ARE MOVING UNDER THIS FILE ON PURPOSE. Other lanes are building
 * the steward, the criticality tiers, the changeset and the clock seam. When
 * their work lands, this guard goes red and the document is regenerated. That
 * is the design and not a defect.
 *
 * Usage:
 *   node scripts/generate-governance-doc.mjs            write docs/GOVERNANCE.md
 *   node scripts/generate-governance-doc.mjs --stdout   print it, write nothing
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
);

export const DOC_PATH = path.join(ROOT, "docs", "GOVERNANCE.md");

/** The same lineage section, on the shelf the assistant reads. */
export const LINEAGE_PATH = path.join(ROOT, "docs", "knowledge", "governance-lineage.md");

/** Every route module lives here, and the route reader walks the whole directory. */
export const ROUTE_DIR = "server/routes";

/** Every migration lives here, and the schema reader walks the whole directory. */
export const MIGRATION_DIR = "drizzle";

/**
 * Every file this document is derived from. Existence is checked before
 * anything is parsed, so a rename fails with the path it wanted instead of
 * with a parse error twenty frames deep.
 */
export const SOURCES = [
  "shared/governanceEngine.ts",
  "shared/ballotSubjects.ts",
  "shared/governanceKinds.ts",
  "shared/cycleClock.ts",
  "shared/gameVariables.ts",
  "shared/capabilities.ts",
  "shared/modules.ts",
  "shared/lunar.ts",
  "server/index.ts",
  "server/lib/ballots.ts",
  "server/lib/applyDue.ts",
  "server/lib/changeset.ts",
  "server/lib/stewardship.ts",
  "server/lib/delegation.ts",
  "server/lib/governanceWeights.ts",
  "server/lib/gameStart.ts",
  "server/lib/mechanics.ts",
  "server/lib/proposalDrafts.ts",
  "server/lib/gratitude-cycles.ts",
  "server/lib/governanceWindows.ts",
  "server/routes/governanceWizard.ts",
  // Every route module, walked as a directory rather than named one by one.
  // The three-file list this replaced made `server/routes/delegation.ts`,
  // `governanceVetoes.ts` and `governanceLanding.ts` invisible, and the
  // document went on stating as fact that delegation was staged while its
  // seven routes were serving.
  ROUTE_DIR,
  // The tables and columns the landing loop, the veto and the delegation
  // acceptance live in. Walked as a directory for the same reason, and because
  // a migration number is claimed at landing time and never written into prose.
  MIGRATION_DIR,
  "client/src/components/governance/wizardConfig.ts",
];

class ReadError extends Error {}

function fail(message) {
  throw new ReadError(`governance-doc: ${message}`);
}

// ── TypeScript: anchored reads of the code that decides how a village decides ─

const sourceCache = new Map();

function sourceFile(abs) {
  if (!sourceCache.has(abs)) {
    if (!fs.existsSync(abs)) fail(`${abs} is gone; the generator reads it`);
    sourceCache.set(abs, ts.createSourceFile(abs, fs.readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true));
  }
  return sourceCache.get(abs);
}

const absOf = (root, rel) => path.join(root, ...rel.split("/"));

function eachChild(node, fn) {
  node.forEachChild((child) => { fn(child); eachChild(child, fn); });
}

/**
 * `const NAME = ...` ANYWHERE in a file, not only at the top level.
 *
 * `SUBJECT_CLOSERS` lives inside `registerRoutes()` and not at module scope,
 * so a top-level-only lookup (which is all the token generator needs) would
 * report the dispatcher as missing and the document would lose the one table
 * that says what a passed vote does.
 */
function constAnywhere(abs, name) {
  const sf = sourceFile(abs);
  let found;
  eachChild(sf, (node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      found = node.initializer;
    }
  });
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
      if (!spec.startsWith(".")) fail(`${name} is imported from "${spec}", which this reader cannot follow`);
      return { abs: path.resolve(path.dirname(abs), spec) + ".ts", exported: el.propertyName?.text ?? el.name.text };
    }
  }
  return null;
}

/**
 * A literal, or a name that resolves to one, following relative imports.
 *
 * `env` binds names to expressions the caller already resolved, which is how a
 * function's parameters reach its body when a call is inlined. It is empty for
 * every read that starts at a top-level constant.
 */
export function literalOf(node, abs, env = null) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return -literalOf(node.operand, abs, env);
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression?.(node)) {
    return literalOf(node.expression, abs, env);
  }
  if (ts.isIdentifier(node)) {
    const bound = env?.get(node.text);
    if (bound) return literalOf(bound.node, bound.abs, bound.env ?? null);
    const local = constAnywhere(abs, node.text);
    if (local) return literalOf(local, abs);
    const imported = importSource(abs, node.text);
    if (imported) {
      const init = constAnywhere(imported.abs, imported.exported);
      if (!init) {
        fail(`${node.text} is imported into ${path.basename(abs)} but is not a const in ${path.basename(imported.abs)}`);
      }
      return literalOf(init, imported.abs);
    }
    fail(`cannot resolve the constant ${node.text} in ${path.basename(abs)}`);
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const bound = bindingOf(node, abs, env);
    return literalOf(bound.node, bound.abs, bound.env ?? null);
  }
  if (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === "String"
    && node.arguments.length === 1
  ) {
    return String(literalOf(node.arguments[0], abs, env));
  }
  fail(`${path.basename(abs)} holds a value this reader cannot read: ${node.getText().slice(0, 80)}`);
}

/**
 * The expression a name or a member access finally stands for, with the file
 * that expression lives in, so a later read resolves the next name against the
 * right imports.
 *
 * This exists because a setting's floor is written as the place the number
 * already lives (`TIER_FLOORS.structural.unityPct`,
 * `SUBJECT_THRESHOLDS[MINT_RULE].minQuorumPct`) instead of the number retyped
 * beside it. A reader that could not follow the member access would have to be
 * told those numbers by hand, which is the one thing this generator exists to
 * avoid: the document would then agree with itself and disagree with the code.
 */
function bindingOf(node, abs, env = null) {
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression?.(node)) {
    return bindingOf(node.expression, abs, env);
  }
  if (ts.isIdentifier(node)) {
    const bound = env?.get(node.text);
    if (bound) return bindingOf(bound.node, bound.abs, bound.env ?? null);
    const local = constAnywhere(abs, node.text);
    if (local) return bindingOf(local, abs);
    const imported = importSource(abs, node.text);
    if (imported) {
      const init = constAnywhere(imported.abs, imported.exported);
      if (!init) {
        fail(`${node.text} is imported into ${path.basename(abs)} but is not a const in ${path.basename(imported.abs)}`);
      }
      return bindingOf(init, imported.abs);
    }
    fail(`cannot resolve the constant ${node.text} in ${path.basename(abs)}`);
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const key = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : String(literalOf(node.argumentExpression, abs, env));
    const holder = bindingOf(node.expression, abs, env);
    if (!ts.isObjectLiteralExpression(holder.node)) {
      fail(`${node.expression.getText().slice(0, 60)} in ${path.basename(abs)} is not an object this reader can index`);
    }
    for (const p of holder.node.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      if (propertyName(p.name, holder.abs) !== key) continue;
      return bindingOf(p.initializer, holder.abs, holder.env ?? null);
    }
    fail(`${path.basename(holder.abs)} declares no ${key} on ${node.expression.getText().slice(0, 60)}`);
  }
  return { node, abs, env };
}

/** `function NAME(...)` in a file, wherever it sits. */
function functionAnywhere(abs, name) {
  const sf = sourceFile(abs);
  let found;
  eachChild(sf, (node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
  });
  return found;
}

/**
 * The object a call to a small local helper returns, worked out from that
 * helper's own body with its parameters bound to the arguments at the call.
 *
 * This exists for `...tierFloors("constitutional")`. A spread is the one shape
 * `objectOf` used to walk past in silence, and it cost the subject table a row
 * reading `undefined%` on the day the tier floors landed. Nothing here guesses
 * what a function does: it inlines a body of `const` declarations followed by
 * one `return` of an object literal, and refuses any other shape, so a helper
 * that grows a branch stops the build instead of being assumed.
 */
function callObject(call, abs) {
  if (!ts.isIdentifier(call.expression)) {
    fail(`${path.basename(abs)} spreads a call this reader cannot follow: ${call.getText().slice(0, 60)}`);
  }
  const name = call.expression.text;
  let home = abs;
  let fn = functionAnywhere(abs, name);
  if (!fn) {
    const imported = importSource(abs, name);
    if (imported) {
      home = imported.abs;
      fn = functionAnywhere(home, imported.exported);
    }
  }
  if (!fn) fail(`${name}() is spread in ${path.basename(abs)} and this reader cannot find where it is declared`);

  const env = new Map();
  fn.parameters.forEach((param, i) => {
    if (!ts.isIdentifier(param.name)) fail(`${name}() takes a destructured parameter this reader cannot bind`);
    const arg = call.arguments[i];
    if (!arg) fail(`${name}() is called in ${path.basename(abs)} with fewer arguments than it declares`);
    env.set(param.name.text, { node: arg, abs, env: null });
  });

  const body = fn.body?.statements ?? [];
  let result;
  for (const stmt of body) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) fail(`${name}() declares a local this reader cannot bind`);
        env.set(d.name.text, { node: d.initializer, abs: home, env: new Map(env) });
      }
      continue;
    }
    if (ts.isReturnStatement(stmt)) {
      if (!stmt.expression) fail(`${name}() returns nothing, and a spread of it would contribute nothing`);
      result = stmt.expression;
      break;
    }
    fail(`${name}() does more than declare and return, so this reader will not guess what a spread of it means`);
  }
  if (!result) fail(`${name}() has no return this reader can read`);
  const shape = bindingOf(result, home, env);
  if (!ts.isObjectLiteralExpression(shape.node)) fail(`${name}() does not return an object literal, so it cannot be spread`);
  return objectOf(shape.node, shape.abs, shape.env ?? env);
}

/** A property name, including a `[CONSTANT]:` computed key resolved to a string. */
function propertyName(name, abs) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return String(literalOf(name.expression, abs));
  return null;
}

function objectOf(node, abs, env = null) {
  if (!ts.isObjectLiteralExpression(node)) fail(`expected an object literal in ${path.basename(abs)}`);
  const out = {};
  for (const p of node.properties) {
    // A spread is resolved or refused, and never skipped. Skipping one is how
    // `...tierFloors("constitutional")` dropped two floors out of a subject
    // and put `undefined%` in the table this document ships.
    if (ts.isSpreadAssignment(p)) {
      const source = ts.isCallExpression(p.expression)
        ? callObject(p.expression, abs)
        : (() => {
            const bound = bindingOf(p.expression, abs, env);
            if (!ts.isObjectLiteralExpression(bound.node)) {
              fail(`${path.basename(abs)} spreads something that is not an object: ${p.getText().slice(0, 60)}`);
            }
            return objectOf(bound.node, bound.abs, bound.env ?? null);
          })();
      Object.assign(out, source);
      continue;
    }
    if (!ts.isPropertyAssignment(p)) continue;
    const key = propertyName(p.name, abs);
    if (key === null) continue;
    out[key] = literalOf(p.initializer, abs, env);
  }
  return out;
}

/** `const NAME = [...]`, or a `new Set([...])`, read as a list of literals. */
function listConst(root, rel, name) {
  const abs = absOf(root, rel);
  const init = constAnywhere(abs, name);
  if (!init) fail(`${rel} no longer declares ${name}`);
  let arr = ts.isArrayLiteralExpression(init) ? init : undefined;
  if (!arr) eachChild(init, (n) => { if (!arr && ts.isArrayLiteralExpression(n)) arr = n; });
  if (!arr) fail(`${name} in ${rel} is not built from an array literal`);
  return arr.elements.map((e) => literalOf(e, abs));
}

/** An object const, as a plain object of literals. */
function recordConst(root, rel, name) {
  const abs = absOf(root, rel);
  const init = constAnywhere(abs, name);
  if (!init) fail(`${rel} no longer declares ${name}`);
  return objectOf(init, abs);
}

/** The members of a string-union type alias, by name. */
function unionOf(root, rel, name) {
  const abs = absOf(root, rel);
  const sf = sourceFile(abs);
  let found;
  eachChild(sf, (node) => {
    if (found || !ts.isTypeAliasDeclaration(node) || node.name.text !== name) return;
    if (!ts.isUnionTypeNode(node.type)) return;
    found = node.type.types.map((t) => {
      if (!ts.isLiteralTypeNode(t) || !ts.isStringLiteral(t.literal)) {
        fail(`${name} in ${rel} is no longer a union of string literals`);
      }
      return t.literal.text;
    });
  });
  if (!found) fail(`${rel} no longer declares a string union type ${name}`);
  return found;
}

// ── The readers ─────────────────────────────────────────────────────────────

/**
 * THE CLOSE DISPATCHER: which subject types execute anything when they pass.
 *
 * Read as the object literal assigned to `SUBJECT_CLOSERS`, plus every later
 * `SUBJECT_CLOSERS[X] = SUBJECT_CLOSERS.Y` alias, because the minting subject
 * reaches its executor that way and a reader of the literal alone would report
 * a binding vote as advisory. Absence from this table is the engine's
 * fail-safe direction: a subject type that is not a key conducts a real
 * decision and executes nothing.
 */
export function dispatcherKeys(root = ROOT) {
  const abs = absOf(root, "server/index.ts");
  const init = constAnywhere(abs, "SUBJECT_CLOSERS");
  if (!init) fail("server/index.ts no longer declares SUBJECT_CLOSERS; the close dispatcher is where a passed vote's effect is decided");
  if (!ts.isObjectLiteralExpression(init)) fail("SUBJECT_CLOSERS is no longer an object literal; this reader cannot follow it");
  const direct = [];
  const bodies = {};
  for (const p of init.properties) {
    if (!ts.isPropertyAssignment(p) && !ts.isMethodDeclaration(p) && !ts.isShorthandPropertyAssignment(p)) continue;
    const key = propertyName(p.name, abs);
    if (key === null) fail(`SUBJECT_CLOSERS holds a key this reader cannot read: ${p.getText().slice(0, 60)}`);
    direct.push(key);
    bodies[key] = p.getText();
  }
  if (!direct.length) fail("SUBJECT_CLOSERS is empty; a village where nothing executes is not a shape this document can describe");

  const aliases = [];
  const sf = sourceFile(abs);
  eachChild(sf, (node) => {
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
    if (!ts.isElementAccessExpression(node.left)) return;
    if (!ts.isIdentifier(node.left.expression) || node.left.expression.text !== "SUBJECT_CLOSERS") return;
    const key = String(literalOf(node.left.argumentExpression, abs));
    const right = node.right;
    let target = null;
    if (ts.isPropertyAccessExpression(right) && ts.isIdentifier(right.expression) && right.expression.text === "SUBJECT_CLOSERS") {
      target = right.name.text;
    } else if (ts.isElementAccessExpression(right) && ts.isIdentifier(right.expression) && right.expression.text === "SUBJECT_CLOSERS") {
      target = String(literalOf(right.argumentExpression, abs));
    }
    if (!target) fail(`SUBJECT_CLOSERS[${key}] is assigned something this reader cannot follow`);
    aliases.push({ key, sameAs: target });
  });
  for (const a of aliases) bodies[a.key] = bodies[a.sameAs] ?? "";
  return { direct, aliases, bodies, all: [...direct, ...aliases.map((a) => a.key)] };
}

/** What each kind of decision asks: the per-subject floors, as code holds them. */
export function subjectFloors(root = ROOT) {
  const abs = absOf(root, "shared/ballotSubjects.ts");
  const init = constAnywhere(abs, "SUBJECT_THRESHOLDS");
  if (!init) fail("shared/ballotSubjects.ts no longer declares SUBJECT_THRESHOLDS");
  if (!ts.isObjectLiteralExpression(init)) fail("SUBJECT_THRESHOLDS is no longer an object literal");
  const out = [];
  for (const p of init.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const key = propertyName(p.name, abs);
    if (key === null) fail(`SUBJECT_THRESHOLDS holds a key this reader cannot read: ${p.getText().slice(0, 60)}`);
    out.push({ subject: key, ...objectOf(p.initializer, abs) });
  }
  if (!out.length) fail("SUBJECT_THRESHOLDS is empty; the launch floor is the one rule this document cannot render without");
  return out;
}

/** The engine's arithmetic: methods, choices, and what each method fixes. */
export function engineFacts(root = ROOT) {
  const rel = "shared/governanceEngine.ts";
  const abs = absOf(root, rel);
  const methods = listConst(root, rel, "BALLOT_METHODS");
  const choices = listConst(root, rel, "VOTE_CHOICES");
  const outcomes = unionOf(root, rel, "BallotOutcome");

  const sf = sourceFile(abs);
  let fn;
  eachChild(sf, (n) => { if (ts.isFunctionDeclaration(n) && n.name?.text === "dialsForMethod") fn = n; });
  if (!fn) fail(`${rel} no longer declares dialsForMethod(); the method presets are read from its switch`);
  let sw;
  eachChild(fn, (n) => { if (!sw && ts.isSwitchStatement(n)) sw = n; });
  if (!sw) fail("dialsForMethod() is no longer a switch; this reader cannot follow it");
  const presets = {};
  let sawDefault = false;
  for (const clause of sw.caseBlock.clauses) {
    const ret = clause.statements.find((s) => ts.isReturnStatement(s));
    if (!ret?.expression) fail("a dialsForMethod case does not return an object; this reader cannot follow it");
    const shape = ts.isObjectLiteralExpression(ret.expression) ? ret.expression : null;
    if (!shape) fail("a dialsForMethod case returns something other than an object literal");
    const unity = shape.properties.find((q) => ts.isPropertyAssignment(q) && propertyName(q.name, abs) === "unityPct");
    if (!unity) fail("a dialsForMethod case no longer returns unityPct");
    const stamped = ts.isNumericLiteral(unity.initializer) ? Number(unity.initializer.text) : null;
    if (ts.isDefaultClause(clause)) {
      sawDefault = true;
      if (stamped !== null) fail(`dialsForMethod's default stamps unity ${stamped}; the document assumes it takes the village's own`);
      continue;
    }
    presets[String(literalOf(clause.expression, abs))] = stamped;
  }
  if (!sawDefault) fail("dialsForMethod has no default clause, so no method takes the village's own unity");
  /*
   * A method the switch does not name falls to the default and takes the
   * village's own number. That is written out as an explicit null rather than
   * left absent: JSON.stringify drops an undefined value, so the machine
   * readable block would have carried nothing at all for the shipped default
   * method and a parser would have read the omission as "no such method".
   */
  for (const m of methods) if (!(m in presets)) presets[m] = null;
  return { methods, choices, outcomes, presets };
}

/** The ballot's own state machine, from the row shape the engine writes. */
export function ballotStatuses(root = ROOT) {
  const rel = "server/lib/ballots.ts";
  const abs = absOf(root, rel);
  const sf = sourceFile(abs);
  let found;
  eachChild(sf, (node) => {
    if (found || !ts.isInterfaceDeclaration(node) || node.name.text !== "BallotRow") return;
    const member = node.members.find((m) => ts.isPropertySignature(m) && ts.isIdentifier(m.name) && m.name.text === "status");
    if (!member?.type || !ts.isUnionTypeNode(member.type)) fail(`${rel}: BallotRow.status is no longer a union of string literals`);
    found = member.type.types.map((t) => {
      if (!ts.isLiteralTypeNode(t) || !ts.isStringLiteral(t.literal)) fail(`${rel}: BallotRow.status holds a member this reader cannot read`);
      return t.literal.text;
    });
  });
  if (!found) fail(`${rel} no longer declares interface BallotRow with a status field`);
  return found;
}

/** The dials, with the ring and the apply timing the platform resolves for each. */
export function governanceDials(root = ROOT) {
  const rel = "shared/gameVariables.ts";
  const abs = absOf(root, rel);
  const sf = sourceFile(abs);
  const founderKeys = new Set(listConst(root, rel, "FOUNDER_KEYS"));
  const founderCategories = new Set(listConst(root, rel, "FOUNDER_CATEGORIES"));
  const cycleKeys = listConst(root, rel, "CYCLE_APPLY_KEYS");

  const defs = [];
  eachChild(sf, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return;
    const props = new Map();
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const key = propertyName(p.name, abs);
      if (key !== null) props.set(key, p.initializer);
    }
    if (!props.has("key") || !props.has("category") || !props.has("label") || !props.has("type")) return;
    const keyNode = props.get("key");
    if (!ts.isStringLiteral(keyNode)) return;
    const def = { key: keyNode.text };
    for (const field of ["category", "label", "type", "default", "unit", "ring", "applyTiming"]) {
      if (props.has(field)) def[field] = literalOf(props.get(field), abs);
    }
    for (const field of ["min", "max"]) {
      if (props.has(field)) def[field] = literalOf(props.get(field), abs);
    }
    /*
     * A `choices` list is written inline for most dials and hoisted into its
     * own const for one of them. Resolving the identifier matters: reading
     * only inline arrays reported that dial's bounds as its type, which told
     * a founder nothing about what they could set it to.
     */
    if (props.has("choices")) {
      let arr = props.get("choices");
      // `CHOICES.map((c) => ({ ...c }))` copies a hoisted list; the list is
      // what the document reports, so the copy is stepped through to it.
      if (
        ts.isCallExpression(arr) &&
        ts.isPropertyAccessExpression(arr.expression) &&
        arr.expression.name.text === "map"
      ) {
        arr = arr.expression.expression;
      }
      if (ts.isIdentifier(arr)) {
        const resolved = constAnywhere(abs, arr.text);
        if (!resolved) fail(`${rel}: the dial "${def.key}" takes its choices from ${arr.text}, which is not a const in this file`);
        arr = resolved;
      }
      if (ts.isAsExpression(arr)) arr = arr.expression;
      if (!ts.isArrayLiteralExpression(arr)) fail(`${rel}: the dial "${def.key}" has choices this reader cannot read`);
      def.choices = arr.elements.map((e) => objectOf(e, abs));
    }
    defs.push(def);
  });
  if (!defs.length) fail(`${rel} no longer holds any variable definitions this reader can see`);

  const ringOf = (def) => {
    if (def.ring) return def.ring;
    if (founderKeys.has(def.key)) return "founder";
    if (founderCategories.has(def.category)) return "founder";
    return "open";
  };
  const applyTimingOf = (def) => def.applyTiming ?? (cycleKeys.includes(def.key) ? "cycle-close" : "instant");

  const governance = defs
    .filter((d) => d.category === "Governance")
    .map((d) => ({ ...d, ring: ringOf(d), applyTiming: applyTimingOf(d) }));
  if (!governance.length) fail(`${rel} no longer holds a Governance category; the dials table is read from it`);

  /*
   * The stage multipliers carry an explicit `applyTiming: "cycle-close"`
   * instead of sitting in CYCLE_APPLY_KEYS, because they are generated per
   * rung from the ladder. Reading the Set alone would have the document report
   * ten cycle-timed dials when there are ten plus one per stage, so the
   * override is read as its own fact and its absence is a refusal.
   */
  const multipliers = constAnywhere(abs, "STAGE_MULTIPLIER_DEFS");
  if (!multipliers) fail(`${rel} no longer declares STAGE_MULTIPLIER_DEFS; the cycle-timed list reads its apply timing`);
  const multiplierTiming = /applyTiming:\s*"cycle-close"/.test(multipliers.getText());

  return {
    governance,
    allKeys: defs.map((d) => d.key),
    cycleApplyKeys: cycleKeys,
    stageMultipliersAreCycleTimed: multiplierTiming,
  };
}

/** Who may do what: the capability table, and which powers can be taken away. */
export function capabilityFacts(root = ROOT) {
  const rel = "shared/capabilities.ts";
  const all = listConst(root, rel, "ALL_CAPABILITIES");
  const labels = recordConst(root, rel, "CAPABILITY_LABELS");
  const deniable = recordConst(root, rel, "DENIABLE");
  const unlocks = recordConst(root, rel, "STAGE_UNLOCKS");
  const transferable = recordConst(root, rel, "TRANSFERABLE");
  for (const cap of all) {
    if (!(cap in labels)) fail(`${rel}: the capability "${cap}" has no entry in CAPABILITY_LABELS`);
    if (!(cap in deniable)) fail(`${rel}: the capability "${cap}" has no entry in DENIABLE`);
  }
  return { all, labels, deniable, unlocks, transferable };
}

/** The governance module: what it turns on, and what a fresh village has. */
export function moduleFacts(root = ROOT) {
  const rel = "shared/modules.ts";
  const abs = absOf(root, rel);
  const sf = sourceFile(abs);
  const lifecycles = unionOf(root, rel, "ModuleLifecycle");
  let found;
  eachChild(sf, (node) => {
    if (found || !ts.isObjectLiteralExpression(node)) return;
    const idProp = node.properties.find(
      (p) => ts.isPropertyAssignment(p) && propertyName(p.name, abs) === "id" && ts.isStringLiteral(p.initializer) && p.initializer.text === "governance",
    );
    if (!idProp) return;
    /*
     * Two other object literals in this file carry `id: "governance"`: a forum
     * category and a tools-hub category, both of them a label and a sort
     * order. The module definition is the one that also declares the prefixes
     * its routes mount behind, so that is what tells them apart. A reader that
     * took the first match reported the module as having no prefixes and lost
     * the 404 fact, which is the first thing this document says about a fresh
     * village.
     */
    const hasPrefixes = node.properties.some((p) => ts.isPropertyAssignment(p) && propertyName(p.name, abs) === "apiPrefixes");
    if (!hasPrefixes) return;
    const out = { id: "governance" };
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const key = propertyName(p.name, abs);
      if (!key || key === "id") continue;
      if (ts.isArrayLiteralExpression(p.initializer)) {
        out[key] = p.initializer.elements.map((e) => literalOf(e, abs));
        continue;
      }
      if (ts.isStringLiteral(p.initializer) || ts.isNumericLiteral(p.initializer)) out[key] = literalOf(p.initializer, abs);
    }
    found = out;
  });
  if (!found) fail(`${rel} no longer defines a module whose id is "governance"`);
  if (!Array.isArray(found.apiPrefixes) || !found.apiPrefixes.length) {
    fail(`${rel}: the governance module no longer declares apiPrefixes; the 404 fact is read from them`);
  }
  return { ...found, lifecycles };
}

/** The wizard's type lists, on both sides, so the drift between them is a fact. */
export function wizardTypes(root = ROOT) {
  const server = listConst(root, "server/lib/proposalDrafts.ts", "WIZARD_TYPES");
  const conductable = listConst(root, "server/lib/proposalDrafts.ts", "CONDUCTABLE_TYPES");
  const client = listConst(root, "client/src/components/governance/wizardConfig.ts", "WIZARD_TYPES");
  const advisory = server.filter((t) => !conductable.includes(t));
  for (const t of conductable) {
    if (!server.includes(t)) fail(`CONDUCTABLE_TYPES names "${t}", which WIZARD_TYPES does not; the wizard would offer a type it cannot draft`);
  }
  return { server, client, conductable, advisory };
}

/** Weight: the three modes, and the dials that choose between them. */
export function weightFacts(root = ROOT) {
  return { modes: unionOf(root, "server/lib/governanceWeights.ts", "WeightMode") };
}

/** What a change set may carry, from the one validator that prices it. */
export function changeSetFacts(root = ROOT) {
  const rel = "server/lib/mechanics.ts";
  const abs = absOf(root, rel);
  // The cap is read from the exported constant when there is one, because a
  // named export survives a refactor that a literal in a comparison does not.
  // The old inline shape is still accepted so this keeps answering for a tree
  // that has not named it yet, and the refusal fires only when both are gone.
  const named = constAnywhere(abs, "CHANGE_SET_CAP");
  if (named) {
    const cap = literalOf(named, abs);
    if (typeof cap !== "number") fail(`${rel} declares CHANGE_SET_CAP as something other than a number`);
    return { maxChanges: cap };
  }
  const text = fs.readFileSync(abs, "utf8");
  const m = /changes\.length\s*>\s*(\d+)/.exec(text);
  if (!m) {
    fail(`${rel} caps a change set neither with CHANGE_SET_CAP nor with "changes.length > N"; the dial ceiling is read from one of them`);
  }
  return { maxChanges: Number(m[1]) };
}

/** Starting the Game: the one row that says a village has, and what it refuses until then. */
export function launchFacts(root = ROOT) {
  const rel = "server/lib/gameStart.ts";
  const abs = absOf(root, rel);
  const sf = sourceFile(abs);
  const configKey = constAnywhere(abs, "CONFIG_KEY");
  if (!configKey) fail(`${rel} no longer declares CONFIG_KEY; the launch fact is stored under it`);
  let refusal;
  eachChild(sf, (node) => {
    if (refusal || !ts.isFunctionDeclaration(node) || node.name?.text !== "issuanceRefusal") return;
    const parts = [];
    eachChild(node, (n) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts.push(n.text);
    });
    const joined = parts.join("").trim();
    if (!joined) fail(`${rel}: issuanceRefusal() no longer carries the sentence it returns`);
    refusal = joined;
  });
  if (!refusal) fail(`${rel} no longer declares issuanceRefusal(); the pre-launch rule is read from its sentence`);
  for (const name of ["readGameStart", "recordGameStart", "founderPowerStands"]) {
    let seen = false;
    eachChild(sf, (n) => { if (ts.isFunctionDeclaration(n) && n.name?.text === name) seen = true; });
    if (!seen) fail(`${rel} no longer declares ${name}()`);
  }
  return { configKey: literalOf(configKey, abs), issuanceRefusal: refusal };
}

/** The clock: one lunation table, one id format, and the frozen past. */
export function clockFacts(root = ROOT) {
  const lunarRel = "shared/lunar.ts";
  const lunarAbs = absOf(root, lunarRel);
  const synodic = constAnywhere(lunarAbs, "SYNODIC_MONTH_DAYS");
  if (!synodic) fail(`${lunarRel} no longer declares SYNODIC_MONTH_DAYS`);
  const trueFrom = constAnywhere(lunarAbs, "TRUE_CLOCK_FROM_CYCLE");
  if (!trueFrom) fail(`${lunarRel} no longer declares TRUE_CLOCK_FROM_CYCLE; the frozen past is read from it`);

  // The id format moved to `shared/cycleClock.ts` when the rhythm became a
  // setting again (brief section 19, Q5). Read it from there: that file owns
  // both clocks now, and `gratitude-cycles.ts` calls through to it.
  const cyclesRel = "shared/cycleClock.ts";
  const cyclesAbs = absOf(root, cyclesRel);
  const cyclesText = fs.readFileSync(cyclesAbs, "utf8");
  const pad = /padStart\((\d+),\s*"0"\)/.exec(cyclesText);
  const prefix = /LUNAR_ID_PREFIX\s*=\s*"([a-z-]+)"/.exec(cyclesText);
  const calPrefix = /CALENDAR_ID_PREFIX\s*=\s*"([a-z-]+)"/.exec(cyclesText);
  if (!pad || !prefix) fail(`${cyclesRel}: the lunar cycle id is no longer a zero-padded "lunar-" id; the cycle id format is read from it`);
  if (!calPrefix) fail(`${cyclesRel} no longer declares CALENDAR_ID_PREFIX; the second clock's id format is read from it`);
  if (!new RegExp(`\\^${prefix[1]}`).test(cyclesText)) {
    fail(`${cyclesRel}: parseId no longer anchors on "${prefix[1]}", so an id this document describes would not parse back`);
  }
  if (!new RegExp(`\\^${calPrefix[1]}`).test(cyclesText)) {
    fail(`${cyclesRel}: parseId no longer anchors on "${calPrefix[1]}", so a calendar id would not parse back`);
  }

  const table = constAnywhere(lunarAbs, "LUNAR_TABLE_YEARS");
  if (!table) fail(`${lunarRel} no longer declares LUNAR_TABLE_YEARS`);
  const yearsText = table.getText();
  const years = /fromYear[\s\S]*?toYear/.test(yearsText) ? "read from shared/lunarTable.json" : null;
  if (!years) fail(`${lunarRel}: LUNAR_TABLE_YEARS no longer reads its range from the checked-in table`);

  return {
    synodicMonthDays: literalOf(synodic, lunarAbs),
    trueClockFromCycle: literalOf(trueFrom, lunarAbs),
    idPrefix: prefix[1],
    idDigits: Number(pad[1]),
    idExample: `${prefix[1]}${String(literalOf(trueFrom, lunarAbs)).padStart(Number(pad[1]), "0")}`,
    calendarIdPrefix: calPrefix[1],
    calendarIdExample: `${calPrefix[1]}2026-09`,
  };
}


/**
 * WHAT QUORUM COUNTS, read out of the arithmetic itself.
 *
 * 19F rules that quorum is pure token weight with people counts shown beside
 * it, and section 20.8's head-count quorum is withdrawn. A document that says
 * so is making a claim about one function, so the claim is derived from that
 * function instead of typed here: `quorumPctOf` is parsed, the weight fields it
 * adds are collected, and any head field it reads is collected too. The
 * document renders one sentence when the two agree with 19F and a loud one when
 * they do not, and the self-test pins the pair together so neither can move
 * alone.
 */
export function quorumFormulaFacts(root = ROOT) {
  const rel = "shared/governanceEngine.ts";
  const abs = absOf(root, rel);
  const fn = functionAnywhere(abs, "quorumPctOf");
  if (!fn) fail(`${rel} no longer declares quorumPctOf(); what quorum counts is read from its body`);
  const body = fn.getText();
  const weightFields = ["yesW", "noW", "abstainW"].filter((n) => body.includes(`t.${n}`));
  if (weightFields.length < 3) {
    fail(
      `${rel}: quorumPctOf() no longer adds all three weights (${weightFields.join(", ") || "none"}). ` +
        "This document states what quorum counts, and it reads that from this function.",
    );
  }
  // A head field is `t.yes`, `t.no` or `t.abstain` with no trailing W. The
  // negative lookahead is the whole point: `t.yesW` must not read as `t.yes`.
  const headFields = ["yes", "no", "abstain"].filter((n) => new RegExp(`t\\.${n}(?![A-Za-z])`).test(body));
  const dividesByTotalWeight = /totalWeight/.test(body);
  if (!dividesByTotalWeight) {
    fail(`${rel}: quorumPctOf() no longer divides by totalWeight; the quorum sentence is read from that division`);
  }
  return { weightFields, headFields, dividesByTotalWeight, weightOnly: headFields.length === 0 };
}

/**
 * THE CLASSIFICATION TABLE: which decisions send tokens and which change the
 * Game, and what that does to when they happen.
 *
 * The two kinds are the hinge of the whole veto model, so the document reads
 * them out of the one table the engine reads rather than restating them. A
 * subject or an item kind absent from the map is a Game change, which is the
 * fail-safe direction, and this reader states that rather than listing the
 * absences it cannot see.
 */
export function kindFacts(root = ROOT) {
  const rel = "shared/governanceKinds.ts";
  const abs = absOf(root, rel);
  const kinds = listConst(root, rel, "GOVERNANCE_KINDS");
  const timings = listConst(root, rel, "PROPOSAL_TIMINGS");
  const forSubject = recordConst(root, rel, "KIND_FOR_SUBJECT");
  const forItem = recordConst(root, rel, "KIND_FOR_ITEM_KIND");
  const defaultTiming = constAnywhere(abs, "DEFAULT_TIMING");
  if (!defaultTiming) fail(`${rel} no longer declares DEFAULT_TIMING; the timing default is read from it`);
  const floor = constAnywhere(abs, "VETO_HOURS_FLOOR");
  if (!floor) fail(`${rel} no longer declares VETO_HOURS_FLOOR; the window's floor is read from it`);

  // `new Set([...])`, which is the shape the no-window list is written in.
  const noWindow = constAnywhere(abs, "NO_WINDOW_SUBJECTS");
  if (!noWindow) fail(`${rel} no longer declares NO_WINDOW_SUBJECTS; the not-vetoable list is read from it`);
  let arr = noWindow;
  if (ts.isAsExpression(arr)) arr = arr.expression;
  if (ts.isNewExpression(arr)) arr = arr.arguments?.[0];
  if (!arr || !ts.isArrayLiteralExpression(arr)) {
    fail(`${rel}: NO_WINDOW_SUBJECTS is no longer a Set built from an array literal; this reader cannot follow it`);
  }
  const noWindowSubjects = arr.elements.map((e) => String(literalOf(e, abs)));
  if (!noWindowSubjects.length) {
    fail(`${rel}: NO_WINDOW_SUBJECTS is empty; the not-vetoable list is the one carve-out this document states`);
  }

  const fn = functionAnywhere(abs, "defaultTimingFor");
  if (!fn) fail(`${rel} no longer declares defaultTimingFor(); the per-kind timing default is read from it`);
  const body = fn.getText();
  const defaults = {};
  for (const kind of kinds) {
    const m = new RegExp(`${kind}[^\\n]*?"(at_acceptance|next_moon)"`).exec(body);
    defaults[kind] = m ? m[1] : String(literalOf(defaultTiming, abs));
  }

  return {
    kinds,
    timings,
    defaultTiming: String(literalOf(defaultTiming, abs)),
    defaultsByKind: defaults,
    forSubject,
    forItem,
    noWindowSubjects,
    vetoHoursFloor: literalOf(floor, abs),
  };
}

/**
 * THE TABLES AND COLUMNS THE VETO MODEL NEEDS, checked against the migrations.
 *
 * The document states, as fact, that a carried decision carries a landing
 * instant, that a veto has a window with a closing instant, that every element
 * of a change set leaves a ledger row, that one executor is elected, that a
 * delegation is not live until the delegate accepts it, and that a term has a
 * history of its own. Every one of those sentences is a claim about a column,
 * and a document that keeps making them after the column is gone is exactly the
 * failure this generator exists to prevent.
 *
 * So each one is anchored on the shape a migration writes, and the whole set is
 * refused loudly when one is missing. NO MIGRATION NUMBER APPEARS HERE: numbers
 * are claimed across worktrees and renumbered when a build lands, so the reader
 * walks the directory and reads the text.
 */
const SCHEMA_SHAPES = [
  { name: "ballots.lands_at", what: "the instant a carried decision lands", test: /`ballots`\s+ADD COLUMN `lands_at`/ },
  { name: "ballots.veto_closes_at", what: "the instant the window shuts", test: /`ballots`\s+ADD COLUMN `veto_closes_at`/ },
  { name: "ballots.timing", what: "the proposer's choice of when it happens", test: /`ballots`\s+ADD COLUMN `timing`/ },
  { name: "ballots.vetoed_at", what: "the act of stopping it, on the ballot the veto answers", test: /`ballots`\s+ADD COLUMN `vetoed_at`/ },
  { name: "ballots.vetoed_by", what: "who stopped it", test: /`ballots`\s+ADD COLUMN `vetoed_by`/ },
  { name: "ballots.late_settled_at", what: "a window already over when the row reached passed", test: /`ballots`\s+ADD COLUMN `late_settled_at`/ },
  { name: "the landing statuses", what: "applying and stalled beside applied and vetoed", test: /enum\([^)]*'applying'[^)]*'stalled'[^)]*\)/ },
  { name: "the vetoed outcome", what: "a vetoed decision is not a failed one", test: /'vetoed'/ },
  { name: "mechanics_proposals.lands_at", what: "the same instant on the proposal a village reads", test: /`mechanics_proposals`\s+ADD COLUMN `lands_at`/ },
  { name: "mechanics_proposals.supersedes_relation", what: "renews, overrides or replaces, stated rather than guessed", test: /`mechanics_proposals`\s+ADD COLUMN `supersedes_relation`/ },
  { name: "governance_element_ledger", what: "one row per element written, keyed on the ballot and the element's place in it", test: /CREATE TABLE[^;]*`governance_element_ledger`/ },
  { name: "governance_executor_pending", what: "the failure a resumed attempt exists to record", test: /CREATE TABLE[^;]*`governance_executor_pending`/ },
  { name: "delegations.accepted_at", what: "a delegation carries a choice only once the delegate accepts it", test: /`delegations`\s+ADD COLUMN `accepted_at`/ },
  { name: "role_holder_terms", what: "a term survives an unrelated appointment", test: /CREATE TABLE[^;]*`role_holder_terms`/ },
];

export function schemaFacts(root = ROOT) {
  const dir = absOf(root, MIGRATION_DIR);
  if (!fs.existsSync(dir)) fail(`${MIGRATION_DIR} is gone; the tables this document describes are read from it`);
  const files = fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
  if (!files.length) fail(`${MIGRATION_DIR} holds no migration; the tables this document describes are read from them`);
  const sql = files.map((n) => fs.readFileSync(path.join(dir, n), "utf8")).join("\n");
  for (const shape of SCHEMA_SHAPES) {
    if (shape.test.test(sql)) continue;
    fail(
      `no migration under ${MIGRATION_DIR}/ writes ${shape.name} (${shape.what}). ` +
        "This document states that as a fact about a fresh village, so it will not render without it. " +
        "If the shape moved, fix the anchor in SCHEMA_SHAPES; if the feature went, the paragraph that " +
        "describes it has to go with it.",
    );
  }
  return { migrationCount: files.length, shapes: SCHEMA_SHAPES.map((s) => ({ name: s.name, what: s.what })) };
}

/**
 * THE SETTINGS THIS DOCUMENT NAMES OUT LOUD, whatever category they sit in.
 *
 * `dialCoverageProblem` guards the Governance category in both directions.
 * These are the keys the prose names in sentences, including one that lives in
 * another category (`cycle.mode`), so a rename anywhere stops the build instead
 * of leaving a paragraph about a setting nobody can find.
 */
const NAMED_DIALS = [
  ["governance.veto_hours", "how long a steward has, never below the floor"],
  ["governance.steward_council", "whether one steward stops a change or a majority of them"],
  ["governance.highest_tier", "the tier a veto override has to reach"],
  ["governance.steward_subjects", "which kinds of decision a steward may stop"],
  ["governance.nonhuman_in_quorum", "whether a non-human seat's weight counts toward quorum"],
  ["governance.absent_cycles", "how long a seat may go unvoted before its weight leaves the denominator"],
  ["governance.window_grace_days", "how long anything coming back may open outside its window"],
  ["cycle.mode", "which clock the village runs"],
];

export function namedDialProblem(allKeys, named = NAMED_DIALS) {
  for (const [key, what] of named) {
    if (allKeys.includes(key)) continue;
    return (
      `the setting "${key}" (${what}) is named in this document and shared/gameVariables.ts no longer holds it. ` +
      "Fix the key, or delete the sentence that names it."
    );
  }
  return null;
}


/**
 * WHAT A VILLAGE PUBLISHES, read from the route registrations themselves.
 *
 * Every `app.get|post|put|patch|delete("/api/governance...")` and
 * `"/api/game/mechanics..."` in `server/index.ts` and in the two governance
 * route modules, with the door each one keeps. The door is CLASSIFIED, never
 * guessed: a handler whose body matches none of the shapes below is reported
 * as "could not derive" and rendered that way in the document, because a route
 * this reader was wrong about is worse than a route it admits it cannot read.
 *
 * The shapes, in the order they are tested. The order is the order the code
 * itself refuses in: an administrator check outranks a capability check, and a
 * capability check outranks a sign-in check.
 */
/**
 * A capability key, whether it is written as a string or as a constant.
 *
 * `mayAct(req, "proposal.decide")` is the common shape and
 * `mayAct(req, STEWARD_VETO)` is the shape the veto routes use. A pattern that
 * matched only the literal read four gated routes as ungated, which is the one
 * kind of mistake this classifier is not allowed to make.
 */
const CAP_CALL = /\b(?:mayAct|guardCapability)\s*\(\s*req\s*,\s*(?:"([\w.]+)"|([A-Z][A-Z0-9_]*))/;

const AUTH_SHAPES = [
  { name: "administrator", test: (b) => /\bisAdmin\s*\(\s*req\b/.test(b) || /requireAdmin\b/.test(b) },
  {
    name: "capability",
    test: (b) => CAP_CALL.test(b),
    key: (b, _params, resolve) => {
      const m = CAP_CALL.exec(b);
      if (m[1]) return m[1];
      const resolved = resolve ? resolve(m[2]) : null;
      // A constant this reader could not follow is reported as the constant's
      // own name, which is a true statement about the code and never a guess
      // at a key that might not exist.
      return resolved ?? m[2];
    },
  },
  {
    name: "signed in",
    test: (b) =>
      /if\s*\(\s*!\s*(?:user|viewer|actor)\s*\)\s*\{?\s*return\s+res\s*\.\s*status\(401\)/.test(b) ||
      /if\s*\(\s*!\s*(?:user|viewer|actor)\s*\)\s*\{[\s\S]{0,200}?res\s*\.\s*status\(401\)/.test(b),
  },
  { name: "anyone, including a stranger", test: (b) => /\bauthedUser\s*\(\s*req\b/.test(b) },
];

/**
 * Anything in a handler that could be reading who is asking.
 *
 * A handler that mentions none of these has no door at all and answers a
 * stranger, which is a fact this reader can state. A handler that DOES mention
 * one and matches none of the shapes above is a door this reader cannot
 * classify, and the document says "could not derive" for it. The two cases
 * look the same from a distance and mean opposite things, so they are split
 * here instead of collapsed into one guess.
 */
const AUTH_MENTION = /\b(authedUser|isAdmin|mayAct|guardCapability|requireAdmin|capabilityCtx|hasCapability|capabilityDecision)\b|\breq\.user\b/;

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/**
 * The door a handler keeps, from its own text. Pure, so the self-test can put
 * fixtures through the same function the document is rendered from.
 */
export function classifyDoor(body, params = "req, res", resolve = null) {
  for (const shape of AUTH_SHAPES) {
    if (!shape.test(body, params)) continue;
    return { door: shape.name, capability: shape.key ? shape.key(body, params, resolve) : null };
  }
  if (!AUTH_MENTION.test(body)) return { door: "anyone, including a stranger", capability: null };
  return { door: "could not derive", capability: null };
}

/**
 * THE HANDLER, PLUS THE SAME-FILE HELPERS IT CALLS.
 *
 * A route module that extracts its door into one local `gate(req, res)` and
 * calls it from every handler leaves each handler's own text mentioning nothing
 * about who is asking. Classified from that text alone, four gated routes came
 * out as "anyone, including a stranger", and the veto route (a session plus
 * `steward.veto`) was published in this document as open to the internet. That
 * is worse than no reader at all.
 *
 * So the text put to the classifier is the handler plus, ONE LEVEL DEEP, the
 * body of every function it calls that is declared in the same file. That is
 * the call graph and not a string search, which is the rule this repository
 * paid for: an absent substring proves nothing, and a door factored into a
 * well-named helper is what factoring is for.
 */
/**
 * EVERY LOCAL FUNCTION IN A FILE, INDEXED ONCE.
 *
 * `functionAnywhere` and `constAnywhere` each walk the whole file. Calling them
 * per identifier per handler over a 28,000-line file made the self-test take
 * longer than the whole rest of the suite, so the declarations are indexed once
 * per file and every handler reads the index.
 */
const localFnCache = new Map();

function localFunctions(abs) {
  if (localFnCache.has(abs)) return localFnCache.get(abs);
  const index = new Map();
  eachChild(sourceFile(abs), (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text && !index.has(node.name.text)) {
      index.set(node.name.text, node.getText());
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      !index.has(node.name.text)
    ) {
      index.set(node.name.text, node.initializer.getText());
    }
  });
  localFnCache.set(abs, index);
  return index;
}

function bodyWithHelpers(abs, handler) {
  const index = localFunctions(abs);
  const parts = [handler.getText()];
  const called = new Set();
  eachChild(handler, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) called.add(n.expression.text);
  });
  for (const name of called) {
    const text = index.get(name);
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

/** A `SCREAMING_CASE` capability constant's value, followed into its import. */
function capabilityConstant(abs, name) {
  const here = constAnywhere(abs, name);
  if (here && (ts.isStringLiteral(here) || ts.isNoSubstitutionTemplateLiteral(here))) return here.text;
  const from = importSource(abs, name);
  if (!from || !fs.existsSync(from.abs)) return null;
  const there = constAnywhere(from.abs, from.exported);
  if (there && (ts.isStringLiteral(there) || ts.isNoSubstitutionTemplateLiteral(there))) return there.text;
  return null;
}

function routesIn(root, rel, prefixes) {
  const abs = absOf(root, rel);
  const sf = sourceFile(abs);
  const out = [];
  eachChild(sf, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression) || callee.expression.text !== "app") return;
    const method = callee.name.text;
    if (!HTTP_METHODS.has(method)) return;
    const first = node.arguments[0];
    if (!first || !ts.isStringLiteral(first)) return;
    const routePath = first.text;
    if (!prefixes.some((p) => routePath === p || routePath.startsWith(`${p}/`))) return;
    const handler = node.arguments[node.arguments.length - 1];
    const body = handler ? bodyWithHelpers(abs, handler) : "";
    const params =
      handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))
        ? handler.parameters.map((p) => p.name.getText()).join(", ")
        : "";
    const { door, capability } = classifyDoor(body, params, (name) => capabilityConstant(abs, name));
    out.push({ method: method.toUpperCase(), path: routePath, file: rel, door, capability });
  });
  return out;
}

/**
 * EVERY ROUTE MODULE, FOUND ON DISK RATHER THAN LISTED HERE.
 *
 * This used to be a hand-written list of three files, and it went wrong in the
 * way a hand-written list of files always goes wrong: four route modules landed
 * after it was written, so `server/routes/delegation.ts`,
 * `server/routes/governanceVetoes.ts`, `server/routes/governanceLanding.ts` and
 * `server/routes/governanceMode.ts` were invisible to this document. The routes
 * table lost thirteen rows, and worse, `stagedFlags()` reads this same walk for
 * evidence, so the document stated as a fact that delegation was staged and not
 * built while seven delegation routes were answering members.
 *
 * A directory walk cannot go stale that way. A module a later lane adds is read
 * the day it appears, and the guard goes red until the document is regenerated,
 * which is the design.
 */
function routeModules(root) {
  const dir = absOf(root, ROUTE_DIR);
  if (!fs.existsSync(dir)) fail(`${ROUTE_DIR} is gone; every route module is read from it`);
  const names = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(n))
    .sort();
  if (!names.length) fail(`${ROUTE_DIR} holds no route module; the route table is read from that directory`);
  return names.map((n) => `${ROUTE_DIR}/${n}`);
}

export function routeFacts(root = ROOT) {
  const files = ["server/index.ts", ...routeModules(root)];
  const rows = [];
  for (const rel of files) rows.push(...routesIn(root, rel, ["/api/governance", "/api/game/mechanics"]));
  if (!rows.length) {
    fail("no route under /api/governance or /api/game/mechanics was found; the reader walks app.get/post/put/patch/delete calls and something has moved");
  }
  rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const governancePrefixed = rows.filter((r) => r.path.startsWith("/api/governance"));
  const mechanics = rows.filter((r) => r.path.startsWith("/api/game/mechanics"));
  return {
    rows,
    total: rows.length,
    governanceCount: governancePrefixed.length,
    mechanicsCount: mechanics.length,
    anonymous: rows.filter((r) => r.door === "anyone, including a stranger"),
    undeclared: rows.filter((r) => r.door === "could not derive"),
    withCapability: rows.filter((r) => r.capability),
  };
}

/**
 * THE COMMIT THESE SOURCES WERE LAST CHANGED IN.
 *
 * The document names the commit it describes, which section 0 of the brief
 * asks of anything generated here. It cannot be `HEAD`: HEAD moves the moment
 * the document is committed, and the guard's byte comparison would go red on
 * the commit that landed it. So it is the last commit that touched any file in
 * SOURCES, which is stable for as long as the sources are, and moves only when
 * the facts move.
 *
 * ONE CONSEQUENCE, SAID HERE SO NOBODY HAS TO WORK IT OUT FROM A RED GATE. A
 * commit that changes a source AND regenerates this document in the same
 * commit writes the PREVIOUS commit's id, because the new one did not exist
 * when the generator ran. Regenerating once more after that commit lands fixes
 * it, and the guard's own failure message says so. Regenerating AFTER a merge,
 * which is what the merge agent does, converges in one pass.
 *
 * It fails loud when git cannot answer. A checkout with no history cannot tell
 * this document what it is describing, and a document that guessed would be
 * making up the one fact a reader uses to check everything else.
 */
const commitCache = new Map();

export function sourceCommit(root = ROOT) {
  /*
   * ONE GIT CALL PER PROCESS, PER ROOT.
   *
   * The self-test renders the document half a dozen times, and on Windows a
   * repeated `spawnSync` of the same executable inside one process
   * intermittently comes back `UNKNOWN` with nothing wrong: the generator ran
   * green for a dozen renders and then failed on the seventh in the same
   * second. The commit cannot change while this process runs, so caching it
   * removes the flake and the repeated cost together.
   */
  if (commitCache.has(root)) return commitCache.get(root);
  let out;
  try {
    out = execFileSync("git", ["log", "-1", "--format=%H", "--", ...SOURCES], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    fail(
      "git could not say which commit last changed the sources " +
        `(${String(err?.message ?? err).split("\n")[0]}). This document names the commit it describes, ` +
        "and a checkout with no history cannot answer that.",
    );
  }
  const sha = String(out).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    fail(`git answered "${sha.slice(0, 60)}" for the last commit touching the sources, which is not a commit id`);
  }
  commitCache.set(root, sha);
  return sha;
}

// ── The prose. Written by a person, kept here so the file stays generated ───

/**
 * Every sentence in this document that a person wrote.
 *
 * MARKED WHERE IT APPEARS. `docs/TOKENS.md` promises that its written lines
 * are marked and only half keeps it: the rulings section is marked and the
 * per-token sentences are not, so a reader of one of those sentences has no
 * way to tell it from a fact read out of the code. Here every entry renders
 * behind an HTML comment carrying its key, so the source of the document says
 * which lines are somebody's words and the rendered page stays clean.
 * `proseCoverageProblem` refuses in both directions, so a paragraph cannot
 * ship unmarked and a key cannot outlive the paragraph it described.
 *
 * NO VILLAGE'S NAME LIVES HERE. `scripts/` is a ratchet zone for the brand
 * guard, and this document is read by people standing up villages that are not
 * the one this repository was born in.
 */
const PROSE = {
  purpose:
    "How a village decides: what a decision is, how a vote is counted, what each kind of decision asks of the village, " +
    "what happens when one carries, and which of the rulings behind all of that are built today.",
  scope:
    "This describes a FRESH village: what a village standing up a new instance holds after the migrations run and the " +
    "server starts for the first time. A village that has been running has its own history on top of it.",
  generated:
    "This file is generated. `scripts/generate-governance-doc.mjs` reads the engine, the subject registry, the dials, " +
    "the capability tables, the module definition, the clock and the route registrations, works out the facts, and " +
    "writes the whole document. `scripts/check-governance-doc.mjs` regenerates it and fails the build when the " +
    "committed text and the code have come apart.",
  editing: "Editing this file by hand does not hold. Change the code, then run:",
  twoKinds: "Two kinds of line live here, and the difference matters:",
  readFromCode:
    "**Read from the code.** Every table, every number, every key, every route, and the JSON block at the end. If one " +
    "of these is wrong, the code is what is wrong.",
  writtenByPerson:
    "**Written by a person.** The explanations, and the rulings. They are stored inside the generator so this whole " +
    "file stays generated, and each one is marked in the source of this file with a comment naming the entry it came " +
    "from. The founder's own words are quoted verbatim and marked the same way.",
  noTimestamp:
    "There is no timestamp and no author line, on purpose. Both would change on every run and turn an honest diff " +
    "into noise. The commit named above is the commit whose sources this describes, and git history is the record of " +
    "when it changed.",
  constitutionOpening:
    "The long tables come after this. These are the rules that do not move, kept short on purpose so a village can " +
    "read the whole of what binds it in one screen.",
  ringZero:
    "**Ring 0 is the constitution.** Some rules are published and tunable by nobody: the capability gate order, the " +
    "append-only ledger, the fact that a ballot freezes its own terms when it opens. A dial's minimum and maximum are " +
    "Ring 0 too, so a village moves a value inside its bounds and never moves the bounds. Ring 1 is the dials the " +
    "village's catalysts hold. Ring 2 is the dials the whole village governs by proposal.",
  ringZeroFreeze:
    "The freeze is the one to read twice. Method, dials, electorate and weights are written into the ballot's own row " +
    "inside the transaction that opens it, and every later evaluation reads that row. Changing a village setting can " +
    "never rewrite a vote that is already running, and it can never rewrite one that has closed.",
  birthingRule:
    "**The Birthing.** A village's first vote is the one that starts its Game, and it asks for everybody. Token " +
    "issuance is refused until it carries, so nothing a member holds exists before it. The floors below are code and " +
    "not settings, and a village cannot lower them.",
  criticality:
    "**Criticality, and the ceiling of 97.** Nothing is un-votable. The more critical a change is, the more of the " +
    "village has to show up and agree before it lands, and the recommended ceiling is 97 percent of quorum and 97 " +
    "percent of unity. Above that a village is warned in words: as the bar approaches 100, one player dying or " +
    "drifting away can freeze a Game a large majority wants to continue. The Birthing stays at 100 and 100 because " +
    "it is the one vote where everyone is present by definition.",
  criticalityToday:
    "Criticality tiers are built. Every setting carries a tier, the tier sets the quorum and the unity a change to it " +
    "needs, and the tiers and the subject floors are themselves settings a village may raise and may never lower. What " +
    "is still staged is the rule that a threshold changes at its own current bar.",
  decisionIs:
    "A decision is a ballot: one question, one frozen electorate, one document, and one outcome recorded by a person. " +
    "The document a ballot carries is the document that was checked when it opened, stored on the ballot's own row, " +
    "so what was voted on is what was read.",
  closingIsHuman:
    "Closing is a human act. When the voting window ends nothing executes: votes lock, the ballot waits, and a person " +
    "closes it with a note that becomes the sentence the village keeps. One mechanism runs on a clock, and it is " +
    "named in the cycle section below.",
  oneOpenBallot:
    "One open ballot per subject, held on a unique index and never on an application check. Closing frees the " +
    "subject the same second, so a vote that missed its participation can be asked again the same hour, and the " +
    "ballot that missed stays closed with its own frozen roll.",
  votesChangeable:
    "A vote is one row per member per ballot, changeable until the ballot leaves the open state or the clock passes " +
    "the closing instant. Changing a vote overwrites the row, so a member has one answer on the record at a time.",
  countingIntro:
    "Everything the engine counts is weight. Quorum is checked first, for every method, so a decision too few people " +
    "answered reads as no quorum and never as a rejection.",
  abstainRule:
    "An abstention counts toward quorum and takes no side on unity. It is the instrument for helping a decision reach " +
    "the room while holding no position in it. One subject overrides that, and the subject table below says which: on " +
    "the Birthing an abstention answers nothing at all, so it counts toward neither the quorum nor the unity and the " +
    "vote closes for want of quorum, which can be asked again.",
  peopleAndWeight:
    "Every sentence this platform generates about a vote states people AND weight together. One of three people " +
    "voting, holding all of the frozen weight, is a true sentence about a vote; a bare participation percentage is " +
    "not, whatever sits beside it.",
  dialsIntro:
    "The dials a village holds, with the ring that says who may move each one and the moment a passed change takes " +
    "effect. `open` dials are the village's by proposal. `founder` dials are held by the village's catalysts and are " +
    "refused to a proposal, and the platform ceiling runs one way: a catalyst can close an open dial to the " +
    "community, and nothing can open a `founder` one to it. The stored role value for a catalyst is `founder`, " +
    "which is the same word the ring is named after and the reason both read that way here.",
  dialsStorage:
    "Only CHANGED values are stored. An absent row means the platform default in the table above, so a fresh village " +
    "starts with every one of these and no rows at all.",
  subjectsIntro:
    "What each kind of decision asks. A subject declares MINIMUMS and the village's own dials still decide: the " +
    "ballot freezes whichever number is higher, so a village that asked for more keeps what it asked for. A subject " +
    "absent from this table keeps the village's dials with no floor, which is the safe direction.",
  closingIntro:
    "What closing a decision DOES, per subject type, and the one place that question is answered. A subject type that " +
    "is not in this table conducts a real decision on the real engine, with the real frozen roll and the real " +
    "weights, and executes nothing. Absence is the fail-safe direction, so a subject a later lane adds cannot execute " +
    "something by accident.",
  practiceVotes:
    "The wizard offers types the executors have not reached. Those open as practice votes: the village holds a real " +
    "decision, reads the real answer, and nothing moves. It is a ladder and never a scorecard.",
  launchIntro:
    "A village is built before it is started. Its catalysts set the modules, the dials, the quests and the seasons, " +
    "and then hand the one act that is not theirs to everybody: starting the Game. The founder ruled that this " +
    "moment is called the Birthing, that the proposal reveals the Game, and that after it the catalysts become " +
    "players like everyone else.",
  launchStored:
    "Starting is one row, written once. There is deliberately no function that un-starts a Game: members hold " +
    "balances the moment issuance runs once, and a switch that could turn that off is a power over everybody's " +
    "holdings that nobody voted to create.",
  launchEnds:
    "What ends at the Birthing is every power the stored `founder` role carries beyond an administrator's. What " +
    "deliberately does not end is the admin panel, because a village may choose never to seat a steward and must " +
    "still work completely.",
  weightIntro:
    "Three modes, one dial, and a rule that never moves: a change of mode changes only how votes are COUNTED. " +
    "Nothing deletes or rewrites a balance, an allocation or its trail, so a village can move between modes in " +
    "either direction and every holding survives the trip.",
  weightToken:
    "In token mode the weight token has to be one this platform itself governs. A token governed elsewhere is " +
    "refused, and so is a token listed on the exchange: a token money can buy is not a token that weighs a vote.",
  weightTrail:
    "Custom allocations are append-only. Every change carries a required reason and lands in a trail every player can " +
    "read, which is the whole of the protection the founder named: concentration is allowed and invisibility is not.",
  whoIntro:
    "Powers are keys, not job titles. A member holds one by climbing to the rung that grants it, by holding a role " +
    "that carries it, or by a badge. Two of them can never be taken away by a badge, and that is a ruling: a voice in " +
    "a decision the village makes is not something any other party gets to suspend.",
  stewardThree:
    "The word steward means three different things in this platform, and they are named apart here so nobody reads " +
    "one of them as another.",
  stewardQuest:
    "**The steward who consents to work.** In quest copy, the person who confirms that a contribution actually " +
    "happened and releases its value. This one is shipped and works today.",
  stewardPersona:
    "**The Village Steward persona.** One of the paths a new member can pick on the way in, part of the identity " +
    "plane and carrying no power of its own.",
  stewardApprover:
    "**The steward the founder ruled for.** A seat, held by a village's catalysts at the Birthing and re-voted each " +
    "term, whose holder can stop a decision the village has already carried, inside the window before it lands, and " +
    "has to say why. It approves nothing: a carried decision lands whether or not anybody holds this seat.",
  publishIntro:
    "What a village publishes, read from the route registrations. The door on each route is classified from the " +
    "code, and a route whose door this reader cannot classify says so instead of guessing.",
  publishModule:
    "Read the module state first. While the governance module is off, every path under its prefixes answers 404 to " +
    "everybody, signed in or not. The mechanics routes are never module-gated, so they answer under every lifecycle.",
  cycleIntro:
    "One clock. A cycle is a lunation, and the same rhythm carries the recognition economy, the pool and this " +
    "document's talk of what lands when. The past is frozen: cycles below the boundary keep the instants the mean " +
    "formula always gave them, so no settled cycle ever moves.",
  cycleClose:
    "A cycle turns on its own and the Game notices when an administrator closes it. So today, at the new moon means " +
    "at the next close, which can lag by days and can settle several lunations at once. One exception runs on a " +
    "timer: a minting rule stamped for a coming cycle is promoted by the hourly job at the true boundary. The " +
    "founder's ruling is that the new moon itself becomes the rule and both callers reach one routine; that is " +
    "staged.",
  bridgeIntro:
    "A village can carry its formal decisions to Hypha on Base instead of deciding them here, and it can report its " +
    "outcomes to a governance hub. Both are optional and both ship dark.",
  bridgeHonest:
    "Stated honestly, because a bridge that half works is worse than one that is off: nothing leaves a village " +
    "unless both the hub URL and a shared secret are configured; the round trip has never been proven end to end in " +
    "both directions; and four displays about it are false today. A Hypha-decided ballot is counted by Hypha, so a " +
    "village's own weight mode does not reach it.",
  brokenIntro:
    "What is broken today, by name. A document that only described the parts that work would be the same kind of " +
    "check this repository has spent weeks removing: green about the wrong thing.",
  stagedIntro:
    "What is staged: ruled by the founder, described here, and absent from the code. Nothing in this list exists. " +
    "Each one carries a guard in the generator, so the day somebody builds it the guard goes red and this section has " +
    "to be updated before the build passes.",
  rulingsIntro:
    "The founder's own words, verbatim, with the date he said them and whether the code does it yet. Where the code " +
    "can answer, the status is computed and says so. Where it cannot, the status is a person's reading and says that " +
    "too. Nothing marked staged exists today, and no reader should plan as though it does.",
  rulingsQuoteNote:
    "The quotes are reproduced exactly, including the spelling and the punctuation, because a ruling paraphrased is a " +
    "ruling somebody can argue about later. They are the one text in this file the house writing rules do not touch.",
  machineIntro:
    "The same facts, for anything that would sooner parse than read. Regenerated with the rest of the file, so it " +
    "cannot drift from the prose above it.",
  madeFromIntro: "The generator reads these and fails loudly if any of them moves:",
  madeFromReaders:
    "Every reader is anchored on an exported symbol or a syntactic shape, never on a line number. The file holding " +
    "the close dispatcher lost about 2,500 lines to route extractions in the hours while this document was being " +
    "specified, and a reader anchored on a line would have gone quietly wrong.",
  madeFromTest:
    "`server/db/governanceDoc.test.ts` calls the real engine against a real database and asserts that the numbers " +
    "this document states are the numbers those functions produce. The generator being wrong is a red test and not a " +
    "quiet paragraph.",
  madeFromCommit:
    "The commit named at the top is the last commit that changed any source in this list. A commit that changes a " +
    "source and regenerates this file at the same time writes the previous commit's id, because the new one does not " +
    "exist yet; regenerating once more after it lands settles it.",

  // ── The veto model (19C to 19G, 20.11), added 2026-09-03 ──────────────────
  twoKindsOfDecision:
    "Every decision a village makes is one of two things, and the difference decides WHEN it happens. A **token " +
    "send** moves balances: a payout, a distribution, a founding allocation. A **Game change** moves the rules " +
    "everybody plays by: a setting, a threshold, a role, a seat, a module, the brand, the vote mode, the structure. " +
    "Anything the table below does not name is a Game change, and that is the safe direction. A token send filed as " +
    "a Game change waits three days. A Game change filed as a token send skips the window that exists to hold it, " +
    "and only one of those is reversible.",
  weightAllocationIsAGameChange:
    "The allocation of voting weight is a **Game change**, and it is named here because both descriptions can claim " +
    "it. It writes the custom allocation table, which is a number and never a token: no ledger row, no balance, " +
    "nothing minted. What it changes is what every future vote weighs, which is as constitutional as a decision " +
    "gets, so it waits inside a window like any other change to the rules.",
  timingChoice:
    "Every proposal carries a timing choice, and the proposer makes it: execute at acceptance, or start with the new " +
    "moon. A token send defaults to acceptance, because a payout for finished work has no reason to wait a moon. A " +
    "Game change defaults to the new moon, in the founder's words, to carry a pattern of new activities starting " +
    "then.",
  landingInstant:
    "The landing instant is arithmetic over the ballot's own FROZEN closing instant, never over the moment a person " +
    "pressed close. That matters: if the pass instant were a human press, the proposer would be choosing which three " +
    "days the seat gets.",
  bundleWaits:
    "A bundle waits as a whole, under one landing instant and one window. A change set carrying any Game-change " +
    "element is wholly a Game change, token sends included. Splitting it across two clocks would let the token half " +
    "execute at the close and be beyond reach while a steward stopped the half that was meant to keep it honest.",
  snapForward:
    "A change set touching a setting the platform applies at a cycle close, a minting rule, or a per-stage " +
    "multiplier snaps its landing forward to the next boundary on every path, acceptance timing included. A ceiling " +
    "that moves under somebody already spending against it is a different village from the one they were playing in " +
    "an hour ago.",
  lateSettled:
    "A row that reaches passed with its landing instant already gone is restamped to now plus the window, marked " +
    "late-settled with the reason, and every steward is told. Without that, a scheduler outage or a late close would " +
    "hand a steward a window that was over before they heard it had opened, and the record would report it as " +
    "honoured.",
  vetoWindowRule:
    "**The window is at least 72 hours, and it stays open until the change lands.** The founder gave both halves of " +
    "that sentence, and this is how they meet: the closing instant of the window IS the landing instant, and 72 " +
    "hours is its floor. A vote that carries with a month left in the cycle gives its stewards the month. A vote " +
    "that carries on the last day gives them three days, which run past the boundary. The window is capped at one " +
    "cycle of the active clock, so a village cannot set a window longer than the rhythm it lands on.",
  vetoAct:
    "A veto is a first-class act. It carries the name of the steward who cast it, a reason that cannot be blank, and " +
    "a place in the record. The reason is plain text, length-capped, escaped everywhere it renders, public and " +
    "permanent, and redactable: the words blank and the act, the author and the time stay. The proposal goes back to " +
    "its proposer with its backers intact, and a proposal returned to open and passed again lands.",
  vetoOnTheBallot:
    "The veto lives on the BALLOT, and a proposal's display of it derives from that proposal's current ballot. " +
    "Stamping it on the proposal row instead is how a village that answers its steward's objection and passes the " +
    "same proposal again gets skipped by the landing gate forever.",
  stewardNo:
    "**A seated steward's no.** On a token-send ballot only, a seated steward voting no fails it at the close. Never " +
    "on a ballot the steward is the subject of. It needs a reason under the veto's own rule, and the row closes as " +
    "vetoed with the steward named, so the override and the dashboard's blocked-payouts row both reach it. The " +
    "steward's own weight counts in the tally like anybody's. A token send has no window after it closes, so the " +
    "block has to happen while the ballot is open.",
  notVetoable:
    "**What no steward may stop.** Three things. EVERY seating and unseating, of any role and not only one that " +
    "carries the veto (Rye, 2026-09-04). Any edit to the settings that say what a steward may stop. And any decision " +
    "whose SIZE the village has not put in the seat's reach, which by default is everything below constitutional. " +
    "All three keep their timing and their window like any Game change and lose only the door, so the village still " +
    "reads them coming. A seat that could veto its own removal is a seat nobody can remove. A change set mixing one of " +
    "those elements with any other kind is refused when it is validated, naming both elements, so the carve-out " +
    "cannot carry anything else through beside it.",
  override:
    "**The override.** A proposal that was stopped may be brought back. Passed again at the village's highest set " +
    "tier, with the relation stated (`renews`, `overrides` or `replaces`) and the ballot actually PRICED at that " +
    "tier, it lands whatever any steward says. The record links it to the decision that was stopped and the reason " +
    "stays visible beside it. A renewal may not point at a decision that was stopped.",
  stewardlessHealthy:
    "**A village with no steward is healthy.** It is the state the training wheels come off into, and nothing here " +
    "renders an empty seat as a warning or a queue. A carried decision lands whether or not anybody holds the seat. " +
    "An empty seat is a village nobody can stop, and a village that chose that is playing the Game as designed.",

  // ── What quorum counts (19F), added 2026-09-03 ────────────────────────────
  quorumIsWeight:
    "**Quorum and unity are token weight.** They are computed over the weight token, or over heads when the village " +
    "runs one person one vote, where every seat weighs one. There is no head-count quorum. The sentence after this " +
    "one is read out of the arithmetic itself, so it cannot go on saying so after somebody changes the formula.",
  concentrationConsequence:
    "**One holder of 97 percent of the Voice carries a constitutional change alone.** That follows from pure weight, " +
    "and it is stated here because the founder accepted it as the design: concentration is allowed and " +
    "invisibility is not. Every ballot, every tier control and every sentence this platform generates about a vote " +
    "shows the people count beside the weight, and every player's share of the whole is visible to every other " +
    "player. Transparency is the protection.",
  accountsNotPeople:
    "**This platform counts accounts.** It has no way to know that two accounts are one person, so a rule asking for " +
    "three different parties is satisfied by three accounts one person made. A village's own membership practice is " +
    "the only thing that makes a head count mean people, and no number on this page can do that work for it.",
  nonHumanSeats:
    "**A seat held for a being other than a person votes.** Its representative is a member or an agent built to " +
    "hold that point of view, and the seat is filled and emptied by a vote like any other. Whether its weight counts " +
    "toward quorum is a village setting, off by default: when it is out, its weight leaves both halves of the " +
    "fraction and its cast vote still counts toward unity; when it is in, weight that provably cannot vote leaves " +
    "the denominator, so a representative who drifts away cannot freeze the village. The excluded weight is shown " +
    "beside the people count, always.",
  noFallback:
    "**Nothing falls back.** A tier that misses quorum three cycles running does not pass. The second miss warns " +
    "that the next one ends it and names the tier as the obstacle; the third closes the question in a named terminal " +
    "state with one door, which is to withdraw and rewrite, carrying the backers. The stalemate warning computes the " +
    "most quorum a village could reach against the weight that can actually vote, so it fires on arithmetic and " +
    "never on a static number.",

  // ── Windows (19E), added 2026-09-03 ───────────────────────────────────────
  windowsIntro:
    "A village may say WHEN a kind of proposal can be opened. Per proposal kind it chooses always open, the last N " +
    "days of every cycle of the active clock, the last N days of every season, or a window of its own. All of them " +
    "ship always open, so a fresh village gates nothing.",
  windowsRule:
    "The window gates the OPENING and nothing else. It is evaluated per element and the strictest one applies; a " +
    "window shape no longer than the voting window is refused, and so is an opening whose vote would close after the " +
    "window shuts. Anything coming back opens outside its window for a stated grace, because the village has already " +
    "been asked once and a resubmission, an override and a renewal are all openings. The refusal names the element " +
    "that narrowed the window and when it next opens.",

  // ── Delegation (section 4), added 2026-09-03 ──────────────────────────────
  delegationRule:
    "You hand your voice to somebody you choose. A delegated vote is a row for the DELEGATOR carrying the delegate's " +
    "choice, stamped with whoever finally decided it, so the participation arithmetic stays honest and the frozen " +
    "electorate keeps meaning what it says. Weight never moves. Chains are transitive and a cycle is refused the " +
    "moment a delegation is given, never while a season's votes are being counted.",
  delegationConsent:
    "A delegation carries a choice only once the delegate has accepted it. Pointing it somewhere else clears the " +
    "acceptance, so nobody inherits a live delegation they never agreed to. While choices are hidden the copied " +
    "choice is hidden from the delegator too. Withdrawing a delegation or taking a vote back restores the not-cast " +
    "state, which is a different thing from an abstention and decides quorum. On a subject asking 100 percent unity " +
    "a delegated row never counts.",

  // ── The landing loop (20.8, 20.11), added 2026-09-03 ──────────────────────
  landingLoop:
    "One routine decides what is due. It runs as its own five-minute job and the human cycle close calls the same " +
    "routine, so whichever arrives first applies the row and the other finds nothing left. Exactly one executor runs " +
    "a due row, elected by a guarded claim on the table that holds the landing instant. Every element is validated " +
    "again at landing: a seat for a member who has left the village is refused by name.",
  landingCounts:
    "Every report the landing job returns says which of two quiet states it is in. Nothing due and did not run look " +
    "identical from outside and mean opposite things, so they are logged apart. A row whose window elapsed while the " +
    "brake was off is marked stalled, its window reopened, and the stewards told.",
  atomicity:
    "**Atomicity comes from pre-validation, and this document says so because a member reading the word applied " +
    "deserves the same sentence a contributor reads.** A change set is validated in full with nothing written, and " +
    "one failure refuses the whole set naming the element by its place and its own words. Only then does it apply, " +
    "irreversible writes last, one ledger row per element written, and every written-through cache reloaded from the " +
    "database afterwards. There is no rollback, because a rollback through these writers would leave the process " +
    "serving values the tables deny until somebody restarted it.",
  noCloser:
    "A binding ballot cannot be opened on a subject type that has no closer. Advisory is the exception, and it is an " +
    "exception on purpose: a practice vote is a real decision that moves nothing. The refusal names the subject and " +
    "points at the practice-vote door.",
  digest:
    "At every cycle boundary the landing job composes one digest for the cycle that ended, after asserting that " +
    "every row due inside it is applied, stopped or stalled. One digest per cycle, whatever runs it, and it posts " +
    "one item to the feed. No digest composed and digest empty are two different sentences in the log.",
  notices:
    "Stewards are told three times: when a decision carries, at the half-way point of the window, and two hours " +
    "before it lands. Each notice is its own kind of notification, pinned to immediate in the mail cadence, because " +
    "every governance message used to resolve to a daily digest and the last warning before a change landed arrived " +
    "after it had landed. The off preference is refused while a member holds a seat that carries the veto, and a " +
    "notice whose moment has passed is suppressed instead of being sent late.",

  // ── The two Voices (19B), added 2026-09-03 ────────────────────────────────
  twoVoices:
    "A village shows ONE Voice. On this platform it is the village's own Voice token. A village graduates to Hypha " +
    "when it completes a crowdpool and wants a secure vehicle with liquidity, which is a real organisation on Base; " +
    "from then the token there is the vote, the village Game mirrors it, and every month or season the village goes " +
    "to Hypha and votes to sync the two. A village using both tools shows both Voices, and the sync keeps them in " +
    "balance.",
  voiceIsBuyable:
    "Voice can be bought. Money in mints Voice by default, through a minting rule like any other contribution, and a " +
    "village or a single proposal may change that. The guard that used to refuse a purchasable token as the weight " +
    "token is relaxed on purpose, and the protection is the one the founder has named every time: every ballot and " +
    "the Birthing document show each holder's share.",

  // ── Limits of this version ────────────────────────────────────────────────
  englishOnly:
    "Governance copy is English, and only English, in version 1.0. Nothing on these surfaces is translated, and a " +
    "village whose members read another language is reading these words as they are. It is a limit of this version " +
    "and it is written down so a fork can plan around it.",

  // ── The schema, and the lineage ───────────────────────────────────────────
  schemaIntro:
    "The tables and columns the rules above rest on. The generator checks every one against the migrations and " +
    "refuses to render this document when one is missing, so a paragraph here cannot outlive the column it " +
    "describes. No migration number appears: numbers are claimed across worktrees and renumbered when a build lands.",
  lineageIntro:
    "The engine's dials descend from three sources the founder gave, and they are named here so a person or a bot " +
    "reading this document can go to the root of it.",
  lineageDeck:
    "The slide deck \"So you want to make a DHO?\" (Hypha and SEEDS): the three dials of voice variance, quorum and " +
    "unity, with the named corners those dials describe.",
  lineageTalk:
    "The talk \"How to do a DHO/DAO\", a guide for groups building new-paradigm organisations, from SEEDS: " +
    "Regenerative Renaissance.",
  lineageHandbook:
    "The Hypha Handbook V0.3. In the founder's words, out of date and written for a different kind of organisation " +
    "than a village, and still the root of the self-organising and regenerative principles this Game runs on.",
  lineageRecord:
    "`docs/GOVERNANCE_EVOLUTION_PROMPT.md` is the record of the rulings themselves: every question put to the " +
    "founder, his answer in his own words, the date, and what each answer changed. When this document and that one " +
    "disagree about a rule, that one is the evidence and this one is the defect.",
  lineageCopies:
    "Three links are three closed doors for a fork whose members cannot open them. So the text of each source is " +
    "checked in under `docs/sources/`, attributed, with the founder's permission recorded. The copies are for " +
    "reading and the originals stay the source.",
  withdrawnIntro:
    "What this document used to say, and no longer does. Each line was true of an earlier ruling and was withdrawn " +
    "by a later one, with the date. It is kept because a reader who learned the old rule needs to see it struck, " +
    "and because a fork reading an older copy of this file should be able to tell which sentences went.",
};

/**
 * What each executing subject type CHANGES, in a member's words.
 *
 * Keyed by the `subject_type` the close dispatcher answers to, so a subject a
 * later lane adds cannot render as a row with a blank meaning.
 * `subjectCoverageProblem` refuses in both directions, which is the same guard
 * the sibling generator puts on its per-token sentences and for the same
 * reason: a decision nobody can describe in one line is a decision nobody can
 * explain to the village voting on it.
 */
const SUBJECT_WORDS = {
  mechanics: "Moves the village's own dials, through the one amendment ledger that records every move.",
  mint_rule: "Changes what the village mints and on what terms. It shares the dial executor and carries a higher quorum floor.",
  power_transfer: "Moves a power from the admin panel to a role the village names.",
  power_grant: "Gives a role a power it does not carry yet.",
  power_return: "Hands a power the village was holding back to the admin panel.",
  role_declare: "Writes a role into being: its name and what it is for.",
  role_seat: "Puts a named member into a seat.",
  role_unseat: "Takes a named member out of a seat.",
  village_launch: "Starts the Game. Token issuance turns on and does not turn off.",
  // Added by the dispatcher lane with the executor it describes.
  governance_mode: "Changes how one vote is weighed, and which token carries the weight when it is a token.",
};

/**
 * Every executing subject type has a sentence, and every sentence has a
 * subject type, or this returns the refusal that stops the build.
 */
export function subjectCoverageProblem(keys, words = SUBJECT_WORDS) {
  for (const key of keys) {
    if (words[key]) continue;
    return (
      `governance-doc: the close dispatcher executes "${key}" and nothing here says what that changes. ` +
      `Add a line to SUBJECT_WORDS in scripts/generate-governance-doc.mjs under the key "${key}". ` +
      "A decision nobody can describe in one line is a decision nobody can explain to the village voting on it."
    );
  }
  for (const key of Object.keys(words)) {
    if (keys.includes(key)) continue;
    return (
      `governance-doc: SUBJECT_WORDS describes "${key}", which the close dispatcher no longer executes. ` +
      "Delete the sentence, or fix the key."
    );
  }
  return null;
}

/**
 * THE GOVERNANCE DIALS THIS DOCUMENT HAS BEEN WRITTEN AGAINST.
 *
 * A dial appearing in the Governance category that is not in this list stops
 * the build, and that is deliberate rather than tidy. Half the rulings in this
 * document are staged, and most of them arrive as a dial: a criticality tier,
 * a rhythm setting, a secrecy setting, a steward flag. A new key is therefore
 * the most likely first sign that a status line here has gone stale, and the
 * cheapest moment to catch it is the moment it appears.
 *
 * Adding a dial is two lines: the key here, and whichever ruling it builds.
 */
const KNOWN_DIALS = [
  "governance.voice_weighting",
  "governance.hypha_threshold",
  "governance.sensing_days",
  "governance.proposals_per_member_per_cycle",
  "governance.proposal_support_threshold",
  "governance.hub_url",
  "governance.auto_apply_enabled",
  "governance.steward_subjects",
  // The three that arrived with the veto window (2026-09-03).
  "governance.veto_hours",
  "governance.steward_council",
  "governance.highest_tier",
  // The two Rye ruled on 2026-09-04, which together decide what the seat can
  // actually stop. `steward_subjects` above names WHICH KINDS are in reach;
  // this one names WHICH SIZES, and a veto needs both. It ships narrower than
  // the code did: constitutional alone.
  "governance.steward_veto_tiers",
  // And the one that keeps a payout fast unless it is big enough to hurt.
  "governance.payout_delay_over",
  // A passed decision that never lands stops being a promise (2026-09-03).
  "governance.landing_expiry_cycles",
  "governance.change_cooldown_days",
  // The windows, per proposal kind (19E, windows lane, 2026-09-03). Each holds
  // one shape: always_open, last_days_of_cycle:N, last_days_of_season:N, or
  // custom:FROM-TO. All ship always open.
  "governance.window_changeset",
  "governance.window_mint_rule",
  "governance.window_governance_mode",
  "governance.window_role_declare",
  "governance.window_role_seat",
  "governance.window_role_unseat",
  "governance.window_power_transfer",
  "governance.window_power_grant",
  "governance.window_power_return",
  "governance.window_grace_days",
  "governance.weight_mode",
  "governance.weight_token",
  "governance.unity_pct",
  "governance.quorum_pct",
  "governance.vote_days",
  "governance.consent_window_days",
  "governance.default_method",
  "governance.tier_routine_quorum_pct",
  "governance.tier_routine_unity_pct",
  "governance.tier_structural_quorum_pct",
  "governance.tier_structural_unity_pct",
  "governance.tier_constitutional_quorum_pct",
  "governance.tier_constitutional_unity_pct",
  "governance.subject_mint_rule_quorum_pct",
  "governance.subject_mint_rule_unity_pct",
  "governance.highest_tier",
  // The two that arrived with 19G: whose weight the quorum counts.
  "governance.nonhuman_in_quorum",
  "governance.absent_cycles",
  "membership.vouch_threshold",
];

export function dialCoverageProblem(keys, known = KNOWN_DIALS) {
  for (const key of keys) {
    if (known.includes(key)) continue;
    return (
      `governance-doc: "${key}" is a Governance dial this document has never been written against. ` +
      "If it builds one of the staged rulings, update that ruling's status and note. Then add the key to " +
      "KNOWN_DIALS in scripts/generate-governance-doc.mjs."
    );
  }
  for (const key of known) {
    if (keys.includes(key)) continue;
    return (
      `governance-doc: KNOWN_DIALS names "${key}" and the Governance category no longer holds it. ` +
      "A dial this document described has gone; delete the key and check what the document says about it."
    );
  }
  return null;
}

/**
 * Every entry in PROSE renders, and every marker in the document names an
 * entry, or this returns the refusal that stops the build.
 *
 * BOTH DIRECTIONS, for the reason the sibling generator gives: a missing
 * paragraph ships a document with a hole in it, and an orphan entry is the
 * quieter failure, where a section is rewritten and its old explanation stays
 * behind in the generator looking maintained.
 */
export function proseCoverageProblem(text, prose = PROSE, rulingIds = RULINGS.map((r) => r.id)) {
  const known = new Set([...Object.keys(prose), ...rulingIds.map((id) => `ruling-${id}`)]);
  for (const key of known) {
    if (text.includes(`<!-- written by a person: ${key} -->`)) continue;
    return (
      `governance-doc: the written entry "${key}" renders nowhere. ` +
      "Render it, or delete it: an explanation nobody reads is an explanation nobody maintains."
    );
  }
  for (const m of text.matchAll(/<!-- written by a person: ([\w.-]+) -->/g)) {
    if (known.has(m[1])) continue;
    return (
      `governance-doc: the document marks "${m[1]}" as written by a person and nothing in PROSE or RULINGS ` +
      "carries that key. Fix the key or add the entry."
    );
  }
  return null;
}

/**
 * THE FOUNDER'S RULINGS, in his words.
 *
 * Every quote in sections 3, 4, 5, 12 and 19 of `docs/GOVERNANCE_EVOLUTION_PROMPT.md`
 * is carried here verbatim with the date it was said. The steward ruling was
 * stated twice, on 2026-08-31 and again on 2026-09-02, and is carried once
 * with both dates: a duplicate would read as two rulings that happen to agree.
 *
 * `status` is a function of the facts wherever the code can answer, and a
 * fixed string where it cannot. Which of the two a ruling got is DERIVED from
 * the function's own arity rather than declared beside it: a hand-typed
 * "computed" flag on a status that ignores the facts is exactly the kind of
 * claim this document exists to stop, and it would be invisible in review.
 * A computed status cannot go stale quietly; a stated one is somebody's
 * reading and says so on the page.
 */
const statusIsStated = (ruling) => ruling.status.length === 0;
const RULINGS = [
  {
    id: 1,
    title: "A steward approves a passed proposal before it takes effect, and auto-execute is the maturity path",
    dates: ["2026-08-31", "2026-09-02"],
    quotes: [
      "having it default that the steward (by default the founder(s) are granted a steward role after Game launch) needs to approve a proposal to change the game before it actually goes through is a great addition, but also there's another stage of maturity where the founder gives up this power and then auto-execute takes over. Stewards have the power to approve anything in the Game that needs approval - they're the 'training wheels' for the Game until it matures enough that they can give more and more power to the Game to auto-execute decisions.",
    ],
    status: (f) => (f.staged.steward ? "**Staged.** Not built." : "**Half built.**"),
    note: (f) =>
      `The seat exists, and the approval gate this ruling describes is WITHDRAWN by the founder's 2026-09-03 words. ` +
      `A \`steward.veto\` capability gates a veto route, an early no-objection route and a redaction route; one row per ` +
      `steward per ballot records who acted, on what, and why; and one setting says which kinds of decision the seat may ` +
      `stop. Nothing waits: a Game change lands at the later of the next new moon and the close of its window, on its own, ` +
      `whether or not anybody holds the seat, and a token send executes when its ballot closes unless a steward voted no ` +
      `while it was open. What is still missing is the landing instant itself, which the close dispatcher owns. The other ` +
      `hold that exists is \`governance.auto_apply_enabled\`, a ` +
      `${f.dials.autoApply.ring}-ring dial defaulting to \`${f.dials.autoApply.default}\`, which covers the mechanics closer alone and hands a ` +
      `held proposal to an administrator to apply by hand.`,
  },
  {
    id: 2,
    title: "Catalysts inherit the steward seat at the Birthing, and the seat is re-voted every season",
    dates: ["2026-08-31"],
    quotes: [
      "I want to override the optionally vote in that role to where the founders automatically inherit it, but just like every role resets every season - this role too needs to be voted back in to be maintained.",
    ],
    status: (f) => (f.staged.launchSeatsSteward ? "**Staged.** Not built." : "**Built.**"),
    note: () =>
      "The closer that runs when the Birthing carries writes the launch facts and nothing else: no role, no seat, no grant. " +
      "Catalysts inherit nothing at the Birthing today.",
  },
  {
    id: 3,
    title: "Giving up the steward power is reversible, and only the village can fill the seat again",
    dates: ["2026-08-31"],
    quotes: ["Yes giving up the power is reversible but the village would need to vote in another steward."],
    status: () => "**Staged.** Not built.",
    note: () =>
      "There is no seat to step back from. The design this ruling settles is worth keeping in view while it is built: it " +
      "makes relinquishment automatic, so a catalyst never has to decide they are ready to give up power. They have to be " +
      "re-granted it.",
  },
  {
    id: 4,
    title: "The veto is the point of the role, and it carries a reason",
    dates: ["2026-08-31"],
    quotes: [
      "Yes stewards have the ability to veto through non approval. This is primarily to protect against harm they see that the village wasn't able to (which is why they voted them to be stewards to begin with).",
      "Yes a steward veto absolutely should carry a reason",
    ],
    status: (f) => (f.staged.steward ? "**Staged.** Not built." : "**Built.**"),
    note: () =>
      "A veto is a first-class act now. The veto route stores who acted, which ballot, and the reason, and it refuses " +
      "an empty or whitespace-only reason at the door, so a decision the village carried can never die silently. The " +
      "reason is plain text capped at 2000 characters, rendered escaped, and redactable: the words can be blanked later " +
      "while the act, its author and its time stay on the record. An early no-objection may be recorded and it changes " +
      "no timing. What the record still waits on is the surface that shows it to the proposer.",
  },
  {
    id: 5,
    title: "Terms end when they end",
    dates: ["2026-08-31"],
    quotes: [
      "No terms should definitely end when they end not with a polite warning! If they're not voted back in then they expire when they expire!",
    ],
    status: () => "**Half built.**",
    note: () =>
      "Terms and powers live on two planes that share only a word, and the ruling now holds on the plane that matters. A " +
      "permission role carries a term and a season beside the holder, and the capability lookup drops a holding whose term " +
      "has passed, so the powers end on the day the term does with no warning and no grace. A term left empty never lapses, " +
      "which is what let the column land on villages that had never heard of a term. The record of who held the seat " +
      "outlives the mandate on purpose: history is kept and the powers are taken. Org-chart seats are the other plane and " +
      "are unchanged, so a season turn there still reopens a seat without touching anybody's powers. What remains is the " +
      "vote that puts a holder back in, and a vacancy loud enough to see on every screen that depends on it.",
  },
  {
    id: 6,
    title: "Governance week is a default pattern and never a permission check",
    dates: ["2026-08-31"],
    quotes: [
      "As a default pattern the week before a season ends is the 'governance week' where all the players who want a role in the next season put up proposals for their roles - they play out for the season.",
      "Players can make proposal at anytime and it's a cultural pattern when and how people will actually show up to vote. So that's for every village to decide but as a default pattern we offer the above.",
    ],
    status: (f) => (f.staged.governanceWeek ? "**Staged.** Not built." : "**Built**, and the second half of the ruling is withdrawn."),
    note: () =>
      "The founder reopened this on 2026-09-03: a village MAY block proposals outside defined governance windows. So the " +
      "sentence above about a permission check is withdrawn, and the rest of the ruling stands. Ten Governance settings hold " +
      "one window shape each, one per proposal kind and one for a change set, and every one of them ships always open, so a " +
      "village that wants the pattern without the gate has it. A shape is always_open, the last N days of every cycle under " +
      "the active clock (the moon by default), the last N days of every season, or a range of days the village names. The " +
      "window gates the OPENING alone: a ballot already running is never closed by a window shutting, and a proposal coming " +
      "back after a veto or an objection opens outside its window for governance.window_grace_days. The refusal names which " +
      "element of the proposal narrowed the window and when that window next opens.",
  },
  {
    id: 7,
    title: "Delegation copies the choice, chains are transitive, and concentration is visible",
    dates: ["2026-08-31"],
    quotes: [
      "One more requirement we need to build in is to delegate your vote to another member (where it just copies whatever they do as long as they have your delegation and you can remove and change a vote on an open proposal at anytime. So full rights to the individual but for those who don't want to vote can give their voice to someone they trust.",
      "I want transitive to start - that's okay but as you say concentration must be visible so we'll just show what's going on",
      "A delegate would puncture because you always see on a proposal a vote you made. So since your vote was cast following another's you were able to see what that other member did because you can see what you did.",
    ],
    status: (f) => (f.staged.delegation ? "**Staged.** Not built." : "**Built.**"),
    note: () =>
      "A delegated vote is a row for the DELEGATOR carrying the delegate's choice, stamped with the member who finally " +
      "decided it, so participation arithmetic stays honest and the frozen electorate keeps meaning what it says. Weight " +
      "never moves. The choice alone is copied and the words beside a no are never attributed to somebody who did not " +
      "write them. Chains resolve to the member at the end, a cycle is refused at the moment a delegation is given and " +
      "never at tally time, and a member who votes for themselves takes their row back whatever their delegate does. A " +
      "delegate who stays silent leaves the delegator uncast, counted as not voted and never as an abstention. Concentration " +
      "is served to every player: how many votes each member effectively decides, what share of the village that is, and the " +
      "direct count beside it. What is missing is the surface, so today all of it answers through the API alone.",
  },
  {
    id: 8,
    title: "Transparency is the protection, so concentration is allowed and invisibility is not",
    dates: ["2026-08-31"],
    quotes: [
      "The first exploit isn't a concern because proposals should also say how many people voted on it! We can have a settings where it would be public who's voting or secret (defaulted to secret).",
      "Founders can self-grant themselves voice. Their ability to do this is fine, our protection is in the transparency of it, showing what % of total voice every player is holding.",
    ],
    status: (f) => (f.staged.secrecy ? "**Half built.**" : "**Built.**"),
    note: () =>
      "Built: a catalyst may allocate weight to themselves, every allocation lands in an append-only trail with a required " +
      "reason, and the hand-mint route refuses a self-grant at any amount. Staged: the share of total voice each player " +
      "holds is shown nowhere, and the vote sentence that states people and weight together is generated in some places " +
      "and not in others. The identity half of this ruling was answered again in 2026-09-02's question 12 and is carried " +
      "there.",
  },
  {
    id: 9,
    title: "One source of truth for governance, human readable and machine readable",
    dates: ["2026-09-02"],
    quotes: [
      "Your task is going to be setting up the sole source of truth for governance and our game creating a document that is based off of truth that's human readable and beautiful, and also machine readable that sits in our repo so that everyone including bots can understand how the governance system works.",
      "This isn't a full story and for you to fill out the whole story and create version 1.0 of this document for us to go back-and-forth on to ensure that we have the right vision.",
    ],
    status: () => "**Built.**",
    note: () =>
      "This file, generated from the code, with a machine-readable block at the end, a guard that fails the build when it " +
      "and the code come apart, a self-test on the generator, and a database test that proves the numbers against the real " +
      "engine. It is version 1.0 and it is written to be argued with.",
  },
  {
    id: 10,
    title: "One to three catalysts start a village, and Voice is the only token they may issue before the Game starts",
    dates: ["2026-09-02"],
    quotes: [
      "Every village starts off with 1 to 3 founders putting the initial conditions in place and the only tokens they can issue at this point is Voice tokens.",
      "Love them all",
    ],
    status: (f) => (f.launch.issuanceRefusal ? "**Staged, and the code currently says the opposite.**" : "**Built.**"),
    note: (f) =>
      `Nothing is issuable before the Birthing, Voice included: every faucet posting is refused with the sentence "${f.launch.issuanceRefusal}" ` +
      "Nothing enforces a count of one to three catalysts either. The only pre-Birthing weight a catalyst can hand out is " +
      "the custom allocation table, which is a number and never a token, and which the founder's ruling renames the " +
      "founding allocation. His second quote here is his answer to the question of which token is Voice: the platform's " +
      "own Voice is THE Voice, and the Base mirror is Voice claimed across.",
  },
  {
    id: 11,
    title: "The Birthing: at least three parties, 100 percent quorum, 100 percent unity, and the proposal reveals the Game",
    dates: ["2026-09-02"],
    quotes: [
      "then at some point when the game is mature enough and the founders deem it ready that they're ready to start the game then it starts with an initial proposal that needs a minimum of three votes three different parties voting and it has to get 100% quorum and 100% unity so every player of the game needs to show up to the start the game proposal. This proposal will also show the current distribution of Voice as that's the only token that had been issued at that time and give a brief overview of how the game is structured and the conditions that the game is at.",
      "No we need 100% saying yes as a collective 'Birthing' moment where you reveal the game, it's at LEAST 3 but could be many more people who then activate a new game before they all switch to being 'players' instead of just the catalysts (we say Catalyst instead of founder for those who play the game this way.",
    ],
    status: () => "**Half built.**",
    note: (f) =>
      `Built: the floors are code at ${f.launchFloor.minUnityPct} unity, ${f.launchFloor.minQuorumPct} quorum and ` +
      `${f.launchFloor.minElectorate} on the roll, with every seat required to carry weight above zero, which is what makes ` +
      "100 percent of weight also mean 100 percent of people. Built since 2026-09-02: an abstention on the Birthing " +
      "answers nothing, counting toward neither the quorum nor the unity, and the subject asks for a yes from every seat " +
      "on the roll by head as well as by weight. One yes and two abstentions now closes for want of quorum, which can be " +
      "asked again the same hour on a fresh roll. Staged: the proposal shows the head count, the dials and an abstention " +
      "sentence, and carries no Voice distribution, no overview of the structure and no statement of the conditions.",
  },
  {
    id: 12,
    title: "The Game Mechanics section is public, always, and after the Birthing every control becomes a proposal",
    dates: ["2026-09-02"],
    quotes: [
      "after this point all members can see the admin section and all of the controls for the entire game so the admin panel that's available just for founders at the beginning becomes available for everyone to see and they can go through and just like a founder can make all these edits but the edits as they're making them just become a change log that will then turn into a proposal and if the proposal passes then changes the game at the start of the next lunar cycle",
      "yes, no PII exposed, but all the admin sections I'm able to see now as I'm making the Game. So truly there's no reason to ever hide these behind admin. Instead name them the 'Game Mechanics' section that's always public.",
    ],
    status: () => "**Staged.** Not built.",
    note: () =>
      "The admin panel stays administrator-only today, before and after the Birthing, and no administrator read consults " +
      "launch state. Two of its write routes have a proposal path. The ruling asks for the game tabs renamed the Game " +
      "Mechanics section and public always, with every write still gated, every control rendering as propose this change " +
      "once the Game has started, and the edits collecting into one change log that becomes one proposal. Personal data " +
      "and operator matters stay where they are.",
  },
  {
    id: 13,
    title: "Lunar by default, and the cycle is a setting",
    dates: ["2026-09-02"],
    quotes: [
      "so that we're following lunar cycle periods for every lunar cycle. A new game structure can take place this lunar cycle is also a setting that it could be changed to any calendar cycle or any other cycle but we default to lunar cycles where a new cycle start and end at the new moon just like with the gratitude cycle",
      "Yes the cycle structure can be changed.",
    ],
    status: (f) => (f.staged.cycleSetting ? "**Staged.** Not built." : "**Built.**"),
    note: (f) =>
      f.staged.cycleSetting
        ? "There is one clock and no dial chooses it. A rhythm dial used to exist and was retired in 2026-08-29 at the " +
          "founder's own instruction, because the panel offered a choice the engine did not honour. Bringing it back means a " +
          "clock seam every consumer reads through first, a calendar implementation with its own id prefix, past cycles frozen " +
          "with the ids they closed under, and the switch itself timed to a boundary."
        : `\`cycle.mode\` chooses the rhythm, lunar by default, and every consumer reads one seam ` +
          `(\`shared/cycleClock.ts\`). The lunar implementation is the arithmetic that was always here, ` +
          `unchanged: the checked-in table of true new moons from cycle ${f.clock.trueClockFromCycle} on, the mean ` +
          `${f.clock.synodicMonthDays}-day formula before it, and the past frozen. The calendar implementation takes ` +
          `an id prefix of its own (\`${f.clock.calendarIdExample}\`) so the retired \`YYYY-MM\` ids stay refused at ` +
          `settlement instead of being quietly re-read. A closed cycle keeps the id and the bounds it closed under, ` +
          `and the settlement row records which clock it was played on. The change is constitutional and lands only ` +
          `at an instant that ends a cycle under the clock the village is leaving, with every finished cycle settled ` +
          `first. A boot assertion refuses to serve a build where a rhythm setting is shown and nothing reads it, ` +
          `which is the defect the retired dial shipped with.`,
  },
  {
    id: 14,
    title: "The vote mode switches both ways, holdings survive, and the village votes the switch",
    dates: ["2026-09-02"],
    quotes: [
      "within governance, we have some elements where you can have one person one vote or one token one vote where members can hold multiple voice tokens, and their vote is stronger. This should be able to go back-and-forth where you can change from one person one vote to one token one vote and vice versa and when we're making these changes, it doesn't delete the voice token holdings so if you have voice tokens, and you switch over to one person, one vote and just changes the overall governance that way, and then allows the community to go back to one token one vote and maintain the current token holdings",
      "yes",
    ],
    status: (f) => (f.dials.weightMode.ring === "founder" && f.staged.governanceModeSubject ? "**Half built.**" : "**Built.**"),
    note: (f) =>
      `Built: \`${f.dials.weightMode.key}\` carries ${f.dials.weightMode.choices.length} choices, nothing refuses a change in ` +
      "either direction, and switching reads or ignores holdings and deletes none of them. The village's own vote on it " +
      "landed on 2026-09-03 as the `governance_mode` subject type, with an executor that writes the dial through the one " +
      "amendment ledger and a landing instant a steward can stop it inside. Once the Game has started the admin route " +
      "refuses the flip and names the vote, so the switch is the village's act and no longer an administrator's."
  },
  {
    id: 15,
    title: "A proposal carries more than one element, priced at its hardest part, and applies all or nothing",
    dates: ["2026-09-02"],
    quotes: [
      "for example, on that proposal, the proposal could also contain a clause where they're distributing a bunch of new Voice tokens out to different members if maybe there is unfair voice token holding that elicited their desire to go back to one person one vote but realize they actually just needed a fair distribution so that's why proposals need to contain more than one element because they might be connected.",
      "explain",
    ],
    status: () => "**Half built.**",
    note: (f) =>
      `Built: a change set carries up to ${f.changeSet.maxChanges} entries and passes or fails as one. Staged: the set must be all ` +
      "dials or all minting rules and never both, community-governable keys only, and a Voice distribution is not a change " +
      "set entry at all. So the founder's own example, switch the mode and distribute Voice, is refused twice today and " +
      "half of it cannot be balloted. His answers to the two questions inside this one: a bundle takes the HIGHEST floor " +
      "among its elements, so nobody can smuggle a big change under a small one; and when one element fails at apply time " +
      "nothing applies, and the proposal names the element that blocked it.",
  },
  {
    id: 16,
    title: "Vote it down, say what to fix, withdraw, edit, resubmit",
    dates: ["2026-09-02"],
    quotes: [
      "During the proposal process proposal comes up and people can vote it down and put their objections and what they would like fixed then a proposer can withdraw and edit their proposal and make those suggested changes and put it back up for vote to try to reach the required quorum and unity required.",
    ],
    status: (f) => (f.statuses.includes("withdrawn") ? "**Half built.**" : "**Staged.** Not built."),
    note: () =>
      "Built: withdrawal exists at both layers, a no vote may carry a free-text reason on every method, and a consent " +
      "objection carries text and a ruling and links to the ballot it led to. Staged: objections with text exist under the " +
      "consent method only, and the default method is not consent, so under the shipped defaults a member cannot record " +
      "what they would like fixed. A stored reason on a no vote is shown to nobody. There is no edit route on a proposal " +
      "and no pointer from a resubmission back to what it replaces.",
  },
  {
    id: 17,
    title: "A village with no steward and self-executing agreements is healthy",
    dates: ["2026-09-02"],
    quotes: [
      "Sure and it's perfectly fine to have no stewards and for the game to have self/executing agreements - Stewards are like the 'training wheels' to the game to help them start - not a desirable endstate. Except one where we're all stewards in our own way.",
    ],
    status: (f) => (f.staged.steward ? "**Staged.** Not built." : "**Built.**"),
    note: () =>
      "An empty steward seat is never a warning, and nothing queues behind it. A village with nobody on the seat is a " +
      "village nobody can veto: its carried decisions land at their landing instant exactly as they would with the seat " +
      "filled. The vacancy read says that in one sentence and never as a fault report.",
  },
  {
    id: 18,
    title: "Clans, and Voice for other beings (the 144 gate was withdrawn a day later)",
    dates: ["2026-09-02"],
    quotes: [
      "part of step 2 is to encourage to name non-human governance roles in your Game (other beings who live on the land) to be part of governance. - For example giving voice to nature (a mountain your project is on a river it borders, the trees and fauna and flora that shares that piece of earth with us) - this creates another idea where a governance function of 'clans' (which groups can name whatever they like and change this name in admin) but groups within the village that anchor on living beings. The water group would tend to the waters the earth group to the land the air group to the air, etc the wolf group would tend to restoring this apex predator - which requires restoring the whole pyramid underneath the beaver clan, etc. etc all clans are namable in admin as well. But these other actors can be given voice - though this is considered a mature feature to build into the Game once you hit 144+ people.",
    ],
    status: (f) => (f.staged.clans ? "**Staged.** Not built." : "**Built.**"),
    note: () =>
      "Clans are a governance object nothing in the code knows about yet: groups within a village, each anchored on a " +
      "living being or an element, each tending what it is named for, every name editable in the Game Mechanics section. " +
      "The founding step should invite the catalysts to name governance roles for beings other than people: a mountain, " +
      "a river, the trees, the fauna and flora that share the land. The 144-player gate in this answer was WITHDRAWN on " +
      "2026-09-03, one day later: such a seat may be declared from a village's first day, and 144 is guidance on the " +
      "screen. Ruling 25 carries his words for that.",
  },
  {
    id: 19,
    title: "A passed change lands at the new moon itself",
    dates: ["2026-09-02"],
    quotes: ["I don't understand this fully."],
    status: () => "**Half built, and half withdrawn on 2026-09-03.**",
    note: (f) =>
      `Built: ${f.cycleApplyKeys.length} dials wait for the next cycle close instead of applying at the close of the vote, a ` +
      "minting rule stamped for a coming cycle is promoted on its own by the hourly job at the true boundary, one routine " +
      "applies everything due, and both its own job and the human close call it, so whichever runs first applies and the " +
      "other finds nothing left. Withdrawn by his 2026-09-03 words: the part of this answer that stamped a proposal with a " +
      "CYCLE NUMBER and showed a member \"lands at cycle 331\". A landing is a timestamp taken from the active clock, and " +
      "the page reads the instant with the countdown beside it.",
  },
  {
    id: 20,
    title: "A late approval rolls to the following new moon",
    dates: ["2026-09-02"],
    quotes: ["explain?"],
    status: () => "**Withdrawn on 2026-09-03.**",
    note: () =>
      "The case this answered: a proposal passes on the 20th of the moon, the steward is away, and the approval lands after " +
      "the new moon has come and gone. The situation cannot arise now, because no decision waits for a steward to act. A " +
      "Game change lands at the later of the next boundary and the close of its window, and a steward who is away simply " +
      "does not stop it. The answer is kept here for the reasoning it carries and because a reader who learned it needs to " +
      "see it struck.",
  },
  {
    id: 21,
    title: "Nothing is un-votable, criticality raises the bar, and 97 is the recommended ceiling",
    dates: ["2026-09-02"],
    quotes: [
      "Everything can be! But the more critical it is, the higher percentage of quorum you need (hard to get quorum) such that changing the most critical things would require a max high of 97% quorum where only 3% of the whole network would be able to not be informed and have 97% approval (max heights - we don't recommend more than those though they can exceed them (if they do we warn them) because the closer you get to 100% the chances of you getting a stalemate increase where the Game breaks even though a massive majority want to continue they can't because someone died suddenly or stopped playing the Game, etc.",
    ],
    status: (f) => (f.staged.criticality ? "**Staged.** Not built." : "**Built.**"),
    note: (f) =>
      `Every setting carries a criticality tier now, defaulting to routine, and the tier sets both the quorum and the unity ` +
      `a change to it needs: routine asks nothing beyond the village's own dials, structural asks 80 unity and 50 quorum, ` +
      `and constitutional asks 97 and 97, which is the founder's own number. The tiers are themselves eight settings, and ` +
      `the ${f.subjects.length} subject floors that used to live only in code are settings too. All ten are raise-only: the shipped number ` +
      "is a floor and a village may go above it and never below, because a village that can lower the bar for changing the " +
      "bar has no bar. Any dial typed above 97 shows the stalemate warning in words while it is being typed, and the " +
      "Birthing is the one subject exempt from it because it stays at 100 and 100 by rule. Still open: the founder's " +
      "2026-09-02 ruling that a threshold changes at its own current bar, which is a later lane.",
  },
  {
    id: 22,
    title: "Who voted is visible, how they voted is hidden, and names appear after half",
    dates: ["2026-09-02"],
    quotes: [
      "How about the name who participates is visible but by default we hide how they voted (and we only expose faces once 50% of the required vote count happens (so you can't really tell who voted what) but we don't say what they voted by default - but in settings this can be changed to public voting.",
    ],
    status: (f) => (f.staged.secrecy ? "**Staged, and the code currently says the opposite.**" : "**Built.**"),
    note: () =>
      "Votes are named on purpose today: the decision page says this village does not run secret ballots, and the roll " +
      "serves each voter's name, choice and frozen weight. No secrecy setting exists. The ruling supersedes the earlier " +
      "one that closed this question in the other direction. Counts and shares of weight stay visible under every setting, " +
      "so the people-and-weight sentence is unaffected.",
  },
  {
    id: 23,
    title: "How this document gets built and proven",
    dates: ["2026-09-02"],
    quotes: [
      "your role now is to respond to my ideas for improvement with a final execution plan. Then you're going to oversee Agents who are running on Opus or lower for what you need and only you are the Fable model as the swarm coordinator to oversee building this whole plan. You'll only complete once you've done a QA test as a fake account going through all governance actions and interacting with the site. You'll continue with QA passes building in a better Game and experience as they 'Play the Game'.",
    ],
    status: () => "**Half built.**",
    note: () =>
      "The document, its guard, its self-test and its database test are here. The walk this ruling asks for, a fresh " +
      "account driven through every governance action on a running site, is what the rest of the work is measured by, and " +
      "it has not been done yet.",
  },
  {
    id: 24,
    title: "Two Voices, one shown at a time, and the graduation to Hypha",
    dates: ["2026-09-02"],
    quotes: [
      "Yes village-voice is the Voice",
      "Village Voice is the voice unless they're running on Hypha then it changes, but only show one at the beginning, either they're using the platform or Hypha to vote. What we have is a sort of 'graduation' to Hypha when you complete a crowdpool and you want to accept all those contributions and have a secure vehicle with easy liquidity (an actual DAO on Base using Coinbase's liquidity) then you're using those actual tokens and mirroring your village game with Hypha updates (like every month or season) you would actually go to Hypha and vote to sync up the Games there. Then you would show both types of Voice if they're using both Tools but they should be in balance with every sync.",
    ],
    status: (f) => (String(f.dials.hubUrl.default) === "" ? "**Half built.**" : "**Staged.** Not built."),
    note: (f) =>
      "The two tokens exist and the platform's own Voice is the one a fresh village weighs a vote with. The hub address " +
      `ships ${String(f.dials.hubUrl.default) === "" ? "blank, so a fresh village sends nowhere" : "with a default address"}, and nothing leaves without a shared secret beside it. What is not built is the ` +
      "graduation itself: the moment a completed crowdpool moves the vote to Base, the mirroring, and the monthly or " +
      "seasonal sync that keeps the two in balance. Until that exists a village shows one Voice, which is the shape this " +
      "ruling asks for at the beginning anyway.",
  },
  {
    id: 25,
    title: "Voice for other beings, from the first day, with a representative",
    dates: ["2026-09-02", "2026-09-03"],
    quotes: [
      "You expose catalysts at the beginning (even with 3 people) the concept of giving voice to nature and inviting them to consider it by either a human or AI agent taking the perspective - or even talking directly if they have the human ability to the nature beings)",
      "2. yes voice for other beings at day 1",
    ],
    status: (f) => (f.staged.clans ? "**Staged.** Not built." : "**Built.**"),
    note: () =>
      "This replaces the 144-player unlock of the earlier answer, which becomes guidance on the screen. A village may " +
      "declare a governance role for a being other than a person from its first day, with a representative who holds " +
      "that point of view: a member, an agent built for it, or somebody who speaks with that being directly. Nothing in " +
      "the code declares one yet.",
  },
  {
    id: 26,
    title: "Every setting shows its cost, and a threshold moves at its own bar",
    dates: ["2026-09-02"],
    quotes: [
      "Yes every setting says what it costs and these are all editable from the start by catalysts to set the initial amounts. but they also can be changed by reaching the same amount they are set at can change their threshold again.",
      "Q9 yes the highest floor among them which discourages people to adjust those settings knowing the storytelling required for higher changes.",
    ],
    status: (f) => (f.staged.criticality ? "**Staged.** Not built." : "**Half built.**"),
    note: () =>
      "Built: every setting carries a tier, the tier prices a change to it, a bundle takes the highest floor among its " +
      "elements, and the tiers are settings a catalyst edits before the Birthing. Still staged: the rule that moving a " +
      "threshold costs that threshold's own CURRENT bar in both directions, so a dial at 97 and 97 needs 97 and 97 to " +
      "move either way.",
  },
  {
    id: 27,
    title: "The steward holds a veto window, and nothing waits for a steward",
    dates: ["2026-09-03"],
    quotes: [
      "Yes whenever a decision is approved it passes and executes (if it's sending tokens) if it's changing the Game then it starts at the next new moon or automatically if a steward doesn't block it, a steward is given 3 days minimum (so if the vote only gets enough quorum and total votes by the very last day of the lunar cycle then a steward will get 3 days to veto, if it's past longer than 3 days out of the end of the cycle then a steward has until the cycle ends to veto otherwise it goes into effect.",
    ],
    status: (f) => (f.staged.steward || f.staged.landing ? "**Staged.** Not built." : "**Built.**"),
    note: (f) =>
      "This is the ruling the whole model turns on, and it withdraws the approval gate of the two rounds before it. A " +
      "token send executes at the close of its ballot. A Game change never executes at the close: it is stamped with a " +
      "landing instant and lands there by itself unless a seated steward stops it inside the window. There is no " +
      "approval, no hold, and no queue when the seat is empty. The window is at least " +
      `${f.kinds.vetoHoursFloor} hours and stays open until the change lands, and \`${f.dials.vetoHours.key}\` carries the ` +
      `village's own number with that floor. \`${f.dials.stewardSubjects.key}\` says which kinds of decision the seat may stop.`,
  },
  {
    id: 28,
    title: "A steward's no fails a token payment, and a veto can be overridden",
    dates: ["2026-09-03"],
    quotes: [
      "However if a steward votes down on a token payment proposal than it fails automatically.",
      "Yes stewards can also block payouts, and yes to the veto override",
    ],
    status: (f) => (f.staged.steward ? "**Staged.** Not built." : "**Built.**"),
    note: () =>
      "A seated steward voting no on a token-send ballot fails it at the close, with the steward named and the reason on " +
      "the record, and the row closes as vetoed so the override and the dashboard both reach it. Two narrowings are the " +
      "build's own reading and are recorded as such: it applies to token sends and never to every ballot, and a steward " +
      "cannot fail a ballot they are the subject of. Because a token send has no window after it closes, the block " +
      "happens while the ballot is open.",
  },
  {
    id: 29,
    title: "The override tier, the governance windows, the notices and the countdown",
    dates: ["2026-09-03"],
    quotes: [
      "We can have a veto override if it goes up to the highest tier they have set as a village (this is also a setting that can change at the highest tier set)",
      "Yes stewards are sent emails and given notifications in the app. But we can also block all proposals from not happening within defined governance windows. Some can be 'always open' but some can have set windows (like the last week of every month or last 2 weeks of every season or whatever) but those two are the default choices we offer to guide.",
      "Steward accountability on dashboard is excellent!",
      "72 hours from close and a countdown on it.",
    ],
    status: (f) => (f.staged.governanceWeek ? "**Staged.** Not built." : "**Built.**"),
    note: (f) =>
      `The override lands at \`${f.dials.highestTier.key}\`, which is itself priced at the highest tier. The windows are ` +
      `${f.windows.length} settings, one per proposal kind, and each holds one shape: always open, the last N days of every ` +
      "cycle of the active clock, the last N days of every season, or a shape the village writes. All of them ship always " +
      "open. This supersedes the 2026-08-31 line that proposals are never gated by the calendar: a village may gate them " +
      "now, and always open stays a choice. The countdown reads one instant through one helper, so no surface can show a " +
      "deadline the engine does not enforce.",
  },
  {
    id: 30,
    title: "Lunar months, quorum by weight, the bundle waits, and timing per proposal",
    dates: ["2026-09-03"],
    quotes: [
      "governance 'Months' are lunar months starting and ending with the moon as the default",
      "Quorum SHOULD be pure token weight (not counting people, unless it's 1-person-1-vote but we STILL SHOW PEOPLE counts, even though the quorum is calculated by village-voice token weight)",
      "1. who bundle waits! (along with this proposals can each carry - execute at accept or start with the new moon and to default to starting with the new moon to carry a pattern of new activities starting then).",
      "2. no any single steward has the ability to veto though we could add a 'Steward Council' option that makes it a majority of them",
      "3. No if there is 3 cycles without quorum it just doesn't pass.",
      "make sure you add the context and links to those context documents (on governance I gave you at the first) to the governance docs that humans and bots will read to get an understanding of this game.",
    ],
    status: (f) => (f.quorumFormula.weightOnly ? "**Built.**" : "**Staged, and the code currently says the opposite.**"),
    note: (f) =>
      `A governance month is a lunar month. Quorum and unity read weight and nothing else, which the arithmetic itself ` +
      `confirms: \`quorumPctOf\` adds ${f.quorumFormula.weightFields.join(", ")} and divides by the frozen total weight, and ` +
      `it reads ${f.quorumFormula.headFields.length === 0 ? "no head count at all" : `the head counts ${f.quorumFormula.headFields.join(", ")}, which this ruling withdrew`}. ` +
      "The head-count quorum an earlier plan carried is withdrawn, and so is the automatic drop to a lower tier after " +
      "three cycles without quorum. People counts are shown beside the weight everywhere. A bundle waits as a whole under " +
      `one landing instant. Any single steward may stop a change, and \`${f.dials.stewardCouncil.key}\` makes it a majority ` +
      "of the seated stewards. The three sources this document descends from are named in Where this comes from, with a " +
      "copy of each under `docs/sources/`.",
  },
  {
    id: 31,
    title: "A non-human seat votes, and whether its weight counts toward quorum is a setting",
    dates: ["2026-09-03"],
    quotes: [
      "1. default 2. default 3. default 4. default 5. a non-human seat should be voting! Either it is held by an actual human or a bot that is meant to vote to represent that PoV. However, it can also be excluded from quorum (make this a setting too whether to include or exclude from quorum with the default excluded) 6. default 7. default 8. default",
    ],
    status: (f) => (f.staged.clans ? "**Half built.**" : "**Built.**"),
    note: (f) =>
      `\`${f.dials.nonhumanInQuorum.key}\` decides whether such a seat's weight counts toward quorum and ships ` +
      `\`${String(f.dials.nonhumanInQuorum.default)}\`, and \`${f.dials.absentCycles.key}\` says how many cycles a seat may go ` +
      "unvoted before weight that cannot vote leaves the denominator. The arithmetic is built and the seat is not: nothing " +
      "declares a being other than a person yet, and a representative who is an agent needs an account a ballot can point " +
      "at. The eight defaults this answer accepted are the veto window, a steward's no on payments only, payouts at " +
      "acceptance and Game changes at the moon, no trial of a pricing dial, a window that gates the opening only, " +
      "members-only names and amounts, and erasure winning over the freeze.",
  },
  {
    id: 32,
    title: "Voice is buyable, and it decays one percent a cycle",
    dates: ["2026-09-03"],
    quotes: [
      "Yes, Voice is buyable and decays 1% per cycle by default.",
      "Yes an investment of money is a contribution and does (by default) issue voice. though this can be changed of course by each village and each proposal being 100% editable.",
      "Yes decay is uniform.",
    ],
    status: () => "**Staged.** Not built.",
    note: () =>
      "This deliberately relaxes a guard the platform shipped: a token money can buy was refused as the weight token, and " +
      "the refusal becomes a warning on the control. Money in mints Voice by default through a minting rule like any " +
      "other contribution, a village or a single proposal may change that, and every ballot and the Birthing document show " +
      "each holder's share, which is the protection. Decay is uniform across bought and earned Voice, posted to a sink at " +
      "the cycle close, and never a rewrite of a balance, so the weights a ballot freezes read the balance the ledger " +
      "holds at that instant with no change to the engine. None of it is in the code today.",
  },
  {
    id: 33,
    title: "Stalemate protection, with a guard against the losing side asking again",
    dates: ["2026-09-02"],
    quotes: [
      "I think so on the stalemate protections but we have to do this in a way where they can't be abused by people who don't like the outcome of a vote.",
      "Yes absolutely first governance as quests that describes how this is how we empower ourselves, evolve the game, make sure we're always making it better, more fun, more empowering, more capable, as we co-create new realities and civilizations together and take this task seriously.",
    ],
    status: () => "**Staged.** Not built.",
    note: () =>
      "A ballot may be re-run with a fresh roll only when a frozen seat has provably left the village, recorded in the " +
      "ledger and never self-declared, and only while the ballot is still open and can no longer reach its quorum. A " +
      "closed ballot is never re-run, so nobody who dislikes an outcome gets a second vote out of this. The re-run " +
      "links to the ballot it replaces so the record says why. The same door opens for a bloc of weight that cannot " +
      "vote, which is arithmetic telling the truth and not the tier fallback that was withdrawn. The second quote is " +
      "the framing the first governance quests carry.",
  },
];

/**
 * WHAT THIS DOCUMENT USED TO SAY, and the date each sentence was struck.
 *
 * A generated document has one bad habit available to it: when a rule changes,
 * the paragraph describing the old rule simply stops rendering and nobody who
 * read it ever learns it went. So the withdrawn sentences are kept, struck,
 * with the ruling that withdrew them and the date. A fork holding an older copy
 * of this file can then tell which of its sentences are history.
 *
 * `what` is quoted as closely as the old text allows. `by` names the layer of
 * `docs/GOVERNANCE_EVOLUTION_PROMPT.md` that withdrew it.
 */
const WITHDRAWN = [
  {
    what: "A steward approves a passed proposal before it takes effect.",
    on: "2026-09-03",
    by: "19C",
    now: "The steward holds a window and never a gate. A carried decision lands on its own, and the seat's one power is to stop it before it does.",
  },
  {
    what: "A passed proposal QUEUES while the steward seat is empty, and executes when a steward is next voted in.",
    on: "2026-09-03",
    by: "19C",
    now: "Nothing queues. A village with no steward is a village nobody can stop, and that is the healthy end state.",
  },
  {
    what: "A member sees \"lands at cycle 331\" on the proposal from the moment it passes.",
    on: "2026-09-03",
    by: "19C and 20.11",
    now: "A landing is a timestamp taken from the active clock. The page shows the instant with the countdown beside it, and no cycle number appears on the vote path.",
  },
  {
    what: "Voice for other beings, and clans, unlock at 144 players.",
    on: "2026-09-03",
    by: "19B and 19C",
    now: "A village may declare a seat for a being other than a person on its first day. The 144 line is guidance on the screen.",
  },
  {
    what: "Some settings can never be changed by a vote.",
    on: "2026-09-02",
    by: "19 Q11",
    now: "Nothing is un-votable. Criticality raises the bar instead, and the recommended ceiling is 97 percent of quorum and 97 percent of unity.",
  },
  {
    what: "Proposals are never gated by the calendar, and a governance window must not become a permission check.",
    on: "2026-09-03",
    by: "19E",
    now: "A village may block a kind of proposal from being OPENED outside a window it sets. Always open stays a choice and ships as the default.",
  },
  {
    what: "A ballot's full detail, with each voter's name, their choice and their frozen weight, is public.",
    on: "2026-09-02",
    by: "19 Q12",
    now: "Who has voted is visible once half the required votes are in; how they voted is hidden unless a village turns public voting on. Counts and shares of weight stay visible under every setting.",
  },
  {
    what: "A tier percentage counts weight AND heads, so a quorum needs a minimum number of people as well as a share of the weight.",
    on: "2026-09-03",
    by: "19F",
    now: "Quorum and unity are pure token weight. People counts are shown beside the weight everywhere, and the concentration that allows is stated in this document as the founder's own decision.",
  },
  {
    what: "A tier that misses quorum three cycles running drops automatically to the tier below it.",
    on: "2026-09-03",
    by: "19F",
    now: "It simply does not pass. The second miss warns that the next ends it; the third closes the question with one door, which is to withdraw and rewrite.",
  },
  {
    what: "A vetoed proposal is overridden by passing again at the NEXT criticality tier above the one it carried at.",
    on: "2026-09-03",
    by: "19E",
    now: "It is overridden by passing again at the village's highest set tier, which is itself a setting priced at that tier.",
  },
  {
    what: "A steward's approval executes the proposal at once.",
    on: "2026-09-03",
    by: "19C",
    now: "There is no approval to execute at. His words that night stay in the record as ruling 27's history.",
  },
  {
    what: "A late approval rolls the proposal to the following new moon.",
    on: "2026-09-03",
    by: "19C",
    now: "The situation cannot arise, because nothing waits for a steward.",
  },
];

/**
 * THE THREE SOURCES, and the copy of each a fork can open.
 *
 * The founder gave three links. A link is a closed door to anybody outside the
 * document that shared it, so the text of each one is checked in beside this
 * document and the link stays as the origin. Rendered into both
 * `docs/GOVERNANCE.md` and `docs/knowledge/governance-lineage.md` from here, so
 * the assistant's shelf and the document cannot come apart.
 */
const LINEAGE_SOURCES = [
  {
    title: "So you want to make a DHO?",
    url: "https://docs.google.com/presentation/d/1hjjo_p5VqaOkaUml9nR3s8ZGUt1AzCidCSw6VngJ3dc/edit?usp=drivesdk",
    prose: "lineageDeck",
    copy: "docs/sources/hypha-dho-deck.md",
  },
  {
    title: "How to do a DHO/DAO",
    url: "https://youtu.be/_TpyEO6NRnY",
    prose: "lineageTalk",
    copy: "docs/sources/how-to-do-a-dho-talk-summary.md",
  },
  {
    title: "Hypha Handbook V0.3",
    url: "https://docs.google.com/document/d/1hFJPe1N0yyntJ9g-iQFvhtf9j2pDsxmmG-ufxqnAt5g/edit?usp=drivesdk",
    prose: "lineageHandbook",
    copy: "docs/sources/hypha-handbook-v0.3-summary.md",
  },
];

// ── Facts ───────────────────────────────────────────────────────────────────

/**
 * The staleness guards for everything this document calls staged.
 *
 * Copying the sibling generator's lesson exactly, including the part that
 * cost it a rewrite: THE PATTERNS ARE NARROW. A loose match over every dial
 * key is how a document cheerfully announces a setting that does not exist.
 * Each pattern below is scoped to the surface the ruling would actually land
 * on, so a key about something else cannot trip it.
 *
 * Each returns true while the thing is still absent. The refusals live in
 * `stalenessProblem` beside them, so the message that stops the build names
 * the ruling whose status went stale.
 */
function stagedFlags(dialKeys, governanceKeys, caps, dispatcher, routes, launchSubject) {
  const anyKey = (re) => governanceKeys.some((k) => re.test(k));
  const anyRoute = (re) => routes.rows.some((r) => re.test(r.path));
  const launchBody = dispatcher.bodies[launchSubject] ?? "";
  return {
    /*
     * EVERY FLAG THAT COULD READ A ROUTE NOW READS ONE.
     *
     * These flags decide whether a ruling renders as built or as staged, and
     * the walk they read used to see three files. Four route modules landed
     * outside those three, so `delegation` stayed true and the document told
     * every reader that delegation was ruled, described and absent while seven
     * delegation routes were answering members. `routeFacts` walks the whole
     * directory now, and the flags that have route evidence use it.
     */
    steward:
      !caps.some((c) => /steward/i.test(c)) &&
      !anyKey(/steward/i) &&
      !anyRoute(/veto|stewardship/i) &&
      !dispatcher.all.some((k) => /steward|approval/i.test(k)),
    launchSeatsSteward: !/steward/i.test(launchBody),
    governanceWeek: !anyKey(/week/i) && !anyKey(/^governance\.window_/i),
    delegation: !anyKey(/delegat/i) && !anyRoute(/delegat/i),
    landing: !anyRoute(/landing/i) && !anyKey(/veto_hours/i),
    cycleSetting: !dialKeys.some((k) => /^cycle\./i.test(k) || /(cycle_mode|cycle_kind|rhythm)/i.test(k)),
    clans: !dialKeys.some((k) => /\bclan/i.test(k)),
    // The tiers landed as `governance.tier_<tier>_<dial>_pct` settings, and the
    // word criticality itself lives on a VariableDef property where no key can
    // carry it. A pattern watching for "critical" alone therefore stayed quiet
    // through the whole landing, which is the failure mode this guard exists to
    // prevent, so the tier keys are what it watches now.
    criticality: !anyKey(/critical/i) && !anyKey(/\.tier_/i),
    secrecy: !anyKey(/(secret|anonym|voter_identity|public_votes|ballot_privacy)/i),
    governanceModeSubject: !dispatcher.all.some((k) => /governance_mode/i.test(k)),
  };
}

function stalenessProblem(staged) {
  // Rulings 1, 4, 7 and 21 landed on 2026-09-02 in the governance build, and
  // ruling 13 (the rhythm as a setting) on 2026-09-03, so their rows come out
  // of this list and their notes now describe what shipped. A row stays here
  // only while the ruling's note still says "not built": the guard's whole job
  // is to stop the build once, on the day the code moves past the prose, and
  // it has done that job for these five.
  const complaints = [
    [!staged.clans, 18, "clans"],
    [!staged.secrecy, 22, "a voter-identity setting"],
    // Ruling 14 came off this list on 2026-09-03: the governance_mode subject
    // type and its executor landed, and its note now describes what shipped.
  ];
  for (const [built, ruling, what] of complaints) {
    if (!built) continue;
    return (
      `something in the code looks like ${what}, which ruling ${ruling} describes as staged. ` +
      `If it is, update ruling ${ruling}'s status and note in scripts/generate-governance-doc.mjs. ` +
      "If it is not, narrow the pattern beside this check in stagedFlags()."
    );
  }
  return null;
}

export function collectFacts(root = ROOT) {
  for (const rel of SOURCES) {
    if (!fs.existsSync(absOf(root, rel))) fail(`${rel} is gone; the generator reads it`);
  }

  const dispatcher = dispatcherKeys(root);
  const subjects = subjectFloors(root);
  const engine = engineFacts(root);
  const statuses = ballotStatuses(root);
  const dialFacts = governanceDials(root);
  const caps = capabilityFacts(root);
  const mod = moduleFacts(root);
  const wizard = wizardTypes(root);
  const weights = weightFacts(root);
  const changeSet = changeSetFacts(root);
  const launch = launchFacts(root);
  const clock = clockFacts(root);
  const routes = routeFacts(root);
  const kinds = kindFacts(root);
  const schema = schemaFacts(root);
  const quorumFormula = quorumFormulaFacts(root);
  const commit = sourceCommit(root);

  const byKey = Object.fromEntries(dialFacts.governance.map((d) => [d.key, d]));
  const need = (key) => {
    const d = byKey[key];
    if (!d) fail(`shared/gameVariables.ts no longer defines the Governance dial "${key}"; this document states it by name`);
    return d;
  };

  const launchSubject = subjects.find((s) => s.everySeatWeighs && s.minUnityPct === 100 && s.minQuorumPct === 100);
  if (!launchSubject) {
    fail(
      "no subject in SUBJECT_THRESHOLDS asks 100 unity, 100 quorum and every seat weighing. " +
        "The Birthing rule is the one floor this document cannot render without.",
    );
  }

  const governanceKeys = dialFacts.governance.map((d) => d.key);
  const missingSubject = subjectCoverageProblem(dispatcher.all);
  if (missingSubject) fail(missingSubject.replace(/^governance-doc: /, ""));
  const missingDial = dialCoverageProblem(governanceKeys);
  if (missingDial) fail(missingDial.replace(/^governance-doc: /, ""));
  const missingNamed = namedDialProblem(dialFacts.allKeys);
  if (missingNamed) fail(missingNamed);
  const staged = stagedFlags(dialFacts.allKeys, governanceKeys, caps.all, dispatcher, routes, launchSubject.subject);
  const stale = stalenessProblem(staged);
  if (stale) fail(stale);

  const executes = new Set(dispatcher.all);
  const subjectRows = subjects.map((s) => ({ ...s, executes: executes.has(s.subject) }));

  return {
    commit,
    dispatcher,
    subjects: subjectRows,
    launchFloor: launchSubject,
    engine,
    statuses,
    dials: {
      all: dialFacts.governance,
      unity: need("governance.unity_pct"),
      quorum: need("governance.quorum_pct"),
      voteDays: need("governance.vote_days"),
      consentDays: need("governance.consent_window_days"),
      method: need("governance.default_method"),
      weightMode: need("governance.weight_mode"),
      weightToken: need("governance.weight_token"),
      autoApply: need("governance.auto_apply_enabled"),
      hubUrl: need("governance.hub_url"),
      supportThreshold: need("governance.proposal_support_threshold"),
      perCycleCap: need("governance.proposals_per_member_per_cycle"),
      vetoHours: need("governance.veto_hours"),
      stewardCouncil: need("governance.steward_council"),
      highestTier: need("governance.highest_tier"),
      stewardSubjects: need("governance.steward_subjects"),
      nonhumanInQuorum: need("governance.nonhuman_in_quorum"),
      absentCycles: need("governance.absent_cycles"),
      windowGraceDays: need("governance.window_grace_days"),
    },
    windows: dialFacts.governance.filter((d) => /^governance\.window_(?!grace)/.test(d.key)),
    cycleApplyKeys: dialFacts.cycleApplyKeys,
    stageMultipliersAreCycleTimed: dialFacts.stageMultipliersAreCycleTimed,
    capabilities: caps,
    module: mod,
    wizard,
    weights,
    changeSet,
    launch,
    clock,
    routes,
    kinds,
    schema,
    quorumFormula,
    staged,
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────

function table(headers, rows) {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const r of rows) lines.push(`| ${r.join(" | ")} |`);
  return lines.join("\n");
}

const code = (s) => `\`${s}\``;
const list = (xs) => xs.map(code).join(", ");
/** "a" or "an", so a ring name read out of the code never renders as `a open`-ring. */
const an = (word) => (/^[aeiou]/i.test(String(word)) ? "an" : "a");

/**
 * WHAT QUORUM COUNTS, in one sentence, derived from the arithmetic.
 *
 * 19F rules quorum is pure token weight. This sentence is computed from
 * `quorumPctOf` itself, so the day somebody puts a head count back into that
 * function the document says so instead of going on repeating the ruling. The
 * self-test pins the two together in both directions.
 */
export function quorumSentence(f) {
  const q = f.quorumFormula;
  if (q.weightOnly && q.dividesByTotalWeight) {
    return (
      `Read out of the arithmetic: \`quorumPctOf\` adds ${list(q.weightFields)} and divides by the frozen weight of the ` +
      "whole roll. It reads no head count at all. Quorum is weight."
    );
  }
  return (
    "**The engine and this document disagree about quorum.** `quorumPctOf` reads the head counts " +
    `${list(q.headFields)} beside the weights ${list(q.weightFields)}, and the ruling of 2026-09-03 is that quorum is ` +
    "weight alone. One of the two is wrong, and it is not this sentence."
  );
}

/**
 * WHERE THIS COMES FROM, rendered into both generated files from one place.
 *
 * `docs/GOVERNANCE.md` carries it so a reader of the rules can reach their
 * root, and `docs/knowledge/governance-lineage.md` carries it so the
 * assistant's shelf can answer the same question. Two copies of a section is
 * two sections that drift, so there is one.
 */
function lineage(p, say, sayUnder) {
  p("## Where this comes from");
  p();
  say("lineageIntro");
  p();
  for (const source of LINEAGE_SOURCES) {
    p(`- [${source.title}](${source.url})`);
    sayUnder(source.prose);
    p(`  A copy a fork can open: \`${source.copy}\`.`);
  }
  p();
  say("lineageCopies");
  p();
  say("lineageRecord");
  p();
}

export function render(f) {
  const L = [];
  const p = (s = "") => L.push(s);
  /** A person's sentence, marked in the source of the document where it appears. */
  const say = (key) => {
    const text = PROSE[key];
    if (!text) fail(`render() asked for the prose entry "${key}", which PROSE does not hold`);
    p(`<!-- written by a person: ${key} -->`);
    p(text);
  };
  /** The same, indented so it continues the list item above it. */
  const sayUnder = (key) => {
    const text = PROSE[key];
    if (!text) fail(`render() asked for the prose entry "${key}", which PROSE does not hold`);
    p(`  <!-- written by a person: ${key} -->`);
    p(`  ${text}`);
  };
  const quote = (text) => {
    p("<!-- the founder's own words -->");
    p(`> ${text.replace(/\n/g, " ")}`);
  };

  p("# Governance");
  p();
  say("purpose");
  p();
  say("scope");
  p();

  p("## How to read this file");
  p();
  say("generated");
  p();
  p(`It describes the code at commit \`${f.commit}\`.`);
  p();
  say("editing");
  p();
  p("```bash");
  p("node scripts/generate-governance-doc.mjs");
  p("```");
  p();
  say("twoKinds");
  p();
  say("readFromCode");
  p();
  say("writtenByPerson");
  p();
  say("noTimestamp");
  p();

  p("## The constitution in one screen");
  p();
  say("constitutionOpening");
  p();
  say("ringZero");
  p();
  say("ringZeroFreeze");
  p();
  say("birthingRule");
  p();
  p(
    table(
      ["The Birthing asks", "Number", "Where it lives"],
      [
        ["Unity, the share of the weight that took a side and agreed", `${f.launchFloor.minUnityPct}%`, "code, `shared/ballotSubjects.ts`"],
        ["Quorum, the share of the frozen weight that answered", `${f.launchFloor.minQuorumPct}%`, "code, `shared/ballotSubjects.ts`"],
        ["People on the roll before it may be asked", String(f.launchFloor.minElectorate), "code, `shared/ballotSubjects.ts`"],
        ["Every seat carrying weight above zero", f.launchFloor.everySeatWeighs ? "required" : "not required", "code, `shared/ballotSubjects.ts`"],
        ["Method", code(f.launchFloor.method ?? "the village's own"), "code, `shared/ballotSubjects.ts`"],
      ],
    ),
  );
  p();
  p(
    `With every seat above zero, ${f.launchFloor.minQuorumPct}% of the weight is reached only when every seat has answered, ` +
      "so the weight rule proves the people rule. A Birthing carries when all of the people on the frozen roll have voted " +
      "and all of the weight that took a side agrees.",
  );
  p();
  say("criticality");
  p();
  say("criticalityToday");
  p();
  say("quorumIsWeight");
  p();
  p(quorumSentence(f));
  p();
  say("concentrationConsequence");
  p();
  say("accountsNotPeople");
  p();
  say("stewardlessHealthy");
  p();
  say("englishOnly");
  p();
  say("publishModule");
  p();
  p(
    `The governance module ships **off**. Its lifecycles are ${list(f.module.lifecycles)}, an absent row means off, and its ` +
      `prefixes are ${list(f.module.apiPrefixes)}. It turns on ${list(f.module.capabilities)} and carries ${f.module.variableKeys.length} ` +
      "settings of its own.",
  );
  p();

  p("## What a decision is");
  p();
  say("decisionIs");
  p();
  p(`A ballot is in one of these states: ${list(f.statuses)}.`);
  p();
  say("oneOpenBallot");
  p();
  say("votesChangeable");
  p();
  say("closingIsHuman");
  p();

  p("## How a vote is counted");
  p();
  say("countingIntro");
  p();
  p("```");
  p("unity  = (yes + no > 0) ? yesWeight / (yesWeight + noWeight) : 0");
  p("quorum = totalWeight > 0 ? (yesWeight + noWeight + abstainWeight) / totalWeight : 0");
  p("passed = quorum >= quorumFrozen && unity >= unityFrozen");
  p("```");
  p();
  say("abstainRule");
  p();
  p(`A vote is one of ${list(f.engine.choices)}. An outcome is one of ${list(f.engine.outcomes)}.`);
  p();
  p(
    table(
      ["Method", "What it asks", "Unity it stamps at open"],
      f.engine.methods.map((m) => [
        code(m),
        {
          majority: "Unity strictly above 50. A tie fails.",
          custom: "Unity at or above the number the ballot froze.",
          consensus: "No weight voted no, and some weight voted yes.",
          consent: "No objection is standing. Unity is never read.",
        }[m] ?? "could not derive",
        f.engine.presets[m] === null || f.engine.presets[m] === undefined
          ? "the village's own"
          : String(f.engine.presets[m]),
      ]),
    ),
  );
  p();
  say("peopleAndWeight");
  p();
  say("nonHumanSeats");
  p();
  p(
    `\`${f.dials.nonhumanInQuorum.key}\` ships \`${String(f.dials.nonhumanInQuorum.default)}\` and ` +
      `\`${f.dials.absentCycles.key}\` ships \`${String(f.dials.absentCycles.default)}\`, so on a fresh village a seat ` +
      "held for a being other than a person is outside the quorum arithmetic and its vote still counts toward unity.",
  );
  p();
  say("noFallback");
  p();

  p("## The dials a village holds");
  p();
  say("dialsIntro");
  p();
  p(
    table(
      ["Key", "What it decides", "Ring", "Default", "Bounds", "Applies"],
      f.dials.all.map((d) => [
        code(d.key),
        d.label,
        code(d.ring),
        d.default === undefined ? "none" : code(String(d.default)),
        d.min === undefined && d.max === undefined
          ? d.choices
            ? list(d.choices.map((c) => c.value))
            : d.type
          : `${d.min ?? "none"} to ${d.max ?? "none"}${d.unit ? ` ${d.unit}` : ""}`,
        d.applyTiming === "cycle-close" ? "at the next cycle close" : "when it is written",
      ]),
    ),
  );
  p();
  say("dialsStorage");
  p();
  p(
    `${f.cycleApplyKeys.length} settings across the whole registry wait for a cycle close instead of applying when they are ` +
      `written: ${list(f.cycleApplyKeys)}. ` +
      (f.stageMultipliersAreCycleTimed
        ? "The per-stage sending multipliers carry the same timing through their own override, one for each rung of the ladder. "
        : "") +
      `None of the ${f.dials.all.length} settings above is one of them, so every governance dial takes effect the moment it is written.`,
  );
  p();

  p("## What each kind of decision asks");
  p();
  say("subjectsIntro");
  p();
  p(
    table(
      ["Subject type", "Least unity", "Least quorum", "People on the roll", "Every seat weighs", "Method", "Executes at close"],
      f.subjects.map((s) => [
        code(s.subject),
        `${s.minUnityPct}%`,
        `${s.minQuorumPct}%`,
        String(s.minElectorate),
        s.everySeatWeighs ? "yes" : "no",
        s.method ? code(s.method) : "the village's own",
        s.executes ? "yes" : "no, it conducts a decision and executes nothing",
      ]),
    ),
  );
  p();
  for (const s of f.subjects) {
    p(`- ${code(s.subject)}: ${s.why}`);
  }
  p();
  p(
    `Every other subject type keeps the village's own dials: ${code(f.dials.unity.default + "% unity")} and ` +
      `${code(f.dials.quorum.default + "% quorum")} on a fresh village, with no floor of its own.`,
  );
  p();
  p(
    `A member drafts through the wizard, which knows ${f.wizard.server.length} types: ${list(f.wizard.server)}. ` +
      `${f.wizard.conductable.length} of them can be taken to a binding vote today (${list(f.wizard.conductable)}); ` +
      `the other ${f.wizard.advisory.length} open as practice votes (${list(f.wizard.advisory)}).`,
  );
  p();
  say("practiceVotes");
  p();
  p(
    f.wizard.server.join("|") === f.wizard.client.join("|")
      ? "The wizard's type list is held in two files, once on the server and once in the browser, and they agree today."
      : `**The wizard's two type lists disagree.** The server knows ${list(f.wizard.server)} and the browser knows ` +
        `${list(f.wizard.client)}. One of them is showing a member something the other cannot answer.`,
  );
  p();
  p(
    `A change set carries at most ${f.changeSet.maxChanges} entries, all game dials or all minting rules and never both, ` +
      "because a ballot carries one threshold priced by its subject and a set that is two subjects has no honest price.",
  );
  p();

  p("## What closing a decision does");
  p();
  say("closingIntro");
  p();
  p(
    table(
      ["Subject type", "What a passed vote changes", "How it reaches its executor"],
      [
        ...f.dispatcher.direct.map((k) => [code(k), SUBJECT_WORDS[k], "its own entry in the close dispatcher"]),
        ...f.dispatcher.aliases.map((a) => [
          code(a.key),
          SUBJECT_WORDS[a.key],
          `the same executor as ${code(a.sameAs)}, one executor and two subject types`,
        ]),
      ],
    ),
  );
  p();
  p(
    `${f.dispatcher.all.length} subject types execute something. Whether a member's vote BINDS is derived from this same ` +
      "table, so the word on the decision page and the behaviour at the close cannot come apart.",
  );
  p();

  p("## Two kinds of decision, and when each one happens");
  p();
  say("twoKindsOfDecision");
  p();
  p(
    table(
      ["Subject type", "Kind"],
      Object.entries(f.kinds.forSubject).map(([k, v]) => [code(k), code(v)]),
    ),
  );
  p();
  p(
    `Every other subject type is a ${code("game_change")}, including every one in the closing table above that this ` +
      "table does not name.",
  );
  p();
  p(
    table(
      ["Change-set element", "Kind"],
      Object.entries(f.kinds.forItem).map(([k, v]) => [code(k), code(v)]),
    ),
  );
  p();
  say("weightAllocationIsAGameChange");
  p();
  say("timingChoice");
  p();
  p(
    table(
      ["Kind", "Timing it defaults to", "What that means"],
      f.kinds.kinds.map((k) => [
        code(k),
        code(f.kinds.defaultsByKind[k]),
        f.kinds.defaultsByKind[k] === "at_acceptance"
          ? "it happens when the ballot closes"
          : "it happens at the next boundary of the active clock, and never before its window shuts",
      ]),
    ),
  );
  p();
  p(
    `A proposal carries one timing out of ${f.kinds.timings.length} (${list(f.kinds.timings)}), and the platform ` +
      `default is ${code(f.kinds.defaultTiming)}. ` +
      "A Game change chosen at acceptance still cannot land before its window closes, so it lands at the close of the " +
      "window. Anything chosen for the new moon lands at the later of the next boundary and the close of the window.",
  );
  p();
  say("landingInstant");
  p();
  say("bundleWaits");
  p();
  say("snapForward");
  p();
  say("lateSettled");
  p();

  p("## The veto window");
  p();
  say("vetoWindowRule");
  p();
  p(
    `The floor is ${f.kinds.vetoHoursFloor} hours, held in code. The village's own number is ` +
      `\`${f.dials.vetoHours.key}\`, ${an(f.dials.vetoHours.ring)} ${code(f.dials.vetoHours.ring)}-ring setting ` +
      "defaulting to " +
      `${code(String(f.dials.vetoHours.default))}${f.dials.vetoHours.unit ? ` ${f.dials.vetoHours.unit}` : ""}. ` +
      `\`${f.dials.stewardSubjects.key}\` says which kinds of decision the seat may stop and ships ` +
      `${code(String(f.dials.stewardSubjects.default))}. \`${f.dials.stewardCouncil.key}\` ships ` +
      `${code(String(f.dials.stewardCouncil.default))}: while it is off, any one seated steward stops a change; while it ` +
      "is on, a majority of the seated stewards has to.",
  );
  p();
  say("vetoAct");
  p();
  say("vetoOnTheBallot");
  p();
  say("stewardNo");
  p();
  say("notVetoable");
  p();
  p(
    `Read from the code: ${list(f.kinds.noWindowSubjects)} execute the moment they carry, with no window at all. ` +
      "That list used to hold the two seat acts as well, and the gap between the ruling and the code was recorded " +
      "here: 2026-09-03 asked that a seating keep its timing and its window and simply admit no veto, while the code " +
      "took the window away too, which arrived at the same place by a shorter road. Rye closed the gap on 2026-09-04 " +
      "in favour of the ruling, so a seating now waits its window, the village reads it coming, and no steward may " +
      "stop it. The Birthing is on that list for a reason of its own: before it carries nobody " +
      "holds a seat, so a window on it would be hours nobody could use, and it already asks every seat to vote and " +
      "every seat to say yes.",
  );
  p();
  say("override");
  p();
  p(
    `The tier the override has to reach is \`${f.dials.highestTier.key}\`, ${an(f.dials.highestTier.ring)} ` +
      `${code(f.dials.highestTier.ring)}-ring ` +
      `setting defaulting to ${code(String(f.dials.highestTier.default))}. Changing it is priced at itself.`,
  );
  p();
  say("notices");
  p();

  p("## When a proposal may be opened");
  p();
  say("windowsIntro");
  p();
  p(
    table(
      ["Setting", "The kind it gates", "Ships as"],
      f.windows.map((d) => [code(d.key), d.label, code(String(d.default))]),
    ),
  );
  p();
  p(
    `\`${f.dials.windowGraceDays.key}\` ships ${code(String(f.dials.windowGraceDays.default))}` +
      `${f.dials.windowGraceDays.unit ? ` ${f.dials.windowGraceDays.unit}` : ""}: how long anything coming back may open ` +
      "outside its window.",
  );
  p();
  say("windowsRule");
  p();

  p("## Delegation");
  p();
  say("delegationRule");
  p();
  say("delegationConsent");
  p();
  p(
    f.routes.rows.some((r) => /delegat/.test(r.path))
      ? `${f.routes.rows.filter((r) => /delegat|concentration/.test(r.path)).length} routes serve it, and they are in the ` +
        "table of what a village publishes below. What a member sees of it is a surface, and the surface is not built yet."
      : "**No route serves delegation today**, so nothing above is reachable by a member.",
  );
  p();

  p("## What happens when a decision lands");
  p();
  say("landingLoop");
  p();
  say("landingCounts");
  p();
  say("atomicity");
  p();
  say("noCloser");
  p();
  say("digest");
  p();

  p("## Starting the Game: the Birthing");
  p();
  say("launchIntro");
  p();
  p(`Until it carries, issuance is refused in these words: "${f.launch.issuanceRefusal}"`);
  p();
  say("launchStored");
  p();
  p(`The fact is one document in the village's own config, under the key ${code(f.launch.configKey)}.`);
  p();
  say("launchEnds");
  p();

  p("## Voting weight");
  p();
  say("weightIntro");
  p();
  p(
    table(
      ["Mode", "What a member's vote weighs"],
      [
        ["`equal`", "One. One person, one vote."],
        ["`token`", "Their balance of the weight token at the moment the ballot opened, floored at zero."],
        ["`custom`", "Their row in the allocation table. An absent row is zero, which fails closed."],
      ].filter((row) => f.weights.modes.includes(row[0].replace(/`/g, ""))),
    ),
  );
  p();
  p(
    `A fresh village runs ${code(f.dials.weightMode.default)} mode with the weight token set to ` +
      `${code(f.dials.weightToken.default)}. Both dials are ${code(f.dials.weightMode.ring)} ring.`,
  );
  p();
  say("weightToken");
  p();
  say("weightTrail");
  p();
  say("twoVoices");
  p();
  say("voiceIsBuyable");
  p();

  p("## Who may do what");
  p();
  say("whoIntro");
  p();
  p(
    table(
      ["Power", "What it lets a member do", "Rung that grants it", "A badge can take it away"],
      f.capabilities.all
        .filter((c) => /^(proposal|ballot|member|mechanics|org|dial)\./.test(c))
        .map((c) => [
          code(c),
          f.capabilities.labels[c],
          f.capabilities.unlocks[c] ? code(f.capabilities.unlocks[c]) : "never by rung; a role or a badge grants it",
          f.capabilities.deniable[c] ? "yes" : "**no**",
        ]),
    ),
  );
  p();

  p("## The word steward means three things");
  p();
  say("stewardThree");
  p();
  say("stewardQuest");
  p();
  say("stewardPersona");
  p();
  say("stewardApprover");
  p();

  p("## What a village publishes");
  p();
  say("publishIntro");
  p();
  p(
    table(
      ["Method", "Path", "Who gets an answer", "Power it asks for"],
      f.routes.rows.map((r) => [r.method, code(r.path), r.door, r.capability ? code(r.capability) : "none"]),
    ),
  );
  p();
  p(
    `${f.routes.total} routes: ${f.routes.governanceCount} under the governance prefix and ${f.routes.mechanicsCount} under the ` +
      `mechanics prefix. ${f.routes.anonymous.length} of them answer a stranger, ${f.routes.withCapability.length} ask for a named power, ` +
      `and ${f.routes.undeclared.length} could not be classified from the code by this reader.`,
  );
  p();
  if (f.routes.anonymous.length) {
    p(
      "The routes that answer a stranger are the village's public record. At the module's `public` lifecycle they serve " +
        "the ballot list, one decision in full and the objection lineage to anybody on the internet, which includes each " +
        "voter's first name, their choice and their frozen weight. Ruling 22 changes that and is staged.",
    );
    p();
  }

  p("## The cycle");
  p();
  say("cycleIntro");
  p();
  p(
    table(
      ["Fact", "Value"],
      [
        ["A cycle is", "one lunation"],
        ["Mean synodic month", `${f.clock.synodicMonthDays} days`],
        ["True instants from the checked-in table, from cycle", String(f.clock.trueClockFromCycle)],
        ["Cycle id", `${code(f.clock.idPrefix + "NNNNNN")}, zero padded to ${f.clock.idDigits} digits, for example ${code(f.clock.idExample)}`],
      ],
    ),
  );
  p();
  say("cycleClose");
  p();

  p("## The bridge to the hub");
  p();
  say("bridgeIntro");
  p();
  say("bridgeHonest");
  p();
  p(
    `The hub address is ${code(f.dials.hubUrl.key)}, a ${code(f.dials.hubUrl.ring)}-ring dial that ships ` +
      `${String(f.dials.hubUrl.default) === "" ? "blank, so a fresh village has no hub and sends nowhere" : `defaulting to ${code(String(f.dials.hubUrl.default))}`}. ` +
      `Nothing is sent until a shared secret is configured beside it.`,
  );
  p();

  p("## What is broken today");
  p();
  say("brokenIntro");
  p();
  /*
   * REWRITTEN 2026-09-03. This bullet used to read "a close and its executor
   * still decide separately from the steward", which stopped being true when
   * the landing lane landed: the close route reads a seated steward's no
   * before it routes an outcome, and a carried Game change is parked with a
   * landing instant instead of applying. What is still missing is upstream of
   * all of it, so the bullet now reports that and reports it from the code.
   */
  if (f.staged.launchSeatsSteward) {
    p(
      "- **Nothing seats a catalyst as a steward.** The seat, the power, the record, the settings, the window and the " +
        "landing loop that reads them are all built. The closer that runs when the Birthing carries writes the launch " +
        "facts and nothing else: no role, no seat, no grant. So a fresh village has a veto window that nobody can use " +
        "until a steward is seated, which today is an act somebody performs by hand.",
    );
  }
  p(
    "- **A close and its executor are not one transaction.** The ballot is closed by one guarded update and the executor " +
      "runs after it. An executor that throws leaves a ballot closed and passed with nothing applied, and only the " +
      "mechanics subject has a second door to apply by hand.",
  );
  p(
    `- **${f.routes.anonymous.filter((r) => r.path.startsWith("/api/governance")).length} reads under the governance prefix answer a ` +
      "stranger**, and at the module's `public` lifecycle that means the whole voter roll with names, choices and weights " +
      "is served to the internet.",
  );
  p(
    "- **A weight in token mode is displayed in ledger units.** A holding a member reads as 0.1 weighs 100 in the tally, " +
      "and the hand-mint form takes raw units with no hint, so typing 1 for a 3-decimal token mints a thousandth.",
  );
  p(
    "- **Two tokens are called Voice**, the platform's own and the mirror of what lives on Base, and only the first can " +
      "weigh a vote. The default weight token is neither of them.",
  );
  p(
    "- **A stored reason on a no vote is shown to nobody.** The widget invites a member to say why and the reader that " +
      "serves votes drops it.",
  );
  p(
    "- **The module lifecycle is edited by hand**, so a village turns its own governance on through the admin panel and " +
      "never through a vote.",
  );
  p(
    "- **Four displays about the hub bridge are false.** The sync flag is never set true so the card always says pending, " +
      "the space check idles on every delivery, an outcome's source is hardcoded, and the card credits a hub with issuing " +
      "a secret it does not issue.",
  );
  p(
    "- **Two schema comments have drifted.** The engine's own migration lists five subject types in the column " +
      `comment where the dispatcher now executes ${f.dispatcher.all.length}, and a later migration's header names the number of the ` +
      "one before it. Neither is edited, because a shipped migration file is never edited; both are stated here " +
      "instead.",
  );
  p();

  p("## What is staged");
  p();
  say("stagedIntro");
  p();
  for (const r of RULINGS) {
    const label = r.status(f);
    if (!/Staged/.test(label)) continue;
    p(`- **${r.title}** (ruling ${r.id})`);
  }
  p();

  p("## The founder's rulings");
  p();
  say("rulingsIntro");
  p();
  say("rulingsQuoteNote");
  p();
  for (const r of RULINGS) {
    p(`### ${r.id}. ${r.title}`);
    p();
    p(`${r.status(f)} ${statusIsStated(r) ? "Status stated by a person; the code cannot answer this one." : "Status computed from the code."} Said ${r.dates.join(" and ")}.`);
    p();
    for (const q of r.quotes) {
      quote(q);
      p();
    }
    p(`<!-- written by a person: ruling-${r.id} -->`);
    p(r.note(f));
    p();
  }

  p("## What was withdrawn");
  p();
  say("withdrawnIntro");
  p();
  for (const w of WITHDRAWN) {
    p(`- ~~${w.what}~~`);
    p(`  Withdrawn ${w.on} by ${w.by}. ${w.now}`);
  }
  p();

  lineage(p, say, sayUnder);

  p("## Machine-readable");
  p();
  say("machineIntro");
  p();
  p("```json");
  p(
    JSON.stringify(
      {
        commit: f.commit,
        module: {
          id: f.module.id,
          shipsAs: "off",
          lifecycles: f.module.lifecycles,
          apiPrefixes: f.module.apiPrefixes,
          capabilities: f.module.capabilities,
          variableKeys: f.module.variableKeys,
        },
        engine: {
          methods: f.engine.methods,
          voteChoices: f.engine.choices,
          outcomes: f.engine.outcomes,
          ballotStatuses: f.statuses,
          unityStampedByMethod: f.engine.presets,
          // The default, which a subject may override. Read the per-subject
          // `abstainPolicy` below before believing either of these about a
          // particular ballot.
          abstainCountsTowardQuorumByDefault: true,
          abstainCountsTowardUnityByDefault: false,
        },
        subjects: f.subjects.map((s) => ({
          subjectType: s.subject,
          // A floor of null means this subject states no floor of its own and
          // takes the one its criticality tier sets. JSON drops an undefined
          // value and would have dropped the key with it, which reads as a
          // subject that forgot to have a floor.
          minUnityPct: s.minUnityPct ?? null,
          minQuorumPct: s.minQuorumPct ?? null,
          minElectorate: s.minElectorate ?? null,
          everySeatWeighs: !!s.everySeatWeighs,
          method: s.method ?? null,
          criticality: s.criticality ?? null,
          abstainPolicy: s.abstainPolicy ?? null,
          minYesHeads: s.minYesHeads ?? null,
          executesAtClose: s.executes,
          why: s.why ?? null,
        })),
        executingSubjectTypes: f.dispatcher.all,
        dials: f.dials.all.map((d) => ({
          key: d.key,
          label: d.label,
          ring: d.ring,
          type: d.type,
          default: d.default ?? null,
          min: d.min ?? null,
          max: d.max ?? null,
          choices: d.choices ? d.choices.map((c) => c.value) : null,
          applyTiming: d.applyTiming,
        })),
        cycleApplyKeys: f.cycleApplyKeys,
        weightModes: f.weights.modes,
        changeSetMaxEntries: f.changeSet.maxChanges,
        wizard: {
          types: f.wizard.server,
          conductable: f.wizard.conductable,
          advisory: f.wizard.advisory,
          clientAgrees: f.wizard.server.join("|") === f.wizard.client.join("|"),
        },
        capabilities: f.capabilities.all
          .filter((c) => /^(proposal|ballot|member|mechanics|org|dial)\./.test(c))
          .map((c) => ({
            key: c,
            label: f.capabilities.labels[c],
            unlocksAtStage: f.capabilities.unlocks[c] ?? null,
            deniableByBadge: f.capabilities.deniable[c],
          })),
        routes: f.routes.rows.map((r) => ({
          method: r.method,
          path: r.path,
          door: r.door,
          capability: r.capability,
          file: r.file,
        })),
        cycle: {
          kind: "lunar",
          synodicMonthDays: f.clock.synodicMonthDays,
          trueClockFromCycle: f.clock.trueClockFromCycle,
          idFormat: `${f.clock.idPrefix}${"N".repeat(f.clock.idDigits)}`,
        },
        launch: { configKey: f.launch.configKey, issuanceRefusedUntilStarted: true },
        kinds: {
          values: f.kinds.kinds,
          timings: f.kinds.timings,
          defaultTiming: f.kinds.defaultTiming,
          defaultTimingByKind: f.kinds.defaultsByKind,
          bySubjectType: f.kinds.forSubject,
          byChangeSetItem: f.kinds.forItem,
          // Anything absent from either map. Written out so a parser does not
          // have to infer it from two lists that do not cover the space.
          absentMeans: "game_change",
          executesAtPassWithNoWindow: f.kinds.noWindowSubjects,
          vetoHoursFloor: f.kinds.vetoHoursFloor,
        },
        quorum: {
          countsWeightFields: f.quorumFormula.weightFields,
          countsHeadFields: f.quorumFormula.headFields,
          dividesByTotalWeight: f.quorumFormula.dividesByTotalWeight,
          weightOnly: f.quorumFormula.weightOnly,
        },
        windows: f.windows.map((d) => ({ key: d.key, label: d.label, default: d.default ?? null })),
        schema: f.schema.shapes,
        withdrawn: WITHDRAWN.map((w) => ({ what: w.what, withdrawnOn: w.on, withdrawnBy: w.by, now: w.now })),
        sources: LINEAGE_SOURCES.map((sr) => ({ title: sr.title, url: sr.url, localCopy: sr.copy })),
        rulings: RULINGS.map((r) => ({
          id: r.id,
          title: r.title,
          dates: r.dates,
          status: r.status(f).replace(/\*/g, "").trim(),
          statusBasis: statusIsStated(r) ? "stated" : "computed",
        })),
      },
      null,
      2,
    ),
  );
  p("```");
  p();

  p("## The tables this rests on");
  p();
  say("schemaIntro");
  p();
  p(
    table(
      ["Table or column", "What it holds"],
      // Most names are a table or a column and render as code. Two of them
      // name a set of enum values, and wrapping an English phrase in backticks
      // reads as an identifier a reader would then go looking for.
      f.schema.shapes.map((sh) => [/^[a-z_]+(\.[a-z_]+)?$/.test(sh.name) ? code(sh.name) : sh.name, sh.what]),
    ),
  );
  p();
  p(`Checked against the ${f.schema.migrationCount} migration files in \`${MIGRATION_DIR}/\`.`);
  p();

  p("## What this file is made from");
  p();
  say("madeFromIntro");
  p();
  for (const rel of SOURCES) p(`- ${code(rel)}`);
  p();
  say("madeFromReaders");
  p();
  say("madeFromCommit");
  p();
  say("madeFromTest");
  p();

  const text = L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  const gap = proseCoverageProblem(text);
  if (gap) fail(gap.replace(/^governance-doc: /, ""));
  return text;
}

/**
 * MAIA'S SHELF GETS THE SAME SECTION.
 *
 * 19F asks that the assistant be able to answer "where does this come from",
 * so `docs/knowledge/governance-lineage.md` carries the lineage the document
 * carries. It is rendered from the same `lineage()` and the same PROSE entries,
 * because two hand-kept copies of one section are two sections that drift, and
 * this one is loaded into a prompt where nobody would notice the drift.
 *
 * The shelf indexes SECTIONS split on `##`, so the headings here are what a
 * question about the sources actually matches on.
 */
export function renderLineage(f) {
  const L = [];
  const p = (s = "") => L.push(s);
  const say = (key) => {
    const text = PROSE[key];
    if (!text) fail(`renderLineage() asked for the prose entry "${key}", which PROSE does not hold`);
    p(`<!-- written by a person: ${key} -->`);
    p(text);
  };
  const sayUnder = (key) => {
    const text = PROSE[key];
    if (!text) fail(`renderLineage() asked for the prose entry "${key}", which PROSE does not hold`);
    p(`  <!-- written by a person: ${key} -->`);
    p(`  ${text}`);
  };

  p("# Where this village's governance comes from");
  p();
  p(
    "This is the lineage of the rules in `docs/GOVERNANCE.md`: the three sources the Game's dials descend from, and " +
      "the record of the rulings that shaped them. It is generated by `scripts/generate-governance-doc.mjs` beside that " +
      "document, from the same words, so the shelf and the document cannot come apart. Editing it by hand does not hold.",
  );
  p();
  p(`It describes the code at commit \`${f.commit}\`.`);
  p();
  lineage(p, say, sayUnder);
  p("## What the rules themselves say");
  p();
  p(
    "`docs/GOVERNANCE.md` is the generated description of how a village decides: what a decision is, how a vote is " +
      "counted, what each kind of decision asks, what happens when one carries, and which of the rulings behind all of " +
      "that are built today. Read it first and read this for where it came from.",
  );
  p();
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function generate(root = ROOT) {
  return render(collectFacts(root));
}

/** The document and the facts behind it, for callers that report on both. */
export function generateDetailed(root = ROOT) {
  const facts = collectFacts(root);
  return { text: render(facts), lineage: renderLineage(facts), facts };
}

export { PROSE, RULINGS, SUBJECT_WORDS, KNOWN_DIALS, WITHDRAWN, LINEAGE_SOURCES, SCHEMA_SHAPES };

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

if (invokedDirectly) {
  try {
    const { text, lineage: shelf } = generateDetailed();
    if (process.argv.includes("--stdout")) {
      process.stdout.write(text);
    } else {
      fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
      fs.writeFileSync(DOC_PATH, text, "utf8");
      fs.mkdirSync(path.dirname(LINEAGE_PATH), { recursive: true });
      fs.writeFileSync(LINEAGE_PATH, shelf, "utf8");
      process.stdout.write(
        `wrote docs/GOVERNANCE.md (${text.split("\n").length} lines) and ` +
          `docs/knowledge/governance-lineage.md (${shelf.split("\n").length} lines)\n`,
      );
    }
  } catch (err) {
    process.stderr.write(`\n${err instanceof ReadError ? err.message : err?.stack ?? String(err)}\n\n`);
    process.exit(1);
  }
}
