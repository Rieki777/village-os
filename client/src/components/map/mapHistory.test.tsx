// @vitest-environment jsdom
/**
 * THE MAP'S HISTORY, DRIVEN THE WAY A VISITOR DRIVES IT.
 *
 * Rye's ruling (D6, 2026-10-02): "back should send you to the last page you
 * were on." The map is one page. Each case here asserts the history STACK and
 * where Back, Forward and a reload actually land, not only the URL a step ends
 * on:
 *
 *   - one Back press from ANY in-map state lands on the page before the map,
 *     and the Leave the map door does the same;
 *   - Forward from there returns to the map in the state its address names;
 *   - a reload lands on the same state, with no gate;
 *   - in-map state never adds an entry, and the address still follows it;
 *   - a fresh tab has the village home under the map;
 *   - a lens is part of the address (D7), and a phone's #/circles link goes
 *     to /map/circles (D8).
 *
 * Measured on this branch before the change, in Chromium: from /quests, enter,
 * open the Greenhouse, then Back gave /map (closed), Back gave `/`, Back gave
 * /quests, and Forward from there gave `/`, never the map.
 *
 * jsdom's history is a real one for this purpose: pushState, replaceState,
 * back and forward traverse asynchronously and fire popstate, and a fragment
 * navigation fires popstate before hashchange, as browsers do. The router is
 * stood in for by unmounting the hook when Back reaches another page and
 * mounting it again when Forward returns, which is what wouter does with
 * LivingMap. What jsdom cannot stand in for is Chrome's history intervention,
 * which can skip the fresh tab's home entry on the TOOLBAR Back until the
 * visitor's first click or key; script `history.back()` never skips it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { addressRoute, circlesOnPhone, isMapRoute, useMapHistory } from "./mapHistory";
import { arrivedEntered, useMapEnterGate } from "./EnterTheLandGate";

const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));
/** Let a walk back over several entries finish: each step is its own traversal. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await tick();
};

/** wouter's navigate, as far as this hook can tell. */
function makeNavigate() {
  return vi.fn((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
  });
}

type Props = { entered: boolean; pocket: boolean };

function mount({ entered = true, pocket = false }: Partial<Props> = {}) {
  const posted: unknown[] = [];
  const frame = { current: { contentWindow: { postMessage: (m: unknown) => posted.push(m) } } } as never;
  const navigate = makeNavigate();
  const enterAt = vi.fn();
  const hook = renderHook((p: Props) => useMapHistory({ navigate, frame, enterAt, ...p }), {
    initialProps: { entered, pocket },
  });
  // The artifact has booted, so routes are sent at once.
  act(() => hook.result.current.onReady());
  const gotos = () => posted.filter((m: any) => m?.type === "goto").map((m: any) => m.hash);
  return { hook, navigate, enterAt, gotos, api: () => hook.result.current };
}

const here = () => window.location.pathname + window.location.hash;
const state = () => window.history.state as Record<string, unknown> | null;

/** Pretend this tab has no entry but the current one, for the mount alone. */
function asFreshTab<T>(fn: () => T): T {
  const spy = vi.spyOn(Object.getPrototypeOf(window.history), "length", "get").mockReturnValue(1);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

beforeEach(() => {
  // Every case arrives on /map from a page before it, by an ordinary link.
  window.history.pushState(null, "", "/quests");
  window.history.pushState(null, "", "/map");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("arriving on the map", () => {
  it("stamps its own entry and pushes nothing, so the page before is one Back away", () => {
    const before = window.history.length;
    const m = mount();
    expect(window.history.length, "an arrival from a page adds no entry").toBe(before);
    expect(state()).toMatchObject({ villageMapApp: true, seq: 0 });
    expect(typeof state()?.visit).toBe("string");
    m.hook.unmount();
  });

  it("a return onto a map entry reuses it, so Forward survives (F10)", () => {
    const first = mount();
    const visit = state()?.visit;
    first.hook.unmount(); // a door out to the site unmounts the shell
    const before = window.history.length;
    const again = mount(); // Back onto the same entry mounts it again
    expect(window.history.length, "a second entry would erase Forward").toBe(before);
    expect(state()?.visit, "the same stay").toBe(visit);
    again.hook.unmount();
  });

  it("an entry where Enter was pressed starts the next visit to it entered", () => {
    const m = mount({ entered: false });
    expect(arrivedEntered()).toBe(false);
    act(() => m.api().markEntered());
    expect(arrivedEntered()).toBe(true);
    m.hook.unmount();
    const gate = renderHook(() => useMapEnterGate());
    expect(gate.result.current.entered, "the gate is not shown a second time").toBe(true);
    gate.unmount();
  });

  it("a fresh tab with no page before writes the village home under the map", async () => {
    window.history.replaceState(null, "", "/map#/place/greenhouse");
    const m = asFreshTab(() => mount());
    expect(here(), "the visitor still sees the link they opened").toBe("/map#/place/greenhouse");
    expect(state()).toMatchObject({ villageMapApp: true, seq: 0 });
    window.history.back();
    await settle();
    expect(window.location.pathname, "Back from a shared link lands on the village home").toBe("/");
    expect(state()).toMatchObject({ villageMapHome: true });
    expect(m.navigate).not.toHaveBeenCalled();
    m.hook.unmount();
  });
});

/** Every kind of in-map state, as the artifact's setHash posts it. */
const IN_MAP: [string, string][] = [
  ["a place", "#/place/greenhouse"],
  ["a place and the item tapped", "#/place/greenhouse?item=quest:plant-the-dry-season-beds"],
  ["a door", "#/module/stay"],
  ["the Loom", "#/loom"],
  ["the in-file circles", "#/circles"],
  ["a walk", "#/journey/j2"],
  ["a lens", "#lens=vision"],
  ["a place through two lenses", "#/place/greenhouse&lens=vision,org"],
];

describe("Back leaves the map in one press, from any state (D6)", () => {
  it.each(IN_MAP)("%s: no entry added, Back lands on the page before, Forward and a reload return to it", async (_, hash) => {
    const m = mount();
    const length = window.history.length;
    act(() => m.api().onRoute({ hash, user: true }));
    expect(here(), "the address follows the screen").toBe(`/map${hash}`);
    expect(window.history.length, "in-map state is not a page").toBe(length);

    window.history.back();
    await settle();
    expect(here(), "one press").toBe("/quests");
    expect(m.navigate).not.toHaveBeenCalled();
    m.hook.unmount(); // the router renders /quests

    window.history.forward();
    await settle();
    expect(here(), "Forward returns to the map at the address it left").toBe(`/map${hash}`);
    expect(arrivedEntered(), "and to the land, not the gate").toBe(true);
    const back = mount();
    expect(window.history.length, "a return pushes nothing").toBe(length);

    // F5: the same entry, mounted again from its own URL.
    back.hook.unmount();
    const reloaded = mount();
    expect(here(), "a reload lands on the same state").toBe(`/map${hash}`);
    expect(arrivedEntered()).toBe(true);
    expect(window.history.length).toBe(length);
    reloaded.hook.unmount();
  });

  it("closing what was open moves the address and never steps history", async () => {
    const m = mount();
    const length = window.history.length;
    act(() => m.api().onRoute({ hash: "#/place/greenhouse", user: true }));
    act(() => m.api().onRoute({ hash: "", user: true }));
    await tick();
    expect(here()).toBe("/map");
    expect(window.history.length).toBe(length);
    expect(m.gotos(), "nothing is sent: the map already shows it").toEqual([]);
    window.history.back();
    await settle();
    expect(here()).toBe("/quests");
    m.hook.unmount();
  });

  it("the Leave the map door does what Back does: one press, the page before", async () => {
    const m = mount();
    act(() => m.api().onRoute({ hash: "#/module/stay", user: true }));
    act(() => m.api().exitApp());
    await settle();
    expect(here()).toBe("/quests");
    expect(m.navigate, "no detour through the village door").not.toHaveBeenCalled();
    m.hook.unmount();
    window.history.forward();
    await settle();
    expect(here(), "and Forward comes back to the door that was open").toBe("/map#/module/stay");
  });

  it("Leave the map from a fresh tab lands on the village home", async () => {
    window.history.replaceState(null, "", "/map#/loom");
    const m = asFreshTab(() => mount());
    act(() => m.api().exitApp());
    await settle();
    expect(window.location.pathname).toBe("/");
    expect(state()).toMatchObject({ villageMapHome: true });
    m.hook.unmount();
  });
});

describe("the address bar on the map", () => {
  it("a link pasted into the address bar routes the map, and one Back still leaves it (F31, F56)", async () => {
    const m = mount();
    const visit = state()?.visit;
    window.location.hash = "#/place/kitchen";
    await tick();
    expect(m.navigate, "the visitor is not sent home").not.toHaveBeenCalled();
    expect(here()).toBe("/map#/place/kitchen");
    expect(m.gotos().at(-1)).toBe("#/place/kitchen");
    expect(state(), "the browser's entry joins the same stay").toMatchObject({ villageMapApp: true, visit, seq: 1 });

    window.history.back();
    await settle();
    expect(here(), "the browser made an entry, and Back still leaves in one press").toBe("/quests");
    expect(m.navigate).not.toHaveBeenCalled();
    m.hook.unmount();
  });

  it("re-entering the URL already in the bar keeps the visitor on the map (round 3, modes)", async () => {
    const m = mount();
    act(() => m.api().onRoute({ hash: "#/place/greenhouse", user: true }));
    // A same-URL navigation REPLACES the entry with a stateless one and fires popstate.
    window.history.replaceState(null, "", "/map#/place/greenhouse");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    await tick();
    expect(m.navigate, "it used to read as the base entry and send the visitor home").not.toHaveBeenCalled();
    expect(here()).toBe("/map#/place/greenhouse");
    expect(state()).toMatchObject({ villageMapApp: true });
    window.history.back();
    await settle();
    expect(here()).toBe("/quests");
    m.hook.unmount();
  });

  it("a link pasted at the gate opens the land, and Forward after Back finds the land, not the gate (round 3, modes)", async () => {
    const m = mount({ entered: false });
    window.location.hash = "#/place/kitchen";
    await tick();
    expect(m.enterAt).toHaveBeenCalledWith("#/place/kitchen");
    m.hook.rerender({ entered: true, pocket: false }); // the gate opens the land
    expect(m.navigate).not.toHaveBeenCalled();

    window.history.back();
    await settle();
    expect(here()).toBe("/quests");
    m.hook.unmount();
    window.history.forward();
    await settle();
    expect(here()).toBe("/map");
    expect(arrivedEntered(), "the entry under the pasted link learned the stay was entered").toBe(true);
  });

  it("a same-route navigation by the router routes the map too", () => {
    const m = mount();
    window.history.pushState(null, "", "/map#/loom");
    act(() => {
      window.dispatchEvent(new Event("pushState"));
    });
    expect(m.gotos().at(-1)).toBe("#/loom");
    expect(m.navigate).not.toHaveBeenCalled();
    m.hook.unmount();
  });

  it("writes only the artifact's own addresses into the URL, lenses included", () => {
    expect(isMapRoute("")).toBe(true);
    expect(isMapRoute("#/place/greenhouse?item=quest:plant-the-dry-season-beds")).toBe(true);
    expect(isMapRoute("#lens=vision")).toBe(true);
    expect(isMapRoute("#/place/greenhouse&lens=vision,org,flows")).toBe(true);
    expect(isMapRoute("#/place/greenhouse&skipIntro")).toBe(false);
    expect(isMapRoute("#hud=pocket")).toBe(false);
    expect(isMapRoute("#lens=<b>")).toBe(false);
    expect(isMapRoute("#/place/<img>")).toBe(false);
    expect(isMapRoute("https://elsewhere.test/")).toBe(false);
  });

  it("reads what is open apart from the lens, a layout hint and the enter token", () => {
    expect(addressRoute("#/circles&lens=org")).toBe("#/circles");
    expect(addressRoute("#lens=vision")).toBe("");
    expect(addressRoute("#hud=desk")).toBe("");
    expect(addressRoute("#/place/greenhouse?item=quest:1&lens=vision&skipIntro")).toBe("#/place/greenhouse?item=quest:1");
    expect(addressRoute("")).toBe("");
  });
});

describe("a phone's #/circles link goes to the org chart (D8)", () => {
  it("an arrival at #/circles on a phone replaces the entry with /map/circles", () => {
    window.history.replaceState(null, "", "/map#/circles");
    const length = window.history.length;
    const m = mount({ pocket: true });
    expect(m.navigate).toHaveBeenCalledWith("/map/circles", { replace: true });
    expect(window.history.length, "replaced, so Back does not bounce into it again").toBe(length);
    m.hook.unmount();
  });

  it("a desk keeps the land's own circles", () => {
    window.history.replaceState(null, "", "/map#/circles");
    const m = mount({ pocket: false });
    expect(m.navigate).not.toHaveBeenCalled();
    m.hook.unmount();
  });

  it("a #/circles link pasted on a phone's open map goes there too, lens or not", async () => {
    const m = mount({ pocket: true });
    window.location.hash = "#/circles&lens=org";
    await tick();
    expect(m.navigate).toHaveBeenCalledWith("/map/circles", { replace: true });
    expect(m.gotos(), "the land is not sent to its own circles").toEqual([]);
    m.hook.unmount();
  });

  it("knows a circles address on a phone and nowhere else", () => {
    expect(circlesOnPhone("#/circles", true)).toBe(true);
    expect(circlesOnPhone("#/circles&lens=vision", true)).toBe(true);
    expect(circlesOnPhone("#/circles", false)).toBe(false);
    expect(circlesOnPhone("#/place/greenhouse", true)).toBe(false);
  });
});

describe("an entry the previous model wrote", () => {
  it("Back onto its base entry still leaves, by the village door it always used", async () => {
    window.history.replaceState({ villageMapBase: true }, "", "/map");
    window.history.pushState({ villageMapApp: true, depth: 1, entered: true }, "", "/map");
    const m = mount();
    window.history.back();
    await settle();
    expect(m.navigate).toHaveBeenCalledWith("/", { replace: true });
    expect(window.location.pathname).toBe("/");
    m.hook.unmount();
  });
});
