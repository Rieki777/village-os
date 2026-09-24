/**
 * HOW BIG A SEAT'S TAP AREA MAY BE, which is not the same question as how big
 * it should be.
 *
 * Measured live on 2026-09-23 at 390x844: every one of the 23 seats on the
 * village view renders at 7x7, and its nearest neighbour on the ring is 19
 * pixels away. Inside a container circle it is 15x15 with 38 pixels of room.
 * Inside a leaf circle it is already 54x54, which is why stepping in works and
 * the view you arrive at does not.
 *
 * So a 44px hit area cannot simply be handed to every seat: at 19 pixels of
 * spacing, two 44px targets overlap by more than half, and a hit area that
 * reaches past its neighbour steals that neighbour's taps. A target you cannot
 * hit is bad; a target that answers for the seat beside it is worse, because
 * the reader gets a confident wrong answer instead of nothing.
 *
 * Each seat therefore gets as much as the picture allows, under three limits:
 *
 *   1. it never reaches past 45% of the way to its nearest neighbour, which
 *      leaves a corridor between every pair rather than having them touch;
 *   2. it never takes more than a share of its own circle, and the seats on
 *      one circle never take more than a third of it BETWEEN THEM, so a tap
 *      meant for the disc still lands on the disc;
 *   3. it is never smaller than the dot actually drawn.
 *
 * Limit 2 has two halves because the first half alone was measured and found
 * wanting: at 40% of the radius each, four seats on a small disc covered two
 * thirds of it, and a sample across that circle opened the circle only 25% of
 * the time. A per-seat cap cannot see a crowd. The area cap can.
 *
 * MEASURED, live against this build, at 390x844 and 1440x900:
 *
 *   phone village    seats 7x7, all 23 of them, become 11px to 44px
 *   desktop village  seats 14x14 become 23px to 44px
 *   inside a circle  no change; they were already comfortable
 *
 * And the cost, which is the number to watch: the WORST circle for stepping
 * into (`advisory-bodies`, three seats on a 78px disc) goes from 91% of its
 * surface opening the circle to 67%. The median circle stays at 100%. That
 * trade is taken deliberately: a 7px target cannot be hit at all, and a third
 * of one small disc is what hittable seats cost there.
 */

/** The smallest comfortable tap, in SCREEN pixels. */
export const MIN_TAP_PX = 44;

/** How far toward its nearest neighbour a seat's hit area may reach. */
export const NEIGHBOUR_SHARE = 0.45;

/** How much of its own circle one seat's hit area may take, by radius. */
export const HOST_SHARE = 0.4;

/** How much of a circle all its seats' hit areas may take, by area. */
export const HOST_AREA_SHARE = 1 / 3;

export interface SeatPoint {
  id: string;
  /** Where the seat sits, in world units. */
  x: number;
  y: number;
  /** The radius of the dot drawn for it. */
  r: number;
  /** The radius of the circle it sits on, or of the village ring. */
  hostR: number;
  /** How many seats share that circle, including this one. */
  hostSeats: number;
}

/**
 * The hit radius for one seat, in world units.
 *
 * `nearest` is the distance to the closest other seat, and Infinity when there
 * is no other seat to crowd. `pxPerWorld` is zero before the first
 * measurement, when there is nothing to convert against, so the drawn dot
 * stands until the next frame.
 */
export function seatHitRadius(seat: SeatPoint, nearest: number, pxPerWorld: number): number {
  if (!(pxPerWorld > 0)) return seat.r;
  const want = MIN_TAP_PX / 2 / pxPerWorld;
  // The share of the circle this seat may take, once its neighbours on the
  // same circle have had an equal part of the allowance.
  const share = Math.sqrt((HOST_AREA_SHARE * seat.hostR * seat.hostR) / Math.max(1, seat.hostSeats));
  return Math.max(seat.r, Math.min(want, nearest * NEIGHBOUR_SHARE, seat.hostR * HOST_SHARE, share));
}

/**
 * Every seat's hit radius, with each one measured against all the others.
 *
 * Only seats that are actually drawn belong here. A seat the reader cannot
 * reach is not crowding anything, and counting it would shrink the targets of
 * the seats beside it for no one's benefit.
 */
export function seatHitRadii(seats: SeatPoint[], pxPerWorld: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const seat of seats) {
    let nearest = Infinity;
    for (const other of seats) {
      if (other === seat) continue;
      nearest = Math.min(nearest, Math.hypot(seat.x - other.x, seat.y - other.y));
    }
    out.set(seat.id, seatHitRadius(seat, nearest, pxPerWorld));
  }
  return out;
}
