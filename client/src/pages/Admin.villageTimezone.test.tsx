// @vitest-environment jsdom
/**
 * THE SEASON TAB ASKS WHICH CLOCK THE VILLAGE KEEPS.
 *
 * The platform ships `America/Costa_Rica`, every fork inherits it, and nothing
 * ever asked: seasons derive dated entries whatever the zone, so the launch
 * checklist's season item is green on a fresh village without anybody opening
 * this tab. The zone decides when a day, a season and the claims window turn,
 * and when every time on the calendar is shown.
 *
 * THE CONFIRM BUTTON IS THE POINT. A village really in Costa Rica has nothing
 * to change, so without a way to agree there is no way to answer at all, and
 * the stored zone cannot be read as agreement: this tab is handed the
 * normalised document, so a save writes the platform's zone back whether or
 * not a human looked.
 *
 * The field also gains an id and a label that points at it. It had neither, so
 * a screen reader met an unnamed box, and the checklist now sends people
 * straight to this control by name.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SeasonTab } from "./Admin";

const seasonDoc = (over: Record<string, unknown> = {}) => ({
  seasons: [{ id: "s1", name: "First season", theme: "", focus: "", startsOn: "2026-01-01", endsOn: "2026-04-01", goals: [] }],
  cadence: "solstice-equinox",
  timezone: "America/Costa_Rica",
  timezoneAnswer: null,
  currentId: "s1",
  today: "2026-02-01",
  suggestion: { startsOn: "2026-04-01", endsOn: "2026-07-01" },
  ...over,
});

const puts = () =>
  (globalThis.fetch as any).mock.calls.filter((c: any[]) => c[1]?.method === "PUT");

const answering = (doc: Record<string, unknown>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: any) => {
      if (init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ success: true }) };
      return { ok: true, status: 200, json: async () => doc };
    }),
  );

describe("the Season tab's timezone", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/admin?tab=season");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("has a name a screen reader can read, and an id a link can land on", async () => {
    answering(seasonDoc());
    render(<SeasonTab password="secret" />);
    const box = await screen.findByLabelText("Timezone");
    expect(box.id).toBe("season-timezone");
  });

  it("says the zone needs an answer, and ties that to the box", async () => {
    answering(seasonDoc());
    render(<SeasonTab password="secret" />);
    const box = await screen.findByLabelText("Timezone");
    expect(box.getAttribute("aria-describedby")).toBe("season-timezone-answer");
    expect(document.getElementById("season-timezone-answer")?.textContent).toMatch(/Needs your answer/);
  });

  it("confirms the zone already showing, which is the only way to agree", async () => {
    answering(seasonDoc());
    render(<SeasonTab password="secret" />);
    fireEvent.click(await screen.findByRole("button", { name: "This is right" }));
    await waitFor(() => {
      const body = JSON.parse(puts()[0][1].body);
      expect(body.confirmTimezone).toBe(true);
      // The zone goes with it unchanged: confirming is not editing.
      expect(body.timezone).toBe("America/Costa_Rica");
    });
  });

  it("stops asking once the village has answered", async () => {
    answering(seasonDoc({ timezoneAnswer: { at: "2026-09-01T00:00:00.000Z", by: "founder-1" } }));
    render(<SeasonTab password="secret" />);
    await screen.findByLabelText("Timezone");
    expect(screen.queryByText(/Needs your answer/)).toBeNull();
    expect(screen.queryByRole("button", { name: "This is right" })).toBeNull();
  });

  it("does not send a confirmation on an ordinary save", async () => {
    // The tab sends back the document it was handed, so treating a save as an
    // answer would mean renaming a season silently confirmed the clock.
    answering(seasonDoc());
    render(<SeasonTab password="secret" />);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts().length).toBe(1));
    expect(JSON.parse(puts()[0][1].body).confirmTimezone).toBeUndefined();
  });

  it("lands on the box when the checklist sends somebody here, and clears the address", async () => {
    window.history.replaceState({}, "", "/admin?tab=season&setting=season.timezone");
    answering(seasonDoc());
    render(<SeasonTab password="secret" />);
    await waitFor(() => {
      expect((document.activeElement as HTMLElement)?.id).toBe("season-timezone");
    });
    // Consumed, because Admin copies the query string between tabs and a key
    // left behind would grab focus every time somebody came back.
    await waitFor(() => expect(window.location.search).toBe("?tab=season"));
  });
});
