/**
 * The signs the Gene Keys page sends, from the date, the town's clock and the
 * minutes the birth could fall in: the stated time, the window the member
 * chose, or the part of the day they named. Each span is read on its own, and a
 * sign is sent only when every span agrees on it. The rising sign is not read
 * yet: the town list carries no coordinates (docs/modules/gene-keys.md).
 */
import { describe, expect, it } from "vitest";
import { signsFor } from "./natal";

const DIANA = { year: 1961, month: 7, day: 1 };

describe("the signs the page sends", () => {
  it("reads an exact time as one instant", () => {
    expect(signsFor(DIANA, "Europe/London", [[19 * 60 + 45, 19 * 60 + 45]])).toEqual({ sun: 3, moon: 10, rising: null });
  });

  it("sends no Moon when it changed sign inside the part of the day the birth could be in, and keeps the Sun", () => {
    // 5 to 6 August 2024 in UTC: the Moon changes sign in the evening of the 5th (see shared/natalSigns.test.ts).
    const whole = signsFor({ year: 2024, month: 8, day: 5 }, "UTC", [[0, 1439]]);
    expect(whole.moon).toBeNull();
    expect(whole.sun).toBe(4);
  });

  it("asks every span to agree: two parts of the day that disagree send nothing for that sign", () => {
    const morning = signsFor({ year: 2024, month: 8, day: 5 }, "UTC", [[360, 600]]);
    expect(morning.moon).not.toBeNull();
    const both = signsFor({ year: 2024, month: 8, day: 5 }, "UTC", [[360, 600], [1380, 1439]]);
    expect(both.moon).toBeNull();
  });

  it("sends nothing from no spans", () => {
    expect(signsFor(DIANA, "Europe/London", [])).toEqual({ sun: null, moon: null, rising: null });
  });
});
