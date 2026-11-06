// @vitest-environment jsdom
/**
 * CASH TO PAY OUT, THE ADMIN VIEW (0285, 2026-10-30), against the payloads the
 * routes send. What each case pins:
 *
 *   1. A refusal from the one gate is shown as a sentence, and nothing else
 *      renders: the panel decides no permission of its own.
 *   2. Lines are grouped by member, with a running total per currency at the
 *      top, and the claimed and currency filters narrow both.
 *   3. Recording a bank transfer sends only the picked lines, the date and the
 *      reference, after a confirm step. No amount is ever sent.
 *   4. The Paid tab shows the record: who paid, and the note.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CashPayoutsTab from "./CashPayoutsTab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const line = (over: Record<string, unknown>) => ({
  workKind: "role", workRef: "r-1", amountMinor: 1000000, currency: "CRC", state: "owed",
  owedAt: "2026-10-01T00:00:00.000Z", claimedAt: null, paidAt: null, paidNote: null, paidByName: null,
  ...over,
});

const QUEUE = {
  unpaid: [
    line({ id: "c1", userId: "ora", memberName: "Ora", workTitle: "Treasurer, 2026-10", amountMinor: 2000000 }),
    line({ id: "c2", userId: "ora", memberName: "Ora", workKind: "quest", workTitle: "Fix the pump", amountMinor: 500000, state: "claimed", claimedAt: "2026-10-05T00:00:00.000Z" }),
    line({ id: "c3", userId: "ben", memberName: "Ben", workKind: "proposal", workTitle: "Website copy", amountMinor: 10000, currency: "USD" }),
  ],
  paid: [
    line({ id: "c9", userId: "ben", memberName: "Ben", workTitle: "Gardener, 2026-09", state: "paid", paidAt: "2026-10-02T00:00:00.000Z", paidByName: "Tara", paidNote: "Bank transfer on 2026-10-01. Reference: BAC 1" }),
  ],
};

function routes(map: Record<string, { status: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: any; auth: string | undefined }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.Authorization });
    const hit = map[`${init?.method ?? "GET"} ${url}`] ?? { status: 404, body: { error: "no route" } };
    return { ok: hit.status < 300, status: hit.status, json: async () => hit.body };
  }));
  return calls;
}

const totals = () => screen.getByRole("region", { name: "Totals" });

describe("Cash to pay out", () => {
  it("shows the gate's refusal and nothing else", async () => {
    routes({ "GET /api/cash-owed/queue?history=1": { status: 403, body: { error: "forbidden", message: "Only the Treasurer may read this." } } });
    render(<CashPayoutsTab password="tok" />);
    expect((await screen.findByRole("alert")).textContent).toBe("Only the Treasurer may read this.");
    expect(screen.queryByText("Record a bank transfer")).toBeNull();
  });

  it("groups by member with per-currency totals, and the filters narrow them", async () => {
    const calls = routes({ "GET /api/cash-owed/queue?history=1": { status: 200, body: QUEUE } });
    render(<CashPayoutsTab password="tok" />);
    expect(await screen.findByRole("heading", { name: "Ora" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ben" })).toBeTruthy();
    expect(calls[0].auth).toBe("Bearer tok");
    expect(within(totals()).getByTestId("total-CRC").textContent).toContain("25,000");
    expect(within(totals()).getByTestId("total-USD").textContent).toContain("100");

    fireEvent.change(screen.getByLabelText("Claimed"), { target: { value: "claimed" } });
    expect(screen.queryByRole("heading", { name: "Ben" })).toBeNull();
    expect(screen.getByText(/Fix the pump/)).toBeTruthy();
    expect(screen.queryByText(/Treasurer, 2026-10/)).toBeNull();
    expect(within(totals()).getByTestId("total-CRC").textContent).toContain("5,000");

    fireEvent.change(screen.getByLabelText("Claimed"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "USD" } });
    expect(screen.queryByRole("heading", { name: "Ora" })).toBeNull();
    expect(within(totals()).queryByTestId("total-CRC")).toBeNull();
  });

  it("records a transfer for the picked lines only, after a confirm, and never sends an amount", async () => {
    const calls = routes({
      "GET /api/cash-owed/queue?history=1": { status: 200, body: QUEUE },
      "POST /api/cash-owed/transfers": { status: 200, body: { success: true, paid: 1 } },
    });
    render(<CashPayoutsTab password="tok" />);
    const ora = (await screen.findByRole("heading", { name: "Ora" })).closest("li")!;
    fireEvent.click(within(ora).getByRole("button", { name: "Record a bank transfer" }));
    // Every line starts picked; untick one for a partial transfer.
    fireEvent.click(within(ora).getByLabelText("Include Fix the pump"));
    const review = within(ora).getByRole("button", { name: "Review the transfer" }) as HTMLButtonElement;
    expect(review.disabled, "no reference, no transfer").toBe(true);
    fireEvent.change(within(ora).getByLabelText("Day the transfer went out"), { target: { value: "2026-10-29" } });
    fireEvent.change(within(ora).getByLabelText("Bank reference or note"), { target: { value: "BAC 77812" } });
    fireEvent.click(review);
    expect(within(ora).getByText(/Record 1 line/)).toBeTruthy();
    expect(calls.some((c) => c.method === "POST"), "nothing is sent before the confirm").toBe(false);
    fireEvent.click(within(ora).getByRole("button", { name: "Yes, record it" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const posted = calls.find((c) => c.method === "POST")!;
    expect(posted.url).toBe("/api/cash-owed/transfers");
    expect(posted.body).toEqual({ userId: "ora", ids: ["c1"], transferDate: "2026-10-29", reference: "BAC 77812" });
    expect(await screen.findByText(/Recorded\. 1 line is paid, and Ora has been told\./)).toBeTruthy();
  });

  it("shows a refusal from a second submit as a sentence", async () => {
    routes({
      "GET /api/cash-owed/queue?history=1": { status: 200, body: QUEUE },
      "POST /api/cash-owed/transfers": { status: 409, body: { error: "These lines are already recorded as paid. Nothing was paid twice.", code: "already_paid" } },
    });
    render(<CashPayoutsTab password="tok" />);
    const ben = (await screen.findByRole("heading", { name: "Ben" })).closest("li")!;
    fireEvent.click(within(ben).getByRole("button", { name: "Record a bank transfer" }));
    fireEvent.change(within(ben).getByLabelText("Bank reference or note"), { target: { value: "ref" } });
    fireEvent.click(within(ben).getByRole("button", { name: "Review the transfer" }));
    fireEvent.click(within(ben).getByRole("button", { name: "Yes, record it" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was paid twice");
  });

  it("shows the paid history with who paid and the note", async () => {
    routes({ "GET /api/cash-owed/queue?history=1": { status: 200, body: QUEUE } });
    render(<CashPayoutsTab password="tok" />);
    await screen.findByRole("heading", { name: "Ora" });
    fireEvent.click(screen.getByRole("tab", { name: "Paid" }));
    expect(screen.getByText(/by Tara/)).toBeTruthy();
    expect(screen.getByText("Bank transfer on 2026-10-01. Reference: BAC 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record a bank transfer" })).toBeNull();
  });
});

/*
 * E7 (2026-10-31): on /cash-payouts a member without the key read the raw
 * code "auth_required", and the page had no h1. A refusal now reads as a
 * sentence with a way forward, and a machine code is never printed.
 */
describe("Cash to pay out, refused or signed out", () => {
  const WHO = "Paying cash out is the work of Treasurer (Tara). Write to them if you are waiting on a payment.";
  const openTransfer = async (name: string) => {
    const card = (await screen.findByRole("heading", { name })).closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: "Record a bank transfer" }));
    fireEvent.change(within(card).getByLabelText("Bank reference or note"), { target: { value: "BAC 1" } });
    fireEvent.click(within(card).getByRole("button", { name: "Review the transfer" }));
    fireEvent.click(within(card).getByRole("button", { name: "Yes, record it" }));
    return card;
  };

  it("asks somebody signed out to sign in, with a way back here, and never shows the code", async () => {
    routes({ "GET /api/cash-owed/queue?history=1": { status: 401, body: { error: "auth_required" } } });
    render(<CashPayoutsTab password="tok" asPage />);
    expect(await screen.findByText("Sign in to read the cash the village owes.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe(`/login?next=${encodeURIComponent("/")}`);
    expect(screen.getByRole("heading", { level: 1, name: "Cash to pay out" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("auth_required");
  });

  it("asks for sign-in without a request when there is no session at all", async () => {
    const calls = routes({});
    render(<CashPayoutsTab password="" asPage />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("tells a member without the key who pays cash out, and how to reach them", async () => {
    routes({ "GET /api/cash-owed/queue?history=1": { status: 403, body: { error: "cash_pay_required", message: WHO } } });
    render(<CashPayoutsTab password="tok" asPage />);
    expect((await screen.findByRole("alert")).textContent).toBe(WHO);
    expect(screen.getByRole("link", { name: "Write a message" }).getAttribute("href")).toBe("/messages?new=1");
    expect(screen.getByRole("heading", { level: 1, name: "Cash to pay out" })).toBeTruthy();
    expect(screen.queryByText("Record a bank transfer")).toBeNull();
  });

  it("never prints a bare code when a refusal carries no sentence", async () => {
    routes({ "GET /api/cash-owed/queue?history=1": { status: 403, body: { error: "auth_required" } } });
    render(<CashPayoutsTab password="tok" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("auth_required");
    expect(alert.textContent).toContain("treasurer's key");
  });

  it("keeps the h2 inside the admin panel, where the panel owns the h1", async () => {
    routes({ "GET /api/cash-owed/queue?history=1": { status: 200, body: QUEUE } });
    render(<CashPayoutsTab password="tok" />);
    expect(await screen.findByRole("heading", { level: 2, name: "Cash to pay out" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("gives the page its h1 when the list loads", async () => {
    routes({ "GET /api/cash-owed/queue?history=1": { status: 200, body: QUEUE } });
    render(<CashPayoutsTab password="tok" asPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Cash to pay out" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ora" })).toBeTruthy();
  });

  it("keeps the transfer form and asks for sign-in when the session runs out mid-page", async () => {
    routes({
      "GET /api/cash-owed/queue?history=1": { status: 200, body: QUEUE },
      "POST /api/cash-owed/transfers": { status: 401, body: { error: "auth_required" } },
    });
    render(<CashPayoutsTab password="tok" asPage />);
    const ora = await openTransfer("Ora");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Your sign-in has run out");
    expect(within(alert).getByRole("link", { name: "Sign in again" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("auth_required");
    expect((within(ora).getByLabelText("Bank reference or note") as HTMLInputElement).value, "what they typed is kept").toBe("BAC 1");
  });

  it("closes the list when the key is taken away while the page is open", async () => {
    routes({
      "GET /api/cash-owed/queue?history=1": { status: 200, body: QUEUE },
      "POST /api/cash-owed/transfers": { status: 403, body: { error: "cash_pay_required", message: WHO } },
    });
    render(<CashPayoutsTab password="tok" asPage />);
    await openTransfer("Ben");
    expect((await screen.findByRole("alert")).textContent).toBe(WHO);
    expect(screen.queryByRole("heading", { name: "Ora" }), "no list left to act on").toBeNull();
    expect(screen.queryByText("Record a bank transfer")).toBeNull();
  });

  it("says the export needs a fresh sign-in, never the code", async () => {
    routes({
      "GET /api/cash-owed/queue?history=1": { status: 200, body: QUEUE },
      "GET /api/cash-owed/export.csv": { status: 401, body: { error: "auth_required" } },
    });
    render(<CashPayoutsTab password="tok" />);
    await screen.findByRole("heading", { name: "Ora" });
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Your sign-in has run out");
    expect(alert.textContent).not.toContain("auth_required");
  });
});
