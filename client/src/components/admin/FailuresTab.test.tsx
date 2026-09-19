// @vitest-environment jsdom
/**
 * The What's Failing tab, rendered.
 *
 * The route and the job behind it have their own server tests. What only a
 * render can prove is the tab's promise about itself: an empty report, a report
 * that could not be read, and a report that has stopped updating never look
 * alike. Each state is rendered from the payload the route sends, and asserted
 * on the words a founder reads.
 *
 * `fetch` is stubbed, the way HandoverTab.test.tsx stubs it: what is under test
 * here is the tab's wiring and its states, never the route.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import FailuresTab from "./FailuresTab";

const JOB = {
  everyMinutes: 60,
  schedulerEnabled: true,
  lastRunSecondsAgo: 12 * 60,
  lastResult: "ok in 40ms: 13 areas read, 3 things failing",
};

const item = (over: Record<string, unknown>) => ({
  area: "Payments",
  source: "payments",
  key: "stays:ord-1",
  title: "A payment for stays order ord-1 did not settle",
  advice: "Look the order up in Stripe.",
  lastError: null,
  failingForSeconds: 3600,
  resolvedSecondsAgo: null,
  ...over,
});

const REPORT = {
  open: [
    item({ lastError: "order row not found", failingForSeconds: 8 * 3600 }),
    item({ key: "sig_fail", title: "3 payment deliveries in the last day had a signature that did not match", advice: "Check the signing secret." }),
    item({ area: "Linked villages", source: "peers", key: "p1", title: "The link to Northfield is paused", advice: "Open Village Network.", failingForSeconds: 2 * 86400 }),
  ],
  resolved: [
    item({ area: "Recording summaries", source: "synthesis", key: "failed", title: "1 recording failed to get a summary", resolvedSecondsAgo: 2 * 3600 }),
  ],
  blindSpots: ["Emails that fail to send."],
  job: JOB,
};

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("FailuresTab", () => {
  it("asks the report route, carrying the admin token", async () => {
    respond(200, REPORT);
    render(<FailuresTab password="secret" />);
    await screen.findByText("The link to Northfield is paused");
    const [url, init] = (globalThis.fetch as unknown as { mock: { calls: any[][] } }).mock.calls[0];
    expect(url).toBe("/api/admin/failures");
    expect(init.headers.Authorization).toBe("Bearer secret");
  });

  it("groups what is failing by area, with how long, what to do, and what the system recorded", async () => {
    respond(200, REPORT);
    render(<FailuresTab password="secret" />);
    expect(await screen.findByText("Payments (2)")).toBeInTheDocument();
    expect(screen.getByText("Linked villages (1)")).toBeInTheDocument();
    expect(screen.getByText("failing for 8 hours")).toBeInTheDocument();
    expect(screen.getByText("failing for 2 days")).toBeInTheDocument();
    expect(screen.getByText("Look the order up in Stripe.")).toBeInTheDocument();
    expect(screen.getByText("order row not found")).toBeInTheDocument();
    expect(screen.getByText("Checked 12 minutes ago. The report checks again every hour.")).toBeInTheDocument();
    expect(screen.getByText("Recording summaries, cleared 2 hours ago")).toBeInTheDocument();
    expect(screen.getByText("It said: 1 recording failed to get a summary")).toBeInTheDocument();
    expect(screen.getByText("Emails that fail to send.")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is failing/)).toBeNull();
  });

  it("says plainly when nothing is failing, and still lists what it cannot see", async () => {
    respond(200, { ...REPORT, open: [], resolved: [] });
    render(<FailuresTab password="secret" />);
    expect(await screen.findByText(/Nothing is failing that this report can see\./)).toBeInTheDocument();
    expect(screen.getByText("What this report cannot see yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never shows an empty report when the report could not be read", async () => {
    respond(500, { error: "failures_unavailable", message: "The report could not be read.", detail: "connect ECONNREFUSED" });
    render(<FailuresTab password="secret" />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The report could not be read.");
    expect(alert).toHaveTextContent("connect ECONNREFUSED");
    expect(screen.queryByText(/Nothing is failing/)).toBeNull();
    expect(screen.queryByText("What this report cannot see yet")).toBeNull();
  });

  it("says a refusal in words, never as a code", async () => {
    respond(401, { error: "auth_required", message: "Sign in as an admin to read this report." });
    render(<FailuresTab password="stale" />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sign in as an admin to read this report.");
    expect(alert).not.toHaveTextContent("auth_required");
  });

  it("tells a founder when the connection itself failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<FailuresTab password="secret" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The report could not be read. Check your connection, then reload.");
  });

  it("shows no all-clear before a run has finished, because an empty list says nothing until then", async () => {
    respond(200, { ...REPORT, open: [], resolved: [], job: { ...JOB, lastRunSecondsAgo: 60, lastResult: null } });
    render(<FailuresTab password="secret" />);
    expect(await screen.findByText("Nothing is listed because the report has not finished a run here yet.")).toBeInTheDocument();
    expect(screen.getByText("The report's first run is under way. Reload in a few minutes.")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is failing/)).toBeNull();
  });

  it("shows no all-clear after a failed run", async () => {
    respond(200, { ...REPORT, open: [], resolved: [], job: { ...JOB, lastResult: "FAILED: the pool is closed" } });
    render(<FailuresTab password="secret" />);
    expect(await screen.findByText("Nothing is listed, and the last run failed, so an empty list proves nothing.")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is failing/)).toBeNull();
  });

  it.each([
    [
      "the scheduler is off",
      { schedulerEnabled: false },
      "The scheduler is switched off on this server, so this report has stopped updating. The list below is from its last run.",
    ],
    [
      "the scheduler is off and it never ran",
      { schedulerEnabled: false, lastRunSecondsAgo: null, lastResult: null },
      "The scheduler is switched off on this server, so this report has never run here and nothing below has been checked.",
    ],
    [
      "the last run failed",
      { lastResult: "FAILED: the pool is closed" },
      "The report's last run failed, so the list below may be out of date. It said: the pool is closed",
    ],
    [
      "it has never run",
      { lastRunSecondsAgo: null, lastResult: null },
      "The report has not run on this server yet. It first runs shortly after the server starts.",
    ],
    [
      "it is late",
      { lastRunSecondsAgo: 3 * 3600 },
      "The report last ran 3 hours ago and should run every hour, so the list below may be out of date.",
    ],
    [
      "the last run ran out of time",
      { lastResult: "ok in 240001ms: 9 areas read, 2 things failing; stopped after 9 of 13 areas, out of time" },
      "The report's last run ran out of time before reading every area, so parts of the list below may be out of date.",
    ],
    [
      "the last run found another under way",
      { lastResult: "ok in 3ms: skipped: another run holds the lock" },
      "The report's last run found another run already under way, so the list below may still be filling in.",
    ],
  ])("says the list may not be current when %s", async (_state, job, sentence) => {
    respond(200, { ...REPORT, job: { ...JOB, ...job } });
    render(<FailuresTab password="secret" />);
    expect(await screen.findByText(sentence)).toBeInTheDocument();
  });
});
