// @vitest-environment jsdom
/**
 * Our first 14 days on Profile Today: the strip for someone newly seated, the
 * steps on their days, the welcome named as waiting on the onboarding role, the
 * training step opening a page of this site in place, the list keeping only what
 * comes after day 14, and nothing of it for a path that is not the reader's own.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import OnboardingPath from "@/components/profile/OnboardingPath";

const item = (key: string, dueDay: number, over: Record<string, unknown> = {}) => ({
  key, kind: "plain", title: `Step ${key}`, owner: "holder", ownerName: "", dueDay, doneWhen: "Done", source: "village",
  phase: "Our first 14 days", phaseFrom: 1, phaseTo: 14, doneAt: null, mayTick: true, ...over,
});

function serve(path: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ paths: [{ id: "p1", roleName: "Gardener", title: "Our first 14 days", openedOn: "2026-11-30", dueOn: "2026-12-13", buddyUserId: null, buddyName: "", openCount: 1, checkinsDue: [], checkins: [], mayFile: false, ...path }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ITEMS = [
  item("welcome", 1, { owner: "onboarding", ownerName: "Welcomers", mayTick: false }),
  item("tech", 3),
  item("training", 10, { link: { label: "Open the steward training", href: "/training/steward" } }),
  item("later", 40, { phase: "Settling", phaseFrom: 15, phaseTo: 40 }),
];

describe("our first 14 days", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("draws the fourteen days for the reader's own new path, opened on the next step's day", async () => {
    serve({ mine: true, day: 2, items: ITEMS });
    render(<OnboardingPath />);
    const strip = await screen.findByText("Day 2 of 14");
    const root = strip.closest("[data-first-fourteen]") as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.querySelectorAll("[data-day]").length).toBeGreaterThanOrEqual(14);
    expect(root.querySelector("[data-next-step]")?.getAttribute("data-next-step")).toBe("welcome");
    expect(root.querySelector("[data-next-step]")?.textContent).toContain("With Welcomers");
    expect(root.querySelector("[data-chosen-day]")?.getAttribute("data-chosen-day")).toBe("1");
    // The welcome waits on the onboarding role: the holder cannot tick it.
    expect(within(root.querySelector("[data-chosen-day]") as HTMLElement).queryByRole("button", { name: "Mark done" })).toBeNull();
  });

  it("opens a day's steps when the day is chosen, and a page of this site opens in place", async () => {
    serve({ mine: true, day: 2, items: ITEMS });
    render(<OnboardingPath />);
    await screen.findByText("Day 2 of 14");
    fireEvent.click(document.querySelector('button[data-day="10"]') as HTMLElement);
    const panel = document.querySelector("[data-chosen-day]") as HTMLElement;
    expect(panel.getAttribute("data-chosen-day")).toBe("10");
    const link = within(panel).getByRole("link", { name: "Open the steward training" });
    expect(link.getAttribute("href")).toBe("/training/steward");
    expect(link.getAttribute("target")).toBeNull();
    expect(within(panel).getByRole("button", { name: "Mark done" })).toBeTruthy();
  });

  it("keeps only the steps after day 14 in the list under the strip", async () => {
    serve({ mine: true, day: 2, items: ITEMS });
    render(<OnboardingPath />);
    await screen.findByText("Day 2 of 14");
    expect(screen.getByText("After the first fourteen days")).toBeTruthy();
    // The strip opened on day 1 (the welcome), so day 3's step is on the strip only, never again in the list.
    expect(screen.queryAllByText("Step tech")).toHaveLength(0);
    fireEvent.click(document.querySelector('button[data-day="3"]') as HTMLElement);
    expect(screen.getAllByText("Step tech")).toHaveLength(1);
    expect(screen.getByText("Step later")).toBeTruthy();
  });

  it("control: a path that is not the reader's own, or past day 14, shows the list and no strip", async () => {
    serve({ mine: false, day: 2, items: ITEMS });
    const { unmount } = render(<OnboardingPath />);
    await screen.findByText("Step tech");
    expect(document.querySelector("[data-first-fourteen]")).toBeNull();
    unmount();
    serve({ mine: true, day: 15, items: ITEMS });
    render(<OnboardingPath />);
    await screen.findByText("Step tech");
    expect(document.querySelector("[data-first-fourteen]")).toBeNull();
  });

  it("unfurls a fern once every step on the strip is done", async () => {
    serve({ mine: true, day: 12, items: ITEMS.slice(0, 3).map((i) => ({ ...i, doneAt: "2026-12-01" })) });
    render(<OnboardingPath />);
    await screen.findByText("Day 12 of 14");
    expect(document.querySelector("[data-fourteen-whole]")).not.toBeNull();
    expect(document.querySelector("[data-next-step]")).toBeNull();
  });
});
