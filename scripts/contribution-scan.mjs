#!/usr/bin/env node
/**
 * The contribution checks: what a pull request ADDED, and nothing else.
 *
 * WHY THE ATTRIBUTION MATTERS MORE THAN THE PATTERNS. The first version of
 * these checks grepped whole changed files. Every rule fired correctly, and the
 * result was still unusable: a contributor who added 335 clean lines to
 * `server/index.ts` was handed 41 findings from the other 18,000 lines of that
 * file, none of them theirs, and their listing blocked at stage 6. Because
 * every server change touches that file, the gate refused every server pull
 * request. A guard that reports a decade of accumulated debt against whoever
 * happened to open the file next is one people route around, and it earns that.
 *
 * Why it was not caught: the fixture that proved the rules fire was always a
 * NEW file. In a new file every line is the contributor's, so whole-file
 * scanning and added-line scanning give exactly the same answer. The one case
 * that separates them, editing a file that already carries hits, was the case
 * nobody wrote.
 *
 * So: for a file with a base version, only ADDED lines can produce a finding.
 * Hits on lines the contributor did not touch are counted and reported as
 * pre-existing, because the debt should stay visible without being charged to
 * somebody who did not create it. A file with no base version is entirely the
 * contributor's, and every line of it counts.
 *
 * This lives in its own file so `scripts/contribution-scan.test.mjs` can reach
 * it. The last defect of this shape was logic buried in a workflow where
 * nothing could test it, and the fix was the same: move it where a test can
 * see it.
 */
import { execFileSync } from "node:child_process";

/** A genuine exception, on the line itself. Same shape as the house waivers. */
export const WAIVER = /module-review-ok:/;

/**
 * ── THE TYPE-ARGUMENT HOLE ──────────────────────────────────────────────────
 *
 * The raw-SQL rule used to read `(?:query|execute)\s*\(`, and a TypeScript
 * type-argument list sits exactly there. So `pool.query("...")` was caught and
 * `pool.query<RowDataPacket[]>("...")` was not, for the identical violation,
 * and which verdict a lane got depended on whether they had happened to write
 * a generic. 445 non-test call sites outside `server/repos|db|seeds` were
 * invisible to the rule on the day this was measured, 18 of them in
 * `server/lib/ledger.ts` and 19 in `server/index.ts`. A gate that grades by
 * syntax accident is worse than no gate, because it reads as a verdict.
 *
 * WHY THIS IS NOT `.*`. `query.*\(` matches `if (db.query < n) f(`, which is a
 * comparison and not a call, and a guard that cries wolf on ordinary code is
 * one people learn to ignore. So the body of the angle brackets is restricted
 * to what a type-argument list can actually contain:
 *
 *   - no `(` or `)`     a call's own parentheses end the list; this is what
 *                       stops `db.execute < a) ... f(` from spanning
 *   - no `;`            a statement boundary is never inside type arguments
 *   - no `=`            kills `<=`, `>=` and `=>` in one stroke; a type
 *                       ARGUMENT list has no defaults, unlike a declaration
 *   - no `&&` or `||`   a single `&` or `|` is an intersection or a union and
 *                       stays legal; the doubled forms are boolean operators,
 *                       and `db.query < a && b > (c)` is the one comparison
 *                       shape that could otherwise close the brackets
 *
 * What that deliberately gives up: a function type passed as a type argument
 * (`pool.query<(x: string) => void>(...)`), because it carries parentheses.
 * Nothing in this repository writes one, and admitting it would re-open the
 * comparison hole it exists to close.
 *
 * Nesting is bounded rather than recursive, because JavaScript regular
 * expressions do not recurse. Three levels of angle brackets are matched
 * (`Foo<Bar<Baz>>` as an argument), which is past anything a driver method
 * takes. Each `*` here alternates between an atom that cannot be `<` and a
 * group that must start with `<`, so no input can make two branches viable at
 * the same position: the match is linear and there is no backtracking blowup.
 */
const ATOM = String.raw`(?:(?![&|]{2})[^<>()\r\n;=])`;
const NEST1 = `(?:${ATOM}|<${ATOM}*>)*`;
const NEST2 = `(?:${ATOM}|<${NEST1}>)*`;

/**
 * An OPTIONAL type-argument list, as it appears between a method name and the
 * open paren of its call. Exported so `scripts/contribution-scan.test.mjs` can
 * assert on it directly rather than only through a rule that embeds it.
 */
export const TYPE_ARGUMENTS = String.raw`(?:\s*<${NEST2}>)?`;

/** The db handles a raw query is spelled on. Unchanged; only the tail moved. */
const SQL_RECEIVER = String.raw`\b(?:pool|conn|connection|db|c)\s*\.\s*(?:query|execute)`;

export const RAW_SQL_PATTERN = new RegExp(
  `${SQL_RECEIVER}${TYPE_ARGUMENTS}\\s*\\(` +
    `|createPool${TYPE_ARGUMENTS}\\s*\\(` +
    `|createConnection${TYPE_ARGUMENTS}\\s*\\(`,
);

/** The id the burn-down ratchet and the intake classifier both key on. */
export const RAW_SQL_RULE_ID = "raw SQL outside server/repos";

/**
 * The code-pattern rules. Each is scoped to where it is a real rule: a raw
 * `fetch` is a finding on the server and ordinary in the client, and raw SQL
 * is the entire job of `server/repos` and a finding anywhere else.
 */
export const CODE_RULES = [
  {
    id: "raw fetch outside guardedFetchJson",
    scope: (f) => /^(server|shared)\//.test(f) && !/^server\/lib\/toolcheck\.ts$/.test(f),
    pattern: /(?<![A-Za-z0-9_.])fetch\s*\(/,
    exempt: (line) => /guardedFetchJson/.test(line),
    why: "outbound calls carry a correlation id and land in the call record only when they go through the helper",
  },
  {
    id: RAW_SQL_RULE_ID,
    scope: (f) => /^(server|shared|client)\//.test(f) && !/^server\/(repos|db|seeds)\//.test(f),
    pattern: RAW_SQL_PATTERN,
    exempt: () => false,
    why: "queries live in a repo so the caches above them stay correct and a table's readers stay enumerable",
  },
  {
    id: "eval or a non-literal dynamic import",
    scope: (f) => /^(server|shared|client)\//.test(f),
    pattern: /\beval\s*\(|new\s+Function\s*\(|\bimport\s*\(\s*(?!["'`])/,
    exempt: () => false,
    why: "remote or computed code defeats every review this process performs",
  },
  {
    id: "a write to a protected table",
    scope: (f) => /^(server|shared)\//.test(f),
    pattern:
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?(?:token_ledger|token_balances|module_settings|module_events|badge_awards|user_capabilities)`?/i,
    exempt: () => false,
    why: "the ledger, the capability gate and module lifecycle are the platform's own; a module never writes them directly",
  },
  {
    id: "a credential written into code",
    scope: (f) => /^(server|shared|client|scripts)\//.test(f),
    pattern:
      /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'`](?!\s*$)[A-Za-z0-9_\-]{20,}["'`]|\bsk-[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b/i,
    exempt: () => false,
    why: "credentials belong in the secrets store, where they are write-only and rotatable",
  },
];

/**
 * The NEW-side line numbers a unified diff adds.
 *
 * Pure, because the hunk arithmetic is where this gets silently wrong and a
 * function taking git output as a string can be tested with a string. Expects
 * `git diff -U0`, so there is no context to skip; `+++` is excluded because a
 * file header is not an added line.
 */
export function parseAddedLineNumbers(diffText) {
  const added = new Set();
  let next = 0;
  for (const line of String(diffText).split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+++")) continue;
    if (line.startsWith("+")) {
      added.add(next);
      next += 1;
    }
  }
  return added;
}

/**
 * Which lines of `relPath` this change added, or `null` when the file has no
 * base version and is therefore entirely the contributor's.
 *
 * `git` is invoked with an argument array and no shell, which matters on
 * Windows: a `ref:path` argument passed through a shell gets its colon
 * rewritten, and the command then fails in a way that reads like "the file is
 * not there" instead of "the argument was mangled".
 */
export function addedLineNumbers(base, relPath, cwd) {
  const git = (args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    git(["cat-file", "-e", `${base}:${relPath}`]);
  } catch {
    return null; // No base version: a new file, all of it theirs.
  }
  try {
    return parseAddedLineNumbers(git(["diff", "-U0", base, "--", relPath]));
  } catch {
    // Unreadable diff for a file that does have a base. Attribute nothing
    // rather than attribute everything: a guard that cannot tell whose line it
    // is must not guess "yours".
    return new Set();
  }
}

/**
 * Partition a file's rule hits into the contributor's and everybody else's.
 *
 * `addedSet` of `null` means the whole file is new. Comments are stripped
 * before matching so a rule cannot fire on prose about the rule.
 */
export function scanFileLines({ relPath, body, addedSet, rules = CODE_RULES }) {
  const findings = [];
  let preExisting = 0;
  let waived = 0;

  const lines = String(body).split(/\r?\n/);
  for (const rule of rules) {
    if (!rule.scope(relPath)) continue;
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      if (!rule.pattern.test(code)) return;
      if (rule.exempt(line)) return;

      const lineNo = i + 1;
      const isTheirs = addedSet === null || addedSet.has(lineNo);
      if (!isTheirs) {
        preExisting += 1;
        return;
      }
      if (WAIVER.test(line)) {
        waived += 1;
        return;
      }
      findings.push({ ruleId: rule.id, line: lineNo, text: line.trim().slice(0, 100), relPath });
    });
  }

  return { findings, preExisting, waived };
}
