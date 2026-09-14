#!/usr/bin/env node
/**
 * The current truth about the module framework, printed.
 *
 * This is the first command a module builder runs. Its whole job is to stop
 * the starting document from rotting: every number and every list below is
 * READ FROM THE SOURCE at the moment you run it, so a guide can say "run this"
 * instead of restating a field list that goes stale the week after it is
 * written.
 *
 * Nothing here is hardcoded. The field list comes from the `ModuleDef`
 * interface, the tier and data-class and lifecycle vocabularies come from
 * their type aliases, the capability count comes from `ALL_CAPABILITIES`, the
 * gate commands come from EVERY workflow that runs on a pull request, and the
 * contract version
 * comes from the contract document. When one of those changes, this output
 * changes with it and no human has to remember to edit anything.
 *
 * WHY THE COMPILER AND NOT A REGEX. `scripts/validate-module.mjs` transpiles
 * the real registry and calls the real function rather than re-implementing
 * its rules, for the stated reason that a second opinion drifts from the
 * first. Same principle here, with one addition: the things this script
 * reports are mostly TYPES, and types erase during transpilation. So values
 * (the module list, the contract constant, the capability list) come from
 * transpiling and importing, and vocabularies (tier, data class, lifecycle,
 * the field list) come from parsing the declaration with the TypeScript
 * compiler's own parser. Neither is a guess at the file.
 *
 * A MISSING SOURCE IS A FAILURE, NEVER A SKIP. If any file below cannot be
 * read, this exits non-zero and says which one. A facts command that silently
 * omits a section teaches the reader a shorter truth than the real one, which
 * is the exact failure `validate-module.mjs` exists to avoid.
 *
 * Usage:
 *   node scripts/module-facts.mjs
 *   node scripts/module-facts.mjs --json
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
);

const asJson = process.argv.includes("--json");
const missing = [];

/**
 * Read a required source, named with forward slashes so the path this prints
 * is the path a reader can paste back on any platform.
 */
function required(relPath) {
  try {
    return fs.readFileSync(path.join(ROOT, ...relPath.split("/")), "utf8");
  } catch {
    // Deduped: `shared/modules.ts` is read twice, once for values and once for
    // types, and one absent file should be reported as one absent file.
    if (!missing.includes(relPath)) missing.push(relPath);
    return null;
  }
}

// ── Values: transpile and import, the way validate-module.mjs does ───────────

/**
 * Transpile `shared/<entry>.ts` into a scratch directory and import it.
 * Relative specifiers gain an extension because Node's ESM resolver requires
 * one. Type-only imports erase, so each file below comes out self-contained.
 */
async function loadShared(entry) {
  const src = required(`shared/${entry}.ts`);
  if (src === null) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "module-facts-"));
  try {
    const js = ts
      .transpileModule(src, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/(from\s+")(\.\/[A-Za-z0-9_-]+)(")/g, "$1$2.mjs$3");
    fs.writeFileSync(path.join(dir, `${entry}.mjs`), js, "utf8");
    return await import(new URL(`file://${path.join(dir, `${entry}.mjs`)}`).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Vocabularies: parse the declarations, because types do not survive ───────

/** Parse a shared source once so several readers can walk the same tree. */
function parseShared(entry) {
  const src = required(`shared/${entry}.ts`);
  if (src === null) return null;
  return ts.createSourceFile(`${entry}.ts`, src, ts.ScriptTarget.ES2022, true);
}

/**
 * The members of an interface, with their optionality and declared type.
 * Reported in declaration order, which is the order a builder reads them in.
 */
function interfaceFields(sourceFile, interfaceName) {
  if (!sourceFile) return null;
  for (const stmt of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(stmt) || stmt.name.text !== interfaceName) continue;
    return stmt.members.filter(ts.isPropertySignature).map((m) => ({
      name: m.name.getText(sourceFile),
      optional: !!m.questionToken,
      type: m.type ? m.type.getText(sourceFile).replace(/\s+/g, " ") : "unknown",
    }));
  }
  return null;
}

/**
 * The string members of a union type alias. Returns null when the alias is
 * absent and an empty list when it exists and is not a union of strings, so a
 * renamed type reads differently from a restructured one.
 */
function unionStrings(sourceFile, aliasName) {
  if (!sourceFile) return null;
  for (const stmt of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(stmt) || stmt.name.text !== aliasName) continue;
    const node = stmt.type;
    const parts = ts.isUnionTypeNode(node) ? node.types : [node];
    return parts
      .filter((p) => ts.isLiteralTypeNode(p) && ts.isStringLiteral(p.literal))
      .map((p) => p.literal.text);
  }
  return null;
}

// ── The gate commands, read from the workflow that actually decides ──────────

/**
 * The `verify` job's steps, as (name, command) pairs.
 *
 * Deliberately a targeted line scan and not a YAML dependency: this repository
 * refuses new dependencies, and the shape being read is two known keys at a
 * known indent rather than arbitrary YAML. A step whose `run` is a block
 * scalar is reported as a block, because reproducing a twenty-line shell
 * fragment in a facts listing would be noise. What a builder needs from such a
 * step is whether anything local reproduces it, so the block is scanned for a
 * `node scripts/*.mjs` call and that command is printed when one is there.
 */
/**
 * Every workflow that gates a PULL REQUEST, which is not the same set as
 * ci.yml.
 *
 * THIS USED TO READ ci.yml ALONE, and CLAUDE.md pointed at this script as
 * "the authoritative list" of gates while it did. Measured on 2026-09-06:
 * 35 commands printed from ci.yml's 40 named steps, and nothing at all from
 * module-intake.yml (7 steps), module-review-agent.yml (5) or codeql.yml (2).
 * The gates reachable ONLY through module-intake include validate-module,
 * intake-classify, contribution-scan and the whole raw-SQL burn-down, so a
 * contributor could run everything this printed and still go red.
 *
 * The blindness was found because somebody mentioned the burn-down in
 * passing, which is not a discovery mechanism. Reading the directory is.
 *
 * WHY A DIRECTORY WALK AND NOT A LIST OF FOUR. A hand list is a thing
 * somebody has to remember to append to, and the failure being fixed here is
 * exactly that failure one level up. A workflow added tomorrow is reported
 * tomorrow, by nobody's effort.
 */
function gatesPullRequests(yml) {
  // Only the `on:` block counts. The words "pull_request" appear in comments
  // and in `if:` expressions in this repository, and either would otherwise
  // enrol a workflow that never runs on a pull request.
  const lines = yml.split(/\r?\n/);
  let inOn = false;
  for (const line of lines) {
    if (/^"?on"?:\s*$/.test(line)) {
      inOn = true;
      continue;
    }
    // Any other top-level key ends the block.
    if (inOn && /^\S/.test(line)) break;
    if (inOn && /^\s{2}pull_request:/.test(line)) return true;
  }
  return false;
}

function prGatingWorkflows() {
  const dir = path.join(ROOT, ".github", "workflows");
  let names;
  try {
    names = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
  } catch {
    // A directory that cannot be read is a failure, not an empty gate set:
    // reporting no gates would read as a repository with no gates.
    missing.push(".github/workflows/");
    return [];
  }
  const out = [];
  for (const name of names) {
    const rel = `.github/workflows/${name}`;
    const yml = required(rel);
    if (yml === null) continue;
    if (!gatesPullRequests(yml)) continue;
    // Named steps and RUNNABLE steps are different counts, and conflating
    // them made codeql.yml look unreadable: it is real, it gates a pull
    // request, and it has no `run:` at all because it is actions only.
    const named = (yml.match(/^\s{6}-\s+name:/gm) ?? []).length;
    out.push({ rel, named, gates: ciGates(yml) });
  }
  return out;
}

function ciGates(yml) {
  if (yml === null) return null;
  const lines = yml.split(/\r?\n/);
  const steps = [];
  let nodeVersion = null;
  const budgets = {};
  let pending = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const nameMatch = /^\s{6}-\s+name:\s+(.+?)\s*$/.exec(line);
    if (nameMatch) {
      pending = nameMatch[1];
      continue;
    }

    const nv = /^\s+node-version:\s*(\S+)\s*$/.exec(line);
    if (nv) nodeVersion = nv[1].replace(/['"]/g, "");

    const budget = /^\s+(MAX_[A-Z_]+):\s*(\S+)\s*$/.exec(line);
    if (budget) budgets[budget[1]] = budget[2];

    const runBlock = /^\s{8}run:\s*\|\s*$/.exec(line);
    if (runBlock && pending) {
      /*
       * A block scalar used to be reported as unreproducible, full stop. That
       * became wrong the day the bundle budget grew a script: the block still
       * holds shell, and the shell now calls a gate a builder can run. So scan
       * forward through the indented body for `node scripts/<name>.mjs` and
       * report the first one as the local reproduction. Scanning stops at the
       * next step, so a later step's command cannot be attributed to this one.
       */
      // EVERY command in the block, not the first. A block that runs four
      // gates and reports one teaches a shorter truth than the real one,
      // which is the whole defect this script exists to avoid. The intake
      // block is the case that proved it: its first call is module-facts
      // itself, so reporting only the first pointed the reader back here and
      // never at validate-module, which is what actually gates them.
      const locals = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s{6}-\s+name:/.test(lines[j])) break;
        const call = /\b(node\s+scripts\/[\w.-]+\.mjs)/.exec(lines[j]);
        if (call && !locals.includes(call[1])) locals.push(call[1]);
      }
      steps.push({ name: pending, command: null, block: true, locals });
      pending = null;
      continue;
    }

    const runOne = /^\s{8}run:\s+(.+?)\s*$/.exec(line);
    if (runOne && pending) {
      steps.push({ name: pending, command: runOne[1], block: false });
      pending = null;
    }
  }
  return { steps, nodeVersion, budgets };
}

// ── The contract version, from the document itself ───────────────────────────

const CONTRACT_PATH = "docs/MODULE_LIBRARY_CONTRACT.md";

/** The version the contract document states about itself. */
function contractVersion(body) {
  if (body === null) return null;
  const m = /\*\*Version\s+([0-9]+\.[0-9]+)\b/i.exec(body);
  return m ? m[1] : null;
}

// ── Gather ───────────────────────────────────────────────────────────────────

const modulesSrc = parseShared("modules");
const registry = await loadShared("modules");
const capabilities = await loadShared("capabilities");
const ciYml = required(".github/workflows/ci.yml");
const contractBody = required(CONTRACT_PATH);

const fields = interfaceFields(modulesSrc, "ModuleDef");
const tiers = unionStrings(modulesSrc, "ModuleTier");
const dataClasses = unionStrings(modulesSrc, "ModuleDataClass");
const lifecycles = unionStrings(modulesSrc, "ModuleLifecycle");
const gates = ciGates(ciYml);
// ci.yml still supplies the Node version and the budget constants, which are
// its own; the GATE LIST now comes from every workflow that runs on a pull
// request, this one included.
const prWorkflows = prGatingWorkflows();
const docVersion = contractVersion(contractBody);

let sha = null;
try {
  sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
} catch {
  sha = null;
}

const codeVersion = registry?.MODULE_LIBRARY_CONTRACT_VERSION ?? null;
const moduleCount = registry?.MODULES?.length ?? null;
const coreCount = registry?.MODULES?.filter((m) => m.core).length ?? null;
const listingCount = registry?.MODULES?.filter((m) => m.tier !== "included").length ?? null;
const capabilityCount = capabilities?.ALL_CAPABILITIES?.length ?? null;
const managedCap = registry?.MANAGED_LISTING_CAP ?? null;

// A vocabulary that cannot be read is as much a failure as a missing file:
// printing a short list would teach a shorter truth than the real one.
const unreadable = [];
if (fields === null) unreadable.push("the ModuleDef interface in shared/modules.ts");
if (tiers === null) unreadable.push("the ModuleTier type in shared/modules.ts");
if (dataClasses === null) unreadable.push("the ModuleDataClass type in shared/modules.ts");
if (lifecycles === null) unreadable.push("the ModuleLifecycle type in shared/modules.ts");
if (capabilityCount === null) unreadable.push("ALL_CAPABILITIES in shared/capabilities.ts");
if (gates === null || !gates.steps.length) unreadable.push("the verify job steps in .github/workflows/ci.yml");
if (!prWorkflows.length) unreadable.push("any workflow under .github/workflows/ that runs on a pull request");
for (const w of prWorkflows) {
  // Zero NAMED steps means the parse failed. Zero runnable steps beside a
  // positive named count is an actions-only workflow, which is reported
  // rather than treated as a failure.
  if (w.gates === null || !w.named) unreadable.push(`the steps in ${w.rel}`);
}
if (docVersion === null) unreadable.push("the version line in " + CONTRACT_PATH);

// ── Report ───────────────────────────────────────────────────────────────────

if (asJson) {
  console.log(
    JSON.stringify(
      {
        sha,
        contract: { document: docVersion, registryConstant: codeVersion },
        modules: { total: moduleCount, core: coreCount, listings: listingCount, managedCap },
        moduleDefFields: fields,
        tiers,
        dataClasses,
        lifecycles,
        capabilityCount,
        ci: gates,
        missing,
        unreadable,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`Module framework facts, read at ${sha ?? "an unknown commit"}\n`);

  console.log(`Registry: ${moduleCount} module(s), ${coreCount} core, ${listingCount} listing(s) above included.`);
  console.log(`Concurrent managed listings are capped at ${managedCap}.`);
  console.log(`Capability keys in the one gate: ${capabilityCount}.\n`);

  console.log("Contract version");
  console.log(`  ${CONTRACT_PATH} states: ${docVersion ?? "UNREADABLE"}`);
  console.log(`  shared/modules.ts constant: ${codeVersion ?? "UNREADABLE"}`);
  if (docVersion && codeVersion && docVersion !== codeVersion) {
    console.log("  THESE DISAGREE. A listing is stamped with the constant, so the document is the one that is wrong.");
  }
  console.log("");

  console.log("ModuleDef fields (shared/modules.ts, declaration order)");
  for (const f of fields ?? []) {
    console.log(`  ${f.optional ? " " : "*"} ${f.name.padEnd(16)} ${f.type.slice(0, 78)}`);
  }
  console.log("  (* marks a required field.)\n");

  console.log(`Tiers: ${(tiers ?? []).join(", ") || "UNREADABLE"}`);
  console.log(`Data classes: ${(dataClasses ?? []).join(", ") || "UNREADABLE"}`);
  console.log(`Lifecycle: ${(lifecycles ?? []).join(", ") || "UNREADABLE"}\n`);

  const namedTotal = prWorkflows.reduce((n, w) => n + w.named, 0);
  const runnableTotal = prWorkflows.reduce((n, w) => n + (w.gates?.steps.length ?? 0), 0);
  console.log(
    `Gates that run on a PULL REQUEST: ${namedTotal} named step(s) across ${prWorkflows.length} workflow(s), ` +
      `${runnableTotal} of them a shell command (Node ${gates?.nodeVersion ?? "?"}).` +
      `\nRunning everything ci.yml lists is NOT the whole set.`,
  );
  for (const w of prWorkflows) {
    console.log(`\n  ${w.rel}  (${w.named} named step(s))`);
    if (!w.gates?.steps.length) {
      console.log("    no shell steps: this workflow runs actions, so there is nothing to reproduce locally");
      continue;
    }
    for (const step of w.gates.steps) {
      if (step.block && step.locals.length) {
        const cmds = step.locals.map((c) => `\`${c}\``).join(", ");
        console.log(`    ${step.name}: a shell block, reproduced locally by ${cmds}`);
      } else if (step.block) {
        console.log(`    ${step.name}: a shell block in the workflow, no local command reproduces it`);
      } else {
        console.log(`    ${step.command}`);
      }
    }
  }

  const budgets = Object.entries(gates?.budgets ?? {});
  if (budgets.length) {
    console.log("\nBudgets CI enforces");
    for (const [k, v] of budgets) console.log(`  ${k} = ${v}`);
  }

  console.log("\nRun the listing lint before you open a pull request:");
  console.log("  node scripts/validate-module.mjs <your-module-id>");
}

// ── Exit ─────────────────────────────────────────────────────────────────────

if (missing.length || unreadable.length) {
  for (const m of missing) console.error(`MISSING SOURCE: ${m}`);
  for (const u of unreadable) console.error(`COULD NOT READ: ${u}`);
  console.error("\nThese facts are incomplete, so this exits non-zero rather than teaching a shorter truth.");
  process.exit(1);
}
