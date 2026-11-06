import { describe, expect, it } from "vitest";
import { ARC_END, ARC_MAX_SEGMENTS, ARC_START, arcCounts, capacityArc, type ArcRole } from "./capacityArc";

const role = (id: string, seats: number, holderCount: number, state?: string): ArcRole => ({ id, seats, holderCount, state });

describe("capacityArc", () => {
  it("draws no arc for a circle with no roles", () => {
    expect(capacityArc([], 60)).toEqual([]);
  });

  it("shows one held and three open for a circle with one of four held", () => {
    const segs = capacityArc([role("a", 1, 1), role("b", 1, 0), role("c", 1, 0), role("d", 1, 0)], 60);
    expect(segs.map((s) => s.kind)).toEqual(["held", "open", "open", "open"]);
  });

  it("splits a role that holds several people into one segment per opening", () => {
    const segs = capacityArc([role("team", 3, 1, "partial")], 60);
    expect(segs.map((s) => s.kind)).toEqual(["held", "open", "open"]);
    expect(segs.every((s) => s.roleId === "team")).toBe(true);
  });

  it("fills from the start of the arc whatever order the roles arrive in", () => {
    const segs = capacityArc([role("a", 1, 0), role("b", 1, 1), role("c", 1, 0, "forming"), role("d", 1, 1, "expired")], 60);
    expect(segs.map((s) => s.kind)).toEqual(["held", "expired", "open", "forming"]);
    expect(segs.map((s) => s.roleId)).toEqual(["b", "d", "a", "c"]);
  });

  it("keeps the top 80 degrees clear and the segments in order without touching", () => {
    for (let n = 1; n <= 12; n++) {
      const segs = capacityArc(Array.from({ length: n }, (_, i) => role(`r${i}`, 1, i % 2)), 50);
      expect(segs[0].a0).toBeGreaterThanOrEqual(ARC_START);
      expect(segs[segs.length - 1].a1).toBeLessThanOrEqual(ARC_END);
      segs.forEach((s, i) => {
        expect(s.a1, `${n}:${i}`).toBeGreaterThan(s.a0);
        if (i) expect(s.a0, `${n}:${i}`).toBeGreaterThan(segs[i - 1].a1);
      });
    }
  });

  it("counts a missing or zero capacity as one opening", () => {
    expect(capacityArc([{ id: "x" }, { id: "y", seats: 0, holderCount: 0 }], 40)).toHaveLength(2);
  });

  it("never counts more held than the role has room for", () => {
    expect(capacityArc([role("x", 2, 5)], 40).map((s) => s.kind)).toEqual(["held", "held"]);
  });

  it("merges runs of one kind once a circle has too many openings to read one by one", () => {
    const many = Array.from({ length: ARC_MAX_SEGMENTS + 6 }, (_, i) => role(`r${i}`, 1, i < 10 ? 1 : 0));
    const segs = capacityArc(many, 120);
    expect(segs.map((s) => [s.kind, s.count])).toEqual([["held", 10], ["open", ARC_MAX_SEGMENTS - 4]]);
  });

  it("is deterministic", () => {
    const roles = [role("a", 2, 1), role("b", 1, 0, "forming")];
    expect(capacityArc(roles, 70)).toEqual(capacityArc(roles, 70));
  });
});

describe("arcCounts", () => {
  it("counts what the arc draws: held includes a lapsed holder, open leaves out what is forming", () => {
    expect(arcCounts([role("a", 1, 1), role("b", 2, 0), role("c", 1, 1, "expired"), role("d", 1, 0, "forming")])).toEqual({
      held: 2,
      places: 5,
      open: 2,
    });
  });
});
