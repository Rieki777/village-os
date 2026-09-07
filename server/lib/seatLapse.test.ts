/**
 * When a mandate runs out, on BOTH planes, and what each one does about it.
 *
 * THIS FILE USED TO PIN ONE RULE AND NOW PINS TWO, because the founder changed
 * one of them. It said "NOTHING IS REVOKED" as a statement about the product.
 * On 2026-08-31 he ruled: "No terms should definitely end when they end not
 * with a polite warning! If they're not voted back in then they expire when
 * they expire!" So the rule is now split by plane, and the split is the thing
 * worth pinning:
 *
 *  - ORG-CHART SEATS (`org_role_assignments`, `isLapsed` below) carry
 *    accountabilities and no permissions. There is nothing here to switch off,
 *    so a lapsed seating is still a seating and the seat reads `expired`
 *    instead of `filled`. Nothing was revoked because there was nothing to
 *    revoke, which is a narrower claim than the one this file used to make.
 *  - PERMISSION HOLDINGS (`role_holders.term_ends_at`, migration 0171,
 *    `holdingHasLapsed`) carry the capabilities the gate reads. A term that
 *    has passed takes the POWERS with it. That is the new rule, and the second
 *    half of this file is what pins it.
 *
 * Both are DERIVED on every read. A season turn writes nothing, so neither
 * state can drift from the calendar the way a stored status column does.
 */
import { describe, expect, it } from "vitest";
import { isLapsed, seatState, type LapseContext, type OrgRole } from "./orgChart";
import { holdingHasLapsed } from "./stewardship";

const NOW = new Date("2026-08-03T12:00:00Z");
const ctx = (over: Partial<LapseContext> = {}): LapseContext => ({
  currentSeasonId: "rooting-2026",
  cadence: "season_turn",
  now: NOW,
  ...over,
});

const seating = (
  over: Partial<{ termEndsAt: Date | null; seasonId: string | null; endedAt: Date | null; startedAt: Date | null }> = {},
) => ({
  termEndsAt: null,
  seasonId: "rooting-2026",
  endedAt: null,
  startedAt: null,
  ...over,
});

const role = (over: Partial<OrgRole> = {}): OrgRole => ({
  id: "seat", circleId: null, name: "Seat", aim: null, domain: null,
  accountabilities: [], whyItMatters: null, seats: 1, criticality: "normal",
  active: true, recruiting: false, expiresEachSeason: null,
  statusOverride: null, statusOverrideExpiresAt: null,
  icon: null, color: null, order: 0, isExample: false, archetypes: [],
  authority: null, firstYearOutcomes: null, first90DayOutcomes: null,
  locationExpectations: null, compensationReality: null, evidenceRequired: null,
  representsCircle: false, howChosen: null, howChosenGloss: null,
  ...over,
});

describe("when an org-chart mandate runs out", () => {
  it("lapses a term whose date has passed", () => {
    const v = isLapsed(seating({ termEndsAt: new Date("2026-07-01T00:00:00Z") }), role(), ctx());
    expect(v).toEqual({ lapsed: true, reason: "term" });
  });

  it("leaves a term that has not arrived alone", () => {
    const v = isLapsed(seating({ termEndsAt: new Date("2026-12-01T00:00:00Z") }), role(), ctx());
    expect(v.lapsed).toBe(false);
  });

  it("lapses a seating made in a season that has turned", () => {
    const v = isLapsed(seating({ seasonId: "foundations-2026" }), role(), ctx());
    expect(v).toEqual({ lapsed: true, reason: "season" });
  });

  it("honours a term even when the cadence says never", () => {
    // Somebody wrote a date down. A village-wide setting does not get to
    // quietly overrule a commitment made about one seat.
    const v = isLapsed(
      seating({ termEndsAt: new Date("2026-07-01T00:00:00Z") }),
      role(),
      ctx({ cadence: "never" }),
    );
    expect(v).toEqual({ lapsed: true, reason: "term" });
  });

  it("lets a seat opt out of the season turn on its own card", () => {
    // A treasurer or an entity steward carries across seasons; the whole
    // village turning over is not a reason to vacate the money seat.
    const v = isLapsed(seating({ seasonId: "foundations-2026" }), role({ expiresEachSeason: false }), ctx());
    expect(v.lapsed).toBe(false);
  });

  it("never lapses an already-ended seating", () => {
    const v = isLapsed(
      seating({ endedAt: new Date("2026-01-01T00:00:00Z"), seasonId: "foundations-2026" }),
      role(),
      ctx(),
    );
    expect(v.lapsed).toBe(false);
  });

  it("does not lapse anything when there is no season running", () => {
    // An open-ended founding season, or a village with no calendar yet.
    const v = isLapsed(seating({ seasonId: "foundations-2026" }), role(), ctx({ currentSeasonId: null }));
    expect(v.lapsed).toBe(false);
  });
});

describe("the annual cadence, which used to be dead", () => {
  /*
   * `org.reassignment_cadence` offers "Once a year" with the hint "One
   * reopening a year, whatever the seasons did", and `isLapsed` had no branch
   * for the value: it fell past every test to the final return, so a village
   * that chose annual got seats that reopened NEVER. The control said one
   * thing and the code did another. Fixed rather than deleted, because a
   * village with the value already stored would otherwise hold an unparseable
   * setting.
   */
  it("lapses a seating that has been held for a year", () => {
    const v = isLapsed(
      seating({ startedAt: new Date("2025-07-01T00:00:00Z") }),
      role(),
      ctx({ cadence: "annual" }),
    );
    expect(v).toEqual({ lapsed: true, reason: "season" });
  });

  it("leaves a seating younger than a year alone, even across a season turn", () => {
    const v = isLapsed(
      seating({ startedAt: new Date("2026-05-01T00:00:00Z"), seasonId: "foundations-2026" }),
      role(),
      ctx({ cadence: "annual" }),
    );
    expect(v.lapsed).toBe(false);
  });

  it("cannot lapse annually when the caller did not pass a start date", () => {
    // The fail-safe direction: an input with no "since when" cannot be aged.
    const v = isLapsed(seating(), role(), ctx({ cadence: "annual" }));
    expect(v.lapsed).toBe(false);
  });

  it("still honours a written term under the annual cadence", () => {
    const v = isLapsed(
      seating({ termEndsAt: new Date("2026-07-01T00:00:00Z"), startedAt: new Date("2026-06-01T00:00:00Z") }),
      role(),
      ctx({ cadence: "annual" }),
    );
    expect(v).toEqual({ lapsed: true, reason: "term" });
  });
});

describe("what a seat reads as", () => {
  it("reads expired when every holder has lapsed, and NOT filled", () => {
    // The bug this exists to stop: a seat whose holders all lapsed months ago
    // reading as comfortably filled, so nobody ever reviews it.
    expect(seatState(role({ seats: 1 }), [{ lapsed: true }])).toBe("expired");
    expect(seatState(role({ seats: 2 }), [{ lapsed: true }, { lapsed: true }])).toBe("expired");
  });

  it("reads partial when some holders are current and the seat wants more", () => {
    expect(seatState(role({ seats: 2 }), [{ lapsed: false }, { lapsed: true }])).toBe("partial");
  });

  it("reads filled when the current holders fill it", () => {
    expect(seatState(role({ seats: 2 }), [{ lapsed: false }, { lapsed: false }])).toBe("filled");
  });

  it("reads open when nobody holds it at all", () => {
    expect(seatState(role(), [])).toBe("open");
  });

  it("still accepts a plain count, treating every holder as current", () => {
    // The older call shape. It must keep meaning what it always meant.
    expect(seatState(role({ seats: 2 }), 2)).toBe("filled");
    expect(seatState(role({ seats: 2 }), 1)).toBe("partial");
    expect(seatState(role({ seats: 2 }), 0)).toBe("open");
  });

  it("lets an unexpired override win over everything, including a lapse", () => {
    const r = role({
      statusOverride: "filled",
      statusOverrideExpiresAt: new Date("2026-12-01T00:00:00Z"),
    });
    expect(seatState(r, [{ lapsed: true }], NOW)).toBe("filled");
  });

  it("stops honouring an override once it has expired", () => {
    const r = role({
      statusOverride: "filled",
      statusOverrideExpiresAt: new Date("2026-07-01T00:00:00Z"),
    });
    expect(seatState(r, [], NOW)).toBe("open");
  });
});

describe("the permission plane, where a term takes the powers with it", () => {
  /*
   * THE RULE THAT REPLACED "NOTHING IS REVOKED". A holding on `role_holders`
   * grants capabilities, and `roleCapabilitiesFor` in server/index.ts filters
   * on exactly this predicate, so a true answer here is a member who can no
   * longer do the thing. The e2e half of it lives in
   * server/stewardship.db.test.ts, which drives the real tables.
   */
  it("takes the powers when the term date has passed", () => {
    expect(holdingHasLapsed({ termEndsAt: new Date("2026-07-01T00:00:00Z") }, NOW)).toBe(true);
  });

  it("leaves a term that has not arrived alone", () => {
    expect(holdingHasLapsed({ termEndsAt: new Date("2026-12-01T00:00:00Z") }, NOW)).toBe(false);
  });

  it("never lapses a holding with no term, which is every holding written before 0171", () => {
    // The property that let the migration add the column to a live village
    // without taking one power away from anybody.
    expect(holdingHasLapsed({ termEndsAt: null }, NOW)).toBe(false);
    expect(holdingHasLapsed({}, NOW)).toBe(false);
  });

  it("reads a stored string as well as a Date, because the cache carries both", () => {
    expect(holdingHasLapsed({ termEndsAt: "2026-07-01T00:00:00.000Z" }, NOW)).toBe(true);
    expect(holdingHasLapsed({ termEndsAt: "2026-12-01T00:00:00.000Z" }, NOW)).toBe(false);
  });

  it("treats an unreadable date as no term rather than as an expired one", () => {
    // A value nobody can parse must never be the reason somebody loses a
    // power. Failing open here is the safe direction: the seat stays, and the
    // bad row is visible on the stewardship read.
    expect(holdingHasLapsed({ termEndsAt: "not a date" }, NOW)).toBe(false);
  });

  it("lapses exactly ON the date, not a day after it", () => {
    expect(holdingHasLapsed({ termEndsAt: NOW }, NOW)).toBe(true);
  });
});
