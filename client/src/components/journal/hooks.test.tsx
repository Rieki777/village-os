// @vitest-environment jsdom
/**
 * Signing out takes the open page with it, and leaves saved pages with their
 * owner where nobody else sees them.
 *
 * The draft of an open sitting is plain words on the device. On a shared or
 * borrowed browser it must not outlive its member's session: it goes when
 * this tab signs out, and when another tab signs a different member in. A
 * token that is only removed or refreshed for the same member (a 401 in
 * another tab, signing in again) keeps it, since the words are still theirs.
 * Pages already in the outbox stay keyed to the member who wrote them, for
 * their next session, and the next member's journal never lists them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { JournalEntryInput } from "@shared/journal";
import { TOKEN_KEY } from "@/lib/gameApi";
import { enqueue, pendingFor } from "@/lib/journalOutbox";
import { usePendingEntries, useSignOutForgetsDraft } from "./hooks";
import { newSitting, readDraft, writeDraft } from "./sitting";

const A = "usr-wren";
const B = "usr-fen";

/** A token whose payload names its member, the shape the server signs. */
function tokenFor(userId: string, stamp = 1): string {
  const claims = JSON.stringify({ userId, email: `${userId}@example.test`, timestamp: stamp, v: 0 });
  return `${btoa(claims).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.sig`;
}
const TOKEN_A = tokenFor(A);
const TOKEN_B = tokenFor(B);

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}
let store: ReturnType<typeof memoryStorage>;

const entry = (clientId: string): JournalEntryInput => ({
  clientId,
  practice: "evening",
  depth: "light",
  answers: [{ questionKey: "q", prompt: "What happened?", text: "A private evening." }],
  writtenAt: "2026-10-02T20:00:00.000Z",
  localHour: 20,
});

beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal("localStorage", store);
  store.setItem(TOKEN_KEY, TOKEN_A);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSignOutForgetsDraft", () => {
  it("drops the draft of the member who signed out in this tab, and nobody else's", () => {
    writeDraft(A, newSitting("evening", "light", "s-a"));
    writeDraft(B, newSitting("morning", "light", "s-b"));
    const { rerender } = renderHook(({ owner }) => useSignOutForgetsDraft(owner), {
      initialProps: { owner: A as string | null },
    });
    expect(readDraft(A)?.clientId).toBe("s-a");

    // logout(): the token goes, then the signed-in member becomes nobody.
    store.removeItem(TOKEN_KEY);
    rerender({ owner: null });

    expect(readDraft(A)).toBeNull();
    expect(readDraft(B)?.clientId).toBe("s-b");
  });

  it("keeps the draft while the same member stays signed in", () => {
    writeDraft(A, newSitting("evening", "light", "s-a"));
    const { rerender, result } = renderHook(({ owner }) => useSignOutForgetsDraft(owner), {
      initialProps: { owner: A as string | null },
    });
    rerender({ owner: A });
    expect(readDraft(A)?.clientId).toBe("s-a");
    expect(result.current).toBe(false);
  });

  it("keeps the draft when another tab only removes the token", () => {
    writeDraft(A, newSitting("evening", "light", "s-a"));
    const { result } = renderHook(() => useSignOutForgetsDraft(A));

    // A 401 in another tab removes the token; the words are still A's.
    store.removeItem(TOKEN_KEY);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: TOKEN_KEY, oldValue: TOKEN_A, newValue: null }));
    });

    expect(result.current).toBe(false);
    expect(readDraft(A)?.clientId).toBe("s-a");
  });

  it("keeps the draft when another tab signs the same member in again", () => {
    writeDraft(A, newSitting("evening", "light", "s-a"));
    const { result } = renderHook(() => useSignOutForgetsDraft(A));

    const again = tokenFor(A, 2);
    store.setItem(TOKEN_KEY, again);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: TOKEN_KEY, oldValue: TOKEN_A, newValue: again }));
    });

    expect(result.current).toBe(false);
    expect(readDraft(A)?.clientId).toBe("s-a");
  });

  it("drops the draft when another tab signs somebody else in", () => {
    writeDraft(A, newSitting("evening", "light", "s-a"));
    const { result } = renderHook(() => useSignOutForgetsDraft(A));

    store.setItem(TOKEN_KEY, TOKEN_B);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: TOKEN_KEY, oldValue: TOKEN_A, newValue: TOKEN_B }));
    });

    expect(result.current).toBe(true);
    expect(readDraft(A)).toBeNull();
  });

  it("ignores a change to any other key", () => {
    writeDraft(A, newSitting("evening", "light", "s-a"));
    const { result } = renderHook(() => useSignOutForgetsDraft(A));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "village.journal.depth", newValue: "deep" }));
    });
    expect(result.current).toBe(false);
    expect(readDraft(A)?.clientId).toBe("s-a");
  });
});

describe("pages left by a member who signed out", () => {
  it("stay on the device keyed to that member, and are never listed for the next one", () => {
    enqueue(A, entry("a-1"));
    const { rerender } = renderHook(({ owner }) => useSignOutForgetsDraft(owner), {
      initialProps: { owner: A as string | null },
    });
    store.removeItem(TOKEN_KEY);
    rerender({ owner: null });

    // A's page survives the sign-out, still A's.
    expect(pendingFor(A).map((i) => i.entry.clientId)).toEqual(["a-1"]);

    // B signs in on the same browser and sees only B's own.
    store.setItem(TOKEN_KEY, TOKEN_B);
    enqueue(B, entry("b-1"));
    const { result } = renderHook(() => usePendingEntries(B));
    expect(result.current.map((i) => i.entry.clientId)).toEqual(["b-1"]);
    expect(result.current.every((i) => i.owner === B)).toBe(true);
  });
});
