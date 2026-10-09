// @vitest-environment jsdom
/**
 * THE LIVING MAP SHELL'S OWN BEHAVIOUR, around a map that never loads.
 *
 * jsdom does not load the artifact into the iframe, so everything here is
 * the shell's half: what it renders before and after the artifact says it
 * has booted, and where it puts the keyboard. The artifact's half of each
 * contract is in shared/mapArtifact*.test.ts, and what only a real browser
 * can see (pixels, a slow network, the real toolbar Back) was measured in
 * Chromium and is described where each case says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Route, Router, Switch } from "wouter";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
/** Who is signed in; a case can sign somebody in or out between renders. */
let signedIn: { id: string; role: string } | null = null;
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: signedIn, token: null, loading: false }),
  useIsAdmin: () => false,
}));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authToken: () => null,
  gameFetch: (url: string) => Promise.resolve(answer(url)),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true }),
  useModule: (id: string) => ({ id, lifecycle: "public" }),
}));
vi.mock("@/components/modules/ModuleGate", () => ({ default: () => <p>module gate</p> }));

import LivingMap from "./LivingMap";
import { MAP_SKIN_SAVED_EVENT } from "@shared/mapSkin";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Whether the village answers the published-land read; a case can say no. */
let configAnswers = true;
/** The crown bar's chips as `GET /api/map/chips` answers them. */
const CHIPS = [{ id: "members", label: "Members", icon: "people", state: "live", value: "41" }];
/**
 * What `/api/map/draft` says, and what `/api/map/config` and `/api/land` say
 * with it. The defaults are the shape every case above was written against:
 * no `liveVersion` (so no slate is decided) and no `sceneVersion`.
 */
let draftAnswer: Response | Record<string, unknown> = {};
let configExtra: Record<string, unknown> = {};
/** What /api/land says; by default a village that has not placed itself. */
let landAnswer: unknown = { imageryUrl: null };
/** Every URL asked, through either fetch or gameFetch, in order. */
let asked: string[] = [];

function answer(url: string): Response {
  asked.push(url);
  if (url.startsWith("/grounds/manifest.json")) return json({ present: true, url: "/grounds/grounds-abc.html" });
  if (url.startsWith("/api/map/config")) {
    return configAnswers ? json({ skin: null, walk: null, vocabulary: null, scene: null, ...configExtra }) : json({ error: "down" }, 503);
  }
  if (url.startsWith("/api/map/draft")) return draftAnswer instanceof Response ? draftAnswer : json(draftAnswer);
  if (url.startsWith("/api/land")) return json(landAnswer);
  if (url.startsWith("/api/map/chips")) return json({ chips: CHIPS, refreshMs: 60_000 });
  if (url.startsWith("/api/map/masterplan")) return json({ masterplan: null });
  return json({});
}

beforeEach(() => {
  signedIn = null;
  configAnswers = true;
  draftAnswer = {};
  configExtra = {};
  landAnswer = { imageryUrl: null };
  asked = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => answer(String(url))));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** Arrive the way a link arrives: on a fresh history entry at `url`. */
function arrive(url: string) {
  window.history.pushState(null, "", url);
  return render(<Router><LivingMap /></Router>);
}

const frame = () => document.querySelector("iframe") as HTMLIFrameElement | null;
/** The iframe's load event, as the browser fires it once the document parses. */
const loaded = () => act(() => {
  frame()!.dispatchEvent(new Event("load"));
});

describe("where the keyboard goes when the land loads (F62)", () => {
  it("a deep link hands it to the land, so Escape and L reach the map", async () => {
    arrive("/map#/place/greenhouse");
    await waitFor(() => expect(frame()).toBeTruthy());
    expect(document.activeElement, "a deep link arrives with focus on the page").toBe(document.body);
    loaded();
    expect(document.activeElement).toBe(frame());
  });

  it("Enter the Land hands it to the land it opened", async () => {
    arrive("/map");
    const enter = await screen.findByRole("button", { name: /Enter the Land/i });
    enter.focus();
    act(() => enter.click());
    await waitFor(() => expect(frame()).toBeTruthy());
    loaded();
    expect(document.activeElement).toBe(frame());
  });

  it("leaves a visitor who tabbed to Leave the map while it loaded where they are", async () => {
    // On the desk profile, where the shell draws the door for the whole visit.
    arrive("/map#/place/greenhouse&hud=desk");
    await waitFor(() => expect(frame()).toBeTruthy());
    const leave = screen.getByRole("button", { name: "Leave the map" });
    leave.focus();
    loaded();
    expect(document.activeElement).toBe(leave);
  });
});

/** A message from the artifact, the way the shell's listener receives one. */
const fromMap = (data: Record<string, unknown>) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, data }));
  });
/** Let the fetches a message started settle, as a browser would between tasks. */
const aMoment = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
/** The words on the cover, found by what they say, so the old pill answers too. */
const cover = () => screen.queryByText(/Preparing the land|Still bringing the land/);
const leave = () => screen.queryByRole("button", { name: "Leave the map" });

describe("the cover over the land while it loads (F66, F47)", () => {
  /*
   * The artifact draws the seed scene it ships with until the village's own
   * arrives, and the shell used to lift its pill the moment it had ASKED for
   * the village's land: in Chromium the seed stood on screen for 0.5 to 2.6 s
   * under a see-through pill, then half its buildings jumped. The cover now
   * holds until the map says `land-ready`, which it posts after applying.
   */
  it("holds until the map says its land is the village's own", async () => {
    arrive("/map#/place/greenhouse");
    await waitFor(() => expect(frame()).toBeTruthy());
    expect(cover()?.textContent ?? "(no cover)").toMatch(/Preparing the land/);
    fromMap({ type: "grounds-ready" });
    await aMoment();
    expect(cover(), "asking for the land is not having it").toBeTruthy();
    fromMap({ type: "land-ready" });
    expect(cover()).toBeNull();
  });

  /*
   * On a phone the artifact carries the door out in its own bottom bar, and
   * the shell's stood down the moment Enter was pressed. At 1.6 Mbit/s that
   * was 29 s of download with no way out, 9 of them on a blank screen.
   */
  it("keeps a phone's way out until the map's own bar is uncovered", async () => {
    arrive("/map#/place/greenhouse&hud=pocket");
    await waitFor(() => expect(frame()).toBeTruthy());
    expect(leave(), "a phone that has pressed Enter still needs a way out").toBeTruthy();
    fromMap({ type: "grounds-ready" });
    await aMoment();
    expect(leave(), "the bar exists, under the cover").toBeTruthy();
    fromMap({ type: "land-ready" });
    expect(leave(), "the map's own bar carries the door now").toBeNull();
  });

  it("sends the map a config even when the village cannot be reached, so its wait ends", async () => {
    configAnswers = false;
    arrive("/map#/place/greenhouse");
    await waitFor(() => expect(frame()).toBeTruthy());
    const post = vi.fn();
    Object.defineProperty(frame()!.contentWindow!, "postMessage", { configurable: true, value: post });
    fromMap({ type: "grounds-ready" });
    await aMoment();
    const types = post.mock.calls.map(([m]) => (m as { type?: string }).type);
    expect(types).toContain("config");
  });

  /*
   * F29, as Rye decided it (2026-10-02): the crown bar's chips are the
   * village's, chosen in Village settings, and an unset one stays an example.
   * The map draws whatever the shell hands it (shared/mapArtifactChips.test.ts),
   * so the shell has to hand it over the moment the map can listen.
   */
  it("hands the map the village's chips the moment it has booted", async () => {
    arrive("/map#/place/greenhouse");
    await waitFor(() => expect(frame()).toBeTruthy());
    const post = vi.fn();
    Object.defineProperty(frame()!.contentWindow!, "postMessage", { configurable: true, value: post });
    fromMap({ type: "grounds-ready" });
    await aMoment();
    const chips = post.mock.calls.map(([m]) => m as { type?: string; chips?: unknown }).filter((m) => m.type === "chips");
    expect(chips).toEqual([{ type: "chips", chips: CHIPS }]);
  });

  /*
   * The treasury (Rye, 2026-10-05: "Treasury balance shown to members only").
   * The server answers the chips per viewer, so a member who signs out with
   * the map open must not leave their bar behind for the next minute.
   */
  it("asks for the chips again the moment the member signs out", async () => {
    signedIn = { id: "u-ada", role: "member" };
    const view = arrive("/map#/place/greenhouse");
    await waitFor(() => expect(frame()).toBeTruthy());
    const post = vi.fn();
    Object.defineProperty(frame()!.contentWindow!, "postMessage", { configurable: true, value: post });
    fromMap({ type: "grounds-ready" });
    await aMoment();
    const pushes = () => post.mock.calls.filter(([m]) => (m as { type?: string }).type === "chips").length;
    expect(pushes(), "the boot push").toBe(1);
    signedIn = null;
    view.rerender(<Router><LivingMap /></Router>);
    await aMoment();
    expect(pushes(), "asked again for the signed-out viewer").toBe(2);
  });
});

describe("a slow download (F47)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /*
   * Twenty seconds used to take the cover away whatever the map was doing,
   * and on a slow phone the land was still downloading: the visitor got a
   * blank screen. The words change instead, and only a frame that has LOADED
   * and still not answered is uncovered, after a grace period.
   */
  it("changes the words at twenty seconds and keeps the cover until the frame has loaded", async () => {
    vi.useFakeTimers();
    arrive("/map#/place/greenhouse&hud=pocket");
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(frame()).toBeTruthy();
    expect(cover()?.textContent ?? "(no cover)").toMatch(/Preparing the land/);
    await act(() => vi.advanceTimersByTimeAsync(20_500));
    expect(cover()?.textContent ?? "(no cover)", "the map is still downloading").toMatch(/Still bringing the land/);
    expect(leave()).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(cover(), "no clock uncovers a land that has not arrived").toBeTruthy();
    act(() => {
      frame()!.dispatchEvent(new Event("load"));
    });
    await act(() => vi.advanceTimersByTimeAsync(10_500));
    expect(cover(), "a loaded land that never answered is shown as it is").toBeNull();
    expect(leave(), "and a land that never booted keeps the shell's door").toBeTruthy();
  });

  /*
   * The map's desk arrival waits for its land. When the grace lifts the cover
   * first, the shell tells the map the land is uncovered so the arrival runs
   * where it can be seen. It sends exactly that and not a bare config: a
   * config would count as the land arriving and spend the re-route a deep
   * link needs when the real land comes (shared/mapArtifactPlaces.test.ts).
   * Measured in Chromium with the config held 20 s: before, the arrival flew
   * at s21 over a panel the visitor had opened at s14.
   */
  it("tells the map its land is uncovered when the grace, and not the map, lifts the cover", async () => {
    arrive("/map#hud=desk");
    const enter = await screen.findByRole("button", { name: /Enter the Land/i });
    act(() => enter.click());
    await waitFor(() => expect(frame()).toBeTruthy());
    // The clock is taken over before the frame loads, which is when the grace starts.
    vi.useFakeTimers();
    const post = vi.fn();
    Object.defineProperty(frame()!.contentWindow!, "postMessage", { configurable: true, value: post });
    act(() => {
      frame()!.dispatchEvent(new Event("load"));
    });
    const sent = () => post.mock.calls.map(([m]) => (m as { type?: string }).type);
    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(cover(), "still within the grace").toBeTruthy();
    expect(sent()).not.toContain("uncovered");
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(cover()).toBeNull();
    expect(sent()).toEqual(["uncovered"]);
  });

  it("sends nothing of the kind when the map's own land-ready lifts the cover", async () => {
    vi.useFakeTimers();
    arrive("/map#/place/greenhouse&hud=desk");
    await act(() => vi.advanceTimersByTimeAsync(50));
    const post = vi.fn();
    Object.defineProperty(frame()!.contentWindow!, "postMessage", { configurable: true, value: post });
    act(() => {
      frame()!.dispatchEvent(new Event("load"));
    });
    fromMap({ type: "land-ready" });
    expect(cover()).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(post.mock.calls.map(([m]) => (m as { type?: string }).type)).not.toContain("uncovered");
  });
});

describe("leaving the map lands on the page before it (D6, D8)", () => {
  /*
   * The whole shell under the router, with the page the visitor came from in
   * front of it. Before this model, the Leave the map door from an open door
   * went to `/` (the arrival entry rewritten as the village door), and from
   * there Back was the only way to the page the visitor had been on.
   */
  function arriveFrom(before: string, url: string) {
    window.history.pushState(null, "", before);
    window.history.pushState(null, "", url);
    return render(
      <Router>
        <Switch>
          <Route path="/quests"><p>the quests page</p></Route>
          <Route path="/map/circles"><p>the org chart</p></Route>
          <Route path="/map"><LivingMap /></Route>
        </Switch>
      </Router>,
    );
  }

  it("the Leave the map door goes back to the page before, and the address followed the map without adding entries", async () => {
    arriveFrom("/quests", "/map#/place/greenhouse");
    await waitFor(() => expect(frame()).toBeTruthy());
    const length = window.history.length;
    fromMap({ type: "route", hash: "#/module/stay", user: true });
    expect(window.location.pathname + window.location.hash).toBe("/map#/module/stay");
    expect(window.history.length, "a door is not a page").toBe(length);
    act(() => {
      leave()!.click();
    });
    await waitFor(() => expect(screen.queryByText("the quests page")).toBeTruthy());
    expect(window.location.pathname).toBe("/quests");
  });

  it("a phone's #/circles link opens the org chart in place of the map, so Back does not bounce", async () => {
    arriveFrom("/quests", "/map#/circles&hud=pocket");
    const length = window.history.length;
    await waitFor(() => expect(screen.queryByText("the org chart")).toBeTruthy());
    expect(window.location.pathname).toBe("/map/circles");
    expect(window.history.length, "replaced, never pushed").toBe(length);
    act(() => {
      window.history.back();
    });
    await waitFor(() => expect(screen.queryByText("the quests page")).toBeTruthy());
  });
});

/*
 * N19, the shell's half. The map lifts the cover with land-ready once it has
 * applied the config, and the village's own ground came in a separate message
 * nothing waited for, so the cover lifted over the seed's geography while the
 * village's picture was still decoding. The ground rides in the config now, so
 * the map knows there is one and holds the cover until it has drawn
 * (shared/mapArtifactEntry.test.ts plays the map's half).
 */
describe("the village's own ground travels in the config (N19)", () => {
  const sent = async () => {
    await waitFor(() => expect(frame()).toBeTruthy());
    const post = vi.fn();
    Object.defineProperty(frame()!.contentWindow!, "postMessage", { configurable: true, value: post });
    fromMap({ type: "grounds-ready" });
    await aMoment();
    return post.mock.calls.map(([m]) => m as Record<string, unknown>);
  };

  it("carries the picture and its frame in the config, and sends it ahead too so it downloads early", async () => {
    landAnswer = { imageryUrl: "/uploads/land/core.png", spanM: 1600, seedFrame: false, centre: null };
    arrive("/map#/place/greenhouse");
    const msgs = await sent();
    const GROUND = { core: { url: "/uploads/land/core.png" }, frame: { spanM: 1600, seed: false, centre: null } };
    expect(msgs.find((m) => m.type === "config")?.ground, "the ground the cover waits on").toEqual(GROUND);
    const ahead = msgs.findIndex((m) => m.type === "ground");
    expect(msgs[ahead], "sent on its own as well").toEqual({ type: "ground", ...GROUND });
    expect(ahead, "and ahead of the config").toBeLessThan(msgs.findIndex((m) => m.type === "config"));
  });

  it("carries none for a village that keeps the seed", async () => {
    arrive("/map#/place/greenhouse");
    const msgs = await sent();
    expect(msgs.find((m) => m.type === "config")).toBeTruthy();
    expect(msgs.find((m) => m.type === "config")).not.toHaveProperty("ground");
  });

  it("still sends the config, with no ground, when the land read fails", async () => {
    landAnswer = undefined; // an empty body, which will not parse
    arrive("/map#/place/greenhouse");
    const msgs = await sent();
    expect(msgs.filter((m) => m.type === "config").length).toBe(1);
    expect(msgs.find((m) => m.type === "config")).not.toHaveProperty("ground");
  });
});

/**
 * THE BLANK SLATE. A village that has published nothing used to open onto the
 * artifact's own seed: another village's buildings, roads and ground as its
 * own. `liveVersion: 0` from /api/map/draft now decides what the shell shows
 * instead, before the map is ever fetched.
 */
describe("a village with nothing published", () => {
  const blank = (over: Record<string, unknown> = {}) => ({
    canEdit: false, canPublish: false, live: null, liveVersion: 0, draft: null, ...over,
  });
  const configs = (post: ReturnType<typeof vi.fn>) =>
    post.mock.calls.map(([m]) => m as Record<string, any>).filter((m) => m.type === "config");

  it("shows a visitor an honest empty state, and never mounts the map", async () => {
    draftAnswer = blank();
    arrive("/map");
    expect(await screen.findByRole("heading", { name: /has not drawn its map yet/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "See the circles and roles" }).getAttribute("href")).toBe("/map/circles");
    expect(screen.getByRole("button", { name: "Leave the map" })).toBeTruthy();
    await aMoment();
    expect(frame(), "no map behind the empty state").toBeNull();
    expect(screen.queryByRole("button", { name: /Enter the Land/i })).toBeNull();
    expect(asked.filter((u) => u.startsWith("/api/map/masterplan")), "a visitor is not asked about the plan").toEqual([]);
  });

  it("does the same for a deep link, which used to open straight onto the seed", async () => {
    draftAnswer = blank();
    arrive("/map#/place/greenhouse");
    expect(await screen.findByRole("heading", { name: /has not drawn its map yet/ })).toBeTruthy();
    await aMoment();
    expect(frame()).toBeNull();
  });

  it("shows someone who may draft the land how to make it, the masterplan first", async () => {
    draftAnswer = blank({ canEdit: true, canPublish: true });
    arrive("/map");
    expect(await screen.findByRole("heading", { name: "Make your map" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "1. Upload your masterplan" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set up your agent" }).getAttribute("href")).toBe("/profile#your-agent");
    await waitFor(() => expect(asked).toContain("/api/map/masterplan"));
    expect(screen.getByRole("button", { name: "Open the map to draw it" })).toBeTruthy();
    expect(frame()).toBeNull();
  });

  it("counts the draft an agent left, and offers it for review", async () => {
    const scene = {
      map_scene: { version: "v0.8-masterplan" },
      map_structures: [{ key: "a" }, { key: "b" }],
      map_zones: [{ id: "f1" }],
      map_flows: [{ to_key: "a" }],
      map_edits: [{ seq: 1 }, { seq: 2 }],
    };
    draftAnswer = blank({ canEdit: true, canPublish: false, draft: { scene: JSON.stringify(scene), baseVersion: 0, updatedAt: "" } });
    arrive("/map");
    expect(await screen.findByText("A draft is waiting for you: 2 buildings, 1 feature and 1 flow, in 2 changes.")).toBeTruthy();
    expect(screen.getByText(/Publishing it takes someone who may publish the map/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review the draft on the map" })).toBeTruthy();
  });

  it("opens the map from there on the blank land with no seed ground, and sends the blank once per frame", async () => {
    draftAnswer = blank({ canEdit: true, canPublish: true });
    configExtra = { sceneVersion: 0 };
    landAnswer = { configured: false, seedFrame: false, imageryUrl: null };
    arrive("/map");
    const open = await screen.findByRole("button", { name: "Open the map to draw it" });
    act(() => open.click());
    await waitFor(() => expect(frame()).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Enter the Land/i }), "the founder already chose to open it").toBeNull();
    const post = vi.fn();
    Object.defineProperty(frame()!.contentWindow!, "postMessage", { configurable: true, value: post });
    fromMap({ type: "grounds-ready" });
    await aMoment();
    expect(configs(post)).toHaveLength(1);
    const first = configs(post)[0];
    expect(first.seedGround).toBe(false);
    expect(first.sceneVersion).toBe(0);
    expect(first.scene.map_structures).toEqual([]);
    expect(first.scene.map_zones).toEqual([]);
    expect(asked.filter((u) => u === "/api/land"), "one land read serves the ground and the config").toHaveLength(1);
    // A skin saved while the board is open pushes again, and must not repaint the board.
    act(() => {
      window.dispatchEvent(new Event(MAP_SKIN_SAVED_EVENT));
    });
    await aMoment();
    expect(configs(post)).toHaveLength(2);
    expect(configs(post)[1].scene, "the blank goes once per frame").toBeUndefined();
    expect(configs(post)[1].seedGround, "the verdict rides the boot push only").toBeUndefined();
  });
});

describe("a village that has published", () => {
  it("is drawn exactly as before: the gate, then its own land, with the seed verdict on the push", async () => {
    draftAnswer = { canEdit: false, canPublish: false, live: { version: 6 }, liveVersion: 6, draft: null };
    configExtra = { scene: JSON.stringify({ map_scene: { version: "v0.8-publish" }, map_structures: [{ key: "k" }] }), sceneVersion: 6 };
    landAnswer = { configured: true, seedFrame: true, imageryUrl: null };
    arrive("/map");
    const enter = await screen.findByRole("button", { name: /Enter the Land/i });
    act(() => enter.click());
    await waitFor(() => expect(frame()).toBeTruthy());
    expect(screen.queryByRole("heading", { name: /Make your map|has not drawn/ })).toBeNull();
    const post = vi.fn();
    Object.defineProperty(frame()!.contentWindow!, "postMessage", { configurable: true, value: post });
    fromMap({ type: "grounds-ready" });
    await aMoment();
    const config = post.mock.calls.map(([m]) => m as Record<string, any>).find((m) => m.type === "config")!;
    expect(config.sceneVersion).toBe(6);
    expect(config.scene.map_structures).toEqual([{ key: "k" }]);
    expect(config.seedGround).toBe(true);
  });

  it("is drawn as before when the slate cannot be read, which decides nothing", async () => {
    draftAnswer = json({ error: "down" }, 503);
    arrive("/map");
    expect(await screen.findByRole("button", { name: /Enter the Land/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Make your map|has not drawn/ })).toBeNull();
  });
});
