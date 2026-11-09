#!/usr/bin/env node
/**
 * Hardcoded English ratchet (internal spec i18n, US6.1; §8 R13, R14).
 *
 * Every user-facing string goes through Lingui (`<Trans>`, `t`, `msg`) so it
 * can be translated. This counts, per file, the English that does not, and
 * fails when any file's count rises above its committed baseline. Old strings
 * never block anyone; only NEW untranslated English does. The extraction PRs
 * bring files down, and `--update-baseline` only ever lowers.
 *
 * WHAT COUNTS, one per sentence:
 *   jsx-text        JSX text with a letter in it, once per element (a sentence
 *                   split by `{name}` is one sentence, not two)
 *   prop            a literal in a copy prop (placeholder, title, aria-label,
 *                   alt, label, ...), a template sentence counted once
 *   call            the first argument of toast*, confirm, alert, prompt
 *   plural-hack     `n === 1 ? "" : "s"`: English-only plurals
 *   module-scope-t  `t` at module scope, evaluated once at import, so it never
 *                   switches language (use `msg` and render with i18n._)
 * Exempt: anything inside a Lingui macro, matched by IMPORT BINDING (a Trans
 * from anywhere else gets no exemption), and a hit with `i18n-ok: <reason>`
 * on its line or the line above.
 *
 * WHAT IT DOES NOT SEE (say so, rather than claim coverage):
 *   - string constants defined in one place and rendered in another (a nav
 *     table's `label: "About"` counts nowhere here); the extraction PRs move
 *     them to `msg`;
 *   - server-sent text, emails and notifications (P2 and P3);
 *   - village wording defaults in shared/pageContent and shared/comms, which
 *     are village-editable text, translated per village (P3), not Lingui
 *     messages.
 *
 *   node scripts/check-i18n-ratchet.mjs                          # check
 *   node scripts/check-i18n-ratchet.mjs --update-baseline        # lower only
 *   node scripts/check-i18n-ratchet.mjs --update-baseline --force
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ROOT = path.resolve(arg("--root") ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const BASELINE_PATH = path.join(ROOT, "scripts", "i18n-ratchet-baseline.json");
const SCAN = ["client/src"];

const LINGUI_MODULES = new Set(["@lingui/react/macro", "@lingui/core/macro", "@lingui/macro", "@lingui/react"]);
const COPY_PROPS = new Set([
  "placeholder", "title", "alt", "label", "description", "aria-label", "aria-description",
  "aria-placeholder", "aria-valuetext", "aria-roledescription", "tooltip", "helperText", "emptyText",
]);
const CALLS = new Set(["toast", "alert", "confirm", "prompt"]);
const LETTER = /[A-Za-z]/;

function isStringish(n) {
  return ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);
}
function textOf(n) {
  if (ts.isTemplateExpression(n)) return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" ");
  return n.text;
}
function isFunctionLike(n) {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
}

/** The copy in one source file that bypasses Lingui. */
export function copyHits(text, fileName) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = text.split("\n");
  const lingui = new Set();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && LINGUI_MODULES.has(st.moduleSpecifier.text)) {
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) lingui.add(el.name.text);
    }
  }
  const isLinguiName = (n) => n && ts.isIdentifier(n) && lingui.has(n.text);
  const isMacro = (n) =>
    (ts.isJsxElement(n) && isLinguiName(n.openingElement.tagName)) ||
    (ts.isJsxSelfClosingElement(n) && isLinguiName(n.tagName)) ||
    (ts.isTaggedTemplateExpression(n) && (isLinguiName(n.tag) || (ts.isPropertyAccessExpression(n.tag) && n.tag.name.text === "t"))) ||
    (ts.isCallExpression(n) && isLinguiName(n.expression));
  // `const { t } = useLingui()` binds `t` locally; it is Lingui's only when useLingui is.
  const tFromUseLingui = (n) => lingui.has("useLingui") && ts.isTaggedTemplateExpression(n) && ts.isIdentifier(n.tag) && n.tag.text === "t";

  const hits = [];
  const waived = (node) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    return /i18n-ok:/.test(lines[line] ?? "") || /i18n-ok:/.test(lines[line - 1] ?? "");
  };
  const hit = (node, kind, snippet) => {
    if (waived(node)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    hits.push({ kind, line, text: String(snippet).replace(/\s+/g, " ").trim().slice(0, 60) });
  };
  const seenElements = new Set();

  const visit = (node, inMacro, inFunction) => {
    if (isMacro(node)) {
      // A Lingui `t` with no enclosing function runs once, at import.
      const isT = ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === "t" && lingui.has("t");
      if (isT && !inFunction) hit(node, "module-scope-t", node.getText(sf));
      inMacro = true;
    } else if (tFromUseLingui(node)) {
      inMacro = true;
    }
    if (!inMacro) {
      if (ts.isJsxText(node) && LETTER.test(node.text)) {
        const owner = node.parent;
        if (!seenElements.has(owner)) {
          seenElements.add(owner);
          hit(node, "jsx-text", node.text);
        }
      } else if (ts.isJsxAttribute(node) && COPY_PROPS.has(node.name.getText(sf)) && node.initializer) {
        const init = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
        const branches = init && ts.isConditionalExpression(init) ? [init.whenTrue, init.whenFalse] : [init];
        if (branches.some((b) => b && isStringish(b) && LETTER.test(textOf(b)))) {
          hit(node, "prop", node.getText(sf));
          return;
        }
      } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? ts.isIdentifier(callee.expression) && (callee.expression.text === "toast" || callee.expression.text === "window")
              ? callee.expression.text === "toast" ? "toast" : callee.name.text
              : null
            : null;
        const first = node.arguments[0];
        if (name && CALLS.has(name) && isStringish(first) && LETTER.test(textOf(first))) hit(node, "call", first.getText(sf));
      } else if (ts.isConditionalExpression(node)) {
        const lit = (n) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null);
        const a = lit(node.whenTrue);
        const b = lit(node.whenFalse);
        const pair = [a, b].sort().join("|");
        if ((pair === "|s" || pair === "|es") && /[!=]==?\s*1\b/.test(node.condition.getText(sf))) hit(node, "plural-hack", node.getText(sf));
      }
    }
    ts.forEachChild(node, (child) => visit(child, inMacro, inFunction || isFunctionLike(node)));
  };
  visit(sf, false, false);
  return hits;
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__" || e.name === "test" || e.name === "locales") continue;
      walk(p, out);
    } else if (/\.(tsx?)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

export function measure(root = ROOT) {
  const counts = {};
  const details = {};
  for (const rel of SCAN) {
    for (const file of walk(path.join(root, rel), [])) {
      const key = path.relative(root, file).split(path.sep).join("/");
      const hits = copyHits(fs.readFileSync(file, "utf8"), file);
      if (hits.length) {
        counts[key] = hits.length;
        details[key] = hits;
      }
    }
  }
  return { counts, details };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { counts, details } = measure();
  const baseline = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) : {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rises = Object.keys(counts).filter((f) => counts[f] > (baseline[f] ?? 0)).sort();

  if (process.argv.includes("--update-baseline")) {
    if (rises.length && !process.argv.includes("--force")) {
      console.error("::error::--update-baseline only lowers. These files rose; wrap the new strings in Lingui, or rerun with --force if a raise is deliberate:");
      for (const f of rises) console.error(`  ${f}: ${baseline[f] ?? 0} -> ${counts[f]}`);
      process.exit(1);
    }
    const sorted = Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]]));
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + "\n");
    console.log(`i18n ratchet baseline written: ${Object.keys(sorted).length} file(s), ${total} untranslated string(s).`);
    process.exit(0);
  }

  if (rises.length) {
    console.error(`::error::New hardcoded English in ${rises.length} file(s). Wrap it with <Trans>, t or msg from @lingui/react/macro (spec i18n US6.1):`);
    for (const f of rises) {
      console.error(`  ${f}: ${baseline[f] ?? 0} -> ${counts[f]}`);
      for (const h of details[f]) console.error(`    ${f}:${h.line}  ${h.kind}  ${h.text}`);
    }
    process.exit(1);
  }
  const falls = Object.keys(baseline).filter((f) => (counts[f] ?? 0) < baseline[f]);
  console.log(`i18n ratchet passed. ${total} untranslated string(s) in ${Object.keys(counts).length} file(s), none above baseline.`);
  if (falls.length) console.log(`  ${falls.length} file(s) fell below their baseline; lower it with --update-baseline.`);
}
