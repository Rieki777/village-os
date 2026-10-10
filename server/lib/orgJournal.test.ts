import { describe, expect, it } from "vitest";
import { describeOrgChange, type OrgRole } from "./orgChart";

const role = (over: Partial<OrgRole> = {}): OrgRole => ({
  id: "gate", circleId: "kitchen", name: "Gate Steward", aim: "Hold the gate.",
  domain: "Arrivals.", accountabilities: ["a", "b"], whyItMatters: null,
  seats: 1, criticality: "normal", active: true, recruiting: false,
  expiresEachSeason: null, statusOverride: null, statusOverrideExpiresAt: null,
  icon: null, color: null, order: 0, isExample: false, archetypes: [],
  authority: null, firstYearOutcomes: null, first90DayOutcomes: null,
  locationExpectations: null, compensationReality: null, evidenceRequired: null,
  representsCircle: false, howChosen: null, howChosenGloss: null,
  termsOffer: null, termsOfferAt: null, termsOfferBy: null,
  ...over,
});

describe("what a structural change says about itself", () => {
  it("names the field, the old value and the new one", () => {
    expect(describeOrgChange(role(), { name: "Gatekeeper" })).toEqual(["renamed: Gate Steward -> Gatekeeper"]);
    expect(describeOrgChange(role(), { circleId: "welcome" })).toEqual(["moved circle: kitchen -> welcome"]);
    expect(describeOrgChange(role(), { seats: 3 })).toEqual(["seats: 1 -> 3"]);
  });

  it("says nothing when a field is submitted unchanged", () => {
    // A partial save that touches everything and changes nothing must not
    // fill the journal with noise, or the journal stops being readable.
    expect(describeOrgChange(role(), { name: "Gate Steward", seats: 1, circleId: "kitchen" })).toEqual([]);
  });

  it("ignores fields the caller did not submit", () => {
    expect(describeOrgChange(role(), {})).toEqual([]);
  });

  it("reports prose as rewritten rather than quoting it", () => {
    // A journal entry carrying two paragraphs of domain text is unreadable,
    // and the text itself is on the seat for anyone who wants it.
    expect(describeOrgChange(role(), { domain: "Something else entirely." })).toEqual(["domain rewritten"]);
  });

  it("counts accountabilities instead of listing them", () => {
    expect(describeOrgChange(role(), { accountabilities: ["a", "b", "c"] })).toEqual(["accountabilities: 2 -> 3"]);
    expect(describeOrgChange(role(), { accountabilities: ["a", "b"] })).toEqual([]);
  });

  it("says empty values in words, so 'nothing' never reads as a bug", () => {
    expect(describeOrgChange(role({ circleId: null }), { circleId: "kitchen" }))
      .toEqual(["moved circle: nothing -> kitchen"]);
  });

  it("records resting and reopening a seat", () => {
    expect(describeOrgChange(role(), { active: false })).toEqual(["rested: true -> false"]);
    expect(describeOrgChange(role({ active: false }), { active: true })).toEqual(["reopened: false -> true"]);
  });

  it("has nothing to say about a seat that did not exist before", () => {
    expect(describeOrgChange(null, { name: "New Seat" })).toEqual([]);
  });
});
