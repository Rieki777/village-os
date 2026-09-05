#!/usr/bin/env node
/**
 * The listing lint: what a developer runs before submitting a module, and what
 * CI can run later against every entry in the registry.
 *
 * This is the seed of the stage 6 gate in the module library contract ("all
 * five driver methods demonstrated"). It implements the checks that are
 * STATICALLY checkable today and PRINTS the ones that are not, because a check
 * that quietly skips converts "unchecked" into "passed", which is the failure
 * this file exists to avoid. Everything under "cannot be checked here" is a
 * real obligation with a real reviewer behind it, and saying so out loud is the
 * only honest way to ship a partial gate.
 *
 * WHY IT LOADS THE REAL REGISTRY. `shared/modules.ts` already owns
 * `moduleListingProblems`, which boot asserts on and a unit test asserts on.
 * Re-implementing those rules here would create a second opinion about what a
 * valid listing is, and the two would drift. So this script transpiles the real
 * file and calls the real function, and adds only the checks that need to reach
 * OUTSIDE the registry: the docs shelf, the launch registry, and the server's
 * driver wiring.
 *
 * THE CONTRIBUTION CHECKS. Everything above reads the registry. Section 3
 * reads the DIFF, because the review checklist's security section is mostly
 * about code a contributor added rather than about the listing they declared,
 * and every item there that a machine can decide belongs in a machine. A
 * reviewer who is hand-grepping for `fetch(` is a reviewer who is not spending
 * their attention on intent, which is the half no script can take.
 *
 * THE BURN-DOWN. Section 3b is the one check here that is NOT about the diff
 * and not about a listing. The raw-SQL rule in section 3 was blind to a
 * TypeScript type-argument list for as long as it existed, so `pool.query(...)`
 * blocked and `pool.query<RowDataPacket[]>(...)` did not, for the identical
 * violation. Fixing the pattern made 436 non-test call sites visible at once.
 * Fixing them here would be unreviewable and waiving them would repeal the
 * rule, so they are RECORDED, in a register that may only ever shrink
 * (`scripts/sql-burndown.mjs`). It runs on every invocation, because a check
 * that skips converts "unchecked" into "passed", which is the failure this
 * whole file exists to avoid.
 *
 * Usage:
 *   node scripts/validate-module.mjs             every listing in the registry
 *   node scripts/validate-module.mjs saberra     one module id
 *   node scripts/validate-module.mjs --all       every module, listings or not
 *   node scripts/validate-module.mjs --diff      also run the contribution
 *                                                checks against origin/main
 *   node scripts/validate-module.mjs --diff=<ref>   ... against another base
 */
import { execFileSync } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { CODE_RULES, addedLineNumbers, scanFileLines } from "./contribution-scan.mjs";
import { BURNDOWN_CEILING, runBurndown } from "./sql-burndown.mjs";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
);

let violations = 0;
let checks = 0;
const cannotCheck = [];

const ok = (line) => { checks++; console.log(`  ${line}  OK`); };
const bad = (line) => { checks++; violations++; console.log(`  ${line}  <-- VIOLATION`); };
const note = (line) => cannotCheck.push(line);

// ── Loading the real shared registries ───────────────────────────────────────

/**
 * Transpile `shared/*.ts` into a scratch directory and import it, so this
 * script reads the same objects the server does instead of a regex's guess at
 * them. Relative specifiers are rewritten to carry an extension because Node's
 * ESM resolver requires one; type-only imports erase during transpilation, so
 * `shared/modules.ts` and `shared/launchRequirements.ts` come out
 * self-contained apart from each other.
 */
async function loadShared(entry, alsoNeeds = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-module-"));
  try {
    for (const name of [entry, ...alsoNeeds]) {
      const src = fs.readFileSync(path.join(ROOT, "shared", `${name}.ts`), "utf8");
      const js = ts.transpileModule(src, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText.replace(/(from\s+")(\.\/[A-Za-z0-9_-]+)(")/g, "$1$2.mjs$3");
      fs.writeFileSync(path.join(dir, `${name}.mjs`), js, "utf8");
    }
    return await import(new URL(`file://${path.join(dir, `${entry}.mjs`)}`).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Reading things that live outside the registry ────────────────────────────

/**
 * The documentation shelf allowlist, parsed out of `server/lib/knowledge.ts`.
 *
 * A failure to parse is a VIOLATION and never a skip: the whole point of this
 * script is that an unchecked thing must not read as a passed thing, and
 * `scripts/check-examples.mjs` sets the house precedent for exactly this shape
 * when it cannot read `shared/capabilities.ts`.
 */
function readModuleDocs() {
  let src = "";
  try {
    src = fs.readFileSync(path.join(ROOT, "server", "lib", "knowledge.ts"), "utf8");
  } catch {
    return null;
  }
  const block = /export const MODULE_DOCS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
  if (!block) return null;
  const out = {};
  for (const m of block[1].matchAll(/([A-Za-z0-9_]+)\s*:\s*"([^"]+)"/g)) out[m[1]] = m[2];
  return out;
}

/** Every module id some server file registers a member driver for. */
function registeredDriverIds() {
  const found = new Set();
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue;
      let body = "";
      try { body = fs.readFileSync(full, "utf8"); } catch { continue; }
      for (const m of body.matchAll(/registerMemberDriver\(\s*["'`]([^"'`]+)["'`]/g)) found.add(m[1]);
    }
  };
  walk(path.join(ROOT, "server"));
  return found;
}

const PROVENANCE = /^Provenance:\s*(platform|vendor\s*\(([^)]{1,120})\))\s*$/im;

// ── Run ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const wantAll = args.includes("--all");
const wanted = args.filter((a) => !a.startsWith("--"));

const registry = await loadShared("modules");
const launch = await loadShared("launchRequirements", ["modules"]);
const poolLib = await loadShared("modulePool", ["modules"]);

const { MODULES, moduleListingProblems, priceLine, isPaid } = registry;
const { poolStatus, modulePayoutProblems } = poolLib;
const byId = new Map(MODULES.map((m) => [m.id, m]));

for (const id of wanted) {
  if (!byId.has(id)) {
    console.log(`Unknown module id "${id}". Known ids: ${MODULES.map((m) => m.id).join(", ")}`);
    process.exit(2);
  }
}

const targets = wanted.length
  ? wanted.map((id) => byId.get(id))
  : MODULES.filter((m) => wantAll || m.tier !== "included");

console.log(`Validating ${targets.length} module(s) against the registry at shared/modules.ts\n`);

if (!targets.length) {
  console.log("  no listings in the registry yet (every module is `included`).");
  console.log("  Pass --all to lint the platform's own modules, or a module id to lint one.\n");
}

// ── 1. Registry shape, from the one function that already owns the rules ─────

console.log("Registry shape (shared/modules.ts:moduleListingProblems)");
{
  // Run against the WHOLE registry, because the managed cap and the
  // replaced-by resolution are properties of the set and not of one entry.
  const all = moduleListingProblems();
  const ids = new Set(targets.map((m) => m.id));
  const mine = all.filter((p) => Array.from(ids).some((id) => p.includes(`"${id}"`)));
  const others = all.length - mine.length;
  if (mine.length) {
    for (const p of mine) console.log(`    ${p}`);
    bad(`listing shape problems for the selected module(s): ${mine.length}`);
  } else {
    ok("listing shape problems for the selected module(s): 0");
  }
  if (others > 0) {
    console.log(`    (${others} further problem(s) elsewhere in the registry, not attributed to a selected id)`);
  }
}

// ── 2. Per listing ───────────────────────────────────────────────────────────

const docs = readModuleDocs();
const drivers = registeredDriverIds();


if (docs === null) {
  bad("read MODULE_DOCS from server/lib/knowledge.ts: COULD NOT PARSE");
} else {
  ok(`read MODULE_DOCS from server/lib/knowledge.ts (${Object.keys(docs).length} entries)`);
}

for (const m of targets) {
  console.log(`\n${m.id}  (tier ${m.tier}, dataClass ${m.dataClass}${m.withdrawn ? ", withdrawn" : ""})`);

  // 2a. Vendor record, the fields moduleListingProblems does not reach.
  if (m.tier !== "included") {
    const v = m.vendor;
    if (!v) {
      bad("vendor record present");
    } else {
      ok("vendor record present");
      const both = !!v.supportUrl && !!v.supportEmail;
      both ? ok("support URL and support email both set") : bad("support URL and support email both set");
      if (v.setupSteps?.length) {
        console.log(`    ${v.setupSteps.length} setup step(s): each one is a permanent per village human cost`);
      }
    }
  }

  // 2b. Pricing, beyond the shape rules.
  if (m.pricing) {
    console.log(`    price: ${priceLine(m.pricing)}`);
    if (m.pricing.amount > 0) {
      const slot = m.pricing.licenceKey;
      const slots = m.vendor?.secretKeys ?? [];
      slot && slots.includes(slot)
        ? ok(`priced listing names a licence slot it owns ("${slot}")`)
        : bad("priced listing names a licence slot it owns");
    }
  } else if (m.tier !== "included") {
    console.log("    price: none declared, so this listing adds no charge of its own");
  }

  // 2b-ii. The builders' pool: a listing that charges is out of it.
  //
  // Contract clause 14. A paid module is already paid by the villages running
  // it, so drawing from a common pool as well would have every village funding
  // a product only some of them use. Declaring a price and taking the pool are
  // two ways of being paid for the same work and a listing picks one.
  //
  // TODO(lane P): the registry field carrying eligibility is `pool` and its
  // TYPE is owned by the pool lane, so this reads the field defensively
  // instead of declaring it. When `pool` lands in `ModuleDef`, this check
  // starts biting with no edit. Until then it is vacuous by construction, and
  // it says so below rather than reporting a pass it did not earn.
  {
    const status = poolStatus(m);
    console.log(`    pool: ${status.eligible ? "eligible" : "not eligible"} (${status.reason})`);

    // Contract clause 14, as an implication rather than a description. It
    // cannot fail today because `poolStatus` returns `paid` before it returns
    // anything eligible, and that is the point: the assertion pins the
    // relationship so a later reordering of those checks cannot quietly let a
    // priced listing draw from the pool as well.
    isPaid(m) && status.eligible
      ? bad("a listing that charges is not pool-eligible (contract clause 14)")
      : ok("charging and pool eligibility are mutually exclusive (contract clause 14)");

    // The payout identity, from the same function the server uses.
    const payout = modulePayoutProblems([m]);
    if (payout.length) {
      for (const p of payout) console.log(`    ${p}`);
      bad(`payout identity is answerable: ${payout.length} problem(s)`);
    } else if (m.builtByAccount !== undefined) {
      ok("payout identity is a handle on a named account system, crediting a named builder");
    }
  }

  // 2c. dataClass sanity: member-pii means somebody outside can be asked to forget.
  if (m.dataClass === "member-pii" && m.tier !== "included") {
    drivers.has(m.id)
      ? ok("member-pii listing registers a member driver somewhere under server/")
      : bad("member-pii listing registers a member driver somewhere under server/");
    note(
      `${m.id}: whether that driver actually CONFIRMS a deletion by reading back and getting nothing. ` +
        "Contract stage 4 proves it live against a sandbox tenant; no static check can.",
    );
  }

  // 2d. Docs file, shelf entry, provenance marker.
  //
  // A LISTING must carry all three: a village enabling somebody else's
  // connector deserves a document saying what it does and whose words those
  // are. For the platform's own `included` modules a missing contract doc is a
  // standing gap that predates this lint, so it reports rather than fails.
  // Failing on it would make `--all` permanently red for a reason no listing
  // author caused, which is how a gate gets ignored.
  if (docs !== null) {
    const file = docs[m.id];
    const required = m.tier !== "included";
    if (!file) {
      if (required) bad(`MODULE_DOCS carries an entry for "${m.id}"`);
      else note(`${m.id}: no MODULE_DOCS entry, so it has no contract doc on the shelf. A standing gap, not a listing defect.`);
    } else {
      ok(`MODULE_DOCS carries an entry for "${m.id}" (${file})`);
      const full = path.join(ROOT, "docs", "modules", file);
      if (!fs.existsSync(full)) {
        bad(`docs/modules/${file} exists`);
      } else {
        ok(`docs/modules/${file} exists`);
        const head = fs.readFileSync(full, "utf8").split(/\r?\n/).slice(0, 12).join("\n");
        const marker = PROVENANCE.exec(head);
        if (!marker) {
          bad(`docs/modules/${file} declares a provenance marker in its opening lines`);
        } else {
          ok(`docs/modules/${file} declares provenance: ${marker[1].toLowerCase().startsWith("platform") ? "platform" : `vendor (${marker[2]})`}`);
          if (m.tier !== "included" && marker[1].toLowerCase().startsWith("platform")) {
            note(
              `${m.id}: its contract doc claims platform provenance while the listing names an outside counterparty. ` +
                "That may be right (the platform wrote the connector doc) and it may be a vendor's words in the platform's voice. A human decides.",
            );
          }
        }
      }
    }
  }

  // 2e. A launch requirement, so the listing asks the village for what it needs.
  if (m.tier !== "included") {
    const mine = launch.LAUNCH_REQUIREMENTS.filter((r) => {
      const applies = r.appliesWhenModule;
      return Array.isArray(applies) ? applies.includes(m.id) : applies === m.id;
    });
    mine.length
      ? ok(`launch requirement(s) generated: ${mine.map((r) => r.id).join(", ")}`)
      : bad("at least one launch requirement applies to this listing");
    for (const r of mine) {
      const wired = !r.checkKey.startsWith("manual:");
      if (wired) {
        note(
          `${m.id}: requirement "${r.id}" resolves server-side on checkKey "${r.checkKey}". ` +
            "Whether a resolver is wired for it is only observable at runtime; an unwired one renders as a platform bug on the journey page.",
        );
      }
    }
  }

  // 2f. Withdrawal, where it applies.
  if (m.withdrawn) {
    console.log(`    withdrawn since ${m.withdrawn.since}${m.withdrawn.replacedBy ? `, replaced by ${m.withdrawn.replacedBy}` : ""}`);
    note(`${m.id}: whether the ninety days' notice and the data return actually happened. Those are commitments, not fields.`);
  }
}

// ── 3. Contribution checks, over the diff ────────────────────────────────────
//
// The review checklist's security section, minus everything a human has to
// read intent for. Each rule here was a checklist line first, and moving it
// into code is what lets the checklist honestly say "the validator already
// checked these, you check the rest".
//
// A GENUINE EXCEPTION TAKES A WAIVER, on the line itself:
//     // module-review-ok: <reason>
// which is the same shape as the house `brand-ok:` and `voice-ok:` waivers, so
// nobody has to learn a second convention. Waivers are counted and printed,
// which is what keeps them honest.


/**
 * Files changed against the base: tracked modifications AND untracked new
 * files.
 *
 * The untracked half is not a nicety. A new module is mostly NEW files, and
 * `git diff` cannot see a file git has never heard of. Without this, a builder
 * running the lint locally before committing gets a clean sheet on the exact
 * files they just wrote, then the same command in CI (where the files are
 * committed, so the diff does see them) reports findings they never had a
 * chance to fix. A check whose answer depends on whether you have run `git add`
 * yet is a check nobody can trust.
 */
function changedFiles(base) {
  try {
    const git = (a) =>
      execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const mergeBase = git(["merge-base", base, "HEAD"]).trim();
    const tracked = git(["diff", "--name-only", mergeBase]).split(/\r?\n/);
    const untracked = git(["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/);
    return Array.from(new Set([...tracked, ...untracked].filter(Boolean)));
  } catch {
    return null;
  }
}

/** The base's copy of a file, or null when it did not exist there. */
function fileAtBase(base, relPath) {
  try {
    return execFileSync("git", ["show", `${base}:${relPath}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}


const wantDiff = args.some((a) => a === "--diff" || a.startsWith("--diff="));
const diffBase = (args.find((a) => a.startsWith("--diff=")) ?? "--diff=origin/main").split("=")[1];

let waivers = 0;

if (wantDiff) {
  console.log(`\nContribution checks (diff against ${diffBase})`);
  const files = changedFiles(diffBase);

  if (files === null) {
    // Unresolvable base is a VIOLATION and never a skip: in CI this is the
    // whole security half of the run, and a silent skip would report a clean
    // sheet for checks that never executed.
    bad(`resolve the diff base "${diffBase}" (is the ref fetched?)`);
  } else if (!files.length) {
    ok(`nothing changed against ${diffBase}, so there is no contribution to check`);
  } else {
    console.log(`    ${files.length} changed file(s)`);

    // 3a. New dependencies. The house rule is that the answer is no, and CI
    // runs a Node three majors behind the dev boxes here, so a package that
    // builds green locally can go red there with no local signal.
    if (files.includes("package.json")) {
      const before = fileAtBase(diffBase, "package.json");
      const afterRaw = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
      let added = [];
      try {
        const a = JSON.parse(before ?? "{}");
        const b = JSON.parse(afterRaw);
        const keys = (o) => Object.keys({ ...(o.dependencies ?? {}), ...(o.devDependencies ?? {}) });
        const had = new Set(keys(a));
        added = keys(b).filter((k) => !had.has(k));
      } catch {
        bad("parse package.json at both ends of the diff");
      }
      if (added.length) {
        for (const dep of added) console.log(`    adds dependency: ${dep}`);
        bad(`no new dependencies (${added.length} added)`);
      } else {
        ok("no new dependencies");
      }
    } else {
      ok("package.json unchanged, so no new dependencies");
    }

    // 3b. The code patterns, over ADDED lines only.
    //
    // A file with a base version is scanned for hits and then those hits are
    // attributed: a hit on a line this change added is the contributor's, and a
    // hit anywhere else is pre-existing debt that happens to live in a file they
    // opened. Only the first kind blocks. A file with no base version is new, so
    // all of it is theirs.
    const findings = new Map(CODE_RULES.map((r) => [r.id, []]));
    let preExisting = 0;
    let newFiles = 0;
    for (const f of files) {
      const full = path.join(ROOT, ...f.split("/"));
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(f) || !fs.existsSync(full)) continue;
      let body = "";
      try { body = fs.readFileSync(full, "utf8"); } catch { continue; }

      const addedSet = addedLineNumbers(diffBase, f, ROOT);
      if (addedSet === null) newFiles += 1;

      const scan = scanFileLines({ relPath: f, body, addedSet });
      preExisting += scan.preExisting;
      waivers += scan.waived;
      for (const hit of scan.findings) {
        findings.get(hit.ruleId).push(`${hit.relPath}:${hit.line}  ${hit.text}`);
      }
    }
    for (const rule of CODE_RULES) {
      const hits = findings.get(rule.id);
      if (hits.length) {
        for (const h of hits) console.log(`    ${h}`);
        bad(`${rule.id}: ${hits.length} (${rule.why})`);
      } else {
        ok(rule.id);
      }
    }
    if (waivers) console.log(`    ${waivers} waiver(s) in force on the lines above.`);
    if (newFiles) console.log(`    ${newFiles} new file(s) scanned whole, having no base version to diff against.`);
    if (preExisting) {
      // Informational and deliberately not a violation. The debt is real and
      // worth seeing; charging it to whoever opened the file next is what made
      // this check refuse every server pull request.
      console.log(
        `    [pre-existing, not yours] ${preExisting} rule hit(s) on lines this change did not touch, in files it did touch.`,
      );
    }
  }

  note(
    "Whether a changed file does what its diff appears to do. The patterns above are a floor and the " +
      "security review in contract clause 13 is the ceiling; a human reads the diff.",
  );
} else {
  note(
    "The contribution checks did not run. Pass --diff to grep the changed files for raw fetch, raw SQL, " +
      "eval, protected-table writes, embedded credentials and new dependencies.",
  );
}

// ── 3b. The raw-SQL burn-down, repo-wide ─────────────────────────────────────
//
// Section 3 answers "did YOU add this", which is the only fair question to
// block a contributor on. This answers "is the platform's own total still
// falling", which no diff can see: move a query from one file to another and
// the diff-scoped rule reports a finding in the new place while the total
// stands still.
//
// It runs on every invocation, including a bare `validate-module.mjs saberra`.
// On a clean checkout it PASSES, because the register is committed beside the
// code it measures; it only goes red when the tree has actually moved. The
// alternative, hiding it behind `--diff`, would mean the repo-wide number is
// unmeasured on most runs while the output still reads like a verdict.
//
// Test files are deliberately out of this register and still inside section
// 3's rule. `scripts/sql-burndown.mjs` says why in its own header.

console.log("\nRaw SQL burn-down (repo-wide, not the diff)");
{
  // A THROW here is a VIOLATION and never a crash, the same rule this file
  // applies to MODULE_DOCS. `rawSqlRule` throws when the rule id has been
  // renamed out from under the register, and `readBaseline` throws on a
  // malformed JSON file. Both are real failures and both have to arrive as a
  // line the intake summary can render, rather than as a stack trace that ends
  // the run before sections 4 and 5 print.
  let run = null;
  try {
    run = runBurndown();
  } catch (e) {
    bad(`read the raw-SQL burn-down register: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (run) {
    console.log(
      `    ${run.result?.total ?? "unmeasured"} call site(s) in ${Object.keys(run.counts).length} file(s) ` +
        `of ${run.scanned} scanned; register ${run.result?.listedTotal ?? "?"}, ceiling ${BURNDOWN_CEILING}; ` +
        `${run.waived} same-line waiver(s) in force.`,
    );
    if (run.refusals.length) {
      for (const line of run.refusals) console.log(`    ${line}`);
      bad(`the raw-SQL burn-down register only shrinks: ${run.refusals.length} refusal(s)`);
    } else {
      ok(`the raw-SQL burn-down register is unchanged or lower (${run.result.total} of a ceiling of ${BURNDOWN_CEILING})`);
    }
  }
  note(
    "Whether a registered call site is debt worth repaying or a query that genuinely belongs where it is. " +
      "The register measures; it does not bless. A file listed there is not exempt from review, it is counted.",
  );
}

// ── 4. What this script cannot check ─────────────────────────────────────────

console.log("\nCannot be checked here (a reviewer owns each of these):");
const STANDING = [
  "Contract clause 1: jurisdiction and a named human are not registry fields, so a shared support@ inbox passes every check above.",
  "Contract clause 2: `read`, `write` and `health` have no interface anywhere yet, so only two of the five driver methods are checkable at all.",
  "Contract clause 4: a present credential in front of a dead service passes every presence check. There is no circuit breaker.",
  "Contract clause 5: no DPA record, sub-processor list, retention period or hard-delete turnaround exists as data.",
  "Contract clause 7: no interface-version field and no breaking-change notice record.",
  "Contract clause 9: nothing checks that the support URL and email actually resolve.",
  "Contract clause 12: the liveness probe does not exist, so a declared window is a promise nothing measures.",
  "Whether the support addresses are answered by a person who can act.",
];
// Every line here is marked, because these lines name contract clauses and a
// reader matching on a clause name would read a standing gap as a failure. The
// intake workflow did exactly that once and refused a clean repository. Machine
// readers key on `<-- VIOLATION`; nothing below ever carries it.
for (const line of [...STANDING, ...cannotCheck]) console.log(`  [not checked] ${line}`);

console.log(
  violations === 0
    ? `\nPASS  ${checks} check(s), 0 violations. ${STANDING.length + cannotCheck.length} thing(s) above are NOT checked.`
    : `\nFAIL  ${checks} check(s), ${violations} violation(s).`,
);
process.exit(violations === 0 ? 0 : 1);
