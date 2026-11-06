// @vitest-environment jsdom
/**
 * THE SEASON SUMMARY CARD (idea 4), against the payload the route sends.
 *
 * Pinned:
 *   1. The shared picture's words carry cash ONLY when the member ticks it, and
 *      leave out each other section the member unticks. The screen shows all.
 *   2. The card on the profile renders the season, the work and the badges,
 *      marks what is left out of the picture, and says no rank or percentage.
 *   3. Nothing renders before a season has closed.
 *   4. The after-turn prompt is offered once, inside the window after the turn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SeasonSummary } from "@shared/seasonSummary";
import { SHARE_DEFAULTS } from "@shared/seasonSummary";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-session" }));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: () => "Thanks" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "usr-wren", name: "Wren Alder" } }) }));

import SeasonSummarySection from "./SeasonSummarySection";
import { seasonCardModel } from "@/lib/seasonCard";
import { markSeasonSeen, shouldOffer } from "./seen";

const SUMMARY: SeasonSummary = {
  season: { id: "s-dry", name: "Dry", startsOn: "2026-06-01", endedOn: "2026-09-01", closed: true },
  member: { name: "Wren Alder", handle: "wren" },
  tokens: [{ token: "credits", name: "Village Credits", kind: "credit", amount: 110 }],
  voice: [{ token: "village-voice", name: "Village Voice", kind: "voice", amount: 5 }],
  cash: [{ currency: "XTS", earnedMinor: 350000, paidMinor: 250000 }],
  gratitude: { sent: 5, sentNotes: 2, people: 2, received: 4, receivedNotes: 1 },
  counts: { quests: 2, roles: 1, proposals: 1 },
  top: [
    { kind: "role", id: "as-1", title: "Water Keeper", at: "2026-05-01T00:00:00.000Z", term: { from: "2026-05-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" }, paid: [] },
    { kind: "quest", id: "c-well", title: "Dig the well", at: "2026-07-15T12:00:00.000Z", paid: [] },
    { kind: "proposal", id: "b-kitchen", title: "Open a shared kitchen", at: "2026-07-15T12:00:00.000Z", paid: [] },
  ],
  badges: [{ id: "bd-water", name: "Water Bearer", icon: null, kind: "earned", count: 1 }],
  seasons: [{ id: "s-green", name: "Green", closed: false }, { id: "s-dry", name: "Dry", closed: true }],
};

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => localStorage.clear());

function serve(summary: SeasonSummary | null) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ summary }) };
  }));
  return calls;
}

describe("what the shared picture says", () => {
  it("keeps cash out until the member ticks it", () => {
    const words = (c = SHARE_DEFAULTS) => JSON.stringify(seasonCardModel(SUMMARY, c, "Thanks"));
    expect(SHARE_DEFAULTS.cash).toBe(false);
    expect(words()).not.toMatch(/Cash|XTS|3,500/);
    expect(words({ ...SHARE_DEFAULTS, cash: true })).toMatch(/Cash/);
  });

  it("leaves out earnings and gratitude when unticked, and keeps the work and badges", () => {
    const m = seasonCardModel(SUMMARY, { earnings: false, gratitude: false, cash: false }, "Thanks");
    expect(m.stats.map((s) => s.label)).toEqual(["Work"]);
    expect(m.top.map((c) => c.title)).toEqual(["Water Keeper", "Dig the well", "Open a shared kitchen"]);
    expect(m.badges).toEqual(["Water Bearer"]);
    expect(m.title).toBe("Wren's season");
  });

  it("names the season's span and the role's term", () => {
    const m = seasonCardModel(SUMMARY, SHARE_DEFAULTS, "Thanks");
    expect(m.eyebrow).toContain("Dry");
    expect(m.eyebrow).toMatch(/June 2026 to August 2026/);
    expect(m.top[0].detail).toMatch(/2026/);
  });
});

describe("the card on the profile", () => {
  it("shows the season, marks cash as yours alone, and ranks nobody", async () => {
    const calls = serve(SUMMARY);
    const { container } = render(<SeasonSummarySection />);
    await screen.findByText("Wren's season");
    expect(calls).toEqual(["/api/me/season-summary"]);
    expect(screen.getByText("Water Keeper")).toBeTruthy();
    expect(screen.getByText("Water Bearer")).toBeTruthy();
    expect(screen.getByText(/110/)).toBeTruthy();
    // Cash is shown to the member, flagged as not in the picture.
    const cash = screen.getByRole("heading", { name: "Cash" }).parentElement!;
    expect(cash.textContent).toContain("Only you see this");
    expect(container.textContent).not.toMatch(/rank|percent|%/i);
    // Ticking cash takes the flag away.
    fireEvent.click(screen.getByRole("checkbox", { name: "Cash" }));
    expect(screen.getByRole("heading", { name: "Cash" }).parentElement!.textContent).not.toContain("Only you see this");
    // Opening the card counts as seeing it.
    expect(shouldOffer(SUMMARY, "usr-wren", new Date("2026-09-05T00:00:00Z"))).toBe(false);
  });

  it("asks for another season by its id", async () => {
    const calls = serve(SUMMARY);
    render(<SeasonSummarySection />);
    const pick = await screen.findByRole("combobox");
    fireEvent.change(pick, { target: { value: "s-green" } });
    await waitFor(() => expect(calls).toContain("/api/me/season-summary?season=s-green"));
  });

  it("renders nothing before any season has closed", async () => {
    const calls = serve(null);
    const { container } = render(<SeasonSummarySection />);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(container.innerHTML).toBe("");
  });
});

describe("the after-turn prompt", () => {
  it("is offered inside the window after a turn, once", () => {
    expect(shouldOffer(SUMMARY, "usr-wren", new Date("2026-09-05T00:00:00Z"))).toBe(true);
    expect(shouldOffer(SUMMARY, "usr-wren", new Date("2026-11-20T00:00:00Z"))).toBe(false);
    expect(shouldOffer({ ...SUMMARY, season: { ...SUMMARY.season, closed: false } }, "usr-wren", new Date("2026-09-05T00:00:00Z"))).toBe(false);
    markSeasonSeen("usr-wren", "s-dry");
    expect(shouldOffer(SUMMARY, "usr-wren", new Date("2026-09-05T00:00:00Z"))).toBe(false);
    expect(shouldOffer(SUMMARY, "usr-other", new Date("2026-09-05T00:00:00Z"))).toBe(true);
  });
});
