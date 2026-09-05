// @vitest-environment jsdom
/**
 * The per-path ladders, rendered.
 *
 * These carry the claims a ladder makes about a member, and every one of them
 * is a claim that can be wrong in a way `tsc` cannot see: a rung drawn as
 * reached that nothing proves, a date printed for a change no column records, a
 * percentage across a rung with no denominator, a ladder under a path the
 * member does not walk. Each of those renders perfectly and says something
 * untrue.
 *
 * So these assert the ABSENCE of the fabrications as hard as the presence of
 * the facts, the same posture `CharacterSheet.test.tsx` takes next door.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen, waitFor, within } from "@testing-library/react";

import PathLadder from "./PathLadder";
import PathsPanel from "./PathsPanel";
import { usePathLadders } from "@/hooks/usePathLadders";
import type { LadderRung, PathLadder as PathLadderPayload } from "@shared/pathLadders";
import type { VillageMoon } from "@shared/villageMoon";

/** A lunation this village calls Moon 7. The absolute number is the storage key. */
const MOON: VillageMoon = {
  ordinal: 7,
  standing: "counted",
  cycleNumber: 329,
  startsAt: "2026-03-12T00:00:00.000Z",
  endsAt: "2026-04-10T00:00:00.000Z",
  fullMoonAt: null,
};

const rung = (over: Partial<LadderRung> & Pick<LadderRung, "id" | "name">): LadderRung => ({
  meaning: `What ${over.name} means.`,
  column: "some_table.some_column",
  lit: false,
  fell: false,
  note: null,
  moon: null,
  ...over,
});

const ladder = (over: Partial<PathLadderPayload> = {}): PathLadderPayload => ({
  pathId: "investor",
  rungs: [
    rung({ id: "interest_registered", name: "Interest registered", lit: true, moon: MOON }),
    rung({ id: "packet_released", name: "Packet released", lit: true }),
    rung({ id: "accreditation_declared", name: "Accreditation declared" }),
    rung({ id: "agreement_signed", name: "Agreement signed" }),
  ],
  position: 2,
  empty: null,
  ...over,
});

describe("PathLadder", () => {
  it("names where the member stands and draws every rung", () => {
    render(<PathLadder ladder={ladder()} />);
    expect(screen.getByText("Where you stand")).toBeTruthy();
    expect(screen.getByText("What Packet released means.")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("marks the standing rung for a reader who gets no icon", () => {
    const { container } = render(<PathLadder ladder={ladder()} />);
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain("Packet released");
  });

  /*
   * The whole reason this component exists in the shape it does. An earlier
   * draft of the character sheet gave every path a bar reading "2 of 3 seasons
   * served, 62%" and invented all three figures. There is no denominator on any
   * of these ladders, so there is no bar, no fraction and no percentage.
   */
  it("draws no bar, no fraction and no percentage", () => {
    const { container } = render(<PathLadder ladder={ladder()} />);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.textContent).not.toMatch(/%/);
    expect(container.textContent).not.toMatch(/\b\d+ of \d+\b/);
  });

  /*
   * POSITION FALLS, HISTORY DOES NOT. The rung that ended is still drawn, with
   * the reason the record carries, and the standing has fallen beneath it.
   */
  it("draws a dropped rung with the reason the record carries", () => {
    const dropped = ladder({
      rungs: [
        rung({ id: "interest_registered", name: "Interest registered", lit: true }),
        rung({
          id: "packet_released",
          name: "Packet released",
          fell: true,
          note: "access withdrawn",
          moon: MOON,
        }),
        rung({ id: "accreditation_declared", name: "Accreditation declared" }),
        rung({ id: "agreement_signed", name: "Agreement signed" }),
      ],
      position: 1,
    });
    render(<PathLadder ladder={dropped} />);
    expect(screen.getByText("access withdrawn")).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(within(items[1] as HTMLElement).getByText(/reached, and the record shows it ended/)).toBeTruthy();
    expect(screen.getByText("What Interest registered means.")).toBeTruthy();
  });

  it("says so plainly when every rung has gone dark", () => {
    render(
      <PathLadder
        ladder={ladder({
          rungs: [rung({ id: "opened", name: "Opened", fell: true, note: "wound up" })],
          position: 0,
        })}
      />,
    );
    expect(screen.getByText("No rung on this ladder holds right now.")).toBeTruthy();
  });

  /*
   * The village's own moon, never the storage key. `cycle_id` and the absolute
   * lunation number both stay off every member-facing surface.
   */
  it("dates a rung by the village's moon and never by a cycle id", () => {
    const { container } = render(<PathLadder ladder={ladder()} />);
    expect(container.textContent).toContain("Moon 7");
    expect(container.textContent).not.toContain("329");
    expect(container.textContent).not.toContain("lunar-");
  });

  /* A rung with no dated column gets no date, and none is borrowed from a neighbour. */
  it("prints no date for a rung no column dates", () => {
    const { container } = render(
      <PathLadder
        ladder={ladder({
          rungs: [rung({ id: "held", name: "A home is held", lit: true })],
          position: 1,
        })}
      />,
    );
    expect(container.textContent).not.toContain("Moon");
  });

  describe("with nothing on it yet", () => {
    const bare = (doorHref: string, doorLabel: string) =>
      ladder({
        position: 0,
        empty: { mechanic: "No home request yet.", doorHref, doorLabel },
      });

    it("names the mechanic and links the one door", () => {
      render(<PathLadder ladder={bare("/reserve", "Ask for a home")} />);
      expect(screen.getByText(/No home request yet/)).toBeTruthy();
      expect(screen.getByRole("link", { name: /Ask for a home/ }).getAttribute("href")).toBe("/reserve");
    });

    /*
     * Two of the four ladders name no door on purpose: the tile already carries
     * the path's own, and a second link to the same place two lines below it is
     * noise.
     */
    it("draws no link when the payload names no door", () => {
      const { container } = render(<PathLadder ladder={bare("", "")} />);
      expect(container.querySelector("a")).toBeNull();
      expect(container.querySelector("ol")).toBeNull();
    });
  });
});

describe("PathsPanel with ladders", () => {
  const tiles = [
    { id: "investor", label: "Investor", role: "Capital Contributor", route: "/investor", offered: true },
    { id: "steward", label: "Village Steward", role: "Co-Creator", route: "/steward", offered: true },
  ];

  const panel = (props: Partial<Parameters<typeof PathsPanel>[0]> = {}) =>
    render(
      <PathsPanel
        tiles={tiles}
        claimedIds={["investor"]}
        offerKnown
        saving={null}
        error=""
        onToggle={() => {}}
        {...props}
      />,
    );

  it("draws the ladder inside the tile for the path it belongs to", () => {
    panel({ ladders: [ladder()] });
    expect(screen.getByText("Where you stand")).toBeTruthy();
    expect(screen.getByText("What Packet released means.")).toBeTruthy();
  });

  /* Null means the payload has not landed. Unknown draws nothing. */
  it("draws nothing at all until the payload arrives", () => {
    const { container } = panel({ ladders: null });
    expect(container.textContent).not.toContain("Where you stand");
  });

  /*
   * A PATH THE MEMBER DOES NOT WALK SHOWS NO LADDER, even when a ladder for it
   * is sitting in the payload. Holding rows is not the same as walking a path.
   */
  it("shows no ladder under a path the member does not walk", () => {
    const { container } = panel({
      claimedIds: ["steward"],
      ladders: [ladder({ pathId: "investor" })],
    });
    expect(container.textContent).not.toContain("Where you stand");
  });

  it("leaves the panel exactly as it was for a caller that fetched no ladders", () => {
    const { container } = panel();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.textContent).not.toContain("Where you stand");
    expect(screen.getByText("You walk this path.")).toBeTruthy();
  });
});

describe("usePathLadders", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The token store, stubbed, and it has to be.
   *
   * `gameFetch` reads the bearer token through `authToken()`, which calls
   * `localStorage.getItem`, and THIS JSDOM HAS NO WORKING localStorage: the
   * accessor exists and its methods do not, so the call throws a TypeError
   * before any request is made. The hook's own `.catch` swallows it, so a test
   * without this stub watches the fetch never happen and reports nothing about
   * why. Worth writing down: the same throw happens in a real browser with site
   * data blocked, and it is `authToken`'s to fix rather than this hook's.
   */
  const withTokenStore = () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "a-token",
      setItem: () => {},
      removeItem: () => {},
    });
  };

  /*
   * The hook took a boolean first, and a boolean cannot tell "claimed a first
   * path" from "claimed a second one". A member already walking one path who
   * claimed another sat looking at a tile with no ladder under it until they
   * reloaded, because the flag never changed. This pins the fix.
   */
  it("asks again when the claims change, and never for a member who walks none", async () => {
    const calls: string[] = [];
    withTokenStore();
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ ladders: [] }) } as unknown as Response;
    });

    const { rerender } = renderHook(({ paths }) => usePathLadders(paths), {
      initialProps: { paths: [] as string[] },
    });
    expect(calls).toHaveLength(0);

    rerender({ paths: ["steward"] });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toBe("/api/paths/ladders");

    rerender({ paths: ["steward", "investor"] });
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  /*
   * A body that is not a ladder list leaves the state unknown, which draws
   * nothing. Half a ladder assembled out of undefined is the failure this
   * guards: a proxy's HTML error page answers 200 and parses to something.
   */
  it("stays unknown when the answer is not a list of ladders", async () => {
    let asked = 0;
    withTokenStore();
    vi.stubGlobal("fetch", async () => {
      asked += 1;
      return { ok: true, json: async () => ({ ladders: "soon" }) } as unknown as Response;
    });
    const { result } = renderHook(() => usePathLadders(["steward"]));
    await waitFor(() => expect(asked).toBe(1));
    expect(result.current).toBeNull();
  });

  /* The route refuses a stranger, so the call has to carry the token. */
  it("carries the bearer token", async () => {
    let auth: string | undefined;
    withTokenStore();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      auth = (init?.headers as Record<string, string>)?.Authorization;
      return { ok: true, json: async () => ({ ladders: [] }) } as unknown as Response;
    });
    renderHook(() => usePathLadders(["steward"]));
    await waitFor(() => expect(auth).toBe("Bearer a-token"));
  });
});
