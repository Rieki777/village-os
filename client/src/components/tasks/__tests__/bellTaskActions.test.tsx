// @vitest-environment jsdom
/**
 * "It's done" from the bell.
 *
 * Two layers. BellTaskActions on its own: the door it calls and what it sends,
 * the line it says after, the undo through the board's own reopen, where focus
 * goes, and each refusal in the server's own words. Then NotificationBell
 * with a feed in it: which rows carry the buttons (a single task notice whose
 * link opens one card), and which never do (a batched row, an older notice
 * that links somewhere else, another type, the module off).
 */
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_COPY, TASK_REFUSALS, taskBoardLink, taskDoneUrl, taskUrl } from "@shared/sessionTasks";
import { makeTask, reply } from "./taskFixture";

const env = vi.hoisted(() => ({
  sessionsOn: true,
  items: [] as Array<{ id: string; type: string; title: string; body?: string | null; link?: string | null; isRead: boolean; at: string }>,
  markRead: vi.fn(async (_ids?: string[]) => 1),
}));

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return {
    ...actual,
    Link: ({ href, children, onClick, ...rest }: { href: string; children: ReactNode; onClick?: () => void; [k: string]: unknown }) => (
      <a
        href={href}
        {...rest}
        onClick={(e) => {
          e.preventDefault();
          onClick?.();
        }}
      >
        {children}
      </a>
    ),
  };
});
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: (id: string) => (id === "sessions" ? env.sessionsOn : false) }));
vi.mock("@/lib/notificationStore", () => {
  const state = () => ({ unread: env.items.filter((i) => !i.isRead).length, unseen: 0, items: env.items, loaded: true });
  let snap = state();
  return {
    getNotifyState: () => snap,
    subscribeNotifications: () => () => {},
    refreshNotifications: async () => {
      snap = state();
    },
    markNotificationsSeen: async () => {},
    markNotificationsRead: (ids?: string[]) => env.markRead(ids),
    __reset: () => {
      snap = state();
    },
  };
});

import BellTaskActions, { bellRefusal } from "@/components/tasks/BellTaskActions";
import { bellAnswerFor, forgetAllBellAnswers, rememberBellAnswer } from "@/components/tasks/bellAnswers";
import NotificationBell, { bellTaskOf } from "@/components/NotificationBell";
import { TASKS_CHANGED_EVENT, tasksChangedFrom } from "@/components/tasks/useTaskCount";
import * as store from "@/lib/notificationStore";

const B = TASK_COPY.bell;
const WHAT = "Fix the gate latch";
const fetchMock = vi.fn();
let changes: Array<string | null> = [];
const onChange = (e: Event) => changes.push(tasksChangedFrom(e));

beforeEach(() => {
  fetchMock.mockReset();
  env.markRead.mockClear();
  env.sessionsOn = true;
  env.items = [];
  changes = [];
  forgetAllBellAnswers();
  vi.stubGlobal("fetch", fetchMock);
  window.addEventListener(TASKS_CHANGED_EVENT, onChange);
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.removeEventListener(TASKS_CHANGED_EVENT, onChange);
});

function renderActions(who: string | null = null) {
  const onRead = vi.fn();
  const onLeave = vi.fn();
  const { unmount } = render(<BellTaskActions entryId={12} what={WHAT} onRead={onRead} onLeave={onLeave} who={who} />);
  return { onRead, onLeave, unmount };
}
const openLink = () => screen.getByRole("link", { name: B.openLabel(WHAT) });
const doneButton = () => screen.getByRole("button", { name: B.doneLabel(WHAT) });
const status = () => screen.getByRole("status");

describe("It's done, under one task notice", () => {
  it("offers It's done and Open, each named for the task", () => {
    renderActions();
    expect(doneButton()).toHaveTextContent(B.done);
    const open = screen.getByRole("link", { name: B.openLabel(WHAT) });
    expect(open).toHaveTextContent(B.open);
    expect(open.getAttribute("href")).toBe(taskBoardLink(12));
    // The status is there, empty, before anything is said into it.
    expect(status()).toHaveTextContent("");
  });

  it("marks it done through the done door, says so, and hands focus to the undo", async () => {
    const done = makeTask({ entryId: 12, status: "done", version: 3, canAnswer: false, canReopen: true });
    fetchMock.mockResolvedValueOnce(reply(200, { task: done }));
    const { onRead, unmount } = renderActions();
    fireEvent.click(doneButton());
    expect(await screen.findByText(B.marked)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(taskDoneUrl(12));
    expect(init.method).toBe("POST");
    // No version is sent: the door reads it itself.
    expect(init.body).toBeUndefined();
    expect(changes).toEqual(["bell"]);
    const undo = screen.getByRole("button", { name: B.undoLabel(WHAT) });
    expect(undo).toHaveTextContent(B.undo);
    // Focus moves in the effect after the render that shows the line, so it is waited for, not read at once.
    await waitFor(() => expect(document.activeElement).toBe(undo));
    expect(screen.queryByRole("button", { name: B.doneLabel(WHAT) })).toBeNull();
    // Open stays.
    expect(screen.getByRole("link", { name: B.openLabel(WHAT) })).toBeInTheDocument();
    // The notice is read once the panel closes, not while the undo is in reach.
    expect(onRead).not.toHaveBeenCalled();
    unmount();
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it("reads the notice and closes the panel when Open is followed", () => {
    const { onRead, onLeave } = renderActions();
    fireEvent.click(screen.getByRole("link", { name: B.openLabel(WHAT) }));
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("says the let-go sentence even when the refusal carries none", async () => {
    fetchMock.mockResolvedValueOnce(reply(409, { error: "let_go" }));
    renderActions();
    fireEvent.click(doneButton());
    expect(await screen.findByText(TASK_REFUSALS.letGoNotDone)).toBeInTheDocument();
  });

  it("opens it again through the board's own reopen, with the version the done door gave", async () => {
    const done = makeTask({ entryId: 12, status: "done", version: 3, canAnswer: false, canReopen: true });
    const open = makeTask({ entryId: 12, status: "open", version: 4 });
    fetchMock.mockResolvedValueOnce(reply(200, { task: done })).mockResolvedValueOnce(reply(200, { task: open }));
    renderActions();
    fireEvent.click(doneButton());
    fireEvent.click(await screen.findByRole("button", { name: B.undoLabel(WHAT) }));
    expect(await screen.findByText(B.reopened)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(taskUrl(12));
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ op: "reopened", version: 3 });
    // It's done is back, and focus is on it.
    await waitFor(() => expect(document.activeElement).toBe(doneButton()));
    expect(changes).toEqual(["bell", "bell"]);
  });

  it("shows no undo when the card says it cannot be opened again", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { task: makeTask({ entryId: 12, status: "done", canReopen: false }) }));
    renderActions();
    fireEvent.click(doneButton());
    expect(await screen.findByText(B.marked)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: B.undoLabel(WHAT) })).toBeNull();
  });

  it("says the server's own refusal when the member may not answer it, and changes nothing", async () => {
    fetchMock.mockResolvedValueOnce(reply(403, { error: TASK_REFUSALS.notYours }));
    const { onRead } = renderActions();
    fireEvent.click(doneButton());
    expect(await screen.findByText(TASK_REFUSALS.notYours)).toBeInTheDocument();
    expect(doneButton()).toBeEnabled();
    expect(onRead).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it("keeps only Open for a task that was let go", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(409, { error: TASK_REFUSALS.letGoNotDone, task: makeTask({ entryId: 12, status: "let_go", canAnswer: false }) }),
    );
    renderActions();
    fireEvent.click(doneButton());
    expect(await screen.findByText(TASK_REFUSALS.letGoNotDone)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: B.doneLabel(WHAT) })).toBeNull();
    expect(screen.getByRole("link", { name: B.openLabel(WHAT) })).toBeInTheDocument();
  });

  it("hands focus to Open when a let-go task takes It's done away, so it never falls to the page", async () => {
    fetchMock.mockResolvedValueOnce(reply(409, { error: TASK_REFUSALS.letGoNotDone }));
    renderActions();
    const done = doneButton();
    done.focus();
    fireEvent.click(done);
    expect(await screen.findByText(TASK_REFUSALS.letGoNotDone)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(openLink()));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("hands focus to Open when the card it was done with cannot be opened again", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { task: makeTask({ entryId: 12, status: "done", canReopen: false }) }));
    renderActions();
    doneButton().focus();
    fireEvent.click(doneButton());
    expect(await screen.findByText(B.marked)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(openLink()));
  });

  it("hands focus to Open when the undo finds the task was let go meanwhile", async () => {
    const done = makeTask({ entryId: 12, status: "done", version: 3, canReopen: true });
    const moved = makeTask({ entryId: 12, status: "let_go", version: 5, canReopen: false, canAnswer: false });
    fetchMock.mockResolvedValueOnce(reply(200, { task: done })).mockResolvedValueOnce(reply(409, { error: TASK_REFUSALS.moved, task: moved }));
    renderActions();
    fireEvent.click(doneButton());
    fireEvent.click(await screen.findByRole("button", { name: B.undoLabel(WHAT) }));
    expect(await screen.findByText(TASK_REFUSALS.moved)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(openLink()));
  });

  it("says a plain sentence when the village cannot be reached, and lets it be tried again", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    renderActions();
    fireEvent.click(doneButton());
    expect(await screen.findByText(B.failed)).toBeInTheDocument();
    expect(doneButton()).toBeEnabled();
  });

  it("sends one request for two quick presses", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    renderActions();
    fireEvent.click(doneButton());
    expect(doneButton()).toBeDisabled();
    expect(doneButton()).toHaveTextContent(B.working);
    fireEvent.click(doneButton());
    await act(async () => resolve(reply(200, { task: makeTask({ entryId: 12, status: "done", canReopen: true }) })));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the task as it now stands when someone answered first", async () => {
    const done = makeTask({ entryId: 12, status: "done", version: 3, canReopen: true });
    const moved = makeTask({ entryId: 12, status: "let_go", version: 5, canReopen: false, canAnswer: false });
    fetchMock.mockResolvedValueOnce(reply(200, { task: done })).mockResolvedValueOnce(reply(409, { error: TASK_REFUSALS.moved, task: moved }));
    renderActions();
    fireEvent.click(doneButton());
    fireEvent.click(await screen.findByRole("button", { name: B.undoLabel(WHAT) }));
    expect(await screen.findByText(TASK_REFUSALS.moved)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: B.doneLabel(WHAT) })).toBeNull();
    expect(screen.queryByRole("button", { name: B.undoLabel(WHAT) })).toBeNull();
  });

  it("still says it is done when the bell is opened again", async () => {
    const done = makeTask({ entryId: 12, status: "done", version: 3, canReopen: true });
    fetchMock.mockResolvedValueOnce(reply(200, { task: done }));
    const first = renderActions("m-kai");
    fireEvent.click(doneButton());
    expect(await screen.findByText(B.marked)).toBeInTheDocument();
    first.unmount();
    // The panel closed and opened: a new mount, no new request.
    renderActions("m-kai");
    expect(screen.getByText(B.marked)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: B.undoLabel(WHAT) })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: B.doneLabel(WHAT) })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forgets it once opened again, so the next opening offers It's done", async () => {
    const done = makeTask({ entryId: 12, status: "done", version: 3, canReopen: true });
    const open = makeTask({ entryId: 12, status: "open", version: 4 });
    fetchMock.mockResolvedValueOnce(reply(200, { task: done })).mockResolvedValueOnce(reply(200, { task: open }));
    const first = renderActions("m-kai");
    fireEvent.click(doneButton());
    fireEvent.click(await screen.findByRole("button", { name: B.undoLabel(WHAT) }));
    expect(await screen.findByText(B.reopened)).toBeInTheDocument();
    first.unmount();
    renderActions("m-kai");
    expect(doneButton()).toBeEnabled();
    expect(screen.queryByText(B.marked)).toBeNull();
  });

  it("never shows one member's answers to another, nor to nobody", () => {
    rememberBellAnswer("m-kai", makeTask({ entryId: 12, status: "done", canReopen: true }));
    expect(bellAnswerFor("m-kai", 12)).not.toBeNull();
    // Another member on the same browser: the store empties before it is read.
    expect(bellAnswerFor("m-ben", 12)).toBeNull();
    expect(bellAnswerFor("m-kai", 12)).toBeNull();
    rememberBellAnswer("m-kai", makeTask({ entryId: 12, status: "done", canReopen: true }));
    expect(bellAnswerFor(null, 12)).toBeNull();
    expect(bellAnswerFor("m-kai", 12)).toBeNull();
    // Signed out keeps nothing.
    rememberBellAnswer(null, makeTask({ entryId: 13, status: "done" }));
    expect(bellAnswerFor(null, 13)).toBeNull();
    renderActions("m-ben");
    expect(doneButton()).toBeEnabled();
  });

  it("never shows a machine code, only a sentence", () => {
    expect(bellRefusal({ error: "auth_required" }, 401)).not.toBe("auth_required");
    expect(bellRefusal({}, 404)).toBe(TASK_REFUSALS.notFound);
    expect(bellRefusal({}, 429)).toBe(TASK_REFUSALS.tooMany);
    expect(bellRefusal({}, 500)).toBe(B.failed);
    expect(bellRefusal({ error: TASK_REFUSALS.letGoNotDone }, 409)).toBe(TASK_REFUSALS.letGoNotDone);
  });
});

// ── In the bell ─────────────────────────────────────────────────────────────

const at = "2026-10-20T08:00:00.000Z";
const notice = (id: string, over: Partial<(typeof env.items)[number]> = {}) => ({
  id,
  type: "session_action_held",
  title: `An action from "Weekly planning" is in your hands`,
  body: WHAT,
  link: taskBoardLink(12),
  isRead: false,
  at,
  ...over,
});

async function openBell() {
  (store as unknown as { __reset: () => void }).__reset();
  render(<NotificationBell />);
  fireEvent.click(screen.getByRole("button", { name: /^Notifications/ }));
  return screen.getByRole("group", { name: "Notifications" });
}

describe("which bell rows carry the buttons", () => {
  it("a held notice and a due notice that open one card each", async () => {
    env.items = [
      notice("1"),
      notice("2", { type: "session_action_due", title: "Your task is near its date", body: "Order seed", link: taskBoardLink(14) }),
    ];
    const panel = await openBell();
    expect(within(panel).getByRole("button", { name: B.doneLabel(WHAT) })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: B.doneLabel("Order seed") })).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: B.openLabel("Order seed") }).getAttribute("href")).toBe(taskBoardLink(14));
  });

  it("leaves the panel open once it is done, and reads the notice when the panel closes", async () => {
    env.items = [notice("1")];
    fetchMock.mockResolvedValueOnce(reply(200, { task: makeTask({ entryId: 12, status: "done", canReopen: true }) }));
    const panel = await openBell();
    fireEvent.click(within(panel).getByRole("button", { name: B.doneLabel(WHAT) }));
    expect(await within(panel).findByText(B.marked)).toBeInTheDocument();
    // Focus is already on the undo when the line shows, with no later move
    // left to pull it back into the panel once Escape has closed it.
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: B.undoLabel(WHAT) }));
    expect(screen.getByRole("group", { name: "Notifications" })).toBeInTheDocument();
    expect(env.markRead).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Notifications" })).toBeNull();
    expect(env.markRead).toHaveBeenCalledWith(["1"]);
    // Escape hands focus back to the bell, as it always has.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Notifications/ }));
  });

  it("keeps focus on the bell when Escape lands the moment the answer shows", async () => {
    env.items = [notice("1")];
    fetchMock.mockResolvedValueOnce(reply(200, { task: makeTask({ entryId: 12, status: "done", canReopen: true }) }));
    const panel = await openBell();
    // Escape inside the same turn as the commit that shows the answer, before
    // any effect React would otherwise run a frame later. On CI this was the
    // one-in-many timing where focus fell to the page.
    let escaped = false;
    const seen = new MutationObserver(() => {
      if (escaped || !panel.textContent?.includes(B.marked)) return;
      escaped = true;
      seen.disconnect();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    seen.observe(panel, { childList: true, subtree: true, characterData: true });
    fireEvent.click(within(panel).getByRole("button", { name: B.doneLabel(WHAT) }));
    await waitFor(() => expect(escaped).toBe(true));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Notifications" })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Notifications/ }));
  });

  it("not an older notice that links the record or the whole board", async () => {
    env.items = [notice("1", { link: "/sessions/7" }), notice("2", { type: "session_action_due", link: "/profile#my-tasks" }), notice("3", { link: null })];
    const panel = await openBell();
    expect(within(panel).queryByRole("button", { name: /^It's done/ })).toBeNull();
  });

  it("not another kind of notice, even with a task link", async () => {
    env.items = [notice("1", { type: "session_task_back" })];
    const panel = await openBell();
    expect(within(panel).queryByRole("button", { name: /^It's done/ })).toBeNull();
  });

  it("not the batched line itself, which opens and does not act", async () => {
    env.items = ["1", "2", "3", "4"].map((id, i) => notice(id, { body: `Task ${i}`, link: taskBoardLink(20 + i) }));
    const panel = await openBell();
    expect(within(panel).queryByRole("button", { name: /^It's done/ })).toBeNull();
  });

  it("every notice inside an opened batch, with its own words and its own buttons", async () => {
    const tasks = ["Clear the overflow pipe", "Order seed", "Fix the gate latch", "Paint the shed"];
    env.items = tasks.map((body, i) => notice(String(i + 1), { body, link: taskBoardLink(20 + i) }));
    const panel = await openBell();
    const batch = within(panel).getAllByRole("button").find((b) => b.getAttribute("aria-expanded") === "false");
    fireEvent.click(batch as HTMLElement);
    const buttons = within(panel).getAllByRole("button", { name: /^It's done/ });
    expect(buttons).toHaveLength(4);
    tasks.forEach((body, i) => {
      // Each one is named for its own task, and the task's words are on the row too.
      expect(within(panel).getByRole("button", { name: B.doneLabel(body) })).toBeInTheDocument();
      expect(within(panel).getByRole("link", { name: B.openLabel(body) }).getAttribute("href")).toBe(taskBoardLink(20 + i));
      expect(within(panel).getAllByText(body).length).toBeGreaterThan(0);
    });
    // One of them answered: only that notice changes, and the panel stays open.
    fetchMock.mockResolvedValueOnce(reply(200, { task: makeTask({ entryId: 21, status: "done", canReopen: true }) }));
    fireEvent.click(within(panel).getByRole("button", { name: B.doneLabel("Order seed") }));
    expect(await within(panel).findByText(B.marked)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe(taskDoneUrl(21));
    expect(within(panel).getAllByRole("button", { name: /^It's done/ })).toHaveLength(3);
  });

  it("not inside an opened batch of another kind, nor with the module off", async () => {
    env.items = ["1", "2", "3", "4"].map((id, i) => notice(id, { type: "session_task_back", body: `Task ${i}`, link: taskBoardLink(20 + i) }));
    const panel = await openBell();
    const batch = within(panel).getAllByRole("button").find((b) => b.getAttribute("aria-expanded") === "false");
    fireEvent.click(batch as HTMLElement);
    expect(within(panel).queryByRole("button", { name: /^It's done/ })).toBeNull();
  });

  it("not while the sessions module is off", async () => {
    env.sessionsOn = false;
    env.items = [notice("1")];
    const panel = await openBell();
    expect(within(panel).queryByRole("button", { name: /^It's done/ })).toBeNull();
  });

  it("bellTaskOf reads only single task rows with a task link", () => {
    const row = { key: "k", items: [], type: "session_action_held", title: "", detail: "", link: taskBoardLink(9), at, unread: 0, batched: false };
    expect(bellTaskOf(row)).toBe(9);
    expect(bellTaskOf({ ...row, batched: true })).toBeNull();
    expect(bellTaskOf({ ...row, link: "/profile#my-tasks" })).toBeNull();
    expect(bellTaskOf({ ...row, type: "session_task_unheld" })).toBeNull();
  });
});
