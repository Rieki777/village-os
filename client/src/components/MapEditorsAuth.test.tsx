// @vitest-environment jsdom
/**
 * The three map editors authenticate from the SESSION and ask for nothing when
 * the viewer may not administer.
 *
 * These three panels are moving out of Admin onto the map page, so that a
 * founder edits the map where they can watch it change. That move is what
 * makes both halves of this file worth pinning:
 *
 *   1. THE CREDENTIAL. They used to take a `password` prop and spell the
 *      Authorization header by hand. That value was never a password, it was
 *      `authToken()` handed down by AdminGate, and a page that is not Admin has
 *      no such prop to pass. They now read the session themselves through
 *      `gameFetch`. If that regressed, every one of them would go silently
 *      anonymous and the server would refuse a founder on their own map.
 *
 *   2. THE SILENCE. A panel that fetches an admin route on mount and hides only
 *      its JSX hands every ordinary member a refusal in the console, on a page
 *      they open daily. So the gate is on the REQUEST, and this file asserts
 *      the count is zero rather than asserting a rendering.
 *
 * A zero-call assertion passes just as happily against a component that throws,
 * renders nothing for everybody, or was deleted. So every silence case here is
 * paired with the same panel doing the opposite under an admin session, and the
 * pair is the test. One without the other proves nothing.
 *
 * `fetch` is stubbed rather than run against a server: what is under test is
 * which calls these components make and what they carry. The routes themselves
 * have server tests.
 *
 * THE SESSION LIVES IN A STUBBED `localStorage`, the way this repo's other
 * component tests do it (GameDashboard.test.tsx, NeedTagPicker.test.tsx), and
 * the reason is worth knowing before anyone simplifies it. Node 25 ships a
 * `localStorage` global of its own which is inert without
 * `--localstorage-file`, and under vitest it wins over jsdom's. Writing to the
 * bare global fails on `setItem is not a function`, and so does writing to
 * `window.localStorage`: this file failed ten for ten on each in turn before
 * taking the house shim. The shim leaves `authToken` and `gameFetch` unmocked,
 * which is the whole point, since the token path is what is under test.
 */
import type { ReactElement } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * The one thing mocked about the app itself. `useIsAdmin` is the mirror of the
 * server's `isAdmin`, and driving it directly is what lets one test say "a
 * member" and the next say "a founder" without standing up a session.
 */
let mayAdminister = false;
/**
 * Null models a SIGNED-OUT viewer, which is a different state from a signed-in
 * member and the one that reaches a public page most often. Both must be
 * silent, and they fail differently, so both are driven here.
 */
let viewer: { id: string; role: string } | null = null;
vi.mock("@/contexts/AuthContext", () => ({
  useIsAdmin: () => mayAdminister,
  useAuth: () => ({ user: viewer }),
}));

import MapSkinPanel from "./MapSkinPanel";
import WalkEditorPanel from "./WalkEditorPanel";
import MapVocabularyPanel from "./admin/MapVocabularyPanel";
// Imported, never retyped: gameApi's own comment says eight hand-written
// copies of this literal is eight chances for a fork's rename to miss one.
import { TOKEN_KEY } from "@/lib/gameApi";

const TOKEN = "session-token-under-test";

/** What each route answers, in the shape the panel destructures. */
const BODIES: Record<string, unknown> = {
  "/api/map/skin": { skin: {} },
  "/api/admin/brand": { brand: { skin: {} } },
  "/api/admin/map/walk": { walk: { en: [] } },
  "/api/admin/map/structures": { structures: [] },
  "/api/admin/map/walk-log": { runs: 0 },
  "/api/map/vocabulary": { vocabulary: { road: [], water: [], zone: [], phases: {}, media: [] } },
};

let calls: Array<{ url: string; headers: Record<string, string> }>;

/** See the header: Node 25's own inert global wins over jsdom's under vitest. */
const store = new Map<string, string>();
const stubStorage = () =>
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  });

beforeEach(() => {
  calls = [];
  store.clear();
  store.set(TOKEN_KEY, TOKEN);
  // Re-applied every test: `unstubAllGlobals` takes it off along with fetch.
  stubStorage();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string> });
    const key = Object.keys(BODIES).find((k) => String(url).startsWith(k));
    return {
      ok: true,
      json: async () => (key ? BODIES[key] : {}),
    } as unknown as Response;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  store.clear();
});

/** Every panel, so a fourth one added here cannot skip either half. */
const PANELS: Array<[string, () => ReactElement]> = [
  ["MapSkinPanel", () => <MapSkinPanel />],
  ["WalkEditorPanel", () => <WalkEditorPanel />],
  ["MapVocabularyPanel", () => <MapVocabularyPanel />],
];

describe("the map editors, mounted where a member can reach them", () => {
  /** A moment to do the wrong thing: the failure guarded against is a fetch
   *  fired from an effect after the first paint, so asserting immediately
   *  would pass before the mistake had a chance to happen. */
  const settle = async () => {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  };

  for (const [name, mount] of PANELS) {
    it(`${name} asks the server for nothing when a signed-in member looks at it`, async () => {
      mayAdminister = false;
      viewer = { id: "u2", role: "member" };
      await act(async () => { render(mount()); });
      await settle();
      expect(calls).toEqual([]);
    });

    it(`${name} asks the server for nothing when NOBODY is signed in`, async () => {
      // The state a public page meets most often, and it fails differently
      // from a signed-in member: hiding the output while still asking is the
      // shape that gets found later on somebody's network tab.
      mayAdminister = false;
      viewer = null;
      store.delete(TOKEN_KEY);
      await act(async () => { render(mount()); });
      await settle();
      expect(calls).toEqual([]);
    });

    it(`${name} DOES call, carrying the session token, for an admin`, async () => {
      mayAdminister = true;
      viewer = { id: "u1", role: "founder" };
      await act(async () => { render(mount()); });
      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      // The control for both tests above. Without it the zero-call assertions
      // would hold just as well against a panel that had stopped working.
      for (const call of calls) {
        expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      }
    });
  }

  it("sends no Authorization header at all when there is no stored session", async () => {
    // The token is read per request, so a tab whose session has gone sends the
    // header ABSENT instead of sending the word undefined as a credential.
    store.delete(TOKEN_KEY);
    mayAdminister = true;
    viewer = { id: "u1", role: "founder" };
    await act(async () => { render(<MapVocabularyPanel />); });
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].headers.Authorization).toBeUndefined();
  });
});
