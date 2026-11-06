// @vitest-environment jsdom
/**
 * The Chat button on a quest page and a task card.
 *
 * Probing (the quest page): it shows only when the server says this member is
 * in the chat, and asks nothing with messaging off or signed out. Pressing it
 * opens the chat (POST) and lands on /messages/<id>. A press that meets no
 * chat says so instead of failing quietly.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const session = vi.hoisted(() => ({
  token: "t" as string | null,
  user: { id: "u-ana", name: "Ana" } as null | { id: string; name: string },
  on: true,
  toasts: [] as string[],
}));

vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: () => session.on }));
vi.mock("sonner", () => ({ toast: { error: (m: string) => session.toasts.push(m) } }));
vi.mock("@/lib/gameApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gameApi")>();
  const gameFetch = (path: string, init: RequestInit = {}) => fetch(path, init);
  return { ...actual, authToken: () => session.token, gameFetch };
});

import WorkChatButton, { workChatUrl } from "@/components/messages/WorkChatButton";

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchMock = vi.fn();

beforeEach(() => {
  session.token = "t";
  session.user = { id: "u-ana", name: "Ana" };
  session.on = true;
  session.toasts = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderButton(el: React.ReactElement) {
  const loc = memoryLocation({ path: "/quests/q-1", record: true });
  render(<Router hook={loc.hook}>{el}</Router>);
  return loc;
}
const chat = () => screen.queryByRole("button", { name: "Chat" });

describe("WorkChatButton", () => {
  it("probes the quest's chat and shows when this member is in it", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { available: true, conversationId: "cnv-1", people: 2 }));
    renderButton(<WorkChatButton kind="quest" id="q-1" probe />);
    await waitFor(() => expect(chat()).not.toBeNull());
    expect(fetchMock.mock.calls[0][0]).toBe(workChatUrl("quest", "q-1"));
  });

  it("stays hidden when the quest has one person, or this member is not on it", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { available: false, conversationId: null, people: 1 }));
    renderButton(<WorkChatButton kind="quest" id="q-1" probe />);
    await act(async () => {});
    expect(chat()).toBeNull();
  });

  it("asks nothing with messaging off or signed out", async () => {
    session.on = false;
    const first = render(<WorkChatButton kind="quest" id="q-1" probe />);
    await act(async () => {});
    first.unmount();
    session.on = true;
    session.token = null;
    render(<WorkChatButton kind="quest" id="q-1" probe />);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chat()).toBeNull();
  });

  it("opens the chat on a press and lands in the thread", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: "cnv-9", kind: "group", title: "Order the seed" }));
    const loc = renderButton(<WorkChatButton kind="task" id={42} likely />);
    fireEvent.click(chat()!);
    await waitFor(() => expect(loc.history.at(-1)).toBe("/messages/cnv-9"));
    expect(fetchMock.mock.calls[0][0]).toBe(workChatUrl("task", 42));
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });

  it("says so when a press finds no chat", async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { error: "Not found" }));
    renderButton(<WorkChatButton kind="task" id={42} likely />);
    fireEvent.click(chat()!);
    await waitFor(() => expect(session.toasts).toHaveLength(1));
    expect(session.toasts[0]).toContain("no chat yet");
  });

  it("draws nothing for a task card that is not likely shared", () => {
    renderButton(<WorkChatButton kind="task" id={42} />);
    expect(chat()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
