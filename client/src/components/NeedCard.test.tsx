// @vitest-environment jsdom
/**
 * WHAT THE MEMBER ACTUALLY READS AND CAN ACTUALLY OPERATE.
 *
 * WHY A COMPONENT TEST AND NOT ONLY A ROUTE TEST. The route tests prove the
 * server sets `visibility` and refuses a body that carries one. They cannot
 * prove that this card never SENDS one, that the audience is printed before
 * the first control, that the five rungs carry the deck's own words, or that
 * a need with nothing tagged to it says so. All four are properties of the
 * rendered DOM and of the request body, which is what a person meets.
 *
 * THE LADDER IS KEYBOARD-OPERABLE BY CONSTRUCTION. Each rung is a real
 * `<input type="radio">` inside its label, grouped by `name`, so a browser
 * gives arrow-key movement, focus and the announcement for free. A row of
 * `<div onClick>` chips would look identical and be unreachable without a
 * mouse, so the assertion below is on the input elements and their grouping.
 *
 * The mocked payloads are the real shapes of `GET /api/needs/mine` and
 * `GET /api/needs/coverage`, copied from the handlers.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "usr-ana", name: "Ana" } }),
}));
vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-session" }));

import NeedCard from "./NeedCard";

const MINE = {
  cycleId: "lunar-000329",
  floor: 3,
  feelingMax: 64,
  noteMax: 500,
  answered: false,
  mine: [],
};

/** Vitality has a seat and three quests. Play has nothing at all. */
const COVERAGE = {
  answered: true,
  coverage: [
    {
      needKey: "vitality",
      label: "Vitality & Survival Needs",
      counts: { quest: 3, role: 1, sink: 0, stay: 0, event: 0, place: 0 },
      total: 4,
    },
    {
      needKey: "play",
      label: "Play",
      counts: { quest: 0, role: 0, sink: 0, stay: 0, event: 0, place: 0 },
      total: 0,
    },
  ],
};

/** Answers /api/needs/mine and /api/needs/coverage by URL, and records PUTs. */
function serve(mine: unknown = MINE, coverage: unknown = COVERAGE) {
  const sent: Array<{ url: string; method: string; body: any }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      sent.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
    }
    const body = url.includes("coverage") ? coverage : mine;
    return { ok: true, json: async () => body } as unknown as Response;
  });
  return { fetchMock, sent };
}

describe("the needs card on a member's own profile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("names the audience before it collects anything", async () => {
    const { fetchMock } = serve();
    vi.stubGlobal("fetch", fetchMock);
    render(<NeedCard />);

    const promise = await screen.findByText(/Only you can read this/);
    expect(promise.textContent).toContain("never who");
    // The number in the sentence came off the payload, so the copy and the
    // rule cannot drift. A card carrying its own 5 would still read "5" here
    // after somebody set the floor to 3.
    expect(promise.textContent).toContain("at least 3 members");

    // And it is above the controls, in document order, not under the button.
    const radios = document.querySelectorAll('input[type="radio"]');
    expect(radios.length).toBeGreaterThan(0);
    expect(
      promise.compareDocumentPosition(radios[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the audience is named before the first control",
    ).toBeTruthy();
  });

  it("prints the deck's heading and the five rungs by their own words", async () => {
    const { fetchMock } = serve();
    vi.stubGlobal("fetch", fetchMock);
    render(<NeedCard />);

    await screen.findByText(/I feel ____ because I need ____/);
    for (const rung of ["Deprived", "Unmet", "Alive", "Satisfied", "Thriving"]) {
      // Each rung appears on the ladder for each need shown, so `getAllBy`.
      expect((await screen.findAllByText(rung)).length).toBeGreaterThan(0);
    }
  });

  it("gives every rung a real radio, grouped per need, so the ladder works from the keyboard", async () => {
    const { fetchMock } = serve();
    vi.stubGlobal("fetch", fetchMock);
    render(<NeedCard />);

    await screen.findByText(/I feel ____ because I need ____/);
    const vitality = document.querySelectorAll('input[name="depth-vitality"]');
    expect(vitality).toHaveLength(5);
    expect(Array.from(vitality).map((r) => (r as HTMLInputElement).value)).toEqual([
      "deprived",
      "unmet",
      "alive",
      "satisfied",
      "thriving",
    ]);
    // A separate group per need: choosing Thriving on Play must not move the
    // answer on Vitality.
    expect(document.querySelectorAll('input[name="depth-play"]')).toHaveLength(5);
    const group = screen.getAllByRole("radiogroup");
    expect(group.length).toBeGreaterThanOrEqual(2);
  });

  it("says what meets a need, and says plainly when nothing does", async () => {
    const { fetchMock } = serve();
    vi.stubGlobal("fetch", fetchMock);
    render(<NeedCard />);

    // Vitality: one seat and three quests, in the deck's own nouns.
    expect(await screen.findByText("Met here by 3 quests and 1 seat.")).toBeTruthy();
    // Play: the honest sentence, never a blank space.
    expect(
      await screen.findByText("Nothing in this village meets this yet. Your village knows."),
    ).toBeTruthy();
  });

  it("sends only what the member typed, and never a visibility field", async () => {
    const { fetchMock, sent } = serve();
    vi.stubGlobal("fetch", fetchMock);
    render(<NeedCard />);

    await screen.findByText(/I feel ____ because I need ____/);
    const deprived = document.querySelector(
      'input[name="depth-play"][value="deprived"]',
    ) as HTMLInputElement;
    fireEvent.click(deprived);
    fireEvent.click(screen.getAllByText("Save")[1]);

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].method).toBe("PUT");
    expect(sent[0].url).toBe("/api/needs/mine");
    expect(sent[0].body.needKey).toBe("play");
    expect(sent[0].body.depth).toBe("deprived");
    // The whole point of the card. There is no control for it, and the body
    // does not carry the key at all.
    expect(Object.keys(sent[0].body)).not.toContain("visibility");
  });

  it("offers no visibility control anywhere on the card", async () => {
    const { fetchMock } = serve();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<NeedCard />);
    await screen.findByText(/I feel ____ because I need ____/);
    expect(container.textContent).not.toMatch(/visib/i);
    expect(container.textContent).not.toMatch(/share with the village/i);
    expect(container.textContent).not.toMatch(/stewards can see/i);
  });

  it("shows an answered card differently from an unasked one", async () => {
    const answered = {
      ...MINE,
      answered: true,
      mine: [{ needKey: "play", depth: "deprived", feeling: "flat", note: null }],
    };
    const { fetchMock } = serve(answered);
    vi.stubGlobal("fetch", fetchMock);
    render(<NeedCard />);

    await screen.findByText(/I feel ____ because I need ____/);
    const chosen = document.querySelector(
      'input[name="depth-play"][value="deprived"]',
    ) as HTMLInputElement;
    expect(chosen.checked).toBe(true);
    // A member who has answered can take it back. One who has not sees no
    // such control, because there is nothing there to remove.
    expect(screen.getAllByText("Take it back")).toHaveLength(1);
  });

  it("renders nothing at all when the payload never arrives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as unknown as Response),
    );
    const { container } = render(<NeedCard />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
