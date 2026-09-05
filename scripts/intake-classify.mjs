#!/usr/bin/env node
/**
 * Which stage is blocking a module listing, decided once and testable.
 *
 * WHY THIS IS A FILE AND NOT A SHELL BLOCK IN THE WORKFLOW. It used to be a
 * chain of greps inside `.github/workflows/module-intake.yml`, and one of those
 * greps matched a bare `clause 14`. The listing lint also prints a STANDING
 * NOTE saying the pool field does not exist yet and so the clause cannot be
 * enforced, that note names clause 14, and the result was a workflow that read
 * its own informational text as a blocking violation. It failed the first real
 * module pull request it ever saw, and it would have failed every one after.
 *
 * The bug was cheap. Not being able to test it was the expensive part: logic
 * embedded in a workflow only runs when a pull request runs it, so the clean
 * path was never exercised until a real contributor exercised it. Here it is a
 * function with `scripts/intake-classify.test.mjs` beside it, and the clean
 * path is the first case that test asserts.
 *
 * THE RULE THAT PREVENTS THE WHOLE CLASS: classification reads ONLY lines the
 * validator marked `<-- VIOLATION`. Nothing informational is ever an input.
 * Every pattern below is a substring of a line `validate-module.mjs` itself
 * decided was a failure.
 *
 * Usage:
 *   node scripts/intake-classify.mjs --listing <file> --facts <file> \
 *        --facts-exit N --links-exit N --listing-exit N [--github-output <file>]
 *
 * Prints JSON: { blocked, stage, warnings }. With `--github-output` it also
 * appends `blocked`, `stage` and `warnings` in the workflow-output format, so
 * the workflow never has to re-parse this and never has to quote a multi-line
 * value in shell. Always exits 0: this reports and never enforces, and the
 * caller decides what a block is worth.
 */
import fs from "node:fs";

/** The marker the listing lint puts on a line it failed. */
export const VIOLATION = "<-- VIOLATION";

/**
 * Stage rules, in the order a builder should fix them. First match wins, so a
 * listing failing three stages is told about the earliest one: fixing stage 1
 * often resolves what stage 5 was complaining about, and a list of five
 * problems is a worse first response than the one that comes first.
 */
export const STAGE_RULES = [
  {
    stage: "Stage 1 (diligence): the counterparty this listing needs is incomplete.",
    patterns: ["vendor record present", "support URL and support email both set"],
  },
  {
    stage:
      "Stage 3 (data and legal): a member-pii listing must register a member driver, so a deletion reaches outside.",
    patterns: ["member driver somewhere under server/"],
  },
  {
    stage:
      "Stage 5 (tier and commercials): the price, the licence slot and the pool rule are not consistent.",
    patterns: ["licence slot it owns", "not pool-eligible"],
  },
  {
    stage: "Stage 6 (build and security review): the diff contains a pattern contract clause 13 refuses.",
    patterns: [
      "raw fetch outside guardedFetchJson",
      "raw SQL outside server/repos",
      "eval or a non-literal dynamic import",
      "a write to a protected table",
      "a credential written into code",
      "no new dependencies",
    ],
  },
  {
    // LAST on purpose. This one is repo-wide rather than diff-attributed, so a
    // listing that also fails a stage above should hear about that first: the
    // rule directly above names the line the contributor wrote, and this names
    // a total. When it is the only failure the message still has to be
    // actionable, which is why it says which way the number moves.
    stage:
      "Stage 6 (build and security review): the raw-SQL burn-down register grew. That register only shrinks; move the query into a repo under server/repos.",
    patterns: ["the raw-SQL burn-down register only shrinks"],
  },
];

/**
 * Decide the blocking stage.
 *
 * `listingText` is the listing lint's whole output and `factsText` the facts
 * command's. Exit codes come from the caller because a script's exit code is a
 * fact about the run, not something to re-derive from its prose.
 */
export function classify({ listingText = "", factsText = "", factsExit = 0, linksExit = 0, listingExit = 0 }) {
  // Violations only. Everything else the validator prints, including every
  // "[not checked]" line naming a contract clause, is invisible here by
  // construction.
  const violations = listingText
    .split(/\r?\n/)
    .filter((line) => line.includes(VIOLATION))
    .join("\n");

  let stage = "";
  if (factsExit !== 0) {
    stage =
      "Stage 0 (intake): this repository could not report its own facts. A source file the framework depends on is missing.";
  } else {
    for (const rule of STAGE_RULES) {
      if (rule.patterns.some((p) => violations.includes(p))) {
        stage = rule.stage;
        break;
      }
    }
    if (!stage && linksExit !== 0) {
      stage = "Stage 6 (build): a builder document points at a path that does not exist.";
    }
    if (!stage && listingExit !== 0) {
      stage =
        "Stage 6 (build): the listing lint reported a violation. The output below names it; it did not match a known stage marker.";
    }
  }

  // WARNINGS ARE NOT BLOCKS, and this is the one place that stays true by
  // construction: warnings are computed after `stage` and never assigned to it.
  // The contract version the document states and the version the registry
  // constant stamps can disagree while a lane is mid-flight between them. That
  // is the platform's problem and refusing a builder's listing for it would be
  // charging them for our own bookkeeping.
  const warnings = [];
  if (factsText.includes("THESE DISAGREE")) {
    warnings.push(
      "The contract version in docs/MODULE_LIBRARY_CONTRACT.md and the MODULE_LIBRARY_CONTRACT_VERSION " +
        "constant disagree. That is a platform issue and does not block this listing.",
    );
  }

  return { blocked: stage !== "", stage, warnings: warnings.join("\n") };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (isMain) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
  };
  const read = (p) => {
    if (!p) return "";
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };

  const verdict = classify({
    listingText: read(arg("--listing", "")),
    factsText: read(arg("--facts", "")),
    factsExit: Number(arg("--facts-exit", "0")),
    linksExit: Number(arg("--links-exit", "0")),
    listingExit: Number(arg("--listing-exit", "0")),
  });

  console.log(JSON.stringify(verdict, null, 2));

  const outFile = arg("--github-output", process.env.GITHUB_OUTPUT ?? "");
  if (process.argv.includes("--github-output") && outFile) {
    // Heredoc form for every value: a stage sentence is prose and a warning can
    // be several lines, and the delimiters keep both intact without any shell
    // quoting in the workflow.
    const block = (key, value) => `${key}<<INTAKE_EOF\n${value}\nINTAKE_EOF\n`;
    fs.appendFileSync(
      outFile,
      `blocked=${verdict.blocked ? "yes" : "no"}\n` + block("stage", verdict.stage) + block("warnings", verdict.warnings),
      "utf8",
    );
  }
}
