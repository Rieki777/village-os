// @vitest-environment jsdom
/**
 * ON A PHONE, IN THE MOON VIEW, THE CLOCK LINE AND THE FESTIVALS DOOR SIT
 * UNDER THE MOON (batch 157, C3 Q3); everywhere else they stay under the
 * lede. They are drawn in one place at a time.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import CalendarNotes, { notesUnderMoon, usePhoneWidth } from "./CalendarNotes";

afterEach(() => {
  cleanup();
  // @ts-expect-error a test's own stand-in, removed after each case
  delete window.matchMedia;
});

function screenWidth(px: number) {
  window.matchMedia = ((q: string) => {
    const max = /max-width:\s*(\d+)px/.exec(q);
    return {
      matches: max ? px <= Number(max[1]) : false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

describe("where the calendar's two quiet lines sit", () => {
  it("goes under the moon on a phone in the moon view, and only there", () => {
    expect(notesUnderMoon(true, "moon", true)).toBe(true);
    expect(notesUnderMoon(false, "moon", true)).toBe(false);
    expect(notesUnderMoon(true, "month", true)).toBe(false);
    expect(notesUnderMoon(true, "moon", false)).toBe(false);
  });

  it("reads a phone at 390 and a desktop at 1280", () => {
    screenWidth(390);
    expect(renderHook(() => usePhoneWidth()).result.current).toBe(true);
    cleanup();
    screenWidth(1280);
    expect(renderHook(() => usePhoneWidth()).result.current).toBe(false);
  });

  it("says the clock and the festivals door, and no clock line before the calendar has loaded", () => {
    render(<CalendarNotes zoneLine="Times are in the village's clock." />);
    expect(screen.getByText("Times are in the village's clock.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Seasonal Festivals" }).getAttribute("href")).toBe("/seasonal-festivals");
    cleanup();
    render(<CalendarNotes zoneLine={null} />);
    expect(screen.getByTestId("calendar-notes").querySelectorAll("p").length).toBe(1);
  });
});
