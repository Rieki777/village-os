// @vitest-environment jsdom
/**
 * Landing on one task: /profile#task-<entryId>, the link every task notice
 * carries.
 *
 * The board arrives after the page, so it brings the card into view itself
 * once it has drawn: scrolled clear of the fixed header (the card's own
 * scroll-mt-28), a gold ring for a moment, and focus on the card's words so a
 * screen reader starts at the task. It does the same when the hash changes
 * while the member is already on the profile, which is how a notice opened
 * from the bell on this page arrives (the router moves by pushState). A task
 * that is not on the board as drawn lands on the board itself.
 *
 * jsdom does no layout, so the scroll is read from the call it was given, not
 * from a position.
 */
import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_BOARD_ANCHOR, taskCardAnchor } from "@shared/sessionTasks";
import { makeBoard, makeTask, reply } from "./taskFixture";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/MicButton", () => ({ default: () => null }));
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> };
});

import TaskBoard, { LANDED_RING_MS } from "@/components/profile/TaskBoard";
import { HOLD_IN_VIEW_MS } from "@/components/tasks/holdInView";
import { tasksChanged } from "@/components/tasks/useTaskCount";
import { WAITING_URL } from "@shared/waitingOnYou";

const fetchMock = vi.fn();
let scrolls: Array<{ id: string; opts: ScrollIntoViewOptions | undefined }> = [];
let reduce = false;

beforeEach(() => {
  fetchMock.mockReset();
  // The board also asks what waits on a power the member holds (governance).
  // That read answers 404 here, as in taskBoard.test.tsx, so fetchMock still
  // sees the task board's reads alone.
  vi.stubGlobal("fetch", (url: unknown, init?: unknown) =>
    String(url) === WAITING_URL ? Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 })) : fetchMock(url, init),
  );
  scrolls = [];
  reduce = false;
  Element.prototype.scrollIntoView = function (this: Element, opts?: boolean | ScrollIntoViewOptions) {
    scrolls.push({ id: this.id, opts: typeof opts === "object" ? opts : undefined });
  };
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
  // @ts-expect-error jsdom has none; each case puts its own back.
  delete Element.prototype.scrollIntoView;
});

const BOARD = makeBoard({
  holding: [makeTask({ entryId: 1, text: "Fix the gate latch" }), makeTask({ entryId: 2, text: "Order seed" })],
  finished: [makeTask({ entryId: 3, status: "done", canAnswer: false, text: "Paint the shed" })],
});

/** The board inside its profile anchor, as Profile.tsx mounts it. */
function renderBoard() {
  return render(
    <div id={TASK_BOARD_ANCHOR}>
      <TaskBoard />
    </div>,
  );
}

const card = (id: number) => document.getElementById(taskCardAnchor(id)) as HTMLElement;

describe("landing on one task", () => {
  it("gives every card its anchor, with room above it for the fixed header", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, BOARD));
    renderBoard();
    await screen.findByText("Order seed");
    for (const id of [1, 2, 3]) {
      expect(card(id)).not.toBeNull();
      expect(card(id).className).toContain("scroll-mt-28");
    }
  });

  it("scrolls to the card the hash names, rings it, and puts focus on its words", async () => {
    window.history.replaceState(null, "", "/profile#task-2");
    fetchMock.mockResolvedValueOnce(reply(200, BOARD));
    renderBoard();
    await screen.findByText("Order seed");
    await waitFor(() => expect(scrolls.map((s) => s.id)).toEqual([taskCardAnchor(2)]));
    expect(scrolls[0].opts).toMatchObject({ block: "start", behavior: "smooth" });
    expect(card(2).className).toContain("ring-gold");
    expect(card(1).className).not.toContain("ring-gold");
    // Focus is on the card's own words, the text its article is labelled by.
    expect(document.activeElement).toBe(screen.getByText("Order seed"));
  });

  it("lets the ring go after a moment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.history.replaceState(null, "", "/profile#task-1");
    fetchMock.mockResolvedValueOnce(reply(200, BOARD));
    renderBoard();
    await screen.findByText("Fix the gate latch");
    await waitFor(() => expect(card(1).className).toContain("ring-gold"));
    // The ring is on, but the effect that sets its timeout runs after the
    // render the waitFor saw. Let React flush it, so the timer exists before
    // the clock moves.
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(LANDED_RING_MS + 10);
    });
    await waitFor(() => expect(card(1).className).not.toContain("ring-gold"));
  });

  it("holds the card in view while the page above it draws, and lets go when the reader scrolls", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        cb: () => void;
        constructor(cb: () => void) {
          this.cb = cb;
          observers.push(this.fire);
        }
        observe() {}
        disconnect() {
          const i = observers.indexOf(this.fire);
          if (i >= 0) observers.splice(i, 1);
        }
        fire = () => this.cb();
      },
    );
    window.history.replaceState(null, "", "/profile#task-2");
    fetchMock.mockResolvedValueOnce(reply(200, BOARD));
    renderBoard();
    await screen.findByText("Order seed");
    await waitFor(() => expect(scrolls).toHaveLength(1));
    let top = 0;
    card(2).getBoundingClientRect = () => ({ top, bottom: top + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: top, toJSON() {} }) as DOMRect;
    const resize = () => act(() => observers.slice().forEach((f) => f()));
    // The observer's first report, as it starts, is not drift.
    top = 900;
    resize();
    expect(scrolls).toHaveLength(1);
    // A section above drew and pushed the card below the fold: it comes back, at once.
    resize();
    expect(scrolls).toHaveLength(2);
    expect(scrolls[1]).toMatchObject({ id: taskCardAnchor(2), opts: { block: "start", behavior: "auto" } });
    // Where it should be, nothing moves.
    top = 0;
    resize();
    expect(scrolls).toHaveLength(2);
    // The reader scrolls: the page is theirs now.
    act(() => {
      window.dispatchEvent(new Event("wheel"));
    });
    top = 900;
    resize();
    expect(scrolls).toHaveLength(2);
  });

  it("lets go of the card once the page has had time to settle, and focus is on it still", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          observers.push(cb);
        }
        observe() {}
        disconnect() {
          observers.length = 0;
        }
      },
    );
    window.history.replaceState(null, "", "/profile#task-1");
    fetchMock.mockResolvedValueOnce(reply(200, BOARD));
    renderBoard();
    await screen.findByText("Fix the gate latch");
    await waitFor(() => expect(scrolls).toHaveLength(1));
    // Focus wandered to the page while things drew; the settle puts it back on the card.
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      vi.advanceTimersByTime(HOLD_IN_VIEW_MS + 10);
    });
    expect(observers).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByText("Fix the gate latch"));
  });

  it("does not glide for a reader who asks for reduced motion", async () => {
    reduce = true;
    window.history.replaceState(null, "", "/profile#task-1");
    fetchMock.mockResolvedValueOnce(reply(200, BOARD));
    renderBoard();
    await screen.findByText("Fix the gate latch");
    await waitFor(() => expect(scrolls).toHaveLength(1));
    expect(scrolls[0].opts).toMatchObject({ behavior: "auto" });
    // The transition itself only runs where motion is welcome.
    expect(card(1).className).toContain("motion-safe:transition-shadow");
    expect(card(1).className).not.toMatch(/(^|\s)transition-shadow/);
  });

  it("lands when the hash changes on the profile, as a notice from the bell does", async () => {
    window.history.replaceState(null, "", "/profile");
    fetchMock.mockResolvedValueOnce(reply(200, BOARD));
    renderBoard();
    await screen.findByText("Paint the shed");
    expect(scrolls).toHaveLength(0);
    // The router moves by pushState, which sends no hashchange.
    act(() => window.history.pushState(null, "", "/profile#task-3"));
    await waitFor(() => expect(scrolls.map((s) => s.id)).toEqual([taskCardAnchor(3)]));
    expect(document.activeElement).toBe(screen.getByText("Paint the shed"));
    // And by a plain hashchange too, from the address bar.
    window.history.replaceState(null, "", "/profile#task-1");
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(scrolls.map((s) => s.id)).toEqual([taskCardAnchor(3), taskCardAnchor(1)]));
  });

  it("lands on the board itself for a task it does not show", async () => {
    window.history.replaceState(null, "", "/profile#task-99");
    fetchMock.mockResolvedValueOnce(reply(200, BOARD));
    renderBoard();
    await screen.findByText("Order seed");
    await waitFor(() => expect(scrolls.map((s) => s.id)).toEqual([TASK_BOARD_ANCHOR]));
    expect(document.querySelector(".ring-gold")).toBeNull();
  });

  it("still lands on the board for #my-tasks, the menu's link", async () => {
    window.history.replaceState(null, "", `/profile#${TASK_BOARD_ANCHOR}`);
    fetchMock.mockResolvedValueOnce(reply(200, BOARD));
    renderBoard();
    await screen.findByText("Order seed");
    await waitFor(() => expect(scrolls.map((s) => s.id)).toEqual([TASK_BOARD_ANCHOR]));
  });

  it("leaves the page alone for a hash that is not the board's", async () => {
    window.history.replaceState(null, "", "/profile#wallet");
    fetchMock.mockResolvedValueOnce(reply(200, BOARD));
    renderBoard();
    await screen.findByText("Order seed");
    act(() => window.history.pushState(null, "", "/profile#task-07"));
    await act(async () => {});
    expect(scrolls).toHaveLength(0);
  });

  it("reads again quietly when a task is done from the bell, and not for its own answers", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, BOARD)).mockResolvedValueOnce(reply(200, makeBoard({ finished: BOARD.holding })));
    renderBoard();
    await screen.findByText("Order seed");
    act(() => tasksChanged("board"));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => tasksChanged("bell"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Paint the shed")).toBeNull());
  });
});
