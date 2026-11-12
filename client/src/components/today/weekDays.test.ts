import { describe, expect, it } from "vitest";
import { dayKey, itemDay, quietWeek, weekDays, type WeekItem } from "./weekDays";

const NOW = new Date(2026, 10, 11, 9, 0); // Wednesday 11 November 2026, where the reader is

describe("the week, as seven days from today", () => {
  it("starts today and runs seven calendar days", () => {
    const days = weekDays(NOW, []);
    expect(days.map((d) => d.key)).toEqual(["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"]);
    expect(days[0].today).toBe(true);
    expect(days.filter((d) => d.today)).toHaveLength(1);
    expect(quietWeek(days)).toBe(true);
  });

  it("places each item on its own local day, a bare date first, then by time; and drops what falls outside", () => {
    const at = (d: number, h: number) => new Date(2026, 10, d, h, 0).toISOString();
    const items: WeekItem[] = [
      { kind: "meeting", title: "Hearth circle", at: at(12, 18), href: "/sessions" },
      { kind: "gathering", title: "Potluck", at: at(12, 12), href: "/events" },
      { kind: "task", title: "Task due", at: "2026-11-12", href: "/profile#my-tasks" },
      { kind: "gathering", title: "Too far", at: at(25, 12), href: "/events" },
    ];
    const days = weekDays(NOW, items);
    expect(days[1].items.map((x) => x.title)).toEqual(["Task due", "Potluck", "Hearth circle"]);
    expect(days.flatMap((d) => d.items).some((x) => x.title === "Too far")).toBe(false);
    expect(quietWeek(days)).toBe(false);
  });

  it("marks the real full moon on its day, and no other", () => {
    // The full moon of 24 November 2026 (shared/lunar's table), seen from the 20th.
    const days = weekDays(new Date(2026, 10, 20, 9, 0), []);
    const marked = days.filter((d) => d.moon === "full").map((d) => d.key);
    expect(marked).toHaveLength(1);
    expect(["2026-11-24", "2026-11-23"]).toContain(marked[0]); // the local day of the instant
  });

  it("reads a bare date as that day where the reader is, never UTC midnight moved", () => {
    expect(itemDay("2026-11-12")).toBe("2026-11-12");
    expect(itemDay("not a date")).toBeNull();
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
