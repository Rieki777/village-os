import { describe, expect, it } from "vitest";
import { circleCounts, countable, headlineFor, isCalling, seatWord, villageCounts } from "./villageCounts";
import type { PowerCircle, PowerSeat } from "./types";

const circle = (id: string, extra: Partial<PowerCircle> = {}): PowerCircle => ({ id, name: id, ...extra });
const role = (id: string, circleId: string | null, seats: number, holderCount: number, extra: Partial<PowerSeat> = {}) =>
  ({ id, name: id, circleId, seats, holderCount, vacant: holderCount < seats, holders: [], ...extra }) as PowerSeat;

/** The live village's shape on 2026-10-23: 6 active, 11 forming, 25 roles, 28 places, 12 held. */
const LIVE = {
  circles: [
    ...Array.from({ length: 6 }, (_, i) => circle(`a${i}`, { status: "active" })),
    ...Array.from({ length: 11 }, (_, i) => circle(`f${i}`, { status: "forming" })),
  ],
  roles: [
    ...Array.from({ length: 12 }, (_, i) => role(`h${i}`, "a0", 1, 1)),
    ...Array.from({ length: 10 }, (_, i) => role(`o${i}`, "a1", 1, 0)),
    role("team1", "a2", 2, 0),
    role("team2", "a2", 2, 0),
    role("solo", "a3", 2, 0),
  ],
};

describe("villageCounts", () => {
  it("counts the live village the way the page should say it", () => {
    expect(villageCounts(LIVE)).toEqual({
      circles: 17, atWork: 6, forming: 11, roles: 25, places: 28, held: 12, openings: 16, openRoles: 13,
    });
  });

  it("leaves the examples out once the village has its own", () => {
    const c = villageCounts({
      circles: [circle("own", { status: "active" }), circle("ex", { status: "active", isExample: true })],
      roles: [role("r", "own", 1, 0), role("x", "ex", 3, 0, { isExample: true })],
    });
    expect([c.circles, c.roles, c.places]).toEqual([1, 1, 1]);
  });

  it("counts the examples while they are all the village has", () => {
    const c = villageCounts({
      circles: [circle("ex", { isExample: true })],
      roles: [role("x", "ex", 2, 1, { isExample: true })],
    });
    expect([c.circles, c.atWork, c.places, c.held]).toEqual([1, 1, 2, 1]);
  });

  it("reads a circle with no status as at work", () => {
    expect(villageCounts({ circles: [circle("x")], roles: [] }).atWork).toBe(1);
  });

  it("never counts more held than there are places", () => {
    expect(villageCounts({ circles: [], roles: [role("r", null, 1, 3)] }).openings).toBe(0);
  });
});

describe("one rule for an opening", () => {
  /*
   * Live on 2026-10-30: the side panel said 16 "open calls" and the legend
   * said 15, in the same words. One role was forming: the panel counted it
   * (it has a vacancy) and the legend did not (its state is forming). A
   * forming role is not calling anyone, so it is neither an opening nor an
   * open role, and every surface counts through the same helpers.
   */
  const withForming = {
    circles: [circle("a", { status: "active" })],
    roles: [role("o", "a", 1, 0), role("p", "a", 3, 1, { state: "partial" }), role("f", "a", 1, 0, { state: "forming" })],
  };

  it("leaves a forming role's place out of the openings and the open roles", () => {
    const c = villageCounts(withForming);
    expect(c.openings).toBe(3);
    expect(c.openRoles).toBe(2);
    expect(circleCounts("a", withForming).openings).toBe(3);
  });

  it("agrees with the legend's tally of the states that call", () => {
    const calling = withForming.roles.filter((r) => ["open", "partial"].includes(seatWord(r)));
    expect(villageCounts(withForming).openRoles).toBe(calling.length);
    expect(withForming.roles.filter(isCalling).map((r) => r.id)).toEqual(["o", "p"]);
  });
});

describe("circleCounts", () => {
  it("counts only a circle's own roles, and the circles directly inside it", () => {
    const data = {
      circles: [circle("root"), circle("dev", { parentCircleId: "root" }), circle("arch", { parentCircleId: "dev" })],
      roles: [role("a", "dev", 1, 1), role("b", "dev", 2, 0), role("c", "arch", 1, 1)],
    };
    expect(circleCounts("dev", data)).toEqual({ roles: 2, places: 3, held: 1, openings: 2, inside: 1 });
    expect(circleCounts("root", data).inside).toBe(1);
  });
});

describe("headlineFor", () => {
  it("says the whole map in one line", () => {
    expect(headlineFor(villageCounts(LIVE))).toBe("6 circles at work, 11 forming, 16 openings.");
  });

  it("leaves out a part with nothing in it, and speaks in the singular", () => {
    const c = villageCounts({ circles: [circle("a")], roles: [role("r", "a", 1, 0)] });
    expect(headlineFor(c)).toBe("1 circle at work, 1 opening.");
  });

  it("says so when every role is held", () => {
    const c = villageCounts({ circles: [circle("a")], roles: [role("r", "a", 2, 2)] });
    expect(headlineFor(c)).toBe("1 circle at work, every role held.");
  });

  it("has a line for a village with no circles", () => {
    expect(headlineFor(villageCounts({ circles: [], roles: [] }))).toBe("No circles yet.");
  });
});

describe("countable", () => {
  it("is the village's own, or everything while it has nothing of its own", () => {
    expect(countable([{ isExample: true }, {}]).length).toBe(1);
    expect(countable([{ isExample: true }]).length).toBe(1);
  });
});
