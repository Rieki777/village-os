// @vitest-environment jsdom
/**
 * THE MAP'S HISTORY, DRIVEN THE WAY A VISITOR DRIVES IT.
 *
 * Each case here asserts the history STACK and what reached the map, not only
 * the URL a step ends on. The defects this pins were all about the stack:
 *
 *   - a return to /map by Back or Forward pushed the marker again, which
 *     erased Forward and turned Back into a loop through the gate (F10);
 *   - Back with a place open left the map, losing the place (F55);
 *   - any fragment navigation on /map sent the visitor to `/` (F31, F56);
 *   - the address bar never followed the map, so F5 and a shared link lost
 *     the place (F36, F57, F65).
 *
 * jsdom's history is a real one for this purpose: pushState, replaceState,
 * back and forward traverse asynchronously and fire popstate, and a fragment
 * navigation fires popstate before hashchange, as browsers do. What it cannot
 * stand in for is Chrome's history-manipulation intervention, which skips
 * entries pushed without user activation on the toolbar's Back. That was
 * driven through `chrome.tabs.goBack` in Chromium, with six seconds between
 * presses so no activation was left, and Back closed the place, then left to
 * `/`, then reached the page before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { isMapRoute, useMapHistory } from "./mapHistory";
import { arrivedEntered, useMapEnterGate } from "./EnterTheLandGate";

const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));

/** wouter's navigate, as far as this hook can tell. */
function makeNavigate() {
  return vi.fn((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
  });
}

function mount({ entered = true } = {}) {
  const posted: unknown[] = [];
  const frame = { current: { contentWindow: { postMessage: (m: unknown) => posted.push(m) } } } as never;
  const navigate = makeNavigate();
  const enterAt = vi.fn();
  const hook = renderHook(() => useMapHistory({ navigate, frame, entered, enterAt }));
  // The artifact has booted, so routes are sent at once.
  act(() => hook.result.current.onReady());
  const gotos = () => posted.filter((m: any) => m?.type === "goto").map((m: any) => m.hash);
  return { hook, navigate, enterAt, gotos, api: () => hook.result.current };
}

const here = () => window.location.pathname + window.location.hash;
const state = () => window.history.state as Record<string, unknown> | null;

beforeEach(() => {
  // Every case arrives on /map from a page before it, by an ordinary link.
  window.history.pushState(null, "", "/quests");
  window.history.pushState(null, "", "/map");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("arriving on the map", () => {
  it("stamps the arrival entry as the base and pushes one marker over it", async () => {
    const before = window.history.length;
    const m = mount();
    expect(window.history.length - before).toBe(1);
    expect(state()).toMatchObject({ villageMapApp: true, depth: 1 });
    m.hook.unmount();
  });

  it("returning onto a map entry pushes nothing, so Forward survives (F10)", async () => {
    const first = mount();
    first.hook.unmount(); // a door out to the site unmounts the shell
    const before = window.history.length;
    const again = mount(); // Back onto the same entry mounts it again
    expect(window.history.length, "a second marker would erase Forward").toBe(before);
    expect(state()).toMatchObject({ villageMapApp: true, depth: 1 });
    again.hook.unmount();
  });

  it("an entry where Enter was pressed starts the next visit to it entered", async () => {
    const m = mount({ entered: false });
    expect(arrivedEntered()).toBe(false);
    act(() => m.api().markEntered());
    expect(arrivedEntered()).toBe(true);
    m.hook.unmount();
    const gate = renderHook(() => useMapEnterGate());
    expect(gate.result.current.entered, "the gate is not shown a second time").toBe(true);
    gate.unmount();
  });
});

describe("Back closes what is open before it leaves", () => {
  it("a place the visitor opened gets its own entry; Back closes it, Forward reopens it, Back again leaves (F55)", async () => {
    const m = mount();
    const marker = window.history.length;
    act(() => m.api().onRoute({ hash: "#/place/greenhouse", user: true }));
    expect(here()).toBe("/map#/place/greenhouse");
    expect(window.history.length).toBe(marker + 1);

    window.history.back();
    await tick();
    expect(here()).toBe("/map");
    expect(m.gotos().at(-1), "the map is told to close").toBe("");
    expect(m.navigate).not.toHaveBeenCalled();

    window.history.forward();
    await tick();
    expect(here()).toBe("/map#/place/greenhouse");
    expect(m.gotos().at(-1)).toBe("#/place/greenhouse");

    window.history.back();
    await tick();
    window.history.back();
    await tick();
    expect(m.navigate).toHaveBeenCalledWith("/", { replace: true });
    expect(here()).toBe("/");
    m.hook.unmount();
  });

  it("moving between open things replaces, so a run of clicks never stacks Back presses", async () => {
    const m = mount();
    const marker = window.history.length;
    act(() => m.api().onRoute({ hash: "#/place/greenhouse", user: true }));
    act(() => m.api().onRoute({ hash: "#/module/stay", user: true }));
    act(() => m.api().onRoute({ hash: "#/place/kitchen", user: false }));
    expect(window.history.length).toBe(marker + 1);
    expect(here()).toBe("/map#/place/kitchen");
    m.hook.unmount();
  });

  it("an open with no visitor behind it only moves the address (F36, F57)", async () => {
    const m = mount();
    const marker = window.history.length;
    act(() => m.api().onRoute({ hash: "#/place/welcome", user: false }));
    expect(here()).toBe("/map#/place/welcome");
    expect(window.history.length).toBe(marker);
    expect(state(), "the marker keeps its state").toMatchObject({ villageMapApp: true, depth: 1 });
    m.hook.unmount();
  });

  it("closing what an open entry opened steps back over it, so the next Back leaves", async () => {
    const m = mount();
    act(() => m.api().onRoute({ hash: "#/place/greenhouse", user: true }));
    act(() => m.api().onRoute({ hash: "", user: true }));
    await tick();
    expect(here()).toBe("/map");
    expect(state()).toMatchObject({ depth: 1 });
    expect(m.gotos(), "nothing is sent: the map already shows it").toEqual([]);
    window.history.back();
    await tick();
    expect(m.navigate).toHaveBeenCalledWith("/", { replace: true });
    m.hook.unmount();
  });

  it("leaving from an open place takes one press and lands on the village door", async () => {
    const m = mount();
    act(() => m.api().onRoute({ hash: "#/place/greenhouse", user: true }));
    act(() => m.api().exitApp());
    await tick();
    expect(m.navigate).toHaveBeenCalledTimes(1);
    expect(m.navigate).toHaveBeenCalledWith("/", { replace: true });
    expect(here()).toBe("/");
    window.history.back();
    await tick();
    expect(here(), "Back from the door reaches the page before the map").toBe("/quests");
    m.hook.unmount();
  });
});

describe("the address bar on the map", () => {
  it("a fragment navigation keeps the map and routes it (F31, F56)", async () => {
    const m = mount();
    window.location.hash = "#/place/kitchen";
    await tick();
    expect(m.navigate, "the visitor is not sent home").not.toHaveBeenCalled();
    expect(here()).toBe("/map#/place/kitchen");
    expect(m.gotos().at(-1)).toBe("#/place/kitchen");
    expect(state()).toMatchObject({ villageMapApp: true, depth: 2 });

    window.history.back();
    await tick();
    expect(m.navigate).not.toHaveBeenCalled();
    expect(m.gotos().at(-1)).toBe("");
    window.history.back();
    await tick();
    expect(m.navigate).toHaveBeenCalledWith("/", { replace: true });
    m.hook.unmount();
  });

  it("a same-route navigation by the router routes the map too", async () => {
    const m = mount();
    window.history.pushState(null, "", "/map#/loom");
    act(() => {
      window.dispatchEvent(new Event("pushState"));
    });
    expect(m.gotos().at(-1)).toBe("#/loom");
    expect(m.navigate).not.toHaveBeenCalled();
    m.hook.unmount();
  });

  it("a deep link pasted while the gate is up opens the land at it", async () => {
    const m = mount({ entered: false });
    window.location.hash = "#/place/kitchen";
    await tick();
    expect(m.enterAt).toHaveBeenCalledWith("#/place/kitchen");
    expect(m.navigate).not.toHaveBeenCalled();
    m.hook.unmount();
  });

  it("writes only the artifact's own addresses into the URL", () => {
    expect(isMapRoute("")).toBe(true);
    expect(isMapRoute("#/place/greenhouse?item=quest:plant-the-dry-season-beds")).toBe(true);
    expect(isMapRoute("#/place/greenhouse&skipIntro")).toBe(false);
    expect(isMapRoute("#hud=pocket")).toBe(false);
    expect(isMapRoute("#/place/<img>")).toBe(false);
    expect(isMapRoute("https://elsewhere.test/")).toBe(false);
  });
});
