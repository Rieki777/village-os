#!/usr/bin/env node
/**
 * THE SUBJECTS A GUARD SHOULD SCAN ARE WHAT GIT TRACKS, not everything on disk.
 *
 * 2026-09-24: `check-brand-refs` failed on five throwaway QA scripts sitting in
 * `tmp/`, which `.gitignore` line 101 covers. The hits were real occurrences of
 * the string and completely invisible to CI, because those files are never
 * committed. So it was a red that only ever appears LOCALLY and only for
 * whoever has scratch work in progress, which is the most expensive kind of
 * false alarm: it looks exactly like a real finding about your own change, on
 * the one machine where you have no second opinion. It also invites the two
 * worst repairs - a waiver comment on an untracked file, which is a permanent
 * lie in a tracked file, or raising a baseline.
 *
 * `git check-ignore` rather than `git ls-files`, deliberately. Listing tracked
 * files would ALSO stop scanning a lane's new, not-yet-committed source file,
 * and a brand name in a file about to be committed is a real finding. This
 * removes exactly what git is told to ignore and nothing else.
 *
 * IT NEVER NARROWS SILENTLY. Outside a repository, or if git cannot answer,
 * every path is returned and `consulted` is false so the caller can say the
 * filter did not run. A guard that stops scanning too much and a guard that
 * stops scanning at all report the same green, which is why every caller of
 * this prints `skipped` whether or not anything was skipped.
 *
 * Other guards in scripts/ walk the tree too. Only two start at the repository
 * root - this one and check-doc-links - and only this one was measured
 * reaching ignored files, so it is the only adopter today. Anything that later
 * walks from the root should come through here rather than grow its own copy.
 */
import { spawnSync } from "child_process";

/**
 * @param {string[]} paths absolute paths to consider
 * @param {{ cwd: string, rel: (p: string) => string }} opts repo root, and how to make a path relative to it
 * @returns {{ kept: string[], skipped: number, consulted: boolean }}
 */
export function dropIgnored(paths, { cwd, rel }) {
  if (!paths.length) return { kept: paths, skipped: 0, consulted: true };
  const r = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd,
    input: paths.map(rel).join(String.fromCharCode(10)),
    encoding: "utf8",
  });
  // 0 = at least one path is ignored, 1 = none are. Anything else (no git, not
  // a repo) is git declining to answer, which must not be read as an empty list.
  if (r.error || (r.status !== 0 && r.status !== 1)) return { kept: paths, skipped: 0, consulted: false };
  const ignored = new Set(String(r.stdout || "").split(String.fromCharCode(10)).map((s) => s.trim()).filter(Boolean));
  return { kept: paths.filter((f) => !ignored.has(rel(f))), skipped: ignored.size, consulted: true };
}
