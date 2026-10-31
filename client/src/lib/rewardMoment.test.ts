import { describe, expect, it } from "vitest";
import { joinAnd, rewardAnnouncement, rewardHeadline, rewardSentence } from "./rewardMoment";
import type { RewardMomentView } from "@shared/rewardMoment";

const earned = {
  kind: "earned" as const,
  work: "Seed bank shelves",
  tokens: [
    { token: "village-tokens", name: "Village tokens", units: 4000, decimals: 2 },
    { token: "village-voice", name: "Voice", units: 5, decimals: 0 },
  ],
};
const paid = { kind: "cash_paid" as const, work: "Rebuild the water tank", amountMinor: 2500000, currency: "CRC" };

describe("the words of a reward moment", () => {
  it("joins amounts the way a person says them", () => {
    expect(joinAnd(["a"])).toBe("a");
    expect(joinAnd(["a", "b"])).toBe("a and b");
    expect(joinAnd(["a", "b", "c"])).toBe("a, b and c");
  });

  it("names what came in, at the token's own scale, and what it was for", () => {
    expect(rewardSentence(earned)).toBe("40 Village tokens and 5 Voice for Seed bank shelves");
  });

  it("says cash was paid without putting the amount in the sentence", () => {
    expect(rewardSentence(paid)).toBe("Your cash for Rebuild the water tank was paid");
  });

  it("heads one arrival with its own sentence and several with how many", () => {
    const one: RewardMomentView = { keys: ["ledger:1"], lines: [earned] };
    const two: RewardMomentView = { keys: ["ledger:1", "cash:c"], lines: [earned, paid] };
    expect(rewardHeadline(one)).toBe("40 Village tokens and 5 Voice for Seed bank shelves.");
    expect(rewardHeadline(two)).toBe("2 things landed for you.");
    expect(rewardAnnouncement(two)).toBe(
      "40 Village tokens and 5 Voice for Seed bank shelves. Your cash for Rebuild the water tank was paid.",
    );
  });
});
