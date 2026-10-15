import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTER_CARDS, cardFontStacks, type CharacterCard } from "./brandTokens";
import { FONT_CATALOG, offeringsFor } from "./fontCatalog";

/*
 * An offering is wired in three places that cannot import each other: the
 * catalogue entry here, the STACKS table inside cardFontStacks (which keeps
 * its own copy to avoid a shared import cycle), and the @fontsource CSS
 * imports in client/src/main.tsx. A miss in any one of them fails quietly.
 * A missing STACKS row resolves to the platform default, and a missing import
 * renders the fallback face while the picker still offers the font by name.
 * These tests make each miss loud.
 */

const MAIN = fs.readFileSync(path.resolve(__dirname, "../client/src/main.tsx"), "utf8");
const PKG = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

/** The @fontsource package name for a family: "Pinyon Script" -> "pinyon-script". */
const packageOf = (family: string) => family.toLowerCase().replace(/\s+/g, "-");

/** Every latin-subset CSS file main.tsx imports for one package. */
const importedCuts = (pkg: string) =>
  [...MAIN.matchAll(new RegExp(`@fontsource/${pkg}/latin-([0-9a-z-]+)\\.css`, "g"))].map((m) => m[1]).sort();

const cardWith = (fonts: [string, string, string]): CharacterCard => ({ ...CHARACTER_CARDS[0], fonts });

describe("the font catalogue", () => {
  it("gives every offering a unique id", () => {
    const ids = FONT_CATALOG.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts every offering under exactly one picker", () => {
    const total = offeringsFor("display").length + offeringsFor("body").length + offeringsFor("accent").length;
    expect(total).toBe(FONT_CATALOG.length);
  });

  it("names its own family first in every stack", () => {
    for (const f of FONT_CATALOG) expect(f.stack.startsWith(`"${f.family}"`)).toBe(true);
  });

  it("resolves every offering through cardFontStacks to its own stack", () => {
    for (const f of FONT_CATALOG) {
      if (f.role === "display") expect(cardFontStacks(cardWith([f.id, "montserrat", "kalam"])).display).toBe(f.stack);
      if (f.role === "body") expect(cardFontStacks(cardWith(["raleway", f.id, "kalam"])).body).toBe(f.stack);
      if (f.role === "accent") expect(cardFontStacks(cardWith(["raleway", "montserrat", f.id])).accent).toBe(f.stack);
    }
  });

  it("bundles every offering: a pinned dependency and at least one imported cut", () => {
    for (const f of FONT_CATALOG) {
      const pkg = packageOf(f.family);
      expect(PKG.dependencies[`@fontsource/${pkg}`], pkg).toMatch(/^\d+\.\d+\.\d+$/);
      expect(importedCuts(pkg).length, pkg).toBeGreaterThan(0);
    }
  });

  it("imports exactly the cuts the light and script faces are for", () => {
    // Jost is a light body face at 300 to 500, plus the 600 and 700 that
    // semibold buttons and labels need. Pinyon Script ships one
    // weight. Cormorant carries 300 and the 400 and 500 italics so a light
    // heading and an italic place line render in the real cuts.
    expect(importedCuts("jost")).toEqual(["300", "400", "500", "600", "700"]);
    expect(importedCuts("pinyon-script")).toEqual(["400"]);
    expect(importedCuts("cormorant-garamond")).toEqual(
      ["300", "400", "400-italic", "500", "500-italic", "600", "700"].sort(),
    );
  });

  it("tells the admin the script face is for one line", () => {
    const script = FONT_CATALOG.find((f) => f.id === "pinyon-script");
    expect(script?.role).toBe("accent");
    expect(script?.hint).toMatch(/single line or a signature, never body text/);
  });
});
