import { describe, expect, it } from "vitest";
import { bridgedHoldings, effectiveHoldings, isBridged, SeatGrantCache, type SeatGrantSnapshot } from "./seatGrants";
import type { LapseContext, OrgAssignment } from "./orgChart";
import { liveHolderCount, liveHoldersOfCapability } from "./roleGrants";
import { adminGroupsOf } from "./groupAdmin";
import { holdingHasLapsed } from "./stewardship";

const NOW = new Date("2026-11-05T12:00:00Z");
const ctx: LapseContext = { currentSeasonId: "s2", cadence: "season_turn", now: NOW };

function seating(over: Partial<OrgAssignment> = {}): OrgAssignment {
  return {
    id: "a1",
    orgRoleId: "ops-lead",
    holderKind: "member",
    userId: "rye",
    displayName: null,
    holderKey: "rye",
    focus: null,
    note: null,
    seasonId: "s2",
    termEndsAt: null,
    startedAt: new Date("2026-10-01T00:00:00Z"),
    endedAt: null,
    endedReason: null,
    isExample: false,
    isAgent: false,
    ...over,
  };
}

function snap(over: Partial<SeatGrantSnapshot> = {}): SeatGrantSnapshot {
  return {
    links: [{ orgRoleId: "ops-lead", roleId: "structure" }],
    seatings: [seating()],
    seats: new Map([["ops-lead", { id: "ops-lead", active: true, isExample: false, expiresEachSeason: null }]]),
    formerUserIds: new Set(),
    ...over,
  };
}

const groups = [
  { id: "structure", name: "Structure", capabilities: ["org.seat", "org.decide"], grantsAdmin: false },
  { id: "panel", name: "Panel", capabilities: [], grantsAdmin: true },
];

describe("bridgedHoldings: holding a seat grants its linked groups", () => {
  it("a live member seating on a linked seat holds the group, and says which seat", () => {
    const out = bridgedHoldings(snap(), ctx);
    expect(out).toEqual([
      expect.objectContaining({ roleId: "structure", userId: "rye", viaOrgRoleId: "ops-lead", termEndsAt: null }),
    ]);
    expect(isBridged(out[0])).toBe(true);
  });

  it("control: with no links nothing is granted, whoever is seated", () => {
    expect(bridgedHoldings(snap({ links: [] }), ctx)).toEqual([]);
  });

  it("an unlinked seat grants nothing", () => {
    expect(bridgedHoldings(snap({ seatings: [seating({ orgRoleId: "gardener" })] }), ctx)).toEqual([]);
  });

  it("one seat linked to two groups grants both", () => {
    const s = snap({ links: [{ orgRoleId: "ops-lead", roleId: "structure" }, { orgRoleId: "ops-lead", roleId: "panel" }] });
    expect(bridgedHoldings(s, ctx).map((h) => h.roleId).sort()).toEqual(["panel", "structure"]);
  });

  it.each([
    ["an ended seating", { endedAt: new Date("2026-11-01T00:00:00Z") }],
    ["a documented holder", { holderKind: "documented" as const, userId: null }],
    ["a seating with no account", { userId: null }],
    ["an agent (Q8)", { isAgent: true }],
    ["a standing example", { isExample: true }],
    ["a term that ran out (Q6)", { termEndsAt: new Date("2026-11-04T00:00:00Z") }],
    ["a seating from a season that has turned (Q6)", { seasonId: "s1" }],
  ])("%s grants nothing", (_label, over) => {
    expect(bridgedHoldings(snap({ seatings: [seating(over)] }), ctx)).toEqual([]);
  });

  it("an inactive or example seat grants nothing", () => {
    for (const facts of [{ active: false, isExample: false }, { active: true, isExample: true }]) {
      const seats = new Map([["ops-lead", { id: "ops-lead", expiresEachSeason: null, ...facts }]]);
      expect(bridgedHoldings(snap({ seats }), ctx)).toEqual([]);
    }
  });

  it("a seat that opts out of the season turn keeps granting across it", () => {
    const seats = new Map([["ops-lead", { id: "ops-lead", active: true, isExample: false, expiresEachSeason: false }]]);
    expect(bridgedHoldings(snap({ seats, seatings: [seating({ seasonId: "s1" })] }), ctx)).toHaveLength(1);
  });

  it("a former member is never empowered, even if a seating row was left behind", () => {
    expect(bridgedHoldings(snap({ formerUserIds: new Set(["rye"]) }), ctx)).toEqual([]);
  });

  it("a future term still grants, and carries the date so the gate's own lapse test agrees", () => {
    const out = bridgedHoldings(snap({ seatings: [seating({ termEndsAt: new Date("2027-01-01T00:00:00Z") })] }), ctx);
    expect(out[0].termEndsAt).toBe("2027-01-01T00:00:00.000Z");
    expect(holdingHasLapsed(out[0], NOW)).toBe(false);
  });
});

describe("effectiveHoldings: one answer for every reader", () => {
  const direct = [{ id: "h1", roleId: "structure", userId: "sam", grantedAt: "x" }];

  it("is the direct rows untouched when nothing is bridged", () => {
    expect(effectiveHoldings(direct, [])).toBe(direct);
  });

  it("adds a bridged holder, and the counters and admin access see them", () => {
    const all = effectiveHoldings(direct, bridgedHoldings(snap(), ctx));
    expect(liveHoldersOfCapability(all, groups, "org.seat", NOW)).toEqual(["rye", "sam"]);
    expect(liveHolderCount(all, "structure", NOW)).toBe(2);
    const s = snap({ links: [{ orgRoleId: "ops-lead", roleId: "panel" }] });
    expect(adminGroupsOf("rye", groups, effectiveHoldings(direct, bridgedHoldings(s, ctx)), NOW, holdingHasLapsed).map((g) => g.id)).toEqual(["panel"]);
  });

  it("control: without the bridge the same counters do not see the seated holder", () => {
    expect(liveHoldersOfCapability(direct, groups, "org.seat", NOW)).toEqual(["sam"]);
  });

  it("counts a person once when they hold the group directly and through a seat", () => {
    const both = [{ id: "h2", roleId: "structure", userId: "rye", grantedAt: "x" }];
    expect(liveHolderCount(effectiveHoldings(both, bridgedHoldings(snap(), ctx)), "structure", NOW)).toBe(1);
  });
});

describe("SeatGrantCache", () => {
  it("shares one read between concurrent refreshes and serves the result synchronously", async () => {
    let reads = 0;
    const cache = new SeatGrantCache(async () => {
      reads++;
      return snap();
    });
    expect(cache.snapshot().links).toEqual([]);
    await Promise.all([cache.refresh(), cache.refresh()]);
    expect(reads).toBe(1);
    expect(cache.snapshot().links).toHaveLength(1);
    await cache.ensureFresh();
    expect(reads).toBe(1);
  });

  it("keeps the last snapshot when a read fails", async () => {
    let fail = false;
    const cache = new SeatGrantCache(async () => {
      if (fail) throw new Error("db away");
      return snap();
    }, 0);
    await cache.refresh();
    fail = true;
    await cache.refresh();
    expect(cache.snapshot().links).toHaveLength(1);
  });
});
