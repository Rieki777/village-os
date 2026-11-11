/**
 * Pins the lunar algorithm to known values so it can never silently drift from
 * regen-civics. Both products key distribution records on cycleNumber; if a
 * constant here changes, cycle 328 stops meaning the same lunation in both
 * codebases and every historical record misaligns. These tests are the tripwire.
 */
import { describe, expect, it } from "vitest";
import {
  REFERENCE_NEW_MOON_MS,
  SYNODIC_MONTH_DAYS,
  SYNODIC_MONTH_MS,
  cycleBoundsFor,
  cycleBoundsByNumber,
  daysRemainingInCycle,
  moonPhase,
  moonPhaseName,
} from "./lunar";
import { cycleIdFor, formatCycleId, parseCycleId, settleCycle, dueCycles } from "../server/lib/gratitude-cycles";

describe("lunar constants, pinned to regen-civics", () => {
  it("uses the Meeus reference new moon and mean synodic month", () => {
    expect(REFERENCE_NEW_MOON_MS).toBe(Date.UTC(2000, 0, 6, 18, 14, 0));
    expect(SYNODIC_MONTH_DAYS).toBe(29.53058867);
  });

  it("computes cycle 328 for 2026-07-26, the pinned cross-product check", () => {
    // Computed once from the shared constants and pinned as a literal. If this
    // fails, the algorithm diverged from regen-civics. Do not update the number
    // to make the test pass; find out what changed.
    const b = cycleBoundsFor(new Date("2026-07-26T00:00:00Z"));
    expect(b.cycleNumber).toBe(328);
    expect(b.startsAt.toISOString()).toBe("2026-07-14T19:01:38.436Z");
    expect(b.endsAt.toISOString()).toBe("2026-08-13T07:45:41.297Z");
  });

  it("has monotonic, gap-free cycle bounds", () => {
    const a = cycleBoundsByNumber(328);
    const b = cycleBoundsByNumber(329);
    expect(a.endsAt.getTime()).toBe(b.startsAt.getTime());
    // Date stores whole milliseconds, so the length may differ from the real
    // constant by up to 1ms of truncation.
    expect(Math.abs(a.endsAt.getTime() - a.startsAt.getTime() - SYNODIC_MONTH_MS)).toBeLessThan(1);
  });

  it("reports a new moon at the reference epoch", () => {
    expect(moonPhase(new Date(REFERENCE_NEW_MOON_MS))).toBe(0);
    expect(moonPhaseName(0)).toBe("New moon");
    expect(moonPhaseName(0.5)).toBe("Full moon");
  });

  it("counts days remaining, never negative", () => {
    const justBeforeEnd = new Date(cycleBoundsByNumber(328).endsAt.getTime() - 60_000);
    expect(daysRemainingInCycle(justBeforeEnd)).toBe(1);
  });
});

describe("cycle ids", () => {
  it("formats sortable lunar ids and round-trips them", () => {
    expect(formatCycleId(328)).toBe("lunar-000328");
    expect(parseCycleId("lunar-000328")).toBe(328);
    expect(cycleIdFor(new Date("2026-07-26T00:00:00Z"))).toBe("lunar-000328");
  });

  it("never matches legacy calendar-month ids", () => {
    expect(parseCycleId("2026-07")).toBeNull();
  });
});

describe("settleCycle", () => {
  const entry = (from: string, to: string, amount: number, cycleId = "lunar-000327") => ({
    id: `g-${from}-${to}-${amount}`,
    fromId: from,
    toId: to,
    amount,
    cycleId,
  });

  it("totals per recipient and counts distinct senders", () => {
    const rows = settleCycle(
      [entry("a", "b", 5), entry("a", "b", 3), entry("c", "b", 2), entry("b", "a", 7)],
      "lunar-000327",
    );
    expect(rows).toEqual([
      // S27 added the channel split; kind-less legacy entries count as acks.
      // `receivedEligible` equals `received` here because no eligibility set
      // was passed — ungated, every amount counts toward the pool.
      { userId: "b", received: 10, receivedEligible: 10, receivedHearts: 0, receivedAcks: 10, distinctSenders: 2 },
      { userId: "a", received: 7, receivedEligible: 7, receivedHearts: 0, receivedAcks: 7, distinctSenders: 1 },
    ]);
  });

  it("leaves out entries that belong to another lunation", () => {
    const rows = settleCycle([entry("a", "b", 4, "lunar-000326")], "lunar-000327");
    expect(rows).toEqual([]);
  });

  /*
   * THIS TEST USED TO ASSERT THE DEFECT.
   *
   * It read "ignores entries from other cycles, including legacy month ids"
   * and passed a `2026-07` row alongside a `lunar-000326` one, expecting both
   * to be silently absent from the totals. The two are not the same thing. A
   * `lunar-000326` row belongs to a lunation this is not settling, which the
   * test above still checks. A `2026-07` row belongs to a lunation nobody
   * knows, and dropping it is how a real settlement lost 30 of 130 units with
   * every total under them quietly wrong and no surface saying so.
   *
   * The test and the product agreed on something untrue, and the suite stayed
   * green for it.
   */
  it("refuses an id it cannot read, out loud", () => {
    expect(() => settleCycle([entry("a", "b", 5, "2026-07")], "lunar-000327")).toThrow(/2026-07/);
  });
});

describe("dueCycles", () => {
  it("finds finished lunations with activity, oldest first, and skips closed ones", () => {
    const now = new Date("2026-07-26T00:00:00Z"); // inside cycle 328
    const entries = [
      { id: "g1", fromId: "a", toId: "b", amount: 1, cycleId: "lunar-000326" },
      { id: "g2", fromId: "a", toId: "b", amount: 1, cycleId: "lunar-000327" },
      { id: "g3", fromId: "a", toId: "b", amount: 1, cycleId: "lunar-000328" }, // current: not due
    ];
    const due = dueCycles([], entries, now);
    expect(due.map((c) => c.cycleNumber)).toEqual([326, 327]);

    const afterClosing326 = dueCycles(
      [{ id: "lunar-000326", cycleNumber: 326, startsAt: "", endsAt: "", status: "closed" }],
      entries,
      now,
    );
    expect(afterClosing326.map((c) => c.cycleNumber)).toEqual([327]);
  });
});

/*
 * ── Round 4, lane L5a: the true clock, and the past it must not move ────────
 *
 * Everything above this line is the pre-existing tripwire and stays byte for
 * byte as it was. The blocks below measure the two harm metrics of the
 * true-clock change: (1) the table's new-moon dates in the village zone match
 * a fixture taken from astronomy-engine directly, and (2) every cycle below
 * TRUE_CLOCK_FROM_CYCLE is bit-identical to the mean formula, while the
 * boundaries above it move by no more than the measured drift.
 */
import {
  LUNAR_TABLE_YEARS,
  TRUE_CLOCK_FROM_CYCLE,
  civilDateKey,
  cycleNumberOfInstant,
  cycleStartMs,
  fullMoonsBetween,
  lunarPositionFor,
  lunarYearOf,
  meanCycleStartMs,
  newMoonsBetween,
  seasonInstants,
  trueLunationFor,
} from "./lunar";

/**
 * Harm metric 1. New-moon dates 2026 to 2028 in America/Costa_Rica, computed
 * with astronomy-engine's SearchMoonQuarter/NextMoonQuarter (the seed script
 * round4/moons-2025-2028.mjs, zone swapped for the village's) and pasted
 * here as a literal. If the table ever disagrees with this list, the sky
 * moved or the generator did; either way, find out which before touching it.
 */
const COSTA_RICA_NEW_MOONS_2026_2028 = [
  "2026-01-18", "2026-02-17", "2026-03-18", "2026-04-17", "2026-05-16", "2026-06-14",
  "2026-07-14", "2026-08-12", "2026-09-10", "2026-10-10", "2026-11-09", "2026-12-08",
  "2027-01-07", "2027-02-06", "2027-03-08", "2027-04-06", "2027-05-06", "2027-06-04",
  "2027-07-03", "2027-08-02", "2027-08-31", "2027-09-29", "2027-10-29", "2027-11-27",
  "2027-12-27", "2028-01-26", "2028-02-25", "2028-03-25", "2028-04-24", "2028-05-24",
  "2028-06-22", "2028-07-21", "2028-08-20", "2028-09-18", "2028-10-17", "2028-11-16",
  "2028-12-15",
];

describe("the true lunar table", () => {
  it("covers 2020 to 2050 and gives the fixture's new-moon dates in village time (harm metric 1)", () => {
    expect(LUNAR_TABLE_YEARS).toEqual({ from: 2020, to: 2050 });
    const moons = newMoonsBetween(new Date("2026-01-01T00:00:00Z"), new Date("2029-01-01T00:00:00Z"));
    const dates = moons.map((d) => civilDateKey(d, "America/Costa_Rica"));
    expect(dates).toEqual(COSTA_RICA_NEW_MOONS_2026_2028);
  });

  it("maps every table instant to one cycle number, unique and consecutive", () => {
    const all = newMoonsBetween(new Date("2019-01-01T00:00:00Z"), new Date("2052-01-01T00:00:00Z"));
    expect(all.length).toBeGreaterThan(370);
    const ks = all.map((d) => cycleNumberOfInstant(d.getTime()));
    for (let i = 1; i < ks.length; i++) expect(ks[i]).toBe(ks[i - 1] + 1);
    expect(new Set(ks).size).toBe(ks.length);
  });

  it("knows the seasons and the full moons", () => {
    const s = seasonInstants(2026)!;
    // astronomy-engine, UTC: mar 2026-03-20T14:45Z, dec 2026-12-21T20:50Z.
    // The table is rounded to the minute, so 14:45:36 reads 14:46.
    expect(s.marEquinox.toISOString().slice(0, 16)).toBe("2026-03-20T14:46");
    expect(s.decSolstice.toISOString().slice(0, 16)).toBe("2026-12-21T20:50");
    expect(seasonInstants(1999)).toBeNull();
    // 2026 holds thirteen full moons and twelve new moons (research memo).
    expect(fullMoonsBetween(new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z")).length).toBe(13);
    expect(newMoonsBetween(new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z")).length).toBe(12);
  });
});

describe("the past is frozen (harm metric 2)", () => {
  it("names the switch cycle as the open cycle at merge plus one", () => {
    // 2026-08-16 sat inside cycle 329.
    expect(cycleBoundsFor(new Date("2026-08-16T00:00:00Z")).cycleNumber).toBe(329);
    expect(TRUE_CLOCK_FROM_CYCLE).toBe(330);
  });

  it("keeps every cycle start below the switch bit-identical to the mean formula", () => {
    // From the table's first cycle up to the switch: exactly the mean instant.
    const first = cycleNumberOfInstant(newMoonsBetween(new Date("2019-12-01T00:00:00Z"), new Date("2020-02-01T00:00:00Z"))[0].getTime());
    for (let k = first; k < TRUE_CLOCK_FROM_CYCLE; k++) {
      expect(cycleStartMs(k)).toBe(meanCycleStartMs(k));
      // The literal formula this file always used, Date truncation included.
      expect(cycleBoundsByNumber(k).startsAt.getTime()).toBe(
        new Date(REFERENCE_NEW_MOON_MS + k * SYNODIC_MONTH_MS).getTime(),
      );
      expect(cycleBoundsFor(new Date(REFERENCE_NEW_MOON_MS + (k + 0.5) * SYNODIC_MONTH_MS)).cycleNumber).toBe(k);
    }
    // And below the table entirely, still the mean.
    expect(cycleStartMs(0)).toBe(REFERENCE_NEW_MOON_MS);
    expect(cycleBoundsByNumber(100).endsAt.getTime()).toBe(new Date(meanCycleStartMs(101)).getTime());
  });

  it("moves no boundary above the switch by more than the measured drift", () => {
    // The mean formula's header claimed 14 hours; the table measures 17.6 h at
    // most (cycle 442, 2035-10-01). Every boundary from the switch to the end
    // of the table stays inside 18 h of where the mean formula put it.
    const last = cycleNumberOfInstant(newMoonsBetween(new Date("2050-11-01T00:00:00Z"), new Date("2051-02-01T00:00:00Z")).slice(-1)[0].getTime());
    let maxHours = 0;
    for (let k = TRUE_CLOCK_FROM_CYCLE; k <= last; k++) {
      const drift = Math.abs(cycleStartMs(k) - meanCycleStartMs(k)) / 3_600_000;
      maxHours = Math.max(maxHours, drift);
      expect(drift).toBeLessThan(18);
    }
    expect(maxHours).toBeGreaterThan(1); // the true clock is doing something
    // The switch cycle itself begins at the true new moon of 2026-09-11 03:27Z.
    expect(cycleBoundsByNumber(TRUE_CLOCK_FROM_CYCLE).startsAt.toISOString().slice(0, 16)).toBe("2026-09-11T03:27");
  });

  it("stays monotone and gap-free across the switch", () => {
    for (let k = TRUE_CLOCK_FROM_CYCLE - 3; k < TRUE_CLOCK_FROM_CYCLE + 3; k++) {
      const a = cycleBoundsByNumber(k);
      const b = cycleBoundsByNumber(k + 1);
      expect(a.endsAt.getTime()).toBe(b.startsAt.getTime());
      expect(a.endsAt.getTime()).toBeGreaterThan(a.startsAt.getTime());
      // Whichever side of the switch, cycleBoundsFor agrees with ByNumber.
      const mid = new Date((a.startsAt.getTime() + a.endsAt.getTime()) / 2);
      expect(cycleBoundsFor(mid).cycleNumber).toBe(k);
      // One ms inside either edge: a mean boundary is a fractional ms that
      // Date truncates, so the exact truncated instant belongs to k - 1,
      // as it always did.
      expect(cycleBoundsFor(new Date(a.startsAt.getTime() + 1)).cycleNumber).toBe(k);
      expect(cycleBoundsFor(new Date(a.endsAt.getTime() - 1)).cycleNumber).toBe(k);
    }
  });

  it("reads the phase from the true lunation inside the table", () => {
    // 2026-09-11T03:27Z is a true new moon: phase 0 there, and about half a
    // lunation later the full moon of 2026-09-26.
    expect(moonPhase(new Date("2026-09-11T03:27:00Z"))).toBeLessThan(0.001);
    expect(moonPhaseName(moonPhase(new Date("2026-09-26T16:00:00Z")))).toBe("Full moon");
    const l = trueLunationFor(new Date("2026-08-16T00:00:00Z"));
    expect(l.cycleNumber).toBe(329);
    expect(l.startsAt.toISOString().slice(0, 10)).toBe("2026-08-12");
  });
});

describe("lunar months anchored to a solar event", () => {
  it("counts twelve or thirteen moons per lunar year as the sky gives", () => {
    // Solstice years, from the research memo: 2024->2025 13, 2025->2026 12,
    // 2026->2027 12, 2027->2028 13.
    expect(lunarYearOf(2024, "december_solstice")!.months.length).toBe(13);
    expect(lunarYearOf(2025, "december_solstice")!.months.length).toBe(12);
    expect(lunarYearOf(2026, "december_solstice")!.months.length).toBe(12);
    expect(lunarYearOf(2027, "december_solstice")!.months.length).toBe(13);
    // Month 1 begins at the first new moon AFTER the anchor.
    const y = lunarYearOf(2025, "december_solstice")!;
    expect(y.months[0].startsAt.getTime()).toBeGreaterThan(y.anchorAt.getTime());
    expect(y.months[0].startsAt.toISOString().slice(0, 10)).toBe("2026-01-18");
  });

  it("places a date in its lunar month, day and length in the village zone", () => {
    const p = lunarPositionFor(new Date("2026-08-16T12:00:00Z"), "december_solstice", "America/Costa_Rica")!;
    // New moon 2026-08-12 (village date), so the 16th is day 5.
    expect(p.month.index).toBe(8);
    expect(p.day).toBe(5);
    expect(p.length === 29 || p.length === 30).toBe(true);
    expect(p.monthCount).toBe(12);
    // A March-equinox village counts from a different month 1.
    const q = lunarPositionFor(new Date("2026-08-16T12:00:00Z"), "march_equinox", "America/Costa_Rica")!;
    expect(q.month.index).toBe(5);
  });
});

describe("daysOfSpan", () => {
  it("counts both end days in the village's zone: 21 June to 31 December is 194", async () => {
    const { daysOfSpan, zonedTimeToUtc } = await import("./lunar");
    const tz = "America/Costa_Rica";
    const r = daysOfSpan(zonedTimeToUtc(2026, 6, 21, 0, 0, tz), zonedTimeToUtc(2026, 12, 31, 0, 0, tz), zonedTimeToUtc(2026, 6, 21, 12, 0, tz), tz);
    expect(r).toEqual({ day: 1, of: 194 });
  });
});
