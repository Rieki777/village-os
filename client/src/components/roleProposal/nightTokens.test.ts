/**
 * The proposal steps sit on the night sheet. A light-page colour
 * (`text-stone-900`, `bg-white`) stays dark on that ground, which is how the
 * headings went missing. This reads the step sources and refuses those classes.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const LIGHT_ONLY = /\b(?:text|bg|border|from|to)-stone-|\b(?:text|bg|border)-gray-|\bbg-white\b/;

describe("role proposal steps use the night sheet's tokens", () => {
  const files = readdirSync(here).filter((n) => n.endsWith(".tsx") && !n.includes(".test."));
  it("covers the step files", () => {
    expect(files.length).toBeGreaterThan(8);
  });
  it.each(files)("%s has no light-only colour class", (name) => {
    const text = readFileSync(join(here, name), "utf8");
    expect(text.match(LIGHT_ONLY)).toBeNull();
  });
});
