import { describe, expect, it } from "vitest";
import { FIRST_DAYS as PROFILE_FIRST_DAYS } from "@shared/roleStartWords";
import { FIRST_DAYS, dateOfDay, fourteenDays, moveDay, showsStrip, splitSteps, type StripStep } from "./fourteenDays";

const step = (key: string, dueDay: number, over: Partial<StripStep> = {}): StripStep => ({
  key, title: key, dueDay, doneAt: null, owner: "holder", mayTick: true, doneWhen: "Ticked", ...over,
});

describe("our first 14 days, as days", () => {
  it("is the same fourteen days the profile keeps the ladder away for", () => {
    expect(FIRST_DAYS).toBe(PROFILE_FIRST_DAYS);
  });

  it("is shown only on the reader's own path, from day 1 to day 14", () => {
    expect(showsStrip({ mine: true, day: 1 })).toBe(true);
    expect(showsStrip({ mine: true, day: 14 })).toBe(true);
    expect(showsStrip({ mine: true, day: 15 })).toBe(false);
    expect(showsStrip({ mine: false, day: 3 })).toBe(false); // a buddy or the onboarding role reads the list
  });

  it("puts each step on the day it is due, with its calendar date", () => {
    const s = fourteenDays({ mine: true, day: 2, openedOn: "2026-11-30", items: [step("welcome", 1), step("tech", 3), step("check", 14)] });
    expect(s.days).toHaveLength(14);
    expect(s.days[0]).toMatchObject({ day: 1, date: "2026-11-30", past: true, today: false });
    expect(s.days[1]).toMatchObject({ day: 2, date: "2026-12-01", today: true });
    expect(s.days[2].steps.map((x) => x.key)).toEqual(["tech"]);
    expect(s.days[13].date).toBe("2026-12-13");
    expect(dateOfDay("2026-11-30", 14)).toBe("2026-12-13");
  });

  it("names the earliest open step next, whoever it waits on, and opens on its day", () => {
    const s = fourteenDays({ mine: true, day: 2, openedOn: "2026-11-01", items: [step("tech", 3), step("welcome", 1, { owner: "onboarding", ownerName: "Welcomers", mayTick: false })] });
    expect(s.next?.key).toBe("welcome");
    expect(s.focus).toBe(1);
    const after = fourteenDays({ mine: true, day: 2, openedOn: "2026-11-01", items: [step("tech", 3), step("welcome", 1, { doneAt: "2026-11-01" })] });
    expect(after.next?.key).toBe("tech");
    expect(after.focus).toBe(3);
  });

  it("is whole only when every step on it is done, and a step after day 14 stays in the list", () => {
    const items = [step("a", 2, { doneAt: "x" }), step("later", 30)];
    expect(splitSteps(items).later.map((x) => x.key)).toEqual(["later"]);
    const s = fourteenDays({ mine: true, day: 5, openedOn: "2026-11-01", items });
    expect(s.whole).toBe(true);
    expect(s.days.flatMap((d) => d.steps).map((x) => x.key)).toEqual(["a"]);
    expect(fourteenDays({ mine: true, day: 5, openedOn: "2026-11-01", items: [] }).whole).toBe(false); // nothing on it is not "walked"
  });

  it("walks the two weeks with the keyboard, held inside the fourteen days", () => {
    expect(moveDay(1, "ArrowRight")).toBe(2);
    expect(moveDay(1, "ArrowLeft")).toBe(1);
    expect(moveDay(3, "ArrowDown")).toBe(10);
    expect(moveDay(10, "ArrowDown")).toBe(14);
    expect(moveDay(9, "ArrowUp")).toBe(2);
    expect(moveDay(6, "End")).toBe(14);
    expect(moveDay(6, "Enter")).toBeNull();
  });
});
