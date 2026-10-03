#!/usr/bin/env node
/**
 * The documentation points at real files.
 *
 * A routing document's whole job is to tell a reader which files to open and
 * which commands to run, and it deliberately links instead of restating so it
 * cannot drift from the code. That design has exactly one failure mode, and it
 * is this one: a file gets renamed or moved, every link to it rots silently,
 * and the first person to find out is the newcomer the document exists to
 * help. A routing document with a dead route is worse than no document,
 * because it spends somebody's first hour before it fails.
 *
 * So every relative path these documents name is resolved on disk, and a
 * missing one fails the build.
 *
 * COVERAGE IS A GLOB, AND THAT IS THE POINT. This guard used to hold a
 * hand-written list of six documents. A list you have to remember to append to
 * is a list nobody appends to: coverage sat at six while the tree grew past a
 * hundred markdown files, and the one document added in months arrived
 * carrying three dead references of its own. So the default is now inverted.
 * Every `.md` under `docs/` and at the repository root is checked, a new
 * document is covered the day it is committed, and leaving one out costs an
 * explicit line in SKIPPED with a reason somebody can argue with.
 *
 * WHAT COUNTS AS A PATH. Conservative on purpose. These documents are full of
 * backticked things that look path-shaped and are not: `yourmodule.*`,
 * `module_settings.config`, `off|preview|members|public`, `vendor.secretKeys`.
 * A token is only checked when it either contains a slash or ends in an
 * extension this repository actually uses, and it is skipped outright when it
 * carries a glob or a placeholder (`server/lib/*`, `docs/modules/<id>.md`),
 * because those name a shape and never a file. The bias is toward missing a
 * real link over inventing a false failure, since a gate that cries wolf gets
 * switched off.
 *
 * Three resolutions are tried: repo-root-relative (how these documents mostly
 * write paths), document-relative (how a markdown link usually works), and
 * bare basename anywhere in the tree (how prose names a component it expects
 * the reader to recognise: `Admin.tsx`, not the full
 * `client/src/pages/Admin.tsx`). Any one of the three is enough. The basename
 * fallback is deliberately weak: it still catches the rot that matters, a file
 * that no longer exists under that name anywhere, while sparing the guard from
 * failing on a shorthand every reader understands.
 *
 * Usage:
 *   node scripts/check-doc-links.mjs
 *   node scripts/check-doc-links.mjs --list     print every reference it checked
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
);

/**
 * Documents left out of the glob, each with the reason.
 *
 * A trailing slash makes an entry a directory prefix. Everything else is an
 * exact repo-relative path. Keep this list short and keep the reasons honest:
 * every entry here is documentation nobody is guarding.
 *
 * The through line is that a skipped document records what was true on a date,
 * or plans what will be true later, and in both cases its paths are not claims
 * about the tree as it stands. Correcting them would falsify the record.
 */
const SKIPPED = [
  // Round-by-round QA records for the grounds prototype. They name throwaway
  // probe scripts, a container-absolute path (`file:///root/qa/...`), and a
  // working directory that included the repository name. Rewriting them to
  // resolve would misreport what those rounds actually ran.
  "docs/prototypes/",

  // Build plans, not maps of the tree. Each opens "# Module design:", carries an
  // "Estimated sessions:" line, and writes its Surfaces section in the future
  // tense: badges.md asks a builder to create `BadgeShelf.tsx`, which is
  // correctly absent because nobody has built it yet. A spec naming the file
  // it wants written is the false failure this guard is supposed to avoid.
  // Each becomes checkable the day its module ships, by deleting a line here.
  "docs/modules/badges.md",
  "docs/modules/crowdpool-dashboard.md",
  "docs/modules/gratitude-feed.md",
  "docs/modules/health-dashboard.md",
  "docs/modules/internal-exchange.md",
  "docs/modules/material-library.md",
  "docs/modules/module-framework.md",
  "docs/modules/stays.md",
  "docs/modules/token-registry-ledger.md",
  "docs/modules/tools-hub.md",
  "docs/modules/village-map.md",

  // The superseded upgrade plan, the dated work orders and the fleet ledger
  // that used to be skipped here left this tree on 2026-10-02 for the
  // maintainers' private operations repository, so there is nothing to skip.

  // Documents that specify what will be built. Each says so in its own
  // opening lines: I18N_STRATEGY.md is "specification only. Nothing in this
  // document is wired up yet", MAIA_BRAIN_SPEC.md is "specification, not yet
  // built", GOVERNANCE_EVOLUTION_PROMPT.md is "the brief for the session that
  // builds it", LIVING_MAP_PLAN.md is "the 2026-08-08 design record" whose
  // build "took a different road from section 5 onward", and
  // DESIGN_TOKENS_SPEC.md proposes migration numbers that later migrations
  // have since taken. A file a spec asks somebody to create is correctly
  // absent until somebody creates it.
  "docs/DESIGN_TOKENS_SPEC.md",
  "docs/GOVERNANCE_EVOLUTION_PROMPT.md",
  "docs/I18N_STRATEGY.md",
  "docs/LIVING_MAP_PLAN.md",
  "docs/MAIA_BRAIN_SPEC.md",

  // Study notes on the OTHER repository. This one records "what was read in
  // regen-civics-clean", so `.ai/docs/STEERING.md` and
  // `server/lib/hypha-bridge/` are correct references to a tree that is not
  // this one, and resolving them here would always fail.
  "docs/FOUNDATION_STUDY_NOTES.md",
];

/** Extensions that make a slash-free token worth resolving (`CLAUDE.md`). */
const EXTENSIONS = /\.(md|ts|tsx|js|jsx|mjs|json|yml|yaml|sql|css|html)$/i;

/** A shape rather than a file: globs and angle-bracket placeholders. */
const IS_SHAPE = /[*<>{}|$]/;

/**
 * Somebody else's problem. Protocol links and bare anchors, plus any token
 * starting at `/`, which in these documents is always an HTTP route the server
 * answers (`/api/public/org.json`, `/.well-known/village.json`) and never a
 * file on disk. `check-route-reachability.mjs` owns whether those resolve.
 */
const IS_EXTERNAL = /^(https?:|mailto:|file:|tel:|#|\/)/i;

/** Tokenizer crumbs. A lone extension is what `*.tsx` leaves once the glob goes. */
const IS_BARE_EXTENSION = /^\.[A-Za-z]+$/;

/**
 * Build outputs, skipped because their existence says nothing about the
 * document. `dist/index.js` and `dist/public` are named in the guide as
 * artifacts the gates produce, and on a clean checkout they are absent until
 * `pnpm build` runs. This guard sits BEFORE the build in CI so it fails in
 * seconds, so resolving them would turn a correct document into a red gate on
 * every fresh runner. The rot this guard exists to catch lives in source paths,
 * which are present the moment the repository is cloned.
 */
const IS_GENERATED = /^(dist|node_modules|coverage|build)\//;

/** Directories holding no documentation, skipped so the walk stays quick. */
const NOT_WALKED = new Set([".git", "node_modules", "dist", "coverage", "build"]);

/**
 * The repository's own top-level entries, read from disk.
 *
 * A slash does not make something a path: `Rieki777/village-os` is a GitHub
 * repository slug and `provider/model` is a name. So a slashed token is only
 * resolved when its FIRST SEGMENT is really a top-level entry here, or when it
 * carries a file extension. Reading the roots from disk instead of listing them
 * means a new top-level directory is covered the day it appears, with no edit
 * to this file, which is the same rot this guard exists to prevent.
 */
const ROOT_ENTRIES = new Set(fs.readdirSync(ROOT));

/** Every filename in the tree, for the bare-basename fallback. */
const BASENAMES = new Set();
(function indexTree(rel) {
  for (const entry of fs.readdirSync(rel ? path.join(ROOT, rel) : ROOT, { withFileTypes: true })) {
    if (NOT_WALKED.has(entry.name)) continue;
    if (entry.isDirectory()) indexTree(rel ? `${rel}/${entry.name}` : entry.name);
    else BASENAMES.add(entry.name);
  }
})("");

const listOnly = process.argv.includes("--list");

/** Repo-relative paths of every document this guard is responsible for. */
function documents() {
  const found = [];

  (function walk(rel) {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      if (NOT_WALKED.has(entry.name)) continue;
      const next = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".md")) found.push(next);
    }
  })("docs");

  for (const name of fs.readdirSync(ROOT)) {
    if (name.endsWith(".md")) found.push(name);
  }

  const isSkipped = (doc) =>
    SKIPPED.some((entry) => (entry.endsWith("/") ? doc.startsWith(entry) : doc === entry));

  return found.filter((doc) => !isSkipped(doc)).sort();
}

/**
 * Every candidate path in a document, with the line it sits on.
 *
 * Two sources: markdown link targets, and inline code spans. Fenced code blocks
 * are skipped, because a fence holds example source and a path inside one is
 * illustrative (`docs/modules/<id>.md` in a template, a registry snippet naming
 * a URL) rather than a route the reader is asked to follow.
 */
function references(body) {
  const out = [];
  let fenced = false;

  body.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;

    const add = (raw) => {
      if (!raw) return;
      // Drop anchors and trailing punctuation a sentence leaves behind.
      const token = raw.split("#")[0].replace(/[.,;:)]+$/, "").trim();
      if (!token || IS_EXTERNAL.test(token) || IS_SHAPE.test(token)) return;
      if (IS_BARE_EXTENSION.test(token) || IS_GENERATED.test(token) || /\s/.test(token)) return;
      const rooted = token.includes("/") && ROOT_ENTRIES.has(token.split("/")[0]);
      if (!rooted && !EXTENSIONS.test(token)) return;
      out.push({ token, line: i + 1 });
    };

    for (const m of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) add(m[1]);
    for (const m of line.matchAll(/`([^`]+)`/g)) add(m[1]);
  });

  return out;
}

/** Repo-root, then relative to the document that named it, then bare basename. */
function exists(token, docRelPath) {
  if (fs.existsSync(path.join(ROOT, ...token.split("/")))) return true;
  const docDir = path.dirname(path.join(ROOT, ...docRelPath.split("/")));
  if (fs.existsSync(path.resolve(docDir, ...token.split("/")))) return true;
  return !token.includes("/") && BASENAMES.has(token);
}

/**
 * A citation carries its address with it: `server/index.ts:216`,
 * `drizzle/0009_ledger_accounts_and_transfers.sql:62`, `shared/modules.ts:moduleListingProblems`. The
 * file is the claim and the suffix is a pointer into it, so the suffix is
 * dropped and the file resolved on its own. Checking the whole string instead
 * reported every cited line in the repository as a dead path, which is how a
 * document naming a file that has existed since the first commit came back red.
 */
function resolves(token, docRelPath) {
  if (exists(token, docRelPath)) return true;
  const colon = token.indexOf(":");
  return colon > 0 && exists(token.slice(0, colon), docRelPath);
}

const DOCS = documents();
let checked = 0;
let broken = 0;

for (const doc of DOCS) {
  const body = fs.readFileSync(path.join(ROOT, ...doc.split("/")), "utf8");
  const seen = new Set();

  for (const { token, line } of references(body)) {
    if (seen.has(token)) continue;
    seen.add(token);
    checked++;
    if (!resolves(token, doc)) {
      broken++;
      console.log(`  ${doc}:${line}  ${token}  <-- NO SUCH PATH`);
    } else if (listOnly) {
      console.log(`  ${doc}:${line}  ${token}  OK`);
    }
  }
}

if (broken) {
  console.log(
    `\nDoc link guard FAILED. ${broken} dead reference(s) across ${DOCS.length} document(s).`,
  );
  console.log("Fix the link, or if the file genuinely moved, fix every document that named it.");
  console.log(
    "If the document is a record of a past state, add it to SKIPPED in this script with a reason.",
  );
  process.exit(1);
}

console.log(
  `Doc link guard passed. ${checked} reference(s) across ${DOCS.length} document(s) all resolve.`,
);
