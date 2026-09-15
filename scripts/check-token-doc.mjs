#!/usr/bin/env node
/**
 * docs/TOKENS.md still says what the code does.
 *
 * `scripts/generate-token-doc.mjs` writes that document out of the migrations
 * and the server source. This runs the same generator and compares the result
 * with the committed file. They differ when somebody changed the code without
 * regenerating, or edited the document by hand, and both of those are the same
 * failure: a founder reading a token document that is quietly wrong.
 *
 * THIS CHECK IS THE WHOLE POINT OF GENERATING THE DOCUMENT. A generator with no
 * guard behind it produces a file that is correct on the day it is written and
 * indistinguishable from a hand-written one a month later. The guard is what
 * makes the document worth trusting, so it is a build failure and not a warning.
 *
 * LINE ENDINGS ARE NORMALISED BEFORE COMPARING. `core.autocrlf` is true on the
 * Windows checkouts this repository is developed on, so git stores LF and hands
 * back CRLF, and a byte comparison would fail on one developer's machine and
 * pass in CI. `.gitattributes` marks this document `-text` so the bytes stay
 * put, and the comparison strips carriage returns as well, because the same
 * carriage-return class has produced a per-machine answer in this repository's
 * guards twice before (see scripts/check-brand-refs.test.mjs).
 *
 * Usage:
 *   node scripts/check-token-doc.mjs
 *   node scripts/check-token-doc.mjs --list   print what the generator reads
 */
import fs from "node:fs";
import path from "node:path";
import { DOC_PATH, ROOT, SOURCES, generateDetailed } from "./generate-token-doc.mjs";

const REL = path.relative(ROOT, DOC_PATH).replace(/\\/g, "/");
const REGENERATE = "node scripts/generate-token-doc.mjs";

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

  /*
   * ── COULD NOT RUN IS EXIT 2, NOT EXIT 1 ────────────────────────────────
   *
   * This script used to exit 1 for everything that was not a pass: the
   * document drifted, the document was absent, and the generator threw were
   * all one code. None of those was ever reported as success, so it was never
   * a false green; what it cost is that a person reading a red build could not
   * tell "I looked and the document is wrong" from "I could not look", and the
   * printed message was the only thing carrying the difference.
   *
   * That difference now matters more than it did. `setConst` refuses a
   * keystone set written in any shape but the two documented ones, and that
   * refusal arrives here as a throw. A widened `ALLOW_NEGATIVE_SOURCES` and a
   * hand-edited table are very different emergencies and must not share an
   * exit code.
   *
   * 1 = I compared and they differ. 2 = I could not compare.
   * scripts/check-economics-doc.mjs has drawn the line there since it was
   * written, and this now matches it.
   */
  let wanted;
  let facts;
  try {
    ({ text: wanted, facts } = generateDetailed());
  } catch (err) {
    report([
      `${REL} could not be generated, so it cannot be checked.`,
      "",
      String(err?.message ?? err),
      "",
      "The generator reads the code and refuses to guess. Fix what it names, or teach it the new shape.",
      "Exit 2: nothing was compared.",
    ]);
    process.exit(2);
  }

  if (!fs.existsSync(DOC_PATH)) {
    report([
      `${REL} is missing, so there is nothing to check against the code. Run: ${REGENERATE}`,
      "Exit 2, not 1: a document that is absent has not drifted.",
    ]);
    process.exit(2);
  }

  const found = fs.readFileSync(DOC_PATH, "utf8");
  const diff = firstDifference(normalise(wanted), normalise(found));
  if (!diff) {
    report([
      `Token doc guard passed. ${REL} matches the code: ` +
        `${facts.tokens.length} tokens (${facts.tokens.filter((t) => t.governance === "platform").length} minted here, ` +
        `${facts.tokens.filter((t) => t.governance !== "platform").length} read from Base).`,
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
  ]);
  process.exit(1);
}

main();
