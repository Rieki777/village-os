/**
 * What the boot step `retire-blended-token-copy` writes into a village's
 * content document when it finds a string this platform once seeded there.
 *
 * Rye, 2026-11-01: "Gratitude ONLY for the recognition token and NOT for the
 * credit or earned equity tokens". The step used to turn "Earn Hearts for
 * contributions" into "Earn Gratitude for contributions" (Gratitude as pay for
 * work) and "Hearts Economy" into "Gratitude Economy" (Gratitude as the name
 * of the village's economy). A swap may only write a string a fresh village's
 * own content seed already ships, or one that does not say Gratitude at all.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RETIRED_CONTENT_COPY, retireContentCopy } from "./retiredContentCopy";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Every string value in the content seed a fresh village is born with. */
function seededStrings(): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown) => {
    if (typeof node === "string") out.add(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(JSON.parse(fs.readFileSync(path.join(ROOT, "server", "seeds", "content-seed.json"), "utf8")));
  return out;
}

describe("retiring seeded strings in a content document", () => {
  it("swaps exact strings at any depth and leaves a person's own words alone", () => {
    const doc = {
      resident: { journeySteps: [{ details: ["Earn Hearts for contributions", "Earn Hearts for contributions, and more"] }] },
      circles: [{ focus: ["Hearts Economy"] }],
    };
    expect(retireContentCopy(doc)).toBe(true);
    expect(doc.resident.journeySteps[0].details).toEqual([
      RETIRED_CONTENT_COPY.get("Earn Hearts for contributions"),
      "Earn Hearts for contributions, and more",
    ]);
    expect(doc.circles[0].focus).toEqual([RETIRED_CONTENT_COPY.get("Hearts Economy")]);
    // A word that is a property of every object is not a retired string either.
    expect(retireContentCopy({ note: "A line a founder wrote", word: "constructor" })).toBe(false);
  });

  it("is idempotent: no string it writes is one it would retire", () => {
    for (const to of RETIRED_CONTENT_COPY.values()) expect(RETIRED_CONTENT_COPY.has(to), to).toBe(false);
  });

  it("writes Gratitude only where a fresh village's own seed already says it, word for word", () => {
    const seed = seededStrings();
    expect(seed.size).toBeGreaterThan(100);
    const offenders = [...RETIRED_CONTENT_COPY]
      .filter(([, to]) => /gratitude/i.test(to) && !seed.has(to))
      .map(([from, to]) => `"${from}" becomes "${to}"`);
    expect(offenders, "Gratitude is the recognition token's name, never pay and never the economy (Rye, 2026-11-01)").toEqual([]);
  });

  it("turns the old contribution line into the one a fresh village ships", () => {
    expect(RETIRED_CONTENT_COPY.get("Earn Hearts for contributions")).toBe("See what each quest pays");
    expect(seededStrings().has("See what each quest pays")).toBe(true);
  });
});
