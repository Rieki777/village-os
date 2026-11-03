// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SubmissionHandling from "./SubmissionHandling";
import { setUndoWaitMs } from "./adminUndo";
import { act } from "@testing-library/react";

const fetchMock = vi.fn();

async function flushUndo() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  setUndoWaitMs(0);
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/feedback") && (!init || init.method === undefined)) return { ok: true, json: async () => ({ on: true }) };
    if (String(url).endsWith("/hand-targets")) return { ok: true, json: async () => ({ people: [{ id: "u2", name: "Nia" }], roles: [] }) };
    if (String(url).endsWith("/handling")) return { ok: true, json: async () => ({ ok: true, toldSera: true, sentence: "Saved here, and the reason was sent on to Sera." }) };
    if (init?.method === "DELETE") return { ok: true, json: async () => ({}) };
    if (String(url).endsWith("/status")) return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({}) };
  });
});

const row = { id: "sub-1", type: "contact", data: { name: "Ada", seraTaskId: "task-9" } };

describe("submission reasons", () => {
  it("asks why before removing, then keeps the reason and removes the request", async () => {
    const onChanged = vi.fn();
    render(<SubmissionHandling password="tok" submission={row} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("Why remove it?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove it" }));
    await flushUndo();
    const handling = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/handling"));
    expect(handling).toBeTruthy();
    const sent = JSON.parse(String(handling?.[1].body));
    expect(sent.action).toBe("remove");
    expect(sent.reason).toBe("already_done");
    expect(sent.share).toBe(true);
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(true);
    expect(onChanged).toHaveBeenCalled();
    expect(localStorage.getItem("admin.handledToday")).toContain("count");
  });

  it("hands a request on without deleting it", async () => {
    render(<SubmissionHandling password="tok" submission={row} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Redirect" }));
    expect(await screen.findByRole("option", { name: "Nia" })).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole("combobox"), "p:u2");
    await userEvent.click(screen.getByRole("button", { name: "Hand it on" }));
    await flushUndo();
    const handling = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/handling") && c[1]?.method === "POST");
    const sent = JSON.parse(String(handling?.[1].body));
    expect(sent.action).toBe("redirect");
    expect(sent.toUserId).toBe("u2");
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(false);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/status"))).toBe(true);
  });
});
