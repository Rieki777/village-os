// @vitest-environment jsdom
/**
 * THE OPEN MAP FOLLOWS THE VILLAGE'S ORG, AND ASKS ONLY WHILE SOMEBODY LOOKS.
 *
 * Rye's D3: a seat created elsewhere appears on the open map without a reload,
 * and one taken away goes. The shell side of that is a poll, and a poll can be
 * wrong in four ways that all look like "it works" from the outside: it can
 * redraw the map for an answer that did not change, drop the player's party
 * on the way through (the map reads an absent party as "show everything"),
 * keep asking from a hidden tab all afternoon, or keep asking a route that has
 * already said no. Each case here names one of those, and the clock is driven
 * by hand so the interval is the thing under test and not a sleep.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const gameFetch = vi.fn();
let token: string | null = null;
vi.mock("@/lib/gameApi", () => ({
  gameFetch: (...a: unknown[]) => gameFetch(...a),
  authToken: () => token,
}));

import { fetchOrg, lensFromOrg, useOrgFollow } from "./orgFollow";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ORG_V1 = {
  version: "aaaaaaaaaaaaaaaa",
  viewPeople: true,
  circles: [{ id: "land", name: "Land Circle", parentCircleId: null, status: "active", order: 1, colour: "#6fae52" }],
  roles: [
    {
      id: "water", name: "Water Steward", circleId: "land", state: "partial", seats: 2, holderCount: 1,
      archetypes: [], description: "Keep the springs running.", holders: [{ name: "Ana", lapsed: false, isAgent: false }],
    },
  ],
};
const ORG_V2 = {
  ...ORG_V1,
  version: "bbbbbbbbbbbbbbbb",
  roles: [...ORG_V1.roles, { ...ORG_V1.roles[0], id: "seed", name: "Seed Keeper", state: "open", holderCount: 0, holders: [] }],
};

/** What the server says next, in order. The last answer repeats. */
let answers: Array<() => Response>;
let asked: Array<{ url: string; ifNoneMatch: string | null }>;

beforeEach(() => {
  token = "t";
  asked = [];
  answers = [];
  gameFetch.mockReset();
  gameFetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const h = (init.headers ?? {}) as Record<string, string>;
    asked.push({ url, ifNoneMatch: h["If-None-Match"] ?? null });
    if (url === "/api/me/characters") return json({ party: [{ archetypeKey: "gardener" }] });
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    return next();
  });
  setVisibility("visible");
});

afterEach(() => {
  vi.useRealTimers();
});

function setVisibility(v: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
}

const orgAsks = () => asked.filter((a) => a.url === "/api/map/org");

describe("lensFromOrg", () => {
  it("keeps what the map draws and names holders by name only", () => {
    const org = lensFromOrg(ORG_V1);
    expect(org?.version).toBe(ORG_V1.version);
    expect(org?.circles).toEqual([{ id: "land", name: "Land Circle", parentCircleId: null, status: "active", colour: "#6fae52" }]);
    expect(org?.roles[0]).toMatchObject({ id: "water", circleId: "land", state: "partial", holders: ["Ana"] });
  });

  it("refuses a body with no version, and drops a role with no name or a colour that is not a hex", () => {
    expect(lensFromOrg({ roles: [] })).toBeNull();
    const org = lensFromOrg({
      version: "v",
      circles: [{ id: "x", name: "X", colour: "red;background:url(x)" }],
      roles: [{ id: "r", name: "  " }, { id: "s", name: "Steward" }],
    });
    expect(org?.circles[0].colour).toBe("");
    expect(org?.roles.map((r) => r.id)).toEqual(["s"]);
  });
});

describe("fetchOrg", () => {
  it("sends the version it holds and reads a 304 as nothing new", async () => {
    answers = [() => new Response(null, { status: 304 })];
    expect(await fetchOrg("aaaaaaaaaaaaaaaa")).toEqual({ kind: "same" });
    expect(orgAsks()[0].ifNoneMatch).toBe('"org-aaaaaaaaaaaaaaaa"');
  });

  it("reads a 200 carrying the version it holds as nothing new too", async () => {
    answers = [() => json(ORG_V1)];
    expect(await fetchOrg(ORG_V1.version)).toEqual({ kind: "same" });
  });

  it("tells a refusal from a failure", async () => {
    answers = [() => json({ error: "auth_required" }, 401)];
    expect(await fetchOrg(null)).toEqual({ kind: "refused", status: 401 });
    answers = [() => json({ error: "boom" }, 502)];
    expect(await fetchOrg(null)).toEqual({ kind: "failed" });
  });
});

function mount(intervalMs = 1000) {
  const posted: any[] = [];
  const frame = { current: { contentWindow: { postMessage: (m: unknown) => posted.push(m) } } } as never;
  const hook = renderHook(({ live }) => useOrgFollow({ frame, live, intervalMs }), { initialProps: { live: true } });
  const lenses = () => posted.filter((m) => m?.type === "lens");
  return { hook, posted, lenses };
}

/** Let the interval fire and every promise it started settle. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useOrgFollow", () => {
  it("pushes the party and the org together when the map boots", async () => {
    answers = [() => json(ORG_V1)];
    const m = mount();
    await act(() => m.hook.result.current.pushLens());
    expect(m.lenses()).toHaveLength(1);
    expect(m.lenses()[0]).toMatchObject({
      party: ["gardener"],
      orgVersion: ORG_V1.version,
      circles: [{ id: "land" }],
      roles: [{ name: "Water Steward", holders: ["Ana"] }],
    });
  });

  it("redraws nothing while the village is unchanged, and sends a new seat within one interval", async () => {
    vi.useFakeTimers();
    answers = [() => json(ORG_V1), () => new Response(null, { status: 304 }), () => new Response(null, { status: 304 }), () => json(ORG_V2)];
    const m = mount(1000);
    await act(() => m.hook.result.current.pushLens());
    await advance(1000);
    await advance(1000);
    expect(m.lenses(), "two unchanged answers post nothing").toHaveLength(1);
    expect(orgAsks().slice(1).map((a) => a.ifNoneMatch)).toEqual([`"org-${ORG_V1.version}"`, `"org-${ORG_V1.version}"`]);
    await advance(1000);
    expect(m.lenses()).toHaveLength(2);
    const last = m.lenses()[1];
    expect(last.roles.map((r: any) => r.name)).toEqual(["Water Steward", "Seed Keeper"]);
    // The party rides every message, or the map would widen to every mark.
    expect(last.party).toEqual(["gardener"]);
    expect(orgAsks().at(-1)?.ifNoneMatch).toBe(`"org-${ORG_V1.version}"`);
  });

  it("asks nothing while the tab is hidden, and asks at once when it is shown", async () => {
    vi.useFakeTimers();
    answers = [() => json(ORG_V1), () => json(ORG_V2)];
    const m = mount(1000);
    await act(() => m.hook.result.current.pushLens());
    setVisibility("hidden");
    await advance(5000);
    expect(orgAsks(), "only the boot ask").toHaveLength(1);
    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(orgAsks()).toHaveLength(2);
    expect(m.lenses().at(-1)?.orgVersion).toBe(ORG_V2.version);
  });

  it("stops asking a route that refused, and keeps asking through a failure", async () => {
    vi.useFakeTimers();
    answers = [() => json(ORG_V1), () => json({ error: "boom" }, 502), () => json({ error: "auth_required" }, 401)];
    const m = mount(1000);
    await act(() => m.hook.result.current.pushLens());
    await advance(1000); // 502: carries on
    await advance(1000); // 401: stops
    await advance(5000);
    expect(orgAsks()).toHaveLength(3);
    expect(m.lenses()).toHaveLength(1);
  });

  it("does not poll before the map has said it is ready, or after it unmounts", async () => {
    vi.useFakeTimers();
    answers = [() => json(ORG_V1)];
    const posted: any[] = [];
    const frame = { current: { contentWindow: { postMessage: (x: unknown) => posted.push(x) } } } as never;
    const hook = renderHook(({ live }) => useOrgFollow({ frame, live, intervalMs: 1000 }), { initialProps: { live: false } });
    await advance(3000);
    expect(orgAsks()).toHaveLength(0);
    hook.rerender({ live: true });
    await advance(1000);
    expect(orgAsks()).toHaveLength(1);
    hook.unmount();
    await advance(3000);
    expect(orgAsks()).toHaveLength(1);
  });

  it("still hands the map its party when the org cannot be read", async () => {
    answers = [() => json({ error: "auth_required" }, 401)];
    const m = mount();
    await act(() => m.hook.result.current.pushLens());
    expect(m.lenses()).toEqual([{ type: "lens", party: ["gardener"], roles: [] }]);
  });
});
