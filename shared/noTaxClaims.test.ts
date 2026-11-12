/**
 * NO TAX CLAIMS IN THE PLATFORM'S OWN WORDS (J1, the lead, 12 Nov 2026): the
 * membership letter's fallback advice once asked whether a contribution was
 * tax-deductible. The platform makes no such claim; a village's own words, in
 * its own brand overlay, are its own (the first village's seeded letter keeps
 * its wording, because changing it would change every member's letter version).
 * This reads the code, comments aside (batch 158 control for J1).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const FILES = ["client/src/pages/LoveLetter.tsx"];

describe("no tax claims", () => {
  for (const f of FILES) {
    it(`${f} says nothing is tax-deductible`, () => {
      const code = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
      expect(code.join("\n")).not.toMatch(/tax[- ]deductible/i);
    });
  }
});
