/**
 * Which documents describe code that has moved under them.
 *
 * THIS IS A REPORT, NOT A GATE, and the distinction is the whole design.
 *
 * A gate can prove a path resolves, that a generated file matches its
 * generator, that a count matches a registry. It cannot prove a paragraph is
 * still true. The tempting fix is to check line-number citations, and this
 * repository measured what that costs: 220 line-anchored citations across the
 * docs, of which 33 fail, 29 pass and 84 are unjudgeable, and 29 of 62 numeric
 * anchors point into server/index.ts, a file taking 387 commits in 90 days.
 * One line inserted near its top turns dozens of citations red at once, none
 * of them the committer's fault. A gate like that is waived into a SKIPPED
 * list within a month and then looks like protection while being none.
 *
 * So this never blocks. It answers one question a human can act on:
 *
 *   Which documents make claims about code that changed while they did not?
 *
 * That is the honest proxy for staleness. It produces false alarms (a rename
 * touches a file without invalidating a sentence) and misses things (a doc can
 * rot with no commit anywhere). Both are acceptable in a report and would be
 * intolerable in a gate.
 *
 * COVERAGE IS A GLOB, NEVER A LIST. Every markdown file under docs/ and the
 * repository root is scanned for its own subject marker. A central registry of
 * "documents we care about" is a list somebody has to remember to append to,
 * which is the failure mode check-doc-links.mjs already recorded when it moved
 * from a hand-list of six to a glob. A document opts in by declaring what it
 * describes, in itself, on one line:
 *
 *   <!-- describes: server/index.ts shared/modules.ts docs/modules/ -->
 *
 * A path may be a file or a directory prefix. A document with no marker is
 * reported as UNDECLARED rather than skipped silently, because a core document
 * that never opts in is exactly the one that rots unseen.
 *
 * WHY A WEEKLY CADENCE AND NOT PER-COMMIT. Borrowed from codeql.yml's own
 * reasoning, inverted: the value of a scheduled run is not that the code
 * changed, it is that nobody noticed it changing under a document. Per-commit
 * this fires constantly and teaches people to ignore it. Weekly it is a short
 * list somebody reads.
 *
 * Usage:
 *   node scripts/check-doc-freshness.mjs            # human report, always exit 0
 *   node scripts/check-doc-freshness.mjs --since 7  # window in days (default 7)
 *   node scripts/check-doc-freshness.mjs --json     # machine readable
 *   node scripts/check-doc-freshness.mjs --strict   # exit 1 if anything is stale
 *
 * --strict exists for a human running it deliberately. CI must not use it.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const strict = args.includes("--strict");
const sinceIdx = args.indexOf("--since");
const days = sinceIdx >= 0 ? Number(args[sinceIdx + 1]) || 7 : 7;

const MARKER = /<!--\s*describes:\s*([^>]+?)\s*-->/i;

/** Every tracked markdown under docs/ or the repo root. Never a hand list. */
function docs() {
  const out = execFileSync("git", ["ls-files", "*.md", "docs/**/*.md"], { cwd: ROOT, encoding: "utf8" });
  return Array.from(new Set(out.split("\n").map((s) => s.trim()).filter(Boolean)))
    .filter((f) => !f.startsWith("node_modules/"))
    .sort();
}

/** Last commit touching a path, as an ISO date, or null when never committed. */
function lastTouched(p) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", p], { cwd: ROOT, encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Paths under a prefix that changed in the window, as a deduped list. */
function changedSince(prefix, sinceIso) {
  try {
    const out = execFileSync(
      "git",
      ["log", "--since", sinceIso, "--name-only", "--format=", "--", prefix],
      { cwd: ROOT, encoding: "utf8" },
    );
    return Array.from(new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))).sort();
  } catch {
    return [];
  }
}

const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();
const stale = [];
const undeclared = [];
const fresh = [];

for (const doc of docs()) {
  const abs = path.join(ROOT, doc);
  if (!fs.existsSync(abs)) continue;
  const head = fs.readFileSync(abs, "utf8").slice(0, 4000);
  const m = head.match(MARKER);
  if (!m) {
    undeclared.push(doc);
    continue;
  }
  const subjects = m[1].split(/\s+/).filter(Boolean);
  const docTouched = lastTouched(doc);
  const moved = [];
  for (const s of subjects) {
    for (const f of changedSince(s, sinceIso)) {
      // A document describing docs/ would otherwise report itself.
      if (f !== doc) moved.push(f);
    }
  }
  const uniqueMoved = Array.from(new Set(moved)).sort();
  if (uniqueMoved.length === 0) {
    fresh.push({ doc, subjects });
    continue;
  }
  // The document changed too, so somebody has already looked.
  if (docTouched && docTouched >= sinceIso) {
    fresh.push({ doc, subjects, note: "subject moved and the document was updated in the same window" });
    continue;
  }
  stale.push({ doc, subjects, docTouched, changed: uniqueMoved.slice(0, 12), changedCount: uniqueMoved.length });
}

if (asJson) {
  console.log(JSON.stringify({ days, stale, undeclared, fresh: fresh.length }, null, 2));
} else {
  console.log(`Documentation freshness, ${days} day window (a report, never a gate).\n`);
  if (stale.length === 0) {
    console.log("Nothing to look at: no declared document describes code that moved without it.");
  } else {
    console.log(`${stale.length} document(s) describe code that moved while they did not:\n`);
    for (const s of stale) {
      console.log(`  ${s.doc}`);
      console.log(`    last touched: ${s.docTouched ?? "never committed"}`);
      console.log(`    describes:    ${s.subjects.join(", ")}`);
      console.log(`    moved (${s.changedCount}): ${s.changed.join(", ")}${s.changedCount > s.changed.length ? ", ..." : ""}`);
      console.log("");
    }
    console.log("This does NOT mean the prose is wrong. It means nobody has looked since the ground shifted.");
  }
  console.log(`\n${fresh.length} declared document(s) are current for this window.`);
  if (undeclared.length) {
    console.log(`\n${undeclared.length} document(s) declare no subject, so nothing can watch them.`);
    console.log("Add one line near the top to opt in, naming the paths the document makes claims about:");
    console.log("  <!-- describes: server/index.ts shared/modules.ts -->");
    for (const d of undeclared.slice(0, 15)) console.log(`  ${d}`);
    if (undeclared.length > 15) console.log(`  ... and ${undeclared.length - 15} more`);
  }
}

process.exit(strict && stale.length ? 1 : 0);
