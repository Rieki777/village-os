/**
 * The task board's dates are words, and the Not yet chips land on days the
 * server takes: after today, with the moons read from shared/lunar.ts.
 */
import { describe, expect, it } from "vitest";
import { TASK_COPY } from "@shared/sessionTasks";
import { civilDateKey, fullMoonsBetween, newMoonsBetween } from "@shared/lunar";
import { chipDates, dueWords, fromWords, isAfterToday, saidWords } from "../dateWords";
import { TODAY, makeTask } from "./taskFixture";

const ISO = /\d{4}-\d{2}-\d{2}/;

describe("dates in words", () => {
  it("writes a due date in words, never as an ISO date", () => {
    const d = dueWords({ dueOn: "2026-10-16", status: "open", canAnswer: true }, TODAY);
    expect(d).toEqual({ text: "By Friday 16 October", passed: false });
    expect(d.text).not.toMatch(ISO);
  });

  it("asks about a date gone by, in words, for an open task", () => {
    const d = dueWords({ dueOn: "2026-10-12", status: "open", canAnswer: true }, TODAY);
    expect(d.passed).toBe(true);
    expect(d.text).toBe(TASK_COPY.duePassed("Monday 12 October"));
    expect(d.text).not.toMatch(ISO);
  });

  it("asks only the people who can answer: anyone else reads the date gone by, with no question", () => {
    const d = dueWords({ dueOn: "2026-10-12", status: "open", canAnswer: false }, TODAY);
    expect(d).toEqual({ text: TASK_COPY.duePast("Monday 12 October"), passed: true });
    expect(d.text).not.toMatch(/\?/);
  });

  it("leaves a finished task's date as a plain line", () => {
    expect(dueWords({ dueOn: "2026-10-12", status: "done", canAnswer: true }, TODAY)).toEqual({ text: "By Monday 12 October", passed: false });
  });

  it("says No date for an undated task and for something that is not a date", () => {
    expect(dueWords({ dueOn: null, status: "open", canAnswer: true }, TODAY).text).toBe(TASK_COPY.noDate);
    expect(dueWords({ dueOn: "soon", status: "open", canAnswer: true }, TODAY).text).toBe(TASK_COPY.noDate);
  });

  it("adds the year only when it is not this year", () => {
    expect(saidWords("2026-10-09", TODAY)).toBe("Friday 9 October");
    expect(saidWords("2027-01-08", TODAY)).toBe("Friday 8 January 2027");
  });

  it("names the circle, or the session when there is no circle", () => {
    expect(fromWords(makeTask(), TODAY)).toBe("From the Garden circle · Friday 9 October");
    expect(fromWords(makeTask({ circleName: null }), TODAY)).toBe("From Weekly planning · Friday 9 October");
  });
});

describe("the Not yet chips", () => {
  it("puts This Friday after today, and a week on when today is a Friday", () => {
    expect(chipDates(TODAY, "UTC").thisFriday).toBe("2026-10-16");
    expect(chipDates("2026-10-16", "UTC").thisFriday).toBe("2026-10-23");
    expect(chipDates(TODAY, "UTC").nextWeek).toBe("2026-10-22");
  });

  it("lands the moon chips on the first new and full moon after today, from the lunar table", () => {
    const zone = "UTC";
    const chips = chipDates(TODAY, zone);
    const from = new Date(`${TODAY}T00:00:00Z`);
    const to = new Date("2026-12-01T00:00:00Z");
    const firstAfter = (moons: Date[]) => moons.map((m) => civilDateKey(m, zone)).find((d) => d > TODAY) ?? null;
    expect(chips.nextNewMoon).toBe(firstAfter(newMoonsBetween(from, to)));
    expect(chips.nextFullMoon).toBe(firstAfter(fullMoonsBetween(from, to)));
    expect(chips.nextNewMoon).not.toBeNull();
    expect(chips.nextFullMoon).not.toBeNull();
  });

  it("offers only days the server takes: every chip is after today", () => {
    for (const today of ["2026-10-15", "2026-10-16", "2026-12-31", "2027-02-27"]) {
      for (const date of Object.values(chipDates(today, "America/Costa_Rica"))) {
        if (date) expect(isAfterToday(date, today)).toBe(true);
      }
    }
  });

  it("refuses today, the past and anything that is not a date", () => {
    expect(isAfterToday(TODAY, TODAY)).toBe(false);
    expect(isAfterToday("2026-10-14", TODAY)).toBe(false);
    expect(isAfterToday("", TODAY)).toBe(false);
    expect(isAfterToday("2026-10-16", TODAY)).toBe(true);
  });
});
