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
import { RETIRED_CONTENT_COPY, retireContentCopy } from "./retiredContentCopy";

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
