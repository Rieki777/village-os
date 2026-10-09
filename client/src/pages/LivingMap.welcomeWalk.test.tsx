// @vitest-environment jsdom
/**
 * THE SHELL'S HALF OF THE VILLAGE'S OWN WELCOME AND WALK (Rye, 2026-10-02).
 *
 * "Onboarding is something that founders should do and really personalize
 * and put their spirit into it." The map offers a walk only once the village
 * has written one, and greets in the village's words once it has written a
 * welcome. That needs three things of the shell, each pinned here:
 *
 *   - its config push always carries the walk and the welcome once the fetch
 *     answered, null included, because null is the village saying "none" and
 *     the map used to read an absent walk as "run the seed";
 *   - the Journey to Launch's link, /map?settings=walk, lands with the
 *     editor open on the walk, and takes the question off the address;
 *   - the editor saves the welcome beside the walk and tells the map behind
 *     it to fetch its config again, so the walk is offered there at once.
 *
 * The artifact's half is shared/mapArtifactWelcomeWalk.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { MAP_SKIN_SAVED_EVENT } from "@shared/mapSkin";

const state = vi.hoisted(() => ({
  admin: false,
  config: null as null | Record<string, unknown>,
  puts: [] as Array<{ url: string; body: unknown }>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, token: null, loading: false }),
  useIsAdmin: () => state.admin,
}));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authToken: () => null,
  gameFetch: (url: string, init?: RequestInit) => Promise.resolve(answer(url, init)),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true }),
  useModule: (id: string) => ({ id, lifecycle: "public" }),
}));
vi.mock("@/components/modules/ModuleGate", () => ({ default: () => <p>module gate</p> }));

import LivingMap from "./LivingMap";
import WalkEditorPanel from "@/components/WalkEditorPanel";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const STEP = { id: "a", structure_key: "gate", title: "Our gate", body: "We hung it together.", gesture: "none" };

function answer(url: string, init?: RequestInit): Response {
  if (url.startsWith("/grounds/manifest.json")) return json({ present: true, url: "/grounds/grounds-abc.html" });
  if (url.startsWith("/api/map/config")) return state.config ? json(state.config) : json({ error: "down" }, 503);
  if (url.startsWith("/api/admin/map/walk-log")) return json({ runs: 0 });
  if (url.startsWith("/api/admin/map/walk")) {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      state.puts.push({ url, body });
      return json({ success: true, walk: body.walk, welcome: body.welcome });
    }
    return json({ walk: { en: [STEP] }, welcome: { en: "Welcome home." } });
  }
  if (url.startsWith("/api/admin/map/structures")) return json({ structures: ["gate"] });
  return json({});
}

beforeEach(() => {
  state.admin = false;
  state.config = { skin: null, walk: null, welcome: null, vocabulary: null, scene: null };
  state.puts = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => answer(String(url), init)));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function arrive(url: string) {
  window.history.pushState(null, "", url);
  return render(<Router><LivingMap /></Router>);
}
const frame = () => document.querySelector("iframe") as HTMLIFrameElement | null;
const fromMap = (data: Record<string, unknown>) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, data }));
  });
const aMoment = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

/** Boot the shell, let the map say it is ready, and return the config it was handed. */
async function configPushed(): Promise<Record<string, unknown>> {
  arrive("/map#/place/gate");
  await waitFor(() => expect(frame()?.contentWindow).toBeTruthy());
  const sent: Array<Record<string, unknown>> = [];
  vi.spyOn(frame()!.contentWindow!, "postMessage").mockImplementation(((m: Record<string, unknown>) => {
    sent.push(m);
  }) as never);
  fromMap({ type: "grounds-ready" });
  await waitFor(() => expect(sent.some((m) => m.type === "config")).toBe(true));
  return sent.find((m) => m.type === "config")!;
}

describe("the config push carries the village's walk and welcome", () => {
  it("hands the map the walk and the welcome the village wrote", async () => {
    state.config = { skin: null, walk: [STEP], welcome: "Welcome home.", vocabulary: null, scene: null };
    const pushed = await configPushed();
    expect(pushed.walk).toEqual([STEP]);
    expect(pushed.welcome).toBe("Welcome home.");
  });

  it("says null for each when the village wrote none, where it used to say nothing and get the seed", async () => {
    const pushed = await configPushed();
    expect(pushed).toHaveProperty("walk", null);
    expect(pushed).toHaveProperty("welcome", null);
  });

  it("says nothing about either after a failed fetch, so the map keeps what it has", async () => {
    state.config = null;
    const pushed = await configPushed();
    expect(pushed).not.toHaveProperty("walk");
    expect(pushed).not.toHaveProperty("welcome");
  });
});

describe("the Journey to Launch's link: /map?settings=walk", () => {
  it("lands a founder with the editor open on the welcome and walk", async () => {
    state.admin = true;
    arrive("/map?settings=walk");
    expect(await screen.findByRole("dialog", { name: "Village settings" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Welcome and walk" })).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText("Welcome") as HTMLTextAreaElement).value).toBe("Welcome home."));
  });

  it("takes the question off the address, so a reload does not open settings again", async () => {
    state.admin = true;
    arrive("/map?settings=walk#/place/gate");
    await screen.findByRole("dialog", { name: "Village settings" });
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/map");
  });

  it("opens nothing on the plain map (the control)", async () => {
    state.admin = true;
    arrive("/map");
    await aMoment();
    expect(screen.queryByRole("dialog", { name: "Village settings" })).toBeNull();
  });

  it("opens nothing for a member, who has no editor to be shown", async () => {
    arrive("/map?settings=walk");
    await aMoment();
    expect(screen.queryByRole("dialog", { name: "Village settings" })).toBeNull();
  });
});

describe("the editor saves the welcome beside the walk", () => {
  it("sends both, and tells the map behind it to fetch its config again", async () => {
    state.admin = true;
    const repushed = vi.fn();
    window.addEventListener(MAP_SKIN_SAVED_EVENT, repushed);
    try {
      render(<WalkEditorPanel />);
      const box = (await screen.findByLabelText("Welcome")) as HTMLTextAreaElement;
      await waitFor(() => expect(box.value).toBe("Welcome home."));
      fireEvent.change(box, { target: { value: "Come in, the kettle is on." } });
      fireEvent.click(screen.getByRole("button", { name: "Save welcome and walk" }));
      await waitFor(() => expect(state.puts).toHaveLength(1));
      expect(state.puts[0].body).toEqual({ walk: { en: [STEP] }, welcome: { en: "Come in, the kettle is on." } });
      await waitFor(() => expect(repushed).toHaveBeenCalledTimes(1));
    } finally {
      window.removeEventListener(MAP_SKIN_SAVED_EVENT, repushed);
    }
  });

  it("says plainly that no walk is offered until one is written", async () => {
    state.admin = true;
    render(<WalkEditorPanel />);
    await screen.findByRole("heading", { name: "Welcome and walk" });
    expect(document.body.textContent).toContain("Until you write a walk, the map offers none.");
    expect(document.body.textContent).not.toMatch(/map's own walk|runs its own walk/);
  });
});
