/**
 * Two inks that stay dark on the night sheet, read off the stylesheet the
 * page actually ships. Coral is the error colour. Primary is the pay chip.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");
const sheet = css.slice(css.indexOf(".sheet-night {"), css.indexOf(".sheet-night :is(h1"));

describe("the night sheet keeps error and pay text readable", () => {
  it("points coral at the sheet's warn ink", () => {
    expect(sheet).toContain("--color-coral: var(--sheet-warn, #e0805e);");
  });

  it("draws text-primary in the sheet's own foreground", () => {
    expect(css).toContain(".sheet-night .text-primary");
    expect(css).toMatch(/\.sheet-night \.text-primary\s*\{\s*color:\s*var\(--foreground\);/);
  });
});
