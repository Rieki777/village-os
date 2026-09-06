/**
 * What provisioning costs, printed at the end of every run that pays it.
 *
 * The cost was invisible and it grew silently. `vitest.config.ts` documents
 * provisioning as "GROWS WITH EVERY MIGRATION ANYONE ADDS" and it was right:
 * 87 migration files, 44 provisions per full run, about 12s each on a local
 * MySQL and about 7.5s on a CI runner, which is roughly five minutes of every
 * CI run spent replaying the same migrations forty-four times. Nothing printed
 * that number, so the only symptom was a job that crept toward the
 * fifteen-minute cap and one that was cancelled at it.
 *
 * `server/db/testDb.ts` now builds the schema ONCE per (migration set,
 * collation) and hands each suite a clone. This module is the receipt. Each
 * provision appends one line here; vitest's globalSetup prints the totals when
 * the run ends, including the per-migration cost, so the next person who adds
 * ten migrations reads the price in their own terminal.
 *
 * The log lives under `node_modules/.cache/` deliberately: it is already
 * gitignored, and it is per-worktree, so two lanes running at once do not
 * write into each other's numbers.
 *
 * ONE LOG PER RUN, NOT ONE PER WORKTREE (2026-09-02). It used to be a single
 * fixed filename, on the reasoning that every worker could then find it "with
 * no environment variable to propagate". Two runs in the SAME worktree break
 * that, and it is not hypothetical: while measuring the guard below, a leaked
 * vitest process from an earlier command was still provisioning schemas in
 * this worktree, its eight clone records landed in the ledger of a run that
 * had provisioned nothing, and the guard read them as proof that the run had
 * touched a database. The check was silenced by the exact class of accident
 * it exists to catch.
 *
 * So the filename now carries a per-run id, set in `setup()` and inherited by
 * every worker (verified: a value assigned to `process.env` in globalSetup is
 * visible in the workers, because the pool is spawned after it runs). A
 * sibling run writes its own file and cannot be counted here, and it cannot
 * lose its rows to this run's truncation either. Files older than the sweep
 * window are cleaned up on the next run, so a killed run leaves no litter.
 */
/*
 * WHY THIS FILE LOADS dotenv ITSELF.
 *
 * `vitest.config.ts` loads `.env` through `setupFiles`, and setupFiles run in
 * the WORKER processes. globalSetup and globalTeardown run in the MAIN
 * process, which never sees them. So this module read `process.env` and found
 * nothing, and the first version of the guard below announced that
 * TEST_DATABASE_URL was unset on a machine whose .env sets it.
 *
 * That is the same trapdoor as any standalone script here: dotenv is loaded by
 * vitest's setupFiles and by nothing else, so anything running outside a worker
 * inherits the silent-skip state it is trying to detect.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { assertFreshDist } from "./distFreshness";
import { warnOnDependencyDrift } from "./installedDeps";

const CACHE_DIR = path.resolve(process.cwd(), "node_modules", ".cache");
const LOG_PREFIX = "village-provisioning";

/**
 * This run's ledger. The id comes from the environment, which `setup()` fills
 * in before any worker starts.
 *
 * The fallback matters: anything that imports this module OUTSIDE a vitest run
 * (a script, a stray import) gets a file of its own rather than appending to
 * whatever run happens to be in flight.
 */
export function provisionLogPath(): string {
  const run = process.env.VILLAGE_TEST_RUN_ID || `orphan-${process.pid}`;
  return path.join(CACHE_DIR, `${LOG_PREFIX}.${run}.jsonl`);
}

/** Longer than any suite run, short enough that a killed run's file is gone by tomorrow. */
const STALE_LOG_MS = 6 * 60 * 60 * 1000;

/** A killed run never reaches teardown, so its ledger is swept by the next one. */
function sweepStaleLogs(): void {
  try {
    for (const name of fs.readdirSync(CACHE_DIR)) {
      if (!name.startsWith(`${LOG_PREFIX}.`) || !name.endsWith(".jsonl")) continue;
      const full = path.join(CACHE_DIR, name);
      if (full === provisionLogPath()) continue;
      if (Date.now() - fs.statSync(full).mtimeMs > STALE_LOG_MS) fs.rmSync(full, { force: true });
    }
  } catch {
    /* hygiene, never a gate */
  }
}

export type ProvisionKind =
  /** The one full migration run that builds a template. */
  | "template"
  /** A scratch schema copied from a template. */
  | "clone"
  /** A scratch schema that ran every migration itself (no template available). */
  | "full";

export interface ProvisionRecord {
  kind: ProvisionKind;
  ms: number;
  migrations: number;
}

/** Bookkeeping only. A failure here never fails a suite. */
export function noteProvision(rec: ProvisionRecord): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.appendFileSync(provisionLogPath(), `${JSON.stringify(rec)}\n`);
  } catch {
    /* a run with no writable cache directory still runs its tests */
  }
}

export function readProvisionLog(): ProvisionRecord[] {
  try {
    return fs
      .readFileSync(provisionLogPath(), "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as ProvisionRecord)
      .filter((r) => r && typeof r.ms === "number" && typeof r.kind === "string");
  } catch {
    return [];
  }
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * The lines vitest prints at the end of a run. Exported separately from
 * `teardown` so `scripts/measure-provisioning.mjs` and the harness test can
 * check the arithmetic without spawning a suite.
 */
export function summarise(rows: ProvisionRecord[]): string[] {
  if (rows.length === 0) return [];
  const templates = rows.filter((r) => r.kind === "template");
  const clones = rows.filter((r) => r.kind === "clone");
  const fulls = rows.filter((r) => r.kind === "full");
  const sum = (rs: ProvisionRecord[]) => rs.reduce((a, r) => a + r.ms, 0);
  const migrations = Math.max(...rows.map((r) => r.migrations || 0), 0);
  const total = sum(rows);
  // What the same run cost before templates existed: every provision paid a
  // full migration run, and a full run is what a template build still is.
  const perFullRun =
    templates.length > 0
      ? sum(templates) / templates.length
      : fulls.length > 0
        ? sum(fulls) / fulls.length
        : 0;
  /** Scratch schemas handed to suites. Template builds are overhead, never a schema a suite uses. */
  const provisions = clones.length + fulls.length;
  const oldWay = perFullRun * Math.max(provisions, 1);
  const perMigration = migrations > 0 && perFullRun > 0 ? Math.round(perFullRun / migrations) : 0;

  const out = [
    "",
    "provisioning, this run",
    `  migration files        ${migrations}`,
    `  template builds        ${templates.length}, ${seconds(sum(templates))}`,
    `  scratch clones         ${clones.length}, ${seconds(sum(clones))}`,
    `  full migration runs    ${fulls.length}, ${seconds(sum(fulls))}`,
    `  total                  ${seconds(total)}`,
  ];
  if (perFullRun > 0) {
    out.push(
      `  one full run costs     ${seconds(perFullRun)} (${perMigration}ms per migration file)`,
      `  without templates      ${provisions} x ${seconds(perFullRun)} = ${seconds(oldWay)}`,
      `  so one new migration   adds about ${perMigration}ms per run, once, in place of ${provisions} times`,
    );
  } else {
    // Zero template builds means the template was already on the server from an
    // earlier run, so this run has no full-run timing of its own to compare
    // against. Say that, because a summary that just stops looks like a bug.
    out.push(
      "  template               reused from an earlier run, so nothing here timed a full migration run",
      "  for the comparison     pnpm measure:provisioning (it drops the template first, then times both)",
    );
  }
  if (fulls.length > 0) {
    out.push(
      "  NOTE: a full migration run per suite means the template was unavailable. Read the",
      "  [testDb] warning above it: that is the five minutes this mechanism exists to save.",
    );
  }
  return out;
}

/**
 * vitest globalSetup: start each run with an empty ledger, and refuse a run
 * whose built bundle is not the code in the tree.
 *
 * The freshness check is here rather than in 42 beforeAll hooks because here
 * it runs ONCE, before any file loads, and fails in under a second with one
 * message naming the offending source file. See ./distFreshness for what it
 * compares and, more importantly, what it deliberately does not.
 */
export async function setup(): Promise<void> {
  // Before anything can write a record: the id every worker will inherit.
  process.env.VILLAGE_TEST_RUN_ID = `${process.pid}-${Date.now().toString(36)}`;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(provisionLogPath(), "");
    sweepStaleLogs();
  } catch {
    /* see noteProvision */
  }
  assertFreshDist();
  // Beside assertFreshDist and for the same reason, one step further out: that
  // one compares the bundle to its own inputs, and a DEPENDENCY is not one of
  // them, because the server build leaves packages external. See installedDeps.
  warnOnDependencyDrift();
  warnOnRuntimeMismatch();
}

/**
 * One line when this Node is not the Node that decides.
 *
 * `.node-version` says 22 and ci.yml pins 22. package.json has no `engines`
 * field, nothing reads process.version, and the machine this is developed on
 * runs a different major. So every local gate runs on a runtime CI does not
 * use, and a dependency whose behaviour differs across that gap builds green
 * here and red there with no local signal at all.
 *
 * Not a refusal: `engines` plus engine-strict would block every run on this
 * machine today and be routed around within the hour. A warning that appears
 * on every run gets read; a paragraph in a document gets read once.
 */
function warnOnRuntimeMismatch(): void {
  try {
    const pinned = fs.readFileSync(path.resolve(process.cwd(), ".node-version"), "utf8").trim();
    const want = pinned.replace(/^v/, "").split(".")[0];
    const have = process.version.replace(/^v/, "").split(".")[0];
    if (!want || want === have) return;
    // eslint-disable-next-line no-console
    console.warn(
      `[runtime] Node ${process.version}, but this repository pins ${pinned} (.node-version) ` +
        `and CI decides on ${pinned}. A green run here is not a green run there.`,
    );
  } catch {
    /* no .node-version, nothing to compare against */
  }
}

/**
 * The trapdoor this closes: dozens of suites gate on
 * `describe.skipIf(!testDbConfigured())` (server/db/testDb.ts), which is a
 * bare truthiness check on TEST_DATABASE_URL. If that variable is unset,
 * renamed, mistyped, or dropped in a workflow edit, `testDbConfigured()`
 * quietly returns false, every one of those suites skips, and vitest still
 * exits 0: the acceptance loop test, every routes e2e suite and the whole
 * economy suite gone with nothing louder than a skip count in a wall of
 * green. `noteProvision` (above) already records one line per schema this
 * run actually provisioned; a run that provisioned zero is that trapdoor,
 * not a fast run, so it must fail rather than just report a number nobody is
 * obligated to read.
 *
 * WHAT CHANGED, 2026-09-02, AND WHY. This used to fire only under CI or
 * REQUIRE_TEST_DB, on the reasoning that a bare `pnpm test` with no database
 * "is correct and must stay silent". Measured on this tree that day, that
 * default is the defect: `pnpm test` with .env moved aside skipped 1,190
 * tests across 91 database-gated files, printed the receipt below, and
 * EXITED 0. A fresh worktree has no .env, so that is the first thing a new
 * contributor, a founder standing up a village, and every agent lane sees.
 *
 * The receipt was not enough on its own. It is read by a human who is
 * watching; the exit code is read by every `&&`, every script, every CI step
 * and every reviewer who asks "did it pass?". A false green survives a
 * banner. So the DEFAULT is now a failure and the smaller suite needs a word
 * from whoever wants it.
 */

/**
 * A live count, not a number frozen into this file the day it was written
 * and wrong a month later. Every `describe.skipIf` in this tree today gates
 * on `testDbConfigured()`; there is no other reason a whole describe block
 * is conditionally skipped here, so counting the call site is an exact
 * stand-in for "how many suites just went dark", read from the tree that
 * actually ran rather than asserted from memory.
 */
function countDbGatedSuites(): { guards: number; files: number } {
  const SKIP_RE = /describe\.skipIf\(/g;
  const TEST_FILE_RE = /\.test\.tsx?$/;
  let count = 0;
  let files = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // a root that does not exist contributes nothing, not a crash
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!TEST_FILE_RE.test(entry.name)) continue;
      try {
        const hits = fs.readFileSync(full, "utf8").match(SKIP_RE);
        if (hits) {
          count += hits.length;
          files += 1;
        }
      } catch {
        /* an unreadable file does not change the count meaningfully here */
      }
    }
  };
  for (const root of ["server", "shared", "client"]) walk(path.resolve(process.cwd(), root));
  return { guards: count, files };
}

/**
 * What a run that provisioned NOTHING has to say for itself.
 *
 * The receipt used to go quiet here: `summarise([])` returns no lines, so the
 * one run whose composition a reader most needs to know about printed less
 * than any other. The only signal that a local run had been hollow was the
 * ABSENCE of a skip clause on vitest's summary line, which is a fact you have
 * to notice is missing. This prints instead, always, and it prints AFTER
 * vitest's own summary, so it is the last thing on screen.
 */
/**
 * Did the caller ask for a SUBSET of the suite?
 *
 * The guards below are statements about a WHOLE run. A single non-database
 * file run on its own legitimately provisions nothing, and failing that would
 * be a false red, which is the failure mode this lane exists to remove rather
 * than to add. So they apply to an unfiltered run only, read from the main
 * process's own argv.
 *
 * TWO RULES, AND WHAT EACH ONE IS FOR. Measured against real argv:
 *
 *   pnpm test                     ["run"]                        whole
 *   pnpm test:unit                ["run","--exclude","**<glob>"]  whole
 *   vitest run a.test.ts          ["run","a.test.ts"]            filtered
 *   vitest run --reporter dot a   ["run","--reporter","dot","a"] filtered
 *   vitest run --silent a.test.ts ["run","--silent","a.test.ts"] filtered
 *
 * Rule one is positional: an argument that is neither a flag nor a flag's
 * value is a file or glob to run. That alone reads the `--silent <file>` line
 * as a whole run, because a boolean flag has no value to skip, so rule two
 * adds it back: an argument naming something that EXISTS on disk is a path
 * somebody typed, whatever precedes it.
 *
 * The two rules are deliberately asymmetric about which way they can be
 * wrong. Reading a subset as a whole run costs one red run that says exactly
 * which env var clears it. Reading a whole run as a subset costs a silent
 * green on a suite that never ran, which is the bug. `pnpm test:unit` stays a
 * WHOLE run on purpose: it excludes the e2e files and still carries dozens of
 * database-gated ones, and its glob is not a path that exists.
 */
function runIsFiltered(): boolean {
  const argv = process.argv.slice(2);
  const start = argv.indexOf("run");
  const rest = start === -1 ? argv : argv.slice(start + 1);
  const positional = rest.some(
    (a, i) => !a.startsWith("-") && !(i > 0 && rest[i - 1]!.startsWith("-")),
  );
  if (positional) return true;
  return rest.some((a) => {
    if (a.startsWith("-")) return false;
    try {
      return fs.existsSync(path.resolve(process.cwd(), a));
    } catch {
      return false;
    }
  });
}

function hollowRunReport(verdict: HollowVerdict): string[] {
  const { guards, files } = countDbGatedSuites();
  const head = ["", "provisioning, this run", "  scratch schemas        0"];
  if (process.env.TEST_DATABASE_URL) {
    // The variable is set and nothing asked for a schema. On a filtered run
    // that is ordinary; on a whole run the guard below has already thrown.
    return [
      ...head,
      "  reason                 no database-backed file ran (a filtered run, or none of them matched)",
      `  not run                ${files} database-gated files (${guards} guarded describe blocks)`,
    ];
  }
  const lines = [
    ...head,
    `  database-gated files   ${files} (${guards} guarded describe blocks) did not run`,
    "  why                    TEST_DATABASE_URL is unset, so testDbConfigured() is false",
    "  what that costs        roughly a third of this suite, the ledger and every route among it",
    "  to run them            set TEST_DATABASE_URL in .env (see .env.example) and run again",
  ];
  // The last line has to match the exit code. A receipt that says "this run
  // failed" under a green run, or stays quiet under a red one, is the same
  // class of lie this whole guard exists to remove.
  if (verdict.fail) {
    lines.push(
      "  so this run FAILED     a skip is not a pass, and an unfiltered run with no database exits 1",
      "  to accept the smaller  ALLOW_NO_TEST_DB=1, and read the skip count as the result",
    );
  } else if (process.env.ALLOW_NO_TEST_DB) {
    lines.push(
      "  green anyway because   ALLOW_NO_TEST_DB is set, which accepts the smaller suite on purpose",
      "  so read this run as    the skip count, not the exit code: it proves nothing about the",
      "                         ledger, the economy or any route",
    );
  } else {
    lines.push(
      "  not a failure because  this run was filtered, so it never claimed to be the whole suite",
    );
  }
  return lines;
}

/**
 * The shape of a finished run, as data. Read from the environment and argv by
 * `teardown`, so the decision below can be checked without spawning a suite.
 */
export interface RunShape {
  /** Was TEST_DATABASE_URL set at all, as the MAIN process sees it? */
  hasUrl: boolean;
  /** Scratch schemas actually handed to suites (template builds do not count). */
  provisions: number;
  /** Did argv name files or globs, so this run was never a claim about the whole suite? */
  filtered: boolean;
  /** CI, or REQUIRE_TEST_DB: somebody declared the database mandatory for this run. */
  required: boolean;
  /** ALLOW_NO_TEST_DB: somebody declared, in words, that they accept the smaller suite. */
  optedOut: boolean;
}

export type HollowVerdict =
  | { fail: false; why: string }
  | { fail: true; reason: "no-url" | "no-provisions" };

/**
 * WHETHER A RUN THAT TOUCHED NO DATABASE IS ALLOWED TO EXIT 0.
 *
 * THE OPTION CHOSEN, AND WHY IT IS THIS ONE. Three were on the table: exit
 * non-zero whenever a database-gated file skipped; print a banner naming the
 * count; require an explicit opt-out before a skip is allowed to pass. The
 * third is what this implements.
 *
 * The banner alone was already shipped (c0ac180, 2026-08-31) and measured on
 * 2026-09-02: with .env moved aside, `pnpm test` skipped 1,190 tests across 91
 * database-gated files, printed the receipt, and exited 0. A banner is read by
 * a human who happens to be watching the end of a five-minute run. An exit
 * code is read by `&&`, by scripts, by CI steps, by agent lanes and by anyone
 * asking "did it pass?". So the banner stays and is not the whole answer.
 *
 * A hard failure with NO door was rejected because the smaller suite is a
 * documented, deliberate path, not an accident: CONTRIBUTING.md says "a
 * database is optional to start", `.env.example` ships TEST_DATABASE_URL
 * commented out, and `server/db/testDb.ts`'s header promises a contributor
 * without a database "a meaningful (if smaller) suite". Making the first
 * `pnpm test` in a fresh clone fail with no way through teaches people to stop
 * running the suite, which is worse than the bug.
 *
 * So the smaller suite survives and costs one word. The asymmetry is what
 * decides it: somebody who genuinely has no database pays one red run and one
 * env var, once. Without the guard, a founder, a contributor or an agent lane
 * reports green on a third of a suite that never ran, and this project has
 * paid that four times.
 *
 * PRECEDENCE. REQUIRE_TEST_DB and CI beat ALLOW_NO_TEST_DB. Those two say the
 * database is mandatory for this run; a blanket opt-out in a shell profile or
 * a stray workflow env must not be able to silence a demand made on purpose.
 *
 * A FILTERED RUN IS NOT A CLAIM ABOUT THE SUITE. Running one non-database file
 * on its own legitimately provisions nothing, and failing that would be the
 * false red this guard exists to avoid creating. It stays allowed, without an
 * opt-out, exactly as before.
 */
export function hollowRunVerdict(shape: RunShape): HollowVerdict {
  if (shape.provisions > 0) return { fail: false, why: "the run provisioned scratch schemas" };
  if (!shape.hasUrl) {
    // An explicit demand outranks an explicit waiver.
    if (shape.required) return { fail: true, reason: "no-url" };
    if (shape.optedOut) return { fail: false, why: "ALLOW_NO_TEST_DB accepts the smaller suite" };
    if (shape.filtered) return { fail: false, why: "a filtered run makes no claim about the suite" };
    return { fail: true, reason: "no-url" };
  }
  // The variable is set and nothing asked for a schema. On a whole run that
  // somebody declared mandatory, that is a database this run could not reach.
  if (shape.required && !shape.filtered) return { fail: true, reason: "no-provisions" };
  return { fail: false, why: "TEST_DATABASE_URL is set and no database-backed file matched" };
}

/** vitest globalTeardown: print what the run paid, and refuse to stay green when a run that should have touched the database never did. */
export async function teardown(): Promise<void> {
  const rows = readProvisionLog();
  const provisions = rows.filter((r) => r.kind === "clone" || r.kind === "full").length;
  const required = !!(process.env.CI || process.env.REQUIRE_TEST_DB);
  const verdict = hollowRunVerdict({
    hasUrl: !!process.env.TEST_DATABASE_URL,
    provisions,
    filtered: runIsFiltered(),
    required,
    optedOut: !!process.env.ALLOW_NO_TEST_DB,
  });
  const lines = provisions === 0 ? hollowRunReport(verdict) : summarise(rows);
  for (const line of lines) {
    // eslint-disable-next-line no-console
    console.log(line);
  }
  try {
    fs.rmSync(provisionLogPath(), { force: true });
  } catch {
    /* see noteProvision */
  }
  if (!verdict.fail) return;
  const { guards, files } = countDbGatedSuites();
  const dark =
    `all ${files} database-gated files (${guards} \`describe.skipIf(!testDbConfigured())\` ` +
    `blocks, the economy suite and every routes e2e suite among them) skipped`;
  if (verdict.reason === "no-url") {
    const who = process.env.CI
      ? "CI is set, so this run was required to touch the database, and"
      : process.env.REQUIRE_TEST_DB
        ? "REQUIRE_TEST_DB is set, so this run was required to touch the database, and"
        : "";
    throw new Error(
      `[provisioningReport] ${who}TEST_DATABASE_URL is not set at all, so ${dark} instead of ` +
        `running. A skip is not a pass, and roughly a third of this suite just did not run. ` +
        `Either set TEST_DATABASE_URL (see .env.example, and docs/FORK_RUNBOOK.md for a ` +
        `scratch-capable server), or set ALLOW_NO_TEST_DB=1 to say in words that you accept the ` +
        `smaller suite and that this run proves nothing about the ledger, the economy or any ` +
        `route.${required ? " ALLOW_NO_TEST_DB does not apply here: this run demanded a database." : ""}`,
    );
  }
  const why = process.env.CI
    ? "CI is set"
    : "REQUIRE_TEST_DB is set (pnpm test:full, or a lane that must not report a hollow green)";
  throw new Error(
    `[provisioningReport] ${why} and zero DB-backed suites provisioned a schema this run, ` +
      `though TEST_DATABASE_URL is set. That almost certainly means it is misspelled or the ` +
      `mysql service is unreachable, and ${dark} instead of running. A skip is not a pass: fix ` +
      `the database connection, do not relax this check.`,
  );
}
