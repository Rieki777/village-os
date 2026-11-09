/**
 * THE NIGHT PALETTE FOLLOWS THE VILLAGE (Rye, 2026-11-09: "The coloring on the
 * role draft card should match the same color scheme on the site and pull from
 * the same color palette being delivered by the admin section").
 *
 * The role card (`.pc-night`, playerCard.css), the owner's character sheet
 * (`.sheet-night`, index.css) and Admin's Night look all read the `--sheet-*`
 * layer. index.css has documented that layer as the village's knob since the
 * sheet shipped, and nothing wrote it, so every village's card was the same
 * forest and gold whatever its Admin Look said. deriveTheme now writes it.
 */
import { describe, expect, it } from "vitest";
import { CHARACTER_CARDS, contrastRatio, deriveTheme, hexToHsl } from "./brandTokens";

const NIGHT_KEYS = [
  "--sheet-ground",
  "--sheet-panel",
  "--sheet-panel-raised",
  "--sheet-line",
  "--sheet-edge",
  "--sheet-ink",
  "--sheet-ink-dim",
  "--sheet-earned",
  "--sheet-earned-highlight",
  "--sheet-earned-shadow",
] as const;

// The approved design (playerCard.css, index.css .sheet-night): the values an
// unseeded village keeps, and the ones a forest village's own palette must stay close to.
const APPROVED: Record<string, string> = {
  "--sheet-ground": "#0d1411",
  "--sheet-panel": "#16221c",
  "--sheet-panel-raised": "#1c2b23",
  "--sheet-line": "#2b3b32",
  "--sheet-edge": "#6d8175",
  "--sheet-ink": "#e9efe6",
  "--sheet-ink-dim": "#9cb0a3",
  "--sheet-earned": "#dfab4d",
  "--sheet-earned-highlight": "#f2ce85",
  "--sheet-earned-shadow": "#6b4a15",
};

const SEEDS = ["#16342a", "#157f7d", "#1d4ed8", "#b91c1c", "#7c3aed", "#ca8a04", "#f472b6", "#000000", "#ffffff", "#808080", "#22c55e", "#0ea5e9"];
const ACCENTS = [undefined, "#e0c79a", "#ff0000", "#0000ff", "#ffffff"];

describe("deriveTheme writes the night layer", () => {
  it("emits nothing for an unseeded village, so the approved design stands", () => {
    expect(deriveTheme("", null)).toBeNull();
  });

  it("emits every --sheet-* knob for a seeded village", () => {
    const vars = deriveTheme("#16342a", null, "#e0c79a")!.vars;
    for (const k of NIGHT_KEYS) expect(vars[k], k).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("carries the seed's hue into the ground, so a blue village has a blue night", () => {
    const blue = hexToHsl(deriveTheme("#1d4ed8", null)!.vars["--sheet-ground"])!;
    const red = hexToHsl(deriveTheme("#b91c1c", null)!.vars["--sheet-ground"])!;
    expect(Math.abs(blue.h - 221)).toBeLessThan(12);
    expect(red.h < 12 || red.h > 348).toBe(true);
  });

  it("carries the village's accent into the gold", () => {
    const pinned = hexToHsl(deriveTheme("#16342a", null, "#0000ff")!.vars["--sheet-earned"])!;
    expect(Math.abs(pinned.h - 240)).toBeLessThan(6);
  });

  it("keeps a forest village's card within a few shades of the approved design", () => {
    const vars = deriveTheme("#16342a", null, "#e0c79a")!.vars;
    for (const k of NIGHT_KEYS) {
      // A ratio near 1 between derived and approved is the same colour to the eye.
      expect(contrastRatio(vars[k], APPROVED[k]), `${k} ${vars[k]} vs ${APPROVED[k]}`).toBeLessThan(1.25);
    }
  });

  describe("clears every floor the approved design cleared, for every seed, card and accent", () => {
    for (const seed of SEEDS) {
      for (const card of CHARACTER_CARDS) {
        for (const accent of ACCENTS) {
          it(`${seed} ${card.id} ${accent ?? "rotated"}`, () => {
            const v = deriveTheme(seed, card.id, accent)!.vars;
            const grounds = [v["--sheet-ground"], v["--sheet-panel"], v["--sheet-panel-raised"]];
            for (const g of grounds) {
              expect(contrastRatio(v["--sheet-ink"], g)).toBeGreaterThanOrEqual(7);
              expect(contrastRatio(v["--sheet-ink-dim"], g)).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(v["--sheet-earned"], g)).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(v["--sheet-earned-highlight"], g)).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio("#e0805e", g)).toBeGreaterThanOrEqual(4.5); // the fixed warn ink
              expect(contrastRatio("#6fc48f", g)).toBeGreaterThanOrEqual(4.5); // the fixed living ink
            }
            expect(contrastRatio(v["--sheet-edge"], v["--sheet-panel"])).toBeGreaterThanOrEqual(3);
            expect(contrastRatio(v["--sheet-edge"], v["--sheet-panel-raised"])).toBeGreaterThanOrEqual(3);
            // The ground carries ground-coloured text on the gold and on the warn (a pressed chip).
            expect(contrastRatio(v["--sheet-ground"], v["--sheet-earned"])).toBeGreaterThanOrEqual(4.5);
          });
        }
      }
    }
  });

  it("reports the night pairs in the contrast report the Look panel shows", () => {
    const names = deriveTheme("#16342a", null)!.contrast.pairs.map((p) => p.name);
    expect(names).toContain("night ink-dim on night raised");
    expect(names).toContain("night gold on night raised");
  });
});
