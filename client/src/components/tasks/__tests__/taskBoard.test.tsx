// @vitest-environment jsdom
/**
 * The profile's task board: its groups, its empty state, the Earlier
 * disclosure that loads only when opened, a load that fails and is tried
 * again, and no number in any heading.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TASK_COPY, TASKS_MINE_URL } from "@shared/sessionTasks";
import { makeBoard, makeTask, reply } from "./taskFixture";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/MicButton", () => ({ default: () => null }));
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> };
});

import TaskBoard from "@/components/profile/TaskBoard";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const G = TASK_COPY.groups;
const groupNamed = (name: string) => screen.getByRole("region", { name });

describe("the task board", () => {
  it("draws Holding, Your seats hold and Finished, each with its own cards", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, makeBoard({
        holding: [makeTask({ entryId: 1, text: "Fix the gate latch" })],
        seatsHold: [makeTask({ entryId: 2, heldAs: "seat", text: "Order seed", seat: { id: "s1", name: "Water steward", holders: ["Ada"] } })],
        finished: [makeTask({ entryId: 3, status: "done", canAnswer: false, text: "Paint the shed" })],
      })),
    );
    render(<TaskBoard />);
    expect(await screen.findByText("Fix the gate latch")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe(TASKS_MINE_URL);
    expect(within(groupNamed(G.holding)).getByText("Fix the gate latch")).toBeInTheDocument();
    expect(within(groupNamed(G.seatsHold)).getByText("Order seed")).toBeInTheDocument();
    expect(within(groupNamed(G.finished)).getByText("Paint the shed")).toBeInTheDocument();
    expect(screen.queryByText(TASK_COPY.empty)).toBeNull();
    // The groups read in their order.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([G.holding, G.seatsHold, G.finished]);
  });

  it("says nothing is in your hands, and leaves out the groups that are empty", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, makeBoard()));
    render(<TaskBoard />);
    expect(await screen.findByText(TASK_COPY.empty)).toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    expect(screen.queryByText(G.earlier)).toBeNull();
  });

  it("puts no number in any heading", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, makeBoard({
        holding: [makeTask({ entryId: 1 }), makeTask({ entryId: 2 }), makeTask({ entryId: 4 })],
        finished: [makeTask({ entryId: 3, status: "let_go", canAnswer: false })],
        earlierCount: 12,
      })),
    );
    render(<TaskBoard />);
    await screen.findAllByText("Fix the gate latch");
    for (const h of screen.getAllByRole("heading")) expect(h.textContent).not.toMatch(/\d/);
    const summary = screen.getByText(G.earlier).closest("summary");
    expect(summary?.textContent).not.toMatch(/\d/);
  });

  it("loads Earlier only when it is opened", async () => {
    const recent = makeTask({ entryId: 3, status: "done", canAnswer: false, text: "Paint the shed" });
    const older = makeTask({ entryId: 9, status: "done", canAnswer: false, text: "Clear the ditch" });
    fetchMock
      .mockResolvedValueOnce(reply(200, makeBoard({ finished: [recent], earlierCount: 1 })))
      .mockResolvedValueOnce(reply(200, makeBoard({ finished: [recent, older], earlierCount: 1 })));
    const { container } = render(<TaskBoard />);
    await screen.findByText("Paint the shed");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const details = container.querySelector("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText("Clear the ditch")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`${TASKS_MINE_URL}?earlier=1`);
    // A task shown in Finished is not shown again under Earlier.
    expect(screen.getAllByText("Paint the shed")).toHaveLength(1);
  });

  it("offers to try again when the board does not load", async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { error: "boom" })).mockResolvedValueOnce(reply(200, makeBoard()));
    render(<TaskBoard />);
    expect(await screen.findByText(TASK_COPY.loadFailed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.retry }));
    expect(await screen.findByText(TASK_COPY.empty)).toBeInTheDocument();
  });

  it("re-reads quietly after an answer, so a finished task moves to Finished", async () => {
    const open = makeTask({ entryId: 1, text: "Fix the gate latch" });
    const done = makeTask({ entryId: 1, text: "Fix the gate latch", status: "done", version: 2, canAnswer: false, canReopen: true });
    fetchMock
      .mockResolvedValueOnce(reply(200, makeBoard({ holding: [open] })))
      .mockResolvedValueOnce(reply(200, { task: done }))
      .mockResolvedValueOnce(reply(200, makeBoard({ finished: [done] })));
    render(<TaskBoard />);
    await screen.findByText("Fix the gate latch");
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.buttons.done }));
    fireEvent.click(screen.getByRole("button", { name: TASK_COPY.sheets.done.confirm }));
    await waitFor(() => expect(within(groupNamed(G.finished)).getByText("Fix the gate latch")).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: G.holding })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The card that had focus moved groups, so focus comes home to the board's heading.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: TASK_COPY.heading })));
  });
});
