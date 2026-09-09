// @vitest-environment jsdom
/**
 * The surface-once hook, and the two ways it lied.
 *
 * Both were found by an adversarial pass over code that had already shipped,
 * and both are the same shape: a failure state that reads as a fact.
 *
 *   A FAILED READ became "they have seen nothing", which surfaced every open
 *   section on every blip. The file's own header said the opposite, in the
 *   comment sitting directly above the line that did it.
 *
 *   A MEMBER WHO PREDATES THE MECHANIC has no map at all, which is the same
 *   value as a member who has genuinely seen nothing, so somebody who had
 *   walked a path for six months was told it was "newly open".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useSurfaced } from "./useSurfaced";

const withTokenStore = () => {
  // This jsdom has an accessor for localStorage whose methods do not exist, so
  // `authToken()` throws before any request is made and the hook's own catch
  // swallows it. Same throw happens in a browser with site data blocked.
  vi.stubGlobal("localStorage", { getItem: () => "a-token", setItem: () => {}, removeItem: () => {} });
};

const answer = (body: unknown, ok = true) =>
  vi.stubGlobal("fetch", async () => ({ ok, json: async () => body }) as unknown as Response);

describe("useSurfaced", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("surfaces the first unseen section once the read lands", async () => {
    withTokenStore();
    answer({ sheetSeen: { ventures: 1 } });
    const { result } = renderHook(() => useSurfaced(["ventures", "seats"], true));
    await waitFor(() => expect(result.current.sectionId).toBe("ventures"));
  });

  it("skips a section that has had its three sightings", async () => {
    withTokenStore();
    answer({ sheetSeen: { ventures: 3 } });
    const { result } = renderHook(() => useSurfaced(["ventures", "seats"], true));
    await waitFor(() => expect(result.current.sectionId).toBe("seats"));
  });

  it("SURFACES NOTHING when the read throws", async () => {
    withTokenStore();
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const { result } = renderHook(() => useSurfaced(["ventures"], true));
    // Give the rejection a chance to land and be handled.
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.sectionId).toBeNull();
  });

  it("WRITES NOTHING when the server refuses, and surfaces nothing", async () => {
    /*
     * The assertion that matters here is the WRITE, and the first version of
     * this test missed it.
     *
     * "Surfaces nothing" is true down two different paths: the correct one,
     * where a refusal is a failure and the hook stays quiet; and a wrong one,
     * where a refusal falls through to the predates-the-mechanic backfill,
     * which also surfaces nothing AND writes `acknowledged: true` for every
     * open section. That second path settles sections the member never saw,
     * permanently, on a transient 500. Reverting the fix left the old test
     * green, which is how it was caught.
     */
    withTokenStore();
    const methods: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      methods.push(String(init?.method ?? "GET"));
      return { ok: false, json: async () => ({ error: "nope" }) } as unknown as Response;
    });
    const { result } = renderHook(() => useSurfaced(["ventures", "seats"], true));
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.sectionId).toBeNull();
    expect(methods.filter((m) => m === "PUT")).toEqual([]);
  });

  it("treats a member with no map at all as having already met what is open", async () => {
    // They predate the mechanic. Announcing a path they have walked for months
    // as "newly open" is the one thing the banner may not say.
    withTokenStore();
    answer({ notify: { email: true } });
    const { result } = renderHook(() => useSurfaced(["ventures", "seats"], true));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.sectionId).toBeNull();
  });

  it("still surfaces the FIRST section a brand-new member opens", async () => {
    // The backfill is keyed on what is open at the moment of the read, so a
    // member who walks nothing backfills nothing, and their first claim is
    // still announced. This is what makes the fix above safe.
    withTokenStore();
    answer({});
    const { result, rerender } = renderHook(({ open }) => useSurfaced(open, true), {
      initialProps: { open: [] as string[] },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.sectionId).toBeNull();

    rerender({ open: ["ventures"] });
    await waitFor(() => expect(result.current.sectionId).toBe("ventures"));
  });

  it("says nothing at all until the caller knows what is open", async () => {
    withTokenStore();
    answer({ sheetSeen: {} });
    const { result } = renderHook(() => useSurfaced(["ventures"], false));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.sectionId).toBeNull();
  });
});
