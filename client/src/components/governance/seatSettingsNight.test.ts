/**
 * The terms editor sits on the role proposal's night sheet. A light-page
 * colour (a white card, a stone ink) stays dark on that ground, which is how
 * a group heading disappeared. These two files are the editor the terms step
 * draws, and they have to use the sheet's own tokens.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const LIGHT_ONLY = /\b(?:text|bg|border|from|to|ring|hover:bg|hover:border)-stone-|\bbg-white\b|\btext-white\b|\bbg-amber-\d+\b/;

describe("the terms editor uses the night sheet's tokens", () => {
  it.each(["SeatSettingsEditor.tsx", "SeatSettingsFields.tsx"])("%s has no light-only colour class", (name) => {
    const text = readFileSync(join(here, name), "utf8");
    expect(text.match(LIGHT_ONLY)).toBeNull();
  });
});
