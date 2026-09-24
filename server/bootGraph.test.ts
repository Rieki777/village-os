import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * NOTHING ON THE BOOT PATH MAY STATICALLY IMPORT viem.
 *
 * `server/lib/base-reads.ts` did, and `server/index.ts` imports that file for
 * four route handlers, so every boot resolved viem whether or not any chain
 * read happened. viem is 10,134 files and 26.7 MB on disk, 1,417 of them chain
 * definitions that `viem/chains` re-exports as one barrel, against 135 files
 * for mysql2 and 10 for express. Node's ESM resolver opens every one, and on a
 * tree touching them for the first time that walk is tens of seconds during
 * which the process prints NOTHING.
 *
 * Measured on one machine, 2026-09-23, booting the built `dist/index.js`
 * against a schema the migrations had already run on, which is the shape the
 * e2e harness hands each suite:
 *
 *   static import, first boot after a build   57.3 s to "Server listening"
 *   dynamic import, same                      28.0 s
 *   static import, warm                        3.3 s
 *   dynamic import, warm                       1.5 s
 *
 * 56 e2e suites spawn that bundle against a 120 s deadline
 * (`E2E_BOOT_DEADLINE_MS`, not configurable by environment), and the failure
 * reads as "server did not start in 120s" over an EMPTY log, which looks
 * exactly like a boot the change under test broke. It also cost every
 * production boot.
 *
 * So this is a property of the boot graph rather than of one file, and the
 * denominator below is DERIVED: every module reachable from `server/index.ts`
 * through static imports, walked here, not a list anybody maintains. A fifth
 * path pulling viem at module load would put the whole cost back while
 * `base-reads.ts` still looked correct.
 *
 * `server/lib/hypha/selfHostedListener.ts` keeps its static import and is
 * right to: it is a standalone CLI process nothing imports, so it is not in
 * this graph. It is the known positive the control below reads, because a walk
 * that found nothing because it was broken would pass every assertion here by
 * being empty.
 */

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "server", "index.ts");
const LISTENER = path.join(ROOT, "server", "lib", "hypha", "selfHostedListener.ts");

/** A bare specifier's package name: "viem/chains" is "viem", scoped names keep both halves. */
function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/**
 * Static module specifiers only. `await import("viem")` is a CallExpression and
 * is deliberately invisible here, because deferring the load is the whole fix.
 * A wholly type-only import is erased before it reaches a runtime, so it is
 * invisible too.
 */
function staticSpecifiers(file: string): string[] {
  const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const out: string[] = [];
  for (const node of src.statements) {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly) continue;
      if (ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (node.isTypeOnly) continue;
      if (ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    }
  }
  return out;
}

/** A relative specifier as the file it actually loads, or null when it resolves to none. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), base]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every module the entry point reaches through static imports, plus the bare packages it pulls. */
function walkBootGraph(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of staticSpecifiers(file)) {
      if (spec.startsWith(".")) {
        const next = resolveLocal(file, spec);
        if (next && !files.has(next)) queue.push(next);
      } else if (!spec.startsWith("node:")) {
        packages.add(packageOf(spec));
      }
    }
  }
  return { files, packages };
}

describe("the boot graph", () => {
  const graph = walkBootGraph(ENTRY);

  it("reaches the server it claims to, and says how much it looked at", () => {
    // The denominator, printed. A guard handed two files would pass the
    // assertion below without having checked anything.
    console.log(
      `[bootGraph] ${graph.files.size} source files reachable from server/index.ts, ` +
        `pulling ${graph.packages.size} packages statically`,
    );
    expect(graph.files.size).toBeGreaterThan(100);
    expect(graph.packages.has("express"), "express must be in a graph that reaches the server").toBe(true);
    expect(graph.packages.has("mysql2"), "mysql2 must be in a graph that reaches the server").toBe(true);
  });

  it("pulls no part of viem at module load", () => {
    const offenders = [...graph.files].filter((f) =>
      staticSpecifiers(f).some((s) => packageOf(s) === "viem"),
    );
    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      "these boot on viem; load it inside the function that reads the chain instead",
    ).toEqual([]);
  });

  it("finds the static import it is looking for when there is one", () => {
    // The known positive. The standalone listener CLI imports viem at the top
    // and is not in the boot graph, so the detector is proven to work and the
    // denominator is proven to exclude the right file.
    expect(staticSpecifiers(LISTENER).map(packageOf)).toContain("viem");
    expect(graph.files.has(LISTENER), "the standalone listener is not part of a boot").toBe(false);
  });
});
