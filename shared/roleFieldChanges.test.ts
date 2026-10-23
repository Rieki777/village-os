/**
 * The structure review's before and after, field by field, including the
 * handover words of 0268.
 */
import { describe, expect, it } from "vitest";
import { FIELD_CHANGE_WORDS, ROLE_WORD_FIELDS, fieldWords, roleFieldChanges } from "./roleFieldChanges";

const live = {
  aim: "Keep the springs running",
  domain: "The tanks",
  whyItMatters: null,
  accountabilities: ["Test monthly"],
  bringMe: ["A reading"],
  notMine: null,
  runbook: "Check Mondays.",
};

describe("roleFieldChanges", () => {
  it("a move lists only the named fields whose words change, before and after", () => {
    const out = roleFieldChanges(live, {
      name: "Water Steward",
      aim: "Keep the springs running",
      domain: "The tanks and the pipes",
      bringMe: ["A reading", "The key"],
      notMine: "Garden irrigation",
      runbook: null,
    });
    expect(out).toEqual([
      { key: "domain", label: "What it looks after", before: "The tanks", after: "The tanks and the pipes" },
      { key: "bringMe", label: "Bring me", before: "A reading", after: "A reading; The key" },
      { key: "notMine", label: "Not mine to hold", before: null, after: "Garden irrigation" },
      { key: "runbook", label: "Runbook", before: "Check Mondays.", after: null },
    ]);
  });

  it("a field the payload does not name is never listed", () => {
    expect(roleFieldChanges(live, { name: "Renamed only" })).toEqual([]);
  });

  it("a new role lists every field it writes, with no before", () => {
    const out = roleFieldChanges(null, { name: "Hearth", aim: "Keep the fire", bringMe: [], runbook: "https://example.org/h" });
    expect(out).toEqual([
      { key: "aim", label: "Purpose", before: null, after: "Keep the fire" },
      { key: "runbook", label: "Runbook", before: null, after: "https://example.org/h" },
    ]);
  });

  it("covers the handover words beside aim and domain, in card order", () => {
    expect(ROLE_WORD_FIELDS.map((f) => f.key)).toEqual([
      "aim", "existsWhile", "domain", "authorities", "whyItMatters", "accountabilities", "responsibilities", "bringMe",
      "signsStretched", "flowsBack", "stepBack", "notMine", "runbook", "timeCommitment",
    ]);
    expect(FIELD_CHANGE_WORDS.none).toBe("Not written yet");
  });

  it("fieldWords joins lists and reads nothing as null", () => {
    expect(fieldWords(["a", " b ", ""], true)).toBe("a; b");
    expect(fieldWords("a\nb", true)).toBe("a; b");
    expect(fieldWords([], true)).toBeNull();
    expect(fieldWords("  ", false)).toBeNull();
    expect(fieldWords({}, false)).toBeNull();
  });
});
