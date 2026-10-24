// @vitest-environment jsdom
/**
 * The circle wall: every circle as a card, the openings first.
 *
 * What these pin: the order each sort promises, the line a card says, that a
 * card opens its circle and nothing else, that people's initials appear only
 * where the reader may see people, and that a circle the village named and has
 * not started reads as forming, with no roles yet.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import CircleWall, { cardLine, wallOrder } from "./CircleWall";
import type { PowerData, PowerSeat } from "./types";

afterEach(cleanup);

const role = (id: string, circleId: string, seats: number, names: string[]) =>
  ({
    id, name: id, circleId, seats, holderCount: names.length, vacant: names.length < seats,
    holders: names.map((name) => ({ userId: null, name })),
  }) as unknown as PowerSeat;

const data = (viewPeople: boolean): PowerData =>
  ({
    circles: [
      { id: "lead", name: "Leadership Circle", status: "active", order: 1, icon: "Crown", purpose: "Holds the whole" },
      { id: "out", name: "Outreach Circle", status: "active", order: 3, icon: "Handshake" },
      { id: "perma", name: "Permaculture Council", status: "forming", order: 2, icon: "Sprout" },
    ],
    roles: [
      role("l1", "lead", 1, ["Ana Ruiz"]),
      role("l2", "lead", 1, []),
      role("o1", "out", 1, ["Ben Ode"]),
      role("o2", "out", 3, []),
    ],
    quests: [],
    viewer: { viewPeople, canContact: false },
  }) as unknown as PowerData;

describe("wallOrder", () => {
  it("puts the circles with the most openings first", () => {
    expect(wallOrder(data(true), "openings").map((c) => c.id)).toEqual(["out", "lead", "perma"]);
  });

  it("shows only the circles at work today, in the village's own order", () => {
    expect(wallOrder(data(true), "working").map((c) => c.id)).toEqual(["lead", "out"]);
  });

  it("shows everything in the village's own order", () => {
    expect(wallOrder(data(true), "all").map((c) => c.id)).toEqual(["lead", "perma", "out"]);
  });
});

describe("cardLine", () => {
  it("says how full a circle is in words", () => {
    expect(cardLine({ places: 4, held: 1, openings: 3 })).toBe("1 of 4 held, 3 open");
    expect(cardLine({ places: 2, held: 2, openings: 0 })).toBe("All 2 held");
    expect(cardLine({ places: 0, held: 0, openings: 0 })).toBe("No roles yet");
  });
});

describe("the circle wall", () => {
  it("draws a card per circle, openings first, each with its meter", () => {
    render(<CircleWall data={data(true)} onOpen={() => {}} />);
    const cards = screen.getAllByRole("button", { name: /Open this circle/ });
    expect(cards.map((c) => c.getAttribute("data-wall-circle"))).toEqual(["out", "lead", "perma"]);
    const meter = within(cards[0]).getByRole("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("1");
    expect(meter.getAttribute("aria-valuemax")).toBe("4");
    expect(cards[0].textContent).toContain("1 of 4 held, 3 open");
  });

  it("opens the circle a card names", () => {
    const onOpen = vi.fn();
    render(<CircleWall data={data(true)} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /^Leadership Circle/ }));
    expect(onOpen).toHaveBeenCalledWith("lead");
  });

  it("reorders when a sort is chosen", () => {
    render(<CircleWall data={data(true)} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "At work today" }));
    const ids = screen.getAllByRole("button", { name: /Open this circle/ }).map((c) => c.getAttribute("data-wall-circle"));
    expect(ids).toEqual(["lead", "out"]);
  });

  it("shows initials only where the reader may see people", () => {
    const { unmount } = render(<CircleWall data={data(true)} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /^Leadership Circle/ }).textContent).toContain("AR");
    unmount();
    render(<CircleWall data={data(false)} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /^Leadership Circle/ }).textContent).not.toContain("AR");
  });

  it("marks a named circle with no roles as forming, with no roles yet", () => {
    render(<CircleWall data={data(true)} onOpen={() => {}} />);
    const card = screen.getByRole("button", { name: /^Permaculture Council, forming/ });
    expect(card.textContent).toContain("No roles yet");
    expect(within(card).queryByRole("meter")).toBeNull();
  });
});
