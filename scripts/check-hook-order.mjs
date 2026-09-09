/**
 * NO REACT HOOK MAY BE CALLED AFTER AN EARLY RETURN.
 *
 * ── WHY THIS SCRIPT EXISTS ──────────────────────────────────────────────────
 *
 * This repository has no eslint, so it has no `react-hooks/rules-of-hooks`,
 * and on 2026-09-07 a hook shipped to production below two guards in
 * `client/src/pages/Profile.tsx`. React counts hooks per render: a hook that
 * runs on some renders and not others changes the count and the component
 * throws "Rendered more hooks than during the previous render".
 *
 * It survived every gate, the whole test suite, and a live QA pass at two
 * viewports, for a reason worth writing down. The route is LAZY, so on an
 * ordinary load the chunk usually arrives after auth has already resolved and
 * the very first render runs the hook; the deterministic break is SIGN OUT,
 * where the member goes null, the guard returns, the hook count drops and the
 * profile throws on the way out. No pass that never signs out can see it, and
 * ours never did.
 *
 * A whole eslint setup would also catch it. This is one file, has no
 * dependencies beyond the TypeScript the repo already ships, runs in under a
 * second, and refuses exactly one thing. When eslint arrives, delete it.
 *
 * ── WHAT IT LOOKS AT ────────────────────────────────────────────────────────
 *
 * Every function whose name is a component (`PascalCase`) or a hook (`useX`),
 * in `client/src`. Inside one, it finds the first `return` that is CONDITIONAL
 * (nested inside an `if`, `&&`, loop or `try` rather than being the function's
 * own last statement), and then reports any `use*()` call that appears after
 * it and still inside that function.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 *
 * It does not check hooks inside conditions (`if (x) useEffect(...)`) or loops.
 * Those are equally illegal and equally worth catching, and they have never
 * happened here; a rule that fires only on the shape that has actually cost a
 * day is a rule people keep. It also cannot see a hook called through an alias
 * or a variable, and it says so here rather than pretending otherwise.
 *
 * A genuine false positive takes an inline `hook-order-ok: <reason>` on the
 * line; waivers are counted and printed so they stay honest.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = path.join(ROOT, "client", "src");
const WAIVER = /hook-order-ok:/;

/** Every .ts/.tsx under client/src, tests included: a test can hold a component. */
function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const isHookName = (n) => /^use[A-Z]/.test(n);
const isComponentOrHook = (n) => !!n && (/^[A-Z]/.test(n) || isHookName(n));

/** The name a function is known by, however it was declared. */
function nameOf(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  return null;
}

/**
 * The position of the first CONDITIONAL return inside this body.
 *
 * A function's own trailing `return <JSX/>` is not one: nothing follows it, so
 * it can gate nothing. A return nested in anything at all can.
 */
function firstConditionalReturn(body) {
  let found = null;
  const walk = (node, nested) => {
    if (found !== null) return;
    if (ts.isReturnStatement(node) && nested) {
      found = node.getStart();
      return;
    }
    // A nested function has its own rules; its returns do not gate this one.
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isClassDeclaration(node)
    ) {
      return;
    }
    ts.forEachChild(node, (c) => walk(c, nested || node !== body));
  };
  ts.forEachChild(body, (c) => walk(c, false));
  return found;
}

/** Every `useSomething(...)` call inside this function, excluding nested ones. */
function hookCalls(body) {
  const calls = [];
  const walk = (node) => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isClassDeclaration(node)
    ) {
      return;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && isHookName(node.expression.text)) {
      calls.push({ name: node.expression.text, pos: node.getStart() });
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(body, walk);
  return calls;
}

const problems = [];
let waived = 0;
let scanned = 0;
let checked = 0;

for (const file of files(SCAN)) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  scanned++;

  const visit = (node) => {
    const fn =
      ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ? node : null;
    if (fn && fn.body && ts.isBlock(fn.body) && isComponentOrHook(nameOf(fn))) {
      checked++;
      const guard = firstConditionalReturn(fn.body);
      if (guard !== null) {
        for (const call of hookCalls(fn.body)) {
          if (call.pos <= guard) continue;
          const { line } = sf.getLineAndCharacterOfPosition(call.pos);
          if (WAIVER.test(src.split(/\r?\n/)[line] ?? "")) {
            waived++;
            continue;
          }
          const guardLine = sf.getLineAndCharacterOfPosition(guard).line + 1;
          problems.push({
            file: path.relative(ROOT, file).replace(/\\/g, "/"),
            line: line + 1,
            fn: nameOf(fn),
            hook: call.name,
            guardLine,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (problems.length > 0) {
  console.log(
    `Hook order: ${problems.length} hook call(s) sit after an early return, in ${new Set(problems.map((p) => p.file)).size} file(s).\n`,
  );
  for (const p of problems) {
    console.log(`  ${p.file}:${p.line}  ${p.hook}() in ${p.fn}(), below the return on line ${p.guardLine}`);
  }
  console.log(
    "\nReact counts hooks per render. A hook below a guard runs on some renders and not",
  );
  console.log(
    "others, the count changes, and the component throws. Move it above every return, or",
  );
  console.log("write `hook-order-ok: <reason>` on the line if this is genuinely unreachable.");
  process.exit(1);
}

console.log(
  `Hook order: clean. ${checked} component(s) and hook(s) across ${scanned} file(s); ${waived} waiver(s).`,
);
