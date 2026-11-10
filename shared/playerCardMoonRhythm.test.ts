/**
 * THE MOON RHYTHM ON THE PLAYER CARD'S MOON CYCLE (guide v2, Rye 10 Nov 2026):
 * the new moon circle, the full moon check-in, "Carry on into the next moon?"
 * in the last week, and End of Moon on the end-of-moon review's own day
 * (shared/moonRhythm.ts walkthroughDay, per-moon overrides included).
 */
import { describe, expect, it } from "vitest";
import { buildPlayerCard } from "./playerCard";
import { CARD_WORDS as W } from "./playerCardWords";
import { LUNAR_CLOCK } from "./cycleClock";
import { EMPTY_RHYTHM, type RhythmDoc } from "./moonRhythm";

const input = (rhythm?: RhythmDoc) =>
  ({
    now: new Date("2026-11-20T12:00:00Z"),
    timeZone: "UTC",
    owner: { userId: "u1", displayName: "Ivy Lane", avatar: null },
    viewerUserId: "u1",
    villageName: "Test Village",
    season: { id: "s1", name: "Season of Foundations", startsOn: "2026-10-10", endsOn: "2026-12-31" },
    roles: [],
    ...(rhythm ? { moonRhythm: { rhythm } } : {}),
  }) as any;
const markers = (card: any) => card.timeline.moons.flatMap((m: any) => m.markers);

describe("the moon cycle carries the rhythm while the end-of-moon review is on", () => {
  it("names the new moon circle, the full moon check-in, the carry-on week and End of Moon", () => {
    const all = markers(buildPlayerCard(input(EMPTY_RHYTHM)));
    expect(new Set(all.map((m: any) => m.kind))).toEqual(new Set(["new-moon", "full-moon", "carry-on", "end-of-moon"]));
    expect(all.find((m: any) => m.kind === "new-moon").words).toContain(W.newMoonCircle);
    expect(all.find((m: any) => m.kind === "full-moon").words).toBe(W.fullMoonCheckIn);
    expect(all.find((m: any) => m.kind === "carry-on").words).toBe(W.carryOn);
    // The November moon ends at the 9 December new moon: its End of Moon is Friday 4 December.
    const eom = all.filter((m: any) => m.kind === "end-of-moon").map((m: any) => m.at);
    expect(eom).toContain("2026-12-04T00:00:00.000Z");
    expect(all.find((m: any) => m.kind === "end-of-moon").words).toBe(W.endOfMoon);
  });

  it("follows the review's own override for a moon, so the card and the review never name two days", () => {
    const nov = LUNAR_CLOCK.boundsFor(new Date("2026-11-20T12:00:00Z"));
    const moved: RhythmDoc = { ...EMPTY_RHYTHM, cycles: { [nov.id]: { walkthrough: "2026-12-07", circle: "2026-12-07" } } };
    const eom = markers(buildPlayerCard(input(moved))).filter((m: any) => m.kind === "end-of-moon").map((m: any) => m.at);
    expect(eom).toContain("2026-12-07T00:00:00.000Z");
    expect(eom).not.toContain("2026-12-04T00:00:00.000Z");
  });

  it("draws the moon cycle as before when the review is off", () => {
    const plain = markers(buildPlayerCard(input()));
    expect(plain.some((m: any) => m.kind === "carry-on" || m.kind === "end-of-moon")).toBe(false);
    expect(plain.find((m: any) => m.kind === "new-moon").words).toContain(W.tasksAgreed);
    expect(plain.find((m: any) => m.kind === "full-moon").words).toBe(W.fullMoon);
  });
});
