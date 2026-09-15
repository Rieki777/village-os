#!/usr/bin/env node
/**
 * The generated regions of docs/ECONOMICS.md still say what the code does.
 *
 * `scripts/generate-economics-doc.mjs` renders each marked region out of the
 * migrations and the server source. This runs the same renderers and compares
 * the result with the committed file, region by region. They differ when
 * somebody changed the code without regenerating, or edited a region by hand,
 * and both of those are the same failure: a founder, a contributor or an agent
 * reading an economics document that is quietly wrong. Anything in that file
 * that is not true is worse than nothing, because somebody will act on it.
 *
 * THE DOCUMENT IS HALF GENERATED AND HALF PROSE, so there are two guards and
 * this is only one of them. This one holds the facts. `check-economics-narrative.mjs`
 * holds the prose, by failing when the economy's code moved and the document
 * did not.
 *
 * ── THE EXIT CODES, AND WHY THERE ARE THREE ────────────────────────────────
 *
 * The question every exit path here was written against is: WHAT DOES THIS
 * PRINT WHEN IT DID NOT ACTUALLY RUN? A guard that cannot tell "I checked and
 * found nothing wrong" from "I could not check" converts unchecked into
 * passed, and that is the failure mode this repository has catalogued more
 * than any other.
 *
 *   0  every region was regenerated and matched. A real pass, and it says how
 *      many regions it compared, so "none found" cannot read as success.
 *   1  a region and the code have come apart. Both sides are printed.
 *   2  THE CHECK COULD NOT RUN. A marker is missing or duplicated, the
 *      document is not there, a source file the generator reads is gone, or a
 *      reader's anchor moved. Never 0, and deliberately not 1 either: 1 means
 *      "I looked and the answer is bad", 2 means "I could not look", and a
 *      person reading a red build needs to know which.
 *
 * Any unexpected throw is also 2, for the same reason: an exception that
 * escaped is by definition a check that did not finish.
 *
 * LINE ENDINGS ARE NORMALISED BEFORE COMPARING. `core.autocrlf` is true on the
 * Windows checkouts this repository is developed on, so git stores LF and
 * hands back CRLF, and a byte comparison would fail on one developer's machine
 * and pass in CI. The same carriage-return class has produced a per-machine
 * answer in this repository's guards twice before (see
 * scripts/check-brand-refs.test.mjs).
 *
 * Usage:
 *   node scripts/check-economics-doc.mjs
 *   node scripts/check-economics-doc.mjs --list          what the generator reads
 *   node scripts/check-economics-doc.mjs --root <dir>    read sources from another tree
 *   node scripts/check-economics-doc.mjs --doc <file>    check another copy of the document
 *
 * The last two exist for scripts/check-economics-doc.test.mjs, which builds
 * real fixture documents in a temp directory and reads the real exit codes.
 */
import fs from "node:fs";
import path from "node:path";
import {
  DOC_PATH,
  DOC_RELATIVE,
  REGION_NAMES,
  ROOT,
  SOURCES,
  endMarker,
  findRegion,
  renderAll,
  startMarker,
} from "./generate-economics-doc.mjs";

const REGENERATE = "node scripts/generate-economics-doc.mjs";

const EXIT_OK = 0;
const EXIT_DRIFT = 1;
const EXIT_CANNOT_RUN = 2;

function valueOf(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const say = (...lines) => process.stdout.write(`${lines.join("\n")}\n`);

/** Every line that differs, with the generated side and the committed side. */
function lineDiff(wanted, found) {
  const a = wanted.split("\n");
  const b = found.split("\n");
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === b[i]) continue;
    out.push({
      line: i + 1,
      wanted: a[i] ?? "(the generated region ends here)",
      found: b[i] ?? "(the committed region ends here)",
    });
  }
  return out;
}

const normalise = (s) => s.replace(/\r\n/g, "\n");

function main() {
  const root = valueOf("--root") ? path.resolve(valueOf("--root")) : ROOT;
  const docPath = valueOf("--doc") ? path.resolve(valueOf("--doc")) : DOC_PATH;
  const docLabel = path.relative(root, docPath).replace(/\\/g, "/") || DOC_RELATIVE;

  if (process.argv.includes("--list")) {
    say(`${DOC_RELATIVE}'s generated regions are read from:`, ...SOURCES.map((s) => `  ${s}`));
    say("", `Regions: ${REGION_NAMES.join(", ")}`);
  }

  /*
   * The sources are read BEFORE the document is opened, on purpose. A missing
   * source and a missing document are both exit 2, but they are different
   * sentences, and reading the code first means the error names the thing that
   * actually moved rather than blaming the document for it.
   */
  let rendered;
  try {
    rendered = renderAll(root);
  } catch (err) {
    say(
      `${docLabel} could not be regenerated, so it cannot be checked.`,
      "",
      String(err?.message ?? err),
      "",
      "The generator reads the code and refuses to guess. Fix what it names, or teach it the new shape.",
      "This is exit 2 and not exit 1: nothing was compared.",
    );
    return EXIT_CANNOT_RUN;
  }

  if (!fs.existsSync(docPath)) {
    say(
      `${docLabel} is not there, so there is nothing to check against the code.`,
      "",
      `Exit 2, not 1: a document that is absent has not "drifted", and a guard that`,
      "reported a missing file as a clean run would be the whole problem.",
    );
    return EXIT_CANNOT_RUN;
  }

  const text = normalise(fs.readFileSync(docPath, "utf8"));

  // Every marker problem is collected before any is reported. One run should
  // name every region a person has to fix, not the first one.
  const missing = [];
  const regions = [];
  for (const name of REGION_NAMES) {
    const found = findRegion(text, name);
    if (found.problem) {
      missing.push({ name, problem: found.problem });
      continue;
    }
    regions.push({ name, found: found.body });
  }

  if (missing.length) {
    say(
      `${docLabel}: ${missing.length} generated region(s) cannot be found, so the check did not run.`,
      "",
      ...missing.flatMap((m) => [
        `  generated:${m.name}`,
        `    ${m.problem}`,
        `    it must read exactly:  ${startMarker(m.name)} ... ${endMarker(m.name)}`,
      ]),
      "",
      "A marker that is gone is not an empty region. Deleting the markers would delete a table",
      "the code still guarantees, and comparing nothing with nothing would call that a pass.",
      "",
      `Restore the markers, then regenerate:  ${REGENERATE}`,
      "Exit 2: nothing was compared.",
    );
    return EXIT_CANNOT_RUN;
  }

  /*
   * A run that compared nothing is a failure. This is unreachable while
   * REGION_NAMES is non-empty and the loop above returned early on any
   * missing marker, which is exactly why it is checked: the day somebody
   * empties REGIONS, this says so instead of printing a confident green.
   */
  if (regions.length === 0) {
    say(
      `${docLabel}: no generated regions exist to check.`,
      "Either every region was deleted from scripts/generate-economics-doc.mjs or this script is",
      "looking at the wrong document. Both are failures, not a clean run.",
    );
    return EXIT_CANNOT_RUN;
  }

  const drifted = regions
    .map((r) => ({ ...r, diff: lineDiff(normalise(rendered[r.name]), r.found) }))
    .filter((r) => r.diff.length > 0);

  if (!drifted.length) {
    say(
      `Economics doc guard passed. ${docLabel}: ${regions.length} generated region(s) match the code ` +
        `(${REGION_NAMES.join(", ")}).`,
    );
    return EXIT_OK;
  }

  const lines = [
    `${docLabel} and the code have come apart in ${drifted.length} of ${regions.length} generated region(s).`,
  ];
  for (const r of drifted) {
    lines.push("", `  generated:${r.name}  (${r.diff.length} line(s) differ)`);
    for (const d of r.diff) {
      lines.push(
        `    line ${d.line}`,
        `      the code says:  ${d.wanted.slice(0, 300)}`,
        `      the file says:  ${d.found.slice(0, 300)}`,
      );
    }
  }
  lines.push(
    "",
    "If the code is right, regenerate the document:",
    `    ${REGENERATE}`,
    "",
    "If the document is right, the code is what needs changing. Editing a generated region alone",
    "does not hold: it is written by the generator, and the next run overwrites it.",
  );
  say(...lines);
  return EXIT_DRIFT;
}

/*
 * The last exit path, and the one that matters most.
 *
 * Anything that escapes main() is a check that did not finish, so it can never
 * be 0 and it is not 1 either. Without this the process would exit 1 on an
 * uncaught throw, which reads in CI exactly like "the document drifted" and
 * sends the next person to regenerate a document that was never the problem.
 */
try {
  process.exit(main());
} catch (err) {
  process.stdout.write(
    [
      "check-economics-doc.mjs did not finish, so it is making no claim about the document.",
      "",
      String(err?.stack ?? err?.message ?? err),
      "",
      "Exit 2: this is the guard failing, not the document failing.",
      "",
    ].join("\n"),
  );
  process.exit(EXIT_CANNOT_RUN);
}
