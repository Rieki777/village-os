/**
 * M10 (go-live design pass): the moon's window read "9 November 2026 to 8
 * December 2026" on a Spanish page. It is now Intl's own range format in the
 * reader's language, ending on the last instant inside the moon.
 */
import { describe, expect, it } from "vitest";
import { moonWindowIn } from "./MoonDock";

const START = "2026-11-09T12:00:00.000Z";
const END = "2026-12-09T00:00:00.000Z"; // the next new moon, exactly midnight: the moon's last day is the 8th

describe("the moon's window", () => {
  it("speaks Spanish on a Spanish page, with no English month in it", () => {
    const es = moonWindowIn("es", START, END, "UTC");
    expect(es).toMatch(/nov/);
    expect(es).toMatch(/dic/);
    expect(es).not.toMatch(/November|December/);
  });

  it("speaks English on an English page, and ends on the last day inside the moon", () => {
    const en = moonWindowIn("en-GB", START, END, "UTC");
    expect(en).toMatch(/9/);
    expect(en).toMatch(/8 Dec/);
    expect(en).not.toMatch(/9 Dec/);
  });

  it("draws nothing for a window it cannot read", () => {
    expect(moonWindowIn("en", "not a date", END)).toBe("");
  });
});
