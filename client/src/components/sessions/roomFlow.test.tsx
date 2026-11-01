// @vitest-environment jsdom
/**
 * The room's flow (Rye, 2026-10-30), as a person sees it:
 *
 *   the agenda by crowd vote (0290)  everyone votes items up or down, the
 *                                    same vote again takes it back, and the
 *                                    facilitator sets the order, after which
 *                                    the arrows show
 *   wins and celebrations            a section on the item's page, a stream
 *                                    of `win` entries, switched by name
 *   the next step                    one bar for the facilitator that names
 *                                    the next thing and does it in one tap
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { ROOM_COPY, SESSION_COPY, STAGE_DEFS, defaultSessionState, type SessionAction, type SessionItem, type SessionState } from "@shared/sessions";
import { VOTE_COPY } from "@shared/sessionVotes";
import { T0, json, makeView, record, type Call } from "./__tests__/roomFixture";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import AgendaList from "./AgendaList";
import ItemPage from "./ItemPage";
import NextStepBar, { nextStep } from "./NextStepBar";
import { useSessionRoom, type RoomActions } from "./useSessionRoom";

const item = (id: number, title: string, over: Partial<SessionItem> = {}): SessionItem => ({
  id,
  title,
  aim: "explore",
  minutes: 10,
  position: id,
  status: "waiting",
  presenterUserId: null,
  addedBy: 2,
  startedAt: null,
  endedAt: null,
  usedSeconds: 0,
  fromSessionId: null,
  votes: { up: 0, down: 0, mine: 0 },
  ...over,
});

const ok = async () => ({ ok: true as const, body: {}, room: null });
const ADA = { userId: 1, joined: true, facilitates: true, secretary: false, admin: false };

describe("the agenda by crowd vote", () => {
  it("lets a member vote up or down, and the same vote again takes it back", async () => {
    const vote = vi.fn(ok);
    const view = makeView({ items: [item(11, "Tank", { votes: { up: 2, down: 1, mine: 1 } }), item(12, "Seeds")] });
    render(<AgendaList view={view} actions={{ vote } as unknown as RoomActions} />);

    const up = screen.getByRole("button", { name: VOTE_COPY.voteUp("Tank") });
    expect(up.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("group", { name: VOTE_COPY.tally(2, 1) })).toBeTruthy();
    const click = (el: HTMLElement) => act(async () => void fireEvent.click(el));
    await click(up);
    expect(vote).toHaveBeenLastCalledWith(11, 0);
    await click(screen.getByRole("button", { name: VOTE_COPY.voteDown("Tank") }));
    expect(vote).toHaveBeenLastCalledWith(11, -1);
    await click(screen.getByRole("button", { name: VOTE_COPY.voteUp("Seeds") }));
    expect(vote).toHaveBeenLastCalledWith(12, 1);

    // A member sees the room's vote, and no way to set the order or move items.
    expect(screen.getByText(VOTE_COPY.open)).toBeTruthy();
    expect(screen.queryByRole("button", { name: VOTE_COPY.setOrder })).toBeNull();
    expect(screen.queryByRole("button", { name: ROOM_COPY.moveUp })).toBeNull();
  });

  it("gives the facilitator Set the order, and the arrows only once the order is set", async () => {
    const setOrder = vi.fn(ok);
    const items = [item(11, "Tank"), item(12, "Seeds")];
    const actions = { vote: vi.fn(ok), setOrder } as unknown as RoomActions;
    const { rerender } = render(<AgendaList view={makeView({ me: ADA, items })} actions={actions} />);
    expect(screen.queryByRole("button", { name: ROOM_COPY.moveUp })).toBeNull();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: VOTE_COPY.setOrder })));
    expect(setOrder).toHaveBeenCalledWith(true);

    const set = { ...defaultSessionState(), orderSet: true };
    rerender(<AgendaList view={makeView({ me: ADA, items, state: set })} actions={actions} />);
    expect(screen.getByText(VOTE_COPY.set)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: ROOM_COPY.moveDown })).toHaveLength(2);
    // The vote is closed, so nobody's vote buttons show.
    expect(screen.queryByRole("button", { name: VOTE_COPY.voteUp("Tank") })).toBeNull();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: VOTE_COPY.reopen })));
    expect(setOrder).toHaveBeenLastCalledWith(false);
  });

  it("posts the viewer's own vote to the vote door, and the order to the order door", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const c = record(calls, url, init);
        return c.method === "GET" ? json(makeView({ me: ADA }), 200, { ETag: '"s7-1"' }) : json({ ok: true });
      }),
    );
    try {
      const { result } = renderHook(() => useSessionRoom(7, { pollMs: 60_000, hereMs: 60_000 }));
      await act(async () => {
        await result.current.actions.vote?.(11, -1);
        await result.current.actions.setOrder?.(true);
      });
      const posts = calls.filter((c) => c.method === "POST").map((c) => [c.url, c.body]);
      expect(posts).toContainEqual(["/api/sessions/7/items/11/vote", { vote: -1 }]);
      expect(posts).toContainEqual(["/api/sessions/7/agenda/order", { set: true }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("wins and celebrations", () => {
  it("is a section on every item's page, and a win goes in as its own kind", async () => {
    const addEntry = vi.fn(ok);
    const it11 = item(11, "Tank");
    render(
      <ItemPage
        view={makeView({ items: [it11], entries: [] })}
        now={T0}
        actions={{ addEntry, patchItem: vi.fn(ok), act: vi.fn(ok) } as unknown as RoomActions}
        item={it11}
      />,
    );
    expect(screen.getByRole("heading", { name: ROOM_COPY.wins })).toBeTruthy();
    expect(screen.getByText(ROOM_COPY.winsHelp)).toBeTruthy();
    const box = screen.getByLabelText(SESSION_COPY.addWin);
    fireEvent.change(box, { target: { value: "The tank holds water again" } });
    await act(async () => {
      fireEvent.submit(box.closest("form")!);
    });
    expect(addEntry).toHaveBeenCalledWith({ kind: "win", text: "The tank holds water again", itemId: 11 });
  });

  it("shows only the sections a template names", () => {
    const it11 = item(11, "Tank");
    render(<ItemPage view={makeView({ items: [it11], itemSections: ["wins", "notes"] })} now={T0} actions={{} as RoomActions} item={it11} />);
    expect(screen.getByRole("heading", { name: ROOM_COPY.wins })).toBeTruthy();
    expect(screen.getByRole("heading", { name: ROOM_COPY.notes })).toBeTruthy();
    for (const gone of [ROOM_COPY.ideas, ROOM_COPY.proposal, ROOM_COPY.seed, ROOM_COPY.actionsHere]) {
      expect(screen.queryByRole("heading", { name: gone }), gone).toBeNull();
    }
  });
});

describe("the next step", () => {
  const started: SessionState = { ...defaultSessionState(), startedAt: T0 - 600_000 };
  const room = (state: Partial<SessionState>, items: SessionItem[]) => makeView({ me: ADA, items, state: { ...started, ...state } });

  it("names the next thing on the agenda, the items and the close, and nothing for a member", () => {
    const items = [item(11, "Tank"), item(12, "Seeds")];
    expect(nextStep(room({ stage: "agenda" }, items), T0)).toMatchObject({
      line: ROOM_COPY.upNext("Tank"),
      primary: { label: ROOM_COPY.startFirst, move: { acts: [{ type: "go", stage: "items" }, { type: "item", itemId: 11 }] } },
    });

    const on = [item(11, "Tank", { status: "active" }), item(12, "Seeds")];
    const live = room({ stage: "items", activeItemId: 11, itemStartedAt: T0 - 60_000 }, on);
    expect(nextStep(live, T0)).toMatchObject({ line: ROOM_COPY.upNext("Seeds"), over: false, primary: { label: ROOM_COPY.wrapNext } });
    expect(nextStep(live, T0)?.secondary).toBeUndefined();

    // The time runs out: the bar says so, and offers five more minutes beside the wrap up.
    const over = nextStep(room({ stage: "items", activeItemId: 11, itemStartedAt: T0 - 11 * 60_000 }, on), T0);
    expect(over).toMatchObject({ line: ROOM_COPY.timeUpFor("Tank"), over: true, secondary: { label: ROOM_COPY.extendFive } });

    const last = [item(11, "Tank", { status: "done" }), item(12, "Seeds", { status: "active" })];
    expect(nextStep(room({ stage: "items", activeItemId: 12, itemStartedAt: T0 }, last), T0)).toMatchObject({
      line: ROOM_COPY.lastItem,
      primary: { label: ROOM_COPY.wrapUp, move: { acts: [{ type: "item", itemId: null }] } },
    });
    const between = [item(11, "Tank", { status: "done" }), item(12, "Seeds")];
    expect(nextStep(room({ stage: "items" }, between), T0)).toMatchObject({ primary: { label: ROOM_COPY.startNext, move: { acts: [{ type: "item", itemId: 12 }] } } });
    const allDone = [item(11, "Tank", { status: "done" })];
    expect(nextStep(room({ stage: "items" }, allDone), T0)).toMatchObject({
      line: ROOM_COPY.itemsDone,
      primary: { label: `${ROOM_COPY.nextStage}: ${STAGE_DEFS.actions.short}` },
    });
    expect(nextStep(room({ stage: "close" }, allDone), T0)).toMatchObject({ line: ROOM_COPY.closeLast, primary: { label: ROOM_COPY.goToClose } });

    // A member, a room not yet begun, and a stage the facilitator's bar already names get nothing.
    expect(nextStep(makeView({ items, state: { ...started, stage: "agenda" } }), T0)).toBeNull();
    expect(nextStep(room({ stage: "agenda", startedAt: null }, items), T0)).toBeNull();
    expect(nextStep(room({ stage: "arrival" }, items), T0)).toBeNull();
  });

  describe("the bar", () => {
    beforeEach(() => vi.useRealTimers());
    // Unmount first: a describe's own afterEach runs before setup.ts's cleanup.
    afterEach(() => { cleanup(); vi.restoreAllMocks(); });

    it("does the whole move in one tap, in order, and only on the room's own stage", async () => {
      const act_ = vi.fn(async (_action: SessionAction) => ({ ok: true as const, body: {}, room: null }));
      const onMoved = vi.fn();
      const view = room({ stage: "agenda" }, [item(11, "Tank")]);
      const { rerender } = render(<NextStepBar view={view} now={T0} actions={{ act: act_ } as unknown as RoomActions} shown="agenda" onMoved={onMoved} />);
      expect(screen.getByRole("region", { name: ROOM_COPY.nextStepLabel })).toBeTruthy();
      expect(screen.getByRole("status").textContent).toContain(ROOM_COPY.upNext("Tank"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.startFirst }));
      });
      expect(act_.mock.calls.map((c) => c[0])).toEqual([
        { type: "go", stage: "items" },
        { type: "item", itemId: 11 },
      ]);
      expect(onMoved).toHaveBeenCalled();

      rerender(<NextStepBar view={view} now={T0} actions={{ act: act_ } as unknown as RoomActions} shown="arrival" onMoved={onMoved} />);
      expect(screen.queryByRole("region", { name: ROOM_COPY.nextStepLabel })).toBeNull();
    });
  });
});
