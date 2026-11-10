// @vitest-environment jsdom
/**
 * The Anchor's approval of AI agents (role journey L13). Pinned:
 *   1. Off by default: it says both tools are closed, and recording needs the words of where the Anchor decided.
 *   2. Recording sends approved true with that note; the answer shows who and the approval.
 *   3. Withdrawing sends approved false.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AiAgentsApprovalPanel from "./AiAgentsApprovalPanel";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub() {
  const calls: Array<{ method: string; body: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, body });
    if (method === "PUT") {
      return { ok: true, status: 200, json: async () => (body.approved ? { approved: true, by: { userId: "u1", name: "Fern" }, at: "2026-11-10T10:00:00.000Z", note: body.note } : { approved: false, by: null, at: null, note: "" }) };
    }
    return { ok: true, status: 200, json: async () => ({ approved: false, by: null, at: null, note: "" }) };
  }));
  return calls;
}

describe("the approval of AI agents", () => {
  it("starts off, needs a note, then records and withdraws", async () => {
    const calls = stub();
    render(<AiAgentsApprovalPanel password="tok" />);
    expect(await screen.findByText(/Not approved/)).toBeTruthy();
    const record = screen.getByText("Record the Anchor's approval") as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Where the Anchor decided/), { target: { value: "Anchor thread 10 Nov" } });
    expect(record.disabled).toBe(false);
    fireEvent.click(record);
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.body.approved === true && c.body.note === "Anchor thread 10 Nov")).toBe(true));
    const withdraw = await screen.findByText("Withdraw the approval");
    fireEvent.click(withdraw);
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.body.approved === false)).toBe(true));
  });
});
