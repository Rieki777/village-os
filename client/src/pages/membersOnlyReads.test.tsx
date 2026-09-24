// @vitest-environment jsdom
/**
 * A page does not ask a members-only route anything while nobody is signed in.
 *
 * THE DEFECT THIS PINS. Four public pages called a route that refuses a
 * stranger, on every signed-out load:
 *
 *   /map       GET /api/me/characters
 *   /messages  GET /api/messages
 *   /review    GET /api/review/queue and GET /api/admin/quest-claims
 *   /training  GET /api/game/training/completed
 *
 * The 401 is correct and every page already rendered it correctly. The harm
 * was the request: a browser logs every failed request in its console by
 * itself, so these pages loaded red for every visitor, and a real error on
 * them had nowhere to stand out. Catching the 401 more politely cannot fix
 * that, so the assertions here read the REQUESTS made, not the page alone.
 *
 * EACH CASE HAS A SIGNED-IN TWIN, and the twin is half the point. A gate that
 * stopped asking for everyone would pass every signed-out assertion in this
 * file and blank four pages for members. The twin proves the same page, with
 * a session, still makes the same call.
 *
 * The session is `authToken()`, the one accessor every credentialed call in
 * the client already reads to attach its Bearer header. No new auth state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

const session = vi.hoisted(() => ({ token: null as string | null, user: null as null | { id: string; name: string; handle: string; paths: string[] } }));
const gameFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: session.user, token: session.token, loading: false }),
}));
// Spread the real module and override only the two seams. `Profile` reads
// `useGameConfig` and friends off it, and a hand-listed mock would have to grow
// a line every time a page under test imports one more thing.
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authToken: () => session.token,
  gameFetch: (...args: unknown[]) => gameFetchMock(...args),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true }),
  useModule: (id: string) => ({ id, lifecycle: "public" }),
}));
vi.mock("@/components/modules/ModuleGate", () => ({
  default: () => <p>module gate</p>,
  SignInToSee: ({ name }: { name: string }) => <p>Sign in to see {name}</p>,
}));
/*
 * PROFILE'S CHILDREN, STUBBED. The page under test here is the page's own
 * two effects, and its children each want a fully shaped payload: three of
 * them read a field off `user` or `config` with no guard, so a fixture that
 * satisfied them would be a second copy of the server's response drifting
 * beside the real one. `useSurfaced` is deliberately NOT stubbed, because
 * one of the two reads under test is its own.
 */
vi.mock("@/components/GameDashboard", () => ({ default: () => null }));
vi.mock("@/components/ProfileJourney", () => ({ default: () => null }));
vi.mock("@/components/NeedCard", () => ({ default: () => null }));
vi.mock("@/components/NotifyPrefsPanel", () => ({ default: () => null }));
vi.mock("@/components/YourAgentPanel", () => ({ default: () => null }));
vi.mock("@/components/ProfileSheet", () => ({ default: () => null }));
vi.mock("@/components/ProfileHero", () => ({ default: () => null }));
vi.mock("@/components/OnchainCard", () => ({ default: () => null }));
vi.mock("@/components/WalletCard", () => ({ default: () => null }));
vi.mock("@/components/SendTokensCard", () => ({ default: () => null }));
vi.mock("@/components/profile/MaturityLadder", () => ({ default: () => null }));
vi.mock("@/components/profile/PowersMap", () => ({ default: () => null }));
vi.mock("@/components/profile/PathsPanel", () => ({ default: () => null }));
vi.mock("@/components/profile/StandingRow", () => ({ default: () => null }));
vi.mock("@/components/profile/InvitePanel", () => ({ default: () => null }));
vi.mock("@/components/profile/PathFacts", () => ({ default: () => null }));
vi.mock("@/components/profile/SurfacedBanner", () => ({ default: () => null }));
vi.mock("@/components/profile/TheVessel", () => ({ default: () => null }));
vi.mock("@/components/profile/MoonDock", () => ({ default: () => null }));
vi.mock("@/components/profile/NightMotes", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import Messages from "./Messages";
import Review from "./Review";
import Training from "./Training";
import LivingMap from "./LivingMap";
import Profile from "./Profile";

/** Every URL the page asked for, through either `fetch` or `gameFetch`. */
let asked: string[] = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The four members-only reads, which refuse a caller with no session. */
const MEMBERS_ONLY = [
  "/api/messages",
  "/api/review/",
  "/api/admin/quest-claims",
  "/api/game/training/completed",
  "/api/me/characters",
  // 2026-09-23. Two survivors of the same class on /profile, found by a live
  // signed-out sweep and only ever on WebKit: chromium reported zero failing
  // requests for the same page in the same state, so a test watching for a
  // 401 would have been green here and wrong. These assert the REQUEST.
  "/api/game/progression",
  "/api/profile/prefs",
];

/**
 * What the server would say, per route. A signed-out caller of a members-only
 * route gets the real 401, so against the old code every page still renders
 * its refused state and the ONLY assertion that fails is the request itself.
 */
function answer(url: string): Response {
  if (!session.token && MEMBERS_ONLY.some((p) => url.startsWith(p))) return json({ error: "auth_required" }, 401);
  if (url.startsWith("/api/messages")) return json({ conversations: [] });
  if (url.startsWith("/api/review/queue")) return json({ batches: [], quests: [], drops: [], counts: { proposals: 0, quests: 0 } });
  if (url.startsWith("/api/review/erasure")) return json({ count: 0, oldestSince: null, waitingOn: {} });
  if (url.startsWith("/api/admin/quest-claims")) return json([]);
  if (url.startsWith("/api/training-modules")) return json([{ id: "m1", title: "Water", mandatory: true }]);
  if (url.startsWith("/api/game/training/completed")) return json({ completed: ["m1"] });
  if (url.startsWith("/grounds/manifest.json")) return json({ present: true, url: "/grounds/grounds-abc.html" });
  if (url.startsWith("/api/me/characters")) return json({ party: [] });
  // Every key the route actually serves, in its order, so a page reading one
  // of them unguarded fails here the way it would in a browser.
  if (url.startsWith("/api/game/progression"))
    return json({ stage: null, stageIndex: 0, consentedQuests: 0, capabilities: [], capabilityCatalogue: [], roles: [], history: [], firsts: {}, signing: null });
  if (url.startsWith("/api/profile/prefs")) return json({ sawSections: {} });
  return json({});
}

function signIn() {
  session.token = "a-token";
  // `paths` because Profile reads `user.paths` unguarded at one of its two
  // uses, while the other reads `user?.paths ?? []`. A signed-in member always
  // has the field, so this is the realistic shape rather than a workaround.
  session.user = { id: "u1", name: "A Member", handle: "a-member", paths: [] };
}
function signOut() {
  session.token = null;
  session.user = null;
}

beforeEach(() => {
  asked = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      asked.push(String(url));
      return answer(String(url));
    }),
  );
  gameFetchMock.mockReset();
  gameFetchMock.mockImplementation(async (url: unknown) => {
    asked.push(String(url));
    return answer(String(url));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  signOut();
});

const inRouter = (node: ReactNode) => render(<Router>{node}</Router>);

describe("/messages", () => {
  it("signed out, shows the sign-in card and never asks for the inbox", async () => {
    signOut();
    inRouter(<Messages />);
    await waitFor(() => expect(screen.getByText("Sign in to see Messages")).toBeTruthy());
    await new Promise((r) => setTimeout(r, 20));
    expect(asked.filter((u) => u.startsWith("/api/messages"))).toEqual([]);
  });

  it("signed in, still reads the inbox", async () => {
    signIn();
    inRouter(<Messages />);
    await waitFor(() => expect(asked).toContain("/api/messages"));
    await waitFor(() => expect(screen.getByText("No conversations yet")).toBeTruthy());
  });
});

describe("/review", () => {
  it("signed out, refuses as a whole without asking either members-only route", async () => {
    signOut();
    inRouter(<Review />);
    await waitFor(() => expect(screen.getByText("This queue is not open to you yet")).toBeTruthy());
    expect(asked.filter((u) => u.startsWith("/api/review/queue"))).toEqual([]);
    expect(asked.filter((u) => u.startsWith("/api/admin/quest-claims"))).toEqual([]);
  });

  it("signed in, still asks both, and renders what they answer", async () => {
    signIn();
    inRouter(<Review />);
    await waitFor(() => expect(screen.getByText("Nothing waiting")).toBeTruthy());
    expect(asked).toContain("/api/review/queue");
    expect(asked).toContain("/api/admin/quest-claims");
  });
});

describe("/training", () => {
  it("signed out, reads the public modules and never asks for a record", async () => {
    signOut();
    inRouter(<Training />);
    await waitFor(() => expect(asked).toContain("/api/training-modules"));
    await waitFor(() => expect(screen.getAllByText(/Water/).length).toBeGreaterThan(0));
    expect(asked.filter((u) => u.startsWith("/api/game/training/completed"))).toEqual([]);
  });

  it("signed in, still reads the member's own record", async () => {
    signIn();
    inRouter(<Training />);
    await waitFor(() => expect(asked).toContain("/api/game/training/completed"));
  });
});

describe("/map", () => {
  /** The artifact's boot handshake, which is what sends the lens reads. */
  async function mapIsReady() {
    await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, data: { type: "grounds-ready" } }));
    // `/api/map` is the lens's other read, made for everyone: seeing it proves
    // the lens ran, so the absence asserted below is not a lens that never started.
    await waitFor(() => expect(asked).toContain("/api/map"));
  }

  it("signed out, draws the lens without asking for a party", async () => {
    signOut();
    inRouter(<LivingMap />);
    await mapIsReady();
    expect(asked.filter((u) => u.startsWith("/api/me/characters"))).toEqual([]);
  });

  it("signed in, still asks for the player's party", async () => {
    signIn();
    inRouter(<LivingMap />);
    await mapIsReady();
    expect(asked).toContain("/api/me/characters");
  });
});


/**
 * THE TWO SURVIVORS, and why they outlived the sweep that found the first four.
 *
 * A signed-out visitor to /profile fired two members-only reads. Neither came
 * from the component a reader would suspect: `ProfileJourney` has asked
 * through a token-checking `authedRead` since it was written, and its guard
 * works. They came from the page's own mount effect and from `useSurfaced`,
 * the hook the page mounts for its surfacing banner, which had no check at all.
 *
 * `/profile` has no route guard and no redirect, so the page mounts for
 * anybody who types the URL. That is the reason it kept working and kept
 * asking: every section renders its signed-out state correctly, and the only
 * wrong thing was the two requests.
 *
 * WHY THE ASSERTIONS READ `asked` RATHER THAN THE STATUS. A live sweep saw
 * these on WebKit and NOT on chromium, on the same page in the same state. A
 * test that waited for a 401 would therefore pass under the engine this suite
 * runs on whether or not the bug is present. The absence of the call is the
 * claim; the response never enters into it.
 */
describe("/profile", () => {
  it("signed out, asks for neither the progression nor the preferences", async () => {
    signOut();
    inRouter(<Profile />);
    await new Promise((r) => setTimeout(r, 20));
    expect(asked.filter((u) => u.startsWith("/api/game/progression"))).toEqual([]);
    expect(asked.filter((u) => u.startsWith("/api/profile/prefs"))).toEqual([]);
  });

  it("signed in, still asks for both", async () => {
    // The half that matters: a guard that stopped asking for everybody would
    // pass the case above and leave a member with no progression and no
    // surfacing.
    signIn();
    inRouter(<Profile />);
    await waitFor(() => expect(asked).toContain("/api/game/progression"));
    await waitFor(() => expect(asked.some((u) => u.startsWith("/api/profile/prefs"))).toBe(true));
  });
});
