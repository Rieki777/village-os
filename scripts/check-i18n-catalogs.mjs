#!/usr/bin/env node
/**
 * Translation catalogs are complete where they must be, and every translation
 * says the same thing to the code as its source (internal spec i18n, US6.2;
 * §8 R7, R9, R12).
 *
 * Checks, in order:
 *   1. client/src/locales/en.po is current: a fresh `lingui extract` into a
 *      scratch folder finds no message the committed catalog lacks.
 *   2. Every source message of three words or fewer carries a context (R9), so
 *      "Open" the button and "Open" the proposal status can differ in Spanish.
 *   3. Each other PO file (a reviewed language) translates every message whose
 *      origin is in the REVIEWED SCOPE. Outside the scope a missing string
 *      falls back to English, which is honest, so it is not a failure.
 *   4. Every translation, in or out of scope:
 *      - parses as ICU MessageFormat;
 *      - names exactly the source's arguments (a dropped `{count}` or a
 *        renamed `{nombre}` fails; this is also what catches an apostrophe
 *        that quotes an argument away);
 *      - plural and selectordinal: `other` present; every category the
 *        integers 0..100 reach in that language present; no category the
 *        language does not have (R7);
 *      - select: exactly the source's keys;
 *      - rich-text tags `<0>...</0>`: exactly the source's.
 *
 * WHAT IT DOES NOT SEE: whether a translation is GOOD. That is the reviewer's
 * and, per spec §9, the village's job. Machine translations and village edits
 * live in the database (P2) and are validated by the same functions when they
 * are written.
 *
 *   node scripts/check-i18n-catalogs.mjs
 *   node scripts/check-i18n-catalogs.mjs --locales-dir DIR --scope a.tsx,b.tsx --skip-extract
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatter } from "@lingui/format-po";
import { compileMessageOrThrow } from "@lingui/message-utils/compileMessage";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

/**
 * Files whose messages every reviewed language must translate. Each extraction
 * PR adds its files here once their Spanish is in (spec plan §1.7).
 */
export const REVIEWED_SCOPE = ["client/src/components/Layout.tsx", "client/src/i18n/LanguagePicker.tsx"];

const TAG = /<\/?(\d+)\s*\/?>/g;

/** Walk a compiled message: arguments (name -> {type, keys}) and every literal string. */
function shape(compiled, out = { args: new Map(), strings: [] }) {
  for (const tok of Array.isArray(compiled) ? compiled : [compiled]) {
    if (typeof tok === "string") {
      out.strings.push(tok);
    } else if (Array.isArray(tok)) {
      const [name, type, options] = tok;
      if (name === "#" && !type) continue;
      const entry = out.args.get(name) ?? { type: type ?? "simple", keys: new Set() };
      out.args.set(name, entry);
      if (options && typeof options === "object" && (type === "plural" || type === "select" || type === "selectordinal")) {
        for (const [k, v] of Object.entries(options)) {
          if (k === "offset") continue;
          entry.keys.add(k);
          shape(v, out);
        }
      }
    }
  }
  return out;
}

function tags(strings) {
  return strings.flatMap((s) => [...s.matchAll(TAG)].map((m) => m[0].replace(/\s/g, ""))).sort().join(" ");
}

function categoriesReached(locale, type) {
  const pr = new Intl.PluralRules(locale, { type });
  const reached = new Set(["other"]);
  for (let i = 0; i <= 100; i++) reached.add(pr.select(i));
  return { reached, exist: new Set(pr.resolvedOptions().pluralCategories) };
}

/** What is wrong with `translation` as a rendering of `source` in `locale`; empty when nothing. */
export function translationProblems(source, translation, locale) {
  let src;
  let tr;
  try {
    src = shape(compileMessageOrThrow(source));
  } catch (e) {
    return [`the SOURCE does not parse: ${e.message}`];
  }
  try {
    tr = shape(compileMessageOrThrow(translation));
  } catch (e) {
    return [`does not parse as ICU MessageFormat: ${e.message}`];
  }
  const problems = [];
  const srcNames = [...src.args.keys()].sort().join(",");
  const trNames = [...tr.args.keys()].sort().join(",");
  if (srcNames !== trNames) problems.push(`arguments {${trNames}} differ from the source's {${srcNames}}`);
  for (const [name, a] of tr.args) {
    if (a.type === "plural" || a.type === "selectordinal") {
      const { reached, exist } = categoriesReached(locale, a.type === "plural" ? "cardinal" : "ordinal");
      // Exact matches (`=0`) compile to bare numbers; they are kept as written.
      const named = new Set([...a.keys].filter((k) => !k.startsWith("=") && !/^\d+$/.test(k)));
      for (const k of reached) if (!named.has(k)) problems.push(`{${name}, ${a.type}} lacks "${k}", which ${locale} needs`);
      for (const k of named) if (!exist.has(k)) problems.push(`{${name}, ${a.type}} has "${k}", which ${locale} does not have`);
    } else if (a.type === "select") {
      const want = [...(src.args.get(name)?.keys ?? [])].sort().join(",");
      const got = [...a.keys].sort().join(",");
      if (want !== got) problems.push(`{${name}, select} keys {${got}} differ from the source's {${want}}`);
    }
  }
  if (tags(src.strings) !== tags(tr.strings)) problems.push(`rich-text tags "${tags(tr.strings)}" differ from the source's "${tags(src.strings)}"`);
  return problems;
}

/** What is wrong with a source message itself. */
export function sourceProblems({ message, context }) {
  if (context) return [];
  if (/\{\s*\w+\s*,\s*(plural|select|selectordinal)/.test(message)) return [];
  const words = message.replace(/\{[^{}]*\}/g, " ").replace(TAG, " ").trim().split(/\s+/).filter(Boolean);
  return words.length <= 3 ? [`"${message}" is three words or fewer and has no context (spec R9): add one, e.g. <Trans context="site header">`] : [];
}

const po = formatter({ lineNumbers: false });
async function read(file, locale) {
  return po.parse(fs.readFileSync(file, "utf8"), { locale, sourceLocale: "en", filename: file });
}

/** Ids a fresh extraction finds that the committed English catalog lacks. */
function staleSourceIds(committed) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-extract-"));
  const cfg = path.join(tmp, "lingui.config.mjs");
  const real = path.join(ROOT, "lingui.config.ts").split(path.sep).join("/");
  fs.writeFileSync(cfg, `import base from "file:///${real.replace(/^\//, "")}";\nexport default { ...base, rootDir: ${JSON.stringify(ROOT.split(path.sep).join("/"))}, catalogs: base.catalogs.map((c) => ({ ...c, path: ${JSON.stringify(tmp.split(path.sep).join("/"))} + "/{locale}" })) };\n`);
  const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "@lingui", "cli", "dist", "lingui.js"), "extract", "--config", cfg], { cwd: ROOT, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "--import tsx" } });
  if (r.status !== 0) throw new Error(`lingui extract failed:\n${r.stdout}${r.stderr}`);
  return read(path.join(tmp, "en.po"), "en").then((fresh) => Object.keys(fresh).filter((id) => !fresh[id].obsolete && !(id in committed)).map((id) => fresh[id].message ?? id));
}

export async function checkCatalogs({ dir, scope, skipExtract }) {
  const problems = [];
  const en = await read(path.join(dir, "en.po"), "en");
  if (!skipExtract) {
    for (const m of await staleSourceIds(en)) problems.push(`en.po is stale: "${m}" is in the code but not in the catalog. Run: pnpm i18n:extract`);
  }
  for (const [, e] of Object.entries(en)) {
    if (e.obsolete) continue;
    for (const p of sourceProblems({ message: e.message ?? "", context: e.context })) problems.push(`en: ${p}`);
  }
  const inScope = (e) => (e.origin ?? []).some(([file]) => scope.includes(String(file).split(path.sep).join("/")));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".po") && f !== "en.po").sort()) {
    const locale = file.slice(0, -3);
    const cat = await read(path.join(dir, file), locale);
    for (const [id, source] of Object.entries(en)) {
      if (source.obsolete) continue;
      const t = cat[id];
      if (!t?.translation) {
        if (inScope(source)) problems.push(`${locale}: "${source.message}" is in the reviewed scope and has no translation`);
        continue;
      }
      for (const p of translationProblems(source.message ?? id, t.translation, locale)) problems.push(`${locale}: "${source.message}": ${p}`);
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(arg("--locales-dir") ?? path.join(ROOT, "client", "src", "locales"));
  const scope = arg("--scope")?.split(",") ?? REVIEWED_SCOPE;
  checkCatalogs({ dir, scope, skipExtract: process.argv.includes("--skip-extract") }).then(
    (problems) => {
      if (problems.length) {
        console.error(`::error::${problems.length} catalog problem(s) (spec i18n US6.2):`);
        for (const p of problems) console.error(`  ${p}`);
        process.exit(1);
      }
      console.log(`i18n catalogs passed: sources current, contexts present, reviewed scope (${scope.length} file(s)) translated, every translation matches its source's shape.`);
    },
    (err) => { console.error(`::error::${err.message}`); process.exit(1); },
  );
}
