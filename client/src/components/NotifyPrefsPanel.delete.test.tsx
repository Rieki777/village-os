// @vitest-environment jsdom
/**
 * The delete screen, as the fifth exit suggestion has it (Rye, 2026-10-30):
 * it lists what the member holds, says none of it can be recovered, and offers
 * leaving the village instead, which keeps their tokens. Deleting stays their
 * right (Costa Rica Law 8968), so the button that deletes is never taken away.
 *
 * The list is read from `GET /api/me/holdings` when the panel opens, the same
 * two reads a departure makes, so everything shown is exactly what leaving
 * would keep. A member holding nothing sees the screen as it always was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { formatMoney } from "@shared/money";

vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: () => false }));
vi.mock("@/components/EmailFromVillage", () => ({ default: () => null }));
vi.mock("@/components/alignment/LeavingEnds", () => ({
  default: () => null,
  useTermsLeavingEnds: () => null,
  leftEndedWords: () => "",
}));
vi.mock("@/components/auth/ConfirmWithGoogle", () => ({
  useIdentityConfirm: () => ({ confirmed: false, returnError: "", reset: () => {} }),
  IdentityConfirmField: () => null,
  identityBody: () => ({}),
  identityReady: () => false,
}));

import NotifyPrefsPanel, { type OwnHoldings } from "@/components/NotifyPrefsPanel";

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const notify = { emailsOff: true, celebrations: "on" };
const fetchMock = vi.fn();
let holdings: OwnHoldings | null = null;

beforeEach(() => {
  holdings = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/profile/prefs") return reply(200, { notify });
    if (url === "/api/profile") return reply(200, { contactable: true });
    if (url === "/api/me/holdings") return holdings ? reply(200, holdings) : reply(500, { error: "down" });
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const openDeleteScreen = async () => {
  render(<NotifyPrefsPanel />);
  fireEvent.click(await screen.findByText("Delete my account"));
};

describe("the delete screen names what deleting leaves behind", () => {
  it("lists the tokens and the unpaid cash, says none of it can be recovered, and offers leaving instead", async () => {
    holdings = {
      held: [
        { token: "credits", name: "Credits", amount: 50 },
        { token: "village-voice", name: "Village Voice", amount: 3 },
      ],
      cash: [{ currency: "USD", amountMinor: 2500 }],
    };
    await openDeleteScreen();

    const list = await screen.findByRole("group", { name: "What you still hold here" });
    expect(within(list).getByText("50 Credits")).toBeTruthy();
    expect(within(list).getByText("3 Village Voice")).toBeTruthy();
    expect(within(list).getByText(`${formatMoney(2500, "USD")} in cash the village still owes you`)).toBeTruthy();
    expect(list.textContent).toContain("none of it can be recovered");

    const leave = within(list).getByRole("link", { name: "Leave the village instead" });
    expect(leave.getAttribute("href")).toBe("/exit-policy?focus=begin-departure");
    expect(list.textContent).toContain("Leaving keeps your account, your tokens and any cash owed to you");
    // Read once the panel opened, never before: the list is the one standing while they decide.
    expect(fetchMock.mock.calls.filter(([u]) => u === "/api/me/holdings")).toHaveLength(1);

    // Deleting stays their right: the button is still there.
    expect(screen.getByRole("button", { name: "Delete forever" })).toBeTruthy();
  });

  it("cash alone is enough to show the list and the way out", async () => {
    holdings = { held: [], cash: [{ currency: "EUR", amountMinor: 700 }] };
    await openDeleteScreen();
    const list = await screen.findByRole("group", { name: "What you still hold here" });
    expect(within(list).getByText(`${formatMoney(700, "EUR")} in cash the village still owes you`)).toBeTruthy();
    expect(within(list).getByRole("link", { name: "Leave the village instead" })).toBeTruthy();
  });

  it("holding nothing, the screen is as it always was", async () => {
    holdings = { held: [], cash: [] };
    await openDeleteScreen();
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === "/api/me/holdings")).toBe(true));
    expect(screen.queryByRole("group", { name: "What you still hold here" })).toBeNull();
    expect(screen.queryByText("Leave the village instead")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete forever" })).toBeTruthy();
  });

  it("a failed read leaves the screen as it was and never blocks deleting", async () => {
    holdings = null;
    await openDeleteScreen();
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === "/api/me/holdings")).toBe(true));
    expect(screen.queryByRole("group", { name: "What you still hold here" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete forever" })).toBeTruthy();
  });

  it("does not ask before the member opens the delete screen", async () => {
    holdings = { held: [{ token: "credits", name: "Credits", amount: 1 }], cash: [] };
    render(<NotifyPrefsPanel />);
    await screen.findByText("Delete my account");
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/me/holdings")).toBe(false);
  });
});
