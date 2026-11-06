/**
 * WHAT WAITS FOR A PERSON, ONE RULE FOR THE COUNT AND THE LIST (spec R29).
 *
 * A member reads `toDecide` off the count; a moderator reads the headline off
 * the list. Both come from `waitingKind`, so the two never say different
 * numbers about the same differences (the fix round of 2026-11-06: the board
 * shows 5 in both views, and the member view had said 7).
 */
import { describe, expect, it } from "vitest";
import { countDifferences, type Difference } from "./seraDifferences";
import { headlineCount, waitingKind } from "./seraWaiting";

const d = (lane: Difference["lane"], state: Difference["state"]) => ({ lane, state, flags: [] }) as unknown as Difference;

describe("what waits for a person", () => {
  it("puts every decision and every conflict to decide, small changes apart, and facts and ours ahead aside", () => {
    expect(waitingKind(d("decision", "suggestion"))).toBe("toDecide");
    expect(waitingKind(d("lowRisk", "conflict"))).toBe("toDecide");
    expect(waitingKind(d("facts", "conflict"))).toBe("toDecide");
    expect(waitingKind(d("lowRisk", "suggestion"))).toBe("small");
    expect(waitingKind(d("facts", "suggestion"))).toBe("facts");
    expect(waitingKind(d("decision", "oursAhead"))).toBe("oursAhead");
  });

  it("counts toDecide with the same rule, so the member and the moderator see one number", () => {
    // The board: a move, a rest, pay, a new role (decisions), a purpose conflict (low-risk lane),
    // two small changes, three facts and three of ours ahead.
    const list = [
      ...Array.from({ length: 4 }, () => d("decision", "suggestion")),
      d("lowRisk", "conflict"),
      d("lowRisk", "suggestion"),
      d("lowRisk", "suggestion"),
      ...Array.from({ length: 3 }, () => d("facts", "suggestion")),
      ...Array.from({ length: 3 }, () => d("decision", "oursAhead")),
    ];
    const count = countDifferences(list);
    expect(count.toDecide).toBe(5);
    expect(count.toDecide).toBe(list.filter((x) => waitingKind(x) === "toDecide").length);
    expect(headlineCount(count)).toBe(5);
    // With nothing to decide, the headline counts the small changes.
    expect(headlineCount(countDifferences([d("lowRisk", "suggestion"), d("lowRisk", "suggestion")]))).toBe(2);
  });
});
