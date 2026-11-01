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

  it("offers a year of cash received for each year the member was paid in, and none while nothing is paid", async () => {
    const paid = (id: string, paidAt: string) => ({ ...owed, id, state: "paid", paidAt, paidNote: "Bank transfer on 2026-01-02. Reference: X" });
    routes({ "GET /api/me/cash-owed": { entries: [paid("p1", "2026-02-01T00:00:00.000Z"), paid("p2", "2025-06-01T00:00:00.000Z"), owed], mayPay: false } });
    render(<CashOwedPanel />);
    expect(await screen.findByRole("button", { name: "Download cash received in 2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download cash received in 2025" })).toBeTruthy();
    vi.unstubAllGlobals();
    routes({ "GET /api/me/cash-owed": { entries: [owed], mayPay: false } });
    const { container } = render(<CashOwedPanel />);
    await waitFor(() => expect(container.textContent).toContain("Rebuild the water tank"));
    expect(container.textContent).not.toContain("Download cash received");
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

/*
 * E7's twin (2026-10-31): the payout page printed the gate's raw code, and so
 * did this card's buttons, which showed `error` as it came. A 401 or 403 is
 * now read as a sentence: the session that ran out, or who pays cash out.
 */
describe("the cash card, refused", () => {
  const WHO = "Paying cash out is the work of Treasurer (Tara). Write to them if you are waiting on a payment.";
  function answer(map: Record<string, { status: number; body: unknown }>) {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const hit = map[`${init?.method ?? "GET"} ${url}`] ?? { status: 404, body: { error: "no route" } };
      return { ok: hit.status < 300, status: hit.status, json: async () => hit.body };
    }));
  }

  it("asks for a fresh sign-in when a claim meets a session that ran out, never the code", async () => {
    answer({
      "GET /api/me/cash-owed": { status: 200, body: { entries: [owed], mayPay: false } },
      "POST /api/me/cash-owed/cash-1/claim": { status: 401, body: { error: "auth_required" } },
    });
    render(<CashOwedPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Claim" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Your sign-in has run out");
    expect(alert.textContent).not.toContain("auth_required");
  });

  it("tells a treasurer whose key was taken away who pays cash out now, never the code", async () => {
    answer({
      "GET /api/me/cash-owed": { status: 200, body: { entries: [], mayPay: true } },
      "GET /api/cash-owed/queue": {
        status: 200,
        body: { unpaid: [{ ...owed, state: "claimed", claimedAt: "2026-10-21T00:00:00.000Z", userId: "u-ora", memberName: "Ora", paidByName: null }], paid: [] },
      },
      "POST /api/cash-owed/cash-1/paid": { status: 403, body: { error: "cash_pay_required", message: WHO } },
    });
    render(<CashOwedPanel />);
    fireEvent.change(await screen.findByLabelText("How it was paid"), { target: { value: "Bank transfer" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));
    expect((await screen.findByRole("alert")).textContent).toBe(WHO);
  });
});
