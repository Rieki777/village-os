/**
 * THE ALIGNED WORDS DO NOT CONTRADICT THEMSELVES (red team U7).
 *
 * A live walkthrough read "Paid by the moon" beside "XTS 1,500 a month", "No
 * standing gatherings" above "Times on the season's clock" and a scoreboard
 * measure counting gatherings, and a bonus cap that was the preset's template
 * sentence. These are the words both parties align with.
 */
import { describe, expect, it } from "vitest";
import { settingsWords, type SeatSettings } from "./seatSettings";
import { presetById } from "./seatPresets";

const row = (s: SeatSettings, group: string) => settingsWords(s).find((r) => r.group === group)!;

describe("the words of one set of terms agree with each other", () => {
  it("names the pay clock the pay amount is set on", () => {
    const s: SeatSettings = { v: 1, clocks: { pay: "moon", work: "moon" }, pay: { kind: "fixed", currency: "XTS", amountMinor: 150000, per: "month" } };
    expect(row(s, "clocks").headline).toBe("Paid by the calendar month, works by the moon");
    expect(row(s, "pay").headline).toContain("a month");
    // CONTROL: with no amount per anything, the clock reads as set.
    expect(row({ v: 1, clocks: { pay: "moon", work: "moon" } }, "clocks").headline).toBe("Paid by the moon, works by the moon");
  });

  it("says nothing about a clock for times when there are no times", () => {
    expect(row({ v: 1, rhythm: { gatherings: [] } }, "rhythm")).toMatchObject({ headline: "No standing gatherings", lines: [] });
    // CONTROL: a gathering keeps its clock line.
    expect(row({ v: 1, rhythm: { gatherings: [{ label: "Circle", weekday: 1, time: "10:00" }] } }, "rhythm").lines).toContain("Times on the season's clock");
  });

  it("starts no measure that counts gatherings, and binds no template sentence as a bonus cap", () => {
    const measures = (presetById("platform:starter-measures")!.values as any).measures as Array<{ measure: string }>;
    expect(measures.map((m) => m.measure)).not.toContain("Gatherings held");
    expect((presetById("platform:rated-equity-in-words")!.values as any).capWords).toBeUndefined();
  });
});
