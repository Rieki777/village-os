// @vitest-environment jsdom
/**
 * THE CLOCK FOLLOWS THE VILLAGE'S OWN SKY.
 *
 * `CycleClock` took its hemisphere as a prop defaulting to "north", and the
 * Gratitude Wall renders it with no prop at all. So a village that had chosen
 * "south" still got northern quarter marks and a moon lit on the wrong side,
 * on a page every member sees, however carefully the dial had been set.
 *
 * A fix on the page alone was not available: every reader of
 * `calendar.hemisphere` sits behind the events module (`/api/events` is gated
 * by requireModule, and the public mechanics page hides an off module's
 * dials), while the Gratitude Wall is core and renders whether or not a
 * village runs a calendar. `/api/game/cycle` is core, is already fetched here
 * for the day count, and now carries the answer beside the moon phase.
 *
 * WHAT THIS ASSERTS ON. The quarter marks are drawn as unlabelled lines, so
 * their hemisphere never reaches the DOM; the moon glyph's lit half does. It
 * is an arc whose sweep flag flips with the hemisphere (MoonGlyph.tsx: waxing
 * lights the right side in the north and the left in the south), so the two
 * skies are always different paths for the same phase, whatever the moon is
 * doing on the day this runs.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import CycleClock, { refillParts } from "./CycleClock";
import { CALENDAR_CLOCK, LUNAR_CLOCK } from "@shared/cycleClock";

const answering = (hemisphere?: string) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/game/cycle")) {
        return {
          ok: true,
          json: async () => ({ daysRemaining: 3, clock: "lunar", moonPhase: 0.5, ...(hemisphere ? { hemisphere } : {}) }),
        };
      }
      if (u.includes("/api/season")) return { ok: true, json: async () => ({ current: { name: "First season" } }) };
      return { ok: false, json: async () => ({}) };
    }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** The lit half of the moon glyph: the one mark whose shape carries the sky. */
const litHalf = () => document.querySelector('path[d^="M 12 2 A 10 10"]')?.getAttribute("d");

describe("CycleClock", () => {
  it("draws a different sky for a village that answered south", async () => {
    answering("north");
    const north = render(<CycleClock />);
    await waitFor(() => expect(litHalf()).toBeTruthy());
    const northPath = litHalf();
    north.unmount();
    vi.unstubAllGlobals();

    answering("south");
    render(<CycleClock />);
    await waitFor(() => expect(litHalf()).toBeTruthy());
    // Whatever the moon is doing today, the two hemispheres light opposite
    // sides. Before this the Gratitude Wall drew the northern one for both.
    expect(litHalf()).not.toBe(northPath);
  });

  it("still lets a caller decide, which is what the calendar's own views do", async () => {
    answering("south");
    const withProp = render(<CycleClock hemisphere="north" />);
    await waitFor(() => expect(litHalf()).toBeTruthy());
    const propPath = litHalf();
    withProp.unmount();
    vi.unstubAllGlobals();

    answering("north");
    render(<CycleClock />);
    await waitFor(() => expect(litHalf()).toBeTruthy());
    expect(litHalf()).toBe(propPath);
  });

  it("holds at north when the route says nothing, rather than drawing nothing", async () => {
    answering(undefined);
    const quiet = render(<CycleClock />);
    await waitFor(() => expect(litHalf()).toBeTruthy());
    const quietPath = litHalf();
    quiet.unmount();
    vi.unstubAllGlobals();

    answering("north");
    render(<CycleClock />);
    await waitFor(() => expect(litHalf()).toBeTruthy());
    expect(quietPath).toBe(litHalf());
  });
});

/**
 * WHEN ALLOWANCES REFILL IS A MOON AND A DATE, NEVER A COUNTDOWN (batch 157,
 * C4 Q4). The November 2026 moon in a UTC-6 village runs 9 November to
 * 7 December, its full moon is on 24 November and the next new moon falls on
 * 8 December (the calendar's own reading, moonSpiral.test.ts).
 */
describe("the refill line", () => {
  const november = () => {
    const b = LUNAR_CLOCK.boundsFor(new Date("2026-11-20T12:00:00Z"));
    return { id: b.id, clock: "lunar" as const, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString() };
  };

  it("names the moon and the day it turns, in the village's time zone", () => {
    expect(refillParts(november(), "America/Costa_Rica", "en")).toEqual({ moon: "November", date: "Tuesday, December 8" });
  });

  it("names a calendar month's turn with no moon", () => {
    const b = CALENDAR_CLOCK.boundsFor(new Date("2026-11-20T12:00:00Z"));
    expect(refillParts({ id: b.id, clock: "calendar", startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString() }, "America/Costa_Rica", "en")).toEqual({
      moon: null,
      date: "Tuesday, December 1",
    });
  });

  it("draws the moon and the date on the wall, and no number of days", async () => {
    const cycle = november();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/api/game/cycle")) return { ok: true, json: async () => ({ ...cycle, daysRemaining: 3, moonPhase: 0.5 }) };
        if (u.includes("/api/season")) return { ok: true, json: async () => ({ current: { name: "First season" }, timezone: "America/Costa_Rica" }) };
        return { ok: false, json: async () => ({}) };
      }),
    );
    const { getByTestId } = render(<CycleClock />);
    await waitFor(() => expect(getByTestId("cycle-refill").textContent).toBe("Allowances refill when the November Moon turns, on Tuesday, December 8."));
    expect(getByTestId("cycle-refill").textContent).not.toMatch(/\d+ days?\b/);
  });
});
