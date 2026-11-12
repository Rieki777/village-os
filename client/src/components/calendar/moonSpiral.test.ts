/**
 * The moon as a golden spiral of days, held as numbers: the spiral is golden
 * (phi per quarter turn), the days walk outward at an even pace, the drawing
 * fits its box and never changes between renders, and one lunar month of the
 * village calendar becomes the right days, turnings and marks.
 */
import { describe, expect, it } from "vitest";
import type { CalendarItem } from "@shared/gatherings";
import { addDays, civilDayFor } from "./calendarTime";
import { GOLDEN_B, PHI, goldenRadius, goldenSpiralDays, moonDays, stepDay } from "./moonSpiral";

const TZ = "America/Costa_Rica";
const day = (y: number, m: number, d: number) => civilDayFor(y, m, d, TZ);

function item(over: Partial<CalendarItem>): CalendarItem {
  return {
    id: 1,
    occurrenceKey: "",
    kind: "gathering",
    title: "A gathering",
    startsAt: "2026-11-13T00:00:00.000Z",
    endsAt: null,
    allDay: false,
    status: "scheduled",
    ...over,
  } as CalendarItem;
}

describe("goldenRadius", () => {
  it("grows by phi every quarter turn", () => {
    for (const t of [0, 0.7, 2, 5]) {
      expect(goldenRadius(t + Math.PI / 2) / goldenRadius(t)).toBeCloseTo(PHI, 10);
    }
    expect(GOLDEN_B).toBeCloseTo(Math.log(PHI) / (Math.PI / 2), 12);
  });
});

describe("goldenSpiralDays", () => {
  const W = 360;
  const H = 340;
  const fit = goldenSpiralDays(29, W, H, { margin: 22 });

  it("places one seed per day, inside the box", () => {
    expect(fit.days).toHaveLength(29);
    for (const p of fit.days) {
      expect(p.x).toBeGreaterThanOrEqual(22 - 0.01);
      expect(p.x).toBeLessThanOrEqual(W - 22 + 0.01);
      expect(p.y).toBeGreaterThanOrEqual(22 - 0.01);
      expect(p.y).toBeLessThanOrEqual(H - 22 + 0.01);
    }
  });

  it("starts at the new moon and moves outward day by day", () => {
    const dist = fit.days.map((p) => Math.hypot(p.x - fit.centre.x, p.y - fit.centre.y));
    for (let i = 1; i < dist.length; i++) expect(dist[i]).toBeGreaterThan(dist[i - 1]);
  });

  it("keeps an even walk between days along the curve", () => {
    // Spaced by arc length. The straight-line gap is a chord, a little shorter
    // where the curve bends hardest near the centre, so it may drift across the
    // whole moon, but never jumps from one day to the next. Placed by angle
    // instead, the outer gaps would be several times the inner ones.
    const gaps = fit.days.slice(1).map((p, i) => Math.hypot(p.x - fit.days[i].x, p.y - fit.days[i].y));
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.6);
    for (let i = 1; i < gaps.length; i++) expect(Math.abs(gaps[i] / gaps[i - 1] - 1)).toBeLessThan(0.1);
  });

  it("draws the same thread on every render", () => {
    expect(goldenSpiralDays(29, W, H, { margin: 22 })).toEqual(fit);
    expect(fit.path.startsWith("M ")).toBe(true);
  });

  it("takes a thirty-day moon and a single day without breaking", () => {
    expect(goldenSpiralDays(30, 720, 580).days).toHaveLength(30);
    expect(goldenSpiralDays(1, 100, 100).days).toHaveLength(1);
  });
});

describe("moonDays", () => {
  const today = day(2026, 11, 12);

  it("reads the November 2026 moon in a UTC-6 village", () => {
    const m = moonDays(today, today, "december_solstice", TZ, new Map())!;
    expect(m.days).toHaveLength(29);
    expect(m.newMoonKey).toBe("2026-11-09");
    expect(m.days[0].day.key).toBe("2026-11-09");
    expect(m.days[28].day.key).toBe("2026-12-07");
    // The same full moon the moon rhythm names for the end-of-moon review.
    expect(m.fullMoonKey).toBe("2026-11-24");
    expect(m.nextNewMoonKey).toBe("2026-12-08");
  });

  it("marks today, the days walked, the new moon and the full moon", () => {
    const m = moonDays(today, today, "december_solstice", TZ, new Map())!;
    const byKey = new Map(m.days.map((d) => [d.day.key, d]));
    expect(byKey.get("2026-11-12")!.today).toBe(true);
    expect(m.days.filter((d) => d.today)).toHaveLength(1);
    expect(m.days.filter((d) => d.walked).map((d) => d.day.key)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(byKey.get("2026-11-09")!.newMoon).toBe(true);
    expect(m.days.filter((d) => d.fullMoon).map((d) => d.day.key)).toEqual(["2026-11-24"]);
    expect(m.days.map((d) => d.lunarDay)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  });

  it("gives a gathering day its ring, anything else a dot, and the sky neither", () => {
    const byDay = new Map<string, CalendarItem[]>([
      ["2026-11-13", [item({ kind: "gathering" })]],
      ["2026-11-16", [item({ kind: "quest-window", title: "A quest" })]],
      ["2026-11-24", [item({ kind: "sky", title: "Full moon" })]],
      ["2026-11-27", [item({ kind: "gathering", status: "cancelled" })]],
    ]);
    const m = moonDays(today, today, "december_solstice", TZ, byDay)!;
    const at = (k: string) => m.days.find((d) => d.day.key === k)!;
    expect(at("2026-11-13")).toMatchObject({ gathering: true, marked: false });
    expect(at("2026-11-16")).toMatchObject({ gathering: false, marked: true });
    expect(at("2026-11-24")).toMatchObject({ gathering: false, marked: false });
    // A cancelled gathering is still on the calendar, but nobody gathers.
    expect(at("2026-11-27")).toMatchObject({ gathering: false, marked: true });
  });

  it("reads the same moon from any of its days, and walks nothing in a moon still to come", () => {
    const a = moonDays(day(2026, 11, 9), today, "december_solstice", TZ, new Map())!;
    const b = moonDays(day(2026, 12, 7), today, "december_solstice", TZ, new Map())!;
    expect(a.newMoonKey).toBe(b.newMoonKey);
    const next = moonDays(day(2026, 12, 8), today, "december_solstice", TZ, new Map())!;
    expect(next.newMoonKey).toBe("2026-12-08");
    expect(next.days.some((d) => d.walked || d.today)).toBe(false);
  });
});

describe("stepDay", () => {
  it("walks one day each way and crosses the moon's edge", () => {
    const last = day(2026, 12, 7);
    expect(stepDay(last, "ArrowRight", TZ)!.key).toBe("2026-12-08");
    expect(stepDay(last, "ArrowUp", TZ)!.key).toBe(addDays(last, 1, TZ).key);
    expect(stepDay(day(2026, 11, 9), "ArrowLeft", TZ)!.key).toBe("2026-11-08");
    expect(stepDay(last, "Tab", TZ)).toBeNull();
  });
});
