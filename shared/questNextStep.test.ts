import { describe, expect, it } from "vitest";
import { nextStepFor, type NextStepInput } from "./questNextStep";

const base: NextStepInput = {
  quest: { id: "q1", firstStep: null, steps: [], startsAt: null, dueAt: null },
  place: null,
  circle: null,
  crew: null,
  crewAllowed: true,
  nextBuildDayAt: null,
};

describe("nextStepFor: who to talk to", () => {
  it("names the place's steward role first, when the quest sits at a place that has one", () => {
    const out = nextStepFor({
      ...base,
      place: { structureKey: "event-space", roleId: "build-steward", state: "filled" },
      circle: { circleId: "dev", leadRoleId: "dev-lead" },
    });
    expect(out.talkTo).toEqual({ kind: "role", roleId: "build-steward", circleId: null, source: "place", vacant: false, structureKey: "event-space" });
  });

  it("falls back to the quest circle's lead role when the place has no steward role", () => {
    const out = nextStepFor({
      ...base,
      place: { structureKey: "event-space", roleId: null, state: "open" },
      circle: { circleId: "dev", leadRoleId: "dev-lead" },
    });
    expect(out.talkTo).toMatchObject({ kind: "role", roleId: "dev-lead", circleId: "dev", source: "circle" });
  });

  it("says an open or paused steward role is vacant, so the box offers the apply path instead of a person", () => {
    const out = nextStepFor({ ...base, place: { structureKey: "x", roleId: "r", state: "open" } });
    expect(out.talkTo).toMatchObject({ kind: "role", roleId: "r", vacant: true });
  });

  it("names the circle when it has no lead role, and nobody at all when there is no circle (never invents one)", () => {
    expect(nextStepFor({ ...base, circle: { circleId: "dev", leadRoleId: null } }).talkTo).toEqual({ kind: "circle", circleId: "dev" });
    expect(nextStepFor(base).talkTo).toEqual({ kind: "none" });
  });
});

describe("nextStepFor: the first task", () => {
  it("uses the quest's first step, then its first step in the list, then a read prompt; never empty", () => {
    expect(nextStepFor({ ...base, quest: { ...base.quest, firstStep: "  Walk the site  ", steps: ["Dig"] } }).firstTask).toEqual({ kind: "step", text: "Walk the site" });
    expect(nextStepFor({ ...base, quest: { ...base.quest, firstStep: " ", steps: ["", "Dig the footing"] } }).firstTask).toEqual({ kind: "step", text: "Dig the footing" });
    expect(nextStepFor(base).firstTask).toEqual({ kind: "read", questId: "q1" });
  });
});

describe("nextStepFor: the crew", () => {
  it("gives a member of a crew its invite path, built from the crew's own code", () => {
    const out = nextStepFor({ ...base, crew: { id: "c1", inviteCode: "AbC123", size: 3 } });
    expect(out.crew).toEqual({ kind: "invite", crewId: "c1", path: "/quests/q1?crew=AbC123", size: 3 });
  });

  it("offers to start a crew when the member has none, and says nothing when the quest is solo work", () => {
    expect(nextStepFor(base).crew).toEqual({ kind: "start", questId: "q1" });
    expect(nextStepFor({ ...base, crewAllowed: false }).crew).toEqual({ kind: "solo" });
  });
});

describe("nextStepFor: the date", () => {
  it("prefers the next build day, then the start, then the due date", () => {
    const q = { ...base.quest, startsAt: "2027-01-10T14:00:00.000Z", dueAt: "2027-02-10T00:00:00.000Z" };
    expect(nextStepFor({ ...base, quest: q, nextBuildDayAt: "2027-01-08T13:00:00.000Z" }).when).toEqual({ kind: "date", at: "2027-01-08T13:00:00.000Z", source: "build_day" });
    expect(nextStepFor({ ...base, quest: q }).when).toEqual({ kind: "date", at: "2027-01-10T14:00:00.000Z", source: "starts" });
    expect(nextStepFor({ ...base, quest: { ...q, startsAt: null } }).when).toEqual({ kind: "date", at: "2027-02-10T00:00:00.000Z", source: "due" });
  });

  it("never invents a date: an unparseable instant reads as no date", () => {
    expect(nextStepFor({ ...base, quest: { ...base.quest, startsAt: "soon" } }).when).toEqual({ kind: "none" });
    expect(nextStepFor(base).when).toEqual({ kind: "none" });
  });
});
