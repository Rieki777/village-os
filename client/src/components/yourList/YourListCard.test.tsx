// @vitest-environment jsdom
/**
 * Your list draws nothing while the member's list is off, draws Today, This
 * week and Later when it is on, shows journal words only to the member, and
 * offers Undo after a removal that the server saved.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const gameFetch = vi.fn();
vi.mock("@/lib/gameApi", () => ({ gameFetch: (...args: unknown[]) => gameFetch(...args) }));

import YourListCard from "./YourListCard";
import { setUndoWaitMs } from "@/components/admin/adminUndo";
import { act } from "@testing-library/react";

const answer = (body: unknown, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

const task = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Task ${id}`, privateDetail: null, tier: "priority", horizon: null, dueOn: null, minutes: null, status: "open",
  pinned: false, source: "self", version: 1, createdOn: "2026-11-02", horizonNow: "later", reasons: ["added_by_you"], always: false, shown: true, ...over,
});

const onList = {
  on: true, today: "2026-11-02", counts: { today: 1, week: 0, later: 1, hidden: 0 },
  open: [task("a", { horizonNow: "today", tier: "high", reasons: ["tier_high"], privateDetail: "from my morning page" }), task("b")],
  done: [], removed: [],
};

beforeEach(() => {
  setUndoWaitMs(0);
  gameFetch.mockReset();
});

describe("Your list", () => {
  it("draws nothing while the list is off", async () => {
    gameFetch.mockImplementation(() => answer({ on: false }));
    const { container } = render(<YourListCard />);
    await waitFor(() => expect(gameFetch).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("draws the three horizons, the journal words, and why a task is here", async () => {
    gameFetch.mockImplementation(() => answer(onList));
    render(<YourListCard />);
    expect(await screen.findByText("Your list")).toBeTruthy();
    for (const h of ["Today", "This week", "Later"]) expect(screen.getByText(h)).toBeTruthy();
    expect(screen.getByText("from my morning page")).toBeTruthy();
    await userEvent.click(screen.getAllByText("Why this is here")[0]);
    expect(screen.getByText("You marked it high.")).toBeTruthy();
  });

  it("asks for a reason before removing", async () => {
    gameFetch.mockImplementation(() => answer(onList));
    render(<YourListCard />);
    await screen.findByText("Your list");
    await userEvent.click(screen.getAllByText("Remove")[0]);
    expect((screen.getByText("Remove it") as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers Undo once the server saved a removal", async () => {
    gameFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.endsWith("/remove")) return answer({ task: { ...task("b"), status: "removed", version: 2 } });
      return answer(onList);
    });
    render(<YourListCard />);
    await screen.findByText("Your list");
    await userEvent.click(screen.getAllByText("Remove")[1]);
    await userEvent.click(screen.getByLabelText("Already done"));
    await userEvent.click(screen.getByText("Remove it"));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(await screen.findByText("Undo")).toBeTruthy();
    const sent = gameFetch.mock.calls.find(([u, i]) => String(u).endsWith("/remove") && i?.method === "POST");
    const body = JSON.parse(String(sent![1].body));
    expect(body).toMatchObject({ reason: "already_done", context: { surface: "profile" } });
    expect(body.feedbackId).toMatch(/^fb-/);
  });
});
