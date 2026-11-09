import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyFor, pointAtUnhintedFonts, variableCopyName } from "./unhintedFonts";

/**
 * The unhinted font copies are only worth having if every cut main.tsx
 * imports has one: a cut without a copy still renders (in the hinted
 * original), so the miss would be silent bytes. And a copy nothing imports is
 * dead weight in the repository. These tests make both loud, and pin the
 * rewrite to the url() alone.
 *
 * A family with a variable font serves EVERY cut from that one file. Each
 * @font-face rule keeps its own single weight, so font matching is exactly what
 * it was, and the browser fetches the shared file once.
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

const MONTSERRAT_600 = `/* montserrat-latin-600-normal */
@font-face {
  font-family: 'Montserrat';
  font-style: normal;
  font-display: swap;
  font-weight: 600;
  src: url(./files/montserrat-latin-600-normal.woff2) format('woff2');
  unicode-range: U+0000-00FF,U+0131,U+0152-0153;
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

  it("points a static cut at its family's variable copy and keeps the rule's own weight", () => {
    const out = pointAtUnhintedFonts(MONTSERRAT_600, new Set(["montserrat-latin-wght-normal.woff2"]), "@/fonts");
    expect(out).toBe(
      MONTSERRAT_600.replace("./files/montserrat-latin-600-normal.woff2", "@/fonts/montserrat-latin-wght-normal.woff2"),
    );
    // Matching stays what it was: one weight per face, never a range.
    expect(out).toContain("font-weight: 600;");
  });

  it("prefers the variable copy when a stale static copy is also present", () => {
    const both = new Set(["montserrat-latin-600-normal.woff2", "montserrat-latin-wght-normal.woff2"]);
    expect(copyFor("montserrat-latin-600-normal.woff2", both)).toBe("montserrat-latin-wght-normal.woff2");
  });

  it("names the variable copy by family and style", () => {
    expect(variableCopyName("cormorant-garamond-latin-500-italic.woff2")).toBe("cormorant-garamond-latin-wght-italic.woff2");
    expect(variableCopyName("not-a-cut.woff2")).toBeNull();
  });
});

describe("the committed unhinted copies", () => {
  const committed = fs.existsSync(FONTS) ? fs.readdirSync(FONTS).filter((f) => f.endsWith(".woff2")).sort() : [];
  const available = new Set(committed);

  it("finds the cuts main.tsx imports", () => {
    expect(importedFiles.length).toBeGreaterThan(30);
  });

  it("has a copy for every imported cut", () => {
    const missing = importedFiles.filter((name) => copyFor(name, available) === null);
    expect(missing).toEqual([]);
  });

  it("holds no copy that no imported cut uses", () => {
    const used = new Set(importedFiles.map((name) => copyFor(name, available)));
    expect(committed.filter((f) => !used.has(f))).toEqual([]);
  });

  it("serves the variable families from one file per style", () => {
    // These eight have variable builds that match their static cuts exactly
    // (scripts/unhint-fonts.py --check proves it). Kalam, Marcellus and Pinyon
    // Script have none and stay static.
    const variable = committed.filter((f) => f.includes("-latin-wght-"));
    expect(variable).toEqual([
      "caveat-latin-wght-normal.woff2",
      "cormorant-garamond-latin-wght-italic.woff2",
      "cormorant-garamond-latin-wght-normal.woff2",
      "josefin-sans-latin-wght-normal.woff2",
      "jost-latin-wght-normal.woff2",
      "montserrat-latin-wght-normal.woff2",
      "nunito-sans-latin-wght-normal.woff2",
      "playfair-display-latin-wght-normal.woff2",
      "raleway-latin-wght-normal.woff2",
    ]);
  });

  it("holds real woff2 files, each no larger than the package's own", () => {
    for (const name of committed) {
      const bytes = fs.readFileSync(path.join(FONTS, name));
      expect(bytes.subarray(0, 4).toString("latin1"), name).toBe("wOF2");
      const pkg = name.split("-latin-")[0];
      // Variable originals are fetched by scripts/unhint-fonts.py, not installed.
      const scope = name.includes("-latin-wght-") ? ".cache/fontsource-variable" : "@fontsource";
      const original = path.join(ROOT, "node_modules", scope, pkg, "files", name);
      if (fs.existsSync(original)) expect(bytes.length, name).toBeLessThanOrEqual(fs.statSync(original).size);
    }
  });
});
