/**
 * Both directions, against a fixture tree on disk.
 *
 * The reason this file exists is the reason the guard exists: a guard nobody
 * has watched fire is a guard nobody should believe. The real incident was a
 * worktree on express 4 with express-5 route syntax in the source, which made
 * every SPA route 404 while two explicit routes kept working, and the only
 * signal anywhere was one assertion about a retired quest.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { dependencyDrift, dependencyDriftProblem } from "./installedDeps";

const made: string[] = [];

/** A tree with a package.json and a node_modules holding the versions given. */
function fixture(deps: Record<string, string>, installed: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deps-fixture-"));
  made.push(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", dependencies: deps }));
  for (const [name, version] of Object.entries(installed)) {
    const dir = path.join(root, "node_modules", ...name.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version, main: "index.js" }));
    fs.writeFileSync(path.join(dir, "index.js"), "module.exports = {};");
  }
  return root;
}

afterEach(() => {
  while (made.length) {
    try { fs.rmSync(made.pop()!, { recursive: true, force: true }); } catch { /* a temp dir */ }
  }
});

describe("dependencyDrift", () => {
  it("NAMES the package when a major is behind, which is the case that cost a session", () => {
    const root = fixture({ express: "^5.2.1" }, { express: "4.22.2" });
    expect(dependencyDrift(root)).toEqual([{ name: "express", installed: "4.22.2", wanted: "^5.2.1" }]);
  });

  it("says nothing when the majors agree, however far apart the patches are", () => {
    const root = fixture({ express: "^5.2.1" }, { express: "5.0.0" });
    expect(dependencyDrift(root)).toEqual([]);
  });

  it("catches a tree that is AHEAD as well as behind, since either one changes behaviour", () => {
    const root = fixture({ express: "^4.22.2" }, { express: "5.2.1" });
    expect(dependencyDrift(root).map((d) => d.name)).toEqual(["express"]);
  });

  it("ignores a package it cannot resolve rather than guessing about it", () => {
    const root = fixture({ express: "^5.2.1", "not-installed-at-all": "^3.0.0" }, { express: "5.2.1" });
    expect(dependencyDrift(root)).toEqual([]);
  });

  it("ignores a range that names no single major, because it cannot be wrong about one", () => {
    const root = fixture({ express: "*" }, { express: "4.22.2" });
    expect(dependencyDrift(root)).toEqual([]);
  });

  it("reads dependencies only: a dev dependency cannot change how the built server answers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deps-fixture-"));
    made.push(root);
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "f", dependencies: {}, devDependencies: { vitest: "^3.0.0" } }),
    );
    const dir = path.join(root, "node_modules", "vitest");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "vitest", version: "1.0.0" }));
    expect(dependencyDrift(root)).toEqual([]);
  });

  it("is quiet on a tree with no package.json instead of throwing into somebody's setup", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deps-fixture-"));
    made.push(root);
    expect(dependencyDrift(root)).toEqual([]);
    expect(dependencyDriftProblem(root)).toBeNull();
  });
});

describe("the sentence it prints", () => {
  it("carries the versions, the mechanism and the command, because the failure it explains looks unrelated", () => {
    const root = fixture({ express: "^5.2.1" }, { express: "4.22.2" });
    const problem = dependencyDriftProblem(root) ?? "";
    expect(problem).toContain("express: installed 4.22.2");
    expect(problem).toContain("^5.2.1");
    expect(problem).toContain("packages external");
    expect(problem).toContain("pnpm install --frozen-lockfile");
  });

  it("is null on a tree that matches, so a clean run prints nothing at all", () => {
    const root = fixture({ express: "^5.2.1" }, { express: "5.2.1" });
    expect(dependencyDriftProblem(root)).toBeNull();
  });

  it("counts in the plural correctly, since the sentence is read under pressure", () => {
    const root = fixture({ express: "^5.2.1", sharp: "^0.34.0" }, { express: "4.22.2", sharp: "1.0.0" });
    const problem = dependencyDriftProblem(root) ?? "";
    expect(problem).toContain("2 runtime dependencies are");
  });
});
