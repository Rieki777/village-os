#!/usr/bin/env node
// The daily release train. Rye, 2026-11-06: Village OS cuts a release every
// day, and never from a red main.
//
// .github/workflows/daily-release.yml gathers the facts (the last tag, how many
// commits main has on top of it, ci's verdict on main's tip, any release pull
// request already open) and hands them to this file, which decides. Then, on a
// release day, this file writes the release commit: the version moved in every
// place release.yml compares, and the changelog entry rolled out of Unreleased.
//
// The decisions live here, and not in workflow shell, because a scheduled job
// that decides wrongly does it at 05:17 with nobody watching. Here they are
// held by server/releaseTrain.test.ts and fail in a pull request instead.
//
// THIS FILE NEVER TAGS AND NEVER PUBLISHES. It writes a commit for a pull
// request. The tag is cut by .github/workflows/release-train-land.yml only
// after ci has passed on main with that commit in it, and release.yml then
// asks ci again before it builds anything. A red main cannot ship by any path
// through here.
//
// Usage (from the repository root):
//   node scripts/release-train.mjs plan  --facts facts.json
//        prints the decision as JSON: {"release":bool,"reason":"...","version":"x.y.z","bump":"minor"}
//   node scripts/release-train.mjs apply --version x.y.z --date YYYY-MM-DD --prs prs.json --migrations migrations.txt
//        rewrites RELEASE_FILES in place
//   node scripts/release-train.mjs prs   < git-log-output
//        prints the merged pull requests found in `git log --format='%s%x1f%b%x1e'`
//   node scripts/release-train.mjs notes --prs prs.json --migrations migrations.txt
//        prints a pull request body

import fs from "node:fs";

/** Every file a release pull request may change. The land workflow refuses to
 *  merge a release/* pull request that touches anything else, so a branch
 *  name cannot carry code past review. */
export const RELEASE_FILES = [
  "CHANGELOG.md",
  "START_HERE.md",
  "docker-compose.yml",
  "package.json",
  "server/lib/identity.ts",
];

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function nextVersion(current, bump) {
  const m = SEMVER.exec(String(current));
  if (!m) throw new Error(`not a release version: ${current}`);
  let [maj, min, pat] = m.slice(1).map(Number);
  if (bump === "major") return `${maj + 1}.0.0`;
  if (bump === "minor") return `${maj}.${min + 1}.0`;
  if (bump === "patch") return `${maj}.${min}.${pat + 1}`;
  throw new Error(`unknown bump: ${bump}`);
}

const FIX_TITLE = /^fix(\([^)]*\))?!?:/i;

/** major if any pull request is labelled release:major; patch only if EVERY
 *  one is a fix (labelled release:patch, or titled `fix:`); otherwise minor.
 *  Minor is the default because docs/RELEASING.md defines it as "anything
 *  added", which is what most days are. */
export function bumpFor(prs) {
  const list = prs ?? [];
  const labels = (p) => (p.labels ?? []).map((l) => String(l).toLowerCase());
  if (list.some((p) => labels(p).includes("release:major"))) return "major";
  if (list.length > 0 && list.every((p) => labels(p).includes("release:patch") || FIX_TITLE.test(p.title ?? ""))) {
    return "patch";
  }
  return "minor";
}

/** Decide one day. Every "no" carries the reason the workflow prints. */
export function planDay(facts) {
  const { lastTag, packageVersion, commitsSinceTag, ciConclusion, openReleasePr, prs } = facts ?? {};
  const m = SEMVER.exec(String(lastTag ?? ""));
  if (!m) {
    return { release: false, reason: `No readable release tag on main (got '${lastTag ?? ""}'). Cut the first one by hand (docs/RELEASING.md).` };
  }
  const tagged = `${m[1]}.${m[2]}.${m[3]}`;
  if (openReleasePr) {
    return { release: false, reason: `Release pull request #${openReleasePr} is still open. One release at a time.` };
  }
  if (packageVersion && packageVersion !== tagged) {
    return {
      release: false,
      reason: `main already carries version ${packageVersion} and the last tag is ${lastTag}. That release is in flight (waiting for its tag), so today is skipped.`,
    };
  }
  if (!Number(commitsSinceTag)) {
    return { release: false, reason: `Nothing new on main since ${lastTag}.` };
  }
  if (ciConclusion !== "success") {
    return {
      release: false,
      reason: `ci on main's tip is '${ciConclusion || "not run"}', not success. A red or unfinished main is never released.`,
    };
  }
  const bump = bumpFor(prs);
  return { release: true, reason: `${commitsSinceTag} commit(s) since ${lastTag}, ci green.`, version: nextVersion(tagged, bump), bump };
}

/** Pull requests merged into main, from GitHub's merge commits. Input is
 *  `git log --first-parent --format='%s%x1f%b%x1e'`. */
export function prsFromLog(log) {
  const out = [];
  for (const rec of String(log).split("\x1e")) {
    const [subject = "", body = ""] = rec.replace(/^\s+/, "").split("\x1f");
    const m = /^Merge pull request #(\d+) from \S+?\/(\S+)/.exec(subject.trim());
    if (!m) continue;
    const title = body.trim().split("\n")[0].trim() || m[2];
    out.push({ number: Number(m[1]), title });
  }
  return out;
}

function dataLines(migrations) {
  const files = (migrations ?? []).map((p) => String(p).trim()).filter(Boolean).map((p) => p.split("/").pop());
  if (files.length === 0) {
    return ["No database migrations. Starting this release does not change your database."];
  }
  return [
    `This release adds ${files.length} database migration(s). Each runs by itself when the new image starts, before the village answers anyone. Before the image is published, release.yml checks that the previous release can still run over the schema they produce (docs/RELEASING.md):`,
    "",
    ...files.map((f) => `- \`${f}\``),
  ];
}

function prLines(prs) {
  if (!prs || prs.length === 0) return ["None named. These changes reached main without a pull request."];
  return prs.map((p) => `- #${p.number} ${p.title}`);
}

/** Move the written Unreleased entries into a dated section for `version`,
 *  keep Unreleased's standing introduction, and add the two headings a
 *  machine can answer honestly: the migrations, and the pull requests. */
export function rollChangelog(text, { version, date, prs, migrations }) {
  const src = String(text).replace(/\r\n/g, "\n");
  if (new RegExp(`^## ${version.replace(/\./g, "\\.")}( |$)`, "m").test(src)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  }
  const start = src.search(/^## Unreleased[ \t]*$/m);
  if (start < 0) throw new Error("CHANGELOG.md has no '## Unreleased' section");
  const afterHeading = src.indexOf("\n", start) + 1;
  const nextRel = src.slice(afterHeading).search(/^## /m);
  const end = nextRel < 0 ? src.length : afterHeading + nextRel;
  let body = src.slice(afterHeading, end).replace(/\n-{3,}\s*$/, "\n").trim();

  // Unreleased opens with a standing paragraph ("Work on `main` that has not
  // been published..."). It stays where it is; only the entries move.
  let intro = "";
  if (/^Work on `main`/.test(body)) {
    const cut = body.indexOf("\n\n");
    intro = cut < 0 ? body : body.slice(0, cut);
    body = cut < 0 ? "" : body.slice(cut + 2).trim();
  }

  const entries = body || "Nothing was written up by hand for this release. The merged pull requests below are the record.";
  const section = [
    `## ${version} (${date})`,
    "",
    "### What changed for your village",
    "",
    entries,
    "",
    "### Does it touch your data",
    "",
    ...dataLines(migrations),
    "",
    "### Merged pull requests",
    "",
    ...prLines(prs),
    "",
    "---",
    "",
  ].join("\n");

  const unreleased = ["## Unreleased", "", ...(intro ? [intro, ""] : []), "---", "", ""].join("\n");
  return src.slice(0, start) + unreleased + section + "\n" + src.slice(end);
}

const VERSION_SITES = {
  "package.json": [/("version":\s*")\d+\.\d+\.\d+(")/],
  "server/lib/identity.ts": [/(PLATFORM_VERSION = ")\d+\.\d+\.\d+(")/],
  // Owner-agnostic on purpose: #431 moves the image from ghcr.io/rieki777 to
  // the ReGen-Civics organisation, and this must not need a second edit then.
  "docker-compose.yml": [/(ghcr\.io\/[a-z0-9_.-]+\/village-os:)\d+\.\d+\.\d+(\})/],
  "START_HERE.md": [/(--branch v)\d+\.\d+\.\d+( )/, /(ghcr\.io\/[a-z0-9_.-]+\/village-os:)\d+\.\d+\.\d+(`)/],
};

/** Returns new contents for the version sites. Throws, naming the file, when
 *  a site is missing: a release whose tag release.yml would refuse must fail
 *  here, before any pull request exists. */
export function bumpVersionFiles(files, version) {
  const out = {};
  for (const [name, patterns] of Object.entries(VERSION_SITES)) {
    let text = files[name];
    if (typeof text !== "string") throw new Error(`${name}: not provided`);
    for (const re of patterns) {
      if (!re.test(text)) throw new Error(`${name}: no version matching ${re} to move`);
      text = text.replace(re, `$1${version}$2`);
    }
    out[name] = text;
  }
  return out;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

function readJson(p, fallback) {
  return p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;
}

function readLines(p) {
  return p && fs.existsSync(p) ? fs.readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean) : [];
}

function main() {
  const cmd = process.argv[2];
  if (cmd === "plan") {
    process.stdout.write(JSON.stringify(planDay(readJson(arg("facts"), {}))) + "\n");
  } else if (cmd === "prs") {
    process.stdout.write(JSON.stringify(prsFromLog(fs.readFileSync(0, "utf8"))) + "\n");
  } else if (cmd === "apply") {
    const version = arg("version");
    if (!version || !SEMVER.test(version)) throw new Error("--version x.y.z is required");
    const prs = readJson(arg("prs"), []);
    const migrations = readLines(arg("migrations"));
    const date = arg("date") ?? new Date().toISOString().slice(0, 10);
    const current = Object.fromEntries(Object.keys(VERSION_SITES).map((f) => [f, fs.readFileSync(f, "utf8")]));
    const bumped = bumpVersionFiles(current, version);
    const changelog = rollChangelog(fs.readFileSync("CHANGELOG.md", "utf8"), { version, date, prs, migrations });
    for (const [f, t] of Object.entries(bumped)) fs.writeFileSync(f, t);
    fs.writeFileSync("CHANGELOG.md", changelog);
    process.stdout.write(`moved ${Object.keys(bumped).join(", ")} and CHANGELOG.md to ${version}\n`);
  } else if (cmd === "notes") {
    const prs = readJson(arg("prs"), []);
    const lines = [
      "Opened by the daily release train (.github/workflows/daily-release.yml).",
      "",
      "It moves the version and rolls CHANGELOG.md, nothing else. When ci passes on this pull request it is merged; when ci then passes on main, the tag is cut and release.yml builds, boots and publishes the image.",
      "",
      "### Does it touch your data",
      "",
      ...dataLines(readLines(arg("migrations"))),
      "",
      "### Merged pull requests",
      "",
      ...prLines(prs),
    ];
    process.stdout.write(lines.join("\n") + "\n");
  } else {
    process.stderr.write("usage: release-train.mjs plan|apply|prs|notes (see the header)\n");
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`release-train: ${e.message}\n`);
    process.exit(1);
  }
}
