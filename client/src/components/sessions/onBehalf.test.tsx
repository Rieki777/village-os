// @vitest-environment jsdom
/**
 * A facilitator fills in for a member (0288), in the room as a person sees it.
 *
 * The facilitator chooses who they are filling in for once, on their bar, and
 * the arrival, a new agenda item and a new entry go in as that person's
 * (`forUserId`). A consent answer never carries one. Whatever was filled in
 * reads "Filled in by the Facilitator", by the role and never the
 * facilitator's name, and the person sees Undo beside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { ON_BEHALF_COPY } from "@shared/sessionOnBehalf";
import { json, makeView, record, type Call } from "./__tests__/roomFixture";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import FilledInNote from "./FilledInNote";
import FacilitatorBar from "./FacilitatorBar";
import { useSessionRoom, type RoomActions } from "./useSessionRoom";

describe("the mark on something filled in", () => {
  it("names the role, and offers Undo only to whoever the server says may", async () => {
    const undoFill = vi.fn(async () => ({ ok: true as const, body: {}, room: null }));
    const { rerender } = render(<FilledInNote filled={{ id: 41, personUserId: 2, act: "added", canUndo: true }} actions={{ undoFill }} />);
    expect(screen.getByText(ON_BEHALF_COPY.filledInBy())).toBeTruthy();
    expect(screen.getByText("Filled in by the Facilitator")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: ON_BEHALF_COPY.undo }));
    });
    expect(undoFill).toHaveBeenCalledWith(41);

    rerender(<FilledInNote filled={{ id: 42, personUserId: 2, act: "changed", canUndo: false }} actions={{ undoFill }} />);
    expect(screen.getByText(ON_BEHALF_COPY.changedBy())).toBeTruthy();
    expect(screen.queryByRole("button", { name: ON_BEHALF_COPY.undo })).toBeNull();

    rerender(<FilledInNote filled={null} actions={{ undoFill }} />);
    expect(screen.queryByText(/Filled in by|Changed by/)).toBeNull();
  });
});

describe("the facilitator's bar", () => {
  it("chooses who the facilitator is filling in for, and says so", () => {
    const fillFor = vi.fn();
    const view = makeView({ facilitatorUserId: 1, me: { userId: 1, joined: true, facilitates: true, secretary: false, admin: false } });
    const actions = { fillFor, fillingFor: null } as unknown as RoomActions;
    const { rerender } = render(<FacilitatorBar view={view} actions={actions} shown="arrival" onMoved={() => {}} />);
    const pick = screen.getByLabelText(ON_BEHALF_COPY.fillingForLabel) as HTMLSelectElement;
    // Everybody else in the room, and the facilitator themself as the way back.
    expect(Array.from(pick.options).map((o) => o.textContent)).toEqual([ON_BEHALF_COPY.fillingForNobody, "Bo Fern", "Cy Reed"]);
    fireEvent.change(pick, { target: { value: "2" } });
    expect(fillFor).toHaveBeenCalledWith(2);

    rerender(<FacilitatorBar view={view} actions={{ fillFor, fillingFor: 2 } as unknown as RoomActions} shown="arrival" onMoved={() => {}} />);
    expect(screen.getByText(ON_BEHALF_COPY.fillingForLine("Bo Fern")).getAttribute("role")).toBe("status");
  });
});

describe("the doors while filling in", () => {
  let calls: Call[];
  let view = makeView();

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const c = record(calls, url, init);
        return c.method === "GET" ? json(view, 200, { ETag: '"s7-1"' }) : json({ ok: true });
      }),
    );
  });
  // Unmount first: a describe's own afterEach runs before setup.ts's cleanup.
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const settle = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  };
  const posted = (path: string) => calls.filter((c) => c.method === "POST" && c.url === `/api/sessions/7${path}`).map((c) => c.body);

  it("sends forUserId with the arrival, an item and an entry, and never with an answer", async () => {
    view = makeView({ facilitatorUserId: 1, me: { userId: 1, joined: true, facilitates: true, secretary: false, admin: false } });
    const { result } = renderHook(() => useSessionRoom(7, { pollMs: 60_000, hereMs: 60_000 }));
    await settle();
    act(() => result.current.actions.fillFor?.(2));
    await settle();
    expect(result.current.actions.fillingFor).toBe(2);

    await act(async () => {
      await result.current.actions.arrival(6, null);
      await result.current.actions.addItem({ title: "Tank", aim: "report", minutes: 5 });
      await result.current.actions.addEntry({ kind: "tension", text: "It leaks" });
      await result.current.actions.respond("agenda", "consent");
    });
    expect(posted("/arrival")).toEqual([{ score: 6, forUserId: 2 }]);
    expect(posted("/items")).toEqual([{ title: "Tank", aim: "report", minutes: 5, forUserId: 2 }]);
    expect(posted("/entries")).toEqual([{ kind: "tension", text: "It leaks", forUserId: 2 }]);
    expect(posted("/respond")).toEqual([{ target: "agenda", value: "consent" }]);

    // Back to Myself: the next write is the facilitator's own.
    act(() => result.current.actions.fillFor?.(null));
    await act(async () => {
      await result.current.actions.addItem({ title: "Mine", aim: "report", minutes: 5 });
    });
    expect(posted("/items").at(-1)).toEqual({ title: "Mine", aim: "report", minutes: 5 });

    await act(async () => {
      await result.current.actions.undoFill?.(41);
    });
    expect(posted("/on-behalf/41/undo")).toEqual([{}]);
  });

  it("lets go of the choice once the viewer no longer facilitates", async () => {
    view = makeView({ facilitatorUserId: 1, me: { userId: 1, joined: true, facilitates: true, secretary: false, admin: false } });
    const { result } = renderHook(() => useSessionRoom(7, { pollMs: 1000, hereMs: 60_000 }));
    await settle();
    act(() => result.current.actions.fillFor?.(2));
    await settle();
    expect(result.current.actions.fillingFor).toBe(2);
    view = makeView({ version: 9, facilitatorUserId: 3, me: { userId: 1, joined: true, facilitates: false, secretary: false, admin: false } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.actions.fillingFor).toBeNull();
    await act(async () => {
      await result.current.actions.addEntry({ kind: "note", text: "Mine" });
    });
    expect(posted("/entries")).toEqual([{ kind: "note", text: "Mine" }]);
  });
});
