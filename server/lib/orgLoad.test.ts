/**
 * Role hoarding: who the chart depends on.
 *
 * The reading that has to survive refactors is that `soleHeld` counts seats
 * with NO SECOND HOLDER, not seats somebody is busy in. Nothing else in this
 * codebase answers "if this person stops, what stops with them": the map
 * reads vacancy, the retrospective reads activity, and a village can pass
 * both while resting entirely on one person.
 */
import { describe, expect, it } from "vitest";
import { structuralLoad, type OrgAssignment, type OrgRole } from "./orgChart";

const role = (id: string, over: Partial<OrgRole> = {}): OrgRole => ({
  id, circleId: null, name: id, aim: null, domain: null,
  accountabilities: [], whyItMatters: null, seats: 1, criticality: "normal",
  active: true, recruiting: false, expiresEachSeason: null,
  statusOverride: null, statusOverrideExpiresAt: null,
  icon: null, color: null, order: 0, isExample: false, archetypes: [],
  authority: null, firstYearOutcomes: null, first90DayOutcomes: null,
  locationExpectations: null, compensationReality: null, evidenceRequired: null,
  representsCircle: false, howChosen: null, howChosenGloss: null,
  termsOffer: null, termsOfferAt: null, termsOfferBy: null,
  ...over,
});

let n = 0;
const seat = (orgRoleId: string, holderKey: string, over: Partial<OrgAssignment> = {}): OrgAssignment => ({
  id: `a${(n += 1)}`, orgRoleId, holderKind: "member", userId: holderKey,
  displayName: holderKey, holderKey, focus: null, note: null, seasonId: null,
  termEndsAt: null, startedAt: new Date("2026-01-01"), endedAt: null, endedReason: null,
  isExample: false,
  // 0142. Explicit rather than optional on the type: `is_agent` is NOT NULL
  // with a default in the schema, so a seating always has an answer, and a
  // fixture that could leave it undefined would let a coverage read be tested
  // against a state the database cannot produce.
  isAgent: false,
  ...over,
});

describe("who the chart depends on", () => {
  it("counts a seat as sole-held only when nobody else is on it", () => {
    const load = structuralLoad(
      [role("water"), role("gate")],
      [seat("water", "ada"), seat("gate", "ada"), seat("gate", "bo")],
    );
    const ada = load.holders.find((h) => h.holderKey === "ada")!;
    expect(ada.seatsHeld).toBe(2);
    expect(ada.soleHeld).toBe(1);
    expect(ada.soleHeldNames).toEqual(["water"]);
    // Bo shares the gate with Ada, so nothing Bo holds goes dark alone.
    expect(load.holders.find((h) => h.holderKey === "bo")!.soleHeld).toBe(0);
  });

  it("separates a sole-held CRITICAL seat from ordinary ones", () => {
    // Holding the one seat the village marked critical is a different risk
    // from holding three it did not, and the column already exists to say so.
    const load = structuralLoad(
      [role("water", { criticality: "high" }), role("compost")],
      [seat("water", "ada"), seat("compost", "ada")],
    );
    const ada = load.holders[0];
    expect(ada.soleHeld).toBe(2);
    expect(ada.soleHeldCritical).toBe(1);
  });

  it("still counts a holding whose mandate has lapsed", () => {
    // Nothing is revoked at a season turn. Dropping a lapsed holder would
    // report the village as LESS dependent on someone at exactly the moment
    // their mandate ran out, which is backwards.
    const load = structuralLoad(
      [role("water")],
      [seat("water", "ada", { lapsed: true, lapsedReason: "season", termEndsAt: new Date("2026-02-01") })],
    );
    expect(load.holders[0].soleHeld).toBe(1);
  });

  it("ignores a holding that actually ended", () => {
    const load = structuralLoad([role("water")], [seat("water", "ada", { endedAt: new Date("2026-03-01") })]);
    expect(load.holders).toEqual([]);
    expect(load.seatingsLive).toBe(0);
    expect(load.unheldSeats).toBe(1);
  });

  it("ignores seats that are retired or standing examples", () => {
    // A demo seat must never make a real person look overloaded.
    const load = structuralLoad(
      [role("demo", { isExample: true }), role("old", { active: false }), role("water")],
      [seat("demo", "ada"), seat("old", "ada"), seat("water", "ada")],
    );
    expect(load.holders[0].seatsHeld).toBe(1);
    expect(load.seatingsLive).toBe(1);
    // And they are not counted as unheld either; they are not in play at all.
    expect(load.unheldSeats).toBe(0);
  });

  it("reads share against every live seating, not against the seat count", () => {
    const load = structuralLoad(
      [role("a"), role("b"), role("c")],
      [seat("a", "ada"), seat("b", "ada"), seat("c", "bo")],
    );
    expect(load.seatingsLive).toBe(3);
    expect(load.holders.find((h) => h.holderKey === "ada")!.share).toBeCloseTo(2 / 3);
    expect(load.concentration).toBeCloseTo(2 / 3);
  });

  it("refuses to read concentration when one person holds everything", () => {
    // Every seat is sole-held by definition here, so the number would describe
    // the village's size and nothing else. A founding is not a finding.
    const load = structuralLoad([role("a"), role("b")], [seat("a", "ada"), seat("b", "ada")]);
    expect(load.concentration).toBeNull();
    expect(load.note).toContain("founding");
    // The underlying counts are still there for anyone who wants them.
    expect(load.holders[0].soleHeld).toBe(2);
  });

  it("says so plainly when no seat has a holder", () => {
    const load = structuralLoad([role("a")], []);
    expect(load.concentration).toBeNull();
    expect(load.distinctHolders).toBe(0);
    expect(load.unheldSeats).toBe(1);
  });

  it("resolves a member's name from the user row when the seating has none", () => {
    // A member seating usually carries no display_name, because the user row
    // has the name. Without the resolver this holder reads as a raw user id.
    const load = structuralLoad(
      [role("water")],
      [seat("water", "u-ada", { displayName: null })],
      (id) => (id === "u-ada" ? "Ada Vance" : null),
    );
    expect(load.holders[0].name).toBe("Ada Vance");
  });

  it("falls back to the holder key when nothing can name them", () => {
    const load = structuralLoad([role("water")], [seat("water", "u-ada", { displayName: null })]);
    expect(load.holders[0].name).toBe("u-ada");
  });

  it("flags one human counted twice without merging them", () => {
    // Ada is a claimed member on one seat and a name written on a card on
    // another. Two holder keys, so her load reads as two people's. Merging on
    // a name would assert an identity nobody confirmed, so this reports the
    // pair and leaves it for the seat-claim flow.
    const load = structuralLoad(
      [role("water"), role("gate")],
      [
        seat("water", "u-ada", { displayName: null }),
        seat("gate", "doc:ada-vance", { holderKind: "documented", userId: null, displayName: "Ada Vance" }),
      ],
      (id) => (id === "u-ada" ? "Ada Vance" : null),
    );
    expect(load.possibleDuplicates).toEqual([
      { documentedKey: "doc:ada-vance", memberKey: "u-ada", name: "Ada Vance" },
    ]);
    // Deliberately still two entries: the report is the fix, not the merge.
    expect(load.distinctHolders).toBe(2);
  });

  it("does not flag two different people who merely both hold seats", () => {
    const load = structuralLoad(
      [role("water"), role("gate")],
      [
        seat("water", "u-ada", { displayName: "Ada Vance" }),
        seat("gate", "doc:bo-reyes", { holderKind: "documented", userId: null, displayName: "Bo Reyes" }),
      ],
    );
    expect(load.possibleDuplicates).toEqual([]);
  });

  it("puts the person the village depends on most at the top", () => {
    const load = structuralLoad(
      [role("a"), role("b"), role("c"), role("d")],
      [seat("a", "bo"), seat("b", "ada"), seat("c", "ada"), seat("d", "ada")],
    );
    expect(load.holders.map((h) => h.holderKey)).toEqual(["ada", "bo"]);
  });
});

describe("cover, which turns a risk into a plan", () => {
  it("counts a sole-held seat that somebody is named to carry", () => {
    // 0054. structuralLoad reports seats with no second holder; a deputy
    // written down is the difference between a risk and a plan, and until
    // relations existed this read could not tell those apart.
    const load = structuralLoad(
      [role("water"), role("gate")],
      [seat("water", "ada"), seat("gate", "ada")],
      undefined,
      new Set(["water"]),
    );
    const ada = load.holders[0];
    expect(ada.soleHeld).toBe(2);
    expect(ada.soleHeldWithCover).toBe(1);
  });

  it("counts nothing as covered when the village has named nobody", () => {
    // The honest default. Omitting the set means "no relations known", which
    // must report every sole-held seat as uncovered rather than unknown.
    const load = structuralLoad([role("water")], [seat("water", "ada")]);
    expect(load.holders[0].soleHeldWithCover).toBe(0);
  });

  it("does not count cover on a seat that is NOT sole-held", () => {
    // Cover is only interesting where there is no second holder. Counting it
    // elsewhere would inflate the reassuring number.
    const load = structuralLoad(
      [role("water", { seats: 2 })],
      [seat("water", "ada"), seat("water", "bo")],
      undefined,
      new Set(["water"]),
    );
    expect(load.holders[0].soleHeld).toBe(0);
    expect(load.holders[0].soleHeldWithCover).toBe(0);
  });
});
