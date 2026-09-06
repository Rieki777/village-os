/**
 * NO SHEBANG, the same as scripts/generate-token-doc.mjs and for the same
 * reason: a shebang together with CRLF line endings makes Vite's transform
 * throw `SyntaxError: Invalid or unexpected token`, and `core.autocrlf` is true
 * on the Windows checkouts this repository is developed on. That file was
 * imported by a Vitest test and went red on a rebase. Nothing imports this one
 * through Vite today, and the cheapest way to keep that door shut is to not
 * open it. Every caller runs `node scripts/generate-variables-doc.mjs`, so the
 * shebang would buy nothing. The self-test asserts the line is still absent.
 */
/**
 * docs/VARIABLES.md: the game variables, written from the registry.
 *
 * WHY THIS DOCUMENT EXISTS. `shared/gameVariables.ts` carries every dial a
 * village can turn, and each one already declares a key, a category, a human
 * label, a description written for a founder, a type, a default and its bounds.
 * That is documentation the people who built each dial already wrote, and until
 * this generator existed it was rendered for a human NOWHERE. A founder's
 * central question is "what can I change about my village, and what happens if
 * I do", and the only answer on offer was reading TypeScript.
 *
 * WHY IT IS GENERATED. A hand-written version of this file would be wrong
 * within a month and nothing would say so. There are 150 dials today and the
 * count only moves. So this reads the registry, derives the facts, and emits
 * the document; `scripts/check-variables-doc.mjs` regenerates it and fails the
 * build when the emitted text and the committed text differ. The check is what
 * makes the document trustworthy. Without it this is a beautiful thing that
 * lies.
 *
 * HOW IT READS THE VALUES. By transpiling the TypeScript and importing it, the
 * way `loadShared` in scripts/module-facts.mjs does. A regex over the registry
 * reads a shorter truth the first time somebody reformats it, and a shorter
 * truth is the exact failure this whole mechanism exists to prevent. Two of the
 * three categories of dial are BUILT at module load out of `GAME_CONFIG.stages`
 * and `STAGE_UNLOCKS` (28 of the 150 today), so a reader of the array literal
 * alone would miss a fifth of the registry and look complete doing it.
 *
 * EVERY READER THROWS ON A SHAPE IT DOES NOT RECOGNISE. A new field on
 * `VariableDef`, a new member of `VariableType`, a new ring, a dial with no
 * description, a `choice` with no choices, a relative import the loader cannot
 * follow: each one stops the build and names itself. A generator that quietly
 * produces a shorter document is worse than no generator, because the document
 * keeps rendering and silently loses a dial.
 *
 * Usage:
 *   node scripts/generate-variables-doc.mjs            write docs/VARIABLES.md
 *   node scripts/generate-variables-doc.mjs --stdout   print it, write nothing
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
);

export const DOC_PATH = path.join(ROOT, "docs", "VARIABLES.md");

/**
 * Every file this document is derived from: the registry plus the modules it
 * imports values from, because those decide a third of the defaults.
 *
 * The loader walks the registry's own imports and refuses to read a file that
 * is not on this list, so a new import into `shared/gameVariables.ts` stops the
 * build here and names the file it wanted to add.
 */
export const SOURCES = [
  "shared/gameVariables.ts",
  "shared/gameConfig.ts",
  "shared/capabilities.ts",
  "shared/villageMoon.ts",
];

/** The one file the walk starts from. Everything else is discovered. */
export const ENTRY = "shared/gameVariables.ts";

class ReadError extends Error {}

function fail(message) {
  throw new ReadError(message);
}

// ── Loading: transpile the registry and import it, values and all ────────────

/** Relative module specifiers a file imports, type-only imports left out. */
function relativeSpecifiers(sourceFile, rel) {
  const out = [];
  const consider = (spec, isTypeOnly) => {
    if (!ts.isStringLiteral(spec)) return;
    const text = spec.text;
    if (isTypeOnly) return;
    if (!text.startsWith(".")) {
      fail(
        `variables-doc: ${rel} imports "${text}", which is not a relative path. This loader ` +
          "transpiles the registry into a scratch directory where a package cannot be resolved. " +
          "Teach scripts/generate-variables-doc.mjs how to supply it.",
      );
    }
    if (!/^\.\/[A-Za-z0-9_-]+$/.test(text)) {
      fail(
        `variables-doc: ${rel} imports "${text}". This loader follows sibling modules inside ` +
          `shared/ only, in the form "./name". Teach scripts/generate-variables-doc.mjs the shape.`,
      );
    }
    out.push(text.slice(2));
  };

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      consider(stmt.moduleSpecifier, !!stmt.importClause?.isTypeOnly);
      continue;
    }
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
      consider(stmt.moduleSpecifier, !!stmt.isTypeOnly);
    }
  }

  // A dynamic import would be erased from the walk and then fail at run time
  // with a resolver error twenty frames deep, so it is refused here by name.
  const walk = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        fail(
          `variables-doc: ${rel} carries a dynamic import of "${arg.text}". This loader follows ` +
            "static imports only. Teach scripts/generate-variables-doc.mjs the shape.",
        );
      }
    }
    node.forEachChild(walk);
  };
  walk(sourceFile);

  return out;
}

/** One shared module, transpiled to ESM that resolves inside the scratch dir. */
function transpile(src) {
  return ts
    .transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(/(from\s+")(\.\/[A-Za-z0-9_-]+)(")/g, "$1$2.mjs$3");
}

/**
 * The registry, loaded as VALUES, plus the source tree of the entry file so the
 * shapes it declares can be read as well.
 *
 * Returns { module, entrySource, filesRead }.
 */
export async function loadRegistry(root = ROOT) {
  const entryAbs = path.join(root, ...ENTRY.split("/"));
  if (!fs.existsSync(entryAbs)) {
    fail(`variables-doc: ${ENTRY} is gone; the generator reads it`);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "variables-doc-"));
  try {
    const seen = new Set();
    const queue = ["gameVariables"];
    const filesRead = [];
    let entrySource = null;

    while (queue.length) {
      const name = queue.shift();
      if (seen.has(name)) continue;
      seen.add(name);

      const rel = `shared/${name}.ts`;
      const abs = path.join(root, "shared", `${name}.ts`);
      if (!fs.existsSync(abs)) {
        fail(`variables-doc: ${rel} is imported by the registry and is not on disk`);
      }
      if (!SOURCES.includes(rel)) {
        fail(
          `variables-doc: the registry now reads ${rel}, which is not in SOURCES. Add it to ` +
            "SOURCES in scripts/generate-variables-doc.mjs so the checker's --list stays honest " +
            "about what this document is made from.",
        );
      }

      const src = fs.readFileSync(abs, "utf8");
      const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.ES2022, true);
      if (name === "gameVariables") entrySource = sf;
      for (const dep of relativeSpecifiers(sf, rel)) queue.push(dep);
      fs.writeFileSync(path.join(dir, `${name}.mjs`), transpile(src), "utf8");
      filesRead.push(rel);
    }

    /*
     * A fresh scratch directory per call, which also means a fresh module URL
     * per call. Node caches an imported module by URL for the life of the
     * process, so reusing one directory would hand the second call the first
     * call's module and make the determinism check in the self-test prove
     * nothing at all.
     */
    const module = await import(pathToFileURL(path.join(dir, "gameVariables.mjs")).href);
    return { module, entrySource, filesRead: filesRead.sort() };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Shapes: read the declarations, because types do not survive transpiling ──

/** The string members of a union type alias, or a refusal. */
export function unionMembers(sourceFile, aliasName) {
  for (const stmt of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(stmt) || stmt.name.text !== aliasName) continue;
    const node = stmt.type;
    const parts = ts.isUnionTypeNode(node) ? node.types : [node];
    const members = parts
      .filter((p) => ts.isLiteralTypeNode(p) && ts.isStringLiteral(p.literal))
      .map((p) => p.literal.text);
    if (!members.length) {
      fail(
        `variables-doc: ${aliasName} in ${ENTRY} is no longer a union of string literals, so the ` +
          "generator cannot tell which values are legal.",
      );
    }
    return members;
  }
  return fail(`variables-doc: ${ENTRY} no longer declares the type ${aliasName}`);
}

/** The property names an interface declares, in declaration order. */
export function interfaceMembers(sourceFile, name) {
  for (const stmt of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(stmt) || stmt.name.text !== name) continue;
    return stmt.members
      .filter(ts.isPropertySignature)
      .map((m) => m.name.getText(sourceFile).replace(/^["']|["']$/g, ""));
  }
  return fail(`variables-doc: ${ENTRY} no longer declares the interface ${name}`);
}

/**
 * Every field of `VariableDef` this document renders.
 *
 * Checked against the interface in both directions. A field added to the
 * interface and forgotten here would be a fact about every dial that the
 * document silently stops carrying, which is the failure mode this generator
 * exists to prevent, so it stops the build instead.
 */
const RENDERED_FIELDS = [
  "key",
  "category",
  "label",
  "description",
  "type",
  "default",
  "min",
  "max",
  "choices",
  "unit",
  "ring",
  "applyTiming",
];

/** What each type means, in a founder's words. Every member needs one. */
const TYPE_GLOSS = {
  integer: "a whole number",
  decimal: "a number, fractions allowed",
  percentage: "a percentage",
  boolean: "on or off",
  choice: "one of a fixed list",
  text: "free text",
};

/** Who may move a dial. Every ring needs one. */
const RING_GLOSS = {
  open: {
    short: "the whole village",
    long:
      "Community-governable. These are the dials the village decides together, through the " +
      "proposal loop. A founder can close one of these to their community; the platform ceiling " +
      "says it may be open.",
  },
  founder: {
    short: "the founder or an admin",
    long:
      "Founder-held. Legal posture, infrastructure, privacy windows and abuse guards. They stay " +
      "visible to everybody and they are never proposable. Nothing can open one of these to the " +
      "village.",
  },
};

/** When a passed change lands. Every timing needs one. */
const TIMING_GLOSS = {
  instant: {
    short: "as soon as it is saved",
    long: "The new value is live immediately.",
  },
  "cycle-close": {
    short: "at the next cycle close",
    long:
      "Changing one of these mid-cycle would move the basis a settlement is already being " +
      "measured against, so the new value waits for the cycle to close. That gap is deliberate: " +
      "it gives the village the window between a decision passing and the decision biting.",
  },
};

/** Both directions, so a new member cannot ship unexplained and a gloss cannot outlive its member. */
function glossCoverage(what, members, gloss) {
  for (const member of members) {
    if (member in gloss) continue;
    fail(
      `variables-doc: ${what} gained "${member}" and the generator has no plain words for it. ` +
        `Add one to the gloss in scripts/generate-variables-doc.mjs. A ${what} value nobody can ` +
        "describe in one line is one nobody can explain to a founder.",
    );
  }
  for (const member of Object.keys(gloss)) {
    if (members.includes(member)) continue;
    fail(
      `variables-doc: the generator describes the ${what} value "${member}", which ${ENTRY} no ` +
        "longer declares. Delete the gloss or fix the name.",
    );
  }
}

// ── Facts ────────────────────────────────────────────────────────────────────

const isString = (v) => typeof v === "string";

/** One dial, checked field by field. Anything unreadable stops the build. */
function readVariable(def, index, types, rings, timings, ringOf, applyTimingOf) {
  const where = isString(def?.key) && def.key ? `"${def.key}"` : `at position ${index}`;
  if (!def || typeof def !== "object") fail(`variables-doc: the entry ${where} is not an object`);

  for (const field of ["key", "category", "label", "description", "type", "default"]) {
    if (!isString(def[field])) {
      fail(`variables-doc: the dial ${where} has no ${field}, and every dial needs one`);
    }
    // `default` is legitimately blank on the dozen address and link dials a
    // village fills in itself. Everything else blank is a dial nobody can read.
    if (field !== "default" && !def[field].trim()) {
      fail(`variables-doc: the dial ${where} has an empty ${field}, and every dial needs one`);
    }
  }
  if (!types.includes(def.type)) {
    fail(
      `variables-doc: the dial "${def.key}" is of type "${def.type}", which is not a member of ` +
        `VariableType (${types.join(", ")}).`,
    );
  }
  for (const bound of ["min", "max"]) {
    if (def[bound] === undefined) continue;
    if (typeof def[bound] !== "number" || !Number.isFinite(def[bound])) {
      fail(`variables-doc: the dial "${def.key}" has a ${bound} that is not a finite number`);
    }
  }
  if (def.min !== undefined && def.max !== undefined && def.min > def.max) {
    fail(`variables-doc: the dial "${def.key}" has a min above its max, so no value satisfies it`);
  }
  if (def.unit !== undefined && (!isString(def.unit) || !def.unit.trim())) {
    fail(`variables-doc: the dial "${def.key}" has a unit that is not a word`);
  }
  if (def.type === "choice" && (!Array.isArray(def.choices) || def.choices.length === 0)) {
    fail(
      `variables-doc: the dial "${def.key}" is a choice and carries no choices, so neither this ` +
        "document nor Admin can say what may be picked.",
    );
  }
  if (def.type !== "choice" && def.choices !== undefined) {
    fail(`variables-doc: the dial "${def.key}" carries choices and is not of type choice`);
  }
  const choices = (def.choices ?? []).map((choice, n) => {
    if (!isString(choice?.value) || !isString(choice?.label)) {
      fail(`variables-doc: choice ${n + 1} of the dial "${def.key}" has no value and label pair`);
    }
    if (choice.hint !== undefined && !isString(choice.hint)) {
      fail(`variables-doc: choice "${choice.value}" of the dial "${def.key}" has an unreadable hint`);
    }
    return { value: choice.value, label: choice.label, hint: choice.hint ?? null };
  });

  const ring = ringOf(def);
  if (!rings.includes(ring)) {
    fail(`variables-doc: ringOf() answers "${ring}" for "${def.key}", which is not a VariableRing`);
  }
  const applyTiming = applyTimingOf(def);
  if (!timings.includes(applyTiming)) {
    fail(
      `variables-doc: applyTimingOf() answers "${applyTiming}" for "${def.key}", which is not a ` +
        "VariableApplyTiming",
    );
  }

  return {
    key: def.key,
    category: def.category,
    label: def.label,
    description: def.description,
    type: def.type,
    default: def.default,
    min: def.min ?? null,
    max: def.max ?? null,
    unit: def.unit ?? null,
    choices,
    ring,
    ringExplicit: def.ring !== undefined,
    applyTiming,
    applyTimingExplicit: def.applyTiming !== undefined,
  };
}

export async function collectFacts(root = ROOT) {
  const { module, entrySource, filesRead } = await loadRegistry(root);

  for (const name of ["VARIABLES", "ringOf", "applyTimingOf", "validateVariable"]) {
    if (module[name] === undefined) {
      fail(`variables-doc: ${ENTRY} no longer exports ${name}, and the generator reads it`);
    }
  }
  const { VARIABLES, ringOf, applyTimingOf, validateVariable } = module;
  if (!Array.isArray(VARIABLES) || VARIABLES.length === 0) {
    fail(`variables-doc: ${ENTRY} exports no variables at all, which is never a document`);
  }

  const declaredFields = interfaceMembers(entrySource, "VariableDef");
  const missing = declaredFields.filter((f) => !RENDERED_FIELDS.includes(f));
  if (missing.length) {
    fail(
      `variables-doc: VariableDef declares ${missing.join(", ")}, which this document does not ` +
        "render. Add the field to RENDERED_FIELDS in scripts/generate-variables-doc.mjs and put " +
        "it in the rendering, so a fact every dial carries cannot go missing quietly.",
    );
  }
  const stale = RENDERED_FIELDS.filter((f) => !declaredFields.includes(f));
  if (stale.length) {
    fail(
      `variables-doc: this generator renders ${stale.join(", ")}, which VariableDef no longer ` +
        "declares. Fix the name or drop it from RENDERED_FIELDS.",
    );
  }

  const types = unionMembers(entrySource, "VariableType");
  const rings = unionMembers(entrySource, "VariableRing");
  const timings = unionMembers(entrySource, "VariableApplyTiming");
  glossCoverage("VariableType", types, TYPE_GLOSS);
  glossCoverage("VariableRing", rings, RING_GLOSS);
  glossCoverage("VariableApplyTiming", timings, TIMING_GLOSS);

  const variables = VARIABLES.map((def, i) =>
    readVariable(def, i, types, rings, timings, ringOf, applyTimingOf),
  );

  const seen = new Set();
  for (const v of variables) {
    if (seen.has(v.key)) {
      fail(`variables-doc: the key "${v.key}" is declared twice, so one of them edits nothing`);
    }
    seen.add(v.key);
  }

  /*
   * A default that the platform's own validator refuses is a dial a founder
   * cannot save without changing first, and a document printing it as "the
   * default" would be describing a value the village never had. The registry's
   * own validateVariable is the authority, so the check costs one call.
   */
  variables.forEach((v, i) => {
    // `variables` is a 1:1 projection of VARIABLES, so the index is the def.
    const problem = validateVariable(VARIABLES[i], v.default);
    if (problem) {
      fail(
        `variables-doc: the default for "${v.key}" is ${JSON.stringify(v.default)}, and the ` +
          `registry's own validateVariable refuses it: ${problem}`,
      );
    }
  });

  // Categories in the order the registry declares them, which is the order the
  // people who built the game grouped it in.
  const categories = [];
  for (const v of variables) {
    let category = categories.find((c) => c.name === v.category);
    if (!category) {
      category = { name: v.category, variables: [] };
      categories.push(category);
    }
    category.variables.push(v);
  }
  for (const category of categories) {
    for (const ring of rings) {
      category[ring] = category.variables.filter((v) => v.ring === ring).length;
    }
  }

  const countBy = (field, members) =>
    members.map((m) => ({ name: m, count: variables.filter((v) => v[field] === m).length }));

  /*
   * A label appears as a heading. Two dials sharing one would render two
   * identical headings inside a document a founder searches by name, so the
   * key is appended to both. Deterministic, and it costs nothing when labels
   * are unique, which they are today.
   */
  const labelCounts = new Map();
  for (const v of variables) labelCounts.set(v.label, (labelCounts.get(v.label) ?? 0) + 1);
  for (const v of variables) {
    v.heading = labelCounts.get(v.label) > 1 ? `${v.label} (${v.key})` : v.label;
  }

  return {
    variables,
    categories,
    types,
    rings,
    timings,
    byType: countBy("type", types),
    byRing: countBy("ring", rings),
    byTiming: countBy("applyTiming", timings),
    boundedCount: variables.filter((v) => v.min !== null || v.max !== null).length,
    filesRead,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** A table cell: no newlines, and no pipe that would open a column. */
const cell = (value) => String(value).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();

function table(headers, rows) {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const row of rows) lines.push(`| ${row.map(cell).join(" | ")} |`);
  return lines.join("\n");
}

/** How far a dial may move, in words, whichever bounds it carries. */
export function rangeOf(v) {
  if (v.min !== null && v.max !== null) return `${v.min} to ${v.max}`;
  if (v.min !== null) return `${v.min} or more`;
  if (v.max !== null) return `${v.max} or less`;
  if (v.type === "choice") return "one of the choices below";
  if (v.type === "boolean") return "on or off";
  return "no bounds are set";
}

const defaultOf = (v) => (v.default === "" ? "blank" : `\`${v.default}\``);

function variableSection(v) {
  const lines = [];
  lines.push(`### ${v.heading}`);
  lines.push("");
  lines.push(v.description);
  lines.push("");
  const rows = [
    ["Key", `\`${v.key}\``],
    ["Type", `${v.type}, ${TYPE_GLOSS[v.type]}`],
    ["Default", defaultOf(v)],
    ["Range", rangeOf(v)],
  ];
  if (v.unit) rows.push(["Counted in", v.unit]);
  rows.push(["Who may change it", RING_GLOSS[v.ring].short]);
  rows.push(["A change takes effect", TIMING_GLOSS[v.applyTiming].short]);
  lines.push(table(["Fact", "Value"], rows));
  if (v.choices.length) {
    lines.push("");
    lines.push("What it may be set to:");
    lines.push("");
    for (const choice of v.choices) {
      const label = choice.label.replace(/\.\s*$/, "");
      lines.push(`- \`${choice.value}\` ${label}${choice.hint ? `. ${choice.hint}` : "."}`);
    }
  }
  return lines.join("\n");
}

export function render(f) {
  const L = [];
  const p = (s = "") => L.push(s);
  const count = f.variables.length;
  const ringCount = (name) => f.byRing.find((r) => r.name === name)?.count ?? 0;

  p("# Game variables");
  p();
  p(
    "Every dial a village can turn: what it does, what it is set to before anybody touches it, how " +
      "far it may move, and who is allowed to move it.",
  );
  p();
  p(
    "This is the BEHAVIOUR plane, which is how much, how often and which mode. A village's identity " +
      "(its names, its images, its stage ladder) lives in `shared/gameConfig.ts` and is a different " +
      "question. The rules no village may change at all are constitutional, live in code, and are " +
      "published in `shared/constitution.ts`.",
  );
  p();
  p(
    "The database stores CHANGED values only. A dial nobody has touched reads the platform default, " +
      "so the defaults printed here are the game a fresh village is playing on day one.",
  );
  p();

  p("## How to read this file");
  p();
  p(
    "This file is generated. `scripts/generate-variables-doc.mjs` reads `shared/gameVariables.ts`, " +
      "works out the facts, and writes the whole document. `scripts/check-variables-doc.mjs` " +
      "regenerates it and fails the build when the committed text and the code have come apart.",
  );
  p();
  p("Editing this file by hand does not hold. Change the code, then run:");
  p();
  p("```bash");
  p("node scripts/generate-variables-doc.mjs");
  p("```");
  p();
  p(
    "Every word below this section comes out of the registry. The labels and the descriptions are " +
      "the ones a founder reads in Admin, so a sentence that reads badly here reads badly there " +
      "too, and both are fixed in the same place.",
  );
  p();
  p(
    "There is no timestamp and no author line, on purpose. Both would change on every run and turn " +
      "an honest diff into noise. The git history is the record of when this changed.",
  );
  p();

  p("## Who may change what");
  p();
  p(
    `Every dial carries a RING, which is the platform's ceiling on who may move it. There are ` +
      `${f.rings.length} of them, and today ${f.byRing.map((r) => `${r.count} ${r.name}`).join(" and ")}:`,
  );
  p();
  for (const ring of f.rings) {
    p(`- **${ring}**, ${RING_GLOSS[ring].short}. ${RING_GLOSS[ring].long}`);
  }
  p();
  p(
    "The BOUNDS are constitutional in every case. Governance moves a value between the min and the " +
      "max printed below; nothing here moves the min or the max. That is what keeps a vote from " +
      "turning a dial into a different mechanism.",
  );
  p();
  p(
    `Each dial also says WHEN a change lands. ${f.byTiming.map((t) => `${t.count} of them ${TIMING_GLOSS[t.name].short}`).join(", and ")}.`,
  );
  p();
  for (const timing of f.timings) {
    p(`- **${timing}**, ${TIMING_GLOSS[timing].short}. ${TIMING_GLOSS[timing].long}`);
  }
  p();

  p("## At a glance");
  p();
  p(
    `${count} dials in ${f.categories.length} categories. ${f.boundedCount} carry a minimum and a ` +
      `maximum. By type: ${f.byType.map((t) => `${t.count} ${t.name}`).join(", ")}.`,
  );
  p();
  p(
    table(
      ["Category", "Dials", ...f.rings.map((r) => RING_GLOSS[r].short)],
      f.categories.map((c) => [c.name, String(c.variables.length), ...f.rings.map((r) => String(c[r]))]),
    ),
  );
  p();

  p("## Every dial by name");
  p();
  p("The whole registry in one table, for finding a dial. Each one is written out in full below.");
  p();
  p(
    table(
      ["Dial", "Key", "Category", "Type", "Default", "Who may change it"],
      // Category order, matching the sections below. The registry's own
      // declaration order interleaves categories, so a flat table in that order
      // reads as a shuffle of the document it is an index to.
      f.categories.flatMap((c) => c.variables).map((v) => [
        v.label,
        `\`${v.key}\``,
        v.category,
        v.type,
        defaultOf(v),
        RING_GLOSS[v.ring].short,
      ]),
    ),
  );
  p();

  for (const category of f.categories) {
    p(`## ${category.name}`);
    p();
    p(
      `${category.variables.length} ${category.variables.length === 1 ? "dial" : "dials"}. ` +
        f.rings
          .filter((r) => category[r] > 0)
          .map((r) => `${category[r]} for ${RING_GLOSS[r].short}`)
          .join(", ") +
        ".",
    );
    p();
    for (const v of category.variables) {
      p(variableSection(v));
      p();
    }
  }

  p("## What this file is made from");
  p();
  p("The generator reads these and fails loudly if any of them moves:");
  p();
  for (const rel of f.filesRead) p(`- \`${rel}\``);
  p();
  p(
    "The registry is transpiled and IMPORTED to read it, which is what makes the generated dials " +
      "visible. The multiplier, quest-threshold and unlock dials under Progression are built at " +
      "module load from the village's own stage ladder, so a reader of the array literal alone " +
      "would print a document that looked complete and was missing a fifth of the registry.",
  );
  p();
  p(
    "The generator refuses to guess. A dial with no description, a choice with no choices, a type " +
      "or a ring the document has no words for, a new field on `VariableDef`, a default the " +
      "registry's own validator rejects, or a new import into the registry: each one stops the " +
      "build and names itself. A shorter document that still renders is the failure this whole " +
      "mechanism exists to prevent.",
  );
  p();

  return L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export async function generate(root = ROOT) {
  return render(await collectFacts(root));
}

/** The document and the facts behind it, for callers that report on both. */
export async function generateDetailed(root = ROOT) {
  const facts = await collectFacts(root);
  return { text: render(facts), facts };
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

if (invokedDirectly) {
  try {
    const text = await generate();
    if (process.argv.includes("--stdout")) {
      process.stdout.write(text);
    } else {
      fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
      fs.writeFileSync(DOC_PATH, text, "utf8");
      process.stdout.write(`wrote docs/VARIABLES.md (${text.split("\n").length} lines)\n`);
    }
  } catch (err) {
    process.stderr.write(`\n${err instanceof ReadError ? err.message : (err?.stack ?? String(err))}\n\n`);
    process.exit(1);
  }
}
