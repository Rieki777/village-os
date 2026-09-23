/**
 * The numbering behind the phone map's key.
 *
 * Seven of nine circles carried no name on a 390px phone, because a name is
 * drawn only where it fits inside its circle. The fix chosen is a key: numbers
 * on the circles the reader is choosing between, and a list under the map that
 * names every number. These tests pin WHICH circles are numbered and in WHAT
 * ORDER, because a key whose numbers wander between renders, or that numbers the
 * wrong level, is worse than no key.
 */
import { describe, expect, it } from "vitest";
import { phoneKeysFor, type KeyedPosition } from "./phoneKeys";

/** A root at the centre with children placed at clock positions around it. */
function clockVillage(hours: Record<string, number>): { positions: KeyedPosition[]; parentOf: (id: string) => string | null } {
  const positions: KeyedPosition[] = [{ id: "root", x: 0, y: 0, depth: 0 }];
  for (const [id, hour] of Object.entries(hours)) {
    const a = (hour / 12) * Math.PI * 2;
    // Twelve o'clock is straight up, which is -y on a screen.
    positions.push({ id, x: Math.sin(a) * 100, y: -Math.cos(a) * 100, depth: 1 });
  }
  return { positions, parentOf: (id) => (id === "root" ? null : "root") };
}

describe("the numbers on a phone map", () => {
  it("counts clockwise from twelve o'clock, the way a clock is read", () => {
    const { positions, parentOf } = clockVillage({ six: 6, twelve: 0, three: 3, nine: 9 });
    const keys = phoneKeysFor(positions, parentOf, null, 1);
    expect(keys.map((k) => k.id)).toEqual(["twelve", "three", "six", "nine"]);
    expect(keys.map((k) => k.key)).toEqual([1, 2, 3, 4]);
  });

  it("numbers the level the reader is choosing between, never the container", () => {
    const { positions, parentOf } = clockVillage({ a: 1, b: 5 });
    const keys = phoneKeysFor(positions, parentOf, null, 1);
    expect(keys.some((k) => k.id === "root")).toBe(false);
    expect(keys).toHaveLength(2);
  });

  it("counts only under the circle the camera is inside", () => {
    const positions: KeyedPosition[] = [
      { id: "root", x: 0, y: 0, depth: 0 },
      { id: "dev", x: 50, y: 0, depth: 1 },
      { id: "care", x: -50, y: 0, depth: 1 },
      { id: "arch", x: 50, y: -20, depth: 2 },
      { id: "farm", x: 50, y: 20, depth: 2 },
      { id: "kitchen", x: -50, y: 20, depth: 2 },
    ];
    const parents: Record<string, string | null> = {
      root: null, dev: "root", care: "root", arch: "dev", farm: "dev", kitchen: "care",
    };
    const keys = phoneKeysFor(positions, (id) => parents[id] ?? null, "dev", 2);
    expect(keys.map((k) => k.id)).toEqual(["arch", "farm"]);
  });

  it("gives the same numbers every time for the same village", () => {
    const { positions, parentOf } = clockVillage({ a: 2, b: 7, c: 11, d: 4 });
    const first = phoneKeysFor(positions, parentOf, null, 1);
    const second = phoneKeysFor([...positions].reverse(), parentOf, null, 1);
    expect(second).toEqual(first);
  });

  it("breaks a tie on the clock by id, so two circles at one angle never swap", () => {
    const positions: KeyedPosition[] = [
      { id: "root", x: 0, y: 0, depth: 0 },
      { id: "zeta", x: 0, y: -100, depth: 1 },
      { id: "alpha", x: 0, y: -60, depth: 1 },
    ];
    const keys = phoneKeysFor(positions, (id) => (id === "root" ? null : "root"), null, 1);
    expect(keys.map((k) => k.id)).toEqual(["alpha", "zeta"]);
  });

  it("answers an empty key when nothing sits at that level", () => {
    const { positions, parentOf } = clockVillage({ a: 3 });
    expect(phoneKeysFor(positions, parentOf, null, 2)).toEqual([]);
    expect(phoneKeysFor([], () => null, null, 1)).toEqual([]);
  });

  it("does not loop forever on data that already loops", () => {
    const positions: KeyedPosition[] = [
      { id: "a", x: 0, y: -10, depth: 1 },
      { id: "b", x: 0, y: 10, depth: 1 },
    ];
    const loop: Record<string, string> = { a: "b", b: "a" };
    expect(phoneKeysFor(positions, (id) => loop[id] ?? null, "zzz", 1)).toEqual([]);
  });
});
