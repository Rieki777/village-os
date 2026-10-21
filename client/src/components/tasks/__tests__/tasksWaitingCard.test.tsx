// @vitest-environment jsdom
/**
 * Your tasks: the small card near the top of the member's own profile.
 *
 * It reads the count door only, never the board's full read; draws nothing
 * when nothing waits, while it loads, when the read fails, or with the module
 * off; says the nearest date in words, "was" for a date gone by, and "none of
 * them has a date" when none does; and its one button brings the board into
 * view with focus on the board's heading.
 */
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_BOARD_ANCHOR, TASK_COPY, TASKS_COUNT_URL, TASKS_MINE_URL, taskDateWords } from "@shared/sessionTasks";
import { reply } from "./taskFixture";

const env = vi.hoisted(() => ({ token: "t" as string | null, user: { id: "u1", name: "Ada" } as null | { id: string; name: string } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: env.user }) }));
vi.mock("@/lib/gameApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gameApi")>();
  const gameFetch = (path: string, init: RequestInit = {}) =>
    fetch(path, { ...init, headers: { ...(env.token ? { Authorization: `Bearer ${env.token}` } : {}), ...(init.headers ?? {}) } });
  return { ...actual, authToken: () => env.token, gameFetch };
});

import TasksWaitingCard, { readerToday, waitingWords } from "@/components/profile/TasksWaitingCard";

const C = TASK_COPY.waitingCard;
const fetchMock = vi.fn();
beforeEach(() => {
  env.token = "t";
  env.user = { id: "u1", name: "Ada" };
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("the words", () => {
  const today = "2026-10-20";
  it("says how many and the nearest date in words", () => {
    expect(waitingWords({ waiting: 1, nextDue: "2026-10-23" }, today)).toEqual({
      count: C.count(1),
      date: C.nextDue(taskDateWords("2026-10-23", today)),
    });
    expect(waitingWords({ waiting: 3, nextDue: "2026-10-23" }, today).count).toBe(C.count(3));
  });

  it("says was, in the same ink, for a date already behind today", () => {
    expect(waitingWords({ waiting: 2, nextDue: "2026-10-16" }, today).date).toBe(C.nextDuePassed(taskDateWords("2026-10-16", today)));
  });

  it("says none of them has a date when none does", () => {
    expect(waitingWords({ waiting: 2, nextDue: null }, today).date).toBe(C.noDate);
  });

  it("never prints a machine date", () => {
    expect(waitingWords({ waiting: 2, nextDue: "2026-10-23" }, today).date).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("reads the reader's own calendar day", () => {
    expect(readerToday(new Date(2026, 9, 5, 23, 30))).toBe("2026-10-05");
  });
});

describe("the card", () => {
  it("shows the count, the date and one button, reading only the count door", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { waiting: 2, nextDue: null }));
    render(<TasksWaitingCard enabled />);
    expect(await screen.findByRole("region", { name: C.heading })).toBeInTheDocument();
    expect(screen.getByText(C.count(2))).toBeInTheDocument();
    expect(screen.getByText(C.noDate)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: C.button })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(TASKS_COUNT_URL);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith(TASKS_MINE_URL))).toBe(false);
  });

  it("draws nothing when nothing waits", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { waiting: 0, nextDue: null }));
    const { container } = render(<TasksWaitingCard enabled />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing, and asks nothing, with the module off or signed out", async () => {
    const { container, unmount } = render(<TasksWaitingCard enabled={false} />);
    await act(async () => {});
    expect(container.innerHTML).toBe("");
    unmount();
    env.user = null;
    env.token = null;
    const second = render(<TasksWaitingCard enabled />);
    await act(async () => {});
    expect(second.container.innerHTML).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("draws nothing when the read fails", async () => {
    fetchMock.mockResolvedValueOnce(reply(500, {}));
    const { container } = render(<TasksWaitingCard enabled />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });

  it("brings the board into view and hands focus to its heading", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { waiting: 1, nextDue: "2026-10-23" }));
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    render(
      <>
        <TasksWaitingCard enabled />
        <div id={TASK_BOARD_ANCHOR}>
          <h2 id="task-board-h" tabIndex={-1}>
            {TASK_COPY.heading}
          </h2>
        </div>
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: C.button }));
    expect(scrolled).toEqual([TASK_BOARD_ANCHOR]);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: TASK_COPY.heading }));
    // @ts-expect-error jsdom has none of its own.
    delete Element.prototype.scrollIntoView;
  });
});
