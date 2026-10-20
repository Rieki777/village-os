/**
 * The preferences vocabulary both sides read: a press is read as exactly one
 * change or refused whole, and the page never shows more of an address than
 * a hint.
 */
import { describe, expect, it } from "vitest";
import { PERMISSION_KINDS } from "./kinds";
import { addressHint, CHOOSABLE_KINDS, KIND_WORDS, PAUSABLE_KINDS, preferencesChangeOf } from "./preferences";

describe("preferencesChangeOf", () => {
  it("reads each of the four changes", () => {
    expect(preferencesChangeOf({ kind: "letters", on: true })).toEqual({ type: "kind", kind: "letters", on: true });
    expect(preferencesChangeOf({ kind: "events", on: false })).toEqual({ type: "kind", kind: "events", on: false });
    expect(preferencesChangeOf({ pause: true })).toEqual({ type: "pause", on: true });
    expect(preferencesChangeOf({ pause: false })).toEqual({ type: "pause", on: false });
    expect(preferencesChangeOf({ stopEverything: true })).toEqual({ type: "stop_everything" });
    expect(preferencesChangeOf({ startAgain: true })).toEqual({ type: "start_again" });
  });

  it("refuses a body that is not exactly one well-formed change", () => {
    // A string "false" is not a no, and a string "true" is not a yes.
    expect(preferencesChangeOf({ kind: "letters", on: "true" })).toBeNull();
    // Essential is never a choice.
    expect(preferencesChangeOf({ kind: "essential", on: false })).toBeNull();
    expect(preferencesChangeOf({ kind: "spam", on: false })).toBeNull();
    // Two changes in one press are refused whole, never half applied.
    expect(preferencesChangeOf({ kind: "letters", on: false, stopEverything: true })).toBeNull();
    expect(preferencesChangeOf({ stopEverything: "yes" })).toBeNull();
    expect(preferencesChangeOf({ startAgain: false })).toBeNull();
    expect(preferencesChangeOf({})).toBeNull();
    expect(preferencesChangeOf(null)).toBeNull();
    expect(preferencesChangeOf([{ pause: true }])).toBeNull();
  });
});

describe("addressHint", () => {
  it("keeps the first character and the domain, and nothing between", () => {
    expect(addressHint("rye@example.org")).toBe("r•••@example.org");
    expect(addressHint("  Ada.Lovelace+news@mail.example  ")).toBe("A•••@mail.example");
    expect(addressHint("rye@example.org")).not.toContain("ye@");
  });

  it("answers nothing for something that is not an address", () => {
    expect(addressHint("")).toBe("");
    expect(addressHint("@example.org")).toBe("");
    expect(addressHint("no-at-sign")).toBe("");
  });
});

describe("the kinds a person chooses between", () => {
  it("cover every permission kind, each with its words", () => {
    expect([...CHOOSABLE_KINDS].sort()).toEqual([...PERMISSION_KINDS].sort());
    for (const k of PERMISSION_KINDS) {
      expect(KIND_WORDS[k].label.length).toBeGreaterThan(0);
      expect(KIND_WORDS[k].description.length).toBeGreaterThan(0);
    }
  });

  it("pause everything a village sends, and leave a member's own notifications to their settings", () => {
    expect([...PAUSABLE_KINDS].sort()).toEqual(["events", "letters", "paths"]);
  });
});
