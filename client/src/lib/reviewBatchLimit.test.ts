import { describe, expect, it } from "vitest";
import { changesInEdit, countWithEdits, limitSentence, readWithdrawRefusal } from "./reviewBatchLimit";

describe("the batch limit sentence", () => {
  it("says who can raise the limit only over it, and names the limit", () => {
    // Under the limit, "An admin can raise it." read as raising the batch.
    expect(limitSentence(500, 18, false)).toBe("This village accepts up to 500 changes from one outside batch. This batch proposes 18.");
    expect(limitSentence(6, 18, false)).toBe(
      "This village accepts up to 6 changes from one outside batch. This batch proposes 18. " +
        "Every change past the first 6 will be blocked. An admin can raise the limit.",
    );
    expect(limitSentence(6, 18, true)).not.toContain("An admin can raise");
    expect(limitSentence(1, 1, false)).toBe("This village accepts up to 1 change from one outside batch. This batch proposes 1.");
  });
});

describe("counting a steward's edits", () => {
  it("reads an edited payload the way the server reader does", () => {
    expect(changesInEdit('{"name":"Water Steward"}')).toBe(1);
    expect(changesInEdit('{"seats":[{"name":"A"},{"name":"B"},"not a seat",null,[]]}')).toBe(2);
    expect(changesInEdit('{"seats":"A"}')).toBe(1);
    expect(changesInEdit("{ half typed")).toBeNull();
    expect(changesInEdit("[1,2]")).toBeNull();
  });

  it("puts an edit in its card's place, keeps a share whose edit does not read, and leaves an older server's total alone", () => {
    const shares = { p1: 1, p2: 3 };
    expect(countWithEdits(4, shares, {})).toBe(4);
    expect(countWithEdits(4, shares, { p2: '{"seats":[{"name":"A"}]}' })).toBe(2);
    expect(countWithEdits(4, shares, { p1: '{"seats":[{"a":1},{"b":2},{"c":3}]}' })).toBe(6);
    expect(countWithEdits(4, shares, { p2: "{ half" })).toBe(4);
    expect(countWithEdits(4, undefined, { p2: '{"seats":[]}' })).toBe(4);
  });
});

describe("a refused withdraw", () => {
  it("tells the break-glass refusal, a published draft and a closed one apart", () => {
    expect(readWithdrawRefusal(409, { error: "held", requiresOverride: true, capability: "intake.moderate" })).toBe("override");
    expect(readWithdrawRefusal(409, { error: "This draft is published", draftStatus: "published" })).toBe("published");
    expect(readWithdrawRefusal(409, { error: "This draft is withdrawn", draftStatus: "withdrawn" })).toBe("closed");
    expect(readWithdrawRefusal(409, { error: "No such draft", draftStatus: null })).toBe("closed");
    // An older server names no state, and its card goes as it always did.
    expect(readWithdrawRefusal(409, { error: "This draft is withdrawn, and only an open draft can be withdrawn" })).toBe("closed");
    expect(readWithdrawRefusal(401, { error: "auth_required" })).toBe("other");
  });
});
