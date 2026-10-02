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
import { Router } from "wouter";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, token: null, loading: false }),
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Whether the village answers the published-land read; a case can say no. */
let configAnswers = true;

function answer(url: string): Response {
  if (url.startsWith("/grounds/manifest.json")) return json({ present: true, url: "/grounds/grounds-abc.html" });
  if (url.startsWith("/api/map/config")) {
    return configAnswers ? json({ skin: null, walk: null, vocabulary: null, scene: null }) : json({ error: "down" }, 503);
  }
  return json({});
}

beforeEach(() => {
  configAnswers = true;
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
});
