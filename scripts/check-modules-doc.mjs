#!/usr/bin/env node
/**
 * docs/MODULES.md still says what the registry says.
 *
 * `scripts/generate-modules-doc.mjs` writes that document out of
 * `shared/modules.ts` and the files beside it. This runs the same generator
 * and compares the result with the committed file. They differ when somebody
 * changed the registry without regenerating, or edited the document by hand,
 * and both of those are the same failure: a fork operator reading a module
 * reference that is quietly wrong.
 *
 * THIS CHECK IS THE WHOLE POINT OF GENERATING THE DOCUMENT. A generator with
 * no guard behind it produces a file that is correct on the day it is written
 * and indistinguishable from a hand-written one a month later. The guard is
 * what makes the document worth trusting, so it is a build failure and never a
 * warning.
 *
 * LINE ENDINGS ARE NORMALISED BEFORE COMPARING. `core.autocrlf` is true on the
 * Windows checkouts this repository is developed on, so git stores LF and
 * hands back CRLF, and a byte comparison would fail on one developer's machine
 * and pass in CI. The comparison strips carriage returns for that reason, and
 * `.gitattributes` should mark this document `-text` so the bytes stay put.
 * The same carriage-return class has produced a per-machine answer in this
 * repository's guards twice before (see `scripts/check-brand-refs.test.mjs`).
 *
 * Usage:
 *   node scripts/check-modules-doc.mjs
 *   node scripts/check-modules-doc.mjs --list   print what the generator reads
 */
import fs from "node:fs";
import path from "node:path";
import { DOC_PATH, ROOT, SOURCES, generateDetailed } from "./generate-modules-doc.mjs";

const REL = path.relative(ROOT, DOC_PATH).replace(/\\/g, "/");
const REGENERATE = "node scripts/generate-modules-doc.mjs";

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

if (process.argv.includes("--list")) {
  report([`${REL} is generated from:`, ...SOURCES.map((s) => `  ${s}`)]);
}

let wanted;
let facts;
try {
  ({ text: wanted, facts } = await generateDetailed());
} catch (err) {
  report([
    `${REL} could not be generated, so it cannot be checked.`,
    "",
    String(err?.message ?? err),
    "",
    "The generator reads the registry and refuses to guess. Fix what it names, or teach it the new shape.",
  ]);
  process.exit(1);
}

if (!fs.existsSync(DOC_PATH)) {
  report([`${REL} is missing. Run: ${REGENERATE}`]);
  process.exit(1);
}

const found = fs.readFileSync(DOC_PATH, "utf8");
const diff = firstDifference(normalise(wanted), normalise(found));
if (!diff) {
  report([
    `Module doc guard passed. ${REL} matches the registry: ` +
      `${facts.modules.length} module(s), ${facts.core.length} core, ` +
      `${facts.modules.filter((m) => m.doc).length} with a contract doc.`,
  ]);
} else {
  report([
    `${REL} and the registry have come apart. ${diff.differing} line(s) differ.`,
    "",
    `  line ${diff.line}`,
    `  the registry says:  ${diff.wanted.slice(0, 200)}`,
    `  the file says:      ${diff.found.slice(0, 200)}`,
    "",
    "If the registry is right, regenerate the document:",
    `    ${REGENERATE}`,
    "",
    "If the document is right, the registry is what needs changing. Editing the document alone does not hold:",
    "it is written by the generator, and the next run will overwrite it.",
  ]);
  process.exit(1);
}
