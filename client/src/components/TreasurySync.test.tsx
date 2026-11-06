// @vitest-environment jsdom
/**
 * THE INVOICE TRACK AND THE SYNC on the Cash card (invoice rails), against the
 * payloads the routes send. Pinned: the four steps read in order with who
 * acted; Sync calls the sync door, shows each source and when it was read,
 * marks a disagreement; a 429 is a sentence, never a blank; and the saved
 * view loads without pressing Sync.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-session" }));

import CashOwedPanel from "./CashOwedPanel";
import TreasurySync, { type TrackRow } from "./TreasurySync";

afterEach(() => vi.unstubAllGlobals());

const track: TrackRow = {
  invoiceId: "mv-1", ref: "us-llc-0007", cycleId: "lunar-000328", status: "approved", currency: "USD", totalMinor: 120000,
  track: [
    { step: "sent", done: true, at: "2026-11-06T10:00:00.000Z", by: "member", note: null, emailedAt: "2026-11-06T10:00:02.000Z" },
    { step: "received", done: false, at: null, by: null, note: null },
    { step: "approved", done: true, at: "2026-11-07T09:00:00.000Z", by: "finance", note: null },
    { step: "paid", done: false, at: null, by: null, note: null },
  ],
};

const view = (over: Record<string, unknown> = {}) => ({
  readAt: "2026-11-06T12:00:00.000Z", syncedAt: "2026-11-06T12:00:00.000Z", trigger: "manual", sera: "not_offered",
  sources: { amora: { state: "read", readAt: "2026-11-06T12:00:00.000Z" }, chain: { state: "not_offered", readAt: null }, sera: { state: "not_offered", readAt: null } },
  tokens: [{ slug: "equity", name: "Earned Equity", amora: "40.00", chain: null, chainReadAt: null, chainStale: false, disagree: false }],
  cash: [{ currency: "USD", owedMinor: 120000 }],
  invoices: [{ ref: "us-llc-0007", status: "approved", currency: "USD", amoraMinor: 120000, seraStatus: null, seraMinor: null, seraCurrency: null, seraAt: null, disagree: false }],
  flags: [], tracks: [track], ...over,
});

function routes(map: Record<string, { status?: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    const hit = map[`${init?.method ?? "GET"} ${url}`];
    const status = hit ? (hit.status ?? 200) : 404;
    return { ok: status < 400, status, json: async () => hit?.body ?? { error: "no" } };
  }));
  return calls;
}

describe("the invoice track", () => {
  it("reads four steps in order, each done one with its date and who acted, and the email to Sera", async () => {
    routes({ "GET /api/me/treasury": { body: { view: null } } });
    render(<TreasurySync tracks={[track]} />);
    const list = screen.getByRole("list", { name: "Invoice us-llc-0007" });
    const steps = within(list).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(steps[0]).toMatch(/Sent.*by the member/);
    expect(steps[0]).toMatch(/Emailed to Sera/);
    expect(steps[1]).toContain("Waiting for Sera to confirm");
    expect(steps[2]).toMatch(/Approved.*by the Finance role/);
    expect(steps[3]).toContain("Not paid yet");
  });

  it("a member with only an invoice sees the card and its track", async () => {
    routes({
      "GET /api/me/cash-owed": { body: { entries: [], mayPay: false } },
      "GET /api/me/invoice-track": { body: { tracks: [track] } },
      "GET /api/me/treasury": { body: { view: null } },
    });
    render(<CashOwedPanel />);
    expect(await screen.findByText("Your invoices")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Sync/ })).toBeTruthy();
  });
});

describe("the Sync", () => {
  it("shows the saved view without pressing Sync, and calls no source", async () => {
    const calls = routes({ "GET /api/me/treasury": { body: { view: view() } } });
    render(<TreasurySync tracks={[]} />);
    expect(await screen.findByText(/Last synced/)).toBeTruthy();
    expect(screen.getByText("Sera does not report invoices yet.")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("Sync posts to the sync door and marks every row whose sources disagree", async () => {
    const differing = view({
      sera: "read",
      sources: { amora: { state: "read", readAt: "2026-11-06T12:00:00.000Z" }, chain: { state: "read", readAt: "2026-11-06T12:00:00.000Z" }, sera: { state: "read", readAt: "2026-11-06T12:00:00.000Z" } },
      tokens: [{ slug: "equity", name: "Earned Equity", amora: "40.00", chain: "39", chainReadAt: "2026-11-06T12:00:00.000Z", chainStale: false, disagree: true }],
      invoices: [{ ref: "us-llc-0007", status: "approved", currency: "USD", amoraMinor: 120000, seraStatus: "approved", seraMinor: 110000, seraCurrency: "USD", seraAt: null, disagree: true }],
    });
    const calls = routes({ "GET /api/me/treasury": { body: { view: null } }, "POST /api/me/treasury/sync": { body: { view: differing } } });
    render(<TreasurySync tracks={[]} />);
    expect(await screen.findByText(/Not synced yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sync/ }));
    expect(await screen.findByText(/Some sources disagree/)).toBeTruthy();
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/me/treasury/sync")).toBe(true);
    expect(screen.getAllByText("Differs")).toHaveLength(2);
    expect(screen.getByText("$1,100.00")).toBeTruthy();
    expect(screen.getByText(/It only reads: nothing is paid or moved/)).toBeTruthy();
  });

  it("a second press inside a minute reads a sentence, never a blank", async () => {
    routes({ "GET /api/me/treasury": { body: { view: null } }, "POST /api/me/treasury/sync": { status: 429, body: { error: "rate_limited" } } });
    render(<TreasurySync tracks={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: /Sync/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Try again in a minute");
  });
});
