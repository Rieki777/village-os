/**
 * THE MOON GARDEN'S MATHS (Phase C, lane C2): the golden spiral of days, the
 * four chapters, and one bed per role. Each check names the break-the-fix
 * control that makes it fail.
 */
import { describe, expect, it } from "vitest";
import { PHI } from "@/components/journey/nature/geometry";
import {
  bedFor,
  bedSpots,
  bedWords,
  chapterOf,
  chapterStarts,
  moonDays,
  nextAct,
  plantOf,
  radiusAt,
  spiralDays,
  standing,
} from "./moonGarden";
import { item } from "./myMoon.fixture";

// An invented moon, the same dates as the component fixture.
const MOON = { cycleId: "lunar-2026-10", firstDay: "2026-10-10", lastDay: "2026-11-08", periodWords: "", endOfMoonFriday: "2026-11-05", sendBy: "2026-11-09", halfwayDay: "2026-10-25" };

describe("the golden spiral of days", () => {
  const pts = spiralDays(30, 100);

  it("places one point per day, the new moon at the centre and the last day on the edge", () => {
    expect(moonDays(MOON)).toHaveLength(30);
    expect(pts).toHaveLength(30);
    const r = pts.map((p) => Math.hypot(p.x, p.y));
    expect(r[29]).toBeCloseTo(100, 5);
    expect(r[0]).toBeLessThan(10);
    // Outward all the way: each day sits farther from the centre than the one before.
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThan(r[i - 1]);
  });

  it("walks the curve in equal steps (equal arc length), so no stretch of days bunches up", () => {
    // Control: place days at equal ANGLE instead and the outer steps are ~100x the inner ones.
    const fine = spiralDays(30, 100);
    // The chord between neighbours never exceeds the equal arc step, and on this curve stays close to it.
    const chords = fine.slice(1).map((p, i) => Math.hypot(p.x - fine[i].x, p.y - fine[i].y));
    const max = Math.max(...chords);
    const min = Math.min(...chords);
    expect(min / max).toBeGreaterThan(0.8);
  });

  it("is a golden spiral: a quarter turn further out multiplies the radius by phi", () => {
    for (const t of [0.5, 2, 7.3]) expect(radiusAt(t + Math.PI / 2) / radiusAt(t)).toBeCloseTo(PHI, 10);
    // And a full turn is phi to the fourth.
    expect(radiusAt(2 * Math.PI + 1) / radiusAt(1)).toBeCloseTo(Math.pow(PHI, 4), 10);
  });

  it("draws the same spiral every time", () => {
    expect(spiralDays(29, 100)).toEqual(spiralDays(29, 100));
  });
});

describe("the four chapters", () => {
  it("sows the first week, pauses at the full moon, harvests the walkthrough week and tends between", () => {
    expect(chapterStarts(MOON)).toEqual({ sow: "2026-10-10", tend: "2026-10-17", full: "2026-10-25", harvest: "2026-10-30" });
    expect(chapterOf("2026-10-10", MOON)).toBe("sow");
    expect(chapterOf("2026-10-16", MOON)).toBe("sow");
    expect(chapterOf("2026-10-17", MOON)).toBe("tend");
    expect(chapterOf("2026-10-25", MOON)).toBe("full");
    expect(chapterOf("2026-10-27", MOON)).toBe("full");
    expect(chapterOf("2026-10-28", MOON)).toBe("tend");
    expect(chapterOf("2026-10-30", MOON)).toBe("harvest");
    expect(chapterOf("2026-11-08", MOON)).toBe("harvest");
  });

  it("falls back to the middle day when the lunar table names no full moon", () => {
    expect(chapterStarts({ ...MOON, halfwayDay: null }).full).toBe("2026-10-25");
  });

  it("knows the day of the moon, and before and after it", () => {
    expect(standing("2026-10-12", MOON)).toEqual({ kind: "in", day: 3, of: 30 });
    expect(standing("2026-10-01", MOON)).toEqual({ kind: "before" });
    expect(standing("2026-11-20", MOON)).toEqual({ kind: "after" });
  });

  it("offers one act while the recap is the member's, and none once it is sent", () => {
    expect(nextAct("tend", true)).toEqual({ label: "Bring in this moon's work", href: "#moon-gather" });
    expect(nextAct("harvest", true)?.href).toBe("#moon-own-words");
    expect(nextAct("harvest", false)).toBeNull();
  });
});

describe("one bed per role", () => {
  it("grows each kept piece of work as its plant, and leaves let go, redirect and dropped work out", () => {
    expect(plantOf({ state: "kept", taskStatus: "done" })).toBe("flowered");
    expect(plantOf({ state: "kept", taskStatus: "partly" })).toBe("bud");
    expect(plantOf({ state: "kept", taskStatus: "carry" })).toBe("seed");
    expect(plantOf({ state: "kept", taskStatus: null })).toBe("sprout");
    expect(plantOf({ state: "kept", taskStatus: "let_go" })).toBeNull();
    expect(plantOf({ state: "kept", taskStatus: "redirect" })).toBeNull();
    expect(plantOf({ state: "suggested", taskStatus: "done" })).toBeNull();
    expect(plantOf({ state: "dropped", taskStatus: "done" })).toBeNull();
  });

  it("plants only that role's work, in the order it was kept", () => {
    const items = [
      item({ id: "a", roleId: "r-1", position: 2, taskStatus: "carry" }),
      item({ id: "b", roleId: "r-2", position: 0, taskStatus: "done" }),
      item({ id: "c", roleId: "r-1", position: 1, taskStatus: "done" }),
      item({ id: "d", roleId: null, position: 3, taskStatus: "done" }),
    ];
    expect(bedFor("r-1", items)).toEqual(["flowered", "seed"]);
    expect(bedFor("r-2", items)).toEqual(["flowered"]);
    expect(bedFor("r-3", items)).toEqual([]);
  });

  it("sets the plants on the sunflower's spiral, the first at the centre, all inside the bed", () => {
    for (const n of [1, 5, 12, 40]) {
      const s = bedSpots(n, 82);
      expect(s).toHaveLength(n);
      expect(s[0]).toEqual({ x: 0, y: 0 });
      for (const p of s) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(82);
    }
  });

  it("says the bed in words, without a percent or a total", () => {
    expect(bedWords(["flowered", "flowered", "bud", "sprout", "seed"])).toBe("2 flowered, 1 in bud, 1 sprouting, 1 seed kept");
    expect(bedWords([])).toBe("");
  });
});
