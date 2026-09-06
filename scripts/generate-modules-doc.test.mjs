/**
 * The module-doc generator's own guard.
 *
 * docs/MODULES.md is only worth trusting because a build step regenerates it
 * and compares. That step is worth exactly as much as the reader behind it, so
 * this file tests the reader on the cases that would let it be wrong QUIETLY:
 *
 *   - a registry shape it does not recognise. It must THROW, never skip. A
 *     skipped entry leaves a document that renders perfectly and describes a
 *     library nobody has, which is the whole failure this mechanism exists to
 *     stop.
 *   - a `ModuleDef` field nobody decided about. A field added to the interface
 *     reaches every village; if this document neither states it nor names the
 *     reason it does not, the document is silently incomplete.
 *   - a vocabulary value with no plain-words gloss, because a table with a
 *     blank cell teaches a shorter truth than the code holds.
 *   - the house writing rules, which the source comments do not keep:
 *     server/lib/modules.ts carries an em-dash in the `preview` gloss and the
 *     document may not.
 *   - determinism, because a byte comparison is the whole mechanism and a
 *     timestamp anywhere in the output would make every run a false failure.
 *
 * THE FIXTURES ARE THE REAL FILES WITH ONE THING CHANGED. A hand-written
 * miniature registry would prove the reader can read a miniature registry. So
 * a throwaway root is built from the repository's own `shared/modules.ts`,
 * `shared/capabilities.ts`, `shared/moduleCatalog.ts` and
 * `server/lib/modules.ts`, with the `MODULES` array (and, in one case, the
 * `ModuleDef` interface) spliced by the TypeScript parser. Everything the
 * generator reads besides the entries themselves is genuine.
 *
 * The fixture module ids are invented (`alpha`, `beta`), never a real
 * village's name, because this file lives under scripts/ where the brand guard
 * scans.
 *
 * Run: node scripts/generate-modules-doc.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { ROOT, collectFacts, generate, glossary } from "./generate-modules-doc.mjs";

let run = 0;
const check = async (name, fn) => {
  await fn();
  run += 1;
  console.log(`  PASS  ${name}`);
};

// ── Fixture plumbing ───────────────────────────────────────────────────────

const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split("/")), "utf8");

/** The exact source span of a top-level `const NAME = …` initializer. */
function initializerSpan(text, name) {
  const sf = ts.createSourceFile("modules.ts", text, ts.ScriptTarget.ES2022, true);
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) {
        return { start: d.initializer.getStart(sf), end: d.initializer.getEnd() };
      }
    }
  }
  throw new Error(`the fixture builder could not find const ${name} in shared/modules.ts`);
}

/** The `{` that opens a named interface, so a field can be spliced in after it. */
function interfaceBodyStart(text, name) {
  const sf = ts.createSourceFile("modules.ts", text, ts.ScriptTarget.ES2022, true);
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === name) {
      return stmt.members.pos;
    }
  }
  throw new Error(`the fixture builder could not find interface ${name} in shared/modules.ts`);
}

const KNOWLEDGE_FIXTURE = `export const MODULE_DOCS: Readonly<Record<string, string>> = {
  alpha: "alpha.md",
};
`;

/**
 * A throwaway repository root carrying the real supporting files and whatever
 * registry entries a case needs.
 *
 * `entries` is TypeScript source for the inside of the MODULES array.
 * `interfaceExtra` is spliced into `ModuleDef`, for the one case that tests
 * what happens when the interface grows a field.
 */
async function withRegistry({ entries, interfaceExtra = null, docs = KNOWLEDGE_FIXTURE }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "modules-doc-test-"));
  try {
    fs.mkdirSync(path.join(dir, "shared"), { recursive: true });
    fs.mkdirSync(path.join(dir, "server", "lib"), { recursive: true });
    fs.mkdirSync(path.join(dir, "docs", "modules"), { recursive: true });

    let modulesSrc = read("shared/modules.ts");
    if (interfaceExtra) {
      const at = interfaceBodyStart(modulesSrc, "ModuleDef");
      modulesSrc = `${modulesSrc.slice(0, at)}\n  ${interfaceExtra}${modulesSrc.slice(at)}`;
    }
    const span = initializerSpan(modulesSrc, "MODULES");
    modulesSrc = `${modulesSrc.slice(0, span.start)}[\n${entries}\n]${modulesSrc.slice(span.end)}`;

    fs.writeFileSync(path.join(dir, "shared", "modules.ts"), modulesSrc, "utf8");
    fs.writeFileSync(path.join(dir, "shared", "capabilities.ts"), read("shared/capabilities.ts"), "utf8");
    fs.writeFileSync(path.join(dir, "shared", "moduleCatalog.ts"), read("shared/moduleCatalog.ts"), "utf8");
    fs.writeFileSync(path.join(dir, "server", "lib", "modules.ts"), read("server/lib/modules.ts"), "utf8");
    fs.writeFileSync(path.join(dir, "server", "lib", "knowledge.ts"), docs, "utf8");
    fs.writeFileSync(path.join(dir, "docs", "modules", "alpha.md"), "# Alpha\n", "utf8");
    // AWAITED, because the teardown below is synchronous. Returning the
    // promise instead deleted the fixture root before the generator opened a
    // single file, and every case reported "shared/moduleCatalog.ts is gone".
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** One well-formed entry, with the fields a case wants overridden. */
const entry = (over = {}) => {
  const fields = {
    id: '"alpha"',
    tier: '"included"',
    dataClass: '"member-pii"',
    group: '"coordinate"',
    setup: '"none"',
    name: '"Alpha"',
    description: '"A fixture module."',
    requires: "[]",
    recommends: "[]",
    capabilities: '["quest.consent"]',
    variableKeys: '["alpha.enabled"]',
    apiPrefixes: '["/api/alpha"]',
    ...over,
  };
  return `  {\n${Object.entries(fields)
    .map(([k, v]) => `    ${k}: ${v},`)
    .join("\n")}\n  },`;
};

const rejects = (root, pattern) =>
  assert.rejects(() => generate(root), (err) => {
    assert.ok(pattern.test(err.message), `wanted ${pattern}, got: ${err.message}`);
    return true;
  });

// ── The real repository ────────────────────────────────────────────────────

console.log("\ngenerate-modules-doc: the document this repository actually produces\n");

await check("the real registry generates, and generates the same bytes twice", async () => {
  const once = await generate();
  const twice = await generate();
  assert.strictEqual(once, twice, "a timestamp or any other clock reading would break the byte comparison");
  assert.ok(once.startsWith("# Modules\n"), "the document must open with its own title");
  assert.ok(once.endsWith("\n"), "a text file ends with a newline");
});

await check("a known module is stated with its ACTUAL tier and capabilities", async () => {
  const text = await generate();
  const parsed = JSON.parse(/```json\n([\s\S]+?)\n```/.exec(text)[1]);
  const quests = parsed.modules.find((m) => m.id === "quests");
  assert.ok(quests, "quests is a core module and must be in the machine-readable block");
  assert.strictEqual(quests.tier, "included");
  assert.strictEqual(quests.core, true);
  assert.deepStrictEqual(quests.capabilities, ["quest.consent"]);
  assert.ok(text.includes("### Quests\n"), "quests needs a section of its own");
  assert.ok(
    text.includes("| Capabilities it adds | `quest.consent` |"),
    "the prose must carry the same capability the JSON does",
  );

  const map = parsed.modules.find((m) => m.id === "map");
  assert.deepStrictEqual(
    map.capabilities,
    ["map.viewPeople", "map.contact", "map.photograph", "map.curatePhotos"],
    "map adds four keys to the one gate, in this order",
  );
  assert.ok(
    text.includes("| Contract doc | [village-map.md](modules/village-map.md) |"),
    "map's contract doc is named under a filename that does not follow its id, which is why MODULE_DOCS exists",
  );
});

await check("every module in the JSON has a section and an id row in the prose", async () => {
  const text = await generate();
  const parsed = JSON.parse(/```json\n([\s\S]+?)\n```/.exec(text)[1]);
  assert.ok(parsed.modules.length > 1, "a one-module document would be the short document this guard exists to catch");
  for (const m of parsed.modules) {
    assert.ok(text.includes(`### ${m.name}\n`), `${m.id} has no section of its own`);
    assert.ok(text.includes(`| Id | \`${m.id}\` |`), `${m.id}'s id is not stated in its section`);
  }
});

await check("the core modules are met before anything a village can switch off", async () => {
  const text = await generate();
  const facts = await collectFacts();
  const coreHeading = text.indexOf(`## The ${["no", "one", "two", "three", "four"][facts.core.length]} core modules`);
  assert.ok(coreHeading > 0, "the core section is named by a count read from the registry");
  for (const m of facts.core) {
    assert.ok(
      text.indexOf(`### ${m.name}\n`) > coreHeading,
      `${m.id} is core and its section must sit inside the core section`,
    );
  }
  const firstShelf = Math.min(
    ...facts.groups
      .map((g) => text.indexOf(`\n## ${g.label}\n`))
      .filter((i) => i > 0),
  );
  assert.ok(firstShelf > coreHeading, "a reader meets the core four before the first shelf");
});

await check("the prose keeps the house writing rules the source comments do not", async () => {
  const text = await generate();
  assert.ok(
    /—/.test(read("server/lib/modules.ts")),
    "this assertion is only worth anything while the source it quotes still carries an em-dash",
  );
  assert.ok(!text.includes("—"), "no em-dashes");
  assert.ok(!text.includes("–"), "no en-dashes");
  assert.ok(!/\bnot (?:just|only) [a-z]+,? but\b/i.test(text), "no not-X-but-Y framing");
});

// ── A registry the reader cannot trust ─────────────────────────────────────

console.log("\ngenerate-modules-doc: a malformed registry stops the build\n");

await check("a well-formed fixture generates, so the refusals below mean something", async () => {
  await withRegistry({ entries: `${entry()}\n${entry({ id: '"beta"', name: '"Beta"' })}` }, async (root) => {
    const text = await generate(root);
    assert.ok(text.includes("| Id | `alpha` |"), "the fixture registry must actually render");
    assert.ok(text.includes("| Id | `beta` |"));
    assert.ok(text.includes("| Contract doc | [alpha.md](modules/alpha.md) |"));
  });
});

await check("THROWS on a tier the type does not declare", async () => {
  await withRegistry({ entries: entry({ tier: '"platinum"' }) }, (root) =>
    rejects(root, /gives its tier as "platinum", which is not one of/),
  );
});

await check("THROWS on a data class the type does not declare", async () => {
  await withRegistry({ entries: entry({ dataClass: '"secret"' }) }, (root) =>
    rejects(root, /gives its data class as "secret"/),
  );
});

await check("THROWS on a shelf no group defines", async () => {
  await withRegistry({ entries: entry({ group: '"nowhere"' }) }, (root) =>
    rejects(root, /sits on the shelf "nowhere"/),
  );
});

await check("THROWS on a capability that is not in the one gate", async () => {
  await withRegistry({ entries: entry({ capabilities: '["alpha.doAnything"]' }) }, (root) =>
    rejects(root, /adds the capability "alpha\.doAnything"/),
  );
});

await check("THROWS on a dependency naming a module that does not exist", async () => {
  await withRegistry({ entries: entry({ requires: '["ghost"]' }) }, (root) =>
    rejects(root, /requires "ghost", which is not a module in this registry/),
  );
});

await check("THROWS on two entries sharing an id", async () => {
  await withRegistry({ entries: `${entry()}\n${entry({ name: '"Alpha Again"' })}` }, (root) =>
    rejects(root, /is in the registry twice/),
  );
});

await check("THROWS on two entries sharing a name, which would share a heading", async () => {
  await withRegistry({ entries: `${entry()}\n${entry({ id: '"beta"' })}` }, (root) =>
    rejects(root, /both called "Alpha"/),
  );
});

await check("THROWS on a list field that is not a list of names", async () => {
  await withRegistry({ entries: entry({ variableKeys: '"alpha.enabled"' }) }, (root) =>
    rejects(root, /declares variableKeys as something other than a list of names/),
  );
});

await check("THROWS when ModuleDef gains a field nobody decided about", async () => {
  await withRegistry(
    {
      entries: entry({ billingCadence: '"quarterly"' }),
      interfaceExtra: "billingCadence?: string;",
    },
    (root) =>
      rejects(root, /ModuleDef gained the field "billingCadence" and this document says nothing about it/),
  );
});

await check("THROWS when MODULE_DOCS points at a file that is not on disk", async () => {
  await withRegistry(
    {
      entries: entry(),
      docs: 'export const MODULE_DOCS: Readonly<Record<string, string>> = {\n  alpha: "gone.md",\n};\n',
    },
    (root) => rejects(root, /points "alpha" at docs\/modules\/gone\.md, which is not on disk/),
  );
});

await check("THROWS when MODULE_DOCS names a module the registry does not have", async () => {
  await withRegistry(
    {
      entries: entry(),
      docs: 'export const MODULE_DOCS: Readonly<Record<string, string>> = {\n  alpha: "alpha.md",\n  ghost: "alpha.md",\n};\n',
    },
    (root) => rejects(root, /maps "ghost" to alpha\.md and no module by that id is in the registry/),
  );
});

await check("THROWS on an empty registry instead of emitting an empty document", async () => {
  await withRegistry({ entries: "" }, (root) => rejects(root, /exported no MODULES array/));
});

// ── The vocabulary readers ─────────────────────────────────────────────────

console.log("\ngenerate-modules-doc: a vocabulary value with no words for it\n");

await check("glossary reads a term and its continuation lines", () => {
  const g = glossary(
    ["/**", " *   off      routes 404, zero nav", " *   preview  admins only, so the catalog", " *            never leaks", " */"].join("\n"),
    ["off", "preview"],
    "a fixture",
  );
  assert.strictEqual(g.off, "routes 404, zero nav");
  assert.strictEqual(g.preview, "admins only, so the catalog never leaks");
});

await check("glossary replaces a dash the house rules forbid", () => {
  const g = glossary("/**\n *   off      admins only — nobody else\n */", ["off"], "a fixture");
  assert.ok(!g.off.includes("—"), "the character may not reach the document");
  assert.strictEqual(g.off, "admins only, nobody else");
});

await check("glossary THROWS on a value nobody wrote a sentence for", () => {
  assert.throws(
    () => glossary("/**\n *   off      routes 404\n */", ["off", "paused"], "a fixture"),
    /gives no plain-words gloss for paused/,
  );
});

await check("glossary ignores a gloss for a value the type does not have", () => {
  // One direction only, and the generator says why beside the code: the type
  // decides which values exist, so a sentence left behind for a value that is
  // gone changes nothing this document prints. Pinned here so the asymmetry
  // reads as a decision instead of an oversight.
  const g = glossary("/**\n *   off      routes 404\n *   paused   nothing\n */", ["off"], "a fixture");
  assert.deepStrictEqual(Object.keys(g), ["off"]);
});

console.log(`\n${run} check(s) passed\n`);
