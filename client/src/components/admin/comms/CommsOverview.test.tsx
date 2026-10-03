// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import CommsOverview from "@/components/admin/comms/CommsOverview";

/**
 * The Comms Overview (the comms build spec 5.15 and 6): the setup banner until
 * the six required items are green, the last 30 days, the next 7, each
 * journey, the failures, and the Run now control that reaches
 * `POST /api/admin/comms/run`.
 */

type Call = { url: string; method: string; body: any; auth: string | null };

function overview(over: Record<string, unknown> = {}) {
  return {
    lifecycle: "members",
    paused: false,
    setup: {
      ready: false,
      done: 4,
      total: 6,
      open: [
        { key: "delivery-reports", label: "Delivery reports", fix: "Press Connect delivery reports." },
        { key: "test-email", label: "A test email to yourself, delivered", fix: "Send yourself a test." },
      ],
    },
    numbers: { days: 30, byStatus: { delivered: 5, bounced: 1, queued: 2 }, byKind: { events: 6, essential: 2 } },
    upcoming: {
      days: 7,
      total: 2,
      next: [
        { id: "m1", at: null, kind: "events", origin: "journey", subject: "See you tomorrow", journeyKey: "gathering.going", stepKey: "day" },
        { id: "m2", at: 1790000000, kind: "paths", origin: "journey", subject: "Your first step", journeyKey: "path.resident", stepKey: "first_step" },
      ],
      letters: [{ id: "l1", subject: "October news", scheduledFor: 1790003600, recipientCount: 40 }],
    },
    journeys: [
      { key: "gathering.going", kind: "event", steps: 3, state: "on", edited: false, active: 7 },
      { key: "path.resident", kind: "path", steps: 5, state: "off", edited: true, active: 0 },
    ],
    failures: [
      { id: "f1", toEmail: "gone@example.test", kind: "events", origin: "journey", subject: "See you tomorrow", status: "bounced", lastError: null, at: 1789990000 },
    ],
    jobs: ["drain", "journeys", "polls"],
    ...over,
  };
}

let calls: Call[];
let answer: any;

beforeEach(() => {
  calls = [];
  answer = overview();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      const method = String(init?.method ?? "GET");
      const body = init?.body ? JSON.parse(init.body) : null;
      calls.push({ url: u, method, body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null });
      if (u.endsWith("/admin/comms/run")) {
        return { ok: true, status: 200, json: async () => ({ job: body.job, summary: { sent: 3, failed: 0 }, ranAt: "2026-10-02T12:00:00Z" }) };
      }
      return { ok: true, status: 200, json: async () => answer };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Comms Overview", () => {
  it("shows the setup banner while required items are open, naming them and pointing at Settings", async () => {
    render(<CommsOverview password="secret" />);
    expect(await screen.findByText("Setup is not finished: 4 of 6 required steps done.")).toBeTruthy();
    expect(screen.getByText(/Delivery reports\. Press Connect delivery reports\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Comms Settings" }).getAttribute("href")).toBe("/admin?tab=comms-settings");
    expect(calls[0]).toMatchObject({ url: expect.stringMatching(/\/admin\/comms\/overview$/), method: "GET", auth: "Bearer secret" });
  });

  it("drops the banner once every required item is green", async () => {
    answer = overview({ setup: { ready: true, done: 6, total: 6, open: [] } });
    render(<CommsOverview password="secret" />);
    await screen.findByText("The last 30 days");
    expect(screen.queryByText(/Setup is not finished/)).toBeNull();
  });

  it("sums up the last 30 days, the week ahead, each journey and every failure", async () => {
    render(<CommsOverview password="secret" />);
    await screen.findByText("The last 30 days");
    // Written is every row, whatever became of it.
    expect(screen.getByText("Written").previousSibling?.textContent).toBe("8");
    expect(screen.getByText("Delivered").previousSibling?.textContent).toBe("5");
    expect(screen.getByText("Gatherings: 6")).toBeTruthy();
    expect(screen.getByText("2 emails waiting.")).toBeTruthy();
    expect(screen.getByText("Letter: October news")).toBeTruthy();
    expect(screen.getByText("As soon as the post office runs")).toBeTruthy();
    expect(screen.getByText("Gatherings, for everybody who said yes")).toBeTruthy();
    expect(screen.getByText("On, 7 walking it now")).toBeTruthy();
    expect(screen.getByText("Off, edited here, 0 walking it now")).toBeTruthy();
    expect(screen.getByText(/to gone@example\.test/)).toBeTruthy();
  });

  it("runs a job now through the run route and says what it did", async () => {
    render(<CommsOverview password="secret" />);
    await userEvent.click(await screen.findByRole("button", { name: "Send what is due now" }));
    await waitFor(() => expect(screen.getByText(/sent 3, failed 0/)).toBeTruthy());
    const run = calls.find((c) => /\/admin\/comms\/run$/.test(c.url))!;
    expect(run).toMatchObject({ method: "POST", body: { job: "drain" }, auth: "Bearer secret" });
    // The overview is read again, so its numbers show what the run changed.
    expect(calls.filter((c) => /\/admin\/comms\/overview$/.test(c.url)).length).toBe(2);
  });

  it("names every job the server offers, including one it adds later", async () => {
    answer = overview({ jobs: ["drain", "journeys", "polls", "letters"] });
    render(<CommsOverview password="secret" />);
    expect(await screen.findByRole("button", { name: "Move the journeys forward" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settle the time votes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "letters" })).toBeTruthy();
  });
});
