// @vitest-environment jsdom
/**
 * WHAT A MEMBER AND A STEWARD READ ABOUT A REDEMPTION, against the payload the
 * routes really send.
 *
 * `server/routes/redemption.ts` converts every amount ONCE on the way out:
 * `held[slug] = fromLedgerUnits(...)` and `amount: fromLedgerUnits(...)` in
 * `forReading`. So the wire holds 50 for fifty credits, not 5000.
 *
 * Both components treated that number as minor units. The member's panel
 * divided it again, so a member who redeemed 50 credits was told 0.5 were held.
 * The steward's queue formatted it at 0 decimals, which truncates, so a steward
 * confirming a redemption of 12.5 read 12 and destroyed 12.5.
 *
 * The fixture token carries decimals 2, the ruled scale for credits, because at
 * decimals 0 every one of these renders is identical on the broken code.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-session" }));

import RedemptionPanel from "./RedemptionPanel";
import RedemptionQueue from "./RedemptionQueue";

const answering = (payload: unknown) =>
  vi.fn(async () => ({ ok: true, json: async () => payload })) as unknown as typeof fetch;

afterEach(() => vi.unstubAllGlobals());

const MEMBER_PAYLOAD = {
  open: [
    {
      id: "rdm-1", token: "credits", tokenName: "Village Credits", amount: 12.5, askedFor: "a bicycle",
      state: "requested", decisionNote: null, openedAt: "2026-09-01T00:00:00.000Z", expiresAt: null,
    },
  ],
  history: [
    {
      id: "rdm-0", token: "credits", tokenName: "Village Credits", amount: 50, askedFor: "a week of bread",
      state: "confirmed", decisionNote: null, openedAt: "2026-08-01T00:00:00.000Z", expiresAt: null,
    },
  ],
  // HUMAN, as `fromLedgerUnits` sends it: fifty credits held.
  held: { credits: 50 },
  holds: true,
  confirmedBy: "steward",
  votePathBuilt: true,
  perCycle: 3,
  openedThisCycle: 1,
  tokens: [{ slug: "credits", name: "Village Credits", decimals: 2 }],
};

describe("RedemptionPanel prints the human amounts the route sends", () => {
  it("tells a member the fifty credits they asked for are held, not half of one", async () => {
    vi.stubGlobal("fetch", answering(MEMBER_PAYLOAD));
    render(<RedemptionPanel />);
    const held = await screen.findByText(/are held against a redemption you have open/);
    expect(held.textContent).toContain("50 Village Credits are held");
    expect(held.textContent).not.toContain("0.5 Village Credits");
  });

  it("prints an open redemption of 12.5 as 12.5", async () => {
    vi.stubGlobal("fetch", answering(MEMBER_PAYLOAD));
    render(<RedemptionPanel />);
    const open = await screen.findByText(/for a bicycle, opened/);
    expect(open.textContent).toContain("12.5 Village Credits for a bicycle");
  });

  it("prints a past redemption as the amount that was destroyed", async () => {
    vi.stubGlobal("fetch", answering(MEMBER_PAYLOAD));
    render(<RedemptionPanel />);
    await waitFor(() => expect(screen.getByText(/a week of bread/)).toBeInTheDocument());
    expect(screen.getByText(/a week of bread/).textContent).toContain("50 Village Credits for a week of bread");
  });
});

describe("RedemptionQueue prints the true amount a steward is about to destroy", () => {
  it("reads 12.5 as 12.5, never truncated to 12", async () => {
    vi.stubGlobal(
      "fetch",
      answering({
        redemptions: [
          {
            id: "rdm-1", userId: "usr-wren", memberName: "Wren", token: "credits", tokenName: "Village Credits",
            amount: 12.5, askedFor: "a bicycle", openedAt: "2026-09-01T00:00:00.000Z", expiresAt: null, warnings: [],
          },
        ],
        holds: true,
      }),
    );
    render(<RedemptionQueue />);
    const row = await screen.findByText(/to become a bicycle/);
    expect(row.textContent).toContain("asked for 12.5 Village Credits");
  });
});
