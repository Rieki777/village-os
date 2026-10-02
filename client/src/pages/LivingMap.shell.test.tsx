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

function answer(url: string): Response {
  if (url.startsWith("/grounds/manifest.json")) return json({ present: true, url: "/grounds/grounds-abc.html" });
  if (url.startsWith("/api/map/config")) return json({ skin: null, walk: null, vocabulary: null, scene: null });
  return json({});
}

beforeEach(() => {
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
