/**
 * Every module has a contract document, and every contract document has a module.
 *
 * WHY THIS CAN BE A HARD GATE WHEN THE CITATION IDEA COULD NOT. Its two sides
 * are both machine-derived and neither is prose. One side is `MODULES` in
 * shared/modules.ts, which the TypeScript compiler enforces: a module cannot
 * exist without this guard seeing it. The other is the files on disk under
 * docs/modules/. There is no sentence to judge, so there is nothing to waive,
 * and a false positive is not possible in the way it is for a guard that reads
 * `path:line` citations out of prose.
 *
 * WHAT IT MEASURES, in two directions, because each catches a different kind
 * of neglect:
 *
 *   FORWARD, a ratchet. A module with no entry in `MODULE_DOCS` has no
 *   contract on the shelf. Eleven of twenty-three were in that state when this
 *   guard was written, including all four CORE modules, which are the ones a
 *   village cannot switch off. That is too many to fix in one sitting and far
 *   too many to leave unmeasured, so the count is a baseline that may only
 *   ever fall, the same discipline as check-brand-refs and check-file-lines.
 *
 *   BACKWARD, a hard failure. An entry in `MODULE_DOCS` pointing at a file
 *   that does not exist is a broken promise the moment it is written, so it
 *   fails immediately rather than joining a baseline. Likewise a doc under
 *   docs/modules/ that no module and no index claims is reported: a document
 *   nobody routes to is a document nobody reads, and this repository already
 *   carries several.
 *
 * WHY MODULE_DOCS RATHER THAN THE FILENAMES. `docs/modules/` filenames do not
 * follow module ids (map -> village-map.md, resources ->
 * how-resources-flow.md), so the mapping is real data and lives in
 * server/lib/knowledge.ts, where the running assistant reads it. Deriving the
 * pairing from filenames would be guessing at exactly the mapping that exists
 * because guessing does not work.
 *
 * `scripts/validate-module.mjs` already checks this pairing for ONE module at
 * a time and reports a missing entry as a note rather than a failure, which is
 * right for a listing lint that a contributor runs by hand on their own module.
 * It is not a CI gate and it never sees the set. This does, once, over all of
 * them.
 *
 * Usage:
 *   node scripts/check-module-docs.mjs
 *   node scripts/check-module-docs.mjs --json
 *   node scripts/check-module-docs.mjs --update-baseline   # only ever downward
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const BASELINE_PATH = path.join(ROOT, "scripts", "module-docs-baseline.json");
const DOCS_DIR = path.join(ROOT, "docs", "modules");

const asJson = process.argv.includes("--json");
const updating = process.argv.includes("--update-baseline");

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

/**
 * Transpile `shared/modules.ts` and import it, the way module-facts.mjs and
 * validate-module.mjs both do. A regex over a 23-entry registry would read a
 * shorter truth the first time somebody formats it differently.
 */
async function loadModules() {
  const abs = path.join(ROOT, "shared", "modules.ts");
  if (!fs.existsSync(abs)) fail("shared/modules.ts is missing, so nothing can be derived.");
  const src = fs.readFileSync(abs, "utf8");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "module-docs-"));
  try {
    const js = ts
      .transpileModule(src, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/(from\s+")(\.\/[A-Za-z0-9_-]+)(")/g, "$1$2.mjs$3");
    fs.writeFileSync(path.join(dir, "modules.mjs"), js, "utf8");
    return await import(new URL(`file://${path.join(dir, "modules.mjs")}`).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The id-to-filename mapping, parsed the same way validate-module.mjs parses
 * it. Deliberately the same expression: two guards disagreeing about what the
 * mapping says would be worse than either being slightly loose.
 */
function readModuleDocs() {
  const abs = path.join(ROOT, "server", "lib", "knowledge.ts");
  if (!fs.existsSync(abs)) fail("server/lib/knowledge.ts is missing, so the mapping cannot be read.");
  const src = fs.readFileSync(abs, "utf8");
  const block = /export const MODULE_DOCS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
  if (!block) {
    fail(
      "Could not parse MODULE_DOCS out of server/lib/knowledge.ts.\n" +
        "This guard refuses rather than reporting an empty mapping: a silent zero here would\n" +
        "read as 'no module has a doc' and lower the baseline to nonsense.",
    );
  }
  const out = {};
  for (const m of block[1].matchAll(/([A-Za-z0-9_-]+)\s*:\s*"([^"]+)"/g)) out[m[1]] = m[2];
  return out;
}

const mod = await loadModules();
const MODULES = mod.MODULES ?? mod.default?.MODULES;
if (!Array.isArray(MODULES) || MODULES.length === 0) {
  fail("shared/modules.ts exported no MODULES array, so there is nothing to check.");
}
const docs = readModuleDocs();

const ids = MODULES.map((m) => m.id).sort();
const coreIds = new Set(MODULES.filter((m) => m.core).map((m) => m.id));

/** A module with no mapping entry: no contract on the shelf at all. */
const undocumented = ids.filter((id) => !(id in docs)).sort();

/** A mapping entry whose file is not there: a promise broken on the day it was made. */
const dangling = Object.entries(docs)
  .filter(([, file]) => !fs.existsSync(path.join(DOCS_DIR, file)))
  .map(([id, file]) => `${id} -> docs/modules/${file}`)
  .sort();

/** A mapping entry for a module that no longer exists in the registry. */
const orphanEntries = Object.keys(docs).filter((id) => !ids.includes(id)).sort();

/** A file on the shelf that no mapping entry claims. Reported, never failed. */
const claimed = new Set(Object.values(docs));
const unclaimed = fs.existsSync(DOCS_DIR)
  ? fs
      .readdirSync(DOCS_DIR)
      .filter((f) => f.endsWith(".md") && !claimed.has(f))
      .sort()
  : [];

const baseline = fs.existsSync(BASELINE_PATH)
  ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))
  : null;
const allowed = baseline?.undocumented ?? Infinity;

if (updating) {
  if (baseline && undocumented.length > allowed) {
    fail(
      `refusing to raise the module-docs baseline: ${undocumented.length} module(s) without a ` +
        `contract doc is above the recorded ${allowed}. This number only ever falls. Write the ` +
        `doc and add its MODULE_DOCS entry; do not record the gap as acceptable.`,
    );
  }
  fs.writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ undocumented: undocumented.length, modules: ids.length, ids: undocumented }, null, 2)}\n`,
    "utf8",
  );
  console.log(`module-docs baseline set to ${undocumented.length} undocumented of ${ids.length} module(s).`);
  process.exit(0);
}

if (asJson) {
  console.log(JSON.stringify({ modules: ids.length, undocumented, dangling, orphanEntries, unclaimed, allowed }, null, 2));
}

const problems = [];
if (dangling.length) {
  problems.push(
    `MODULE_DOCS names ${dangling.length} file(s) that do not exist:\n    ` + dangling.join("\n    "),
  );
}
if (orphanEntries.length) {
  problems.push(
    `MODULE_DOCS carries ${orphanEntries.length} entr(y/ies) for module id(s) not in the registry:\n    ` +
      orphanEntries.join(", "),
  );
}
if (undocumented.length > allowed) {
  problems.push(
    `${undocumented.length} module(s) have no contract doc, and the baseline allows ${allowed}. ` +
      `The ratchet only turns down.\n    ` +
      undocumented.map((id) => (coreIds.has(id) ? `${id} (CORE)` : id)).join(", "),
  );
}

if (problems.length) {
  fail(
    "MODULE DOCS\n\n  " +
      problems.join("\n\n  ") +
      "\n\n  A module's contract doc is what a fork operator reads to decide whether to run it," +
      "\n  and what an agent reads before changing it. Write docs/modules/<file>.md and add the" +
      "\n  id to MODULE_DOCS in server/lib/knowledge.ts." +
      "\n\n  If you REMOVED a gap, lower the baseline: node scripts/check-module-docs.mjs --update-baseline",
  );
}

if (!asJson) {
  console.log(
    `Module docs guard passed. ${ids.length - undocumented.length} of ${ids.length} module(s) have a contract doc ` +
      `(${undocumented.length} without, baseline ${allowed === Infinity ? "unset" : allowed}).`,
  );
  if (undocumented.length) {
    const core = undocumented.filter((id) => coreIds.has(id));
    console.log(`  without a doc: ${undocumented.join(", ")}`);
    if (core.length) {
      console.log(`  of which CORE, which a village cannot switch off: ${core.join(", ")}`);
    }
  }
  if (unclaimed.length) {
    console.log(
      `  ${unclaimed.length} file(s) under docs/modules/ that MODULE_DOCS does not claim, so nothing routes to them: ` +
        unclaimed.join(", "),
    );
  }
}
