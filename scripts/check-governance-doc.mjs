#!/usr/bin/env node
/**
 * docs/GOVERNANCE.md still says what the code does.
 *
 * `scripts/generate-governance-doc.mjs` writes that document out of the
 * engine, the subject registry, the dials, the capability tables, the module
 * definition, the clock and the route registrations. This runs the same
 * generator and compares the result with the committed file. They differ when
 * somebody changed the code without regenerating, or edited the document by
 * hand, and both of those are the same failure: a village reading a governance
 * document that is quietly wrong.
 *
 * THIS CHECK IS THE WHOLE POINT OF GENERATING THE DOCUMENT. A generator with
 * no guard behind it produces a file that is correct on the day it is written
 * and indistinguishable from a hand-written one a month later. The guard is
 * what makes the document worth trusting, so it is a build failure and not a
 * warning.
 *
 * A RED HERE IS OFTEN CORRECT WORK LANDING. The engine is being built while
 * this document describes it. A lane that adds a subject type, a dial or a
 * route SHOULD turn this red, and the fix is one command.
 *
 * LINE ENDINGS ARE NORMALISED BEFORE COMPARING. `core.autocrlf` is true on the
 * Windows checkouts this repository is developed on, so git stores LF and
 * hands back CRLF, and a byte comparison would fail on one developer's machine
 * and pass in CI. `.gitattributes` marks this document `-text` so the bytes
 * stay put, and the comparison strips carriage returns as well, because the
 * same carriage-return class has produced a per-machine answer in this
 * repository's guards before.
 *
 * Usage:
 *   node scripts/check-governance-doc.mjs
 *   node scripts/check-governance-doc.mjs --list   print what the generator reads
 */
import fs from "node:fs";
import path from "node:path";
import { DOC_PATH, LINEAGE_PATH, ROOT, SOURCES, generateDetailed } from "./generate-governance-doc.mjs";

const REL = path.relative(ROOT, DOC_PATH).replace(/\\/g, "/");
const LINEAGE_REL = path.relative(ROOT, LINEAGE_PATH).replace(/\\/g, "/");
const REGENERATE = "node scripts/generate-governance-doc.mjs";

const normalise = (s) => s.replace(/\r\n/g, "\n");

function report(lines) {
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** The first place the two texts part company, with a little context. */
function firstDifference(wanted, found) {
  const a = wanted.split("\n");
  const b = found.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === b[i]) continue;
    return {
      line: i + 1,
      wanted: a[i] ?? "(the generated document ends here)",
      found: b[i] ?? "(the committed document ends here)",
      differing: Array.from({ length: Math.max(a.length, b.length) }, (_, n) => n).filter((n) => a[n] !== b[n]).length,
    };
  }
  return null;
}

function main() {
  if (process.argv.includes("--list")) {
    report([`${REL} is generated from:`, ...SOURCES.map((s) => `  ${s}`)]);
  }

  let wanted;
  let wantedLineage;
  let facts;
  try {
    ({ text: wanted, lineage: wantedLineage, facts } = generateDetailed());
  } catch (err) {
    report([
      `${REL} could not be generated, so it cannot be checked.`,
      "",
      String(err?.message ?? err),
      "",
      "The generator reads the code and refuses to guess. Fix what it names, or teach it the new shape.",
    ]);
    process.exit(1);
  }

  if (!fs.existsSync(DOC_PATH)) {
    report([`${REL} is missing. Run: ${REGENERATE}`]);
    process.exit(1);
  }

  /*
   * THE SHELF IS CHECKED TOO.
   *
   * `docs/knowledge/governance-lineage.md` is generated from the same words as
   * the document's "Where this comes from" section, and it is loaded into the
   * assistant's prompt, where a stale sentence is invisible to everybody. A
   * guard on one file and not the other would have left the copy nobody reads
   * with their eyes as the one nobody checks.
   */
  if (!fs.existsSync(LINEAGE_PATH)) {
    report([`${LINEAGE_REL} is missing. Run: ${REGENERATE}`]);
    process.exit(1);
  }
  const foundLineage = fs.readFileSync(LINEAGE_PATH, "utf8");
  const lineageDiff = firstDifference(normalise(wantedLineage), normalise(foundLineage));
  if (lineageDiff) {
    report([
      `${LINEAGE_REL} and the code have come apart. ${lineageDiff.differing} line(s) differ.`,
      "",
      `  line ${lineageDiff.line}`,
      `  the code says:  ${lineageDiff.wanted.slice(0, 200)}`,
      `  the file says:  ${lineageDiff.found.slice(0, 200)}`,
      "",
      `It is generated beside ${REL} from the same words. Regenerate both:`,
      `    ${REGENERATE}`,
    ]);
    process.exit(1);
  }

  const found = fs.readFileSync(DOC_PATH, "utf8");
  const diff = firstDifference(normalise(wanted), normalise(found));
  if (!diff) {
    const staged = Object.entries(facts.staged).filter(([, still]) => still).length;
    report([
      `Governance doc guard passed. ${REL} and ${LINEAGE_REL} match the code: ` +
        `${facts.subjects.length} subject types with a floor of their own, ` +
        `${facts.dispatcher.all.length} that execute at close, ` +
        `${facts.dials.all.length} dials, ` +
        `${facts.routes.total} routes (${facts.routes.anonymous.length} answering a stranger, ` +
        `${facts.routes.undeclared.length} this reader could not classify), ` +
        `and ${staged} rulings still staged.`,
    ]);
    return;
  }

  report([
    `${REL} and the code have come apart. ${diff.differing} line(s) differ.`,
    "",
    `  line ${diff.line}`,
    `  the code says:  ${diff.wanted.slice(0, 200)}`,
    `  the file says:  ${diff.found.slice(0, 200)}`,
    "",
    "If the code is right, regenerate the document:",
    `    ${REGENERATE}`,
    "",
    "If the document is right, the code is what needs changing. Editing the document alone does not hold:",
    "it is written by the generator, and the next run will overwrite it.",
    "",
    "If the only difference is the commit line near the top, regenerate once more. That line names the last",
    "commit that changed a source, and a commit that changes a source and regenerates this file at the same",
    "time cannot know its own id yet.",
  ]);
  process.exit(1);
}

main();
