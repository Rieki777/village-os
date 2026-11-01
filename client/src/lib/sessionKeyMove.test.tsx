// @vitest-environment jsdom
/**
 * THE SESSION KEY NAMES NO VILLAGE, AND RENAMING IT SIGNS NOBODY OUT (R066).
 *
 * The localStorage key was "amora-auth-token" in every village's browser. It is
 * "village-auth-token" now, and every member signed in before the rename holds
 * their session under the old one. So the rename is only safe if:
 *
 *   1. a session under the old key is still a session, read once and moved;
 *   2. the move leaves exactly one copy, under the new key;
 *   3. signing out drops BOTH, or the next read would move the old one back
 *      and quietly undo the sign-out;
 *   4. a store that refuses the move keeps the member signed in on the old key;
 *   5. the provider every page mounts under signs the member in from the old
 *      key, with the token it held, and never calls it a dead session.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LEGACY_TOKEN_KEY, TOKEN_KEY, authToken, clearAuthToken } from "@/lib/gameApi";

function memoryStorage({ refuseWrites = false } = {}) {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (refuseWrites) throw new DOMException("QuotaExceededError", "QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
    _map: map,
  };
}

function install(store: ReturnType<typeof memoryStorage>) {
  vi.stubGlobal("localStorage", store);
  vi.stubGlobal("sessionStorage", memoryStorage());
}

afterEach(() => vi.unstubAllGlobals());

describe("the session key", () => {
  it("names no village", () => {
    expect(TOKEN_KEY).toBe("village-auth-token");
    expect(TOKEN_KEY).not.toMatch(/amora/i); // brand-ok: the assertion that the key names no village
    expect(LEGACY_TOKEN_KEY).not.toBe(TOKEN_KEY);
  });
});

describe("a session held under the old key", () => {
  it("is still a session, and is moved to the new key on the first read", () => {
    const store = memoryStorage();
    store.setItem(LEGACY_TOKEN_KEY, "tok-old");
    install(store);
    expect(authToken()).toBe("tok-old");
    expect(store.getItem(TOKEN_KEY)).toBe("tok-old");
    expect(store.getItem(LEGACY_TOKEN_KEY)).toBeNull();
    // And a second read is plain: one copy, under the new key.
    expect(authToken()).toBe("tok-old");
    expect(Array.from(store._map.keys())).toEqual([TOKEN_KEY]);
  });

  it("loses to a session under the new key, which is the newer sign-in", () => {
    const store = memoryStorage();
    store.setItem(LEGACY_TOKEN_KEY, "tok-old");
    store.setItem(TOKEN_KEY, "tok-new");
    install(store);
    expect(authToken()).toBe("tok-new");
  });

  it("is dropped with the new one on sign-out, so the sign-out cannot be undone by a move", () => {
    const store = memoryStorage();
    store.setItem(LEGACY_TOKEN_KEY, "tok-old");
    store.setItem(TOKEN_KEY, "tok-new");
    install(store);
    clearAuthToken();
    expect(authToken()).toBeNull();
    expect(store._map.size).toBe(0);
  });

  it("keeps the member signed in when the store refuses the move, and still signs out whole", () => {
    const store = memoryStorage({ refuseWrites: true });
    store._map.set(LEGACY_TOKEN_KEY, "tok-old");
    install(store);
    expect(authToken()).toBe("tok-old");
    // The refused write left the old key where it was: the session survives.
    expect(store.getItem(LEGACY_TOKEN_KEY)).toBe("tok-old");
    clearAuthToken();
    expect(authToken()).toBeNull();
  });
});

function Who() {
  const { user, token, logout } = useAuth();
  return (
    <div>
      <p data-testid="who">{user?.name ?? "nobody"}</p>
      <p data-testid="tok">{token ?? "none"}</p>
      <button onClick={() => void logout()}>sign out</button>
    </div>
  );
}

describe("the provider every page mounts under", () => {
  it("signs a member in from the old key with the token it held, and signs them out of both", async () => {
    const store = memoryStorage();
    store.setItem(LEGACY_TOKEN_KEY, "tok-old");
    install(store);
    const seen: Array<{ url: string; auth: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
      seen.push({ url: String(url), auth });
      if (String(url) === "/api/profile") {
        return { ok: true, status: 200, json: async () => ({ id: "u-1", name: "Wren" }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }));

    render(<AuthProvider><Who /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("who").textContent).toBe("Wren"));
    expect(screen.getByTestId("tok").textContent).toBe("tok-old");
    expect(seen.find((c) => c.url === "/api/profile")?.auth).toBe("Bearer tok-old");
    expect(store.getItem(TOKEN_KEY)).toBe("tok-old");
    expect(store.getItem(LEGACY_TOKEN_KEY)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText("sign out"));
    });
    await waitFor(() => expect(screen.getByTestId("who").textContent).toBe("nobody"));
    expect(store._map.size).toBe(0);
    expect(authToken()).toBeNull();
  });
});
