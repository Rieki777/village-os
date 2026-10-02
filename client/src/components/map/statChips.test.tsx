// @vitest-environment jsdom
/**
 * The shell's half of the crown bar's chips: ask the village, hand the map the
 * answer, and ask again on the map's live cadence (components/map/statChips.ts).
 *
 * The artifact's half (drawing what arrives) is shared/mapArtifactChips.test.ts,
 * and the server's (what each chip reads) is server/routes/mapChips.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MAP_CHIPS_REFRESH_MS, MAP_CHIPS_SAVED_EVENT, MAP_CHIPS_SAVED_KEY } from "@shared/mapStatChips";

const gameFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gameApi", () => ({ gameFetch: (...a: unknown[]) => gameFetch(...a) }));

import { pushChips, useChipsCadence } from "./statChips";

const CHIPS = [{ id: "members", label: "Members", state: "live", value: "41" }];
const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  gameFetch.mockReset();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("handing the map its chips", () => {
  it("asks the village with the viewer's session, and posts the chips into the frame", async () => {
    gameFetch.mockResolvedValue(answer({ chips: CHIPS, refreshMs: MAP_CHIPS_REFRESH_MS }));
    const win = { postMessage: vi.fn() } as unknown as Window;
    expect(await pushChips(win)).toBe(true);
    // gameFetch is the one place that attaches the session: a member's bar
    // can carry a members-only chip a visitor's does not.
    expect(gameFetch).toHaveBeenCalledWith("/api/map/chips");
    expect(win.postMessage).toHaveBeenCalledWith({ type: "chips", chips: CHIPS }, window.location.origin);
  });

  it("posts nothing when the village does not answer, so the map keeps what it drew", async () => {
    const win = { postMessage: vi.fn() } as unknown as Window;
    gameFetch.mockResolvedValue(answer({ error: "module_disabled" }, 404));
    expect(await pushChips(win)).toBe(false);
    gameFetch.mockRejectedValue(new Error("offline"));
    expect(await pushChips(win)).toBe(false);
    gameFetch.mockResolvedValue(answer({ chips: "nope" }));
    expect(await pushChips(win)).toBe(false);
    expect(win.postMessage).not.toHaveBeenCalled();
    expect(await pushChips(null)).toBe(false);
  });
});

describe("the cadence the bar is refreshed on", () => {
  const mount = (active: boolean) => {
    const push = vi.fn();
    const hook = renderHook(({ on }) => useChipsCadence(push, on), { initialProps: { on: active } });
    return { push, hook };
  };

  it("asks nothing until the map has booted", () => {
    vi.useFakeTimers();
    const { push } = mount(false);
    act(() => { vi.advanceTimersByTime(MAP_CHIPS_REFRESH_MS * 3); });
    window.dispatchEvent(new Event(MAP_CHIPS_SAVED_EVENT));
    expect(push).not.toHaveBeenCalled();
  });

  it("asks every minute while the map is in view, and not while the tab is hidden", () => {
    vi.useFakeTimers();
    const { push } = mount(true);
    act(() => { vi.advanceTimersByTime(MAP_CHIPS_REFRESH_MS * 2); });
    expect(push).toHaveBeenCalledTimes(2);
    visibility = "hidden";
    act(() => { vi.advanceTimersByTime(MAP_CHIPS_REFRESH_MS * 3); });
    expect(push, "a hidden tab asks nothing").toHaveBeenCalledTimes(2);
    visibility = "visible";
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(push, "and asks the moment it is looked at again").toHaveBeenCalledTimes(3);
  });

  it("asks at once when a founder saves the chips, in this tab or another", () => {
    const { push } = mount(true);
    act(() => { window.dispatchEvent(new Event(MAP_CHIPS_SAVED_EVENT)); });
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: MAP_CHIPS_SAVED_KEY })); });
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "something.else" })); });
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("stops asking when the map closes", () => {
    vi.useFakeTimers();
    const { push, hook } = mount(true);
    hook.unmount();
    act(() => { vi.advanceTimersByTime(MAP_CHIPS_REFRESH_MS * 3); });
    window.dispatchEvent(new Event(MAP_CHIPS_SAVED_EVENT));
    expect(push).not.toHaveBeenCalled();
  });
});
