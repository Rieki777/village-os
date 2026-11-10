import { describe, expect, it } from "vitest";
import { formatLatLon, landPlan, smoothPath } from "./landPlan";

const SCENE = {
  map_scene: { georef: { pin: [9.2320128, -83.8343203] } },
  boundary: { scene_units: [[100, 100], [300, 100], [300, 300], [100, 300]] },
  map_zones: [
    { kind: "road", geom: "line", subtype: "paved", phase: 1, path: [[100, 200], [300, 200]] },
    { kind: "road", geom: "line", subtype: "improved", phase: 2, path: [[200, 100], [200, 300]] },
    { kind: "water", geom: "line", path: [[120, 120], [180, 160], [260, 280]] },
    { kind: "water", geom: "area", phase: "1", polygon: [[150, 150], [160, 150], [160, 160]] },
    { kind: "zone", geom: "area", phase: "2", polygon: [[200, 200], [240, 200], [240, 240]] },
    { kind: "forest", geom: "area", polygon: "default ground" },
  ],
  map_structures: [
    { key: "gate", anchor: { x: 110, y: 110 }, phase: 1 },
    { key: "later", anchor: { x: 250, y: 250 }, phase: 3 },
    { key: "nowhere", anchor: null },
  ],
};

describe("landPlan", () => {
  it("draws only what the published scene holds", () => {
    const p = landPlan(SCENE)!;
    expect(p.boundary).toMatch(/^M100,100C.*Z$/);
    expect(p.roads).toHaveLength(2);
    expect(p.roads.map((r) => [r.paved, r.future])).toEqual([[true, false], [false, true]]);
    expect(p.creeks).toHaveLength(1);
    expect(p.ponds).toEqual([{ d: expect.any(String), future: false }]);
    expect(p.clearings).toEqual([{ d: expect.any(String), future: true }]);
    expect(p.marks).toEqual([{ x: 110, y: 110, standing: true }, { x: 250, y: 250, standing: false }]);
    expect(p.pin).toEqual([9.2320128, -83.8343203]);
  });

  it("frames the boundary with a margin", () => {
    expect(landPlan(SCENE)!.viewBox).toBe("84 84 232 232");
  });

  it("reads the scene as the JSON text the config carries", () => {
    expect(landPlan(JSON.stringify(SCENE))).toEqual(landPlan(SCENE));
  });

  it("gives no plan for nothing published, or a scene that will not parse", () => {
    expect(landPlan(null)).toBeNull();
    expect(landPlan("{not json")).toBeNull();
    expect(landPlan({ map_zones: [], map_structures: [] })).toBeNull();
  });

  it("drops a pin that is not on the earth", () => {
    expect(landPlan({ ...SCENE, map_scene: { georef: { pin: [200, 10] } } })!.pin).toBeNull();
  });
});

describe("smoothPath", () => {
  it("passes through every point", () => {
    const d = smoothPath([[0, 0], [10, 0], [10, 10]], false);
    expect(d.startsWith("M0,0")).toBe(true);
    expect(d).toContain(" 10,0C");
    expect(d.endsWith(" 10,10")).toBe(true);
  });
});

describe("formatLatLon", () => {
  it("writes degrees, minutes and seconds with the hemisphere", () => {
    expect(formatLatLon([9.2320128, -83.8343203])).toBe("9°13′55″N · 83°50′04″W");
  });
});
