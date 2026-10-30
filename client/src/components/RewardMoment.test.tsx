// @vitest-environment jsdom
/**
 * THE REWARD MOMENT ON SCREEN (0289), against the payloads the routes send.
 *
 *   1. Nothing landed: nothing renders, and nothing is marked seen.
 *   2. Something landed: one dialog names every line, announces it in a live
 *      region, and hands the keys back as seen at once, so no other device
 *      replays it.
 *   3. Celebrations turned off: nothing renders, and the keys are still
 *      marked seen, so the moment does not wait to ambush them later.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-session" }));

import RewardMoment from "./RewardMoment";

afterEach(() => vi.unstubAllGlobals());

const moment = {
  keys: ["ledger:11", "ledger:12", "cash:c-1"],
  lines: [
    {
      kind: "earned",
      work: "Seed bank shelves",
      tokens: [
        { token: "village-tokens", name: "Village tokens", units: 40, decimals: 0 },
        { token: "village-voice", name: "Voice", units: 5, decimals: 0 },
      ],
    },
    { kind: "cash_paid", work: "Rebuild the water tank", amountMinor: 2500000, currency: "CRC" },
  ],
};

function routes(map: Record<string, unknown>) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      const key = `${init?.method ?? "GET"} ${url}`;
      const payload = key in map ? map[key] : null;
      return { ok: payload !== null, status: payload !== null ? 200 : 404, json: async () => payload ?? { error: "no" } };
    }),
  );
  return calls;
}

describe("the reward moment", () => {
  it("renders nothing when nothing landed, and marks nothing seen", async () => {
    const calls = routes({ "GET /api/me/reward-moment": { keys: [], lines: [] } });
    const { container } = render(<RewardMoment />);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(container.innerHTML).toBe("");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("names every arrival in one dialog and marks them all seen at once", async () => {
    const calls = routes({
      "GET /api/me/reward-moment": moment,
      "GET /api/profile/prefs": { notify: {} },
      "POST /api/me/reward-moment/seen": { success: true, recorded: 3 },
    });
    render(<RewardMoment />);
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByText("Just landed")).toBeTruthy();
    expect(screen.getByRole("heading").textContent).toBe("2 things landed for you.");
    expect(dialog.textContent).toContain("40 Village tokens and 5 Voice for Seed bank shelves.");
    expect(dialog.textContent).toContain("Your cash for Rebuild the water tank was paid.");
    // The live region carries the same news as the card.
    expect(screen.getByRole("status").textContent).toBe(
      "40 Village tokens and 5 Voice for Seed bank shelves. Your cash for Rebuild the water tank was paid.",
    );
    const seen = calls.filter((c) => c.method === "POST");
    expect(seen).toEqual([{ url: "/api/me/reward-moment/seen", method: "POST", body: { keys: moment.keys } }]);

    fireEvent.click(screen.getByRole("button", { name: "Thank you" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays still for a member who turned celebrations off, and still marks the moment seen", async () => {
    const calls = routes({
      "GET /api/me/reward-moment": moment,
      "GET /api/profile/prefs": { notify: { celebrations: "off" } },
      "POST /api/me/reward-moment/seen": { success: true, recorded: 3 },
    });
    const { container } = render(<RewardMoment />);
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(container.innerHTML).toBe("");
  });
});
