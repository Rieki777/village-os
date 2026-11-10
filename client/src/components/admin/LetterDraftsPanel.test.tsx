// @vitest-environment jsdom
/**
 * The drafted letters screen (role journey L13). Pinned:
 *   1. A letter shows where it would go. Nothing is sent by showing it.
 *   2. Editing then pressing Send saves the edit first, then sends: the letter that goes is the one on screen.
 *   3. A suppressed address cannot be sent, and says why.
 *   4. Discard sends nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LetterDraftsPanel from "./LetterDraftsPanel";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LETTER = { id: "prop_1", kind: "first_reply", subject: "Thank you", body: "Thank you for applying. We will be in touch soon about the next step.", applicationRef: "op-aaaaaaaaaaaaaaaaaaaa", to: { email: "pat@example.test", name: "Pat" }, suppressed: false };

function stub(letters: unknown[]) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return { ok: true, status: 200, json: async () => ({ letters }) };
  }));
  return calls;
}

describe("the drafted letters screen", () => {
  it("shows the address and sends nothing until Send is pressed, saving the edit first", async () => {
    const calls = stub([LETTER]);
    render(<LetterDraftsPanel password="tok" />);
    expect(await screen.findByText(/pat@example.test/)).toBeTruthy();
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Next step" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/send"))).toBe(true));
    const order = calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url.split("/letter-drafts/")[1]}`);
    expect(order).toEqual(["PUT prop_1", "POST prop_1/send"]);
    expect(calls.find((c) => c.method === "PUT")?.body.subject).toBe("Next step");
  });

  it("will not send to a suppressed address", async () => {
    stub([{ ...LETTER, suppressed: true }]);
    render(<LetterDraftsPanel password="tok" />);
    expect(await screen.findByText(/suppression list/)).toBeTruthy();
    expect((screen.getByText("Send") as HTMLButtonElement).disabled).toBe(true);
  });

  it("discards without sending", async () => {
    const calls = stub([LETTER]);
    render(<LetterDraftsPanel password="tok" />);
    fireEvent.click(await screen.findByText("Discard"));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/discard"))).toBe(true));
    expect(calls.some((c) => c.url.endsWith("/send"))).toBe(false);
  });
});
