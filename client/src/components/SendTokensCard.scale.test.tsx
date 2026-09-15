// @vitest-environment jsdom
/**
 * WHAT A MEMBER READS AND WHAT THE SEND ACTUALLY POSTS, AT TWO DECIMALS.
 *
 * This codebase has twice shipped a display that divided while its input did
 * not, so the assertion here is on the REQUEST BODY and never on the screen. A
 * test that reads the rendered balance and then reads the rendered balance again
 * proves that one function is consistent with itself.
 *
 * The card is driven the way a member drives it: the wallet payload arrives
 * carrying minor units and a per-token scale, the balance is read off the
 * screen, an amount is typed, and the fetch that leaves the browser is caught
 * and its JSON body inspected. The two numbers have to describe the same
 * quantity, and at `decimals: 2` a hundred-fold error is the failure mode that
 * would otherwise look plausible on both sides.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The card needs a signed-in member and a session token, and neither is what
// this file is asking about. Same two stubs `WalletCard.test.tsx` uses.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "usr-ora", name: "Ora" } }),
}));
vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-session" }));

import SendTokensCard from "./SendTokensCard";
import { CURRENCY_DECIMALS } from "@shared/tokenScale";

/** One whole credit in minor units, at the scale the ruling gives credits. */
const ONE_WHOLE = 10 ** CURRENCY_DECIMALS;

/** The member holds twelve whole credits and fifty hundredths. */
const HELD_MINOR = 12 * ONE_WHOLE + 50;

/**
 * The shape `GET /api/wallet` actually ships, read off the card's own `load()`:
 * `sendable` is the select's options, `ledger` is MINOR units verbatim, and
 * `tokenDecimals` is the per-token scale that travels beside it.
 */
const walletPayload = {
  sendable: [{ slug: "credits", name: "Village Credits" }],
  ledger: { credits: HELD_MINOR },
  tokenDecimals: { credits: CURRENCY_DECIMALS },
};

describe("a credit balance a member reads, and what the send posts", () => {
  let sent: Array<{ url: string; body: any }>;

  beforeEach(() => {
    sent = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init: any) => {
        const u = String(url);
        if (init?.method === "POST") {
          sent.push({ url: u, body: JSON.parse(String(init.body)) });
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, sent: sent[sent.length - 1].body.amount, tokenName: "Village Credits", to: "Ash" }),
          } as any;
        }
        return { ok: true, status: 200, json: async () => walletPayload } as any;
      }),
    );
    vi.stubGlobal("localStorage", {
      getItem: () => "test-token",
      setItem: () => undefined,
      removeItem: () => undefined,
    } as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the balance divided, and posts what the member typed multiplied back", async () => {
    render(<SendTokensCard />);

    // THE SCREEN. 1250 minor units at two decimals is 12.50 credits, and the
    // undivided number would read 1250, which is the defect this asserts is
    // gone.
    await waitFor(() => expect(screen.getByText(/12\.5/)).toBeTruthy());
    expect(screen.queryByText(new RegExp(`\\b${HELD_MINOR}\\b`))).toBeNull();

    const user = userEvent.setup();
    // The card labels its fields "Their email" and "How much", so the selectors
    // are the copy a member actually sees.
    await user.type(screen.getByLabelText(/their email/i), "ash@examples.invalid");
    const amount = screen.getByLabelText(/how much/i);
    await user.clear(amount);
    // A member types the number they read, in whole credits and hundredths.
    await user.type(amount, "3.25");
    await user.click(screen.getByRole("button", { name: /send/i }));

    // THE REQUEST BODY, which is the only side of this that moves value.
    await waitFor(() => expect(sent.length).toBe(1));
    const posted = sent[0].body;
    expect(sent[0].url).toContain("/api/wallet/send");
    // 3.25 credits at two decimals is 325 minor units. Not 3, which is what a
    // card that never multiplied would send, and not 32500, which is what one
    // that multiplied twice would.
    expect(posted.amount).toBe(325);
    expect(posted.amount).not.toBe(3);
    expect(posted.amount).not.toBe(325 * ONE_WHOLE);
    // And the round trip closes: what was posted, divided back, is what was
    // typed. A display and an input that disagree fail here whichever of the
    // two is wrong.
    expect(posted.amount / ONE_WHOLE).toBe(3.25);
  });
});
