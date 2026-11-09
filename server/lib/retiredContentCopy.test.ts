/**
 * What the boot steps that retire seeded strings write into a village's
 * content document. HELD FOR RYE: both halves of this file are live-content
 * writes, so this pull request lands only on his own yes.
 *
 * Rye, 2026-11-01: "Gratitude ONLY for the recognition token and NOT for the
 * credit or earned equity tokens". `retire-blended-token-copy` used to turn
 * "Earn Hearts for contributions" into "Earn Gratitude for contributions"
 * (Gratitude as pay for work) and "Hearts Economy" into "Gratitude Economy"
 * (Gratitude as the name of the village's economy). A swap may only write a
 * string the content seed villages were born on already shipped, or one that does
 * not say Gratitude at all.
 *
 * #781 moved the step into server/lib/retiredContentCopy.ts with main's
 * strings unchanged. This branch is where the strings change, because the step
 * keeps its `runOnce` id: a village that already ran it is untouched by the new
 * values, and a village that never ran it gets them.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GRATITUDE_PAY_COPY_RETIRED, RETIRED_CONTENT_COPY, retireContentCopy } from "./retiredContentCopy";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * Every string value in the content seed villages were handed until 2026-11-05.
 * A fresh fork now ships `{}` (Rye, 2026-10-01, platform-wide: no other village's
 * story), so the seed under server/seeds holds nothing to compare against. The
 * villages this step rewrites are the ones born on the former seed, and
 * `__fixtures__/former-content-seed.json` is that file, byte for byte as main
 * last shipped it.
 */
function seededStrings(): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown) => {
    if (typeof node === "string") out.add(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(JSON.parse(fs.readFileSync(path.join(ROOT, "shared", "__fixtures__", "former-content-seed.json"), "utf8")));
  return out;
}

describe("retiring seeded strings in a content document", () => {
  it("writes exactly these on a village that never ran the step", () => {
    expect([...RETIRED_CONTENT_COPY]).toEqual([
      ["Earn Hearts for contributions", "See what each quest pays"],
      ["Learn about Hearts currency", "Learn how Gratitude and the value pool work"],
      ["Hearts Economy", "Village Economy"],
    ]);
  });

  it("swaps exact strings at any depth and leaves a person's own words alone", () => {
    const doc = {
      journeys: [{ steps: [{ detail: "Earn Hearts for contributions" }, { detail: "Earn Hearts for contributions, said our steward" }] }],
      circles: [{ focus: ["Hearts Economy"] }],
    };
    expect(retireContentCopy(doc)).toBe(true);
    expect(doc.journeys[0].steps[0].detail).toBe("See what each quest pays");
    expect(doc.journeys[0].steps[1].detail).toBe("Earn Hearts for contributions, said our steward");
    expect(doc.circles[0].focus).toEqual(["Village Economy"]);
    expect(retireContentCopy(doc), "a second pass changes nothing").toBe(false);
    // A word that is a property of every object is not a retired string either.
    expect(retireContentCopy({ note: "A line a founder wrote", word: "constructor" })).toBe(false);
  });

  it("is idempotent: no string it writes is one it would retire", () => {
    for (const to of RETIRED_CONTENT_COPY.values()) expect(RETIRED_CONTENT_COPY.has(to), to).toBe(false);
  });

  it("writes Gratitude only where the seed a village was born on already says it, word for word", () => {
    const seed = seededStrings();
    expect(seed.size).toBeGreaterThan(100);
    const offenders = [...RETIRED_CONTENT_COPY]
      .filter(([, to]) => /gratitude/i.test(to) && !seed.has(to))
      .map(([from, to]) => `"${from}" becomes "${to}"`);
    expect(offenders, "Gratitude is the recognition token's name, never pay and never the economy (Rye, 2026-11-01)").toEqual([]);
  });

  it("turns the old contribution line into the one the seed shipped", () => {
    expect(seededStrings().has(RETIRED_CONTENT_COPY.get("Earn Hearts for contributions") ?? "")).toBe(true);
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

  it("land where the first step now lands, so both kinds of village end up the same", () => {
    expect(GRATITUDE_PAY_COPY_RETIRED.get("Earn Gratitude for contributions")).toBe(RETIRED_CONTENT_COPY.get("Earn Hearts for contributions"));
    expect(GRATITUDE_PAY_COPY_RETIRED.get("Gratitude Economy")).toBe(RETIRED_CONTENT_COPY.get("Hearts Economy"));
  });
});
