/**
 * The catalog check's own test (internal spec i18n, US6.2; §8 R7, R9, R12).
 *
 * Unit cases run `translationProblems` and `sourceProblems`; the end-to-end
 * case runs the real script on scratch PO files.
 *
 * Run: node scripts/check-i18n-catalogs.test.mjs
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceProblems, translationProblems } from "./check-i18n-catalogs.mjs";

const SCRIPT = fileURLToPath(new URL("./check-i18n-catalogs.mjs", import.meta.url));
let run = 0;
const check = (name, fn) => { fn(); run += 1; console.log(`  PASS  ${name}`); };
const VOTES = "{count, plural, one {# vote} other {# votes}}";

check("a faithful translation has no problems", () => {
  assert.deepEqual(translationProblems("Hi {name}", "Hola {name}", "es"), []);
  assert.deepEqual(translationProblems(VOTES, "{count, plural, one {# voto} many {# votos} other {# votos}}", "es"), []);
});

check("a dropped or renamed argument is a problem", () => {
  assert.match(translationProblems("You have {count} votes", "Tienes votos", "es").join(), /count/);
  assert.match(translationProblems("Hi {name}", "Hola {nombre}", "es").join(), /nombre/);
});

check("a translation that does not parse is a problem", () => {
  assert.match(translationProblems(VOTES, "{count, plural, one {# voto}", "es").join(), /parse/);
});

check("plurals: other is required; categories 0..100 reach in the target are required; extras must exist there (R7)", () => {
  assert.match(translationProblems(VOTES, "{count, plural, one {# voto}}", "es").join(), /other/);
  // Arabic reaches zero, one, two, few, many, other between 0 and 100.
  assert.match(translationProblems(VOTES, "{count, plural, one {# صوت} other {# أصوات}}", "ar").join(), /zero|two|few|many/);
  // Japanese has only `other`: a translation with just `other` is complete.
  assert.deepEqual(translationProblems(VOTES, "{count, plural, other {#票}}", "ja"), []);
  // `few` does not exist in Spanish.
  assert.match(translationProblems(VOTES, "{count, plural, one {# voto} few {# votitos} other {# votos}}", "es").join(), /few/);
  // `many` is optional in Spanish (only large numbers reach it).
  assert.deepEqual(translationProblems(VOTES, "{count, plural, one {# voto} other {# votos}}", "es"), []);
  // Exact matches are kept as they are.
  assert.deepEqual(translationProblems(VOTES, "{count, plural, =0 {Ningún voto} one {# voto} other {# votos}}", "es"), []);
});

check("select keys must equal the source's exactly", () => {
  const src = "{kind, select, quest {A quest} role {A role} other {Something}}";
  assert.match(translationProblems(src, "{kind, select, quest {Una misión} other {Algo}}", "es").join(), /role/);
});

check("rich-text tags must match the source's (a link must stay a link)", () => {
  assert.deepEqual(translationProblems("Read <0>the guide</0> first", "Lee <0>la guía</0> primero", "es"), []);
  assert.match(translationProblems("Read <0>the guide</0> first", "Lee la guía primero", "es").join(), /tag/);
  assert.match(translationProblems("Read <0>the guide</0>", "Lee <1>la guía</1>", "es").join(), /tag/);
});

check("short source strings need a context (R9); longer ones do not", () => {
  assert.match(sourceProblems({ message: "Open" }).join(), /context/);
  assert.match(sourceProblems({ message: "Sign in" }).join(), /context/);
  assert.deepEqual(sourceProblems({ message: "Open", context: "proposal status" }), []);
  assert.deepEqual(sourceProblems({ message: "Read the guide before you start" }), []);
});

function po(lang, entries) {
  return `msgid ""\nmsgstr ""\n"Language: ${lang}\\n"\n\n` + entries.map(({ id, str = "", ctx, origin, flags = [] }) =>
    `${origin ? `#: ${origin}\n` : ""}${flags.length ? `#, ${flags.join(", ")}\n` : ""}${ctx ? `msgctxt "${ctx}"\n` : ""}msgid "${id}"\nmsgstr "${str}"\n`).join("\n");
}

check("end to end: a missing translation inside the reviewed scope fails; outside it falls back to English", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-cat-check-"));
  const en = [
    { id: "Read the guide before you start", str: "Read the guide before you start", origin: "client/src/components/Layout.tsx" },
    { id: "Something on another page entirely", str: "Something on another page entirely", origin: "client/src/pages/Other.tsx" },
  ];
  fs.writeFileSync(path.join(dir, "en.po"), po("en", en));
  fs.writeFileSync(path.join(dir, "es.po"), po("es", [{ ...en[0], str: "" }, { ...en[1], str: "" }]));
  const r = spawnSync(process.execPath, [SCRIPT, "--locales-dir", dir, "--scope", "client/src/components/Layout.tsx", "--skip-extract"], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /es.*Read the guide/);
  assert.doesNotMatch(r.stdout + r.stderr, /Something on another page/);
  fs.writeFileSync(path.join(dir, "es.po"), po("es", [{ ...en[0], str: "Lee la guía antes de empezar" }, { ...en[1], str: "" }]));
  const ok = spawnSync(process.execPath, [SCRIPT, "--locales-dir", dir, "--scope", "client/src/components/Layout.tsx", "--skip-extract"], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

console.log(`check-i18n-catalogs: ${run} checks passed`);
