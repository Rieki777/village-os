// @vitest-environment jsdom
/**
 * What the organisational memory service would receive, as the admin reads it.
 *
 * WHAT IS PINNED:
 *
 *   1. The first thing the panel says is that nothing is sent until Saberra
 *      names where journal entries land.
 *   2. Each item shows its kind, date, code-name, length and status, and the
 *      counts read as sentences.
 *   3. NO WORDS, EVEN IF THE SERVER EVER SENT THEM. The server's listing never
 *      names the payload (server/routes/journalBridge.test.ts holds that
 *      half); this half holds the screen to it, so a server change that let a
 *      `text` or `payload` field back onto the wire would still print nothing.
 *   4. A departed member's code-name waiting on a vendor delete is said out
 *      loud, with the reason it waits.
 *
 * `fetch` is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SaberraOutboxPanel from "./SaberraOutboxPanel";

const VIEW = {
  writePath: false,
  journalOn: true,
  counts: { queued: 2, sent: 0, failed: 1, held: 1 },
  byKind: { journal_entry: 3, team_signal: 1 },
  pendingVendorDelete: 1,
  items: [
    {
      id: "sbo-1",
      kind: "journal_entry",
      period: "2026-10-13",
      codeName: "brisk-otter-41",
      chars: 1240,
      status: "queued",
      attempts: 0,
      createdAt: "2026-10-13T18:00:00.000Z",
      // Smuggled fields a future server change might add. The panel must not print them.
      text: "zz-the member's own words",
      payload: { answers: [{ text: "zz-more of their words" }] },
    },
    {
      id: "sbo-2",
      kind: "team_signal",
      period: "2026-W41",
      codeName: null,
      chars: 0,
      status: "failed",
      attempts: 2,
      createdAt: "2026-10-12T09:00:00.000Z",
    },
    {
      id: "sbo-3",
      kind: "journal_entry",
      period: "2026-10-01",
      codeName: "calm-heron-12",
      chars: 0,
      status: "held",
      attempts: 0,
      createdAt: "2026-10-01T10:00:00.000Z",
    },
  ],
};

function stub(answer: { status: number; body: unknown }) {
  const fetchMock = vi.fn(async () => ({ status: answer.status, ok: answer.status < 400, json: async () => answer.body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what Saberra would receive", () => {
  it("SAYS NOTHING IS SENT before any number, and asks with the admin token", async () => {
    const fetchMock = stub({ status: 200, body: VIEW });
    render(<SaberraOutboxPanel password="secret" />);
    expect(await screen.findByText(/Nothing is sent until Saberra names where journal entries land/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/saberra/outbox", { headers: { Authorization: "Bearer secret" } });
  });

  it("SHOWS KIND, DATE, CODE-NAME, LENGTH AND STATUS for each item, and the counts", async () => {
    stub({ status: 200, body: VIEW });
    render(<SaberraOutboxPanel password="secret" />);
    expect(await screen.findByText("brisk-otter-41")).toBeInTheDocument();
    expect(screen.getByText("2026-10-13")).toBeInTheDocument();
    expect(screen.getByText("1,240 characters")).toBeInTheDocument();
    expect(screen.getByText("2026-W41")).toBeInTheDocument();
    expect(screen.getByText("numbers only")).toBeInTheDocument();
    expect(screen.getByText("Will try again")).toBeInTheDocument();
    expect(screen.getByText("Withdrawn")).toBeInTheDocument();
    const counts = screen.getByRole("list", { name: "Counts" }).textContent ?? "";
    expect(counts).toContain("Waiting: 2 items, and 1 item to try again.");
    expect(counts).toContain("3 journal entries and 1 team signal");
  });

  it("NEVER PRINTS A WORD OF AN ENTRY, even when the answer carries one", async () => {
    stub({ status: 200, body: VIEW });
    render(<SaberraOutboxPanel password="secret" />);
    await screen.findByText("brisk-otter-41");
    expect(document.body.textContent).not.toContain("zz-");
  });

  it("SAYS A DEPARTED MEMBER'S CODE-NAME IS KEPT PENDING, and why it waits", async () => {
    stub({ status: 200, body: VIEW });
    render(<SaberraOutboxPanel password="secret" />);
    expect(await screen.findByText(/1 code-name kept, marked pending/)).toBeInTheDocument();
    expect(screen.getByText(/Saberra has no delete endpoint yet, so it stays pending/)).toBeInTheDocument();
  });

  it("says the journal is off when it is, since nothing is queued then", async () => {
    stub({ status: 200, body: { ...VIEW, journalOn: false, items: [] } });
    render(<SaberraOutboxPanel password="secret" />);
    expect(await screen.findByText("The journal module is off, so nothing is being queued.")).toBeInTheDocument();
    expect(screen.getByText("Nothing would cross yet.")).toBeInTheDocument();
  });

  it("says a refusal in the server's words, and an unreadable answer as unreadable", async () => {
    stub({ status: 403, body: { error: "You do not hold that key." } });
    const { unmount } = render(<SaberraOutboxPanel password="secret" />);
    expect(await screen.findByText("You do not hold that key.")).toBeInTheDocument();
    unmount();
    stub({ status: 200, body: { items: "nope" } });
    render(<SaberraOutboxPanel password="secret" />);
    expect(await screen.findByText(/cannot read/)).toBeInTheDocument();
  });
});
