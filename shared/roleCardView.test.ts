import { describe, expect, it } from "vitest";
import { roleCardView } from "./roleCardView";

const card = {
  complete: true,
  missing: [],
  gated: true,
  track: "paid",
  villageGoals: ["Fund the land"],
  selectionCriteria: ["Careful with money"],
  conversations: [
    { roleId: "h", roleName: "Human Operations & Onboarding Lead Steward", minutes: 60 },
    { roleId: "t", roleName: "Technical Operations Steward", minutes: 20 },
    { roleId: "v", roleName: "Visionary Channel", minutes: 20, final: true },
  ],
  whereWorked: "both",
  languages: ["English", "Spanish"],
  reviewAfterDays: 90,
  firstConversation: "Human Operations & Onboarding Lead Steward",
  consentCircle: "Anchor Circle",
  publicPay: { kind: "range", currency: "USD", minMinor: 200000, maxMinor: 300000, per: "month", note: "Funding dependent" },
};

describe("roleCardView", () => {
  it("draws every parameter from one seat, in card order, with hours as Roughly", () => {
    const v = roleCardView({ timeCommitment: "40 hours a week", card });
    expect(v.rows.map((r) => r.id)).toEqual(["hours", "track", "goals", "where", "languages", "review", "interviews", "criteria"]);
    expect(v.rows[0].lines).toEqual(["Roughly 40 hours a week"]);
    const interviews = v.rows.find((r) => r.id === "interviews")!;
    expect(interviews.lines).toEqual([
      "First conversation: Human Operations & Onboarding Lead Steward",
      "1. Human Operations & Onboarding Lead Steward, 1 hour",
      "2. Technical Operations Steward, 20 minutes",
      "3. Visionary Channel, 20 minutes, final approval",
      "1 hour 40 minutes of conversations in all",
      "Paid roles are consented by Anchor Circle",
    ]);
    expect(v.applyAllowed).toBe(true);
    expect(v.pay?.headline).toMatch(/2,000/);
  });
  it("holds Apply back only when the village gates it and the card is not complete", () => {
    const held = roleCardView({ card: { ...card, complete: false, missing: ["aim"] } });
    expect(held.applyAllowed).toBe(false);
    expect(held.beingWrittenLine).toBe("Being written. Still to write: its aim.");
    // Controls: complete, and incomplete in a village that does not gate.
    expect(roleCardView({ card }).applyAllowed).toBe(true);
    expect(roleCardView({ card: { ...card, gated: false, complete: false, missing: ["aim"] } }).applyAllowed).toBe(true);
  });
  it("draws nothing for a role with no card, and nothing is invented", () => {
    const v = roleCardView({});
    expect(v.rows).toEqual([]);
    expect(v.pay).toBeNull();
    expect(v.applyAllowed).toBe(true);
  });
});
