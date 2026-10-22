#!/usr/bin/env node
/**
 * THE TYPED-PAYOUT GUARD: no page states a payout figure it did not read from data.
 *
 * WHY THIS EXISTS. The Co-Creators Guide said quests paid "40-300" Gratitude and
 * circle roles "200-500/month", typed into the page (Rye found it, 2026-10-21).
 * Nothing in the platform paid either. A payout is a promise, and a promise
 * typed into copy goes stale the day a village changes a value, or was never
 * true at all. Since 0265 every quest and role carries its own value and token
 * amounts, and every card reads them through `pay` (server/lib/workPay.ts). This
 * keeps the next page from typing its own.
 *
 * WHAT IT READS. Real copy only, the same way the voice guard does: JSX text and
 * string or template literals in `client/src`, parsed with the TypeScript
 * compiler, so comments, identifiers and class names are invisible to it. Tests
 * are exempt; they describe behaviour to developers.
 *
 * WHAT COUNTS AS A TYPED PAYOUT. A figure, or a range of figures, directly
 * followed by a token or a pay period:
 *
 *   "40-300 ${tokenName}"     a number in front of an interpolated token name
 *   "200-500/month"           a range per a period
 *   "25 Village Credits"      a number in front of a token's own name
 *
 * A figure that is interpolated (`${amount} ${name}`) is data and passes. A
 * genuine example that is not a promise, a worked example in an explainer, takes
 * an inline `payout-ok: <reason>` on the line, and waivers are counted and
 * printed so they stay honest.
 *
 * WHAT IT CANNOT SEE, said plainly. A figure spelled in words ("forty"), a
 * figure split across two literals, a figure in server copy, and a figure an
 * admin types into a content document at runtime. It holds the shipped client.
 *
 * Usage: node scripts/check-typed-payouts.mjs [--list]
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = path.join(ROOT, "client", "src");
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);
const isTest = (rel) => /\.(test|spec)\.tsx?$/.test(rel) || rel.includes("__tests__");

/** Attributes whose values are machinery, never a sentence somebody reads. */
const NON_COPY_KEYS = new Set([
  "className", "class", "style", "id", "key", "href", "src", "to", "path", "type", "name",
  "slug", "variant", "size", "color", "fill", "stroke", "icon", "role", "data-testid",
  "inputMode", "pattern", "viewBox", "d", "points", "transform", "x", "y", "width", "height",
]);

const NUM = String.raw`\d[\d,.]*`;
const RANGE = String.raw`${NUM}(?:\s*(?:-|to)\s*${NUM})?`;
const TOKEN_WORDS = String.raw`(?:\$\{\s*(?:tokenName|currencyName|recognitionName|valueName)\s*\}|Gratitude\b|Village Credits\b|Village Voice\b|Village Equity\b)`;

export const RULES = [
  { id: "range-per-period", re: new RegExp(String.raw`(?<![\w$])${NUM}\s*(?:-|to)\s*${NUM}\s*\/\s*(?:month|moon|cycle|week|season)\b`, "i") },
  { id: "figure-and-token", re: new RegExp(String.raw`(?<![\w$.{])${RANGE}\s+${TOKEN_WORDS}`, "i") },
];

/** The first rule a piece of copy breaks, or null. */
export function typedPayout(text) {
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (m) return { rule: r.id, match: m[0] };
  }
  return null;
}

function ownerKey(node) {
  const parent = node.parent;
  if (!parent) return null;
  if (ts.isJsxAttribute(parent)) return parent.name.getText();
  if (ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent)) return parent.parent.name.getText();
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) return parent.name.getText().replace(/['"]/g, "");
  return null;
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out);
    } else if (/\.tsx?$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

/** Every typed payout in one source text, with the waivers it carries. */
export function scan(fileName, src) {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = src.split(/\r?\n/);
  const found = [];
  const waived = [];
  const visit = (node) => {
    const copy =
      ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
    if (copy) {
      const isImport = node.parent && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent));
      const key = ownerKey(node);
      if (!isImport && !(key && NON_COPY_KEYS.has(key))) {
        const hit = typedPayout(node.getText());
        if (hit) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart()).line;
          const entry = { line: line + 1, ...hit };
          if (/payout-ok:/.test(lines[line] ?? "")) waived.push(entry);
          else found.push(entry);
        }
      }
      if (ts.isTemplateExpression(node)) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { found, waived };
}

const isMain = (() => {
  try {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
})();

if (isMain) {
  const files = walk(SCAN, []).filter((f) => !isTest(path.relative(ROOT, f)));
  const problems = [];
  let waivers = 0;
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join("/");
    const { found, waived } = scan(f, fs.readFileSync(f, "utf8"));
    waivers += waived.length;
    for (const p of found) problems.push(`  ${rel}:${p.line}  ${JSON.stringify(p.match)}  (${p.rule})`);
  }
  if (problems.length) {
    console.error(`Typed payout guard FAILED. ${problems.length} figure(s) in copy that state a payout the page did not read:\n`);
    console.error(problems.join("\n"));
    console.error(
      "\nA payout is read from the work it describes: a quest's or a role's `pay` (server/lib/workPay.ts)," +
        "\nor a summary of them (`paySummary` in client/src/lib/workPay.ts). If this is a worked example and" +
        "\nnot a promise, say so on the line with `payout-ok: <reason>`.",
    );
    process.exit(1);
  }
  console.log(`Typed payout guard passed. ${files.length} client file(s) read, ${waivers} waiver(s).`);
}
