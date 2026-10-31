// @vitest-environment jsdom
/**
 * THE CASH CARD ON THE PROFILE (0285), against the payloads the routes send.
 *
 * Three things a reader could get wrong, each pinned:
 *
 *   1. A member who is owed nothing and keeps no books sees nothing at all,
 *      and the page never asks for the books (ruling 28: no 401 on an
 *      ordinary page).
 *   2. A member owed cash can claim it, and the claim goes to their own row.
 *   3. Whoever holds `cash.pay` reads the village's list and can only mark a
 *      row paid once they have said how it was paid.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-session" }));

import CashOwedPanel from "./CashOwedPanel";

afterEach(() => vi.unstubAllGlobals());

const owed = {
  id: "cash-1", workKind: "quest", workRef: "q-1", workTitle: "Rebuild the water tank", amountMinor: 2500000,
  currency: "CRC", state: "owed", owedAt: "2026-10-20T00:00:00.000Z", claimedAt: null, paidAt: null, paidNote: null,
};

function routes(map: Record<string, unknown>) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    const key = `${init?.method ?? "GET"} ${url}`;
    const payload = key in map ? map[key] : null;
    return { ok: payload !== null, status: payload !== null ? 200 : 403, json: async () => payload ?? { error: "no" } };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

describe("the cash card", () => {
  it("renders nothing for a member owed nothing, and never asks for the books", async () => {
    const calls = routes({ "GET /api/me/cash-owed": { entries: [], mayPay: false } });
    const { container } = render(<CashOwedPanel />);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(container.innerHTML).toBe("");
    expect(calls.some((c) => c.url === "/api/cash-owed/queue")).toBe(false);
    expect(container.querySelector('a[href="/cash-payouts"]')).toBeNull();
  });

  it("shows what a member is owed and claims it on their own row", async () => {
    const calls = routes({
      "GET /api/me/cash-owed": { entries: [owed], mayPay: false },
      "POST /api/me/cash-owed/cash-1/claim": { success: true },
    });
    render(<CashOwedPanel />);
    expect(await screen.findByText("Owed to you")).toBeTruthy();
    expect(screen.getByText(/Rebuild the water tank/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/me/cash-owed/cash-1/claim")).toBe(true));
  });

  it("gives the treasurer the village's list, and marks a row paid only with a note", async () => {
    const calls = routes({
      "GET /api/me/cash-owed": { entries: [], mayPay: true },
      "GET /api/cash-owed/queue": {
        unpaid: [{ ...owed, state: "claimed", claimedAt: "2026-10-21T00:00:00.000Z", userId: "u-ora", memberName: "Ora", paidByName: null }],
        paid: [],
      },
      "POST /api/cash-owed/cash-1/paid": { success: true },
    });
    render(<CashOwedPanel />);
    expect(await screen.findByText("What the village owes")).toBeTruthy();
    // A finance role holding cash.pay without admin reaches the full payout list from here.
    expect(screen.getByRole("link", { name: "Record a bank transfer" }).getAttribute("href")).toBe("/cash-payouts");
    expect(screen.getByText(/to Ora/)).toBeTruthy();
    const mark = screen.getByRole("button", { name: "Mark paid" }) as HTMLButtonElement;
    expect(mark.disabled, "no note, no payment").toBe(true);
    fireEvent.change(screen.getByLabelText("How it was paid"), { target: { value: "Bank transfer" } });
    expect(mark.disabled).toBe(false);
    fireEvent.click(mark);
    await waitFor(() => {
      const posted = calls.find((c) => c.method === "POST" && c.url === "/api/cash-owed/cash-1/paid");
      expect(posted?.body).toEqual({ note: "Bank transfer" });
    });
  });
});
