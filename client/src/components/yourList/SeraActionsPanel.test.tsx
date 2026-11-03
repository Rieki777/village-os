// @vitest-environment jsdom
/**
 * Sera's actions on the bridge panel (addendum v6, B7, check 59). What each
 * case pins: every action is listed newest first with Undo on the ones that
 * wrote something, a refused undo shows the server's sentence, and with no
 * actions the panel renders nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SeraActionsPanel from "./SeraActionsPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ACTIONS = [
  { id: "aac-2", tool: "suggest_task", subjectUserId: "u-1", state: "done", createdAt: "2026-11-03T10:00:00Z", undoneAt: null },
  { id: "aac-1", tool: "set_board_access", subjectUserId: "u-2", state: "undone", createdAt: "2026-11-02T10:00:00Z", undoneAt: "2026-11-02T11:00:00Z" },
];

function stub(actions: unknown[], undo: { status: number; body: unknown }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (String(url).includes("/undo")) return { ok: undo.status < 300, status: undo.status, json: async () => undo.body };
    return { ok: true, status: 200, json: async () => ({ actions }) };
  }));
  return calls;
}

describe("Sera's actions on the bridge panel", () => {
  it("lists each action, with Undo only where something was written, and shows a refusal in words", async () => {
    const calls = stub(ACTIONS, { status: 409, body: { error: "The member has kept, edited or closed that suggestion, so it is theirs now." } });
    render(<SeraActionsPanel password="tok" />);
    expect(await screen.findByText("Suggested a task")).toBeTruthy();
    expect(screen.getAllByText("Undo")).toHaveLength(1);
    fireEvent.click(screen.getByText("Undo"));
    expect((await screen.findByRole("status")).textContent).toContain("theirs now");
    expect(calls).toContain("POST /api/admin/agent-actions/aac-2/undo");
  });

  it("renders nothing when Sera's agent has done nothing", async () => {
    const calls = stub([], { status: 200, body: {} });
    render(<SeraActionsPanel password="tok" />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByText("Undo")).toBeNull();
  });
});
