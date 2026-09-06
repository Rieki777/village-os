#!/usr/bin/env node
/**
 * Two migrations may not share a number, and no upstream migration may take a
 * number a village has been promised.
 *
 * WHY THIS IS A GATE AND NOT A CONVENTION. It has already failed three times
 * here, and every time a person caught it by reading. `git log --all` at
 * 052d042 shows three numbers that carried two different files:
 *
 *     0062_characters.sql          and 0062_map_keys.sql
 *     0063_profile_body.sql        and 0063_map_scene_publish.sql
 *     0090_proposal_drafts.sql     and 0090_retire_quest_propose.sql
 *
 * Two of those pairs were added on `main`. The fix is in the log under its own
 * commit, d0e09b9, "Renumber 0062-0065 to 0063-0066, around a collision on
 * main". Nothing failed. A lane noticed. That worked with one deployment and
 * a handful of branches; it does not survive thirteen founder instances all
 * pulling the same image, because the person who would notice is not in the
 * room when the container boots.
 *
 * WHAT A COLLISION ACTUALLY COSTS. `server/db/migrate.ts` discovers files with
 * `/^\d{4}.*\.sql$/`, sorts them BY FILENAME, and records each applied file in
 * `_migrations_applied` BY FILENAME. There is no checksum. So:
 *
 *  - Two files sharing a number both run, and the order between them is
 *    decided by the alphabet of their DESCRIPTIONS. `0121_a_thing.sql` runs
 *    before `0121_zebra.sql` for no reason anybody chose. If one depends on
 *    the other, whether the instance boots is a coin flip on wording.
 *  - Two files sharing a FULL NAME with different bodies is worse and silent.
 *    An instance that already ran the old one has its filename in the ledger,
 *    so the new body is SKIPPED. Not replayed: skipped. No error, no log line,
 *    and every later migration is now written against a schema that instance
 *    does not have.
 *
 * THE VILLAGE BAND. Numbers 0000 to 8999 belong to this repository. Numbers
 * 9000 to 9999 belong to the village running the instance, for migrations it
 * writes for itself and never sends upstream. The band is not decoration:
 * because the runner sorts by filename, `9001_...` sorts after every upstream
 * number that will ever exist, so a village-local migration always runs last
 * and always builds on a complete upstream schema. A village that instead
 * grabs the next free upstream number gets a file that collides the week we
 * ship that number, and it collides in the silent way above.
 *
 * Upstream keeps its half of that promise here: this repository fails its own
 * CI if it ever writes a file at 9000 or above. A village fork that adds one
 * runs the same check with `--village` (or `VILLAGE_LOCAL_MIGRATIONS=1`),
 * which permits the band and still refuses duplicates inside it.
 *
 * THE HISTORY RULE, and why it replaces the list of burned numbers. The Season
 * 2 ledger keeps a register of numbers that were claimed, used on a branch and
 * then renumbered: 0111 and 0115 to 0119. Reusing one is a hazard because some
 * tree somewhere may still hold a file with that name. A hand-kept list of them
 * is one more thing to forget, and it is not even complete: 0064, 0065, 0080,
 * 0094, 0100, 0103 and 0107 are gaps by the same accident and the register does
 * not name them.
 *
 * So the rule is stated once and needs no register: A MIGRATION ADDED SINCE THE
 * BASE REF MUST BE NUMBERED ABOVE EVERY NUMBER THE BASE REF ALREADY HAS. Only
 * forward. That makes every gap permanently unusable without anybody listing
 * them, catches a number reused from another lane's branch, and matches what
 * the runner does anyway, which is to run files in filename order.
 *
 * THIS RULE NEEDS GIT HISTORY AND FAILS RATHER THAN SKIP WITHOUT IT. A gate
 * whose "did not run" and whose "found nothing" print the same thing is not a
 * gate. If the base ref cannot be resolved this exits non-zero and says which
 * ref it wanted. `--no-history` turns the rule off explicitly, prints that it
 * is off, and is for a checkout with no remote. CI never passes it. Note that
 * `actions/checkout@v4` clones with `fetch-depth: 1` by default, which is not
 * enough: the workflow sets `fetch-depth: 0`.
 *
 * WHAT THIS CANNOT CATCH. It compares names, not bodies. Two migrations with
 * different numbers that both add the same column still collide at boot, and
 * only `scripts/check-migration-compat.mjs` runs the SQL. It also cannot tell
 * an upstream file from a village file inside a fork, because a fork's copy of
 * this repository looks exactly like this repository; all it can enforce there
 * is the band and the duplicates.
 *
 * Usage:
 *   node scripts/check-migration-numbers.mjs
 *   node scripts/check-migration-numbers.mjs --since origin/main
 *   node scripts/check-migration-numbers.mjs --no-history
 *   node scripts/check-migration-numbers.mjs --village      village fork: band allowed
 *   node scripts/check-migration-numbers.mjs --next         print the next free number
 *   node scripts/check-migration-numbers.mjs --json
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "drizzle");

/** The floor of the band reserved for migrations a village writes for itself. */
export const VILLAGE_BAND_FLOOR = 9000;

/**
 * The runner's own discovery regex, copied from `discoverMigrations` in
 * server/db/migrate.ts. A `.sql` file in drizzle/ that does not match it is
 * never applied by anything, on any instance, and nothing anywhere says so.
 */
const DISCOVERABLE = /^\d{4}.*\.sql$/;

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const asJson = has("--json");
const villageMode = has("--village") || process.env.VILLAGE_LOCAL_MIGRATIONS === "1";
const historyOff = has("--no-history");

function git(args) {
  // No shell: `git show <ref>:<path>` gets its colon mangled by Git Bash on
  // Windows, and the mangled call still exits 0 with plausible output.
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf-8", shell: false });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

/** Every number a set of filenames carries, as integers. */
function numbersOf(files) {
  return files.map((f) => Number(f.slice(0, 4)));
}

/* ------------------------------------------------------------------ *
 * Read the working tree.
 * ------------------------------------------------------------------ */

if (!fs.existsSync(DIR)) {
  console.error(`::error::no drizzle/ directory at ${DIR}. This script is run from the repo root.`);
  process.exit(1);
}

const allSql = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".sql")).sort();
const migrations = allSql.filter((f) => DISCOVERABLE.test(f));
const undiscoverable = allSql.filter((f) => !DISCOVERABLE.test(f));

const byNumber = new Map();
for (const f of migrations) {
  const n = f.slice(0, 4);
  const list = byNumber.get(n) ?? [];
  list.push(f);
  byNumber.set(n, list);
}

/*
 * ONE COLLISION THAT ALREADY HAPPENED, AND CANNOT BE UNDONE BY RENUMBERING.
 *
 * Two sessions took 0156 within eleven minutes of each other on 2026-09-04, and
 * BOTH FILES HAVE ALREADY RUN on production; verified by reading
 * `_migrations_applied`, which lists both. The applied ledger keys on FILENAME,
 * so renaming either one does not tidy history, it makes the renamed file NEW
 * to every instance that already ran it, and it runs again on the next boot.
 *
 * So the advice this rule prints, renumber all but one, is right for a
 * collision caught BEFORE it ships and wrong for one caught after. Without a way
 * to say "this already happened", the only options were to tamper with
 * production or to leave CI permanently red, and a red that cannot be fixed
 * teaches everybody to stop reading it.
 *
 * The order between these two is settled and is now history: the alphabet put
 * `an_investor_path` before `half_erased_members`, that is the order every
 * instance ran them in, and nothing here can or should change it.
 *
 * THIS LIST DOES NOT GROW. A new collision is a live defect and must be
 * renumbered before it ships. If you are reading this because you want to add a
 * second entry, the answer is no: renumber your file instead.
 */
const SHIPPED_COLLISIONS = new Set(["0156"]);

const duplicates = [...byNumber.entries()]
  .filter(([, files]) => files.length > 1)
  .filter(([n]) => !SHIPPED_COLLISIONS.has(String(n)));
const inBand = migrations.filter((f) => Number(f.slice(0, 4)) >= VILLAGE_BAND_FLOOR);
const upstream = migrations.filter((f) => Number(f.slice(0, 4)) < VILLAGE_BAND_FLOOR);
const highestUpstream = upstream.length ? Math.max(...numbersOf(upstream)) : -1;
const nextFree = String(highestUpstream + 1).padStart(4, "0");

if (has("--next")) {
  console.log(nextFree);
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 * The history rule: what did the base ref already have?
 * ------------------------------------------------------------------ */

/**
 * The previous release, which is what a rollback lands on and therefore what
 * "already taken" means. In a pull request that is the target branch. On a
 * push to the target branch itself the merge base IS this commit, so the
 * previous release is its first parent.
 */
function resolveBase() {
  const explicit = valueOf("--since");
  const candidates = explicit
    ? [explicit]
    : process.env.GITHUB_BASE_REF
      ? [`origin/${process.env.GITHUB_BASE_REF}`, process.env.GITHUB_BASE_REF]
      : ["origin/main", "main"];
  const head = git(["rev-parse", "HEAD"]);
  if (!head.ok) return { error: "not a git checkout (git rev-parse HEAD failed)" };
  const found = [];
  for (const ref of candidates) {
    if (!git(["rev-parse", "--verify", `${ref}^{commit}`]).ok) continue;
    const mb = git(["merge-base", "HEAD", ref]);
    if (mb.ok) found.push({ ref, sha: mb.out });
  }
  if (found.length === 0) return { error: `could not resolve any of: ${candidates.join(", ")}` };
  // THE NEWEST MERGE BASE WINS, not the first candidate that resolves. On a CI
  // runner only `origin/main` exists and the two are the same. On this machine,
  // where a dozen worktrees share one object store and nothing is pushed, the
  // local `main` runs AHEAD of `origin/main` (measured: 7 commits, 2026-08-30).
  // Taking the first match would then measure against a release that is no
  // longer the one a rollback lands on, and would do it silently.
  let best = found[0];
  for (const c of found.slice(1)) {
    if (git(["merge-base", "--is-ancestor", best.sha, c.sha]).ok) best = c;
  }
  if (best.sha !== head.out) return best;
  // HEAD is the base. The previous release is the parent.
  const parent = git(["rev-parse", "--verify", "HEAD^{commit}^"]);
  if (!parent.ok) return { ...best, note: "HEAD has no parent; nothing added" };
  return { ref: `${best.ref} (HEAD^)`, sha: parent.out };
}

let history = { ran: false, reason: "", base: "", added: [], ceiling: -1, regressions: [] };

if (historyOff) {
  history.reason = "--no-history was passed";
} else {
  const base = resolveBase();
  if (base.error) {
    history.reason = base.error;
  } else {
    const tree = git(["ls-tree", "--name-only", `${base.sha}`, "drizzle/"]);
    if (!tree.ok) {
      history.reason = `could not list drizzle/ at ${base.sha}: ${tree.err}`;
    } else {
      const baseFiles = tree.out
        .split("\n")
        .map((l) => l.trim().replace(/^drizzle\//, ""))
        .filter((f) => DISCOVERABLE.test(f));
      const baseNames = new Set(baseFiles);
      history.ran = true;
      history.base = `${base.ref} @ ${base.sha.slice(0, 8)}`;
      history.ceiling = baseFiles.length ? Math.max(...numbersOf(baseFiles)) : -1;
      history.added = migrations.filter((f) => !baseNames.has(f));
      history.regressions = history.added
        .filter((f) => Number(f.slice(0, 4)) < VILLAGE_BAND_FLOOR)
        .filter((f) => Number(f.slice(0, 4)) <= history.ceiling)
        .map((f) => ({ file: f, number: f.slice(0, 4) }));
    }
  }
}

/* ------------------------------------------------------------------ *
 * Report.
 * ------------------------------------------------------------------ */

let failed = false;
const problems = [];

if (undiscoverable.length > 0) {
  failed = true;
  problems.push({ rule: "discoverable", files: undiscoverable });
  console.error(
    `::error::${undiscoverable.length} file(s) in drizzle/ end in .sql but do not match the runner's ` +
      `discovery pattern /^\\d{4}.*\\.sql$/, so server/db/migrate.ts will never apply them on any instance.`,
  );
  for (const f of undiscoverable) console.error(`    drizzle/${f}`);
  console.error(`  Rename each to NNNN_description.sql, or move it out of drizzle/ if it is not a migration.`);
}

if (duplicates.length > 0) {
  failed = true;
  problems.push({ rule: "duplicate", numbers: duplicates.map(([n, files]) => ({ number: n, files })) });
  console.error("");
  console.error(
    `::error::${duplicates.length} migration number(s) are used by more than one file. Both files run, ` +
      `and the order between them is decided by the alphabet of their descriptions rather than by anybody's intent.`,
  );
  for (const [n, files] of duplicates) {
    console.error(`    ${n}: ${files.join(", ")}`);
  }
  console.error(`  Renumber all but one of each set. The next free upstream number is ${nextFree}.`);
  console.error(`  Claim it in SEASON2_FLEET_LEDGER.md section 3 BEFORE creating the file, which is what`);
  console.error(`  stops the next lane taking the same one an hour later.`);
}

if (inBand.length > 0 && !villageMode) {
  failed = true;
  problems.push({ rule: "band", files: inBand });
  console.error("");
  console.error(
    `::error::${inBand.length} migration(s) sit at or above ${VILLAGE_BAND_FLOOR}, which is the band reserved for ` +
      `migrations a village writes for its own instance. Upstream promised never to take a number in it.`,
  );
  for (const f of inBand) console.error(`    drizzle/${f}`);
  console.error(`  If this IS an upstream migration, renumber it to ${nextFree}.`);
  console.error(`  If this is a village fork adding its own migration, that is allowed, and the fork runs`);
  console.error(`  this check with --village (or VILLAGE_LOCAL_MIGRATIONS=1 in its CI environment).`);
}

if (villageMode && inBand.length === 0 && migrations.length > 0) {
  console.log(`  --village is on and no migration is in the ${VILLAGE_BAND_FLOOR}+ band yet`);
}

if (history.regressions.length > 0) {
  failed = true;
  problems.push({ rule: "monotonic", files: history.regressions });
  console.error("");
  console.error(
    `::error::${history.regressions.length} migration(s) added since ${history.base} carry a number at or below ` +
      `${String(history.ceiling).padStart(4, "0")}, which that ref already reached. Numbers only go forward.`,
  );
  for (const r of history.regressions) console.error(`    drizzle/${r.file}`);
  console.error(`  A number below the ceiling is either one another lane is already using on its own branch,`);
  console.error(`  or a gap left by a renumbering, and some tree somewhere may still hold a file with that`);
  console.error(`  name. A reused FILENAME is the silent case: an instance that already applied the old one`);
  console.error(`  has that name in _migrations_applied, so the new body never runs and nothing says so.`);
  console.error(`  Renumber to ${nextFree} or above.`);
}

if (historyOff) {
  // Asked for. Still said out loud, so a log that scrolled past cannot be read
  // as a run that checked everything.
  console.error("");
  console.error(
    `::warning::the only-forward rule is OFF (--no-history). This run compared the working tree with ` +
      `itself, so a number reused from another branch was NOT checked.`,
  );
} else if (!history.ran) {
  // The "did not run" case, which must never look like the "found nothing"
  // case. It is a failure whether or not anything else failed; when something
  // else already did, this rides along rather than diluting it.
  console.error("");
  console.error(
    `::error::the only-forward rule DID NOT RUN: ${history.reason}. ` +
      `Everything else here reports on the working tree alone, so a number reused from another branch was NOT checked.`,
  );
  console.error(`  CI checks out with fetch-depth: 0 so origin/main resolves. Locally, fetch it:`);
  console.error(`    git fetch origin main`);
  console.error(`  or run the tree-only rules on purpose with --no-history.`);
  failed = true;
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        migrations: migrations.length,
        highestUpstream: highestUpstream < 0 ? null : String(highestUpstream).padStart(4, "0"),
        nextFree,
        villageBandFloor: VILLAGE_BAND_FLOOR,
        villageBandFiles: inBand,
        villageMode,
        history,
        problems,
        ok: !failed,
      },
      null,
      2,
    ),
  );
}

if (failed) process.exit(1);
if (asJson) process.exit(0); // --json prints JSON and nothing else, so it can be piped

const historyLine = historyOff
  ? "only-forward rule OFF by request"
  : `nothing added since ${history.base} reuses a number at or below ${String(history.ceiling).padStart(4, "0")}` +
    ` (${history.added.length} added)`;
console.log(
  `  ${migrations.length} migrations, no duplicate numbers, next free ${nextFree}; ${historyLine}` +
    (inBand.length ? `; ${inBand.length} in the village band` : ""),
);
