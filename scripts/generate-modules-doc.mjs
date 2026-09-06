/**
 * NO SHEBANG, and it is deliberate.
 *
 * This file is imported by `scripts/check-modules-doc.mjs` and by
 * `scripts/generate-modules-doc.test.mjs`, and every caller runs it as
 * `node scripts/generate-modules-doc.mjs`, so a shebang would buy nothing.
 * `scripts/generate-token-doc.mjs` carries the same line for a sharper reason:
 * a shebang together with CRLF line endings makes Vite's transform throw, and
 * `core.autocrlf` is true on the Windows checkouts this repository is
 * developed on. Nothing here goes through Vite today. The cheapest way for
 * that to stay harmless is to never add the shebang.
 */
/**
 * docs/MODULES.md, written from the registry instead of about it.
 *
 * WHAT IT IS FOR. `shared/modules.ts` is a typed registry of every module a
 * village can run: what each one is called, who bills it, the widest class of
 * data it holds, which shelf it sits on, what it needs, what it recommends,
 * the capability keys it adds to the one gate, the game-variable keys it owns,
 * and the API prefixes that mount behind `requireModule()`. That is a complete
 * statement of what a village can switch on, and until this file existed it
 * was rendered for a human NOWHERE. A fork operator deciding what to run had
 * to read TypeScript.
 *
 * WHY A GENERATOR. A hand-written module reference is wrong within a month and
 * nothing says so. Every count in this repository that a person copied into
 * prose has drifted: the comment above `tier` still says "which is why all
 * eighteen are" over a registry of twenty-three, and `MODULES_MASTER_PLAN.md`
 * Part 1 is marked known-stale in CLAUDE.md. So this reads the registry,
 * derives the facts, and emits the document; `scripts/check-modules-doc.mjs`
 * regenerates it and fails the build when the emitted text and the committed
 * text differ. The check is what makes the document worth trusting. Without it
 * this is a beautiful thing that lies.
 *
 * HOW IT READS. Values come from TRANSPILING AND IMPORTING the real registry,
 * the way `scripts/module-facts.mjs`, `scripts/check-module-docs.mjs` and
 * `scripts/validate-module.mjs` all do. A regex over a twenty-three entry
 * registry reads a shorter truth the first time somebody formats an entry
 * differently. Types erase during transpilation, so the vocabularies
 * (lifecycle, tier, data class, setup, shelf) are parsed out of their
 * declarations with the TypeScript compiler's own parser, and the plain-words
 * gloss for each one is lifted from the JSDoc block that declares it. Neither
 * half is a guess at the file.
 *
 * WHY IT DOES NOT IMPORT scripts/module-facts.mjs. That file is the obvious
 * home for a shared `loadShared`, and it exports nothing at all: every symbol
 * is a top-level const, and importing it would run its whole body, print a
 * facts report, and possibly call `process.exit(1)`. The loading approach is
 * reused here and that file is left alone. If it ever grows exports, this
 * function is the one to delete.
 *
 * EVERY READER THROWS ON A SHAPE IT DOES NOT RECOGNISE. A generator that
 * quietly emits a shorter document is the exact failure this mechanism exists
 * to prevent: the file still renders, still looks complete, and has silently
 * lost a module. So an unknown tier, a capability that is not in the one gate,
 * a dependency naming a module that does not exist, a lifecycle value with no
 * gloss, a `MODULE_DOCS` entry pointing at a file that is not there, and a
 * `ModuleDef` field this generator neither renders nor excuses are all
 * refusals with the file and the text named.
 *
 * That last one is the guard with the longest reach. `RENDERED` and
 * `NOT_RENDERED` below partition the `ModuleDef` interface, and both
 * directions throw, so a field added to the registry cannot reach a village
 * without somebody deciding out loud whether this document says it.
 *
 * Usage:
 *   node scripts/generate-modules-doc.mjs            write docs/MODULES.md
 *   node scripts/generate-modules-doc.mjs --stdout   print it, write nothing
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

export const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
);

export const DOC_PATH = path.join(ROOT, "docs", "MODULES.md");

/**
 * Every file this document is derived from. Existence is checked before
 * anything is parsed, so a rename fails with the path it wanted instead of
 * with a parse error twenty frames deep.
 */
export const SOURCES = [
  "shared/modules.ts",
  "shared/moduleCatalog.ts",
  "shared/capabilities.ts",
  "server/lib/modules.ts",
  "server/lib/knowledge.ts",
  "docs/modules",
];

export class ReadError extends Error {}

function fail(message) {
  throw new ReadError(message);
}

// ── Values: transpile and import, the way module-facts.mjs does ─────────────

/**
 * Transpile `shared/<entry>.ts` into a scratch directory and import it.
 * Relative specifiers gain an extension because Node's ESM resolver requires
 * one. Type-only imports erase, so each file this reads comes out
 * self-contained; a value import between two shared files would fail loudly
 * here as a resolver error, which is the correct outcome.
 */
export async function loadShared(entry, root = ROOT) {
  const abs = path.join(root, "shared", `${entry}.ts`);
  if (!fs.existsSync(abs)) fail(`modules-doc: shared/${entry}.ts is gone; the generator reads it`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "modules-doc-"));
  try {
    const js = ts
      .transpileModule(fs.readFileSync(abs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/(from\s+")(\.\/[A-Za-z0-9_-]+)(")/g, "$1$2.mjs$3");
    fs.writeFileSync(path.join(dir, `${entry}.mjs`), js, "utf8");
    return await import(new URL(`file://${path.join(dir, `${entry}.mjs`)}`).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Vocabularies: parse the declarations, because types do not survive ──────

function sourceFileAt(root, relPath) {
  const abs = path.join(root, ...relPath.split("/"));
  if (!fs.existsSync(abs)) fail(`modules-doc: ${relPath} is gone; the generator reads it`);
  const text = fs.readFileSync(abs, "utf8");
  return { text, sf: ts.createSourceFile(relPath, text, ts.ScriptTarget.ES2022, true) };
}

/**
 * The string members of a union type alias, in declaration order. Throws when
 * the alias is gone and when it exists as something other than a union of
 * string literals, so a renamed type reads differently from a restructured
 * one.
 */
export function unionStrings(sf, aliasName, relPath) {
  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt) || stmt.name.text !== aliasName) continue;
    const parts = ts.isUnionTypeNode(stmt.type) ? stmt.type.types : [stmt.type];
    const values = parts
      .filter((p) => ts.isLiteralTypeNode(p) && ts.isStringLiteral(p.literal))
      .map((p) => p.literal.text);
    if (values.length !== parts.length) {
      fail(
        `modules-doc: ${relPath} declares ${aliasName} as something other than a union of string ` +
          "literals. The document lists its values, so it cannot read this shape.",
      );
    }
    return values;
  }
  return fail(`modules-doc: ${relPath} no longer declares the type ${aliasName}`);
}

/** The members of an interface, with optionality, in declaration order. */
export function interfaceFields(sf, interfaceName, relPath) {
  for (const stmt of sf.statements) {
    if (!ts.isInterfaceDeclaration(stmt) || stmt.name.text !== interfaceName) continue;
    return stmt.members.filter(ts.isPropertySignature).map((m) => ({
      name: m.name.getText(sf),
      optional: !!m.questionToken,
    }));
  }
  return fail(`modules-doc: ${relPath} no longer declares the interface ${interfaceName}`);
}

/**
 * The house writing rules forbid an em-dash or an en-dash in shipped copy, and
 * a gloss quoted out of a source comment can carry one. `server/lib/modules.ts`
 * does today, in the `preview` line. The character is replaced with a comma so
 * the words survive and the document stays inside the rules; nothing else about
 * the sentence is touched.
 */
const houseDashes = (s) => s.replace(/\s*[—–]\s*/g, ", ");

/**
 * A term-and-gloss list out of a comment block, in the shape this repository
 * writes them:
 *
 *     *   none      works the moment it is on. The Go-live card offers
 *     *             itself right after Turn on.
 *
 * Every requested term must be there, so a vocabulary that gains a value
 * without a sentence stops the build instead of shipping a table with a blank
 * cell.
 *
 * ONE DIRECTION ONLY, deliberately. The other direction, a gloss for a value
 * the type no longer has, would mean scanning a prose comment for anything
 * term-shaped and calling the surplus an error. The type is the source of
 * truth for which values exist, a sentence about a value that is gone changes
 * nothing this document prints, and a guard that fails on somebody's wrapped
 * paragraph is a guard that gets switched off.
 */
export function glossary(comment, terms, where) {
  const found = new Map();
  let current = null;
  for (const raw of comment.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("*")) continue;
    const body = raw.replace(/^\s*\*\s?/, "");
    const start = /^\s{0,6}(\S+)\s{2,}(\S.*)$/.exec(body);
    if (start && terms.includes(start[1]) && !found.has(start[1])) {
      current = start[1];
      found.set(current, [start[2].trim()]);
      continue;
    }
    if (!current) continue;
    const continued = /^\s{6,}(\S.*)$/.exec(body);
    if (continued) {
      found.get(current).push(continued[1].trim());
      continue;
    }
    current = null;
  }
  const missing = terms.filter((t) => !found.has(t));
  if (missing.length) {
    fail(
      `modules-doc: ${where} gives no plain-words gloss for ${missing.join(", ")}. The document ` +
        "states what each value means and reads it from there, so it cannot render this.",
    );
  }
  return Object.fromEntries(terms.map((t) => [t, houseDashes(found.get(t).join(" ")).replace(/\s+/g, " ")]));
}

/** The JSDoc block immediately above a named type alias. */
function jsdocAboveAlias(text, sf, aliasName, relPath) {
  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt) || stmt.name.text !== aliasName) continue;
    const ranges = ts.getLeadingCommentRanges(text, stmt.pos) ?? [];
    const last = ranges[ranges.length - 1];
    if (!last) fail(`modules-doc: ${relPath} declares ${aliasName} with no comment above it to read the glosses from`);
    return text.slice(last.pos, last.end);
  }
  return fail(`modules-doc: ${relPath} no longer declares the type ${aliasName}`);
}

/**
 * The file header of `server/lib/modules.ts`, which is where the lifecycle
 * stages are actually defined in words. The gate itself lives in that file, so
 * the sentence describing what `preview` does sits beside the code that does
 * it.
 */
function lifecycleComment(root) {
  const relPath = "server/lib/modules.ts";
  const { text } = sourceFileAt(root, relPath);
  const m = /\/\*\*[\s\S]*?\*\//.exec(text);
  if (!m) fail(`modules-doc: ${relPath} opens with no header comment`);
  if (!/Lifecycle semantics/.test(m[0])) {
    fail(
      `modules-doc: the header of ${relPath} no longer carries a "Lifecycle semantics" block. ` +
        "The document reads what each stage means from there, so it will not guess.",
    );
  }
  return m[0];
}

/**
 * The id-to-filename mapping, parsed with the SAME expression
 * `scripts/check-module-docs.mjs` uses. Two readers disagreeing about what the
 * mapping says would be worse than either being slightly loose.
 */
export function readModuleDocs(root = ROOT) {
  const relPath = "server/lib/knowledge.ts";
  const { text } = sourceFileAt(root, relPath);
  const block = /export const MODULE_DOCS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(text);
  if (!block) {
    fail(
      `modules-doc: could not parse MODULE_DOCS out of ${relPath}. This refuses instead of ` +
        "reporting an empty mapping, because a silent zero here reads as 'no module has a contract' " +
        "and would emit a document claiming every module is undocumented.",
    );
  }
  const out = {};
  for (const m of block[1].matchAll(/([A-Za-z0-9_-]+)\s*:\s*"([^"]+)"/g)) out[m[1]] = m[2];
  if (!Object.keys(out).length) fail(`modules-doc: MODULE_DOCS in ${relPath} parsed to nothing at all`);
  return out;
}

// ── The ModuleDef partition ────────────────────────────────────────────────

/**
 * Where each `ModuleDef` field lands in the document. The value is what the
 * refusal message says when somebody has to decide about a new one.
 */
const RENDERED = {
  id: "the id line and the Id row",
  name: "the section heading",
  description: "the paragraph under the heading",
  core: "the Core column and the core section",
  tier: "the Tier row",
  dataClass: "the Data it holds row",
  group: "the Shelf row, which decides which section it sits in",
  setup: "the Standing it up row",
  requires: "the Requires row and the dependency table",
  recommends: "the Recommends row and the dependency table",
  capabilities: "the Capabilities row",
  variableKeys: "the Variable keys row",
  apiPrefixes: "the API prefixes row",
  hyphaLinks: "the Hypha links row",
  legalReview: "the Legal review row",
  hyphaOnly: "the Display only row",
  sellsToken: "the Sells row",
  provides: "the Domain row",
  builtBy: "the Built by row",
  builtByAccount: "the Built by row",
  builtByNamespace: "the Built by row",
  pricing: "the Price row",
  withdrawn: "the Withdrawn row",
  vendor: "the Counterparty row",
  defaultConfig: "the Config it seeds row, which names the top-level keys",
};

/**
 * Fields this document deliberately leaves out, each with the reason. A field
 * here is a decision somebody made out loud, and it stays readable.
 */
const NOT_RENDERED = {
  readiness:
    "a function the SERVER attaches at boot (`server/lib/modules.ts`), so the shared registry this " +
    "generator imports carries none at all. It answers about one village's own rows.",
  validateConfig:
    "a function that judges a config a village typed. What it accepts belongs in the module's own " +
    "contract doc beside the config itself.",
  openStateCheck:
    "a function the SERVER attaches at boot (`server/index.ts`), so the shared registry this " +
    "generator imports carries none at all. It counts live value in one village at the moment it runs.",
};

/** Every field is rendered or excused, and nothing is claimed that is not a field. */
function checkFieldCoverage(fields) {
  const declared = fields.map((f) => f.name);
  for (const name of declared) {
    const inRendered = name in RENDERED;
    const inExcused = name in NOT_RENDERED;
    if (inRendered && inExcused) {
      fail(`modules-doc: ModuleDef.${name} is listed as both rendered and not rendered in this generator`);
    }
    if (!inRendered && !inExcused) {
      fail(
        `modules-doc: ModuleDef gained the field "${name}" and this document says nothing about it. ` +
          "Add it to RENDERED in scripts/generate-modules-doc.mjs and render it, or add it to " +
          "NOT_RENDERED with the reason a reader deciding what to switch on does not need it. " +
          "A field that reaches a village unmentioned is the drift this file exists to stop.",
      );
    }
  }
  for (const name of [...Object.keys(RENDERED), ...Object.keys(NOT_RENDERED)]) {
    if (declared.includes(name)) continue;
    fail(
      `modules-doc: this generator claims ModuleDef has a field "${name}" and the interface does not ` +
        "declare it any more. Delete the entry, or fix the name.",
    );
  }
  return { declared, excused: Object.keys(NOT_RENDERED) };
}

// ── Facts ──────────────────────────────────────────────────────────────────

const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);

export async function collectFacts(root = ROOT) {
  for (const rel of SOURCES) {
    if (!fs.existsSync(path.join(root, ...rel.split("/")))) {
      fail(`modules-doc: ${rel} is gone; the generator reads it`);
    }
  }

  const registry = await loadShared("modules", root);
  const catalog = await loadShared("moduleCatalog", root);
  const capabilityModule = await loadShared("capabilities", root);

  const modulesSrc = sourceFileAt(root, "shared/modules.ts");
  const fields = interfaceFields(modulesSrc.sf, "ModuleDef", "shared/modules.ts");
  const coverage = checkFieldCoverage(fields);

  const tiers = unionStrings(modulesSrc.sf, "ModuleTier", "shared/modules.ts");
  const dataClasses = unionStrings(modulesSrc.sf, "ModuleDataClass", "shared/modules.ts");
  const setups = unionStrings(modulesSrc.sf, "ModuleSetup", "shared/modules.ts");
  const lifecycles = unionStrings(modulesSrc.sf, "ModuleLifecycle", "shared/modules.ts");
  const groupIds = unionStrings(modulesSrc.sf, "ModuleGroup", "shared/modules.ts");

  const tierGloss = glossary(
    jsdocAboveAlias(modulesSrc.text, modulesSrc.sf, "ModuleTier", "shared/modules.ts"),
    tiers,
    "the comment above ModuleTier in shared/modules.ts",
  );
  const setupGloss = glossary(
    jsdocAboveAlias(modulesSrc.text, modulesSrc.sf, "ModuleSetup", "shared/modules.ts"),
    setups,
    "the comment above ModuleSetup in shared/modules.ts",
  );
  const lifecycleGloss = glossary(
    lifecycleComment(root),
    lifecycles,
    "the Lifecycle semantics block in the header of server/lib/modules.ts",
  );

  const rank = registry.LIFECYCLE_RANK;
  if (!rank || typeof rank !== "object") fail("modules-doc: shared/modules.ts no longer exports LIFECYCLE_RANK");
  const ranked = Object.keys(rank);
  if (ranked.length !== lifecycles.length || lifecycles.some((l) => !(l in rank))) {
    fail(
      `modules-doc: LIFECYCLE_RANK covers ${ranked.join(", ")} and the ModuleLifecycle type says ` +
        `${lifecycles.join(", ")}. The document states the order, so it cannot render two answers.`,
    );
  }
  const lifecycleOrder = [...lifecycles].sort((a, b) => rank[a] - rank[b]);

  const groups = catalog.MODULE_GROUPS;
  if (!Array.isArray(groups) || !groups.length) {
    fail("modules-doc: shared/moduleCatalog.ts no longer exports a MODULE_GROUPS list");
  }
  for (const g of groups) {
    if (typeof g?.id !== "string" || typeof g?.label !== "string" || typeof g?.gloss !== "string") {
      fail(`modules-doc: a MODULE_GROUPS entry is missing an id, a label or a gloss: ${JSON.stringify(g)}`);
    }
  }
  const shelfIds = groups.map((g) => g.id);
  if (shelfIds.length !== groupIds.length || groupIds.some((id) => !shelfIds.includes(id))) {
    fail(
      `modules-doc: the ModuleGroup type says ${groupIds.join(", ")} and MODULE_GROUPS lists ` +
        `${shelfIds.join(", ")}. One shelf with two answers is a shelf this document cannot name.`,
    );
  }

  const allCapabilities = capabilityModule.ALL_CAPABILITIES;
  if (!isStringArray(allCapabilities) || !allCapabilities.length) {
    fail("modules-doc: shared/capabilities.ts no longer exports a non-empty ALL_CAPABILITIES list");
  }

  const raw = registry.MODULES;
  if (!Array.isArray(raw) || !raw.length) fail("modules-doc: shared/modules.ts exported no MODULES array");

  const ids = raw.map((m) => m?.id);
  for (const m of raw) {
    if (typeof m?.id !== "string" || !m.id.trim()) fail(`modules-doc: a registry entry has no id: ${JSON.stringify(m)}`);
    if (ids.filter((i) => i === m.id).length > 1) fail(`modules-doc: the module id "${m.id}" is in the registry twice`);
    for (const key of Object.keys(m)) {
      if (!coverage.declared.includes(key)) {
        fail(`modules-doc: module "${m.id}" carries the key "${key}", which ModuleDef does not declare`);
      }
    }
    for (const key of ["name", "description"]) {
      if (typeof m[key] !== "string" || !m[key].trim()) fail(`modules-doc: module "${m.id}" has no ${key}`);
    }
    if (!tiers.includes(m.tier)) {
      fail(`modules-doc: module "${m.id}" gives its tier as "${m.tier}", which is not one of ${tiers.join(", ")}`);
    }
    if (!dataClasses.includes(m.dataClass)) {
      fail(
        `modules-doc: module "${m.id}" gives its data class as "${m.dataClass}", which is not one of ` +
          dataClasses.join(", "),
      );
    }
    if (m.group !== undefined && !shelfIds.includes(m.group)) {
      fail(`modules-doc: module "${m.id}" sits on the shelf "${m.group}", which MODULE_GROUPS does not list`);
    }
    if (m.setup !== undefined && !setups.includes(m.setup)) {
      fail(`modules-doc: module "${m.id}" declares setup "${m.setup}", which is not one of ${setups.join(", ")}`);
    }
    for (const key of ["requires", "recommends", "capabilities", "variableKeys", "apiPrefixes"]) {
      if (!Array.isArray(m[key]) || m[key].some((x) => typeof x !== "string" || !x.length)) {
        fail(`modules-doc: module "${m.id}" declares ${key} as something other than a list of names`);
      }
    }
    for (const key of ["requires", "recommends"]) {
      for (const dep of m[key]) {
        if (!ids.includes(dep)) {
          fail(`modules-doc: module "${m.id}" ${key} "${dep}", which is not a module in this registry`);
        }
      }
    }
    for (const cap of m.capabilities) {
      if (!allCapabilities.includes(cap)) {
        fail(
          `modules-doc: module "${m.id}" adds the capability "${cap}", which shared/capabilities.ts does ` +
            "not list. There is ONE capability gate, so a key it does not know is a key nothing checks.",
        );
      }
    }
  }

  const names = raw.map((m) => m.name);
  for (const name of names) {
    if (names.filter((n) => n === name).length > 1) {
      fail(`modules-doc: two modules are both called "${name}", so they would share one section heading`);
    }
  }

  const docs = readModuleDocs(root);
  for (const [id, file] of Object.entries(docs)) {
    if (!ids.includes(id)) {
      fail(
        `modules-doc: MODULE_DOCS maps "${id}" to ${file} and no module by that id is in the registry. ` +
          "Run node scripts/check-module-docs.mjs, which owns that pairing.",
      );
    }
    if (!fs.existsSync(path.join(root, "docs", "modules", file))) {
      fail(`modules-doc: MODULE_DOCS points "${id}" at docs/modules/${file}, which is not on disk`);
    }
  }

  const modules = raw.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    core: !!m.core,
    tier: m.tier,
    dataClass: m.dataClass,
    group: m.group ?? null,
    setup: m.setup ?? null,
    requires: [...m.requires],
    recommends: [...m.recommends],
    capabilities: [...m.capabilities],
    variableKeys: [...m.variableKeys],
    apiPrefixes: [...m.apiPrefixes],
    hyphaLinks: m.hyphaLinks ? [...m.hyphaLinks] : [],
    legalReview: !!m.legalReview,
    hyphaOnly: !!m.hyphaOnly,
    sellsToken: m.sellsToken ?? null,
    provides: m.provides ?? null,
    builtBy: m.builtBy ?? null,
    builtByAccount: m.builtByAccount ?? null,
    builtByNamespace: m.builtByNamespace ?? null,
    pricing: m.pricing ?? null,
    withdrawn: m.withdrawn ?? null,
    vendor: m.vendor ? { legalName: m.vendor.legalName, url: m.vendor.url, supportEmail: m.vendor.supportEmail } : null,
    configKeys: m.defaultConfig ? Object.keys(m.defaultConfig) : [],
    doc: docs[m.id] ?? null,
  }));

  /**
   * A game-variable key claimed by two modules. Read instead of typed, because
   * `payments.purchase_limit_*` sits on both `stays` and `exchange` today and
   * a reader switching one off deserves to know the other still owns the dial.
   */
  const owners = new Map();
  for (const m of modules) {
    for (const key of m.variableKeys) {
      if (!owners.has(key)) owners.set(key, []);
      owners.get(key).push(m.id);
    }
  }
  const sharedKeys = Array.from(owners.entries())
    .filter(([, who]) => who.length > 1)
    .map(([key, who]) => ({ key, modules: who }))
    .sort((a, b) => a.key.localeCompare(b.key));

  /** Who would be blocked from switching off, read from the other side. */
  for (const m of modules) {
    m.requiredBy = modules.filter((o) => o.requires.includes(m.id)).map((o) => o.id);
    m.recommendedBy = modules.filter((o) => o.recommends.includes(m.id)).map((o) => o.id);
  }

  return {
    modules,
    core: modules.filter((m) => m.core),
    optional: modules.filter((m) => !m.core),
    groups,
    tiers,
    tierGloss,
    dataClasses,
    setups,
    setupGloss,
    lifecycles: lifecycleOrder,
    lifecycleGloss,
    lifecycleRank: Object.fromEntries(lifecycleOrder.map((l) => [l, rank[l]])),
    capabilityCount: allCapabilities.length,
    contractVersion: registry.MODULE_LIBRARY_CONTRACT_VERSION ?? null,
    sharedVariableKeys: sharedKeys,
    notRendered: NOT_RENDERED,
    excusedFields: coverage.excused,
  };
}

// ── Rendering ──────────────────────────────────────────────────────────────

const NUMBER_WORDS = [
  "no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty",
];
const word = (n) => NUMBER_WORDS[n] ?? String(n);
/** The same count, for the start of a sentence. */
const Word = (n) => word(n).replace(/^./, (c) => c.toUpperCase());

const code = (s) => `\`${s}\``;
const codeList = (list, empty) => (list.length ? list.map(code).join(", ") : empty);

/**
 * A table cell. Backslash FIRST, then pipe: escaping the pipe alone turns an
 * input of `a\|b` into `a\\|b`, which markdown reads as an escaped backslash
 * followed by a LIVE pipe, so the cell being protected opens a new column
 * instead. Whitespace collapses for the same reason: a row is one line.
 */
const cell = (s) =>
  String(s).replace(/\s+/g, " ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

function table(headers, rows) {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const r of rows) lines.push(`| ${r.map(cell).join(" | ")} |`);
  return lines.join("\n");
}

/** The shelf label for a module, for a cell that has to read as words. */
function shelfLabel(f, id) {
  const g = f.groups.find((x) => x.id === id);
  return g ? g.label : "none declared";
}

function docCell(m) {
  return m.doc ? `[${m.doc}](modules/${m.doc})` : "none yet";
}

function moduleSection(m, f) {
  const lines = [];
  lines.push(`### ${m.name}`);
  lines.push("");
  lines.push(m.description);
  lines.push("");

  const rows = [
    ["Id", code(m.id)],
    ["Shelf", m.group ? `${shelfLabel(f, m.group)} (${code(m.group)})` : "none declared"],
    [
      "A village can switch it off",
      m.core
        ? "no. It is core, so it is always public and the lifecycle route refuses to move it"
        : `yes, and it ships off. An admin moves it to ${f.lifecycles.filter((l) => l !== "off").map(code).join(", ")}`,
    ],
    // The tier gloss runs to several sentences and is stated once, in the
    // vocabulary section above. Repeating it in twenty-three tables would bury
    // the fields that differ between one module and the next.
    ["Tier", code(m.tier)],
    ["Data it holds", code(m.dataClass)],
    ["Standing it up", m.setup ? `${code(m.setup)}, ${f.setupGloss[m.setup]}` : "not declared"],
    ["Requires", m.requires.length ? codeList(m.requires) : "nothing"],
    ["Recommends", m.recommends.length ? codeList(m.recommends) : "nothing"],
    ["Capabilities it adds", codeList(m.capabilities, "none")],
    ["Variable keys it owns", codeList(m.variableKeys, "none")],
    ["API prefixes", codeList(m.apiPrefixes, "none")],
    ["Contract doc", docCell(m)],
  ];
  if (m.requiredBy.length) {
    rows.push([
      "Switching it off is blocked by",
      `${codeList(m.requiredBy)}, which require${m.requiredBy.length === 1 ? "s" : ""} it while non-off`,
    ]);
  }
  if (m.configKeys.length) rows.push(["Config it seeds", codeList(m.configKeys)]);
  if (m.legalReview) rows.push(["Legal caution card", "yes. Enabling shows it first, and preconditions can refuse outright"]);
  if (m.sellsToken) rows.push(["Sells", `${code(m.sellsToken)}, and it is the only module allowed to sell that slug`]);
  if (m.hyphaOnly) rows.push(["Display only", "yes. Deep links to Base, and never a mint path"]);
  if (m.hyphaLinks.length) rows.push(["Hypha links", codeList(m.hyphaLinks)]);
  if (m.provides) rows.push(["Domain", code(m.provides)]);
  if (m.builtBy) {
    rows.push([
      "Built by",
      m.builtByAccount
        ? `${m.builtBy}, account ${code(m.builtByAccount)} on ${code(m.builtByNamespace ?? "an unnamed system")}`
        : m.builtBy,
    ]);
  }
  if (m.vendor) rows.push(["Counterparty", `${m.vendor.legalName}, ${m.vendor.url}, support ${m.vendor.supportEmail}`]);
  if (m.pricing) {
    rows.push([
      "Price",
      `${m.pricing.amount} minor units of ${m.pricing.currency} per ${m.pricing.period}, billed at ${m.pricing.billingUrl}`,
    ]);
  }
  if (m.withdrawn) {
    rows.push([
      "Withdrawn",
      `${m.withdrawn.since}. A village already running it keeps running it` +
        (m.withdrawn.replacedBy ? `, and ${code(m.withdrawn.replacedBy)} replaces it for a new one` : ""),
    ]);
  }
  lines.push(table(["Fact", "Value"], rows));
  return lines.join("\n");
}

export function render(f) {
  const L = [];
  const p = (s = "") => L.push(s);

  p("# Modules");
  p();
  p(
    `Everything a village can run: ${word(f.modules.length)} modules, what each one is, what it needs, what it ` +
      "adds to the one capability gate, which dials it owns, and where its routes live.",
  );
  p();
  p(
    "This is the registry, read out loud. It describes the platform a fork inherits, and it says nothing about any " +
      "one village: which modules are actually on is a village's own decision, held in its `module_settings` table.",
  );
  p();

  p("## How to read this file");
  p();
  p(
    "This file is generated. `scripts/generate-modules-doc.mjs` reads `shared/modules.ts` and the files listed at the " +
      "end, works out the facts, and writes the whole document. `scripts/check-modules-doc.mjs` regenerates it and " +
      "fails the build when the committed text and the code have come apart.",
  );
  p();
  p("Editing this file by hand does not hold. Change the code, then run:");
  p();
  p("```bash");
  p("node scripts/generate-modules-doc.mjs");
  p("```");
  p();
  p(
    "Every number, every list and every name below is read from the code. If one of them is wrong, the code is what " +
      "is wrong. The only sentences a person wrote are the framing ones, and they are kept inside the generator so " +
      "this whole file stays generated.",
  );
  p();
  p(
    "There is no timestamp and no author line, on purpose. Both would change on every run and turn an honest diff " +
      "into noise. The git history is the record of when this changed.",
  );
  p();

  p("## What a module can be");
  p();
  p("### Lifecycle");
  p();
  p(
    `A village holds one of ${word(f.lifecycles.length)} postures per module, ranked ` +
      `${f.lifecycles.join(" < ")}. An absent \`module_settings\` row means \`off\`, so a fork inherits every new ` +
      "platform module switched off and turning one on is always a deliberate admin act.",
  );
  p();
  p(
    table(
      ["Stage", "Rank", "What it means"],
      f.lifecycles.map((l) => [code(l), String(f.lifecycleRank[l]), f.lifecycleGloss[l]]),
    ),
  );
  p();
  p(
    "The four core modules sit outside that. They are always public and the lifecycle route refuses to move them, " +
      "which is why they are listed first below.",
  );
  p();

  p("### Tier, which says who bills and who supports");
  p();
  p(
    table(
      ["Tier", "What it means"],
      f.tiers.map((t) => [code(t), f.tierGloss[t]]),
    ),
  );
  p();
  const tierCounts = f.tiers
    .map((t) => ({ t, n: f.modules.filter((m) => m.tier === t).length }))
    .filter((x) => x.n > 0);
  p(
    `Today the registry holds ${tierCounts.map((x) => `${word(x.n)} at ${code(x.t)}`).join(", ")}. ` +
      `The tier is a label and never a gate: enabling a module makes no network call, reads no secret and checks ` +
      `no licence. Listings are accepted under contract version ${f.contractVersion ?? "an unreadable version"}.`,
  );
  p();

  p("### The data a module holds");
  p();
  p(
    `Read as the widest thing in the module's own tables: ${f.dataClasses.map(code).join(", ")}. A booking, an RSVP, ` +
      "a loan and a private message all identify a named person, which is why most of this platform carries " +
      "`member-pii`. The gate hanging off it applies at every tier: nothing marked `member-pii` goes live behind a " +
      "vendor driver without a signed processing agreement, a documented hard-delete endpoint, and a `forgetMember` " +
      "driver wired into the deletion sweep that fails visibly when it cannot confirm.",
  );
  p();
  p(
    table(
      ["Data class", "Modules"],
      f.dataClasses.map((d) => {
        const who = f.modules.filter((m) => m.dataClass === d);
        return [code(d), who.length ? `${word(who.length)}: ${codeList(who.map((m) => m.id))}` : "none"];
      }),
    ),
  );
  p();

  p("### What standing one up looks like");
  p();
  p(
    table(
      ["Setup", "What it means", "Modules"],
      f.setups.map((s) => {
        const who = f.modules.filter((m) => m.setup === s);
        return [code(s), f.setupGloss[s], who.length ? codeList(who.map((m) => m.id)) : "none"];
      }),
    ),
  );
  p();

  p("### The shelves");
  p();
  p(
    table(
      ["Shelf", "Id", "What is on it", "Modules"],
      f.groups.map((g) => {
        const who = f.modules.filter((m) => m.group === g.id);
        return [g.label, code(g.id), g.gloss, String(who.length)];
      }),
    ),
  );
  p();

  p("## The whole library at a glance");
  p();
  p(
    table(
      ["Module", "Id", "Shelf", "Core", "Tier", "Data", "Setup", "Contract doc"],
      [...f.core, ...f.optional].map((m) => [
        m.name,
        code(m.id),
        m.group ? shelfLabel(f, m.group) : "none",
        m.core ? "yes" : "no",
        m.tier,
        m.dataClass,
        m.setup ?? "not declared",
        docCell(m),
      ]),
    ),
  );
  p();
  const documented = f.modules.filter((m) => m.doc).length;
  p(
    `That is ${word(f.modules.length)} modules, ${word(f.core.length)} of them core. ${Word(documented)} carry a ` +
      `contract doc under \`docs/modules/\` and ${word(f.modules.length - documented)} do not yet; ` +
      "`node scripts/check-module-docs.mjs` holds that second number to a ratchet that only ever falls. " +
      "Filenames there do not follow module ids, so the mapping is real data and lives in `MODULE_DOCS` in " +
      "`server/lib/knowledge.ts`, which is where this table reads it.",
  );
  p();

  p(`## The ${word(f.core.length)} core modules`);
  p();
  p(
    "A village cannot switch these off. They are always public, they ship with the platform, and the game the " +
      "platform is born playing is made of them. Everything after this section is a choice.",
  );
  p();
  for (const m of f.core) {
    p(moduleSection(m, f));
    p();
  }

  for (const g of f.groups) {
    const members = f.optional.filter((m) => m.group === g.id);
    if (!members.length) continue;
    p(`## ${g.label}`);
    p();
    p(g.gloss);
    p();
    const coreHere = f.core.filter((m) => m.group === g.id);
    if (coreHere.length) {
      p(
        `${codeList(coreHere.map((m) => m.id))} also sit${coreHere.length === 1 ? "s" : ""} on this shelf and ` +
          `${coreHere.length === 1 ? "is" : "are"} described above with the core modules.`,
      );
      p();
    }
    for (const m of members) {
      p(moduleSection(m, f));
      p();
    }
  }

  const orphans = f.optional.filter((m) => !m.group);
  if (orphans.length) {
    p("## On no shelf");
    p();
    p(
      "These declare no group. The catalog has nowhere to put them, and `shared/moduleCatalog.test.ts` fails the " +
        "build over it, so this section should be empty.",
    );
    p();
    for (const m of orphans) {
      p(moduleSection(m, f));
      p();
    }
  }

  p("## What depends on what");
  p();
  p(
    "A hard dependency blocks both directions: a module cannot be enabled while something it requires is off, and " +
      "something it requires cannot be switched off while it is on. A missing dependency demotes a module to `off` " +
      "at boot. A soft dependency warns in the admin panel and blocks nothing.",
  );
  p();
  const hard = f.modules.filter((m) => m.requires.length);
  const loadBearing = f.modules.filter((m) => m.requiredBy.length);
  p(
    hard.length
      ? table(
          ["Module", "Requires"],
          hard.map((m) => [code(m.id), codeList(m.requires)]),
        )
      : "No module requires another today.",
  );
  p();
  if (loadBearing.length) {
    p(
      `Read the other way: ${loadBearing
        .map((m) => `${code(m.id)} cannot be switched off while ${codeList(m.requiredBy)} is on`)
        .join(", ")}.`,
    );
    p();
  }
  const soft = f.modules.filter((m) => m.recommends.length);
  p(
    soft.length
      ? table(
          ["Module", "Recommends"],
          soft.map((m) => [code(m.id), codeList(m.recommends)]),
        )
      : "No module recommends another today.",
  );
  p();

  p("## The dials a module owns");
  p();
  p(
    `Game variables are namespaced, and Admin hides a namespace while its module is off. Between them the ` +
      `${word(f.modules.length)} modules own ` +
      `${f.modules.reduce((n, m) => n + m.variableKeys.length, 0)} keys. A key here is a DEFAULT: the database ` +
      "stores changed values only, and a village that has never touched a dial inherits the platform's answer.",
  );
  p();
  if (f.sharedVariableKeys.length) {
    p(
      `${Word(f.sharedVariableKeys.length)} key${f.sharedVariableKeys.length === 1 ? " is" : "s are"} claimed by more ` +
        "than one module, so switching one module off leaves the dial owned by the other:",
    );
    p();
    p(
      table(
        ["Key", "Claimed by"],
        f.sharedVariableKeys.map((s) => [code(s.key), codeList(s.modules)]),
      ),
    );
  } else {
    p("No key is claimed by two modules.");
  }
  p();

  p("## Capabilities");
  p();
  const withCaps = f.modules.filter((m) => m.capabilities.length);
  p(
    `A module ADDS capability keys to the one gate in \`shared/capabilities.ts\`, which holds ` +
      `${word(f.capabilityCount)} keys in total. It never becomes a second permission mechanism. The order of the ` +
      "one gate is admin, then badge denies, then role, then badge grants, then stage: a badge deny beats role and " +
      `stage, and only admin outranks it. ${Word(withCaps.length)} modules add keys:`,
  );
  p();
  p(
    table(
      ["Module", "Capabilities"],
      withCaps.map((m) => [code(m.id), codeList(m.capabilities)]),
    ),
  );
  p();

  p("## Machine-readable");
  p();
  p(
    "The same facts, for anything that would rather parse than read. Regenerated with the rest of the file, so it " +
      "cannot drift from the prose above it.",
  );
  p();
  p("```json");
  p(
    JSON.stringify(
      {
        moduleCount: f.modules.length,
        coreCount: f.core.length,
        lifecycle: f.lifecycleRank,
        contractVersion: f.contractVersion,
        modules: f.modules.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          core: m.core,
          tier: m.tier,
          dataClass: m.dataClass,
          group: m.group,
          setup: m.setup,
          requires: m.requires,
          recommends: m.recommends,
          capabilities: m.capabilities,
          variableKeys: m.variableKeys,
          apiPrefixes: m.apiPrefixes,
          contractDoc: m.doc ? `docs/modules/${m.doc}` : null,
        })),
      },
      null,
      2,
    ),
  );
  p("```");
  p();

  p("## What this file is made from");
  p();
  p("The generator reads these and fails loudly if any of them moves:");
  p();
  for (const rel of SOURCES) p(`- \`${rel}\``);
  p();
  p(
    "The registry itself is transpiled and imported, so the values here are the values the server and the client " +
      "load. The vocabularies are parsed out of their type declarations with the TypeScript compiler, because types " +
      "erase during transpilation, and the plain-words gloss for each value is lifted from the comment that declares " +
      "it. A value with no gloss stops the build.",
  );
  p();
  p(
    `${Word(f.excusedFields.length)} \`ModuleDef\` field` +
      `${f.excusedFields.length === 1 ? " is" : "s are"} left out of this document on purpose, ` +
      "and the reason travels with the decision:",
  );
  p();
  for (const name of f.excusedFields) p(`- \`${name}\`: ${f.notRendered[name]}`);
  p();
  p(
    "A field that is neither rendered nor on that list stops the build. A registry field reaches every village, " +
      "so this document either states it or says out loud why it does not.",
  );
  p();
  p(
    "`node scripts/module-facts.mjs` prints the same registry as a terminal report along with the CI gates, and " +
      "`node scripts/validate-module.mjs <id>` lints one listing before a pull request.",
  );

  return L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export async function generate(root = ROOT) {
  return render(await collectFacts(root));
}

/** The document and the facts behind it, for callers that want to report on both. */
export async function generateDetailed(root = ROOT) {
  const facts = await collectFacts(root);
  return { text: render(facts), facts };
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

if (invokedDirectly) {
  try {
    const text = await generate();
    if (process.argv.includes("--stdout")) {
      process.stdout.write(text);
    } else {
      fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
      fs.writeFileSync(DOC_PATH, text, "utf8");
      process.stdout.write(`wrote docs/MODULES.md (${text.split("\n").length} lines)\n`);
    }
  } catch (err) {
    process.stderr.write(`\n${err instanceof ReadError ? err.message : (err?.stack ?? String(err))}\n\n`);
    process.exit(1);
  }
}
