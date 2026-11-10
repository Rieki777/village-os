import { describe, expect, it } from "vitest";
import { CLAIM_REFUSAL_KINDS, MAP_REASON_FOR, questClaimGate, type ClaimGateFacts } from "./questClaimGate";

const open: ClaimGateFacts = {
  isExample: false,
  closed: false,
  status: "Open",
  minStage: null,
  neededStageIndex: -1,
  memberStageIndex: 0,
  requiresRole: null,
  memberRoleIds: [],
};

describe("questClaimGate", () => {
  it("lets an open quest with no asks through", () => {
    expect(questClaimGate(open)).toBeNull();
  });

  it("refuses in one order, the first rule a member misses winning", () => {
    const all: ClaimGateFacts = {
      isExample: true,
      closed: true,
      status: "Closed",
      minStage: "steward",
      neededStageIndex: 3,
      memberStageIndex: 1,
      requiresRole: "builders",
      memberRoleIds: [],
    };
    expect(questClaimGate(all)).toEqual({ kind: "example" });
    expect(questClaimGate({ ...all, isExample: false })).toEqual({ kind: "closed", status: "Closed" });
    expect(questClaimGate({ ...all, isExample: false, closed: false })).toEqual({ kind: "stage", minStage: "steward" });
    expect(questClaimGate({ ...all, isExample: false, closed: false, memberStageIndex: 3 })).toEqual({ kind: "role", requiresRole: "builders" });
    expect(questClaimGate({ ...all, isExample: false, closed: false, memberStageIndex: 3, memberRoleIds: ["builders"] })).toBeNull();
  });

  it("reads a stage floor the ladder does not know as no floor", () => {
    expect(questClaimGate({ ...open, minStage: "unknown", neededStageIndex: -1, memberStageIndex: 0 })).toBeNull();
  });

  it("maps every refusal to a word the map knows", () => {
    for (const kind of CLAIM_REFUSAL_KINDS) expect(["closed", "not-yet"]).toContain(MAP_REASON_FOR[kind]);
  });

  it("asks a physical quest's age first: no band asks the member to say it, a band below refuses", () => {
    expect(questClaimGate({ ...open, minAge: 18 })).toEqual({ kind: "attest", minAge: 18 });
    expect(questClaimGate({ ...open, minAge: 18, memberAgeBand: "16to17" })).toEqual({ kind: "age", minAge: 18 });
    expect(questClaimGate({ ...open, minAge: 16, memberAgeBand: "16to17" })).toBeNull();
  });

  it("names every safety badge the member lacks, and passes once they hold them all", () => {
    const f = { ...open, requiredBadges: ["heights", "saw"], memberBadgeIds: ["saw"] };
    expect(questClaimGate(f)).toEqual({ kind: "badge", missing: ["heights"] });
    expect(questClaimGate({ ...f, memberBadgeIds: ["saw", "heights"] })).toBeNull();
  });

  it("refuses on age before badges, because a badge can be earned on the day and an age cannot", () => {
    expect(questClaimGate({ ...open, minAge: 18, memberAgeBand: "under16", requiredBadges: ["saw"] })).toEqual({ kind: "age", minAge: 18 });
  });
});
