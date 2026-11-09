// @vitest-environment jsdom
/**
 * What the connector proposed (role journey L13). Pinned:
 *   1. A role change shows with Publish, which sends the draft's own change ids to the existing publish route.
 *   2. A seating shows a note to fill the role in Admin, and Done marks it taken. Nothing seats from this card.
 *   3. A person who holds neither power sees no card; a failed read says so.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AgentProposalsCard from "./AgentProposalsCard";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const WAITING = {
  roleChanges: [{ draftId: "d1", title: "Proposed change to Gardener", why: "The aim is too narrow", changes: 1, changeIds: ["c1"] }],
  seatings: [{ id: "prop_1", title: "Seat Cal in Gardener from 2026-12-01", why: null }],
};

function stub(status = 200) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url) === "/api/agent-proposals/waiting") return { ok: status === 200, status, json: async () => WAITING };
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  }));
  return calls;
}

describe("the connector's proposals card", () => {
  it("publishes a role change with its own change ids, and marks a seating done without seating", async () => {
    const calls = stub();
    render(<AgentProposalsCard headers={() => ({ Authorization: "Bearer t" })} />);
    expect(await screen.findByText("Proposed change to Gardener")).toBeTruthy();
    fireEvent.click(screen.getByText("Publish"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/org/drafts/d1/publish-by-power" && c.body.expectedChanges[0] === "c1")).toBe(true));
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/agent-proposals/prop_1/resolve" && c.body.status === "taken")).toBe(true));
    expect(calls.some((c) => /seatings|holders|claim/.test(c.url))).toBe(false);
  });

  it("shows nothing to a person who holds neither power", async () => {
    stub(401);
    const { container } = render(<AgentProposalsCard headers={() => ({})} />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("says so when the read fails", async () => {
    stub(500);
    render(<AgentProposalsCard headers={() => ({})} />);
    expect(await screen.findByTestId("agent-proposals-failed")).toBeTruthy();
  });
});
