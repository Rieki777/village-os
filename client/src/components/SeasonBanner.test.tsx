// @vitest-environment jsdom
/**
 * The season strap names the season and the day it closes, never a countdown
 * (the art rules; batch 158: "49 days until the season turns" on /).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Router } from "wouter";

const state = vi.hoisted(() => ({ season: null as unknown }));
vi.mock("@/lib/gameApi", () => ({ useSeason: () => state.season }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

import SeasonBanner from "./SeasonBanner";

const entry = (over: Record<string, unknown> = {}) => ({ id: "s1", name: "Season of Foundations", theme: "", focus: "", startsOn: "2026-10-01", endsOn: "2026-12-31", goals: [], ...over });
const base = { needsNextSeason: false, daysUntilStart: 0, timezone: "UTC", cadence: "quarter", today: "2026-11-12" };

afterEach(cleanup);

describe("the season strap", () => {
  it("names the season and its closing day, with no count of days", () => {
    state.season = { ...base, current: entry(), upcoming: null, daysLeft: 49 };
    const { container } = render(<Router><SeasonBanner /></Router>);
    expect(container.textContent).toContain("Season of Foundations closes on 31 December 2026.");
    expect(container.textContent).not.toMatch(/\d+ days?/);
    expect(container.textContent).not.toMatch(/until the season turns/);
  });

  it("says nothing of a close for an open-ended season", () => {
    state.season = { ...base, current: entry({ endsOn: "" }), upcoming: null, daysLeft: null, openEnded: true };
    const { container } = render(<Router><SeasonBanner /></Router>);
    expect(container.querySelector("[data-season-closes]")).toBeNull();
  });

  it("names the day a coming season begins, never how many days away", () => {
    state.season = { ...base, current: null, upcoming: entry({ name: "Season of Rains", startsOn: "2027-01-01" }), daysLeft: null, daysUntilStart: 50 };
    const { container } = render(<Router><SeasonBanner /></Router>);
    expect(container.textContent).toContain("begins on 1 January 2027");
    expect(container.textContent).not.toMatch(/begins in \d/);
  });
});
