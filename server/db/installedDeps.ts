/**
 * Is `node_modules` the tree the lockfile describes, or the one somebody
 * installed last time?
 *
 * ── WHAT THIS FIXES, WITH THE RECEIPT ────────────────────────────────────
 *
 * `scripts/build-server.mjs` builds with `packages: "external"`. Express is
 * therefore NOT in `dist/index.js`; the bundle requires it from `node_modules`
 * when the server boots. So the runtime version is whatever is installed at
 * BOOT time, and no amount of rebuilding changes it.
 *
 * On 2026-09-05 a worktree sat on `express@4.22.2` while `package.json` asked
 * for `^5.2.1`. Express 4 resolves paths with `path-to-regexp@0.1.12`, which
 * does not understand `/{*splat}` -- that is express 5 syntax -- so the SPA
 * catch-all in `server/index.ts` matched NOTHING. Measured against one
 * unchanged `dist/index.js`, before and after a single `pnpm install`:
 *
 *   /profile                        404 -> 200
 *   /some-page-that-never-existed   404 -> 200
 *   /deep/path/that/never/existed   404 -> 200
 *   /quests                         200 -> 200   (an express-4-valid pattern)
 *   /quests/:id                     200 -> 200   (likewise)
 *
 * Every client route in the product was dead, and the only test that noticed
 * was one assertion in `server/quest-share.e2e.test.ts`, which reads as an
 * obscure failure about a retired quest. Two sessions have now lost time to
 * it, one of them concluding "pre-existing on main, CI is green, probably
 * environment-specific" -- which was true and useless.
 *
 * ── WHY NOTHING ELSE CATCHES IT ──────────────────────────────────────────
 *
 * `assertFreshDist` compares the bundle to ITS OWN INPUTS, and a dependency is
 * not one of them, exactly because the build leaves packages external. CI
 * installs from the lockfile on a clean machine every time, so CI can never
 * see this. `pnpm check` type-checks against whatever is installed and is
 * happy either way. That leaves the local run as the only place it can appear
 * and the only place nothing was looking.
 *
 * ── WHY A WARNING AND NOT A REFUSAL ──────────────────────────────────────
 *
 * `assertFreshDist` throws, and it is right to: a stale bundle makes a green
 * meaningless. A behind-the-lockfile install usually does not, and refusing to
 * run any test until somebody installs would block work that has nothing to do
 * with the drifted package. So this NAMES the package, the version installed,
 * the version wanted and the command, once, at the top of the run. That is
 * enough: the failure it explains is unrecognisable without it and obvious
 * with it.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────
 *
 * It does not parse semver. A full range check needs a resolver and would
 * report every caret range as a mismatch the day a patch lands. It compares
 * the MAJOR the range asks for against the major installed, which is the gap
 * that changes behaviour, and says nothing about the rest.
 *
 * It reads `dependencies` only. A dev dependency that drifts cannot change how
 * the built server answers a request, which is the whole subject here.
 *
 * `root` is a parameter so `installedDeps.test.ts` can point it at a fixture
 * tree and prove BOTH directions. A guard nobody has watched fire is a guard
 * nobody should believe, and this one exists because a guard that was not
 * there let every route in the product 404 quietly.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export interface DepDrift {
  name: string;
  installed: string;
  wanted: string;
}

/** The major a range asks for, or null when the range names no single major. */
function wantedMajor(range: string): number | null {
  const m = /^[\^~>=\s]*(\d+)\./.exec(String(range).trim());
  return m ? Number(m[1]) : null;
}

/**
 * Every runtime dependency whose installed major differs from the one
 * `package.json` asks for. Empty when the tree is current, and empty when it
 * cannot tell, because a guard that guesses is worse than one that is quiet.
 */
export function dependencyDrift(root: string = process.cwd()): DepDrift[] {
  let pkg: any;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return [];
  }
  const deps: Record<string, string> = pkg?.dependencies ?? {};
  const require_ = createRequire(path.join(root, "noop.cjs"));
  const drift: DepDrift[] = [];
  for (const [name, range] of Object.entries(deps)) {
    const want = wantedMajor(range);
    if (want == null) continue;
    let installed: string;
    try {
      installed = require_(`${name}/package.json`).version;
    } catch {
      // Not resolvable from here (an optional platform package, or a package
      // with no exported package.json). Not this guard's business.
      continue;
    }
    const have = wantedMajor(`${installed}.`) ?? wantedMajor(installed);
    if (have != null && have !== want) drift.push({ name, installed, wanted: range });
  }
  return drift;
}

/** The sentence to print, or null when the tree matches the lockfile. */
export function dependencyDriftProblem(root?: string): string | null {
  const drift = dependencyDrift(root);
  if (drift.length === 0) return null;
  const lines = drift.map((d) => `    ${d.name}: installed ${d.installed}, package.json asks for ${d.wanted}`);
  return (
    `[stale node_modules] ${drift.length} runtime dependenc${drift.length === 1 ? "y is" : "ies are"} ` +
    `a MAJOR version behind what this tree asks for:\n` +
    lines.join("\n") +
    `\n  The server build leaves packages external, so dist/index.js loads these at BOOT and a\n` +
    `  rebuild does not change them. Express 4 against express-5 route syntax makes every SPA\n` +
    `  route 404 while /quests and /quests/:id keep working, which reads as an unrelated bug.\n` +
    `  Fix: pnpm install --frozen-lockfile`
  );
}

/** One line at the top of a run when the tree is behind. Never throws. */
export function warnOnDependencyDrift(): void {
  try {
    const problem = dependencyDriftProblem();
    // eslint-disable-next-line no-console
    if (problem) console.warn(problem);
  } catch {
    /* a guard that cannot read the tree says nothing about it */
  }
}
