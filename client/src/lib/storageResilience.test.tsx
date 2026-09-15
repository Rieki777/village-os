// @vitest-environment jsdom
/**
 * The four things this lane has to prove, exercised through real components
 * and the real sign-in path.
 *
 *  1. A page that remembers a preference still renders, and still works, when
 *     the browser REFUSES storage. Made to throw, never made empty: an empty
 *     store was always fine and is not the defect.
 *  2. Nothing changed when storage works normally. This is the regression that
 *     matters, because it touches every page.
 *  3. Signing in refuses with a sentence a member can act on, and nothing in
 *     the app is left believing they are signed in (Rye's ruling, 2026-09-04).
 *  4. Signing in with a working store is unchanged.
 *
 * `vi.stubGlobal` is enough to install a store here: under vitest's jsdom
 * environment `window === globalThis`, checked rather than assumed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { GoLiveCard } from "@/components/modules/GoLiveCard";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { TOKEN_KEY, authToken } from "@/lib/gameApi";
import { SIGN_IN_STORAGE_BLOCKED } from "@/lib/signInStorage";

/** A store that works, and a window that carries it. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
    _map: map,
  };
}

/** Every call throws, which is what a blocked browser does. */
function blockedStorage() {
  const boom = () => {
    throw new Error("Access to storage is not allowed from this context");
  };
  return { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 };
}

function installStorage(local: unknown, session: unknown = local) {
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
}

const previewModule = {
  id: "calendar",
  name: "Calendar",
  core: false,
  lifecycle: "preview",
  dataClass: "village-content",
  setup: "none" as const,
  ready: null,
  maxLifecycle: "public",
  requires: [],
  showingExamples: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("dark");
});

// ── 1 and 2: a remembered preference, blocked and working ───────────────────

describe("a page that remembers a preference", () => {
  it("still renders when the browser refuses storage", () => {
    installStorage(blockedStorage());
    render(
      <ThemeProvider switchable defaultTheme="light">
        <p>the page</p>
      </ThemeProvider>,
    );
    expect(screen.getByText("the page")).toBeInTheDocument();
  });

  it("still honours the stored choice when storage works", () => {
    const store = memoryStorage();
    store.setItem("theme", "dark");
    installStorage(store);
    render(
      <ThemeProvider switchable defaultTheme="light">
        <p>the page</p>
      </ThemeProvider>,
    );
    // Read from storage, applied to the document, written back: the whole
    // round trip a member sees, unchanged by the move to the helper.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(store.getItem("theme")).toBe("dark");
  });

  it("falls back to the default when the store refuses, and never to a crash", () => {
    installStorage(blockedStorage());
    render(
      <ThemeProvider switchable defaultTheme="dark">
        <p>the page</p>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("a control that remembers a dismissal for the tab", () => {
  it("renders and still dismisses when the browser refuses storage", () => {
    installStorage(blockedStorage());
    render(<GoLiveCard module={previewModule} lookup={{}} token="t" />);
    expect(screen.getByText("Calendar is set up. Go live?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Not yet"));
    // The preference did not stick, and the click still did what it says.
    expect(screen.queryByText("Calendar is set up. Go live?")).not.toBeInTheDocument();
  });

  it("still reads and writes the dismissal when storage works", () => {
    const session = memoryStorage();
    installStorage(memoryStorage(), session);
    const { unmount } = render(<GoLiveCard module={previewModule} lookup={{}} token="t" />);
    fireEvent.click(screen.getByText("Not yet"));
    expect(session.getItem("golive.notyet.calendar")).toBe("1");
    unmount();
    // Remembered, which is the behaviour the key exists for.
    render(<GoLiveCard module={previewModule} lookup={{}} token="t" />);
    expect(screen.queryByText("Calendar is set up. Go live?")).not.toBeInTheDocument();
  });
});

// ── 3 and 4: the sign-in path ───────────────────────────────────────────────

function SignInProbe({ onError }: { onError: (message: string) => void }) {
  const { login, user, token } = useAuth();
  return (
    <div>
      <button
        onClick={() => {
          void login("member@example.test", "pw").catch((e: unknown) =>
            onError(e instanceof Error ? e.message : String(e)),
          );
        }}
      >
        sign in
      </button>
      <span data-testid="who">{user ? user.name : "nobody"}</span>
      <span data-testid="tok">{token ?? "none"}</span>
    </div>
  );
}

describe("signing in", () => {
  let fetchCalls: string[];

  beforeEach(() => {
    fetchCalls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetchCalls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: "tok-123", user: { name: "Wren" } }),
        } as unknown as Response;
      }),
    );
  });

  it("refuses with a sentence a member can act on when storage is blocked", async () => {
    installStorage(blockedStorage());
    const errors: string[] = [];
    render(
      <AuthProvider>
        <SignInProbe onError={(m) => errors.push(m)} />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByText("sign in"));
    await waitFor(() => expect(errors).toHaveLength(1));

    expect(errors[0]).toBe(SIGN_IN_STORAGE_BLOCKED);
    // The words themselves have a job: name the cause, name the setting, say
    // what happens if it stays. A rewrite that drops one of those is a
    // different promise to a member and should fail here.
    expect(errors[0]).toContain("blocking site data");
    expect(errors[0]).toContain("browser settings");
    expect(errors[0]).toContain("cannot finish");
    expect(errors[0]).not.toContain("token");
    expect(errors[0]).not.toContain("localStorage");

    // Nothing believes they are signed in.
    expect(screen.getByTestId("who").textContent).toBe("nobody");
    expect(screen.getByTestId("tok").textContent).toBe("none");
    // And no password was ever sent, because the question is asked first.
    expect(fetchCalls).toEqual([]);
  });

  it("is unchanged when storage works", async () => {
    const store = memoryStorage();
    installStorage(store);
    const errors: string[] = [];
    render(
      <AuthProvider>
        <SignInProbe onError={(m) => errors.push(m)} />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByText("sign in"));
    await waitFor(() => expect(screen.getByTestId("who").textContent).toBe("Wren"));

    expect(errors).toEqual([]);
    expect(screen.getByTestId("tok").textContent).toBe("tok-123");
    expect(store.getItem(TOKEN_KEY)).toBe("tok-123");
    expect(fetchCalls).toContain("/api/auth/login");
    // The probe leaves nothing of its own in the store beside the session.
    // Array.from, never a spread: tsconfig.json excludes "**/*.test.ts" and
    // NOT ".test.tsx", so `pnpm check` typechecks this file at its ES5
    // default target and a spread of a Map iterator is TS2802 there.
    expect(Array.from(store._map.keys())).toEqual([TOKEN_KEY]);
  });
});

describe("every request that carries the session", () => {
  it("reads no session instead of throwing when the browser refuses", () => {
    installStorage(blockedStorage());
    // This one accessor sits under every fetch in the client, so a throw here
    // was a white screen on any page that loaded anything.
    expect(() => authToken()).not.toThrow();
    expect(authToken()).toBeNull();
  });

  it("still hands back the stored session when storage works", () => {
    const store = memoryStorage();
    store.setItem(TOKEN_KEY, "tok-abc");
    installStorage(store);
    expect(authToken()).toBe("tok-abc");
  });
});
