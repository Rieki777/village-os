/**
 * NO VILLAGE'S GUIDE NAME IN PLATFORM CODE (Rye, 2026-10-22; readiness R087).
 *
 * "Maia" is one village's guide. Every village names its own, and the name is
 * read through shared/guideName.ts from `workWithUs.assistantName`. #695
 * removed every "Maia" fallback, and a later feature put one straight back
 * (`assistantName || "Maia"`), with a prompt that told the model "You are
 * Maia" in every village. Nothing failed, because nothing looked.
 *
 * This looks: no string or template literal in shipped server, shared or
 * client code may carry the name. Identifiers (MaiaTypeLine, factsForMaia),
 * comments, tests and the founding village's own seeds are not shipped words
 * and are not read here.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SCANNED = ["server", "shared", "client/src"];
const SKIP_DIR = /[\/](node_modules|seeds|assets|dist)([\/]|$)/;
const CODE = /\.(ts|tsx|js|mjs)$/;
const TEST = /\.(test|spec)\.(ts|tsx|js|mjs)$|\.e2e\.test\./;
const NAME = /\bMaia\b/;

function files(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR.test(full + path.sep)) files(full, out);
    } else if (CODE.test(entry.name) && !TEST.test(entry.name)) out.push(full);
  }
  return out;
}

/** Each quoted run on a line that is not a comment, with the quote it opened with. */
function literalHits(source: string): string[] {
  const hits: string[] = [];
  source.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    const code = line.replace(/\/\/.*$/, (m) => (/["'`]/.test(m.slice(0, 2)) ? m : ""));
    for (const m of code.matchAll(/(["'`])((?:\.|(?!\1).)*)\1/g)) {
      if (NAME.test(m[2])) hits.push(`${i + 1}: ${t.slice(0, 120)}`);
    }
  });
  return hits;
}

describe("no village's guide name in platform code", () => {
  it("finds no \"Maia\" in any shipped string, so an unnamed guide never borrows one", () => {
    const found: string[] = [];
    for (const dir of SCANNED) {
      for (const file of files(path.join(ROOT, dir))) {
        for (const hit of literalHits(fs.readFileSync(file, "utf8"))) found.push(`${path.relative(ROOT, file)}:${hit}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("sees a name inside a string and ignores identifiers and comments (the scanner's own control)", () => {
    expect(literalHits(`const a = x || "Maia";`)).toHaveLength(1);
    expect(literalHits("const p = `You are Maia, the guide`;")).toHaveLength(1);
    expect(literalHits(`import MaiaTypeLine from "./MaiaTypeLine";`)).toHaveLength(0);
    expect(literalHits(`// Maia speaks here`)).toHaveLength(0);
    expect(literalHits(` * Maia's dock`)).toHaveLength(0);
  });
});
