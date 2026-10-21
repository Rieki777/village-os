/**
 * The carry list, in the shape of a real reset: an old chart with seventeen
 * circles' worth of nesting cut down to the parts that matter, people sitting
 * in some of its seats, and a new structure published beside it with one live
 * seat moved into it. Fake first names throughout.
 */
import { describe, expect, it } from "vitest";
import { meaningWords, nameLikeness, planCarry, retireChanges, suggestSeat, type CarryCircle, type CarrySeat, type CarrySeating } from "./carryAcross";

const CIRCLES: CarryCircle[] = [
  { id: "general-circle", name: "General Coordinating Circle", parentCircleId: null, status: "active", isExample: false },
  { id: "finance-business-circle", name: "Finance & Business Circle", parentCircleId: "general-circle", status: "active", isExample: false },
  { id: "community-circle", name: "Community Circle", parentCircleId: "general-circle", status: "forming", isExample: false },
  { id: "advisory-bodies", name: "Advisory Bodies", parentCircleId: "general-circle", status: "forming", isExample: false },
  { id: "development-circle", name: "Development Circle", parentCircleId: "general-circle", status: "active", isExample: false },
  { id: "leadership-circle", name: "Leadership Circle", parentCircleId: null, status: "active", isExample: false },
  { id: "old-dormant", name: "Already Resting", parentCircleId: null, status: "dormant", isExample: false },
  { id: "example-circle", name: "Example Circle", parentCircleId: null, status: "active", isExample: true },
  // The new structure's circles, made by the published draft. One sits inside an old circle.
  { id: "regenerative-business", name: "Regenerative Business", parentCircleId: null, status: "active", isExample: false },
  { id: "community-anchor", name: "Community Anchor", parentCircleId: null, status: "active", isExample: false },
  { id: "land-team", name: "Land Team", parentCircleId: "leadership-circle", status: "active", isExample: false },
];

const seat = (id: string, name: string, circleId: string | null, extra: Partial<CarrySeat> = {}): CarrySeat => ({
  id,
  name,
  circleId,
  active: true,
  isExample: false,
  ...extra,
});

const SEATS: CarrySeat[] = [
  // The old chart.
  seat("finance-lead", "Finance Lead", "finance-business-circle"),
  seat("entity-steward", "Entity and Land Trust Steward", "finance-business-circle"),
  seat("potluck-priestess", "Potluck Priestess", "community-circle"),
  seat("community-lead", "Community Lead", "community-circle"),
  seat("advisory-board", "Advisory Board", "advisory-bodies"),
  seat("land-liaison", "Land Liaison", "development-circle"),
  seat("visionary-lead", "Visionary Lead", "leadership-circle"),
  seat("rested-before", "Rested Before", "development-circle", { active: false }),
  seat("example-seat", "Example Seat", "example-circle", { isExample: true }),
  // Moved into the new structure by the review (update_seat): keeps its id and its people.
  seat("operations-steward", "Operations Steward", "community-anchor"),
  // Made by the published draft.
  seat("rec-finance", "Finance Steward", "regenerative-business"),
  seat("rec-events", "Community Events", "community-anchor"),
  seat("rec-care", "Community Care", "community-anchor"),
  seat("rec-land", "Land Liaison", "land-team"),
  seat("rec-advisory", "Advisory Council Member", "regenerative-business"),
];

const CHANGES = [
  { op: "create_circle", orgRoleId: "circle:regenerative-business", payload: {} },
  { op: "create_circle", orgRoleId: "circle:community-anchor", payload: {} },
  { op: "create_circle", orgRoleId: "circle:land-team", payload: { parentCircleId: "leadership-circle" } },
  { op: "update_seat", orgRoleId: "operations-steward", payload: { circleId: "community-anchor" } },
  { op: "create_seat", orgRoleId: "rec-finance", payload: {} },
  { op: "create_seat", orgRoleId: "rec-events", payload: {} },
  { op: "create_seat", orgRoleId: "rec-care", payload: {} },
  { op: "create_seat", orgRoleId: "rec-land", payload: {} },
  { op: "create_seat", orgRoleId: "rec-advisory", payload: {} },
];

const sat = (id: string, orgRoleId: string, person: string, isExample = false): CarrySeating => ({ id, orgRoleId, person, isExample });

const SEATINGS: CarrySeating[] = [
  sat("a-ana", "finance-lead", "Ana"),
  sat("a-bo", "potluck-priestess", "Bo"),
  sat("a-cy", "community-lead", "Cy"),
  sat("a-dee", "advisory-board", "Dee"),
  sat("a-eli", "advisory-board", "Eli"),
  sat("a-fay", "land-liaison", "Fay"),
  sat("a-gus", "operations-steward", "Gus"),
  sat("a-ex", "example-seat", "Example", true),
];

const plan = (seatings = SEATINGS) => planCarry({ changes: CHANGES, seats: SEATS, circles: CIRCLES, seatings });
const row = (p: ReturnType<typeof plan>, id: string) => p.rows.find((r) => r.seatingId === id)!;

describe("who still sits on the old chart", () => {
  it("lists every live seating on an old seat, and nobody else", () => {
    const p = plan();
    expect(p.rows.map((r) => r.seatingId).sort()).toEqual(["a-ana", "a-bo", "a-cy", "a-dee", "a-eli", "a-fay"]);
    expect(row(p, "a-ana")).toMatchObject({
      person: "Ana",
      oldSeatName: "Finance Lead",
      oldCircleName: "Finance & Business Circle",
    });
  });

  it("takeover: a seat the review moved took its people with it, so they are kept and never a row", () => {
    const p = plan();
    expect(p.kept).toEqual([{ seatingId: "a-gus", person: "Gus", seatId: "operations-steward", seatName: "Operations Steward" }]);
    expect(p.rows.some((r) => r.seatingId === "a-gus")).toBe(false);
    // And it is a seat of the new chart, so it can be picked.
    expect(p.newSeats.map((s) => s.id)).toContain("operations-steward");
  });

  it("offers the new chart's seats only, with their circle", () => {
    const p = plan();
    expect(p.newSeats.map((s) => s.id).sort()).toEqual(
      ["operations-steward", "rec-advisory", "rec-care", "rec-events", "rec-finance", "rec-land"].sort(),
    );
    expect(p.newSeats.find((s) => s.id === "rec-land")!.circleName).toBe("Land Team");
  });
});

describe("the suggestion", () => {
  it("same name first", () => {
    expect(row(plan(), "a-fay").suggestion).toEqual({ seatId: "rec-land", seatName: "Land Liaison", why: "same-name" });
  });

  it("else the one most similar name", () => {
    expect(row(plan(), "a-ana").suggestion).toEqual({ seatId: "rec-finance", seatName: "Finance Steward", why: "similar-name" });
    expect(row(plan(), "a-dee").suggestion).toEqual({ seatId: "rec-advisory", seatName: "Advisory Council Member", why: "similar-name" });
  });

  it("none when nothing is alike", () => {
    expect(row(plan(), "a-bo").suggestion).toBeNull();
  });

  it("none on a tie: two seats equally alike is a guess", () => {
    // "Community Lead" shares one word with "Community Events" and with "Community Care".
    expect(nameLikeness("Community Lead", "Community Events")).toBe(nameLikeness("Community Lead", "Community Care"));
    expect(row(plan(), "a-cy").suggestion).toBeNull();
  });

  it("reads meaning words only", () => {
    expect(Array.from(meaningWords("Website & Backend/AI Steward"))).toEqual(["website", "backend", "ai"]);
    expect(nameLikeness("Project Manager", "Development Manager")).toBe(0);
    expect(suggestSeat("Lead", [{ id: "x", name: "Lead Steward", circleId: null, circleName: null }])).toBeNull();
  });
});

describe("what retires", () => {
  it("never offers a held seat for retiring, and lists it as still held", () => {
    const p = plan();
    const retiring = p.retire.seats.map((s) => s.id);
    for (const held of ["finance-lead", "potluck-priestess", "community-lead", "advisory-board", "land-liaison"]) {
      expect(retiring).not.toContain(held);
      expect(p.retire.stillHeld.map((s) => s.id)).toContain(held);
    }
    expect(p.retire.stillHeld.find((s) => s.id === "advisory-board")!.holders).toBe(2);
    expect(retiring).toEqual(["entity-steward", "visionary-lead"]);
    const ops = retireChanges(p.retire, "steward-1", "draft-1").filter((c) => c.op === "rest_seat").map((c) => c.orgRoleId);
    expect(ops).toEqual(["entity-steward", "visionary-lead"]);
  });

  it("never retires a seat of the new chart, an inactive seat or an example", () => {
    const ids = plan().retire.seats.map((s) => s.id);
    for (const id of ["operations-steward", "rec-finance", "rested-before", "example-seat"]) expect(ids).not.toContain(id);
  });

  it("keeps every circle a held seat or a new circle still sits in", () => {
    const circles = plan().retire.circles.map((c) => c.id);
    // Held seats sit in all four old circles under general, so neither they nor general retire.
    expect(circles).toEqual([]);
  });

  it("retires bottom up once everyone is carried, and keeps a circle a new one sits inside", () => {
    const p = plan([sat("a-gus", "operations-steward", "Gus")]);
    expect(p.rows).toEqual([]);
    const order = p.retire.circles.map((c) => c.id);
    expect(order).toContain("general-circle");
    for (const child of ["finance-business-circle", "community-circle", "advisory-bodies", "development-circle"]) {
      expect(order.indexOf(child)).toBeGreaterThan(-1);
      expect(order.indexOf(child)).toBeLessThan(order.indexOf("general-circle"));
    }
    // Land Team (new) sits inside Leadership Circle (old), so Leadership stays.
    expect(order).not.toContain("leadership-circle");
    // Never the new chart's circles, a dormant one or an example.
    for (const id of ["regenerative-business", "community-anchor", "land-team", "old-dormant", "example-circle"]) expect(order).not.toContain(id);
    // The draft rests seats first and then circles in that same order.
    const changes = retireChanges(p.retire, "steward-1", "draft-1");
    const firstCircle = changes.findIndex((c) => c.op === "rest_circle");
    expect(changes.slice(0, firstCircle).every((c) => c.op === "rest_seat")).toBe(true);
    expect(changes.slice(firstCircle).map((c) => c.orgRoleId)).toEqual(order.map((id) => `circle:${id}`));
    expect(changes[0].payload).toEqual({ chosenBy: "steward-1", retiring: "old-chart", carriedAfter: "draft-1" });
  });
});
