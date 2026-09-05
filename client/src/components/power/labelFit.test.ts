/**
 * THE SIX-PIXEL LABEL, REPRODUCED AND THEN CLOSED.
 *
 * These numbers are not invented. They were measured on the live page at
 * amora.regencivics.earth/map/circles on 2026-09-04, at a 1280x720 viewport:
 *
 *   the SVG box            864 x 533 CSS px
 *   the viewBox            1045 x 1045 (square, because a packing is a disc)
 *   preserveAspectRatio    xMidYMid meet, so it fits to the SMALLER side
 *   the resulting scale    0.51
 *   a "forming" caption    6.0 px tall
 *   unused width           331 px, 38% of the canvas
 *
 * So this suite drives the REAL layout and the REAL wrapper at those exact
 * dimensions. It fails if the geometry regresses, and it says which of the
 * three parts moved: the scale, the crop, or the floor.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { layoutNestedMap, wrapLabel, type NestedInput } from "@shared/mapLayout";
import { viewFor, viewBoxFor, type CameraView } from "./camera";
import { fitLabelToScreen, captionSize, MIN_LABEL_PX } from "./labelFit";

/** The measured desktop stage, before the height change. */
const BOX_OLD = { w: 864, h: 533 };
/** A common handset. The map drew NOTHING here before this round. */
const BOX_PHONE = { w: 375, h: 375 };

/** Amora's own circles, the seventeen on the live page. */
const NAMES = [
  "Leadership Circle", "Permaculture Council", "Education Council",
  "General Coordinating Circle", "Culture & Arts Council", "Outreach & Growth Circle",
  "Community Circle", "Health & Healing Council", "Building & Village Council",
  "Development Circle", "Business & Finance Council", "Finance & Business Circle",
  "Advisory Bodies", "Community Life Council", "Architecture Circle",
  "Intergenerational Wisdom Council", "Regenerative Agriculture & Permaculture Circle",
];

const inputs: NestedInput[] = NAMES.map((name, i) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  name,
  parentId: null,
  order: i,
  memberCount: 2,
  questCount: 0,
  roles: [
    { id: `${i}-a`, vacant: false },
    { id: `${i}-b`, vacant: true },
  ],
}));

const layout = layoutNestedMap(inputs);
const rootView: CameraView = viewFor({
  id: null,
  cx: layout.village.x,
  cy: layout.village.y,
  r: layout.village.r,
});

/** The component's own arithmetic, kept in one place so the test drives the
 *  same thing the render does. */
function frame(box: { w: number; h: number }, view: CameraView) {
  const aspect = box.h / box.w;
  const fitted: CameraView = aspect < 1 ? [view[0], view[1], view[2] / aspect] : view;
  return { aspect, fitted, pxPerWorld: box.w / fitted[2] };
}

describe("the geometry that made everything half size", () => {
  it("reproduces the measured 0.51 scale from the square viewBox", () => {
    // The OLD behaviour: viewBox aspect 1, fitted with `meet`, so the
    // limiting side is the height.
    const oldScale = Math.min(BOX_OLD.w / rootView[2], BOX_OLD.h / rootView[2]);
    expect(oldScale).toBeCloseTo(BOX_OLD.h / rootView[2], 5);
    expect(oldScale).toBeLessThan(0.6);
  });

  it("does not crop the village ring once the viewBox takes the box aspect", () => {
    // The regression this guards: an aspect-aware viewBox with an unchanged
    // view WIDTH asks for a region shorter than it is wide, and the top and
    // bottom of the ring fall outside the picture.
    const { aspect, fitted } = frame(BOX_OLD, rootView);
    const vb = viewBoxFor(fitted, aspect).split(" ").map(Number);
    const [x, y, w, h] = vb as [number, number, number, number];
    const v = layout.village;
    expect(x, "left edge clears the ring").toBeLessThanOrEqual(v.x - v.r);
    expect(x + w, "right edge clears the ring").toBeGreaterThanOrEqual(v.x + v.r);
    expect(y, "TOP clears the ring").toBeLessThanOrEqual(v.y - v.r);
    expect(y + h, "BOTTOM clears the ring").toBeGreaterThanOrEqual(v.y + v.r);
  });

  it("opens real world space beside the disc, which is where long names go", () => {
    const { fitted } = frame(BOX_OLD, rootView);
    const gutter = fitted[2] - 2 * layout.village.r;
    // The 331 measured pixels, in world units, on both sides together.
    expect(gutter, "there is addressable space beside the disc").toBeGreaterThan(100);
  });
});

describe("the label floor, at the sizes a reader actually gets", () => {
  const { pxPerWorld } = frame(BOX_OLD, rootView);

  it("reproduces the six-pixel caption the old floor allowed", () => {
    // wrapLabel floors at 9 WORLD units. That is the number that measured 6px.
    const smallest = 9 * pxPerWorld;
    expect(smallest).toBeLessThan(7);
  });

  it("brings every circle name to the screen floor or moves it out", () => {
    for (const pos of layout.circles) {
      const name = NAMES.find((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-") === pos.id) ?? pos.id;
      const wrapped = wrapLabel(name, pos.r, pos.depth);
      const fit = fitLabelToScreen(wrapped, pos.r, pxPerWorld);
      const onScreen = fit.fontSize * pxPerWorld;
      expect(
        onScreen,
        `"${name}" renders at ${onScreen.toFixed(1)}px (outside=${fit.outside})`,
      ).toBeGreaterThanOrEqual(MIN_LABEL_PX - 0.5);
    }
  });

  it("lifts the forming caption off its world-unit floor too", () => {
    const pos = layout.circles[0]!;
    const wrapped = wrapLabel("Permaculture Council", pos.r, pos.depth);
    const fit = fitLabelToScreen(wrapped, pos.r, pxPerWorld);
    const px = captionSize(fit.fontSize, pxPerWorld) * pxPerWorld;
    expect(px).toBeGreaterThanOrEqual(MIN_LABEL_PX - 2);
  });

  it("never grows a label wider than the circle can hold", () => {
    // The cap that stops a rescued label running out over its neighbours.
    for (const pos of layout.circles) {
      const wrapped = wrapLabel("Regenerative Agriculture & Permaculture Circle", pos.r, pos.depth);
      const fit = fitLabelToScreen(wrapped, pos.r, pxPerWorld);
      if (fit.outside) continue; // moved out; the chord no longer applies
      const widest = Math.max(...wrapped.lines.map((l) => l.length));
      const drawnWidth = widest * fit.fontSize * 0.55;
      expect(drawnWidth, `fits inside r=${pos.r.toFixed(0)}`).toBeLessThanOrEqual(pos.r * 1.75);
    }
  });

  it("leaves an already-legible label exactly as the layout sized it", () => {
    const wrapped = { lines: ["Land"], fontSize: 40, lineHeight: 46 };
    const fit = fitLabelToScreen(wrapped, 200, 1);
    expect(fit.fontSize).toBe(40);
    expect(fit.outside).toBe(false);
  });

  it("draws what the layout asked for before the first measurement lands", () => {
    const wrapped = { lines: ["Land"], fontSize: 12, lineHeight: 14 };
    expect(fitLabelToScreen(wrapped, 100, 0).fontSize).toBe(12);
    expect(fitLabelToScreen(wrapped, 100, 0).outside).toBe(false);
  });
});

/**
 * THE WIRING, WHICH IS WHERE THIS ACTUALLY BROKE.
 *
 * Every assertion above passed while the floor did nothing in production.
 * `fitLabelToScreen` was correct; the component never handed it a real
 * `pxPerWorld`, because the SVG's ref was an inline arrow. React treats a
 * ref callback with a new identity as a different ref, so on every render it
 * detached the old one and attached the new one, the element state thrashed,
 * the ResizeObserver was rebuilt each time, and `box` stayed {0,0}.
 *
 * Measured live at build b865a34: pxPerWorld 0, every label at its raw
 * wrapLabel size, the "forming" caption at its 9-unit fallback. A pure
 * function with a green suite, doing nothing.
 *
 * There is no jsdom in this repo, so this is a source check. It guards the
 * two properties the live defect turned on.
 */
describe("the component actually feeds the floor a measurement", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "PowerMap.tsx"), "utf8");

  it("finds the file and its ref (the positive control)", () => {
    expect(src).toContain("useMeasuredBox");
    expect(src).toMatch(/ref=\{/);
  });

  it("attaches the SVG through a STABLE ref, never an inline arrow", () => {
    // `ref={(el) => {...}}` is the defect. A named useCallback is the fix.
    expect(src, "the svg ref is not an inline arrow").not.toMatch(/ref=\{\s*\(el\)\s*=>/);
    expect(src).toMatch(/const\s+attachSvg\s*=\s*useCallback\(/);
    expect(src).toMatch(/ref=\{attachSvg\}/);
  });

  it("refuses a zero measurement instead of dividing by it", () => {
    // Two PowerMaps mount on this page and CSS hides one. The hidden one
    // measures 0x0; taking that as the box zeroes pxPerWorld and hands every
    // label back unchanged, which is the bug wearing a different hat.
    expect(src).toMatch(/if\s*\(next\.w\s*<=\s*0\s*\|\|\s*next\.h\s*<=\s*0\)\s*return;/);
  });
});

describe("a phone, which used to get no map at all", () => {
  const { pxPerWorld, aspect, fitted } = frame(BOX_PHONE, rootView);

  it("is square, so nothing is widened and nothing is cropped", () => {
    expect(aspect).toBe(1);
    expect(fitted[2]).toBe(rootView[2]);
  });

  it("still clears the floor on a 375px handset", () => {
    for (const pos of layout.circles) {
      const name = NAMES.find((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-") === pos.id) ?? pos.id;
      const fit = fitLabelToScreen(wrapLabel(name, pos.r, pos.depth), pos.r, pxPerWorld);
      expect(fit.fontSize * pxPerWorld, `"${name}" on a phone`).toBeGreaterThanOrEqual(MIN_LABEL_PX - 0.5);
    }
  });
});
