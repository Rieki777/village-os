/**
 * The middle means something, and what is forming reads as a horizon
 * (2026-10-23, the village map directions).
 *
 * Two changes to the nested picture, each held to the same promise as the rest
 * of this module: a village that sets no layer and has no forming circle with
 * an empty roster gets exactly the bytes it always got. `mapLayout.test.ts` and
 * `mapLayout.shapes.test.ts` stay untouched beside this file, which is the other
 * half of that promise.
 */
import { describe, expect, it } from "vitest";
import {
  BAND_FONT,
  BAND_WIDTH,
  layoutForShape,
  layoutNestedMap,
  type NestedCircle,
  type NestedInput,
  type NestedLayout,
} from "./mapLayout";

const roles = (id: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${id}-r${i}`, vacant: i > 0 }));

const circle = (
  id: string,
  order: number,
  parentId: string | null,
  extra: Partial<NestedInput> = {},
): NestedInput => ({
  id, parentId, order, memberCount: 2, questCount: 0, name: id, roles: roles(id, 2), ...extra,
});

/** A village nested under one coordinating circle, the way the live one is:
 *  a busy circle that holds two of its own, a small lead circle, two more at
 *  work, and councils named for later. */
const VILLAGE: NestedInput[] = [
  circle("gcc", 2, null, { name: "General Coordinating Circle", roles: roles("gcc", 3) }),
  circle("lead", 1, "gcc", { name: "Leadership Circle", roles: roles("lead", 4) }),
  circle("dev", 5, "gcc", { name: "Development Circle", roles: roles("dev", 3), memberCount: 6 }),
  circle("arch", 8, "dev", { name: "Architecture Circle", status: "forming", roles: roles("arch", 1) }),
  circle("ag", 9, "dev", { name: "Regen Ag Circle", status: "forming", roles: roles("ag", 1) }),
  circle("out", 3, "gcc", { name: "Outreach & Growth Circle", roles: roles("out", 4) }),
  circle("care", 4, "gcc", { name: "Community Circle", roles: roles("care", 4) }),
  circle("perma", 1, "gcc", { name: "Permaculture Council", status: "forming", roles: [] }),
  circle("edu", 2, "gcc", { name: "Education Council", status: "forming", roles: [] }),
  circle("wisdom", 8, "gcc", { name: "Intergenerational Wisdom Council", status: "forming", roles: [] }),
];

const byId = (l: NestedLayout) => new Map(l.circles.map((c) => [c.id, c]));
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** Angle round a centre, 0 at twelve o'clock, growing clockwise. */
const clock = (c: { x: number; y: number }, p: { x: number; y: number }) => {
  const a = Math.atan2(p.x - c.x, -(p.y - c.y));
  return a < 0 ? a + 2 * Math.PI : a;
};
const withLayers = (inputs: NestedInput[], layers: Record<string, string>) =>
  inputs.map((c) => (layers[c.id] ? { ...c, layer: layers[c.id] } : c));
const noBand = (inputs: NestedInput[]) => inputs.map(({ status, ...c }) => c);

describe("absent inputs change nothing", () => {
  it("draws the same bytes with no status and no layer as with null ones", () => {
    const plain = noBand(VILLAGE);
    const nulls = plain.map((c) => ({ ...c, status: null, layer: null }));
    expect(JSON.stringify(layoutNestedMap(nulls))).toBe(JSON.stringify(layoutNestedMap(plain)));
  });

  it("adds no bands key when nothing rides a band", () => {
    expect("bands" in layoutNestedMap(noBand(VILLAGE))).toBe(false);
  });

  it("keeps active circles where they were when only status is passed", () => {
    const active = noBand(VILLAGE).map((c) => ({ ...c, status: "active" }));
    expect(JSON.stringify(layoutNestedMap(active))).toBe(JSON.stringify(layoutNestedMap(noBand(VILLAGE))));
  });
});

describe("the middle goes to the lead circle, not the biggest", () => {
  it("puts the biggest in the middle while no layer is set (today's picture)", () => {
    const l = byId(layoutNestedMap(noBand(VILLAGE)));
    expect(dist(l.get("dev")!, l.get("gcc")!)).toBeLessThan(1e-6);
  });

  it("gives the middle to a lead circle once layers are set", () => {
    const l = byId(layoutNestedMap(withLayers(noBand(VILLAGE), { lead: "lead" })));
    expect(dist(l.get("lead")!, l.get("gcc")!)).toBeLessThan(1e-6);
    expect(dist(l.get("dev")!, l.get("gcc")!)).toBeGreaterThan(l.get("lead")!.r);
  });

  it("prefers a link circle to a lead circle", () => {
    const l = byId(layoutNestedMap(withLayers(noBand(VILLAGE), { lead: "lead", care: "link" })));
    expect(dist(l.get("care")!, l.get("gcc")!)).toBeLessThan(1e-6);
  });

  it("orders the ring by layer, then by the village's own order, clockwise from twelve", () => {
    const l = byId(layoutNestedMap(withLayers(noBand(VILLAGE), { lead: "lead", out: "advisory" })));
    const gcc = l.get("gcc")!;
    // Ring: dev (operating, order 5), care (operating, order 4), out (advisory).
    // Operating comes first, ordered 4 then 5; advisory after them.
    const ring = ["care", "dev", "out"].map((id) => clock(gcc, l.get(id)!));
    expect(ring[0]).toBeLessThan(ring[1]);
    expect(ring[1]).toBeLessThan(ring[2]);
  });

  it("keeps the biggest in the middle of a layered pack with no link or lead", () => {
    const l = byId(layoutNestedMap(withLayers(noBand(VILLAGE), { out: "advisory" })));
    expect(dist(l.get("dev")!, l.get("gcc")!)).toBeLessThan(1e-6);
  });

  it("treats an unknown layer as operating", () => {
    const known = layoutNestedMap(withLayers(noBand(VILLAGE), { lead: "lead", out: "operating" }));
    const unknown = layoutNestedMap(withLayers(noBand(VILLAGE), { lead: "lead", out: "someday" }));
    expect(JSON.stringify(unknown.circles.map(({ x, y }) => [x, y]))).toBe(
      JSON.stringify(known.circles.map(({ x, y }) => [x, y])),
    );
  });

  it("is the same middle rule in every shape that packs children", () => {
    const input = withLayers(noBand(VILLAGE), { lead: "lead" });
    for (const shape of ["circle", "council", "flat", "steward", "network"]) {
      const l = byId(layoutForShape(shape, input, []));
      expect(dist(l.get("lead")!, l.get("gcc")!), shape).toBeLessThan(1e-6);
    }
  });
});

describe("a circle holding two", () => {
  it("sits them side by side, a gap apart, in the smallest circle that holds both", () => {
    const l = byId(layoutNestedMap([
      circle("dev", 1, null, { roles: roles("dev", 3) }),
      circle("arch", 2, "dev", { name: "Architecture Circle" }),
      circle("ag", 3, "dev", { name: "Regen Ag Circle" }),
    ]));
    const [dev, arch, ag] = ["dev", "arch", "ag"].map((id) => l.get(id)!);
    expect(arch.y).toBeCloseTo(dev.y, 6);
    expect(ag.y).toBeCloseTo(dev.y, 6);
    expect(arch.x).toBeLessThan(ag.x);
    expect(dist(arch, ag) - arch.r - ag.r).toBeCloseTo(14, 6);
    // Both touch the same enclosing circle, so neither side has spare room.
    const outer = (arch.r + ag.r + 14 / 2);
    expect(dist(arch, dev) + arch.r).toBeCloseTo(outer, 6);
    expect(dist(ag, dev) + ag.r).toBeCloseTo(outer, 6);
    // The holder is sized to that, plus its own role ring.
    expect(dev.r).toBeCloseTo(Math.max(outer + 20 + 11 + 10, 0), 6);
  });

  it("puts a lead circle first, on the left, once layers are set", () => {
    const l = byId(layoutNestedMap([
      circle("dev", 1, null),
      circle("big", 2, "dev", { roles: roles("big", 6) }),
      circle("lead", 3, "dev", { layer: "lead" }),
    ]));
    expect(l.get("lead")!.x).toBeLessThan(l.get("big")!.x);
  });
});

describe("the forming band", () => {
  const layout = layoutNestedMap(VILLAGE);
  const l = byId(layout);
  const gcc = l.get("gcc")!;
  const riders = ["perma", "edu", "wisdom"];
  const band = layout.bands?.find((b) => b.containerId === "gcc");

  it("puts every forming circle with no roles and nothing inside on its container's band", () => {
    expect(band).toBeDefined();
    expect(band!.members).toEqual(["perma", "edu", "wisdom"]);
    for (const id of riders) expect(l.get(id)!.band?.containerId, id).toBe("gcc");
  });

  it("keeps a forming circle that has roles in the pack, as a circle", () => {
    for (const id of ["arch", "ag"]) expect(l.get(id)!.band, id).toBeUndefined();
    expect(layout.bands?.some((b) => b.containerId === "dev") ?? false).toBe(false);
  });

  it("draws the band outside every circle in the pack and inside the container's role ring", () => {
    const packed = layout.circles.filter((c) => !c.band && c.id !== "gcc" && c.depth === gcc.depth + 1);
    for (const c of packed) {
      expect(dist(c, gcc) + c.r, c.id).toBeLessThanOrEqual(band!.inner + 1e-6);
    }
    // The container's own roles ride its ring 20 in from the rim, 11 across.
    expect(band!.outer).toBeLessThanOrEqual(gcc.r - 20 - 11);
    expect(band!.outer - band!.inner).toBe(BAND_WIDTH);
  });

  it("gives each rider its own arc, in order, clear of the crown and of each other", () => {
    const arcs = riders.map((id) => l.get(id)!.band!);
    const top = -Math.PI / 2;
    expect(arcs[0].a0).toBeGreaterThanOrEqual(top + band!.crown - 1e-9);
    expect(arcs[arcs.length - 1].a1).toBeLessThanOrEqual(top + 2 * Math.PI - band!.crown + 1e-9);
    for (let i = 0; i < arcs.length; i++) {
      expect(arcs[i].a1).toBeGreaterThan(arcs[i].a0);
      if (i) expect(arcs[i].a0).toBeGreaterThan(arcs[i - 1].a1);
    }
  });

  it("makes every arc long enough for its name", () => {
    const mid = (band!.inner + band!.outer) / 2;
    for (const id of riders) {
      const c = l.get(id)!;
      const name = VILLAGE.find((v) => v.id === id)!.name!;
      expect((c.band!.a1 - c.band!.a0) * mid, id).toBeGreaterThanOrEqual(name.length * BAND_FONT * 0.55);
    }
  });

  it("puts each rider's centre in the middle of its arc, inside its container", () => {
    const mid = (band!.inner + band!.outer) / 2;
    for (const id of riders) {
      const c = l.get(id)!;
      expect(dist(c, gcc), id).toBeCloseTo(mid, 6);
      expect(dist(c, gcc) + c.r, id).toBeLessThanOrEqual(gcc.r);
      expect(c.depth).toBe(gcc.depth + 1);
    }
  });

  it("leaves the crown wide enough for the container's name", () => {
    // 27 characters at the root size, measured at the band's outer edge.
    const half = (27 * 17 * 0.55) / 2;
    expect(Math.sin(band!.crown) * band!.outer).toBeGreaterThanOrEqual(half);
  });

  it("still keeps the container's seats off its name", () => {
    const nearest = Math.min(...gcc.roles.map((s) => {
      const a = clock(gcc, s);
      return Math.min(a, 2 * Math.PI - a);
    }));
    expect(nearest).toBeCloseTo(Math.PI / gcc.roles.length, 6);
  });

  it("puts top-level riders on a band inside the village ring", () => {
    const flat = [
      circle("a", 1, null),
      circle("b", 2, null),
      circle("later", 3, null, { name: "Later Council", status: "forming", roles: [] }),
    ];
    const v = layoutNestedMap(flat);
    const vb = v.bands?.find((b) => b.containerId === null);
    expect(vb?.members).toEqual(["later"]);
    expect(vb!.outer).toBeLessThan(v.village.r);
    const later = byId(v).get("later")!;
    expect(dist(later, v.village)).toBeCloseTo((vb!.inner + vb!.outer) / 2, 6);
  });

  it("draws nothing outside the canvas", () => {
    const pts = layout.circles.flatMap((c: NestedCircle) => [
      [c.x - c.r, c.y - c.r],
      [c.x + c.r, c.y + c.r],
    ]);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(layout.width);
      expect(y).toBeLessThanOrEqual(layout.height);
    }
  });

  it("is deterministic", () => {
    expect(JSON.stringify(layoutNestedMap(VILLAGE))).toBe(JSON.stringify(layoutNestedMap([...VILLAGE].reverse())));
  });

  it("belongs to the circle picture only; other shapes draw riders as circles", () => {
    for (const shape of ["pyramid", "council", "flat", "steward", "network"]) {
      const s = layoutForShape(shape, VILLAGE, []);
      expect(s.bands, shape).toBeUndefined();
      expect(s.circles.find((c) => c.id === "perma")!.band, shape).toBeUndefined();
    }
  });

  it("shifts the band with the rest of the picture when padded", () => {
    const padded = layoutForShape("circle", VILLAGE, [], 50);
    const b = padded.bands!.find((x) => x.containerId === "gcc")!;
    expect(b.x).toBe(band!.x + 50);
    expect(b.y).toBe(band!.y + 50);
    expect(b.inner).toBe(band!.inner);
  });
});
