// @vitest-environment jsdom
/**
 * The room's poll and its doors, against a stubbed fetch.
 *
 * The poll sends the ETag it last saw and keeps the room on a 304; it asks
 * nothing while the tab is hidden and once when it is shown; a refusal stops
 * it. Every write reads its answer, says the server's own sentence when it is
 * refused, and asks for the room again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ROOM_COPY } from "@shared/sessions";
import { json, makeView, record, type Call } from "./__tests__/roomFixture";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() } }));

import { refusalSentence, useSessionRoom } from "./useSessionRoom";

const POLL = 1000;
const HERE = 5000;
let calls: Call[];
let answer: (c: Call) => Response;
let visibility: "visible" | "hidden";

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  visibility = "visible";
  toastError.mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => answer(record(calls, url, init))),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const gets = () => calls.filter((c) => c.method === "GET" && c.url === "/api/sessions/7");

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("the room's poll", () => {
  it("sends the ETag it last saw, and a 304 keeps the room on screen", async () => {
    answer = (c) => {
      if (c.method === "POST") return json({ ok: true });
      return c.headers["If-None-Match"] ? json(null, 304) : json(makeView(), 200, { ETag: '"s7-3"' });
    };
    const { result } = renderHook(() => useSessionRoom(7, { pollMs: POLL, hereMs: HERE }));
    await settle();
    expect(result.current.status).toBe("ready");
    expect(result.current.view?.title).toBe("Water circle");

    await settle(POLL);
    expect(gets().length).toBe(2);
    expect(gets()[1]!.headers["If-None-Match"]).toBe('"s7-3"');
    expect(result.current.view?.title).toBe("Water circle");
  });

  it("asks nothing while the tab is hidden, and once as soon as it is shown", async () => {
    answer = (c) => (c.method === "POST" ? json({ ok: true }) : json(makeView(), 200, { ETag: '"s7-3"' }));
    renderHook(() => useSessionRoom(7, { pollMs: POLL, hereMs: HERE }));
    await settle();
    expect(gets().length).toBe(1);

    visibility = "hidden";
    await settle(POLL * 4);
    expect(gets().length).toBe(1);

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(gets().length).toBe(2);
  });

  it("stops on a refusal and says which one it was", async () => {
    answer = () => json({ error: "forbidden" }, 403);
    const { result } = renderHook(() => useSessionRoom(7, { pollMs: POLL, hereMs: HERE }));
    await settle();
    expect(result.current.status).toBe("refused");
    await settle(POLL * 5);
    expect(gets().length).toBe(1);
  });

  it("a missing room reads as missing, and a signed-out page as signed out", async () => {
    answer = () => json({ error: "not_found" }, 404);
    const missing = renderHook(() => useSessionRoom(7, { pollMs: POLL }));
    await settle();
    expect(missing.result.current.status).toBe("missing");
    missing.unmount();

    answer = () => json({ error: "auth_required" }, 401);
    const out = renderHook(() => useSessionRoom(7, { pollMs: POLL }));
    await settle();
    expect(out.result.current.status).toBe("signed-out");
  });

  it("every ask goes past the browser's cache, so the room's clock is read fresh", async () => {
    answer = (c) => {
      if (c.method === "POST") return json({ ok: true });
      return c.headers["If-None-Match"] ? json(null, 304) : json(makeView(), 200, { ETag: '"s7-3"' });
    };
    const { result } = renderHook(() => useSessionRoom(7, { pollMs: POLL, hereMs: HERE }));
    await settle();
    await settle(POLL);
    await act(async () => {
      await result.current.refresh();
    });
    // The first ask, a poll with its ETag, and a forced ask: none may be answered from the HTTP cache.
    expect(gets()).toHaveLength(3);
    expect(gets().map((c) => c.cache)).toEqual(["no-store", "no-store", "no-store"]);
    expect(gets()[1]!.headers["If-None-Match"]).toBe('"s7-3"');
    expect(gets()[2]!.headers["If-None-Match"]).toBeUndefined();
  });

  it("keeps the room's clock, so every screen reads the same second", async () => {
    const ahead = 90_000;
    answer = (c) => (c.method === "POST" ? json({ ok: true }) : json(makeView({ serverNow: Date.now() + ahead })));
    const { result } = renderHook(() => useSessionRoom(7, { pollMs: POLL }));
    await settle();
    expect(Math.abs(result.current.offset - ahead)).toBeLessThan(50);
  });

  it("an older answer never replaces a newer one", async () => {
    let version = 5;
    answer = (c) => (c.method === "POST" ? json({ ok: true }) : json(makeView({ version, title: `v${version}` })));
    const { result } = renderHook(() => useSessionRoom(7, { pollMs: POLL }));
    await settle();
    expect(result.current.view?.version).toBe(5);
    version = 4;
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.view?.title).toBe("v5");
  });

  it("a room on screen that stops answering says it may be behind, and stops saying so once it answers", async () => {
    let down = false;
    answer = (c) => (c.method === "POST" ? json({ ok: true }) : down ? json({ error: "busy" }, 503) : json(makeView()));
    const { result } = renderHook(() => useSessionRoom(7, { pollMs: POLL, hereMs: 60_000 }));
    await settle();
    expect(result.current.lagging).toBe(false);
    down = true;
    await settle(POLL);
    expect(result.current.status).toBe("ready");
    expect(result.current.view?.title).toBe("Water circle");
    expect(result.current.lagging).toBe(true);
    down = false;
    await settle(POLL);
    expect(result.current.lagging).toBe(false);
  });

  it("asks nothing more once it holds a closed record", async () => {
    answer = (c) => (c.method === "POST" ? json({ ok: true }) : json(makeView({ status: "closed", closedAt: "2026-10-09T18:10:00.000Z" })));
    renderHook(() => useSessionRoom(7, { pollMs: POLL, hereMs: HERE }));
    await settle();
    await settle(POLL * 4);
    expect(gets().length).toBe(1);
    // A closed room is not a room to be present in.
    expect(calls.some((c) => c.url.endsWith("/here"))).toBe(false);
  });

  it("an answer that left for the last room is dropped when it lands in the next", async () => {
    let release: (r: Response) => void = () => {};
    answer = (c) => {
      if (c.url === "/api/sessions/7") return new Promise<Response>((r) => (release = r)) as unknown as Response;
      return json(makeView({ id: 8, title: "Seed circle" }));
    };
    const { result, rerender } = renderHook(({ id }) => useSessionRoom(id, { pollMs: 60_000, hereMs: 60_000 }), { initialProps: { id: 7 } });
    await settle();
    rerender({ id: 8 });
    await settle();
    expect(result.current.view?.title).toBe("Seed circle");
    await act(async () => {
      release(json(makeView({ id: 7, version: 99, title: "Water circle" })));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.view?.title).toBe("Seed circle");
  });

  it("asks nothing at all while it is not enabled", async () => {
    answer = () => json(makeView());
    renderHook(() => useSessionRoom(7, { enabled: false, pollMs: POLL }));
    await settle(POLL * 3);
    expect(calls.length).toBe(0);
  });
});

describe("presence", () => {
  it("says it is here at once and on every beat while joined and visible", async () => {
    answer = (c) => (c.method === "POST" ? json({ ok: true }) : json(makeView()));
    renderHook(() => useSessionRoom(7, { pollMs: 60_000, hereMs: HERE }));
    await settle();
    const here = () => calls.filter((c) => c.url === "/api/sessions/7/here").length;
    expect(here()).toBe(1);
    await settle(HERE);
    expect(here()).toBe(2);
    visibility = "hidden";
    await settle(HERE * 2);
    expect(here()).toBe(2);
  });

  it("says nothing for someone who has not joined", async () => {
    answer = () => json(makeView({ me: { userId: 2, joined: false, facilitates: false, secretary: false, admin: false } }));
    renderHook(() => useSessionRoom(7, { pollMs: 60_000, hereMs: HERE }));
    await settle(HERE * 2);
    expect(calls.some((c) => c.url.endsWith("/here"))).toBe(false);
  });
});

describe("the doors", () => {
  it("a refused write says the server's sentence, toasts it, and asks for the room again", async () => {
    const sentence = "Give a number from 1 to 11.";
    answer = (c) => (c.url.endsWith("/arrival") ? json({ error: sentence }, 400) : c.method === "POST" ? json({ ok: true }) : json(makeView()));
    const { result } = renderHook(() => useSessionRoom(7, { pollMs: 60_000, hereMs: 60_000 }));
    await settle();
    const before = gets().length;
    let r: Awaited<ReturnType<typeof result.current.actions.arrival>> | undefined;
    await act(async () => {
      r = await result.current.actions.arrival(12, null);
    });
    expect(r?.ok).toBe(false);
    expect(r && !r.ok ? r.error : "").toBe(sentence);
    expect(toastError).toHaveBeenCalledWith(sentence);
    expect(gets().length).toBe(before + 1);
    // The refetch after a write ignores the ETag: it wants what the server holds.
    expect(gets().at(-1)!.headers["If-None-Match"]).toBeUndefined();
  });

  it("a quiet write leaves the saying to its caller", async () => {
    answer = (c) => (c.url.endsWith("/respond") ? json({ error: "That round is closed." }, 409) : c.method === "POST" ? json({ ok: true }) : json(makeView()));
    const { result } = renderHook(() => useSessionRoom(7, { pollMs: 60_000, hereMs: 60_000 }));
    await settle();
    await act(async () => {
      await result.current.actions.respond("agenda", "consent", null, { quiet: true });
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("every door posts to its own path with the contract's body", async () => {
    answer = (c) => (c.method === "GET" ? json(makeView()) : json({ ok: true, id: 9 }));
    const { result } = renderHook(() => useSessionRoom(7, { pollMs: 60_000, hereMs: 60_000 }));
    await settle();
    const a = result.current.actions;
    await act(async () => {
      await a.join();
      await a.arrival(8, "Tea");
      await a.addItem({ title: "Roof", aim: "decide", minutes: 15 });
      await a.patchItem(4, { position: 2 });
      await a.addEntry({ kind: "action", text: "Call the roofer", itemId: 4, ownerSeatId: "seat1", dueOn: "2026-10-20" });
      await a.patchEntry(9, { claim: true });
      await a.deleteEntry(9);
      await a.respond("decision:9", "concern", "Budget first.");
      await a.act({ type: "go", stage: "agenda" });
      await a.hosts({ secretaryUserId: 3 });
      await a.close();
      await a.toolFeedback("A bigger clock.");
    });
    const writes = calls.filter((c) => c.method !== "GET" && !c.url.endsWith("/here")).map((c) => `${c.method} ${c.url}`);
    expect(writes).toEqual([
      "POST /api/sessions/7/join",
      "POST /api/sessions/7/arrival",
      "POST /api/sessions/7/items",
      "PATCH /api/sessions/7/items/4",
      "POST /api/sessions/7/entries",
      "PATCH /api/sessions/7/entries/9",
      "DELETE /api/sessions/7/entries/9",
      "POST /api/sessions/7/respond",
      "POST /api/sessions/7/act",
      "POST /api/sessions/7/hosts",
      "POST /api/sessions/7/close",
      "POST /api/sessions/7/tool-feedback",
    ]);
    const body = (path: string) => calls.find((c) => c.url === path && c.method !== "GET")!.body;
    expect(body("/api/sessions/7/arrival")).toEqual({ score: 8, wish: "Tea" });
    expect(body("/api/sessions/7/respond")).toEqual({ target: "decision:9", value: "concern", text: "Budget first." });
    expect(body("/api/sessions/7/act")).toEqual({ action: { type: "go", stage: "agenda" } });
  });

  it("a refused close hands back the actions nobody holds", async () => {
    answer = (c) =>
      c.url.endsWith("/close") ? json({ error: "Every action needs a person or a seat before the session closes.", unowned: [4, 5] }, 409) : json(makeView());
    const { result } = renderHook(() => useSessionRoom(7, { pollMs: 60_000, hereMs: 60_000 }));
    await settle();
    let r: Awaited<ReturnType<typeof result.current.actions.close>> | undefined;
    await act(async () => {
      r = await result.current.actions.close({ quiet: true });
    });
    expect(r?.ok).toBe(false);
    expect(r?.unowned).toEqual([4, 5]);
  });

  it("a dead network is said in the house's words", async () => {
    answer = (c) => {
      if (c.url.endsWith("/join")) throw new Error("offline");
      return json(makeView());
    };
    const { result } = renderHook(() => useSessionRoom(7, { pollMs: 60_000, hereMs: 60_000 }));
    await settle();
    await act(async () => {
      await result.current.actions.join();
    });
    expect(toastError).toHaveBeenCalledWith(ROOM_COPY.offline);
  });
});

describe("refusalSentence", () => {
  it("takes the server's sentence, and reads a bare code as the house line", () => {
    expect(refusalSentence({ error: "That item is not yours to move." }, 403)).toBe("That item is not yours to move.");
    expect(refusalSentence({ error: "auth_required" }, 401)).toBe(ROOM_COPY.signedOut);
    expect(refusalSentence({ error: "bad_request" }, 400)).toBe(ROOM_COPY.writeFailed);
    expect(refusalSentence(null, 500)).toBe(ROOM_COPY.writeFailed);
  });
});
