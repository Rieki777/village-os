/**
 * GENERATED DOCS: WHO OWNS THEM, AND WHAT A CHECK MAY ASK OF A PULL REQUEST.
 *
 * (Rye, 2026-11-09: "figure out a way to improve the work flow of that
 * governance document ... put in a permanent solution".)
 *
 * THE PROBLEM THIS ENDS. Eight files are written by generators out of the code.
 * Every pull request that added a route or a capability had to commit them
 * regenerated, so every landing on main made every open pull request conflict
 * on them, GitHub ran no CI on a conflicted pull request, and about twelve
 * lanes re-merged main and re-pushed all night, six runners each time.
 *
 * THE RULE. MAIN OWNS THE GENERATED FILES. `.github/workflows/generated-docs.yml`
 * runs every generator on each push to main and commits what changed as one
 * bot commit. A pull request never commits them.
 *
 * TWO MODES, chosen by the environment and by nothing else:
 *
 *   pr      (the default: a lane's machine, every pull_request run, the
 *           push runs of `ci.yml`). The generator must still RUN and the
 *           rules inside it must still hold, so a route it cannot classify or
 *           a sentence that breaks the house voice still fails. What it no
 *           longer asks is that the COMMITTED file equal the output. The
 *           would-be diff goes to the job summary, so a reviewer still SEES
 *           every governance and economics change a pull request makes.
 *   strict  (`GENERATED_DOCS_MODE=strict`, set only by generated-docs.yml,
 *           after its own commit). The committed file must equal the output,
 *           byte for byte. A bot that failed to commit, or a generator that is
 *           not idempotent, is red here and nowhere else.
 *
 * WHY "STRICT ON MAIN" LIVES IN THAT WORKFLOW AND NOT IN ci.yml. The merge
 * commit of a pull request is, by design, one bot commit older than its docs.
 * A strict check in ci.yml's push run would be red on every single merge. The
 * workflow checks strictly AFTER it has written, which is the only moment
 * "main's docs equal the code" is a claim anybody can make.
 *
 * The default is pr because a check that is strict by default would send every
 * lane back to regenerating, which is the failure. `ci.yml` and the tests that
 * pin this say so out loud, and `scripts/check-generated-docs-untouched.test.mjs`
 * proves both modes can fail.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Everything main owns. `whole`: any change by a pull request is refused. `regions`: only the marked regions are. */
export const GENERATED_FILES = [
  { path: "docs/GOVERNANCE.md", kind: "whole", generator: "scripts/generate-governance-doc.mjs", seen: true },
  { path: "docs/knowledge/governance-lineage.md", kind: "whole", generator: "scripts/generate-governance-doc.mjs", seen: true },
  { path: "docs/ECONOMICS.md", kind: "regions", generator: "scripts/generate-economics-doc.mjs", seen: true },
  { path: "docs/TOKENS.md", kind: "whole", generator: "scripts/generate-token-doc.mjs", seen: false },
  { path: "docs/VARIABLES.md", kind: "whole", generator: "scripts/generate-variables-doc.mjs", seen: false },
  { path: "docs/MODULES.md", kind: "whole", generator: "scripts/generate-modules-doc.mjs", seen: false },
  { path: "docs/CAPABILITIES.md", kind: "whole", generator: "scripts/generate-capabilities-doc.mjs", seen: false },
  { path: "client/src/locales/en.po", kind: "whole", generator: "pnpm i18n:extract", seen: false },
];

/** Region markers of a half-generated file, as generate-economics-doc.mjs writes them. */
export const REGION_RE = /<!-- generated:([\w-]+) start -->[\s\S]*?<!-- generated:\1 end -->/g;

export function docsMode(env = process.env) {
  return env.GENERATED_DOCS_MODE === "strict" ? "strict" : "pr";
}

const MAX_SUMMARY_CHARS = 150_000;

/** A unified diff of two texts, from git, so it reads like a pull request's own. */
export function unifiedDiff(label, found, wanted) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gendocs-"));
  try {
    const a = path.join(dir, "committed");
    const b = path.join(dir, "generated");
    fs.writeFileSync(a, found.replace(/\r\n/g, "\n"));
    fs.writeFileSync(b, wanted.replace(/\r\n/g, "\n"));
    const r = spawnSync("git", ["diff", "--no-index", "--no-color", "--unified=2", "--", a, b], { encoding: "utf8" });
    const body = (r.stdout ?? "").split("\n").slice(4).join("\n");
    return body.trim() ? `--- ${label} (committed)\n+++ ${label} (generated from this tree)\n${body}` : "";
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Append markdown to the GitHub job summary when there is one; always return the text for the log. */
export function writeSummary(markdown, env = process.env) {
  const file = env.GITHUB_STEP_SUMMARY;
  if (file) {
    try {
      fs.appendFileSync(file, `${markdown}\n`);
    } catch {
      /* a summary is a courtesy; the log carries the same words */
    }
  }
}

/**
 * A generated file and its generator disagree. Returns true when that is
 * FATAL (strict mode), false when it is only reported (pr mode). The caller
 * keeps its own failure message and exit code for the fatal case.
 */
export function driftIsFatal({ label, found, wanted, seen = false, regenerate }, env = process.env) {
  if (docsMode(env) === "strict") return true;
  const diff = seen ? unifiedDiff(label, found, wanted) : "";
  const lines = [
    `${label}: the committed copy differs from what this tree's code generates.`,
    "That is expected on a pull request. MAIN regenerates this file after the merge",
    `(${regenerate}); do not commit it. The generator ran and its rules held.`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  if (seen) {
    const shown = diff.length > MAX_SUMMARY_CHARS ? `${diff.slice(0, MAX_SUMMARY_CHARS)}\n... (cut, ${diff.length} characters)` : diff;
    writeSummary(
      [
        `### ${label}: what main will publish for this change`,
        "",
        "Generated from this tree. Review it like any other change; do not commit it, main regenerates it.",
        "",
        "```diff",
        shown || "(no textual difference)",
        "```",
      ].join("\n"),
      env,
    );
  } else {
    writeSummary(`- \`${label}\` will change when main regenerates it.`, env);
  }
  return false;
}
