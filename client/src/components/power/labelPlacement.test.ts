/**
 * Where every name on the map goes, so no name is drawn into another.
 *
 * Measured live on 2026-09-23 across nine window sizes: every real
 * name-against-name overlap had a CONTAINER's name on one side, drawn just
 * inside its top edge, and the other side changed with the window. Two pairs
 * at 1024x768, 1280x720 and 1440x700; one from 1440x800 to 1440x1000; none at
 * 1440x1200 and above. So the rule, not the names.
 *
 * A first version asked only where the PARENT's name was. The next
 * measurement gave the same collision count with different partners: a name
 * that flipped below its disc landed on the name of whichever container sat
 * under it. That is what these pin. The rule reads every name in the picture,
 * tries the positions NEAREST its own circle first, and only moves a name to a
 * place that is actually clear.
 */
import { describe, expect, it } from "vitest";
import {
  aboveTop,
  belowTop,
  boxAt,
  buildLabelPlan,
  containerTop,
  labelHalfWidth,
  overlaps,
  promotedLabelTop,
  type CirclePlacement,
  type LabelBox,
  type PlacedLabel,
  type PlanInput,
} from "./labelPlacement";

/** A child whose name does not fit inside it, near the top of its parent. */
const child: CirclePlacement = { y: 200, r: 40, lines: ["Intergenerational", "Wisdom Council"], fontSize: 20, lineHeight: 23 };

/** A holder's name, drawn just inside its top edge, right where above wants to be. */
const holderName = boxAt(140, 300, { y: 0, r: 0, lines: ["General Coordinating Circle"], fontSize: 20, lineHeight: 23 });

/** The name of a circle further down, right where below wants to be. */
const nameBelow = boxAt(belowTop(child) + 4, 300, { y: 0, r: 0, lines: ["Development Circle"], fontSize: 20, lineHeight: 23 });

describe("a name pushed outside its circle", () => {
  it("goes above the disc when above is clear", () => {
    const away = boxAt(140, -800, { y: 0, r: 0, lines: ["General Coordinating Circle"], fontSize: 20, lineHeight: 23 });
    const placed = promotedLabelTop(child, 300, [away]);
    expect(placed.below).toBe(false);
    expect(placed.top).toBe(aboveTop(child));
  });

  it("goes below the disc when above would land on a name already there", () => {
    const placed = promotedLabelTop(child, 300, [holderName]);
    expect(placed.below).toBe(true);
    expect(placed.top).toBe(belowTop(child));
    expect(overlaps(boxAt(placed.top, 300, child), holderName)).toBe(false);
  });

  it("stays above when nothing is in the way", () => {
    expect(promotedLabelTop(child, 300, [])).toEqual({ top: aboveTop(child), below: false });
  });

  /*
   * The measured failure of the parent-only rule: the name it flipped down to
   * belonged to another container, so the collision count never moved.
   */
  it("avoids a name that belongs to no relation of its own", () => {
    const placed = promotedLabelTop(child, 300, [holderName, nameBelow]);
    const box = boxAt(placed.top, 300, child);
    expect(overlaps(box, holderName, child.lineHeight * 0.25)).toBe(false);
    expect(overlaps(box, nameBelow, child.lineHeight * 0.25)).toBe(false);
  });

  it("moves exactly as far as it must, whichever way that is", () => {
    /*
     * Boxed in on both sides. The rule owns which way it goes, so this asserts
     * the promise and not the direction: it lands clear, it lands within the
     * travel limit, and one unit back toward its circle it would NOT be clear.
     * That last line is what "smallest move" means, and it is checkable
     * without doing the rule's arithmetic a second time here.
     */
    const others = [holderName, nameBelow];
    const placed = promotedLabelTop(child, 300, others);
    const gap = child.lineHeight * 0.25;
    const clear = (top: number) => !others.some((o) => overlaps(boxAt(top, 300, child), o, gap));
    expect(clear(placed.top)).toBe(true);

    const above = aboveTop(child);
    const below = belowTop(child);
    const travel = Math.min(Math.abs(placed.top - above), Math.abs(placed.top - below));
    expect(travel).toBeGreaterThan(0);
    expect(travel).toBeLessThanOrEqual(child.lineHeight * 2.5);

    // Back toward whichever natural place it started from.
    const home = Math.abs(placed.top - above) <= Math.abs(placed.top - below) ? above : below;
    expect(clear(placed.top + Math.sign(home - placed.top))).toBe(false);
  });

  it("takes the nearest clear place, so a name stays with its circle", () => {
    // Above is taken; below is free. Below is adjacent, so below wins over
    // stepping further above.
    expect(promotedLabelTop(child, 300, [holderName]).top).toBe(belowTop(child));
  });

  it("gives up and stays above rather than walking off on its own", () => {
    const everywhere: LabelBox = { x: 300, top: -2000, bottom: 2000, halfWidth: 4000 };
    const placed = promotedLabelTop(child, 300, [everywhere]);
    expect(placed.below).toBe(false);
    expect(placed.top).toBe(aboveTop(child));
  });

  it("does not move a name that only shares a row with one far to the side", () => {
    const beside = boxAt(140, 1200, { y: 0, r: 0, lines: ["General Coordinating Circle"], fontSize: 20, lineHeight: 23 });
    expect(promotedLabelTop(child, 300, [beside]).below).toBe(false);
  });
});

/** The live shape, in miniature: a big holder, and small circles inside it. */
function scene(over: Partial<PlanInput>[] = []): PlanInput[] {
  const base: PlanInput[] = [
    { id: "general", x: 0, y: 0, r: 200, depth: 0, name: "General Coordinating Circle", shown: true, hasChildren: true, forming: false },
    { id: "wisdom", x: 0, y: -150, r: 25, depth: 1, name: "Intergenerational Wisdom Council", shown: true, hasChildren: false, forming: false },
    { id: "development", x: 0, y: 20, r: 120, depth: 1, name: "Development Circle", shown: true, hasChildren: true, forming: false },
  ];
  return base.map((c, i) => ({ ...c, ...(over[i] ?? {}) }));
}

const PX_PER_WORLD = 0.6;

function boxesOf(plan: Map<string, PlacedLabel>, circles: PlanInput[]) {
  return circles
    .filter((c) => c.shown)
    .map((c) => {
      const l = plan.get(c.id)!;
      return { id: c.id, box: boxAt(l.top, c.x, { y: c.y, r: c.r, lines: l.lines, fontSize: l.fontSize, lineHeight: l.lineHeight }) };
    });
}

describe("the whole picture, placed in one pass", () => {
  it("names every circle it was given", () => {
    const circles = scene();
    const plan = buildLabelPlan(circles, PX_PER_WORLD);
    expect([...plan.keys()].sort()).toEqual(["development", "general", "wisdom"]);
  });

  /*
   * The control this file would be worthless without: if nothing in the scene
   * is promoted, every assertion below is about the easy case only.
   */
  it("has a promoted name in it at all", () => {
    const plan = buildLabelPlan(scene(), PX_PER_WORLD);
    expect(plan.get("wisdom")!.outside).toBe(true);
    expect(plan.get("general")!.outside).toBe(false);
    expect(plan.get("development")!.outside).toBe(false);
  });

  it("leaves no two names overlapping", () => {
    const circles = scene();
    const boxes = boxesOf(buildLabelPlan(circles, PX_PER_WORLD), circles);
    const hits = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => overlaps(a.box, b.box)).map((b) => `${a.id} x ${b.id}`));
    expect(hits).toEqual([]);
  });

  it("puts a holder's name inside its top edge and a leaf's across its middle", () => {
    const plan = buildLabelPlan(scene(), PX_PER_WORLD);
    const general = plan.get("general")!;
    expect(general.top).toBe(containerTop({ y: 0, r: 200, lines: general.lines, fontSize: general.fontSize, lineHeight: general.lineHeight }));
    const solo = buildLabelPlan(
      [{ id: "solo", x: 0, y: 40, r: 200, depth: 0, name: "Circle", shown: true, hasChildren: false, forming: false }],
      PX_PER_WORLD,
    ).get("solo")!;
    expect(solo.top).toBeCloseTo(40, 5);
  });

  it("does not move out of the way of a name nobody can see", () => {
    const circles = scene();
    const withHolder = buildLabelPlan(circles, PX_PER_WORLD).get("wisdom")!;
    const hidden = scene().map((c) => (c.id === "general" ? { ...c, shown: false } : c));
    const withoutHolder = buildLabelPlan(hidden, PX_PER_WORLD).get("wisdom")!;
    // The holder's name was the thing in its way, so hiding it frees above.
    expect(withHolder.top).not.toBe(withoutHolder.top);
    const shape = { y: -150, r: 25, lines: withoutHolder.lines, fontSize: withoutHolder.fontSize, lineHeight: withoutHolder.lineHeight };
    expect(withoutHolder.top).toBe(aboveTop(shape));
  });
});

describe("the geometry the rule is built on", () => {
  it("measures a label's width from its longest line", () => {
    expect(labelHalfWidth(["abc", "abcdefgh"], 20)).toBeCloseTo((8 * 20 * 0.55) / 2, 5);
    expect(labelHalfWidth([], 20)).toBe(0);
  });

  it("puts the box around the baseline, not under it", () => {
    const b = boxAt(100, 0, { y: 0, r: 0, lines: ["one", "two"], fontSize: 20, lineHeight: 23 });
    expect(b.top).toBeLessThan(100);
    expect(b.bottom).toBeGreaterThan(100 + 23);
  });

  it("calls boxes apart when they are apart, in either direction", () => {
    const a = { x: 0, top: 0, bottom: 10, halfWidth: 10 };
    expect(overlaps(a, { x: 0, top: 20, bottom: 30, halfWidth: 10 })).toBe(false);
    expect(overlaps(a, { x: 100, top: 0, bottom: 10, halfWidth: 10 })).toBe(false);
    expect(overlaps(a, { x: 5, top: 5, bottom: 15, halfWidth: 10 })).toBe(true);
  });

  it("counts a gap as part of being clear", () => {
    const a = { x: 0, top: 0, bottom: 10, halfWidth: 10 };
    const justBelow = { x: 0, top: 12, bottom: 20, halfWidth: 10 };
    expect(overlaps(a, justBelow)).toBe(false);
    expect(overlaps(a, justBelow, 5)).toBe(true);
  });
});
