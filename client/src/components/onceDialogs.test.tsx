// @vitest-environment jsdom
/**
 * THE ONCE DIALOGS TAKE TURNS. Layout mounts two dialogs a member sees once:
 * the reward moment (pay landed) and the season-turned offer. A member whose
 * season turns while pay lands used to get both, stacked.
 *
 * Pinned:
 *   1. Both due: pay first, alone; the season offer opens only after the
 *      reward moment is closed, and two dialogs are never on screen at once.
 *   2. Each still opens alone when the other has nothing (the controls).
 *   3. The season offer waits while the reward moment is still loading.
 *   4. A member with celebrations off is not kept from their season.
 *   5. A reload while the offer waits does not use up its one ask this
 *      browser session: it comes back on the next load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SeasonSummary } from "@shared/seasonSummary";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-session" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "usr-wren", name: "Wren Alder" } }) }));

import RewardMoment from "./RewardMoment";
import SeasonSummaryOffer from "./seasonSummary/SeasonSummaryOffer";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const SUMMARY: SeasonSummary = {
  season: { id: "s-dry", name: "Dry", startsOn: day(-90), endedOn: day(-2), closed: true },
  member: { name: "Wren Alder", handle: "wren" },
  tokens: [],
  voice: [],
  cash: [],
  gratitude: { sent: 0, sentNotes: 0, people: 0, received: 0, receivedNotes: 0 },
  counts: { quests: 0, roles: 0, proposals: 0 },
  top: [],
  badges: [],
  seasons: [{ id: "s-dry", name: "Dry", closed: true }],
};

const MOMENT = {
  keys: ["ledger:11"],
  lines: [{ kind: "earned", work: "Seed bank shelves", tokens: [{ token: "village-tokens", name: "Village tokens", units: 40, decimals: 0 }] }],
};
const NOTHING = { keys: [], lines: [] };

type Serve = { moment?: unknown; season?: SeasonSummary | null; prefs?: unknown; momentGate?: Promise<void> };

function serve({ moment = MOMENT, season = SUMMARY, prefs = { notify: {} }, momentGate }: Serve) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      let body: unknown = null;
      if (u === "/api/me/reward-moment") {
        if (momentGate) await momentGate;
        body = moment;
      } else if (u === "/api/me/reward-moment/seen") body = { success: true };
      else if (u === "/api/profile/prefs") body = prefs;
      else if (u === "/api/me/season-summary") body = { summary: season };
      return { ok: true, status: 200, json: async () => body };
    }),
  );
}

/** The most dialogs ever on screen together while the test ran. */
function watchDialogs() {
  let most = 0;
  const count = () => {
    most = Math.max(most, document.querySelectorAll('[role="dialog"]').length);
  };
  const obs = new MutationObserver(count);
  obs.observe(document.body, { childList: true, subtree: true });
  return { most: () => (count(), most), stop: () => obs.disconnect() };
}

const both = () => (
  <>
    <RewardMoment />
    <SeasonSummaryOffer />
  </>
);
const seasonOffer = () => screen.queryByText("Dry has turned");
const SLOW = { timeout: 6000 };
/** Past the offer's own wait (2.5s) and its breath after the floor frees (0.6s), with room. */
const PAST_DUE = 4500;

/**
 * Let real time pass in short act() steps. One long act(sleep) would hold
 * React's effects until it ends, so a timer an effect starts (the offer's
 * breath) could never fire inside the wait and "it stayed hidden" would be
 * true of any code at all.
 */
async function settle(ms: number) {
  for (let t = 0; t < ms; t += 100) await act(() => new Promise((r) => setTimeout(r, 100)));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the once dialogs take turns", () => {
  it("shows pay first, alone, and the season offer only after it is closed", async () => {
    serve({});
    const seen = watchDialogs();
    render(both());
    await screen.findByText("Just landed");
    // Past the offer's own wait: it is due, and it still holds back.
    await settle(PAST_DUE);
    expect(seasonOffer()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Thank you" }));
    await waitFor(() => expect(seasonOffer()).not.toBeNull(), SLOW);
    expect(screen.queryByText("Just landed")).toBeNull();
    expect(seen.most()).toBe(1);
    seen.stop();
  }, 15000);

  it("hands over when the reward moment is dismissed mid-animation", async () => {
    serve({});
    const seen = watchDialogs();
    render(both());
    await screen.findByText("Just landed");
    // The instant it opens, while the celebration is still drawing.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Just landed")).toBeNull();
    await waitFor(() => expect(seasonOffer()).not.toBeNull(), SLOW);
    expect(seen.most()).toBe(1);
    seen.stop();
  }, 15000);

  it("control: the season offer opens alone when nothing landed", async () => {
    serve({ moment: NOTHING });
    render(both());
    await waitFor(() => expect(seasonOffer()).not.toBeNull(), SLOW);
  }, 15000);

  it("control: the reward moment opens alone when no season turned", async () => {
    serve({ season: null });
    render(both());
    await screen.findByText("Just landed");
    fireEvent.click(screen.getByRole("button", { name: "Thank you" }));
    await settle(PAST_DUE);
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(0);
  }, 15000);

  it("waits while the reward moment is still loading, then opens when nothing landed", async () => {
    let open!: () => void;
    const momentGate = new Promise<void>((r) => (open = r));
    serve({ moment: NOTHING, momentGate });
    render(both());
    await settle(PAST_DUE);
    expect(seasonOffer()).toBeNull();
    open();
    await waitFor(() => expect(seasonOffer()).not.toBeNull(), SLOW);
  }, 15000);

  it("does not keep a member with celebrations off from their season", async () => {
    serve({ prefs: { notify: { celebrations: "off" } } });
    render(both());
    await waitFor(() => expect(seasonOffer()).not.toBeNull(), SLOW);
    expect(screen.queryByText("Just landed")).toBeNull();
  }, 15000);

  it("keeps its one ask for the next load when the page reloads while it waits", async () => {
    serve({});
    const first = render(both());
    await screen.findByText("Just landed");
    await settle(PAST_DUE);
    expect(seasonOffer()).toBeNull();
    first.unmount();

    // The reload: the reward moment was marked seen and has nothing now.
    serve({ moment: NOTHING });
    render(both());
    await waitFor(() => expect(seasonOffer()).not.toBeNull(), SLOW);
  }, 20000);
});
