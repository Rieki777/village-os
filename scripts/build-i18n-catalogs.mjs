/**
 * Compile the translation catalogs for the server to serve
 * (internal spec i18n, plan §1.1, §8 R8).
 *
 *   node scripts/build-i18n-catalogs.mjs            -> dist/i18n/<locale>.json
 *   node scripts/build-i18n-catalogs.mjs --out DIR
 *
 * Reads the PO files under client/src/locales (written by `lingui extract`
 * and by translators) and writes one JSON file per language: the compiled
 * messages keyed by the same hashed id the client macro gives each string,
 * the ids no person has reviewed yet (PO's `fuzzy` flag, shown to readers as
 * "Translated automatically"), and a content version for cache busting.
 *
 * These files land in dist/i18n, NOT dist/public: no language is part of the
 * client bundle, so adding one costs the dist budget nothing. The server reads
 * them (server/routes/i18n.ts).
 *
 * English is never compiled: it is the source, kept in the code. The pseudo
 * locales en-XA (40 % longer, accented) and ar-XB (the same, right to left)
 * are generated from the English source for the overflow sweep.
 *
 * Compiling is strict: a translation that does not parse as ICU
 * MessageFormat fails the build and names the message.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCompiledCatalog } from "@lingui/cli/api";
import { formatter } from "@lingui/format-po";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "en";
const PSEUDO = [
  { locale: "en-XA", options: { prepend: "[", append: "]", extend: 0.4 } },
  { locale: "ar-XB", options: { prepend: "[", append: "]", extend: 0.4, rightToLeft: true } },
];

const po = formatter({ lineNumbers: false });

async function readPo(file, locale) {
  return po.parse(fs.readFileSync(file, "utf8"), { locale, sourceLocale: SOURCE, filename: file });
}

function compileOrThrow(locale, messages, pseudo) {
  const { source, errors } = createCompiledCatalog(locale, messages, {
    strict: true,
    namespace: "json",
    ...(pseudo ? { pseudoLocale: locale, pseudoLocaleOptions: pseudo } : {}),
  });
  if (errors.length > 0) {
    const lines = errors.map((e) => `  ${e.id} "${e.source}": ${e.error.message}`);
    throw new Error(`${locale}: ${errors.length} message(s) do not compile:\n${lines.join("\n")}`);
  }
  // The json namespace writes {"messages": {...}}.
  return JSON.parse(source).messages;
}

function write(outDir, locale, messages, unreviewed) {
  const body = { locale, messages, unreviewed: unreviewed.sort() };
  const version = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  fs.writeFileSync(path.join(outDir, `${locale}.json`), JSON.stringify({ ...body, version }));
}

export async function compileCatalogs({ srcDir = path.join(ROOT, "client/src/locales"), outDir = path.join(ROOT, "dist/i18n") } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith(".po")).sort()) {
    const locale = file.slice(0, -3);
    if (locale === SOURCE) continue;
    const entries = await readPo(path.join(srcDir, file), locale);
    const messages = {};
    const unreviewed = [];
    for (const [id, e] of Object.entries(entries)) {
      if (e.obsolete || !e.translation) continue;
      messages[id] = e.translation;
      if (e.extra?.flags?.includes("fuzzy")) unreviewed.push(id);
    }
    // Strict compile names the English source when a translation is broken.
    try {
      write(outDir, locale, compileOrThrow(locale, messages), unreviewed);
    } catch (err) {
      const named = String(err.message).replace(/ ([A-Za-z0-9_-]{6}) "/g, (m, id) => ` ${id} (${entries[id]?.message ?? "?"}) "`);
      throw new Error(named);
    }
    written.push(locale);
  }
  const sourceFile = path.join(srcDir, `${SOURCE}.po`);
  if (fs.existsSync(sourceFile)) {
    const entries = await readPo(sourceFile, SOURCE);
    const english = {};
    for (const [id, e] of Object.entries(entries)) if (!e.obsolete) english[id] = e.translation || e.message || id;
    for (const { locale, options } of PSEUDO) {
      write(outDir, locale, compileOrThrow(locale, english, options), []);
      written.push(locale);
    }
  }
  return written;
}

/**
 * Every English message in the built client must already be compiled
 * (client/src/i18n/precompileEnglish.ts): the browser has no ICU compiler, so a
 * message that slipped through would print its raw `{count, plural, ...}`.
 * Returns the offending snippets.
 */
export function uncompiledMessages(assetsDir) {
  const hits = [];
  if (!fs.existsSync(assetsDir)) return hits;
  for (const f of fs.readdirSync(assetsDir).filter((n) => n.endsWith(".js"))) {
    const code = fs.readFileSync(path.join(assetsDir, f), "utf8");
    for (const m of code.matchAll(/id:"[A-Za-z0-9_-]{6}",message:"[^"]{0,60}/g)) hits.push(`${f}: ${m[0]}`);
  }
  return hits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--out");
  const outDir = at > -1 ? path.resolve(process.argv[at + 1]) : undefined;
  const raw = uncompiledMessages(path.join(ROOT, "dist/public/assets"));
  if (raw.length > 0) {
    console.error(`::error::${raw.length} English message(s) reached the bundle uncompiled:\n  ${raw.slice(0, 10).join("\n  ")}`);
    process.exit(1);
  }
  compileCatalogs({ outDir }).then(
    (locales) => console.log(`i18n catalogs: ${locales.join(", ")} -> ${outDir ?? "dist/i18n"}`),
    (err) => { console.error(`::error::${err.message}`); process.exit(1); },
  );
}
