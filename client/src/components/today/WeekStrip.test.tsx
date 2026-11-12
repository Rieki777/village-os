// @vitest-environment jsdom
/**
 * The week on Profile Today: seven days from today, the next meeting of each
 * circle, the gatherings the calendar shows, the day a task is due, and one
 * quiet line with the calendar's door when nothing is on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "t", gameFetch: (url: string) => (globalThis as any).fetch(url) }));
import WeekStrip from "./WeekStrip";

const NOW = new Date(2026, 10, 11, 9, 0);
const at = (d: number, h: number) => new Date(2026, 10, d, h, 0).toISOString();

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the week strip", () => {
  it("lays out seven days from today, each with what is on it", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ events: [{ title: "Potluck", startsAt: at(13, 17), allDay: false, link: null, status: "published" }, { title: "Called off", startsAt: at(13, 19), status: "cancelled" }] }), { status: 200 });
    }));
    render(<WeekStrip now={NOW} eventsOn taskDue="2026-11-12" meetings={[{ circle: "Hearth", title: null, at: at(16, 18), href: "/sessions" }]} />);
    await screen.findByText("The next seven days");
    expect(calls[0]).toMatch(/^\/api\/events\?from=/);
    const days = document.querySelectorAll("button[data-week-day]");
    expect(days).toHaveLength(7);
    expect(days[0].hasAttribute("data-today")).toBe(true);
    expect(days[2].getAttribute("aria-label")).toContain("Potluck");
    expect(days[2].getAttribute("aria-label")).not.toContain("Called off");
    expect(days[5].getAttribute("aria-label")).toContain("Hearth");
    fireEvent.click(days[1]);
    const chosen = document.querySelector("[data-week-chosen]") as HTMLElement;
    expect(chosen.getAttribute("data-week-chosen")).toBe("1");
    expect(chosen.textContent).toContain("A task from your sessions is due");
  });

  it("asks the calendar nothing when it is closed, and says a quiet week once with no door", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    render(<WeekStrip now={NOW} eventsOn={false} taskDue={null} meetings={null} />);
    await screen.findByText("Nothing is on the calendar for you this week.");
    expect(f).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Open the calendar" })).toBeNull();
  });

  it("offers the calendar's door on a quiet week when the calendar is open", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ events: [] }), { status: 200 })));
    render(<WeekStrip now={NOW} eventsOn taskDue={null} meetings={[]} />);
    expect((await screen.findByRole("link", { name: "Open the calendar" })).getAttribute("href")).toBe("/events");
  });

  it("walks the days with the arrow keys", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ events: [] }), { status: 200 })));
    render(<WeekStrip now={NOW} eventsOn taskDue={null} meetings={[]} />);
    await screen.findByText("The next seven days");
    const group = screen.getByRole("group", { name: "The seven days" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(document.querySelector("[data-week-chosen]")?.getAttribute("data-week-chosen")).toBe("2");
    fireEvent.keyDown(group, { key: "End" });
    expect(document.querySelector("[data-week-chosen]")?.getAttribute("data-week-chosen")).toBe("6");
  });
});
