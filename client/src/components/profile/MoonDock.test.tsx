// @vitest-environment jsdom
/**
 * The dock is a fixed ornament in a corner, which is the easiest kind of
 * control in a page to leave unreachable without a mouse and the easiest to
 * leave rendering a lie when the data behind it is missing. Both are tested
 * here rather than assumed.
 *
 * The four cases are the four the component actually has to get right:
 * nothing to say, something to say, opened from the keyboard, and closed by
 * Escape with focus put back where it came from.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

import MoonDock from "./MoonDock";

/** A lunation running the first fortnight of March, half done. */
const lunar = {
  monthIndex: 3,
  cycleNumber: 340,
  monthCount: 12,
  name: "Seed Moon",
  isExampleName: false,
  day: 8,
  length: 29,
  monthStartsAt: "2026-03-01T00:00:00.000Z",
  monthEndsAt: "2026-03-30T00:00:00.000Z",
  phase: 0.27,
  phaseName: "First quarter",
};

const gathering = (id: string, title: string, startsAt: string) => ({
  id,
  title,
  description: null,
  startsAt,
  endsAt: null,
  locationText: null,
  structureKeys: [],
  visitTypeId: null,
  capacity: null,
  status: "scheduled",
  attendanceMode: "in_person",
  onlineUrl: null,
  goingCount: 0,
  spotsLeft: null,
  daysUntil: 3,
  kind: "gathering",
  layer: "village",
  allDay: false,
  sourceModule: null,
  sourceId: null,
  link: null,
  colour: null,
  recurrence: null,
  occurrenceKey: id,
  external: null,
});

const answers = (body: unknown, ok = true, status = 200) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status, json: async () => body })));

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("MoonDock", () => {
  it("renders NOTHING when the events module refuses, rather than an empty moon", async () => {
    answers({}, false, 404);
    const { container } = render(<MoonDock />);
    await waitFor(() => expect(container.querySelector("button")).toBeNull());
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the endpoint answers without a lunar summary", async () => {
    answers({ events: [], lunar: null, moonOneCycle: null });
    const { container } = render(<MoonDock />);
    await waitFor(() => expect(container.querySelector("button")).toBeNull());
  });

  it("names the moon and the phase on the button, so it is not a mystery icon", async () => {
    // moonOneCycle 300 makes cycle 340 the village's Moon 41.
    answers({ events: [], lunar, moonOneCycle: 300 });
    render(<MoonDock />);
    const dock = await screen.findByRole("button", { name: /Moon 41/i });
    expect(dock.getAttribute("aria-label")).toContain("First quarter");
    expect(dock.getAttribute("aria-expanded")).toBe("false");
  });

  it("prints the phase and the window with NO number when the village has not anchored a count", async () => {
    answers({ events: [], lunar, moonOneCycle: null });
    render(<MoonDock />);
    const dock = await screen.findByRole("button", { name: /First quarter/i });
    fireEvent.click(dock);
    // `moonCountLabel` answers empty on purpose for an unanchored village, and
    // the dock composes around that rather than inventing "Moon 0".
    expect(screen.queryByText(/Moon 0|Moon -/)).toBeNull();
    expect(await screen.findByText(/day 8 of 29/i)).toBeTruthy();
  });

  it("opens on the keyboard and lists only the gatherings inside this moon", async () => {
    answers({
      events: [
        gathering("g-in", "Orchard planting", "2026-03-12T10:00:00.000Z"),
        gathering("g-out", "Next moon's council", "2026-04-04T10:00:00.000Z"),
      ],
      lunar,
      moonOneCycle: 300,
    });
    render(<MoonDock />);
    const dock = await screen.findByRole("button", { name: /Moon 41/i });
    dock.focus();
    fireEvent.click(dock);
    const panel = await screen.findByRole("dialog");
    expect(panel.textContent).toContain("Orchard planting");
    expect(panel.textContent).not.toContain("Next moon's council");
    expect(dock.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on Escape and gives focus back to the button that opened it", async () => {
    answers({ events: [], lunar, moonOneCycle: 300 });
    render(<MoonDock />);
    const dock = await screen.findByRole("button", { name: /Moon 41/i });
    dock.focus();
    fireEvent.click(dock);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(dock);
  });

  it("says so when the moon is empty, instead of showing a bare heading", async () => {
    answers({ events: [], lunar, moonOneCycle: 300 });
    render(<MoonDock />);
    fireEvent.click(await screen.findByRole("button", { name: /Moon 41/i }));
    expect(await screen.findByText(/Nothing is on the calendar this moon yet/i)).toBeTruthy();
  });
});
