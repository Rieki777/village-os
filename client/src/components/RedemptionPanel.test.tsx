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

/*
 * THE MONEY BLOCK AS THE SERVER REALLY SENDS IT, read off a live village
 * rather than invented. A hand-made `{ processText }` with nothing else in it
 * blanked the whole panel, because one reader is `data.money?.currencies.length`
 * - optional on `money` and not on `currencies` - so a partial fixture throws
 * where the real payload never would. An invented fixture that cannot crash
 * the way production does is testing a different component.
 */
const MONEY = {
  currencies: ["CHF"], currency: "CHF", rateSource: "exchange", rateMinor: null,
  feePct: 0, feeFixedMinor: 0, minMinor: 0, maxPerRequestMinor: 0,
  memberCapMinor: 0, villageCapMinor: 0, processText: "",
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

/*
 * AN UNWRITTEN PROCESS IS A FACT, NOT AN ABSENCE.
 *
 * The block used to render only when the text was non-empty, so a village that
 * switched redemption on without writing its process showed the member nothing
 * at all - no instructions and no sign that any were missing. Ruling 11 says a
 * warning never blocks but is kept where the person who can act on it sees it,
 * and silence is neither.
 *
 * BOTH CASES ARE HERE and the pair is the point. A fix that always printed the
 * fallback would satisfy the first case while burying every village that DID
 * write its process, which is the more common state and the more expensive one
 * to break.
 */
describe("what the member is told about a process the village never wrote", () => {
  it("says plainly that the village has not written one, rather than showing nothing", async () => {
    vi.stubGlobal("fetch", answering({ ...MEMBER_PAYLOAD, money: { ...MONEY, processText: "" } }));
    render(<RedemptionPanel />);
    const heading = await screen.findByText("How redemption works here");
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(/has not written it down yet/)).toBeInTheDocument();
  });

  it("and prints the village's own words when there are any", async () => {
    vi.stubGlobal(
      "fetch",
      answering({ ...MEMBER_PAYLOAD, money: { ...MONEY, processText: "Call Suzy and she will send a bank transfer." } }),
    );
    render(<RedemptionPanel />);
    expect(await screen.findByText(/Call Suzy and she will send a bank transfer\./)).toBeInTheDocument();
    expect(screen.queryByText(/has not written it down yet/)).toBeNull();
  });
});

/*
 * ONE PAYLOAD FOR EVERY URL STOPPED BEING HONEST when the queue gained a
 * second call. `RedemptionQueue` now asks the MEMBER route whether the viewer
 * holds `redemption.confirm` and only then asks the admin route, so a stub
 * that answered both with the same body was answering the first question with
 * a queue - which carries no `mayConfirm`, so the component correctly stopped.
 * The old stub was a fiction that happened to work; this one answers each
 * route as the server does.
 */
const answeringRoutes = (byUrl: Record<string, unknown>) =>
  vi.fn(async (url: unknown) => {
    const hit = Object.entries(byUrl).find(([prefix]) => String(url).startsWith(prefix));
    return { ok: Boolean(hit), json: async () => hit?.[1] ?? {} };
  }) as unknown as typeof fetch;

describe("RedemptionQueue prints the true amount a steward is about to destroy", () => {
  it("reads 12.5 as 12.5, never truncated to 12", async () => {
    vi.stubGlobal(
      "fetch",
      answeringRoutes({
        "/api/admin/redemptions": {
        redemptions: [
          {
            id: "rdm-1", userId: "usr-wren", memberName: "Wren", token: "credits", tokenName: "Village Credits",
            amount: 12.5, askedFor: "a bicycle", openedAt: "2026-09-01T00:00:00.000Z", expiresAt: null, warnings: [],
          },
        ],
          holds: true,
        },
        // The hint that decides whether the admin route is asked at all.
        "/api/redemptions": { mayConfirm: true },
      }),
    );
    render(<RedemptionQueue />);
    const row = await screen.findByText(/to become a bicycle/);
    expect(row.textContent).toContain("asked for 12.5 Village Credits");
  });
});
