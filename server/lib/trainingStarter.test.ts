/**
 * The starter training list describes practices and never claims them.
 *
 * Two descriptions used to read "the foundation of how we talk to each other
 * at <village>" and "how <village> makes decisions together", with the new
 * village's own name filled in, so a village that had chosen nothing yet told
 * its members it already talks in NVC and decides by consent. The fork-level
 * check lives in server/forkPublish.e2e.test.ts; this one needs no database and
 * no build, so it is the fast half.
 */
import { describe, expect, it } from "vitest";
import { starterTrainingModules } from "./trainingStarter";

describe("the starter training list", () => {
  const village = "Willowmere Commons";
  const modules = starterTrainingModules(village);

  it("still offers the four starter practices, each one required as before", () => {
    expect(modules.map((m) => m.id)).toEqual([
      "nvc-intro",
      "authentic-relating",
      "consent-decisions",
      "circle-facilitation",
    ]);
    // The header explains why every row must carry the key: a dbCollection
    // insert that omits it writes 0, and the Participant rung opens on nothing.
    expect(modules.every((m) => m.mandatory === true)).toBe(true);
  });

  it("never names the village it is seeded into", () => {
    for (const m of modules) {
      expect(m.description, `${m.id} must describe the practice, not claim it for the village`).not.toContain(village);
    }
  });

  it("never speaks for the village in the first person plural", () => {
    for (const m of modules) {
      expect(m.description, `${m.id} must not say what "we" do`).not.toMatch(/\b(we|our|us)\b/i);
    }
  });
});
