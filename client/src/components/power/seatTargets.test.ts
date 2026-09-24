/**
 * A seat's tap area grows as far as the picture allows, and never past it.
 *
 * The live numbers these are built on, measured at 390x844 on 2026-09-23:
 * seats render 7x7 on the village view with 19 pixels between neighbours,
 * 15x15 inside a container with 38, and 54x54 inside a leaf circle, where
 * nothing needs fixing. The rule has to improve the first two without ever
 * letting one seat answer for another.
 */
import { describe, expect, it } from "vitest";
import { HOST_AREA_SHARE, HOST_SHARE, MIN_TAP_PX, NEIGHBOUR_SHARE, seatHitRadii, seatHitRadius, type SeatPoint } from "./seatTargets";

const seat = (over: Partial<SeatPoint> = {}): SeatPoint => ({ id: "s", x: 0, y: 0, r: 4, hostR: 200, hostSeats: 1, ...over });

/** A ring of `n` seats, the shape every real crowding case has. */
function ring(n: number, radius: number, dot = 4): SeatPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { id: `s${i}`, x: Math.cos(a) * radius, y: Math.sin(a) * radius, r: dot, hostR: radius + 20, hostSeats: n };
  });
}

describe("how big one seat's tap area may be", () => {
  it("grows a lonely seat to a comfortable tap", () => {
    // 2 screen px per world unit: 44 screen px is 22 world units across, so 11 of radius.
    expect(seatHitRadius(seat(), Infinity, 2)).toBeCloseTo(MIN_TAP_PX / 2 / 2, 5);
  });

  it("stops short of its nearest neighbour, leaving a corridor between them", () => {
    const r = seatHitRadius(seat(), 20, 2);
    expect(r).toBeCloseTo(20 * NEIGHBOUR_SHARE, 5);
    // Two of them, 20 apart, do not meet.
    expect(2 * r).toBeLessThan(20);
  });

  it("never swallows the circle it sits on", () => {
    // A tap meant for a small disc still has to land on the disc.
    expect(seatHitRadius(seat({ hostR: 20 }), Infinity, 2)).toBeCloseTo(20 * HOST_SHARE, 5);
  });

  it("shares one circle's room out among the seats on it", () => {
    /*
     * Measured: at 40% of the radius each, four seats covered two thirds of a
     * small disc and a tap opened the circle 25% of the time. So the cap is
     * what they take TOGETHER, and one of six gets less room than one of two.
     */
    const crowded = seatHitRadius(seat({ hostR: 60, hostSeats: 6 }), Infinity, 1);
    const roomy = seatHitRadius(seat({ hostR: 60, hostSeats: 2 }), Infinity, 1);
    expect(crowded).toBeLessThan(roomy);
    // Together they stay inside the allowance.
    expect(6 * Math.PI * crowded * crowded).toBeLessThanOrEqual(HOST_AREA_SHARE * Math.PI * 60 * 60 + 1e-6);
  });

  it("is never smaller than the dot that is drawn", () => {
    expect(seatHitRadius(seat({ r: 9, hostR: 10 }), 2, 2)).toBe(9);
  });

  it("leaves the dot alone before anything has been measured", () => {
    // pxPerWorld is 0 until the ResizeObserver lands. Nothing to convert against.
    expect(seatHitRadius(seat({ r: 6 }), Infinity, 0)).toBe(6);
  });
});

describe("every seat on the map at once", () => {
  it("never lets two hit areas overlap, however tight the ring", () => {
    for (const n of [4, 8, 16, 25]) {
      const seats = ring(n, 120);
      const radii = seatHitRadii(seats, 4);
      for (let i = 0; i < seats.length; i++) {
        for (let j = i + 1; j < seats.length; j++) {
          const gap = Math.hypot(seats[i]!.x - seats[j]!.x, seats[i]!.y - seats[j]!.y);
          expect(radii.get(seats[i]!.id)! + radii.get(seats[j]!.id)!, `ring of ${n}, seats ${i} and ${j}`).toBeLessThan(gap);
        }
      }
    }
  });

  /*
   * The control: if the rule quietly did nothing, every assertion above would
   * still pass. This is the case the live measurement is about.
   */
  it("actually grows a crowded ring, which is the whole point", () => {
    const seats = ring(23, 120, 4);
    const radii = seatHitRadii(seats, 4);
    for (const s of seats) expect(radii.get(s.id)!).toBeGreaterThan(s.r);
  });

  it("changes nothing for a seat already bigger than a comfortable tap", () => {
    const big = [{ id: "one", x: 0, y: 0, r: 30, hostR: 400, hostSeats: 1 }];
    expect(seatHitRadii(big, 1).get("one")).toBe(30);
  });

  it("measures crowding against the seats that are drawn, not the ones that are not", () => {
    // Close enough that crowding is what binds, rather than the comfortable
    // size both would otherwise reach.
    const pair = ring(2, 3, 1);
    const crowded = seatHitRadii(pair, 4).get("s0")!;
    const alone = seatHitRadii([pair[0]!], 4).get("s0")!;
    expect(alone).toBeGreaterThan(crowded);
  });
});
