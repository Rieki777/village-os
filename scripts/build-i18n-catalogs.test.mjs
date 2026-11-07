/**
 * The catalog compile step's own test (internal spec i18n, plan §1.1, §8 R8).
 *
 * Runs the real compile against scratch PO files, never this repo's catalogs.
 *
 * Run: node scripts/build-i18n-catalogs.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";
import { compileCatalogs } from "./build-i18n-catalogs.mjs";

let run = 0;
const check = async (name, fn) => { await fn(); run += 1; console.log(`  PASS  ${name}`); };

function po(lang, entries) {
  const head = `msgid ""\nmsgstr ""\n"Language: ${lang}\\n"\n\n`;
  return head + entries.map(({ id, str = "", flags = [], ctx }) =>
    `${flags.length ? `#, ${flags.join(", ")}\n` : ""}${ctx ? `msgctxt "${ctx}"\n` : ""}msgid "${id}"\nmsgstr "${str}"\n`).join("\n");
}

function scratch(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-cat-"));
  const src = path.join(dir, "locales");
  fs.mkdirSync(src);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(src, name), body);
  return { src, out: path.join(dir, "out") };
}

const EN = po("en", [
  { id: "Sign in", str: "Sign in" },
  { id: "{count, plural, one {# vote} other {# votes}}", str: "{count, plural, one {# vote} other {# votes}}" },
  { id: "Open", str: "Open", ctx: "proposal status" },
]);

await check("a reviewed locale compiles to ids the client macro uses, and lists what no person has reviewed", async () => {
  const { src, out } = scratch({
    "en.po": EN,
    "es.po": po("es", [
      { id: "Sign in", str: "Iniciar sesión" },
      { id: "{count, plural, one {# vote} other {# votes}}", str: "{count, plural, one {# voto} many {# votos} other {# votos}}", flags: ["fuzzy"] },
      { id: "Open", str: "Abierta", ctx: "proposal status" },
    ]),
  });
  await compileCatalogs({ srcDir: src, outDir: out });
  const es = JSON.parse(fs.readFileSync(path.join(out, "es.json"), "utf8"));
  assert.equal(es.locale, "es");
  assert.ok(String(JSON.stringify(es.messages[generateMessageId("Sign in")])).includes("Iniciar sesión"));
  assert.ok(es.messages[generateMessageId("Open", "proposal status")], "context is part of the id");
  assert.deepEqual(es.unreviewed, [generateMessageId("{count, plural, one {# vote} other {# votes}}")]);
  assert.match(es.version, /^[0-9a-f]{12}$/);
});

await check("an empty translation is left out, so the client falls back to English", async () => {
  const { src, out } = scratch({ "en.po": EN, "es.po": po("es", [{ id: "Sign in", str: "" }]) });
  await compileCatalogs({ srcDir: src, outDir: out });
  const es = JSON.parse(fs.readFileSync(path.join(out, "es.json"), "utf8"));
  assert.equal(es.messages[generateMessageId("Sign in")], undefined);
});

await check("a broken translation fails the build, naming the message", async () => {
  const { src, out } = scratch({ "en.po": EN, "es.po": po("es", [{ id: "Sign in", str: "{count, plural, one {x}" }]) });
  await assert.rejects(() => compileCatalogs({ srcDir: src, outDir: out }), /Sign in/);
});

await check("pseudo locales are generated from the source: longer, bracketed, en-XA ltr and ar-XB marked rtl", async () => {
  const { src, out } = scratch({ "en.po": EN });
  await compileCatalogs({ srcDir: src, outDir: out });
  const xa = JSON.parse(fs.readFileSync(path.join(out, "en-XA.json"), "utf8"));
  const xb = JSON.parse(fs.readFileSync(path.join(out, "ar-XB.json"), "utf8"));
  const signIn = JSON.stringify(xa.messages[generateMessageId("Sign in")]);
  assert.ok(signIn.includes("["), signIn);
  assert.ok(signIn.length > JSON.stringify("Sign in").length + 3, signIn);
  assert.ok(JSON.stringify(xa.messages[generateMessageId("{count, plural, one {# vote} other {# votes}}")]).includes("count"), "arguments survive");
  assert.ok(xb.messages[generateMessageId("Sign in")]);
  assert.equal(fs.existsSync(path.join(out, "en.json")), false, "English is never a catalog: it is the source in the code");
});

console.log(`build-i18n-catalogs: ${run} checks passed`);
