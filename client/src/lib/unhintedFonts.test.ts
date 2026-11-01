import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pointAtUnhintedFonts } from "./unhintedFonts";

/**
 * The unhinted font copies are only worth having if every cut main.tsx
 * imports has one: a cut without a copy still renders (in the hinted
 * original), so the miss would be silent bytes. And a copy nothing imports is
 * dead weight in the repository. These tests make both loud, and pin the
 * rewrite to the url() alone.
 */

const ROOT = path.resolve(__dirname, "../../..");
const MAIN = fs.readFileSync(path.join(ROOT, "client/src/main.tsx"), "utf8");
const FONTS = path.join(ROOT, "client/src/fonts");

/** "@fontsource/cormorant-garamond/latin-400-italic.css" -> "cormorant-garamond-latin-400-italic.woff2" */
const importedFiles = [...MAIN.matchAll(/"@fontsource\/([a-z-]+)\/latin-(\d+)(-italic)?\.css"/g)]
  .map(([, pkg, weight, italic]) => `${pkg}-latin-${weight}-${italic ? "italic" : "normal"}.woff2`)
  .sort();

const KALAM_700 = `/* kalam-latin-700-normal */
@font-face {
  font-family: 'Kalam';
  font-style: normal;
  font-display: swap;
  font-weight: 700;
  src: url(./files/kalam-latin-700-normal.woff2) format('woff2');
}`;

describe("pointAtUnhintedFonts", () => {
  it("swaps the url of a cut that has a copy and nothing else", () => {
    const out = pointAtUnhintedFonts(KALAM_700, new Set(["kalam-latin-700-normal.woff2"]), "@/fonts");
    expect(out).toBe(KALAM_700.replace("./files/kalam-latin-700-normal.woff2", "@/fonts/kalam-latin-700-normal.woff2"));
  });

  it("leaves a cut with no copy on the package's own file", () => {
    expect(pointAtUnhintedFonts(KALAM_700, new Set(["kalam-latin-400-normal.woff2"]), "@/fonts")).toBeNull();
  });

  it("handles quoted urls", () => {
    const quoted = KALAM_700.replace("url(./files/kalam-latin-700-normal.woff2)", `url("./files/kalam-latin-700-normal.woff2")`);
    expect(pointAtUnhintedFonts(quoted, new Set(["kalam-latin-700-normal.woff2"]), "@/fonts")).toContain(
      "url(@/fonts/kalam-latin-700-normal.woff2)",
    );
  });
});

describe("the committed unhinted copies", () => {
  const committed = fs.existsSync(FONTS) ? fs.readdirSync(FONTS).filter((f) => f.endsWith(".woff2")).sort() : [];

  it("finds the cuts main.tsx imports", () => {
    expect(importedFiles.length).toBeGreaterThan(30);
  });

  it("has a copy of every imported cut and no copy nothing imports", () => {
    expect(committed).toEqual(importedFiles);
  });

  it("holds real woff2 files, each no larger than the package's own", () => {
    for (const name of committed) {
      const bytes = fs.readFileSync(path.join(FONTS, name));
      expect(bytes.subarray(0, 4).toString("latin1"), name).toBe("wOF2");
      const pkg = name.split("-latin-")[0];
      const original = path.join(ROOT, "node_modules/@fontsource", pkg, "files", name);
      if (fs.existsSync(original)) expect(bytes.length, name).toBeLessThanOrEqual(fs.statSync(original).size);
    }
  });
});
