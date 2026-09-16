// @vitest-environment jsdom
/**
 * What consents still owe, on /review, through the section's real render and
 * its real requests, with `fetch` answered at the boundary.
 *
 *  - an answer with nothing owed renders nothing, and so does a refused read;
 *  - a failed read says a payment may be waiting, and never reads as paid;
 *  - an owed row says why it is owed, and the press pays that claim through
 *    its own route, then reads the list again;
 *  - a row refused for good says why and offers no press;
 *  - a press the server refuses shows the server's own sentence and reads the
 *    list again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import OwedPostings from "./OwedPostings";

const headers = () => ({ Authorization: "Bearer t", "Content-Type": "application/json" });

const owedRow = (over: Record<string, unknown> = {}) => ({
  key: "queststay:c-1",
  claimId: "c-1",
  questTitle: "Mend the fence",
  holder: "Ada",
  tokenSlug: "stay-credit",
  units: 200,
  decimals: 2,
  state: "owed",
  refusalReason: "not_launched",
  lastError: "The Game has not started",
  attempts: 1,
  createdAt: 1757900000,
  ...over,
});

type Reply = { status: number; body: unknown };

/** Answers each `METHOD url` from its queue, repeating the last reply once the queue is down to one. */
function serve(replies: Record<string, Reply[]>) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(init?.method ?? "GET");
      calls.push({ url: String(url), method });
      const queue = replies[`${method} ${url}`] ?? [];
      const reply = (queue.length > 1 ? queue.shift() : queue[0]) ?? { status: 500, body: { error: "unexpected request" } };
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => reply.body,
      } as unknown as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

describe("what consents still owe, on /review", () => {
  it("renders nothing when nothing is owed", async () => {
    const calls = serve({ "GET /api/admin/quest-claims/owed": [{ status: 200, body: [] }] });
    const { container } = render(<OwedPostings headers={headers} />);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(container.textContent).toBe("");
  });

  it("renders nothing for a reader the gate refuses", async () => {
    const calls = serve({ "GET /api/admin/quest-claims/owed": [{ status: 403, body: { error: "Consenting to finished work is for stewards" } }] });
    const { container } = render(<OwedPostings headers={headers} />);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(container.textContent).toBe("");
  });

  it("says a failed read may be hiding a payment, and never reads as paid", async () => {
    serve({ "GET /api/admin/quest-claims/owed": [{ status: 500, body: { error: "The database is away" } }] });
    render(<OwedPostings headers={headers} />);
    expect(await screen.findByText("What consents still owe did not load")).toBeTruthy();
    expect(screen.getByText(/The database is away\. A member may be waiting for a payment/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pay what is owed" })).toBeNull();
  });

  it("reads an answer it cannot render as a failure, never as an empty list or a crash", async () => {
    // What Review.test.tsx once served here: the claims list, from a matcher on the path prefix.
    serve({ "GET /api/admin/quest-claims/owed": [{ status: 200, body: [{ id: "c-1", questTitle: "A claim, not an owed row" }] }] });
    render(<OwedPostings headers={headers} />);
    expect(await screen.findByText("What consents still owe did not load")).toBeTruthy();
    expect(screen.getByText(/The answer about what consents still owe could not be read\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pay what is owed" })).toBeNull();
  });

  it("says why a row is still owed, and the press pays that claim through its own route", async () => {
    const calls = serve({
      "GET /api/admin/quest-claims/owed": [
        { status: 200, body: [owedRow()] },
        { status: 200, body: [] },
      ],
      "POST /api/admin/quest-claims/c-1/owed/pay": [
        { status: 200, body: { outcomes: [{ key: "queststay:c-1", outcome: "posted", tokenSlug: "stay-credit" }], rows: [] } },
      ],
    });
    render(<OwedPostings headers={headers} />);
    expect(await screen.findByText("Mend the fence")).toBeTruthy();
    expect(
      screen.getByText("2 stay credits: still owed, because the village has not started its Game, so nothing may issue yet."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pay what is owed" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Paid."));
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["/api/admin/quest-claims/c-1/owed/pay"]);
    // The list is read again after the press, and nothing is owed any more.
    await waitFor(() => expect(screen.queryByText("Mend the fence")).toBeNull());
  });

  it("gives a row refused for good its reason, and no press", async () => {
    serve({
      "GET /api/admin/quest-claims/owed": [
        {
          status: 200,
          body: [owedRow({ key: "k-credits", tokenSlug: "credits", units: 2500, state: "refused", refusalReason: "rule", lastError: "unknown token" })],
        },
      ],
    });
    render(<OwedPostings headers={headers} />);
    expect(await screen.findByText("25 credits: refused for good, because the ledger refused it (unknown token).")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pay what is owed" })).toBeNull();
  });

  it("shows the server's own sentence when a press is refused, and reads the list again", async () => {
    const calls = serve({
      "GET /api/admin/quest-claims/owed": [{ status: 200, body: [owedRow()] }],
      "POST /api/admin/quest-claims/c-1/owed/pay": [{ status: 403, body: { error: "Consenting to finished work is for stewards" } }],
    });
    render(<OwedPostings headers={headers} />);
    fireEvent.click(await screen.findByRole("button", { name: "Pay what is owed" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Consenting to finished work is for stewards"));
    await waitFor(() => expect(calls.filter((c) => c.method === "GET").length).toBe(2));
  });
});
