// @vitest-environment jsdom
/**
 * The moon spiral and the strip of days, rendered: one seed per day, today and
 * the chosen day marked, the keyboard walking the days on a desktop, the strip
 * choosing a day with one tap, and the turnings opening their days.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { civilDayFor, type CivilDay } from "./calendarTime";
import { moonDays } from "./moonSpiral";
import MoonSpiral from "./MoonSpiral";
import DayStrip from "./DayStrip";
import MoonTurnings from "./MoonTurnings";

const TZ = "America/Costa_Rica";
const today = civilDayFor(2026, 11, 12, TZ);
const moon = moonDays(today, today, "december_solstice", TZ, new Map())!;
const dayName = (d: CivilDay) => `Day ${d.key}`;
const shortDate = (d: CivilDay) => d.key.slice(5);

function screenWidth(wide: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: wide && q.includes("min-width: 1024px"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MoonSpiral", () => {
  it("draws one seed per day, today and the full moon among them", () => {
    screenWidth(false);
    render(<MoonSpiral moon={moon} selectedKey={today.key} onSelect={() => {}} timezone={TZ} hemisphere="north" dayName={dayName} shortDate={shortDate} />);
    const seeds = screen.getAllByRole("button");
    expect(seeds).toHaveLength(29);
    const t = screen.getByRole("button", { name: /Day 2026-11-12, day 4 of 29, today/ });
    expect(t.getAttribute("data-today")).toBe("true");
    expect(t.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("button", { name: /Day 2026-11-24.*full moon/ }).getAttribute("data-full")).toBe("true");
    // One tab stop for the whole spiral: the arrows do the rest.
    expect(seeds.filter((s) => s.getAttribute("tabindex") === "0")).toHaveLength(1);
    // A phone names no seeds in the drawing; the strip and the panel carry the words.
    expect(document.querySelectorAll("text")).toHaveLength(0);
  });

  it("names the turning points beside their seeds on a desktop", () => {
    screenWidth(true);
    render(<MoonSpiral moon={moon} selectedKey={today.key} onSelect={() => {}} timezone={TZ} hemisphere="north" dayName={dayName} shortDate={shortDate} />);
    const words = Array.from(document.querySelectorAll("text")).map((n) => n.textContent);
    expect(words).toEqual(expect.arrayContaining(["Today", "Full moon, 11-24", "New moon, 11-09"]));
    expect(screen.getByTestId("moon-spiral").getAttribute("viewBox")).toBe("0 0 720 580");
  });

  it("walks the days with the arrow keys, across into the next moon, and jumps with Home and End", () => {
    screenWidth(true);
    const onSelect = vi.fn();
    render(<MoonSpiral moon={moon} selectedKey="2026-12-07" onSelect={onSelect} timezone={TZ} hemisphere="north" dayName={dayName} shortDate={shortDate} />);
    const last = screen.getByRole("button", { name: /Day 2026-12-07/ });
    expect(last.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(last, { key: "ArrowRight" });
    expect(onSelect.mock.calls.at(-1)![0].key).toBe("2026-12-08");
    fireEvent.keyDown(last, { key: "ArrowLeft" });
    expect(onSelect.mock.calls.at(-1)![0].key).toBe("2026-12-06");
    fireEvent.keyDown(last, { key: "Home" });
    expect(onSelect.mock.calls.at(-1)![0].key).toBe("2026-11-09");
    fireEvent.keyDown(last, { key: "End" });
    expect(onSelect.mock.calls.at(-1)![0].key).toBe("2026-12-07");
    const calls = onSelect.mock.calls.length;
    fireEvent.keyDown(last, { key: "a" });
    expect(onSelect.mock.calls.length).toBe(calls);
  });

  it("opens a day on a tap", () => {
    screenWidth(false);
    const onSelect = vi.fn();
    render(<MoonSpiral moon={moon} selectedKey={today.key} onSelect={onSelect} timezone={TZ} hemisphere="north" dayName={dayName} shortDate={shortDate} />);
    fireEvent.click(screen.getByRole("button", { name: /Day 2026-11-20/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "2026-11-20" }));
  });
});

describe("DayStrip", () => {
  it("holds every day of the moon as a stone and chooses one with a tap", () => {
    const onSelect = vi.fn();
    render(<DayStrip days={moon.days} selectedKey="2026-11-15" onSelect={onSelect} weekdayShort={() => "Wd"} dayName={dayName} />);
    const stones = screen.getAllByRole("button");
    expect(stones).toHaveLength(29);
    expect(screen.getByRole("button", { name: /Day 2026-11-15/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Day 2026-11-12, today/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Day 2026-11-24, full moon/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "2026-11-24" }));
  });
});

describe("MoonTurnings", () => {
  it("lists the new moon, the full moon and the next new moon, each a door to its day", () => {
    const onSelect = vi.fn();
    render(<MoonTurnings moon={moon} dayFor={(k) => { const [y, m, d] = k.split("-").map(Number); return civilDayFor(y, m, d, TZ); }} onSelect={onSelect} dayName={dayName} />);
    const rows = screen.getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      "New moon, this moon opensDay 2026-11-09",
      "Full moonDay 2026-11-24",
      "New moon, the next moon opensDay 2026-12-08",
    ]);
    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "2026-11-24" }));
  });
});
