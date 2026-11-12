/**
 * The hearth's choices, as data: where the stones sit and what they carry,
 * which evening is "the next meeting", what the Seed fills to, which work is
 * this circle's and which plant it is, and which circles the threads reach.
 */
import { describe, expect, it } from "vitest";
import type { RoleRowOut } from "@shared/circleCard";
import {
  HEARTH_CENTRE,
  LINKS_MAX,
  SEED_CIRCLES,
  STONE_RING,
  STONES_MAX,
  TEND_MAX,
  initialOf,
  linkedCircles,
  nextGathering,
  plantOf,
  seedFill,
  stonesOf,
  tendOf,
  threadsOf,
  type CalendarItemIn,
} from "./hearthModel";

const role = (id: string, name: string, filled: boolean): RoleRowOut => ({
  id,
  name,
  href: `/roles?seat=${id}`,
  stateWords: filled ? "Filled" : "Open",
  filled,
  holderCards: filled ? [{ href: `/profile/ana#role-${id}`, label: "See their card", ariaLabel: `See the card of who holds ${name}` }] : [],
  holderLine: null,
  applyHref: filled ? null : `/propose?seat=${id}`,
  applyLabel: "Apply for this role",
});

describe("the stones", () => {
  it("sit evenly on the ring from the top, clockwise, in the card's order", () => {
    const s = stonesOf([role("a", "Water Keeper", true), role("b", "Seed Keeper", false), role("c", "Bread", true), role("d", "Fire", false)]);
    expect(s.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    expect(s.map((x) => x.angle)).toEqual([0, 90, 180, 270]);
    expect(s[0]!.x).toBeCloseTo(HEARTH_CENTRE);
    expect(s[0]!.y).toBeCloseTo(HEARTH_CENTRE - STONE_RING);
    expect(s[1]!.x).toBeCloseTo(HEARTH_CENTRE + STONE_RING);
    for (const x of s) expect(Math.hypot(x.x - HEARTH_CENTRE, x.y - HEARTH_CENTRE)).toBeCloseTo(STONE_RING);
  });

  it("carry the ROLE's letter and whether it is held, never a person", () => {
    const s = stonesOf([role("a", "water keeper", true), role("b", "  Ñandú", false)]);
    expect(s.map((x) => [x.initial, x.held])).toEqual([["W", true], ["Ñ", false]]);
    expect(JSON.stringify(s)).not.toContain("ana");
    expect(initialOf("")).toBe("·");
  });

  it("draw at most twelve, and grow smaller as more share the ring", () => {
    const many = Array.from({ length: 15 }, (_, i) => role(`r${i}`, `Role ${i}`, i % 2 === 0));
    expect(stonesOf(many)).toHaveLength(STONES_MAX);
    expect(stonesOf(many.slice(0, 4))[0]!.r).toBeGreaterThan(stonesOf(many)[0]!.r);
    expect(stonesOf([])).toEqual([]);
  });
});

const ev = (over: Partial<CalendarItemIn>): CalendarItemIn => ({
  id: "ev-sessions-1",
  startsAt: "2026-11-20T00:00:00.000Z",
  endsAt: "2026-11-20T01:00:00.000Z",
  status: "scheduled",
  sourceModule: "sessions",
  sourceId: "c-garden",
  occurrenceKey: "2026-11-19",
  goingCount: 3,
  myRsvp: null,
  seatPrice: 0,
  spotsLeft: null,
  ...over,
});
const NOW = new Date("2026-11-12T12:00:00Z");

describe("the next gathering", () => {
  it("is the earliest evening still to come of THIS circle's mirrored rhythm", () => {
    const items = [
      ev({ startsAt: "2026-11-27T00:00:00.000Z", endsAt: "2026-11-27T01:00:00.000Z", occurrenceKey: "2026-11-26", goingCount: 1 }),
      ev({}),
      ev({ startsAt: "2026-11-05T00:00:00.000Z", endsAt: "2026-11-05T01:00:00.000Z", occurrenceKey: "2026-11-04" }),
      ev({ id: "ev-other", sourceId: "c-kitchen", startsAt: "2026-11-13T00:00:00.000Z", endsAt: "2026-11-13T01:00:00.000Z" }),
      ev({ id: "ev-hand", sourceModule: null, sourceId: null, startsAt: "2026-11-13T00:00:00.000Z" }),
    ];
    expect(nextGathering(items, "c-garden", NOW)).toEqual({
      eventId: "ev-sessions-1",
      occurrenceKey: "2026-11-19",
      startsAt: "2026-11-20T00:00:00.000Z",
      going: 3,
      mine: false,
      answerHere: true,
    });
  });

  it("skips a cancelled evening and reads this reader's own going", () => {
    const items = [ev({ status: "cancelled" }), ev({ startsAt: "2026-11-27T00:00:00.000Z", endsAt: null, occurrenceKey: "2026-11-26", myRsvp: "going" })];
    expect(nextGathering(items, "c-garden", NOW)).toMatchObject({ occurrenceKey: "2026-11-26", mine: true });
  });

  it("leaves a priced or full gathering to the calendar, where its terms are shown", () => {
    expect(nextGathering([ev({ seatPrice: 5 })], "c-garden", NOW)!.answerHere).toBe(false);
    expect(nextGathering([ev({ spotsLeft: 0 })], "c-garden", NOW)!.answerHere).toBe(false);
    expect(nextGathering([ev({ spotsLeft: 0, myRsvp: "going" })], "c-garden", NOW)!.answerHere).toBe(true);
  });

  it("is null with no meeting of this circle on the calendar", () => {
    expect(nextGathering([ev({ sourceId: "c-kitchen" })], "c-garden", NOW)).toBeNull();
    expect(nextGathering([], "c-garden", NOW)).toBeNull();
  });

  it("fills the seed one circle per person coming, seven at most", () => {
    expect([0, 1, 7, 12, -2].map(seedFill)).toEqual([0, 1, SEED_CIRCLES, SEED_CIRCLES, 0]);
  });
});

describe("what we tend", () => {
  const quests = [
    { id: "q1", title: "Mulch the beds", circle: "Garden circle", status: "Open", order: 2 },
    { id: "q2", title: "Seed library", circle: "c-garden", status: "active", order: 1 },
    { id: "q3", title: "Closed one", circle: "Garden circle", status: "closed", order: 0 },
    { id: "q4", title: "Kitchen work", circle: "Kitchen", status: "open", order: 0 },
    { id: "q5", title: "Example", circle: "Garden circle", status: "open", order: 0, isExample: true },
  ];
  const field = { q1: { active: 0, done: 2 }, q2: { active: 1, done: 0 } };

  it("is this circle's open work, by id or name, in the board's order, each with its plant", () => {
    const { rows, more } = tendOf(quests, field, { id: "c-garden", name: "Garden Circle" });
    expect(rows.map((r) => [r.id, r.plant])).toEqual([
      ["q2", "bud"],
      ["q1", "flower"],
    ]);
    expect(rows[0]!.href).toBe("/quests/q2");
    expect(more).toBe(0);
  });

  it("keeps example work with an example circle and real work with a real one", () => {
    expect(tendOf(quests, field, { id: "c-garden", name: "Garden circle", isExample: true }).rows.map((r) => r.id)).toEqual(["q5"]);
  });

  it("reads the plant off the work, never off who did it", () => {
    expect(plantOf(undefined)).toBe("seed");
    expect(plantOf({ active: 0, done: 0 })).toBe("seed");
    expect(plantOf({ active: 2, done: 5 })).toBe("bud");
    expect(plantOf({ active: 0, done: 1 })).toBe("flower");
  });

  it("shows six and says how many more wait on the board", () => {
    const lots = Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, title: `Work ${i}`, circle: "c-garden", status: "open" }));
    const out = tendOf(lots, {}, { id: "c-garden", name: "Garden" });
    expect(out.rows).toHaveLength(TEND_MAX);
    expect(out.more).toBe(3);
  });
});

describe("the threads", () => {
  const all = [
    { id: "c-garden", name: "Garden" },
    { id: "c-zinnia", name: "Zinnias", parentCircleId: "c-garden" },
    { id: "c-herbs", name: "Herbs", parentCircleId: "c-garden" },
    { id: "c-root", name: "Coordinating", parentCircleId: null },
    { id: "c-else", name: "Elsewhere", parentCircleId: "c-root" },
  ];

  it("reach the circle we sit in first, then the circles in ours by name, never ourselves or twice", () => {
    const links = linkedCircles("c-garden", { name: "Coordinating", href: "/circles/c-root" }, "c-root", all);
    expect(links.map((l) => [l.id, l.how])).toEqual([
      ["c-root", "parent"],
      ["c-herbs", "child"],
      ["c-zinnia", "child"],
    ]);
    expect(links[1]!.href).toBe("/circles/c-herbs");
  });

  it("are held to six", () => {
    const kids = Array.from({ length: 9 }, (_, i) => ({ id: `k${i}`, name: `Kid ${i}`, parentCircleId: "c-garden" }));
    expect(linkedCircles("c-garden", null, null, kids)).toHaveLength(LINKS_MAX);
  });

  it("draw the same threads every time, hanging past the stones", () => {
    const links = linkedCircles("c-garden", null, null, all);
    const a = threadsOf(links, 5);
    expect(threadsOf(links, 5)).toEqual(a);
    for (const t of a) {
      expect(Math.hypot(t.end.x - HEARTH_CENTRE, t.end.y - HEARTH_CENTRE)).toBeGreaterThan(STONE_RING);
      expect(t.path.startsWith("M")).toBe(true);
      // A name is centred and held far enough inside the field that it is never cut at its edge.
      expect(t.anchor).toBe("middle");
      expect(t.label.x).toBeGreaterThanOrEqual(56);
      expect(t.label.x).toBeLessThanOrEqual(400 - 56);
    }
    expect(threadsOf([], 5)).toEqual([]);
  });
});
