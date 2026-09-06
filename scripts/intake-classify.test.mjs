#!/usr/bin/env node
/**
 * The intake classifier's regression test.
 *
 *   node scripts/intake-classify.test.mjs
 *
 * Case 1 is the one that matters and the one that was missing. The classifier
 * shipped with a proof that a violating listing blocks, and no proof at all
 * that a clean one passes, so a grep matching an informational line went
 * unnoticed until it refused a real contributor's pull request. The blocking
 * path was authored and measured by the same pass; the passing path was never
 * measured by anything.
 *
 * Run in the house style of `scripts/check-brand-refs.test.mjs`: plain Node, no
 * runner, non-zero exit on failure.
 */
import { classify } from "./intake-classify.mjs";

let failures = 0;
let assertions = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  assertions++;
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`          expected: ${JSON.stringify(expected)}`);
    console.log(`          actual:   ${JSON.stringify(actual)}`);
  }
};

/**
 * A clean run, reproduced from real `validate-module.mjs` output. Every
 * informational hazard is present on purpose: the standing notes name contract
 * clauses 1, 2 and 14, and one of them says the pool field does not exist. A
 * classifier that reads anything other than violation lines fails here.
 */
const CLEAN = `Validating 18 module(s) against the registry at shared/modules.ts

Registry shape (shared/modules.ts:moduleListingProblems)
  listing shape problems for the selected module(s): 0  OK
  read MODULE_DOCS from server/lib/knowledge.ts (9 entries)  OK

Contribution checks (diff against origin/main)
  package.json unchanged, so no new dependencies  OK
  raw fetch outside guardedFetchJson  OK
  raw SQL outside server/repos  OK
  eval or a non-literal dynamic import  OK
  a write to a protected table  OK
  a credential written into code  OK

Cannot be checked here (a reviewer owns each of these):
  [not checked] Contract clause 1: jurisdiction and a named human are not registry fields.
  [not checked] Contract clause 2: \`read\`, \`write\` and \`health\` have no interface anywhere yet.
  [not checked] Pool eligibility is not a registry field yet, so the rule that a priced listing may not also draw from the builders' pool cannot bite. The field will be \`pool\`; this activates when it lands.

PASS  35 check(s), 0 violations. 19 thing(s) above are NOT checked.`;

const violation = (line) => `${CLEAN}\n${line}  <-- VIOLATION`;

console.log("Intake classifier");

// 1. THE REGRESSION. A clean registry passes, with every clause-naming note present.
const clean = classify({ listingText: CLEAN, listingExit: 0 });
check("a clean listing is not blocked", clean.blocked, false);
check("a clean listing names no stage", clean.stage, "");

// 2. The exact defect, isolated: the pool note alone must never classify.
const noteOnly = classify({
  listingText:
    "  [not checked] Pool eligibility is not a registry field yet, so the rule that a priced listing may not also draw from the builders' pool cannot bite.",
  listingExit: 0,
});
check("the pool standing note alone does not block", noteOnly.blocked, false);

// 3. Each stage still fires on a real violation line.
check(
  "a missing vendor record blocks at stage 1",
  classify({ listingText: violation("  vendor record present"), listingExit: 1 }).stage,
  STAGE("Stage 1"),
);
check(
  "a missing member driver blocks at stage 3",
  classify({ listingText: violation("  member-pii listing registers a member driver somewhere under server/"), listingExit: 1 }).stage,
  STAGE("Stage 3"),
);
check(
  "a pool violation blocks at stage 5",
  classify({
    listingText: violation("  a listing that declares pricing is not pool-eligible (contract clause 14)"),
    listingExit: 1,
  }).stage,
  STAGE("Stage 5"),
);
check(
  "a raw fetch blocks at stage 6",
  classify({ listingText: violation("  raw fetch outside guardedFetchJson: 1"), listingExit: 1 }).stage,
  STAGE("Stage 6 (build and security"),
);

// 3b. The burn-down register, which is repo-wide and not the contributor's
// diff. It classified as "unrecognised" for as long as it had no rule, which
// sends a builder to read output that is not about them.
check(
  "a grown raw-SQL register blocks at stage 6 and says which register",
  classify({
    listingText: violation("  the raw-SQL burn-down register only shrinks: 2 refusal(s)"),
    listingExit: 1,
  }).stage,
  STAGE("Stage 6 (build and security review): the raw-SQL burn-down"),
);
// The register's own informational line is NOT a violation and must never
// classify. It prints on every run, green or red, and it names the rule.
check(
  "the register's passing line does not block",
  classify({
    listingText: `${CLEAN}\n    764 call site(s) in 77 file(s) of 511 scanned; register 764, ceiling 764; 62 same-line waiver(s) in force.`,
    listingExit: 0,
  }).blocked,
  false,
);

// 4. Earliest stage wins when several fail at once.
const many = classify({
  listingText: `${violation("  vendor record present")}\n  raw fetch outside guardedFetchJson: 1  <-- VIOLATION`,
  listingExit: 1,
});
check("the earliest failing stage is the one reported", many.stage, STAGE("Stage 1"));

// 5. Unreadable facts outrank everything.
check(
  "a facts failure blocks at stage 0",
  classify({ listingText: violation("  vendor record present"), factsExit: 1, listingExit: 1 }).stage,
  STAGE("Stage 0"),
);

// 6. A doc-link failure blocks only when nothing earlier did.
check(
  "a dead doc link blocks at stage 6",
  classify({ listingText: CLEAN, linksExit: 1 }).stage,
  STAGE("Stage 6 (build): a builder document"),
);

// 7. A non-zero lint with no known marker is reported as unclassified.
check(
  "an unrecognised violation still blocks",
  classify({ listingText: `${CLEAN}\n  something new  <-- VIOLATION`, listingExit: 1 }).blocked,
  true,
);

// 8. Warnings never block.
const warned = classify({
  listingText: CLEAN,
  factsText: "Contract version\n  THESE DISAGREE. A listing is stamped with the constant.",
  listingExit: 0,
});
check("a contract version mismatch does not block", warned.blocked, false);
check("a contract version mismatch is reported as a warning", warned.warnings.includes("does not block"), true);

/** Match a stage by its prefix, so wording can change without breaking this. */
function STAGE(prefix) {
  const all = [
    "Stage 0 (intake): this repository could not report its own facts. A source file the framework depends on is missing.",
    "Stage 1 (diligence): the counterparty this listing needs is incomplete.",
    "Stage 3 (data and legal): a member-pii listing must register a member driver, so a deletion reaches outside.",
    "Stage 5 (tier and commercials): the price, the licence slot and the pool rule are not consistent.",
    "Stage 6 (build and security review): the diff contains a pattern contract clause 13 refuses.",
    // Two sentences now share the "build and security review" opening, and
    // `find` returns the first. That is deliberate: the shorter prefix keeps
    // naming the diff-attributed stage, which is the one a contributor is
    // likelier to hit, and this one takes a prefix long enough to be unlike it.
    "Stage 6 (build and security review): the raw-SQL burn-down register grew. That register only shrinks; move the query into a repo under server/repos.",
    "Stage 6 (build): a builder document points at a path that does not exist.",
  ];
  const hit = all.find((s) => s.startsWith(prefix));
  if (!hit) throw new Error(`no stage starts with "${prefix}"`);
  return hit;
}

console.log(
  failures === 0
    ? `\nPASS  intake classifier: ${assertions} assertion(s), 0 failures.`
    : `\nFAIL  intake classifier: ${failures} failure(s).`,
);
process.exit(failures === 0 ? 0 : 1);
