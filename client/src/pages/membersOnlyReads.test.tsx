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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

const session = vi.hoisted(() => ({ token: null as string | null, user: null as null | { id: string; name: string; handle: string; paths: string[]; role?: string }, mayConfirm: false }));
const gameFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
/*
 * `useIsAdmin` is mocked BY ITS REAL RULE, never as a constant. `/map` mounts
 * the village settings panel, which asks this module who is looking, and a
 * mock that answered a fixed value would make these tests agree with
 * themselves about a viewer the app would treat differently. The rule is the
 * one in AuthContext: a member whose account role is admin or founder.
 */
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: session.user, token: session.token, loading: false }),
  useIsAdmin: () => session.user?.role === "admin" || session.user?.role === "founder",
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
  // /roles mounts the vendor drawer, which asks this; no vendor is on here.
  useModuleOn: () => false,
}));
// /circles draws a scene per circle and a mini map, each its own subject and
// neither a read this file is about.
vi.mock("@/components/CircleScene", () => ({ default: () => null }));
vi.mock("@/components/CirclesMiniMap", () => ({ default: () => null }));
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
import Roles from "./Roles";
import Circles from "./Circles";
import RedemptionQueue from "@/components/RedemptionQueue";

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
  // Mounted on /profile when the redemption module is on, so it joins this
  // list the moment that page gained a third members-only read.
  // 2026-09-24. The steward queue used to learn whether it was allowed by
  // REQUESTING the admin route and reading the 401, so every member wallet
  // loaded red. It now asks the member route, which answers the hint.
  "/api/redemptions",
  // 2026-10-02. A seat's history and its needs, asked by /roles and /circles
  // whenever a card opened. Names are public by default (R57), so a stranger
  // reads who holds a seat there and was then refused who held it before.
  "/api/org/roles/",
];

/**
 * `/api/org` as each reader gets it. Names are public (the default), so a
 * stranger reads first names and nothing else; a member reads member rows.
 * `orgTier` "public" is a signed-in account below `map.viewPeople`.
 */
let orgTier: "member" | "public" = "member";
function orgFor(signedIn: boolean) {
  const member = signedIn && orgTier === "member";
  return {
    people: { visible: true, membersOnly: false, signedIn },
    village: { decidesBy: "consent" },
    circles: [{ id: "land", name: "Land & Water", purpose: "The ground and its water", decidesBy: null, color: "sage", status: "active" }],
    roles: [
      {
        id: "seed-keeper",
        name: "Seed Keeper",
        circleId: "land",
        aim: "Keep the seed library alive.",
        domain: null,
        accountabilities: [],
        whyItMatters: null,
        seats: 2,
        holderCount: 1,
        state: "partial",
        criticality: "normal",
        recruiting: false,
        isExample: false,
        holders: member
          ? [{ userId: "u-ines", name: "Ines Moraes", kind: "member", focus: null, lapsed: false, isAgent: false, note: null }]
          : [{ name: "Ines" }],
      },
    ],
  };
}

/**
 * What the server would say, per route. A signed-out caller of a members-only
 * route gets the real 401, so against the old code every page still renders
 * its refused state and the ONLY assertion that fails is the request itself.
 */
function answer(url: string): Response {
  if (!session.token && MEMBERS_ONLY.some((p) => url.startsWith(p))) return json({ error: "auth_required" }, 401);
  // The history asks for the member tier itself, so an account below it is refused too.
  if (url.startsWith("/api/org/roles/") && url.endsWith("/history") && orgTier !== "member") return json({ error: "auth_required" }, 401);
  if (url === "/api/org") return json(orgFor(!!session.token));
  if (url.startsWith("/api/org/roles/") && url.endsWith("/history")) return json([]);
  if (url.startsWith("/api/org/roles/") && url.endsWith("/needs")) return json({ needs: [] });
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
  if (url.startsWith("/api/admin/redemptions")) return json({ redemptions: [] });
  // The whole `Payload` shape RedemptionPanel reads, so a field it uses
  // unguarded fails here the way it would in a browser rather than as an
  // unhandled error after the assertions have already passed. Plus
  // `mayConfirm`, which decides whether RedemptionQueue asks the admin
  // route at all, so the two readers of this one route share one answer.
  if (url.startsWith("/api/redemptions"))
    return json({ open: [], history: [], held: {}, holds: false, confirmedBy: "", votePathBuilt: false, perCycle: 0, openedThisCycle: 0, tokens: [], mayConfirm: session.mayConfirm });
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
  session.mayConfirm = false;
  orgTier = "member";
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
  /*
   * Each case arrives the way a link arrives: on a fresh history entry. The
   * map records on its entry that Enter was pressed, so a later visit to the
   * SAME entry (Back, Forward, F5) skips the gate, and without this the second
   * case would find the first one's entry and never see the gate.
   */
  beforeEach(() => {
    window.history.pushState(null, "", "/map");
  });

  /** The artifact's boot handshake, which is what sends the lens reads. */
  async function mapIsReady() {
    // The shell defers the iframe behind Enter the Land (deep links skip it).
    // Click through so the lens mounts the way a visitor would.
    const enter = await screen.findByRole("button", { name: /Enter the Land/i });
    enter.click();
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


/*
 * /roles AND /circles: A SEAT'S HISTORY AND ITS NEEDS.
 *
 * Both pages open a seat's card from `/api/org`, whose names are public by
 * default (R57), and both mounted the seat's history under the card on
 * `people.visible`, which is true for a stranger reading first names. The
 * history route asks for `map.viewPeople`, so every stranger who opened a
 * seat sent a refused request. The stranger still reads the history's offer
 * to sign in, drawn without asking, which is the known positive each case
 * waits on before it reads the requests.
 */
const SIGN_IN_FOR_HISTORY = "Sign in to see who has held this seat before.";
const seatAsks = () => asked.filter((u) => u.startsWith("/api/org/roles/"));

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

async function openRolesRow() {
  inRouter(<Roles />);
  const row = (await screen.findByRole("heading", { level: 3, name: "Seed Keeper" })).closest("button")!;
  fireEvent.click(row);
}

async function openCirclesSeat() {
  inRouter(<Circles />);
  fireEvent.click((await screen.findByRole("heading", { level: 3, name: "Land & Water" })).closest("button")!);
  fireEvent.click(screen.getByRole("button", { name: "Seed Keeper" }));
}

describe("/roles", () => {
  beforeEach(() => vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver));

  it("signed out, offers the history's sign-in line and asks neither the history nor the needs", async () => {
    signOut();
    await openRolesRow();
    expect(await screen.findByText(SIGN_IN_FOR_HISTORY)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(seatAsks()).toEqual([]);
  });

  it("signed in, still asks for both", async () => {
    signIn();
    await openRolesRow();
    await waitFor(() => expect(asked).toContain("/api/org/roles/seed-keeper/history"));
    await waitFor(() => expect(asked).toContain("/api/org/roles/seed-keeper/needs"));
    expect(screen.queryByText(SIGN_IN_FOR_HISTORY)).toBeNull();
  });

  it("signed in below the member tier, asks for no history it would be refused, and still for the needs", async () => {
    signIn();
    orgTier = "public";
    await openRolesRow();
    // The needs route takes any account: asking it is the known positive that the card opened and asked what it may.
    await waitFor(() => expect(asked).toContain("/api/org/roles/seed-keeper/needs"));
    await new Promise((r) => setTimeout(r, 20));
    expect(asked.filter((u) => u.endsWith("/history"))).toEqual([]);
  });
});

describe("/circles", () => {
  beforeEach(() => vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver));

  it("signed out, opens a seat's card with the history's sign-in line and asks nothing members-only", async () => {
    signOut();
    await openCirclesSeat();
    expect(await screen.findByText(SIGN_IN_FOR_HISTORY)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(seatAsks()).toEqual([]);
  });

  it("signed in, still asks for the seat's history", async () => {
    signIn();
    await openCirclesSeat();
    await waitFor(() => expect(asked).toContain("/api/org/roles/seed-keeper/history"));
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
    // THIS ONE DOES NOT CURRENTLY DISCRIMINATE, and saying so is the point.
    // The redemption panel sits in JSX that a signed-out visitor never reaches,
    // because /profile renders a sign-in form for them, so this assertion holds
    // with or without the `user &&` guard on the mount. I checked by removing
    // the guard and watching all ten stay green. It is kept because the day
    // that render path changes, this is the line that notices; it is not
    // evidence that the guard works. The two above it ARE discriminating: each
    // was proved by removing its own guard and watching this case fail.
    expect(asked.filter((u) => u.startsWith("/api/redemptions"))).toEqual([]);
  });

  it("signed in, still asks for both", async () => {
    // The half that matters: a guard that stopped asking for everybody would
    // pass the case above and leave a member with no progression and no
    // surfacing.
    signIn();
    inRouter(<Profile />);
    await waitFor(() => expect(asked).toContain("/api/game/progression"));
    await waitFor(() => expect(asked.some((u) => u.startsWith("/api/profile/prefs"))).toBe(true));
    // The twin that matters most for the redemption panel: it was put on this
    // page because /wallet is behind the exchange module, so a guard that
    // stopped it asking for everybody would take the door away a second time.
    await waitFor(() => expect(asked.some((u) => u.startsWith("/api/redemptions"))).toBe(true));
  });
});

/*
 * THE SAME CLASS ONE STEP IN: signed IN, and refused anyway.
 *
 * Every case above is about a stranger. This one is about a member, which is
 * the larger population: `RedemptionQueue` is mounted for anyone whose village
 * runs the module, and it used to discover whether it was allowed by asking
 * `GET /api/admin/redemptions` and reading the refusal. A member who does not
 * hold `redemption.confirm` is not a failed sign-in, so a 401 on every wallet
 * load was both the wrong status and the noise ruling 28 asked us to stop.
 *
 * THE TWIN MATTERS MORE HERE THAN ANYWHERE. The cheap fix is to mount this
 * only for admins, and that would pass the first case while taking the queue
 * away from every steward who holds the key through a role rather than a badge
 * of office - which is the entire reason the component asks the server at all.
 */
describe("the steward queue, for a member who does not hold the key", () => {
  it("asks the member route and never the admin one", async () => {
    signIn();
    session.mayConfirm = false;
    inRouter(<RedemptionQueue />);
    /*
     * Settle on the component having asked ANYTHING before judging what it
     * asked. Waiting on the member route specifically would make the old code
     * fail here, on "it never asked", rather than below on the assertion that
     * names the defect - a red for the wrong reason reads as a broken test.
     */
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(asked.filter((u) => u.startsWith("/api/admin/redemptions"))).toEqual([]);
    expect(asked.filter((u) => u.startsWith("/api/redemptions"))).not.toEqual([]);
  });

  it("and a holder still asks for the queue", async () => {
    signIn();
    session.mayConfirm = true;
    inRouter(<RedemptionQueue />);
    await waitFor(() => expect(asked).toContain("/api/admin/redemptions"));
  });
});
