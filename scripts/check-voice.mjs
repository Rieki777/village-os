#!/usr/bin/env node
/**
 * The voice guard: shipped language follows the house writing rules.
 *
 * The rules come from the Rye Voice Profile (second-brain/90 Voice Profile).
 * They apply to language a member reads, so this script parses each file with
 * the TypeScript compiler and looks only at real copy: JSX text and string or
 * template literals. Comments, identifiers, imports and className soup are
 * invisible to it, which is why it can be a hard gate instead of a warning.
 *
 * Seed JSON is copy too. `server/seeds/**.json` lands in the database on a
 * fresh deployment's first boot and becomes the page copy, quest cards and
 * standing examples every fork reads, so its string VALUES are checked the
 * same way. Keys are machinery and are never read. `data/` is deliberately
 * NOT scanned: it is the runtime volume, so its contents are whatever an
 * admin last typed, and a gate has no business failing on that.
 *
 * `docs/knowledge/*.md` is checked too. It is the corpus Maia loads at boot
 * and reasons from, so her answers inherit its register: it is site language
 * that happens to be written in markdown. Only the hard rules apply there.
 * Every other doc under `docs/` is for developers and is left alone.
 *
 *   1. No em-dashes or en-dashes. A comma, a period, a colon, or a rewrite.
 *      Hyphens are fine.
 *   2. No contrast framing. State what a thing is.
 *   3. No AI filler vocabulary.
 *   4. No rhetorical-question openers used as filler.
 *   5. No passive inspiration. Say something specific.
 *
 * A genuine false positive takes an inline `voice-ok: <reason>` on the line.
 * Waivers are counted and printed so they stay honest.
 *
 * Usage: node scripts/check-voice.mjs [--json] [path ...]
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
);

/**
 * True only when this file is the entry point (`node check-voice.mjs`), not
 * when it is imported for its rule-matcher and scope constants (the
 * self-test, `check-voice.test.mjs`). Without this guard, importing the
 * module for `checkSpan`/`isTest`/`SCAN_ROOTS` would also run the full CLI:
 * walk the real repo and call `process.exit()`, before the importer's own
 * code ever ran.
 */
const isMain = (() => {
  try {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
})();

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".vite",
  "attached_assets", "data", "drizzle", "patches",
]);

export const SCAN_ROOTS = ["client/src", "server", "shared", "docs/knowledge"];

/**
 * JSON string values that are machinery, never prose: ids, routes, icon names,
 * enum-ish status words. Matched against the KEY the value sits under.
 */
const NON_COPY_JSON_KEYS = new Set([
  "id", "key", "slug", "icon", "status", "url", "href", "src", "path",
  "type", "kind", "circleId", "parentCircleId", "tokenSlug", "value",
  "color", "colour", "image", "date", "createdAt", "updatedAt", "email",
]);

/** Tests describe behaviour to developers; they are not shipped language. */
export const isTest = (rel) => /\.(test|spec)\.tsx?$/.test(rel) || rel.includes("__tests__");

/**
 * Attributes and properties whose string values are machinery, never prose:
 * class soup, routes, ids, icon names, colour tokens.
 */
const NON_COPY_KEYS = new Set([
  "className", "class", "style", "id", "key", "href", "src", "to", "path",
  "type", "name", "slug", "variant", "size", "color", "colour", "fill",
  "stroke", "icon", "role", "testId", "data-testid", "value", "kind",
  "target", "rel", "method", "accept", "autoComplete", "inputMode",
  "pattern", "font", "fontFamily", "tag", "code", "event", "action",
]);

export const AI_WORDS = [
  "delve", "tapestry", "foster", "leverage", "vibrant", "crucial",
  "groundbreaking", "transformative", "testament to", "beacon", "unleash",
  "seamless", "robust", "comprehensive", "cutting-edge", "empower",
  "utilize", "in conclusion", "it's worth noting", "embark on", "delves",
];

export const CONTRAST = [
  /\bnot just .{1,60}? but\b/i,
  /\bnot only .{1,60}? but\b/i,
  /\bisn'?t about .{1,60}?,? it'?s\b/i,
  /\bis not .{1,60}?,? (?:it'?s|but)\b/i,
  /\bless .{1,40}?, more\b/i,
  /\brather than\b/i,
  /\bnot .{1,40}?, but\b/i,
];

export const PASSIVE = [
  /\bjoin us on\b/i, /\bbe part of something\b/i, /\bjourney together\b/i,
  /\bcome along on\b/i, /\bpart of the journey\b/i, /\btogether we can\b/i,
];

export const RHETORICAL = /^\s*(what if we could|have you ever|imagine if|ever wondered)/i;

/**
 * THE JSON WAIVER, for a seed that quotes somebody else's words (2026-09-28).
 *
 * A TypeScript line takes an inline `voice-ok:` comment and JSON has no
 * comments, so a JSON document waives itself with a top-level `"voice-ok"`
 * key holding the reason. The whole file is then skipped and counted as one
 * waiver, printed with the others. It exists for
 * `server/seeds/canvas-resources.json`, a snapshot of the Governance Canvas
 * Database: its names and descriptions are its authors' (an em dash in one
 * resource's name, "rather than requiring consensus" in another's
 * description), and rewording a
 * quotation to pass our house style would misquote them, the same reason
 * shared/governanceCanvasText.ts waives its lines. A blank reason waives
 * nothing, and neither does the key anywhere below the top level.
 */
export function jsonWaiver(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const reason = parsed["voice-ok"];
  return typeof reason === "string" && reason.trim() ? reason.trim() : null;
}

function walkFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(path.join(dir, entry.name), out);
    } else if (/\.(tsx?|json|md)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** The name of the attribute or property a literal is the value of, if any. */
function ownerKey(node) {
  const parent = node.parent;
  if (!parent) return null;
  if (ts.isJsxAttribute(parent)) return parent.name.getText();
  if (ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent)) {
    return parent.parent.name.getText();
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    return parent.name.getText().replace(/['"]/g, "");
  }
  if (ts.isVariableDeclaration(parent) && parent.name) return parent.name.getText();
  return null;
}

/** Collect the spans of a file that are actually copy. */
function copySpans(sourceFile) {
  const spans = [];
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText();
      if (text.trim()) spans.push({ pos: node.getStart(), text });
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    ) {
      const key = ownerKey(node);
      const isImport = node.parent && (
        ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)
      );
      const isPropName = node.parent && ts.isPropertyAssignment(node.parent) &&
        node.parent.name === node;
      if (!isImport && !isPropName && !(key && NON_COPY_KEYS.has(key))) {
        spans.push({ pos: node.getStart(), text: node.getText() });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return spans;
}

export function checkSpan(text) {
  const hits = [];
  for (const m of text.matchAll(/[—–]/g)) hits.push(["em-dash", m[0], m.index]);
  const low = text.toLowerCase();
  for (const w of AI_WORDS) {
    const re = new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "g");
    for (const m of low.matchAll(re)) hits.push(["ai-word", w, m.index]);
  }
  for (const re of CONTRAST) {
    const m = text.match(re);
    if (m) hits.push(["contrast-frame", m[0].slice(0, 60), m.index]);
  }
  for (const re of PASSIVE) {
    const m = text.match(re);
    if (m) hits.push(["passive-inspiration", m[0].slice(0, 60), m.index]);
  }
  if (RHETORICAL.test(text)) hits.push(["rhetorical-opener", text.trim().slice(0, 50), 0]);
  return hits;
}

if (isMain) {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const roots = args.filter((a) => !a.startsWith("--"));
  
  const activeRoots = roots.length ? roots : SCAN_ROOTS;
  const files = [];
  for (const r of activeRoots) {
    const abs = path.join(ROOT, r);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) walkFiles(abs, files);
    else files.push(abs);
  }

  // "0 violations" and "the walk found nothing to check" must never print the
  // same line: a moved or deleted scan root would otherwise report a clean
  // pass forever. This is the ONE thing that stays a hard failure regardless
  // of --json, because a caller parsing JSON output deserves the same
  // distinction a human reading the console gets.
  if (!files.length) {
    console.error(
      `Voice guard: found ZERO files under ${activeRoots.join(", ")} (resolved from ${ROOT}). ` +
      `That means the walk did not run, not that the repo is clean. Refusing to report a pass.`,
    );
    process.exit(1);
  }

  const findings = [];
  let waived = 0;
  
  /** Walk parsed JSON, checking every prose string value under a copy key. */
  function checkJson(value, key, rel, lines, out) {
    if (typeof value === "string") {
      if (key !== null && NON_COPY_JSON_KEYS.has(key)) return;
      for (const [kind, hit] of checkSpan(value)) {
        const idx = lines.findIndex((l) => l.includes(value.slice(0, 60)));
        out.push({
          file: rel, line: idx >= 0 ? idx + 1 : 1, kind, hit,
          text: value.trim().slice(0, 160),
        });
      }
    } else if (Array.isArray(value)) {
      for (const v of value) checkJson(v, key, rel, lines, out);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) checkJson(v, k, rel, lines, out);
    }
  }
  
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    if (isTest(rel)) continue;
    const text = fs.readFileSync(file, "utf8");
  
    if (file.endsWith(".md")) {
      // Markdown is prose end to end, so the whole file is the span. Fenced code
      // blocks are machinery and are cut out first.
      const prose = text.replace(/```[\s\S]*?```/g, "");
      prose.split("\n").forEach((lineText, i) => {
        if (/voice-ok:/.test(lineText)) return;
        for (const [kind, hit] of checkSpan(lineText)) {
          findings.push({
            file: rel, line: i + 1, kind, hit, text: lineText.trim().slice(0, 160),
          });
        }
      });
      continue;
    }
  
    if (file.endsWith(".json")) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue; // Not our gate to enforce; the boot seeder fails loud on bad JSON.
      }
      // A seed that is somebody else's words, quoted, says so at its top
      // level, and the whole file is waived and counted (see `jsonWaiver`).
      if (jsonWaiver(parsed)) { waived++; continue; }
      checkJson(parsed, null, rel, text.split("\n"), findings);
      continue;
    }
    const sf = ts.createSourceFile(
      file, text, ts.ScriptTarget.Latest, true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const lines = text.split("\n");
    for (const span of copySpans(sf)) {
      const hits = checkSpan(span.text);
      if (!hits.length) continue;
      for (const [kind, hit, offset] of hits) {
        const { line } = sf.getLineAndCharacterOfPosition(span.pos + (offset || 0));
        const lineText = lines[line] ?? "";
        if (/voice-ok:/.test(lineText)) { waived++; continue; }
        findings.push({
          file: rel, line: line + 1, kind, hit,
          text: lineText.trim().slice(0, 160),
        });
      }
    }
  }
  
  if (asJson) {
    console.log(JSON.stringify(findings, null, 0));
    process.exit(0);
  }
  
  if (!findings.length) {
    console.log(`Voice guard: clean across ${files.length} file(s) in ${activeRoots.join(", ")}.` +
      ` Excludes *.test.ts/*.spec.ts/__tests__ (developer language) and docs/ outside docs/knowledge.` +
      (waived ? ` ${waived} waiver(s).` : ""));
    process.exit(0);
  }
  
  const byKind = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  const byFile = {};
  for (const f of findings) (byFile[f.file] ||= []).push(f);
  
  console.log(`Voice guard: ${findings.length} violation(s) in ${Object.keys(byFile).length} file(s)` +
    ` (scanned ${activeRoots.join(", ")}; excludes tests and docs/ outside docs/knowledge).\n`);
  for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }
  console.log("");
  for (const [file, rows] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${file}  (${rows.length})`);
    for (const r of rows.slice(0, 12)) {
      console.log(`  L${String(r.line).padEnd(6)}[${r.kind}] ${r.text.slice(0, 110)}`);
    }
    if (rows.length > 12) console.log(`  ... ${rows.length - 12} more`);
  }
  if (waived) console.log(`\n${waived} waiver(s) via voice-ok.`);
  console.log("\nFix em-dashes first, then contrast-frames, then AI words.");
  process.exit(1);
}
