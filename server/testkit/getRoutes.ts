/**
 * EVERY GET ROUTE THE SERVER REGISTERS, READ FROM THE SOURCE, for tests only.
 *
 * The anonymous PII walker (server/anonymousPii.routes.e2e.test.ts) calls
 * every route a signed-out visitor can reach and reads what comes back. A
 * hand-typed list of those routes would go stale the first time somebody
 * added one, and a walker that silently misses a route reports the village
 * as private. So the list is derived: `server/index.ts` and every module in
 * `server/routes/` are parsed with the TypeScript compiler and each
 * `app.get(<path>, ...)` call is read.
 *
 * WHAT THE PATH MAY BE. A string literal, a template literal, a constant that
 * holds one (in the same file or imported from a relative module, one hop at
 * a time), a `+` of those, an object property holding one, or an array of
 * any of them. Anything else is returned in `unresolved` with its file and
 * line rather than dropped, because a reader's blind spot has to announce
 * itself: the walker fails on a non-empty `unresolved`.
 *
 * WHY STATIC AND NOT THE LIVE ROUTER. The e2e suites boot the BUILT bundle as
 * a child process, so the test cannot reach the Express router stack, and
 * adding a route-listing endpoint to the product for a test would be a door a
 * stranger could knock on too.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface DerivedRoute {
  path: string;
  file: string;
  line: number;
}

export interface UnresolvedRoute {
  file: string;
  line: number;
  text: string;
}

const files = new Map<string, ts.SourceFile>();

function sourceFile(abs: string): ts.SourceFile {
  let sf = files.get(abs);
  if (!sf) {
    sf = ts.createSourceFile(abs, fs.readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
    files.set(abs, sf);
  }
  return sf;
}

function walk(node: ts.Node, fn: (n: ts.Node) => void): void {
  node.forEachChild((child) => {
    fn(child);
    walk(child, fn);
  });
}

/** `const NAME = <init>` anywhere in the file, including inside `register()`. */
function constIn(abs: string, name: string): ts.Expression | null {
  let found: ts.Expression | null = null;
  walk(sourceFile(abs), (n) => {
    if (found) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
      found = n.initializer;
    }
  });
  return found;
}

/** Where a named import comes from, when it is a relative module. */
function importOf(abs: string, name: string): { abs: string; exported: string } | null {
  for (const stmt of sourceFile(abs).statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if (el.name.text !== name) continue;
      const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
      if (!spec.startsWith(".")) return null;
      const base = path.resolve(path.dirname(abs), spec);
      const target = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((p) => fs.existsSync(p));
      return target ? { abs: target, exported: el.propertyName?.text ?? el.name.text } : null;
    }
  }
  return null;
}

/** The string(s) an expression stands for, or null when this reader cannot tell. */
function resolve(node: ts.Expression, abs: string, depth = 0): string[] | null {
  if (depth > 8) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return resolve(node.expression, abs, depth + 1);
  }
  if (ts.isArrayLiteralExpression(node)) {
    const out: string[] = [];
    for (const el of node.elements) {
      const r = resolve(el as ts.Expression, abs, depth + 1);
      if (!r) return null;
      out.push(...r);
    }
    return out;
  }
  if (ts.isTemplateExpression(node)) {
    let acc = [node.head.text];
    for (const span of node.templateSpans) {
      const r = resolve(span.expression, abs, depth + 1);
      if (!r) return null;
      acc = acc.flatMap((a) => r.map((x) => a + x + span.literal.text));
    }
    return acc;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = resolve(node.left, abs, depth + 1);
    const r = resolve(node.right, abs, depth + 1);
    if (!l || !r) return null;
    return l.flatMap((a) => r.map((b) => a + b));
  }
  if (ts.isIdentifier(node)) {
    const local = constIn(abs, node.text);
    if (local) return resolve(local, abs, depth + 1);
    const imported = importOf(abs, node.text);
    if (!imported) return null;
    const init = constIn(imported.abs, imported.exported);
    return init ? resolve(init, imported.abs, depth + 1) : null;
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const holder =
      constIn(abs, node.expression.text) ??
      (() => {
        const imp = importOf(abs, node.expression.text);
        return imp ? constIn(imp.abs, imp.exported) : null;
      })();
    let obj = holder;
    while (obj && (ts.isAsExpression(obj) || ts.isParenthesizedExpression(obj) || ts.isSatisfiesExpression(obj))) obj = obj.expression;
    if (!obj || !ts.isObjectLiteralExpression(obj)) return null;
    for (const prop of obj.properties) {
      if (ts.isPropertyAssignment(prop) && prop.name.getText() === node.name.text) {
        return resolve(prop.initializer, abs, depth + 1);
      }
    }
    return null;
  }
  return null;
}

/**
 * Every `app.get(path, handler)` in `server/index.ts` and `server/routes/*.ts`
 * (tests excluded), with the source line, plus every registration whose path
 * this reader could not read.
 */
export function deriveGetRoutes(root: string): { routes: DerivedRoute[]; unresolved: UnresolvedRoute[] } {
  const routeDir = path.join(root, "server", "routes");
  const rels = [
    "server/index.ts",
    ...fs
      .readdirSync(routeDir)
      .filter((n) => n.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(n))
      .sort()
      .map((n) => `server/routes/${n}`),
  ];
  const routes: DerivedRoute[] = [];
  const unresolved: UnresolvedRoute[] = [];
  for (const rel of rels) {
    const abs = path.join(root, rel);
    const sf = sourceFile(abs);
    walk(sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      const callee = n.expression;
      if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "get") return;
      if (!ts.isIdentifier(callee.expression) || callee.expression.text !== "app") return;
      // `app.get("setting")` with one argument reads an Express setting, never a route.
      if (n.arguments.length < 2) return;
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      const paths = resolve(n.arguments[0], abs);
      if (!paths) {
        unresolved.push({ file: rel, line, text: n.arguments[0].getText().slice(0, 120) });
        return;
      }
      for (const p of paths) routes.push({ path: p, file: rel, line });
    });
  }
  return { routes, unresolved };
}
