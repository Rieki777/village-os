import { describe, expect, it } from "vitest";
import {
  CARD_PARTS,
  beingWrittenLine,
  interviewLines,
  interviewTotalWords,
  parseRoleParams,
  roleCardGate,
  roleParamColumns,
  roleParamsFromRow,
  roughHours,
  type CardGateInput,
} from "./roleParams";

/** The Lead Financial Steward's order, as Rye ruled it (9 Nov, corrected). */
const RYE_ORDER = [
  { roleId: "human-operations-onboarding", minutes: 60 },
  { roleId: "technical-operations", minutes: 20 },
  { roleId: "to-be-confirmed", minutes: 20 },
  { roleId: "visionary-channel", minutes: 20, final: true },
];

describe("hours", () => {
  it("reads Roughly, once", () => {
    expect(roughHours("40 hours a week")).toBe("Roughly 40 hours a week");
    expect(roughHours("Roughly 40 hours a week")).toBe("Roughly 40 hours a week");
    expect(roughHours("about 10 hours")).toBe("About 10 hours");
    expect(roughHours("  ")).toBeNull();
    expect(roughHours(null)).toBeNull();
  });
});

describe("the parameters in a write", () => {
  it("parses only the keys it is given, and turns them into columns", () => {
    const r = parseRoleParams({ track: "paid", villageGoals: ["Feed the village"], reviewAfterDays: 90, bookingUrl: "https://cal.example/first" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.value).sort()).toEqual(["bookingUrl", "reviewAfterDays", "track", "villageGoals"]);
    expect(roleParamColumns(r.value)).toEqual([
      ["village_goals", '["Feed the village"]'],
      ["track", "paid"],
      ["review_after_days", 90],
      ["booking_url", "https://cal.example/first"],
    ]);
  });
  it("refuses what it cannot read, with a sentence", () => {
    for (const body of [
      { track: "emperor" },
      { whereWorked: "moon" },
      { reviewAfterDays: 0 },
      { fundedFrom: "next spring" },
      { bookingUrl: "http://insecure.example" },
      { selectionCriteria: ["a", "b", "c", "d", "e", "f"] },
      { languages: "english" },
    ]) {
      const r = parseRoleParams(body);
      expect(r.ok, JSON.stringify(body)).toBe(false);
    }
  });
  it("round-trips through a stored row", () => {
    const p = roleParamsFromRow({
      village_goals: JSON.stringify(["One"]),
      track: "volunteer",
      conversations: JSON.stringify(RYE_ORDER),
      conversation_mode: "separate",
      review_after_days: 90,
      funded_from: new Date("2026-12-01T00:00:00Z"),
      booking_url: "https://cal.example/x",
    });
    expect(p.villageGoals).toEqual(["One"]);
    expect(p.track).toBe("volunteer");
    expect(p.conversations).toEqual(RYE_ORDER);
    expect(p.conversationMode).toBe("separate");
    expect(p.fundedFrom).toBe("2026-12-01");
    expect(p.languages).toBeNull();
  });
});

describe("the completeness gate", () => {
  const complete: CardGateInput = {
    aim: "Keep money true.",
    domain: "The books",
    accountabilities: ["Close each moon"],
    timeCommitment: "40 hours a week",
    track: "paid",
    payKind: "range",
    hasRange: true,
    hasTerm: true,
    villageGoals: ["Fund the land"],
    selectionCriteria: ["Careful with money"],
    conversations: [{ roleId: "a", minutes: 20 }],
  };
  it("is complete when everything is written, and names each missing part when not", () => {
    expect(roleCardGate(complete)).toMatchObject({ complete: true, missing: [], written: CARD_PARTS.length, of: CARD_PARTS.length });
    const g = roleCardGate({ ...complete, aim: " ", villageGoals: [], conversations: null });
    expect(g.complete).toBe(false);
    expect(g.missing).toEqual(["aim", "goal", "interviews"]);
  });
  it("wants a range for a paid role, and not for a volunteer", () => {
    expect(roleCardGate({ ...complete, hasRange: false }).missing).toEqual(["range"]);
    const volunteer = roleCardGate({ ...complete, track: "volunteer", payKind: "none", hasRange: false });
    expect(volunteer.complete).toBe(true);
    expect(volunteer.of).toBe(CARD_PARTS.length - 1);
  });
  it("counts a role as paid by its pay kind too", () => {
    expect(roleCardGate({ ...complete, track: "volunteer", payKind: "fixed", hasRange: false }).missing).toEqual(["range"]);
  });
  it("says Being written and what is left", () => {
    expect(beingWrittenLine({ missing: ["aim", "hours", "track", "term", "goal"] })).toBe(
      "Being written. Still to write: its aim, rough hours, its track and 2 more.",
    );
  });
});
