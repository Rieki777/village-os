// @vitest-environment jsdom
/**
 * The member's own count of tasks waiting on them: the hook that reads it,
 * the badge beside "My tasks", and the menu entries that carry it.
 *
 * What these hold: nothing is asked signed out or with the module off; the
 * reply is read defensively; a zero, a failure and a load all show nothing;
 * the digit is hidden from a screen reader behind a whole sentence; and every
 * answer elsewhere (`tasksChanged`) makes the count read again.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_BOARD_PATH, TASK_COPY, TASKS_COUNT_URL } from "@shared/sessionTasks";
import { reply } from "./taskFixture";

const auth = vi.hoisted(() => ({ token: "t" as string | null }));
vi.mock("@/lib/gameApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gameApi")>();
  // gameFetch reads the module's own authToken, so it is stood in for too, with the same header rule.
  const gameFetch = (path: string, init: RequestInit = {}) =>
    fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}), ...(init.headers ?? {}) },
    });
  return { ...actual, authToken: () => auth.token, gameFetch };
});

import { readTaskCount, tasksChanged, tasksChangedFrom, TASKS_CHANGED_EVENT, useTaskCount } from "@/components/tasks/useTaskCount";
import TaskCountBadge from "@/components/tasks/TaskCountBadge";
import { ACCOUNT_MENU } from "@/config/nav";
import { FAB_ACTIONS } from "@/config/mobileNav";

const fetchMock = vi.fn();
beforeEach(() => {
  auth.token = "t";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function Probe({ enabled = true, who = "1" }: { enabled?: boolean; who?: string }) {
  const c = useTaskCount(enabled, who);
  return <p data-testid="probe">{c ? `${c.waiting}|${c.nextDue ?? "none"}` : "null"}</p>;
}
const probe = () => screen.getByTestId("probe").textContent;

describe("readTaskCount", () => {
  it("takes a whole count and a civil date", () => {
    expect(readTaskCount({ waiting: 3, nextDue: "2026-10-23" })).toEqual({ waiting: 3, nextDue: "2026-10-23" });
    expect(readTaskCount({ waiting: 0, nextDue: null })).toEqual({ waiting: 0, nextDue: null });
  });

  it("refuses anything that is not a count, and drops a date that is not one", () => {
    expect(readTaskCount(null)).toBeNull();
    expect(readTaskCount([])).toBeNull();
    expect(readTaskCount({ waiting: "3" })).toBeNull();
    expect(readTaskCount({ waiting: -1 })).toBeNull();
    expect(readTaskCount({ waiting: 1.5 })).toBeNull();
    expect(readTaskCount({ waiting: 2, nextDue: "Friday" })).toEqual({ waiting: 2, nextDue: null });
  });
});

describe("useTaskCount", () => {
  it("reads the count door for the signed-in member, with no cache", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { waiting: 2, nextDue: "2026-10-23" }));
    render(<Probe />);
    await waitFor(() => expect(probe()).toBe("2|2026-10-23"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(TASKS_COUNT_URL);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer t");
  });

  it("asks nothing signed out", async () => {
    auth.token = null;
    render(<Probe />);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(probe()).toBe("null");
  });

  it("asks nothing with the sessions module off", async () => {
    render(<Probe enabled={false} />);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(probe()).toBe("null");
  });

  it("answers null when the read fails or the door refuses", async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { error: "boom" }));
    const { unmount } = render(<Probe />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(probe()).toBe("null");
    unmount();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    render(<Probe />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(probe()).toBe("null");
  });

  it("reads again when a task is answered, from the board or the bell", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { waiting: 2, nextDue: null }))
      .mockResolvedValueOnce(reply(200, { waiting: 1, nextDue: null }))
      .mockResolvedValueOnce(reply(200, { waiting: 0, nextDue: null }));
    render(<Probe />);
    await waitFor(() => expect(probe()).toBe("2|none"));
    act(() => tasksChanged("bell"));
    await waitFor(() => expect(probe()).toBe("1|none"));
    act(() => tasksChanged("board"));
    await waitFor(() => expect(probe()).toBe("0|none"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reads afresh, and shows nothing of the last one, when the member changes", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { waiting: 4, nextDue: null }));
    const { rerender } = render(<Probe who="1" />);
    await waitFor(() => expect(probe()).toBe("4|none"));
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    rerender(<Probe who="2" />);
    expect(probe()).toBe("null");
    await act(async () => resolve(reply(200, { waiting: 1, nextDue: null })));
    await waitFor(() => expect(probe()).toBe("1|none"));
  });

  it("names who sent a change, and nothing else", () => {
    let seen: string | null = "unset";
    const on = (e: Event) => (seen = tasksChangedFrom(e));
    window.addEventListener(TASKS_CHANGED_EVENT, on);
    tasksChanged("bell");
    expect(seen).toBe("bell");
    window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
    expect(seen).toBeNull();
    window.removeEventListener(TASKS_CHANGED_EVENT, on);
  });
});

describe("the badge beside My tasks", () => {
  it("shows the member's own count, its digit hidden behind a whole sentence", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { waiting: 3, nextDue: null }));
    const { container } = render(
      <a href={TASK_BOARD_PATH}>
        {TASK_COPY.menu.label}
        <TaskCountBadge who="1" />
      </a>,
    );
    const link = await screen.findByRole("link", { name: `${TASK_COPY.menu.label}, ${TASK_COPY.menu.waiting(3)}` });
    expect(link).toBeInTheDocument();
    const digit = container.querySelector("[data-task-count]");
    expect(digit?.textContent).toBe("3");
    expect(digit?.getAttribute("aria-hidden")).toBe("true");
  });

  it("is hidden when nothing waits", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { waiting: 0, nextDue: null }));
    const { container } = render(<TaskCountBadge who="1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(container.textContent).toBe("");
  });

  it("caps a long list at 99+", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { waiting: 140, nextDue: null }));
    const { container } = render(<TaskCountBadge who="1" />);
    await waitFor(() => expect(container.querySelector("[data-task-count]")?.textContent).toBe("99+"));
    expect(screen.getByText(`, ${TASK_COPY.menu.waiting(140)}`)).toBeInTheDocument();
  });
});

describe("the menu entries", () => {
  it("puts My tasks in the avatar menu, behind the sessions module, with its count", () => {
    const entry = ACCOUNT_MENU.find((l) => l.href === TASK_BOARD_PATH);
    expect(entry).toMatchObject({ label: TASK_COPY.menu.label, module: "sessions", count: "tasks" });
    // Beside the member's other own pages, after the wallet.
    const hrefs = ACCOUNT_MENU.map((l) => l.href);
    expect(hrefs.indexOf(TASK_BOARD_PATH)).toBeGreaterThan(hrefs.indexOf("/profile"));
    // One entry carries this count; the only other count is Messages' own.
    expect(ACCOUNT_MENU.filter((l) => l.count === "tasks")).toHaveLength(1);
    expect(ACCOUNT_MENU.filter((l) => l.count).map((l) => l.count).sort()).toEqual(["messages", "tasks"]);
  });

  it("puts My tasks in the shortcuts, for a signed-in member with the module on, beside Profile", () => {
    const row = FAB_ACTIONS.find((a) => a.key === "tasks");
    expect(row).toMatchObject({ label: TASK_COPY.menu.label, href: TASK_BOARD_PATH, requiresAuth: true, module: "sessions" });
    const keys = FAB_ACTIONS.map((a) => a.key);
    expect(keys.indexOf("tasks")).toBe(keys.indexOf("profile") + 1);
    // The daily pair still sits nearest the thumb.
    expect(keys.slice(-2)).toEqual(["journal", "quests"]);
  });
});
