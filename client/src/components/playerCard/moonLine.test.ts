/**
 * The moon line under "This month's tasks" ("October Moon, 10 Oct to 9 Nov")
 * lost the bottom of its letters at phone width. The rule that draws it has
 * to leave room under the baseline.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "playerCard.css"), "utf8");
const rule = css.slice(css.indexOf(".pc-f13 {"), css.indexOf(".pc-f12 {"));

describe("the moon line keeps its descenders", () => {
  it("gives the 13px line room under the baseline", () => {
    expect(rule).toMatch(/line-height:\s*1\.5/);
    expect(rule).toMatch(/padding-bottom:\s*0\.2em/);
    expect(rule).toMatch(/overflow:\s*visible/);
  });
});
