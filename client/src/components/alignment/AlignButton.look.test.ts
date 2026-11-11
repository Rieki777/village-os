import { describe, expect, it } from "vitest";
import * as look from "@/components/journey/look";
import { ALIGN_LOOK } from "./AlignButton";

// AlignButton keeps its own copy of four look.ts strings so it does not import
// look.ts (see the note in AlignButton.tsx: the import reshaped the boot chunk).
// This holds the copy equal to the rule, so the look cannot drift.
describe("AlignButton's copy of the sheet's look", () => {
  for (const key of Object.keys(ALIGN_LOOK) as Array<keyof typeof ALIGN_LOOK>) {
    it(`${key} matches components/journey/look.ts`, () => {
      expect(ALIGN_LOOK[key]).toBe(look[key]);
    });
  }
});
