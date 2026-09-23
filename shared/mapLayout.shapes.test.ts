/**
 * The shape layouts (0083): six pictures, one fixture, and two promises.
 *
 * 1. PURITY: same input, same bytes, every time, for every shape. The
 *    snapshots below are the record; a layout that starts jittering fails
 *    them loudly.
 * 2. BYTE-IDENTITY for `circle`: layoutForShape("circle", …) IS
 *    layoutNestedMap's output, byte for byte, so the rebuild cannot move
 *    today's map by a pixel. The existing mapLayout.test.ts stays untouched
 *    beside this file, which is the other half of that promise.
 */
import { describe, expect, it } from "vitest";
import {
  layoutForShape,
  layoutNestedMap,
  type NestedInput,
  type NestedLayout,
} from "./mapLayout";

const FIXTURE: NestedInput[] = [
  {
    id: "land", parentId: null, order: 1, memberCount: 4, questCount: 2, name: "Land & Water",
    roles: [{ id: "land-lead", vacant: false }, { id: "water", vacant: true }],
  },
  {
    id: "welcome", parentId: null, order: 2, memberCount: 2, questCount: 0, name: "Welcome",
    roles: [{ id: "host", vacant: false }],
  },
  {
    id: "kitchen", parentId: "welcome", order: 1, memberCount: 3, questCount: 1, name: "Kitchen",
    roles: [{ id: "cook", vacant: false }],
  },
  {
    id: "wisdom", parentId: null, order: 3, memberCount: 0, questCount: 0, name: "Wisdom",
    roles: [],
  },
];

const VILLAGE_ROLES = [
  { id: "steward", vacant: false },
  { id: "keeper", vacant: true },
];

/** Integers only, compact strings, so the inline snapshots stay readable. */
function rounded(l: NestedLayout) {
  const seat = (s: { id: string; x: number; y: number; vacant: boolean }) =>
    `${s.id}@${Math.round(s.x)},${Math.round(s.y)}${s.vacant ? " open" : ""}`;
  return {
    size: `${Math.round(l.width)}x${Math.round(l.height)}`,
    village: `r${Math.round(l.village.r)}@${Math.round(l.village.x)},${Math.round(l.village.y)}`,
    seats: l.village.roles.map(seat),
    circles: l.circles.map(
      (c) =>
        `${c.id} d${c.depth} r${Math.round(c.r)}@${Math.round(c.x)},${Math.round(c.y)} [${c.roles.map(seat).join(" ")}] q${c.questDots.length}+${c.questOverflow}`,
    ),
  };
}

describe("layoutForShape", () => {
  it("keeps circle byte-identical to layoutNestedMap", () => {
    expect(JSON.stringify(layoutForShape("circle", FIXTURE, VILLAGE_ROLES))).toBe(
      JSON.stringify(layoutNestedMap(FIXTURE, VILLAGE_ROLES)),
    );
  });

  it("draws other as circle, so an unglossed word still has a picture", () => {
    expect(JSON.stringify(layoutForShape("other", FIXTURE, VILLAGE_ROLES))).toBe(
      JSON.stringify(layoutNestedMap(FIXTURE, VILLAGE_ROLES)),
    );
  });

  it("is deterministic for every shape", () => {
    for (const shape of ["circle", "pyramid", "council", "flat", "steward", "network"]) {
      const a = JSON.stringify(layoutForShape(shape, FIXTURE, VILLAGE_ROLES));
      const b = JSON.stringify(layoutForShape(shape, FIXTURE, VILLAGE_ROLES));
      expect(a, shape).toBe(b);
    }
  });

  it("pads for an outer lens without touching relative geometry", () => {
    const base = layoutForShape("council", FIXTURE, VILLAGE_ROLES);
    const padded = layoutForShape("council", FIXTURE, VILLAGE_ROLES, 80);
    expect(padded.width).toBe(base.width + 160);
    expect(padded.height).toBe(base.height + 160);
    expect(padded.village.x).toBe(base.village.x + 80);
    expect(padded.village.r).toBe(base.village.r);
    expect(padded.circles[0].x).toBe(base.circles[0].x + 80);
    expect(padded.circles[0].roles[0].x).toBe(base.circles[0].roles[0].x + 80);
    // pad = 0 is the base object, which is what byte-identity leans on.
    expect(layoutForShape("council", FIXTURE, VILLAGE_ROLES, 0)).toEqual(base);
  });

  it("lays out circle", () => {
    expect(rounded(layoutForShape("circle", FIXTURE, VILLAGE_ROLES))).toMatchInlineSnapshot(`
      {
        "circles": [
          "land d0 r49@107,263 [land-lead@107,234 water@107,292 open] q2+0",
          "welcome d0 r98@271,271 [host@271,349] q0+0",
          "kitchen d1 r57@271,271 [cook@271,234] q1+0",
          "wisdom d0 r53@435,279 [] q0+0",
        ],
        "seats": [
          "steward@212,30",
          "keeper@330,30 open",
        ],
        "size": "542x542",
        "village": "r248@271,271",
      }
    `);
  });

  it("lays out pyramid: rows down the page, head seats on top", () => {
    expect(rounded(layoutForShape("pyramid", FIXTURE, VILLAGE_ROLES))).toMatchInlineSnapshot(`
      {
        "circles": [
          "land d0 r49@84,121 [land-lead@84,91 water@84,150 open] q2+0",
          "welcome d0 r57@204,121 [host@204,157] q0+0",
          "wisdom d0 r53@328,121 [] q0+0",
          "kitchen d1 r57@208,260 [cook@208,223] q1+0",
        ],
        "seats": [
          "steward@168,32",
          "keeper@234,32 open",
        ],
        "size": "402x341",
        "village": "r201@201,171",
      }
    `);
  });

  it("lays out council: the village's seats ring the centre", () => {
    expect(rounded(layoutForShape("council", FIXTURE, VILLAGE_ROLES))).toMatchInlineSnapshot(`
      {
        "circles": [
          "land d0 r49@422,199 [land-lead@422,169 water@422,228 open] q2+0",
          "welcome d0 r98@317,466 [host@317,544] q0+0",
          "kitchen d1 r57@317,466 [cook@317,429] q1+0",
          "wisdom d0 r53@190,205 [] q0+0",
        ],
        "seats": [
          "steward@309,280",
          "keeper@309,338 open",
        ],
        "size": "617x617",
        "village": "r285@309,309",
      }
    `);
  });

  it("lays out flat: one ring of equals", () => {
    expect(rounded(layoutForShape("flat", FIXTURE, VILLAGE_ROLES))).toMatchInlineSnapshot(`
      {
        "circles": [
          "land d0 r98@271,151 [land-lead@271,73 water@271,229 open] q2+0",
          "welcome d0 r98@374,330 [host@374,408] q0+0",
          "kitchen d1 r57@374,330 [cook@374,294] q1+0",
          "wisdom d0 r98@167,330 [] q0+0",
        ],
        "seats": [
          "steward@271,23",
          "keeper@271,518 open",
        ],
        "size": "541x541",
        "village": "r247@271,271",
      }
    `);
  });

  it("lays out steward: the steward at the centre", () => {
    expect(rounded(layoutForShape("steward", FIXTURE, VILLAGE_ROLES))).toMatchInlineSnapshot(`
      {
        "circles": [
          "land d0 r49@448,204 [land-lead@448,174 water@448,233 open] q2+0",
          "welcome d0 r98@333,497 [host@333,574] q0+0",
          "kitchen d1 r57@333,497 [cook@333,460] q1+0",
          "wisdom d0 r53@194,210 [] q0+0",
        ],
        "seats": [
          "steward@324,300",
          "keeper@324,348 open",
        ],
        "size": "648x648",
        "village": "r301@324,324",
      }
    `);
  });

  it("lays out network: nodes spread on a wide ring", () => {
    expect(rounded(layoutForShape("network", FIXTURE, VILLAGE_ROLES))).toMatchInlineSnapshot(`
      {
        "circles": [
          "land d0 r49@429,200 [land-lead@429,171 water@429,230 open] q2+0",
          "welcome d0 r98@321,475 [host@321,552] q0+0",
          "kitchen d1 r57@321,475 [cook@321,438] q1+0",
          "wisdom d0 r53@191,206 [] q0+0",
        ],
        "seats": [
          "steward@244,32",
          "keeper@382,32 open",
        ],
        "size": "626x626",
        "village": "r290@313,313",
      }
    `);
  });

  it("keeps every node id through every shape, so the morph can travel", () => {
    for (const shape of ["pyramid", "council", "flat", "steward", "network"]) {
      const l = layoutForShape(shape, FIXTURE, VILLAGE_ROLES);
      expect(l.circles.map((c) => c.id).sort(), shape).toEqual(["kitchen", "land", "welcome", "wisdom"]);
      expect(l.village.roles.map((s) => s.id).sort(), shape).toEqual(["keeper", "steward"]);
    }
  });

  it("pyramid puts a child in the row below its parent", () => {
    const l = layoutForShape("pyramid", FIXTURE, VILLAGE_ROLES);
    const welcome = l.circles.find((c) => c.id === "welcome")!;
    const kitchen = l.circles.find((c) => c.id === "kitchen")!;
    expect(kitchen.depth).toBe(welcome.depth + 1);
    expect(kitchen.y).toBeGreaterThan(welcome.y);
    // And the head seats crown the apex, above every circle.
    for (const s of l.village.roles) {
      expect(s.y).toBeLessThan(Math.min(...l.circles.map((c) => c.y - c.r)));
    }
  });

  it("flat gives every top-level circle the same radius", () => {
    const l = layoutForShape("flat", FIXTURE, VILLAGE_ROLES);
    const tops = l.circles.filter((c) => c.depth === 0);
    expect(new Set(tops.map((c) => Math.round(c.r))).size).toBe(1);
  });

  it("steward holds the centre with the village's own seats", () => {
    const l = layoutForShape("steward", FIXTURE, VILLAGE_ROLES);
    for (const s of l.village.roles) {
      const d = Math.hypot(s.x - l.village.x, s.y - l.village.y);
      expect(d).toBeLessThan(40);
    }
    // And every circle clears the centre.
    for (const c of l.circles.filter((x) => x.depth === 0)) {
      expect(Math.hypot(c.x - l.village.x, c.y - l.village.y)).toBeGreaterThan(40);
    }
  });
});
