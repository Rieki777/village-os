/**
 * The boot step `retire-blended-token-copy`'s swaps, moved out of
 * server/index.ts into server/lib/retiredContentCopy.ts UNCHANGED.
 *
 * A PURE MOVE, AND THIS FILE IS WHAT SAYS SO. The step already exists and has
 * already run on most villages under the same `runOnce` id, so changing what it
 * writes would be a write to live content arriving through a step that looks
 * old (the integrator's catch, 2026-11-05). The destination strings are pinned
 * here to main's, character for character. Changing them is a ruling for Rye,
 * held in its own pull request.
 */
import { describe, expect, it } from "vitest";
import { GRATITUDE_PAY_COPY_RETIRED, RETIRED_CONTENT_COPY, retireContentCopy } from "./retiredContentCopy";

describe("retiring seeded strings in a content document", () => {
  it("writes exactly what main wrote, so moving the step changes no village", () => {
    expect([...RETIRED_CONTENT_COPY]).toEqual([
      ["Earn Hearts for contributions", "Earn Gratitude for contributions"],
      ["Learn about Hearts currency", "Learn how Gratitude and the value pool work"],
      ["Hearts Economy", "Gratitude Economy"],
    ]);
  });

  it("swaps exact strings at any depth and leaves a person's own words alone", () => {
    const doc = {
      journeys: [{ steps: [{ detail: "Earn Hearts for contributions" }, { detail: "Earn Hearts for contributions, said our steward" }] }],
      circles: [{ focus: ["Hearts Economy"] }],
    };
    expect(retireContentCopy(doc)).toBe(true);
    expect(doc.journeys[0].steps[0].detail).toBe("Earn Gratitude for contributions");
    expect(doc.journeys[0].steps[1].detail).toBe("Earn Hearts for contributions, said our steward");
    expect(doc.circles[0].focus).toEqual(["Gratitude Economy"]);
    expect(retireContentCopy(doc), "a second pass changes nothing").toBe(false);
  });
});

/*
 * THE LINES AN EARLIER BOOT ALREADY WROTE. `retire-blended-token-copy` ran once
 * on every live village and left "Earn Gratitude for contributions" and
 * "Gratitude Economy" in its content document. A second once-only step
 * (server/index.ts, `retire-gratitude-pay-copy-2026-11-01`) swaps exactly
 * those strings and nothing a person wrote around them.
 */
describe("the Gratitude-as-pay lines already in live content", () => {
  it("are swapped character for character, and a person's own sentence is left alone", () => {
    const doc = {
      steps: ["Earn Gratitude for contributions", "Earn Gratitude for contributions, said our steward"],
      focus: "Gratitude Economy",
      notes: "Gratitude Economy notes",
    };
    expect(retireContentCopy(doc, GRATITUDE_PAY_COPY_RETIRED)).toBe(true);
    expect(doc).toEqual({
      steps: ["See what each quest pays", "Earn Gratitude for contributions, said our steward"],
      focus: "Village Economy",
      notes: "Gratitude Economy notes",
    });
  });

  it("never write Gratitude back in", () => {
    for (const to of GRATITUDE_PAY_COPY_RETIRED.values()) expect(to).not.toMatch(/gratitude/i);
  });
});
