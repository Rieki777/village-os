/**
 * SEARCH THAT ANSWERS THE QUESTION IT WAS ASKED.
 *
 * Nobody opens an org chart to admire it. They open it to find out who to
 * talk to, and they type the thing they want done: "water", "money", "the
 * kitchen". Two things were in the way, and neither was visible as a bug:
 *
 *   1. Only the seat's NAME and AIM were searched. The DOMAIN, which is the
 *      field that says what a seat decides on, was not, so the seat that
 *      owns a question was findable exactly when its aim happened to repeat
 *      its domain.
 *   2. The result line read "3 of 4 held". True, and not what anybody typed
 *      a search to find out.
 *
 * `searchHits` is pure and exported for exactly this reason.
 */
import { describe, expect, it } from "vitest";
import { searchHits } from "./SearchBar";
import type { PowerCircle, PowerSeat } from "./types";

const circles: PowerCircle[] = [
  { id: "gathering", name: "Gathering Circle", purpose: "Meals, welcome and the rhythm of the week." },
  { id: "land", name: "Land Circle", purpose: "Soil, water and the growing." },
];

const seat = (over: Partial<PowerSeat> & { id: string; name: string }): PowerSeat => ({
  description: "",
  circleId: "gathering",
  seats: 1,
  holderCount: 1,
  vacant: false,
  holders: [],
  ...over,
});

const roles: PowerSeat[] = [
  seat({
    id: "kitchen-lead",
    name: "Kitchen Lead",
    description: "Keeps the hearth fed.",
    holders: [{ userId: "u1", name: "Ana" } as any],
  }),
  seat({
    id: "water-steward",
    name: "Water Steward",
    // The word a reader types is in the DOMAIN, never in the name or the aim.
    description: "Tends the springs.",
    domain: "Irrigation and rainwater catchment",
    circleId: "land",
    holders: [{ userId: "u2", name: "Bo" } as any],
  }),
  seat({
    id: "treasurer",
    name: "Treasurer",
    description: "Looks after the books.",
    accountabilities: ["Monthly budget reconciliation"],
    circleId: "land",
    seats: 2,
    holderCount: 0,
    vacant: true,
    holders: [],
  }),
];

const data = { circles, roles };

describe("a result says who and where", () => {
  it("names the holder and the circle, in place of a fraction", () => {
    const hit = searchHits(data, "kitchen").find((h) => h.id === "kitchen-lead");
    expect(hit, "the seat is found").toBeTruthy();
    expect(hit!.line).toBe("held by Ana, in Gathering Circle");
  });

  it("says open call, and still says where", () => {
    const hit = searchHits(data, "treasurer").find((h) => h.id === "treasurer");
    expect(hit!.line).toBe("open call, in Land Circle");
  });

  it("falls back to the count when names are withheld from this reader", () => {
    // `holders` arrives empty without map.viewPeople. The line must be
    // ABSENT of a name rather than wrong about one.
    const tiered = {
      circles,
      roles: [seat({ id: "k2", name: "Kitchen Lead", seats: 3, holderCount: 2, holders: [] })],
    };
    const hit = searchHits(tiered, "kitchen").find((h) => h.id === "k2");
    expect(hit!.line).toBe("2 of 3 held, in Gathering Circle");
    expect(hit!.line).not.toMatch(/held by/);
  });

  it("names at most two holders and counts the rest", () => {
    const many = {
      circles,
      roles: [
        seat({
          id: "k3",
          name: "Kitchen Lead",
          seats: 4,
          holderCount: 4,
          holders: [{ name: "Ana" }, { name: "Bo" }, { name: "Cy" }, { name: "Di" }] as any,
        }),
      ],
    };
    expect(searchHits(many, "kitchen")[0]!.line).toBe("held by Ana and Bo and 2 more, in Gathering Circle");
  });
});

describe("the domain is searched, because that is the word people type", () => {
  it("finds a seat by what it DECIDES ON, not only by its name and aim", () => {
    // "irrigation" appears in the domain alone.
    const hits = searchHits(data, "irrigation");
    expect(hits.map((h) => h.id)).toContain("water-steward");
  });

  it("finds a seat by an accountability", () => {
    const hits = searchHits(data, "reconciliation");
    expect(hits.map((h) => h.id)).toContain("treasurer");
  });

  it("still ranks a name match above a body match", () => {
    // "water" is the Water Steward's name and nobody else's anything.
    const hits = searchHits(data, "water");
    expect(hits[0]!.id).toBe("water-steward");
  });

  it("says nothing for a query too short to mean anything", () => {
    expect(searchHits(data, "w")).toEqual([]);
  });

  it("still finds circles by name and purpose", () => {
    expect(searchHits(data, "gathering").some((h) => h.kind === "circle")).toBe(true);
    expect(searchHits(data, "soil").some((h) => h.kind === "circle" && h.id === "land")).toBe(true);
  });
});
